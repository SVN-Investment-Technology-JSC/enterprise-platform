/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import {
  nextVideoRefreshDelay,
  useVideoRefreshPoll,
  VIDEO_REFRESH_TOTAL_MS,
  type VideoRefresh,
} from './use-video-refresh-poll';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  setVisibility('visible');
});
afterEach(() => {
  jest.useRealTimers();
});

const advance = async (ms: number) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

describe('nextVideoRefreshDelay', () => {
  it('8 giây, lùi dần, tối đa 30 giây', () => {
    expect([0, 1, 2, 3, 4, 10].map(nextVideoRefreshDelay)).toEqual([8000, 12_000, 18_000, 27_000, 30_000, 30_000]);
  });
});

describe('useVideoRefreshPoll', () => {
  it('gọi sau 8 giây rồi lùi dần, kèm silent', async () => {
    const refresh = jest.fn<ReturnType<VideoRefresh>, Parameters<VideoRefresh>>(() => undefined);
    renderHook(() => useVideoRefreshPoll(true, refresh));
    await advance(7999);
    expect(refresh).not.toHaveBeenCalled();
    await advance(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith({ silent: true });
    await advance(11_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('không chạy khi không active hoặc không có hàm làm mới', async () => {
    const refresh = jest.fn();
    renderHook(() => useVideoRefreshPoll(false, refresh));
    renderHook(() => useVideoRefreshPoll(true, undefined));
    await advance(60_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('không gọi chồng: chờ lần trước xong mới hẹn lần sau', async () => {
    let finish: () => void = () => undefined;
    const refresh = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    renderHook(() => useVideoRefreshPoll(true, refresh));
    await advance(8000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await advance(120_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await advance(12_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('lỗi từ hàm làm mới không làm dừng vòng hỏi', async () => {
    const refresh = jest.fn(() => Promise.reject(new Error('mạng')));
    renderHook(() => useVideoRefreshPoll(true, refresh));
    await advance(8000);
    await advance(12_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('dừng khi active chuyển sang false và khi unmount', async () => {
    const refresh = jest.fn();
    const { rerender, unmount } = renderHook(({ active }) => useVideoRefreshPoll(active, refresh), {
      initialProps: { active: true },
    });
    await advance(8000);
    expect(refresh).toHaveBeenCalledTimes(1);
    rerender({ active: false });
    await advance(120_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    rerender({ active: true });
    unmount();
    await advance(120_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('tab ẩn thì tạm dừng, hiện lại thì gọi ngay', async () => {
    const refresh = jest.fn();
    renderHook(() => useVideoRefreshPoll(true, refresh));
    await advance(3000);
    setVisibility('hidden');
    await advance(120_000);
    expect(refresh).not.toHaveBeenCalled();
    setVisibility('visible');
    await advance(0);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('ngừng sau khoảng 30 phút', async () => {
    const refresh = jest.fn();
    renderHook(() => useVideoRefreshPoll(true, refresh));
    await advance(VIDEO_REFRESH_TOTAL_MS);
    const calls = refresh.mock.calls.length;
    expect(calls).toBeGreaterThan(40);
    await advance(VIDEO_REFRESH_TOTAL_MS);
    expect(refresh).toHaveBeenCalledTimes(calls);
  });
});
