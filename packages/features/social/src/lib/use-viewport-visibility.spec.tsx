/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import {
  NEAR_VIEWPORT_MARGIN,
  PAUSE_BELOW_RATIO,
  shouldPauseOutOfView,
  useNearViewport,
  usePauseWhenOutOfView,
} from './use-viewport-visibility';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface FakeObserver {
  readonly callback: IntersectionObserverCallback;
  readonly options: IntersectionObserverInit | undefined;
  readonly observed: Set<Element>;
}

const observers: FakeObserver[] = [];

beforeAll(() => {
  class FakeIntersectionObserver {
    readonly state: FakeObserver;
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.state = { callback, options, observed: new Set() };
      observers.push(this.state);
    }
    observe(element: Element) {
      this.state.observed.add(element);
    }
    unobserve(element: Element) {
      this.state.observed.delete(element);
    }
    disconnect() {
      this.state.observed.clear();
    }
  }
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIntersectionObserver;
});

const pauseObserver = () => observers.find((item) => item.options?.rootMargin === undefined);
const nearObserver = () => observers.find((item) => item.options?.rootMargin === NEAR_VIEWPORT_MARGIN);

const emit = (observer: FakeObserver | undefined, target: Element, ratio: number, isIntersecting = ratio > 0) => {
  act(() => {
    observer?.callback(
      [{ target, intersectionRatio: ratio, isIntersecting } as unknown as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
};

describe('shouldPauseOutOfView', () => {
  const base = { paused: false, ended: false, ratio: 0, detached: false };

  it('dừng khi video đang phát bị che gần hết', () => {
    expect(shouldPauseOutOfView({ ...base, ratio: 0 })).toBe(true);
    expect(shouldPauseOutOfView({ ...base, ratio: PAUSE_BELOW_RATIO - 0.01 })).toBe(true);
  });

  it('không dừng khi còn thấy đủ nhiều', () => {
    expect(shouldPauseOutOfView({ ...base, ratio: PAUSE_BELOW_RATIO })).toBe(false);
    expect(shouldPauseOutOfView({ ...base, ratio: 1 })).toBe(false);
  });

  it('không đụng tới video đã dừng, đã hết, hoặc đang toàn màn hình / hình trong hình', () => {
    expect(shouldPauseOutOfView({ ...base, paused: true })).toBe(false);
    expect(shouldPauseOutOfView({ ...base, ended: true })).toBe(false);
    expect(shouldPauseOutOfView({ ...base, detached: true })).toBe(false);
  });
});

describe('usePauseWhenOutOfView', () => {
  const setup = (playing: boolean) => {
    const video = document.createElement('video');
    Object.defineProperty(video, 'paused', { configurable: true, get: () => !playing });
    const pause = jest.fn();
    video.pause = pause;
    renderHook(() => {
      const ref = useRef<HTMLVideoElement>(video);
      usePauseWhenOutOfView(ref, 'url-1');
    });
    return { video, pause };
  };

  it('video đang phát bị cuộn ra khỏi màn hình thì tự dừng', () => {
    const { video, pause } = setup(true);
    expect(pauseObserver()?.observed.has(video)).toBe(true);
    emit(pauseObserver(), video, 0, false);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('cuộn lại tới thì không tự phát và không dừng thêm', () => {
    const { video, pause } = setup(true);
    emit(pauseObserver(), video, 0.8);
    expect(pause).not.toHaveBeenCalled();
  });

  it('video đang dừng thì không gọi pause', () => {
    const { video, pause } = setup(false);
    emit(pauseObserver(), video, 0, false);
    expect(pause).not.toHaveBeenCalled();
  });
});

describe('useNearViewport', () => {
  it('false cho tới khi phần tử tới gần, rồi giữ nguyên true', () => {
    const element = document.createElement('div');
    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(element);
      return useNearViewport(ref, true);
    });
    expect(result.current).toBe(false);
    expect(nearObserver()?.observed.has(element)).toBe(true);
    emit(nearObserver(), element, 0, false);
    expect(result.current).toBe(false);
    emit(nearObserver(), element, 0.1, true);
    expect(result.current).toBe(true);
    emit(nearObserver(), element, 0, false);
    expect(result.current).toBe(true);
  });

  it('tắt thì luôn true và không theo dõi', () => {
    const element = document.createElement('div');
    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(element);
      return useNearViewport(ref, false);
    });
    expect(result.current).toBe(true);
    expect(nearObserver()?.observed.has(element)).toBe(false);
  });
});
