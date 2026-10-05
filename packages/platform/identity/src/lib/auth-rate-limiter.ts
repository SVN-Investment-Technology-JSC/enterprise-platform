import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Giới hạn số lần đăng nhập/refresh/đặt lại mật khẩu thất bại theo khóa (IP, email chuẩn hóa).
 * In-memory, có TTL: mỗi instance API có bộ đếm riêng, nên khi chạy nhiều instance giới hạn
 * thực tế là (ngưỡng x số instance). Muốn chính xác toàn cục cần Redis/DB (chưa làm).
 * Chỉ đếm lần THẤT BẠI; đăng nhập thành công xóa bộ đếm email để không phá người dùng hợp lệ.
 */
export interface RateLimitRule {
  readonly max: number;
  readonly windowMs: number;
}

export interface AuthRateLimiterOptions {
  readonly enabled: boolean;
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

  private blocked(key: string, rule: RateLimitRule) {
    return this.live(key, rule.windowMs).length >= rule.max;
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

  /** Ném 429 (thông báo chung, không lộ trạng thái khóa tài khoản) nếu đã vượt ngưỡng. */
  assertAllowed(scope: string, ip: string, email?: unknown) {
    if (!this.options.enabled) return;
    const mail = AuthRateLimiter.normalizeEmail(email);
    if (
      this.blocked(`${scope}:ip:${ip}`, this.options.ipRule) ||
      (mail && this.blocked(`${scope}:email:${mail}`, this.options.emailRule))
    )
      throw new HttpException(RATE_LIMIT_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
  }

  recordFailure(scope: string, ip: string, email?: unknown) {
    if (!this.options.enabled) return;
    const mail = AuthRateLimiter.normalizeEmail(email);
    this.add(`${scope}:ip:${ip}`, this.options.ipRule);
    if (mail) this.add(`${scope}:email:${mail}`, this.options.emailRule);
  }

  recordSuccess(scope: string, email?: unknown) {
    const mail = AuthRateLimiter.normalizeEmail(email);
    if (mail) this.hits.delete(`${scope}:email:${mail}`);
  }
}

export const defaultAuthRateLimiter = new AuthRateLimiter();
