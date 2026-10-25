/**
 * @jest-environment jsdom
 */
/// <reference lib="dom" />
import type { SocialAttachment } from '@enterprise-platform/contracts-social';
import { act, createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ComposerVideoTile } from './composer-video-tile';
import {
  PREVIEW_FAILED_NOTE,
  PREVIEW_PENDING_NOTE,
  previewFailureNote,
  previewSources,
  VideoPreview,
} from './video-preview';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ready = (overrides: Partial<SocialAttachment> = {}): SocialAttachment => ({
  id: 'a1',
  fileName: 'clip.mp4',
  contentType: 'video/mp4',
  sizeBytes: 1000,
  isImage: false,
  isVideo: true,
  processingStatus: 'ready',
  url: 'https://files.test/video.mp4?sig=1',
  posterUrl: 'https://files.test/poster.jpg',
  ...overrides,
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  HTMLMediaElement.prototype.pause = jest.fn();
  HTMLMediaElement.prototype.play = jest.fn(() => Promise.resolve());
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (...ui: React.ReactElement[]) =>
  act(() => {
    root.render(createElement(Fragment, null, ...ui));
  });

const dialog = () => document.body.querySelector('[role=dialog]');
const previewVideo = () => dialog()?.querySelector('video') ?? null;

describe('nguồn xem trước', () => {
  it('video đã sẵn sàng: bản trên máy chủ trước, tệp vừa chọn sau', () => {
    expect(previewSources({ state: 'ready', attachment: ready(), previewUrl: 'blob:local' })).toEqual([
      'https://files.test/video.mp4?sig=1',
      'blob:local',
    ]);
  });

  it('chưa xử lý xong hoặc đang tải: chỉ có tệp vừa chọn, không bao giờ lộ bản gốc trên máy chủ', () => {
    for (const state of ['uploading', 'queued', 'processing'] as const) {
      expect(previewSources({ state, attachment: ready({ url: 'https://files.test/original' }), previewUrl: 'blob:local' })).toEqual([
        'blob:local',
      ]);
    }
  });

  it('không có gì để phát thì rỗng; video xử lý lỗi thì không xem trước', () => {
    expect(previewSources({ state: 'queued' })).toEqual([]);
    expect(previewSources({ state: 'ready', attachment: ready({ url: undefined }) })).toEqual([]);
    expect(previewSources({ state: 'failed', attachment: ready(), previewUrl: 'blob:local' })).toEqual([]);
  });

  it('video cũ khi sửa bài (không có tệp trong máy) vẫn xem được bằng URL máy chủ', () => {
    expect(previewSources({ state: 'ready', attachment: ready() })).toEqual(['https://files.test/video.mp4?sig=1']);
  });

  it('không lặp một nguồn hai lần', () => {
    expect(previewSources({ state: 'ready', attachment: ready({ url: 'blob:same' }), previewUrl: 'blob:same' })).toEqual(['blob:same']);
  });

  it('lời nhắn theo trạng thái', () => {
    expect(previewFailureNote('processing')).toBe(PREVIEW_PENDING_NOTE);
    expect(previewFailureNote('uploading')).toBe(PREVIEW_PENDING_NOTE);
    expect(previewFailureNote('ready')).toBe(PREVIEW_FAILED_NOTE);
  });
});

describe('VideoPreview', () => {
  it('phát nguồn đầu tiên, có điều khiển, tự phát, nhãn aria tiếng Việt', () => {
    render(createElement(VideoPreview, { fileName: 'clip.mp4', sources: ['https://a/1'], failureNote: 'x', onClose: jest.fn() }));
    expect(dialog()?.getAttribute('aria-label')).toBe('Xem trước video clip.mp4');
    const video = previewVideo() as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe('https://a/1');
    expect(video.controls).toBe(true);
    expect(video.autoplay).toBe(true);
  });

  it('nguồn đầu lỗi thì thử nguồn kế tiếp; hết nguồn thì hiện lời nhắn', () => {
    render(createElement(VideoPreview, { fileName: 'clip.mp4', sources: ['https://a/1', 'blob:2'], failureNote: 'Không phát được', onClose: jest.fn() }));
    act(() => {
      previewVideo()?.dispatchEvent(new Event('error'));
    });
    expect(previewVideo()?.getAttribute('src')).toBe('blob:2');
    act(() => {
      previewVideo()?.dispatchEvent(new Event('error'));
    });
    expect(previewVideo()).toBeNull();
    expect(dialog()?.textContent).toContain('Không phát được');
  });

  it('Esc chỉ đóng hộp xem trước và không lan ra các bộ nghe phím khác (ô soạn bên dưới)', () => {
    const onClose = jest.fn();
    const outer = jest.fn();
    window.addEventListener('keydown', outer);
    render(createElement(VideoPreview, { fileName: 'clip.mp4', sources: ['https://a/1'], failureNote: 'x', onClose }));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    window.removeEventListener('keydown', outer);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('bấm nút đóng hoặc bấm ra ngoài thì đóng; bấm vào trong hộp thì không', () => {
    const onClose = jest.fn();
    render(createElement(VideoPreview, { fileName: 'clip.mp4', sources: ['https://a/1'], failureNote: 'x', onClose }));
    act(() => {
      previewVideo()?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      (dialog()?.querySelector('button[aria-label="Đóng xem trước"]') as HTMLButtonElement).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => {
      dialog()?.parentElement?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('gỡ bộ nghe phím khi đóng', () => {
    const onClose = jest.fn();
    render(createElement(VideoPreview, { fileName: 'clip.mp4', sources: ['https://a/1'], failureNote: 'x', onClose }));
    act(() => root.render(createElement(Fragment)));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('ô video trong ô soạn: xem trước', () => {
  const tile = (props: Partial<React.ComponentProps<typeof ComposerVideoTile>> = {}) =>
    createElement(ComposerVideoTile, {
      fileName: 'clip.mp4',
      status: 'done',
      attachment: ready(),
      previewUrl: 'blob:local',
      onRemove: jest.fn(),
      ...props,
    });
  const thumbButton = () => container.querySelector('button[aria-label="Xem trước video clip.mp4"]') as HTMLButtonElement | null;

  it('đã tải xong và sẵn sàng: bấm hình mở xem trước bằng bản đã xử lý', () => {
    render(tile());
    expect(container.textContent).toContain('Bấm vào hình để xem trước.');
    act(() => thumbButton()?.click());
    expect(previewVideo()?.getAttribute('src')).toBe('https://files.test/video.mp4?sig=1');
    act(() => {
      (dialog()?.querySelector('button[aria-label="Đóng xem trước"]') as HTMLButtonElement).click();
    });
    expect(dialog()).toBeNull();
  });

  it('đang tải lên hoặc đang xử lý: vẫn xem trước được bằng tệp vừa chọn', () => {
    render(tile({ status: 'uploading', progress: 0.3, attachment: undefined }));
    act(() => thumbButton()?.click());
    expect(previewVideo()?.getAttribute('src')).toBe('blob:local');
  });

  it('đang xử lý mà trình duyệt không phát được tệp gốc thì báo rõ, người dùng vẫn đăng được', () => {
    render(tile({ attachment: ready({ processingStatus: 'processing', url: undefined }) }));
    act(() => thumbButton()?.click());
    act(() => {
      previewVideo()?.dispatchEvent(new Event('error'));
    });
    expect(dialog()?.textContent).toContain(PREVIEW_PENDING_NOTE);
  });

  it('video lỗi xử lý hoặc không có nguồn nào thì không có nút xem trước', () => {
    render(tile({ attachment: ready({ processingStatus: 'failed' }) }));
    expect(thumbButton()).toBeNull();
    render(tile({ previewUrl: undefined, attachment: ready({ processingStatus: 'queued', url: undefined }) }));
    expect(thumbButton()).toBeNull();
  });
});
