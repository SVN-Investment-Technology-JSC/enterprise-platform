import { createIdleTimer, idleTimeoutMs, watchUserActivity, type IdleTimer } from './idle-timer';

const MIN = 60_000;

describe('idleTimeoutMs', () => {
  it('mặc định 30 phút khi chưa cấu hình hoặc cấu hình sai', () => {
    expect(idleTimeoutMs(undefined)).toBe(30 * MIN);
    expect(idleTimeoutMs('')).toBe(30 * MIN);
    expect(idleTimeoutMs('abc')).toBe(30 * MIN);
    expect(idleTimeoutMs('0')).toBe(30 * MIN);
    expect(idleTimeoutMs('-5')).toBe(30 * MIN);
  });

  it('đọc số phút đã cấu hình', () => {
    expect(idleTimeoutMs('2')).toBe(2 * MIN);
    expect(idleTimeoutMs(' 45 ')).toBe(45 * MIN);
    expect(idleTimeoutMs('0.5')).toBe(30_000);
  });
});

describe('createIdleTimer', () => {
  let timer: IdleTimer | undefined;
  const onIdle = jest.fn();
  const onActive = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    onIdle.mockReset();
    onActive.mockReset();
  });
  afterEach(() => {
    timer?.stop();
    jest.useRealTimers();
  });

  // SEC-UI026-01
  it('báo bỏ không đúng một lần sau 30 phút không thao tác', () => {
    timer = createIdleTimer({ timeoutMs: 30 * MIN, onIdle, onActive });
    jest.advanceTimersByTime(30 * MIN - 1);
    expect(onIdle).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(timer.isIdle()).toBe(true);
    jest.advanceTimersByTime(120 * MIN);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  // SEC-UI026-02
  it('thao tác trước hạn thì đặt lại bộ đếm', () => {
    timer = createIdleTimer({ timeoutMs: 30 * MIN, onIdle, onActive });
    jest.advanceTimersByTime(20 * MIN);
    timer.activity();
    jest.advanceTimersByTime(20 * MIN);
    timer.activity();
    jest.advanceTimersByTime(29 * MIN);
    expect(onIdle).not.toHaveBeenCalled();
    expect(onActive).not.toHaveBeenCalled();
    jest.advanceTimersByTime(MIN);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('thao tác lại sau khi bỏ không thì báo hoạt động và đếm lại từ đầu', () => {
    timer = createIdleTimer({ timeoutMs: 30 * MIN, onIdle, onActive });
    jest.advanceTimersByTime(31 * MIN);
    timer.activity();
    expect(onActive).toHaveBeenCalledTimes(1);
    expect(timer.isIdle()).toBe(false);
    jest.advanceTimersByTime(30 * MIN);
    expect(onIdle).toHaveBeenCalledTimes(2);
  });

  it('hẹn giờ bị trình duyệt làm chậm: thao tác muộn vẫn báo bỏ không trước rồi mới báo hoạt động', () => {
    timer = createIdleTimer({ timeoutMs: 30 * MIN, onIdle, onActive });
    // Đồng hồ chạy 40 phút mà hẹn giờ chưa kịp nổ (tab nền, máy ngủ).
    jest.setSystemTime(Date.now() + 40 * MIN);
    timer.activity();
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(onActive).toHaveBeenCalledTimes(1);
    expect(onIdle.mock.invocationCallOrder[0]).toBeLessThan(onActive.mock.invocationCallOrder[0]);
  });

  it('thời gian chờ không hữu hạn thì không bao giờ bỏ không', () => {
    timer = createIdleTimer({ timeoutMs: Number.POSITIVE_INFINITY, onIdle, onActive });
    jest.advanceTimersByTime(24 * 60 * MIN);
    timer.activity();
    expect(onIdle).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('dừng thì không báo gì nữa', () => {
    timer = createIdleTimer({ timeoutMs: 30 * MIN, onIdle, onActive });
    timer.stop();
    jest.advanceTimersByTime(60 * MIN);
    expect(onIdle).not.toHaveBeenCalled();
  });
});

describe('watchUserActivity', () => {
  it.each(['mousedown', 'mousemove', 'keydown', 'touchstart', 'wheel', 'scroll', 'focus'])(
    'tính %s là thao tác',
    (name) => {
      const timer = { activity: jest.fn(), isIdle: () => false, stop: jest.fn() };
      const unwatch = watchUserActivity(timer);
      window.dispatchEvent(new Event(name));
      expect(timer.activity).toHaveBeenCalledTimes(1);
      unwatch();
      window.dispatchEvent(new Event(name));
      expect(timer.activity).toHaveBeenCalledTimes(1);
    },
  );
});
