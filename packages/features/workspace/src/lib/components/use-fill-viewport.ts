import { useLayoutEffect, type RefObject } from 'react';

/** Khung không bao giờ thấp hơn mức này, kể cả màn hình rất thấp (lúc đó trang cuộn như thường). */
const DEFAULT_MIN_HEIGHT = 320;

/** Khoảng trống giữ lại dưới khung: đủ để khung không dính mép màn hình, phần đệm dư của khối bao quanh được lấy lại. */
const DEFAULT_BOTTOM_GAP = 16;

/** Phần tử cuộn gần nhất bao quanh `element` (vùng nội dung của khung ứng dụng), hoặc `null` khi cuộn theo cửa sổ. */
export function scrollParentOf(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}

/**
 * Cho khung chiếm ĐÚNG phần chiều cao còn lại của vùng nội dung, từ mép trên của nó tới đáy màn hình (trừ lề dưới của
 * các khối bao quanh), nên trang không phải cuộn dọc ở mọi cỡ màn hình. Thay cho con số tính cứng kiểu
 * `calc(100vh - 274px)`, vốn lệch mỗi khi phía trên khung thêm hay bớt một hàng.
 *
 * Đo lại khi đổi cỡ cửa sổ và khi khối chứa đổi cỡ (phía trên khung có hàng hiện hoặc ẩn). Màn hình quá thấp thì giữ
 * `minHeight` và để trang cuộn.
 */
export function useFillViewportHeight(
  ref: RefObject<HTMLElement | null>,
  minHeight = DEFAULT_MIN_HEIGHT,
  /** Đổi giá trị này để đo lại, dùng khi phần tử chỉ xuất hiện về sau (ví dụ khung chỉ có ở một chế độ xem). */
  trigger?: unknown,
  /** Khoảng trống chừa dưới khung (px). Khối bao quanh có đệm dưới lớn hơn thì phần dư được lấy lại bằng lề âm. */
  bottomGap = DEFAULT_BOTTOM_GAP,
): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const scroller = scrollParentOf(element);
    let frame = 0;

    const measure = () => {
      frame = 0;
      const viewport = scroller ? scroller.clientHeight : window.innerHeight;
      const viewportTop = scroller ? scroller.getBoundingClientRect().top : 0;
      const scrolled = scroller ? scroller.scrollTop : window.scrollY;
      // Vị trí mép trên của khung tính từ đầu nội dung, không phụ thuộc trang đang cuộn tới đâu.
      const top = element.getBoundingClientRect().top - viewportTop + scrolled;
      let bottomPadding = 0;
      for (let node = element.parentElement; node && node !== scroller; node = node.parentElement) {
        bottomPadding += parseFloat(getComputedStyle(node).paddingBottom) || 0;
      }
      const reclaim = Math.max(0, bottomPadding - bottomGap);
      const next = Math.max(minHeight, Math.floor(viewport - top - Math.min(bottomPadding, bottomGap)));
      const margin = reclaim > 0 ? `-${reclaim}px` : '';
      if (element.style.marginBottom !== margin) element.style.marginBottom = margin;
      if (Math.abs((parseFloat(element.style.height) || 0) - next) > 1) element.style.height = `${next}px`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('resize', schedule);
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(schedule);
      if (scroller) observer.observe(scroller);
      if (element.parentElement) observer.observe(element.parentElement);
    }
    return () => {
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref, minHeight, trigger, bottomGap]);
}
