/**
 * @jest-environment jsdom
 */
/// <reference lib="dom" />
import type { SocialAttachment } from '@enterprise-platform/contracts-social';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  type GalleryItem,
  galleryItemsFromAttachments,
  galleryPlan,
  MediaGallery,
  type MediaGalleryProps,
  singleImageFrame,
} from './media-gallery';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const image = (n: number): GalleryItem => ({ key: `i${n}`, kind: 'image', alt: `anh${n}.jpg`, url: `https://f.test/i${n}.jpg` });
const video = (n: number, extra: Partial<GalleryItem> = {}): GalleryItem => ({
  key: `v${n}`,
  kind: 'video',
  alt: `clip${n}.mp4`,
  url: `https://f.test/v${n}.mp4`,
  durationMs: 65_000,
  processingStatus: 'ready',
  ...extra,
});
const attachmentOf = (item: GalleryItem): SocialAttachment => ({
  id: item.key,
  fileName: item.alt,
  contentType: item.kind === 'video' ? 'video/mp4' : 'image/jpeg',
  sizeBytes: 1,
  isImage: item.kind === 'image',
  isVideo: item.kind === 'video',
  url: item.url,
  processingStatus: item.processingStatus,
});
/** Mục video như bài đã đăng (có bản đầy đủ của tệp). */
const posted = (item: GalleryItem): GalleryItem => ({ ...item, attachment: attachmentOf(item) });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get: () => true });
  HTMLMediaElement.prototype.pause = jest.fn();
  HTMLMediaElement.prototype.play = jest.fn(() => Promise.resolve());
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (props: MediaGalleryProps) =>
  act(() => {
    root.render(createElement(MediaGallery, props));
  });
const buttons = () => Array.from(container.querySelectorAll('button'));
const dialog = () => document.body.querySelector('[role="dialog"]');
const press = (key: string) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key }));
  });
const click = (element: Element | undefined) =>
  act(() => {
    (element as HTMLElement).click();
  });

describe('galleryPlan', () => {
  const counts = [1, 2, 3, 4, 5, 9];

  it('lưới đều: tối đa 4 ô, ô thứ 4 phủ +N, một mục thì một cột', () => {
    expect(counts.map((n) => galleryPlan('grid', n))).toEqual([
      { layout: 'grid', shown: 1, largeIndex: null, moreIndex: null, more: 0, columns: 1 },
      { layout: 'grid', shown: 2, largeIndex: null, moreIndex: null, more: 0, columns: 2 },
      { layout: 'grid', shown: 3, largeIndex: null, moreIndex: null, more: 0, columns: 2 },
      { layout: 'grid', shown: 4, largeIndex: null, moreIndex: null, more: 0, columns: 2 },
      { layout: 'grid', shown: 4, largeIndex: null, moreIndex: 3, more: 1, columns: 2 },
      { layout: 'grid', shown: 4, largeIndex: null, moreIndex: 3, more: 5, columns: 2 },
    ]);
  });

  it('nổi bật: ô đầu lớn, tối đa 3 ô nhỏ, ô nhỏ cuối phủ +N', () => {
    expect(counts.map((n) => galleryPlan('featured', n))).toEqual([
      { layout: 'featured', shown: 1, largeIndex: 0, moreIndex: null, more: 0, columns: 1 },
      { layout: 'featured', shown: 2, largeIndex: 0, moreIndex: null, more: 0, columns: 1 },
      { layout: 'featured', shown: 3, largeIndex: 0, moreIndex: null, more: 0, columns: 1 },
      { layout: 'featured', shown: 4, largeIndex: 0, moreIndex: null, more: 0, columns: 1 },
      { layout: 'featured', shown: 4, largeIndex: 0, moreIndex: 3, more: 1, columns: 1 },
      { layout: 'featured', shown: 4, largeIndex: 0, moreIndex: 3, more: 5, columns: 1 },
    ]);
  });

  it('xếp dọc, trượt ngang và tự động hiện đủ mọi mục, không có +N', () => {
    for (const layout of ['stack', 'carousel', 'auto'] as const) {
      for (const n of counts) {
        expect(galleryPlan(layout, n)).toMatchObject({ shown: n, largeIndex: null, moreIndex: null, more: 0 });
      }
    }
  });
});

