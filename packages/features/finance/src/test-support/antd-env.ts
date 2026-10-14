/// <reference types="jest" />
/**
 * antd Table cần matchMedia, ResizeObserver và getComputedStyle(elt, pseudoElt); jsdom chưa hỗ trợ.
 * Gọi `installAntdEnv()` ở đầu file spec; hàm tự gỡ sau khi spec chạy xong.
 */
export function installAntdEnv(): void {
  const nativeGetComputedStyle = window.getComputedStyle.bind(window);
  beforeAll(() => {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = jest.fn();
    };
    window.getComputedStyle = ((elt: Element) => nativeGetComputedStyle(elt)) as typeof window.getComputedStyle;
  });
  afterAll(() => {
    window.getComputedStyle = nativeGetComputedStyle;
  });
}
