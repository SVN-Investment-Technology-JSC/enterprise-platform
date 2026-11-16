/** Mặc định: 30 phút không thao tác thì coi tab là bỏ không. */
export const DEFAULT_IDLE_TIMEOUT_MINUTES = 30;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * Đổi số phút cấu hình (biến môi trường `NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES`) sang mili giây.
 * Giá trị trống, không phải số hoặc không dương thì dùng mặc định 30 phút.
 */
export function idleTimeoutMs(rawMinutes: string | undefined): number {
  const minutes = Number(rawMinutes?.trim() || NaN);
  const effective = Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_IDLE_TIMEOUT_MINUTES;
  return Math.round(effective * 60_000);
}

/** Thời gian chờ đã cấu hình cho trình duyệt. Next thay `process.env.NEXT_PUBLIC_...` bằng giá trị lúc build. */
export function configuredIdleTimeoutMs(): number {
  // Phải viết dạng `process.env.NEXT_PUBLIC_...` (không dùng ngoặc vuông) thì Next mới thay được lúc build.
  const raw = typeof process === 'undefined' ? undefined : process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES;
  return idleTimeoutMs(raw);
}

export interface IdleTimerOptions {
  /** Bao lâu không thao tác thì coi là bỏ không. Không hữu hạn (Infinity) thì không bao giờ bỏ không. */
  readonly timeoutMs: number;
  /** Vừa chuyển sang bỏ không. */
  readonly onIdle: () => void;
  /** Có thao tác lại sau khi đã bỏ không. */
  readonly onActive: () => void;
}

export interface IdleTimer {
  /** Ghi nhận một thao tác của người dùng. */
  activity(): void;
  isIdle(): boolean;
  stop(): void;
}

/**
 * Bộ hẹn giờ không thao tác, không đụng tới DOM. Không đặt lại hẹn giờ ở mỗi thao tác (chuột di liên tục):
 * khi hẹn giờ nổ thì so với lần thao tác cuối, chưa đủ lâu thì hẹn tiếp phần còn lại. Trình duyệt làm chậm
 * hẹn giờ ở tab nền, nên mỗi thao tác cũng tự kiểm đã quá hạn chưa để báo `onIdle` trước `onActive`.
 */
export function createIdleTimer({ timeoutMs, onIdle, onActive }: IdleTimerOptions): IdleTimer {
  const enabled = Number.isFinite(timeoutMs) && timeoutMs > 0;
  let lastActivity = Date.now();
  let idle = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const goIdle = () => {
    if (idle || stopped) return;
    idle = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    onIdle();
  };

  const check = () => {
    timer = undefined;
    if (stopped || idle) return;
    const remaining = lastActivity + timeoutMs - Date.now();
    if (remaining <= 0) goIdle();
    else schedule(remaining);
  };

  const schedule = (delay: number) => {
    if (!enabled || stopped || timer) return;
    timer = setTimeout(check, Math.min(Math.max(delay, 0), MAX_TIMEOUT_MS));
  };

  schedule(timeoutMs);

  return {
    activity() {
      if (stopped) return;
      const now = Date.now();
      if (enabled && !idle && now - lastActivity >= timeoutMs) goIdle();
      lastActivity = now;
      if (idle) {
        idle = false;
        schedule(timeoutMs);
        onActive();
      }
    },
    isIdle: () => idle,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}

/** Thao tác được tính là người dùng còn ở đây. */
export const USER_ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'wheel', 'scroll'] as const;

/** Gắn bộ hẹn giờ vào chuột, phím, chạm, cuộn, focus và lúc tab hiện lại. Trả hàm gỡ. */
export function watchUserActivity(timer: IdleTimer): () => void {
  const onActivity = () => timer.activity();
  const onVisible = () => {
    if (document.visibilityState === 'visible') timer.activity();
  };
  for (const name of USER_ACTIVITY_EVENTS) window.addEventListener(name, onActivity, { passive: true });
  window.addEventListener('focus', onActivity);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    for (const name of USER_ACTIVITY_EVENTS) window.removeEventListener(name, onActivity);
    window.removeEventListener('focus', onActivity);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