describe('galleryItemsFromAttachments', () => {
  it('giữ thứ tự ảnh và video, bỏ tài liệu, ánh xạ trường video', () => {
    const doc: SocialAttachment = { id: 'd', fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 1, isImage: false };
    const clip: SocialAttachment = {
      id: 'v',
      fileName: 'c.mp4',
      contentType: 'video/mp4',
      sizeBytes: 1,
      isImage: false,
      isVideo: true,
      url: 'u',
      posterUrl: 'p',
      durationMs: 1000,
      width: 10,
      height: 5,
      processingStatus: 'ready',
    };
    const pic: SocialAttachment = { id: 'i', fileName: 'p.jpg', contentType: 'image/jpeg', sizeBytes: 1, isImage: true, url: 'x' };
    const items = galleryItemsFromAttachments([clip, doc, pic]);
    expect(items.map((item) => [item.key, item.kind, item.alt])).toEqual([
      ['v', 'video', 'c.mp4'],
      ['i', 'image', 'p.jpg'],
    ]);
    expect(items[0]).toMatchObject({ url: 'u', posterUrl: 'p', durationMs: 1000, width: 10, height: 5, attachment: clip });
    expect(items[1]).toEqual({ key: 'i', kind: 'image', alt: 'p.jpg', url: 'x' });
  });
});

describe('MediaGallery theo bố cục', () => {
  const nine = [image(1), video(2), image(3), image(4), image(5), image(6), image(7), image(8), image(9)];

  it('lưới đều: 4 ô và +N đúng; ô video có biểu tượng phát và thời lượng', () => {
    render({ items: nine, layout: 'grid' });
    expect(buttons()).toHaveLength(4);
    expect(container.textContent).toContain('+5');
    expect(container.querySelector('[aria-label="Thời lượng 1:05"]')).not.toBeNull();
    render({ items: nine.slice(0, 4), layout: 'grid' });
    expect(container.textContent).not.toContain('+');
  });

  it('nổi bật: một ô lớn và tối đa 3 ô nhỏ, +N ở ô nhỏ cuối', () => {
    render({ items: nine.slice(0, 5), layout: 'featured' });
    expect(buttons()).toHaveLength(4);
    expect(container.textContent).toContain('+1');
    expect(container.querySelectorAll('[data-layout="featured"] > button')[3]?.textContent).toContain('+1');
  });

  it('một mục: mọi bố cục hiển thị đúng một mục', () => {
    for (const layout of ['grid', 'featured', 'stack', 'carousel'] as const) {
      render({ items: [image(1)], layout });
      expect(container.querySelectorAll('img')).toHaveLength(1);
    }
  });

  it('xếp dọc: video phát tại chỗ bằng VideoAttachment (có controls)', () => {
    render({ items: [image(1), posted(video(2)), image(3)], layout: 'stack' });
    expect(container.querySelectorAll('img')).toHaveLength(2);
    const player = container.querySelector('video');
    expect(player?.hasAttribute('controls')).toBe(true);
    click(buttons()[1]);
    expect(dialog()).not.toBeNull();
  });

  it('trượt ngang: mỗi mục một trang, chỉ dẫn n/N, nút sau có mặt', () => {
    render({ items: [image(1), posted(video(2)), image(3)], layout: 'carousel' });
    expect(container.querySelectorAll('[aria-roledescription="trang"]')).toHaveLength(3);
    expect(container.textContent).toContain('1/3');
    expect(container.querySelector('[aria-label="Mục sau"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Mục trước"]')).toBeNull();
    expect(container.querySelector('video')?.hasAttribute('controls')).toBe(true);
  });

  it('auto: ảnh dạng lưới ImageGrid, video xếp dọc phía dưới', () => {
    render({ items: [posted(video(1)), image(2), image(3)], layout: 'auto' });
    const root = container.querySelector('[data-layout="auto"]') as HTMLElement;
    expect(root.children).toHaveLength(2);
    expect(root.children[0].querySelectorAll('img')).toHaveLength(2);
    expect(root.children[1].querySelector('video')?.hasAttribute('controls')).toBe(true);
  });
});

