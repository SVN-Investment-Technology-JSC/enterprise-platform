/**
 * @jest-environment jsdom
 */
/// <reference lib="dom" />
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactionIcon, reactionAssetUrl } from './reaction-icon';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPlay = jest.fn();
const mockGoToAndStop = jest.fn();
const mockDestroy = jest.fn();
const mockLoadAnimation = jest.fn(() => ({ play: mockPlay, goToAndStop: mockGoToAndStop, destroy: mockDestroy }));
jest.mock('lottie-web/build/player/lottie_light', () => ({ __esModule: true, default: { loadAnimation: (...a: unknown[]) => (mockLoadAnimation as (...x: unknown[]) => unknown)(...a) } }));

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('ReactionIcon', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    jest.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('dùng đường dẫn dưới basePath của phân hệ', () => {
    expect(reactionAssetUrl('like')).toBe('/modules/social/reactions/like.json');
  });

  it('render ẩn khỏi trình đọc màn hình, đúng kích thước, và dựng hoạt hình ở khung đầu', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, text: async () => '{"v":"5"}' })) as unknown as typeof fetch;
    act(() => root.render(createElement(ReactionIcon, { type: 'love', size: 32 })));
    await flush();
    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.style.width).toBe('32px');
    expect(mockLoadAnimation).toHaveBeenCalledTimes(1);
    expect(mockGoToAndStop).toHaveBeenCalledWith(0, true);
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it('chạy khi playing và dừng lại khi playing tắt', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, text: async () => '{"v":"5"}' })) as unknown as typeof fetch;
    act(() => root.render(createElement(ReactionIcon, { type: 'haha', playing: true })));
    await flush();
    expect(mockPlay).toHaveBeenCalled();
    act(() => root.render(createElement(ReactionIcon, { type: 'haha', playing: false })));
    expect(mockGoToAndStop).toHaveBeenCalledWith(0, true);
  });

  it('giữ chỗ trống khi tải lỗi, không ném lỗi', async () => {
    global.fetch = jest.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    act(() => root.render(createElement(ReactionIcon, { type: 'wow' })));
    await flush();
    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.style.height).toBe('24px');
    expect(mockLoadAnimation).not.toHaveBeenCalled();
  });
});
