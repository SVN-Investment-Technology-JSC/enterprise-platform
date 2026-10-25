'use client';

import { useEffect, useState, type RefObject } from 'react';

/** Video bị che hơn 3/4 (còn thấy dưới 25%) thì coi như đã cuộn ra khỏi màn hình. */
export const PAUSE_BELOW_RATIO = 0.25;
/** Tải trước khi tới gần: bắt đầu nạp khi còn cách vùng nhìn thấy chừng này. */
export const NEAR_VIEWPORT_MARGIN = '300px 0px';

type Listener = (entry: IntersectionObserverEntry) => void;

/** Một `IntersectionObserver` dùng chung cho mọi phần tử cùng cấu hình, thay vì mỗi video một bộ. */
function createSharedObserver(options: IntersectionObserverInit) {
  const listeners = new WeakMap<Element, Listener>();
  let observer: IntersectionObserver | undefined;
  return {
    observe(element: Element, listener: Listener): () => void {
      observer ??= new IntersectionObserver((entries) => {
        for (const entry of entries) listeners.get(entry.target)?.(entry);
      }, options);
      listeners.set(element, listener);
      observer.observe(element);
      return () => {
        listeners.delete(element);
        observer?.unobserve(element);
      };
    },
  };
}

const pauseObserver = createSharedObserver({ threshold: [0, PAUSE_BELOW_RATIO, 0.5, 1] });
const nearObserver = createSharedObserver({ rootMargin: NEAR_VIEWPORT_MARGIN });

export interface PauseDecisionInput {
  readonly paused: boolean;
  readonly ended: boolean;
  readonly ratio: number;
  /** Đang toàn màn hình hoặc hình trong hình: người xem chủ động xem, không dừng. */
  readonly detached: boolean;
}

/** Có nên tạm dừng video này vì đã cuộn ra khỏi màn hình? */
export function shouldPauseOutOfView(input: PauseDecisionInput): boolean {
  if (input.paused || input.ended || input.detached) return false;
  return input.ratio < PAUSE_BELOW_RATIO;
}

function isDetached(video: HTMLVideoElement): boolean {
  const pictureInPicture = (document as Document & { pictureInPictureElement?: Element | null }).pictureInPictureElement;
  return document.fullscreenElement === video || pictureInPicture === video;
}

/**
 * Video đang phát mà bị cuộn ra khỏi màn hình thì tự dừng. Cuộn lại tới thì không tự phát tiếp:
 * người xem bấm phát khi muốn xem.
 */
export function usePauseWhenOutOfView(ref: RefObject<HTMLVideoElement | null>, watchKey: unknown): void {
  useEffect(() => {
    const video = ref.current;
    if (!video || typeof IntersectionObserver === 'undefined') return;
    return pauseObserver.observe(video, (entry) => {
      if (
        shouldPauseOutOfView({
          paused: video.paused,
          ended: video.ended,
          ratio: entry.isIntersecting ? entry.intersectionRatio : 0,
          detached: isDetached(video),
        })
      ) {
        video.pause();
      }
    });
    // `watchKey` đổi khi phần tử video được dựng lại (ví dụ URL đổi nên khoá `key` đổi): theo dõi lại phần tử mới.
  }, [ref, watchKey]);
}

/**
 * `true` khi phần tử đã tới gần vùng nhìn thấy (một lần là giữ nguyên). Dùng để hoãn việc tải thứ không có
 * thuộc tính lazy riêng (thẻ video không có ảnh bìa). Tắt (`enabled = false`) hoặc không có `IntersectionObserver`
 * thì luôn `true`.
 */
export function useNearViewport(ref: RefObject<Element | null>, enabled: boolean): boolean {
  const supported = typeof IntersectionObserver !== 'undefined';
  const [near, setNear] = useState(!enabled || !supported);
  useEffect(() => {
    if (near || !enabled || !supported) return;
    const element = ref.current;
    if (!element) return;
    const stop = nearObserver.observe(element, (entry) => {
      if (entry.isIntersecting) setNear(true);
    });
    return stop;
  }, [near, enabled, supported, ref]);
  return near;
}