describe('MediaViewer', () => {
  it('bấm ô mở viewer đúng chỉ số; phím chuyển mục; video phát có controls và dừng khi rời mục', () => {
    const items = [image(1), video(2), image(3)];
    render({ items, layout: 'grid' });
    click(buttons()[1]);
    expect(dialog()).not.toBeNull();
    const playing = () => dialog()?.querySelector('video');
    expect(playing()?.hasAttribute('controls')).toBe(true);
    expect(playing()?.getAttribute('src')).toBe('https://f.test/v2.mp4');
    expect(dialog()?.textContent).toContain('2/3');

    press('ArrowRight');
    expect(playing()).toBeNull();
    expect(dialog()?.querySelector('img')?.getAttribute('src')).toBe('https://f.test/i3.jpg');
    expect(dialog()?.textContent).toContain('3/3');

    press('ArrowRight');
    expect(dialog()?.querySelector('img')?.getAttribute('src')).toBe('https://f.test/i1.jpg');
    press('ArrowLeft');
    expect(dialog()?.querySelector('img')?.getAttribute('src')).toBe('https://f.test/i3.jpg');

    press('Escape');
    expect(dialog()).toBeNull();
  });

  it('bấm nền đóng; bấm nút sau chuyển mục', () => {
    render({ items: [image(1), image(2)], layout: 'featured' });
    click(buttons()[0]);
    click(document.body.querySelector('[aria-label="Mục sau"]') ?? undefined);
    expect(dialog()?.querySelector('img')?.getAttribute('src')).toBe('https://f.test/i2.jpg');
    act(() => {
      dialog()?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(dialog()).toBeNull();
  });

  it('mở viewer thì dừng video đang phát bên ngoài', () => {
    const outside = document.createElement('video');
    document.body.appendChild(outside);
    Object.defineProperty(outside, 'paused', { configurable: true, get: () => false });
    const pause = jest.fn();
    outside.pause = pause;
    render({ items: [image(1), image(2)], layout: 'grid' });
    click(buttons()[0]);
    expect(pause).toHaveBeenCalled();
    outside.remove();
  });
});

describe('MediaGallery trạng thái video và xem trước', () => {
  it('video đang xử lý hiện "Đang xử lý", lỗi hiện thông báo trong ô', () => {
    render({
      items: [video(1, { url: undefined, processingStatus: 'processing' }), video(2, { url: undefined, processingStatus: 'failed' })],
      layout: 'grid',
    });
    expect(container.querySelector('[data-state="processing"]')?.textContent).toBe('Đang xử lý');
    expect(container.querySelector('[data-state="failed"]')?.textContent).toContain('Không xử lý được video này.');
  });

  it('video chưa xong: lưới tự làm mới qua onRequestRefresh khi người xem chờ', () => {
    jest.useFakeTimers();
    const refresh = jest.fn();
    render({ items: [video(1, { url: undefined, processingStatus: 'processing' })], layout: 'grid', onRequestRefresh: refresh });
    act(() => {
      jest.advanceTimersByTime(8100);
    });
    expect(refresh).toHaveBeenCalledWith({ silent: true });
    jest.useRealTimers();
  });

  it('preview: không có nút, không controls, không mở viewer, video là khung đầu muted', () => {
    const items = [image(1), video(2)];
    for (const layout of ['auto', 'grid', 'featured', 'stack', 'carousel'] as const) {
      render({ items, layout, preview: true });
      expect(container.querySelectorAll('[controls]')).toHaveLength(0);
      const player = container.querySelector('video');
      expect(player?.getAttribute('preload')).toBe('metadata');
      expect(player?.muted).toBe(true);
      expect(container.querySelector('button[aria-label^="Xem"]')).toBeNull();
      expect(dialog()).toBeNull();
    }
  });

  it('preview: video chưa xong hiện khung Đang xử lý', () => {
    render({ items: [video(1, { url: undefined, processingStatus: 'queued' })], layout: 'featured', preview: true });
    expect(container.querySelector('[data-state="processing"]')?.textContent).toBe('Đang xử lý');
    expect(container.querySelector('video')).toBeNull();
  });
});

describe('singleImageFrame', () => {
  it('trong khoảng thì giữ đúng tỉ lệ', () => {
    expect(singleImageFrame(1600, 1000)).toEqual({ aspectRatio: '1.6' });
    expect(singleImageFrame(1000, 1000)).toEqual({ aspectRatio: '1' });
  });
  it('dọc quá cao bị kẹp 4/5, ngang quá rộng bị kẹp 1.91', () => {
    expect(singleImageFrame(500, 2000)).toEqual({ aspectRatio: '0.8' });
    expect(singleImageFrame(4000, 1000)).toEqual({ aspectRatio: '1.91' });
  });
  it('thiếu hoặc không hợp lệ thì không có tỉ lệ', () => {
    expect(singleImageFrame()).toEqual({});
    expect(singleImageFrame(100, undefined)).toEqual({});
    expect(singleImageFrame(0, 100)).toEqual({});
    expect(singleImageFrame(100, -1)).toEqual({});
    expect(singleImageFrame(Number.NaN, 100)).toEqual({});
  });
});

describe('MediaGallery với đúng một ảnh', () => {
  const layouts = ['auto', 'grid', 'featured', 'carousel', 'stack'] as const;
  const sized = { ...image(1), width: 1000, height: 1000 };

  it.each(layouts)('bố cục %s: dùng khung ảnh đơn theo tỉ lệ, bấm mở trình xem', (layout) => {
    render({ items: [sized], layout });
    const button = buttons()[0];
    expect(button.getAttribute('data-sized')).toBe('true');
    expect(button.style.aspectRatio).toBe('1');
    expect(container.querySelector('[data-layout]')).toBeNull();
    click(button);
    expect(dialog()).not.toBeNull();
  });

  it.each(layouts)('bố cục %s: ảnh cũ thiếu kích thước không có aspect-ratio', (layout) => {
    render({ items: [image(1)], layout });
    const button = buttons()[0];
    expect(button.getAttribute('data-sized')).toBe('false');
    expect(button.style.aspectRatio).toBe('');
  });

  it('xem trước thì tĩnh, không có nút và không mở trình xem', () => {
    render({ items: [sized], layout: 'grid', preview: true });
    expect(buttons()).toHaveLength(0);
    expect(container.querySelector('[data-sized="true"]')).not.toBeNull();
    expect(dialog()).toBeNull();
  });

  it('hai ảnh, hoặc ảnh kèm video, vẫn là ô cắt đều', () => {
    render({ items: [image(1), image(2)], layout: 'grid' });
    expect(container.querySelector('[data-layout="grid"]')).not.toBeNull();
    expect(container.querySelector('[data-sized]')).toBeNull();
    render({ items: [image(1), video(1)], layout: 'featured' });
    expect(container.querySelector('[data-layout="featured"]')).not.toBeNull();
    expect(container.querySelector('[data-sized]')).toBeNull();
  });

  it('một video không dùng khung ảnh đơn', () => {
    render({ items: [video(1)], layout: 'grid' });
    expect(container.querySelector('[data-layout="grid"]')).not.toBeNull();
  });

  it('galleryItemsFromAttachments truyền width/height của ảnh', () => {
    const [item] = galleryItemsFromAttachments([{ ...attachmentOf(image(1)), width: 300, height: 200 }]);
    expect(item.width).toBe(300);
    expect(item.height).toBe(200);
  });
});
