import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Giới hạn số lần đăng nhập/refresh/đặt lại mật khẩu thất bại.
 *
 * Hai bộ đếm cho mỗi phạm vi (`scope`, ví dụ `login`, `refresh`):
 * - theo IP (`AUTH_RATE_LIMIT_IP_MAX`): chặn một nguồn dò nhiều tài khoản;
 * - theo cặp email + IP (`AUTH_RATE_LIMIT_EMAIL_MAX`): chặn dò mật khẩu một tài khoản từ một nguồn.
 * Không khoá theo email đơn thuần: kẻ xấu nhập sai mật khẩu của người khác từ máy mình không làm chủ tài khoản bị
 * khoá ở máy của họ (ISS-BE-010). Các phạm vi đếm riêng nhau, nên refresh lỗi không làm khoá đăng nhập.
 *
 * In-memory, có TTL: mỗi instance API có bộ đếm riêng, nên khi chạy nhiều instance giới hạn
 * thực tế là (ngưỡng x số instance). Muốn chính xác toàn cục cần Redis/DB (chưa làm).
 * Chỉ đếm lần THẤT BẠI; đăng nhập thành công xoá bộ đếm email + IP để không phá người dùng hợp lệ.
 */
export interface RateLimitRule {
  readonly max: number;
  readonly windowMs: number;
}

export interface AuthRateLimiterOptions {
  readonly enabled: boolean;
  /** Ngưỡng cho cặp email + IP. */
  readonly emailRule: RateLimitRule;
  readonly ipRule: RateLimitRule;
  readonly maxKeys: number;
}

const num = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export function authRateLimiterOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AuthRateLimiterOptions {
  const windowMs = num(env.AUTH_RATE_LIMIT_WINDOW_SECONDS, 15 * 60) * 1000;
  return {
    enabled: env.AUTH_RATE_LIMIT_ENABLED !== 'false',
    emailRule: { max: num(env.AUTH_RATE_LIMIT_EMAIL_MAX, 10), windowMs },
    ipRule: { max: num(env.AUTH_RATE_LIMIT_IP_MAX, 50), windowMs },
    maxKeys: num(env.AUTH_RATE_LIMIT_MAX_KEYS, 10_000),
  };
}

export const RATE_LIMIT_MESSAGE =
  'Quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.';

export function rateLimitMessage(retryAfterSeconds: number) {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Quá nhiều lần thử không thành công. Vui lòng thử lại sau khoảng ${minutes} phút.`;
}

/** Lỗi 429 mang số giây cần chờ để controller đặt header `Retry-After`. */
export class AuthRateLimitedException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: 'AUTH_RATE_LIMITED',
        message: rateLimitMessage(retryAfterSeconds),
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export class AuthRateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly options: AuthRateLimiterOptions = authRateLimiterOptionsFromEnv(),
    private readonly now: () => number = Date.now,
  ) {}

  static normalizeEmail(email: unknown) {
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
  }

  private live(key: string, windowMs: number) {
    const cutoff = this.now() - windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  /** Số giây còn phải chờ nếu khoá đã vượt ngưỡng, ngược lại 0. */
  private waitSeconds(key: string, rule: RateLimitRule) {
    const list = this.live(key, rule.windowMs);
    if (list.length < rule.max) return 0;
    // Khoá mở lại khi lần thất bại thứ (số lần - max + 1) tính từ cuối rơi khỏi cửa sổ.
    const releaseAt = list[list.length - rule.max] + rule.windowMs;
    return Math.max(1, Math.ceil((releaseAt - this.now()) / 1000));
  }

  private add(key: string, rule: RateLimitRule) {
    const list = this.live(key, rule.windowMs);
    list.push(this.now());
    if (!this.hits.has(key) && this.hits.size >= this.options.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest !== undefined) this.hits.delete(oldest);
    }
    this.hits.set(key, list);
  }

  private keys(scope: string, ip: string, email: unknown) {
    const mail = AuthRateLimiter.normalizeEmail(email);
    return {
      ip: `${scope}:ip:${ip}`,
      pair: mail ? `${scope}:email-ip:${mail}|${ip}` : undefined,
    };
  }

  /** Ném 429 (thông báo chung, không lộ trạng thái khoá tài khoản) nếu đã vượt ngưỡng. */
  assertAllowed(scope: string, ip: string, email?: unknown) {
    if (!this.options.enabled) return;
    const keys = this.keys(scope, ip, email);
    const wait = Math.max(
      this.waitSeconds(keys.ip, this.options.ipRule),
      keys.pair ? this.waitSeconds(keys.pair, this.options.emailRule) : 0,
    );
    if (wait > 0) throw new AuthRateLimitedException(wait);
  }

  recordFailure(scope: string, ip: string, email?: unknown) {
    if (!this.options.enabled) return;
    const keys = this.keys(scope, ip, email);
    this.add(keys.ip, this.options.ipRule);
    if (keys.pair) this.add(keys.pair, this.options.emailRule);
  }

  recordSuccess(scope: string, ip: string, email?: unknown) {
    const { pair } = this.keys(scope, ip, email);
    if (pair) this.hits.delete(pair);
  }
}

export const defaultAuthRateLimiter = new AuthRateLimiter();
