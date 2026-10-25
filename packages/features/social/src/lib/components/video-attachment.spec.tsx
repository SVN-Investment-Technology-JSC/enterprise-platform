/**
 * @jest-environment jsdom
 */
/// <reference lib="dom" />
import type { SocialAttachment } from '@enterprise-platform/contracts-social';
import { act, createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  formatVideoDuration,
  VIDEO_EXPIRED_MESSAGE,
  videoAspectRatio,
  videoPreload,
  VideoAttachment,
} from './video-attachment';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const attachment = (overrides: Partial<SocialAttachment> = {}): SocialAttachment => ({
  id: 'a1',
  fileName: 'clip.mp4',
  contentType: 'video/mp4',
  sizeBytes: 1000,
  isImage: false,
  isVideo: true,
  processingStatus: 'ready',
  url: 'https://files.test/clip.mp4?sig=1',
  ...overrides,
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // jsdom chưa cài đặt trình phát: mô phỏng trạng thái paused qua pause()/play().
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get: () => true });
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

const videos = () => Array.from(container.querySelectorAll('video'));

describe('hàm thuần của VideoAttachment', () => {
  it('tính aspect-ratio từ width/height, thiếu thì bỏ qua', () => {
    expect(videoAspectRatio(1280, 720)).toBe('1280 / 720');
    expect(videoAspectRatio(undefined, 720)).toBeUndefined();
    expect(videoAspectRatio(0, 0)).toBeUndefined();
  });

  it('chọn preload theo poster', () => {
    expect(videoPreload('https://p/poster.jpg')).toBe('none');
    expect(videoPreload(undefined)).toBe('metadata');
  });

  it('định dạng thời lượng', () => {
    expect(formatVideoDuration(undefined)).toBeUndefined();
    expect(formatVideoDuration(65_000)).toBe('1:05');
    expect(formatVideoDuration(3_725_000)).toBe('1:02:05');
  });
});

describe('VideoAttachment', () => {
  it('không tự phát, có controls, playsInline, preload none khi có poster', () => {
    render(<VideoAttachment attachment={attachment({ posterUrl: 'https://p/poster.jpg' })} />);
    const [video] = videos();
    expect(video.autoplay).toBe(false);
    expect(video.controls).toBe(true);
    expect(video.getAttribute('playsinline')).not.toBeNull();
    expect(video.getAttribute('preload')).toBe('none');
    expect(video.getAttribute('poster')).toBe('https://p/poster.jpg');
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('video cũ không poster dùng preload metadata', () => {
    render(<VideoAttachment attachment={attachment({ processingStatus: undefined })} />);
    expect(videos()[0].getAttribute('preload')).toBe('metadata');
  });

  it('giữ tỉ lệ khung hình từ width/height và hiện thời lượng', () => {
    render(<VideoAttachment attachment={attachment({ width: 1280, height: 720, durationMs: 65_000 })} />);
    expect(videos()[0].style.aspectRatio).toBe('1280 / 720');
    expect(container.textContent).toContain('1:05');
  });

  it('không có url thì hiện khung giữ chỗ, không có thẻ video', () => {
    render(<VideoAttachment attachment={attachment({ url: undefined })} />);
    expect(videos()).toHaveLength(0);
    expect(container.textContent).toContain('Video chưa sẵn sàng');
  });

  it('chỉ có nút Gỡ khi có onRemove', () => {
    render(<VideoAttachment attachment={attachment()} />);
    expect(container.querySelector('button')).toBeNull();
    const onRemove = jest.fn();
    render(<VideoAttachment attachment={attachment()} onRemove={onRemove} />);
    act(() => container.querySelector('button')?.click());
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('chỉ một video phát cùng lúc', () => {
    render(
      <VideoAttachment attachment={attachment({ id: 'a' })} />,
      <VideoAttachment attachment={attachment({ id: 'b', url: 'https://files.test/b.mp4' })} />,
    );
    const [first, second] = videos();
    const pauseFirst = jest.fn();
    const pauseSecond = jest.fn();
    Object.defineProperty(first, 'paused', { configurable: true, value: false });
    first.pause = pauseFirst;
    second.pause = pauseSecond;
    act(() => {
      second.dispatchEvent(new Event('play'));
    });
    expect(pauseFirst).toHaveBeenCalledTimes(1);
    expect(pauseSecond).not.toHaveBeenCalled();
  });

  it('gỡ bộ nghe khi unmount', () => {
    const remove = jest.spyOn(document, 'removeEventListener');
    render(<VideoAttachment attachment={attachment()} />);
    act(() => root.render(null));
    expect(remove).toHaveBeenCalledWith('play', expect.any(Function), true);
    remove.mockRestore();
  });

  it('URL hết hạn sau khi đã phát: làm mới đúng một lần rồi báo hết hạn', () => {
    const onRequestRefresh = jest.fn();
    render(<VideoAttachment attachment={attachment()} onRequestRefresh={onRequestRefresh} />);
    const [video] = videos();
    act(() => {
      video.dispatchEvent(new Event('play'));
    });
    act(() => {
      video.dispatchEvent(new Event('error'));
    });
    expect(onRequestRefresh).toHaveBeenCalledTimes(1);
    act(() => {
      video.dispatchEvent(new Event('error'));
    });
    expect(onRequestRefresh).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(VIDEO_EXPIRED_MESSAGE);
  });

  it('lỗi trước khi phát không làm mới URL', () => {
    const onRequestRefresh = jest.fn();
    render(<VideoAttachment attachment={attachment()} onRequestRefresh={onRequestRefresh} />);
    act(() => {
      videos()[0].dispatchEvent(new Event('error'));
    });
    expect(onRequestRefresh).not.toHaveBeenCalled();
  });

  it('không có onRequestRefresh thì hiện thông báo hết hạn', () => {
    render(<VideoAttachment attachment={attachment()} />);
    const [video] = videos();
    act(() => {
      video.dispatchEvent(new Event('play'));
    });
    act(() => {
      video.dispatchEvent(new Event('error'));
    });
    expect(container.textContent).toContain(VIDEO_EXPIRED_MESSAGE);
  });

  it('sau khi có URL mới thì phát tiếp tại vị trí cũ', () => {
    const onRequestRefresh = jest.fn();
    const first = attachment();
    render(<VideoAttachment attachment={first} onRequestRefresh={onRequestRefresh} />);
    const [video] = videos();
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 42 });
    act(() => {
      video.dispatchEvent(new Event('play'));
    });
    act(() => {
      video.dispatchEvent(new Event('error'));
    });
    render(<VideoAttachment attachment={attachment({ url: 'https://files.test/clip.mp4?sig=2' })} onRequestRefresh={onRequestRefresh} />);
    const [next] = videos();
    act(() => {
      next.dispatchEvent(new Event('loadedmetadata'));
    });
    expect(next.currentTime).toBe(42);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });
});

describe('VideoAttachment: khung giữ chỗ theo trạng thái xử lý', () => {
  const placeholder = () => container.querySelector('[data-state], [role="img"]');

  it.each(['queued', 'processing'] as const)('%s: hiện khung đang xử lý, có nhãn aria, không có thẻ video', (status) => {
    render(<VideoAttachment attachment={attachment({ url: undefined, processingStatus: status })} />);
    expect(videos()).toHaveLength(0);
    expect(container.textContent).toContain('Video đang được xử lý, sẽ xem được sau ít phút.');
    const box = container.querySelector('[role="status"]');
    expect(box?.getAttribute('aria-label')).toBe('Video đang được xử lý, sẽ xem được sau ít phút.');
    expect(box?.getAttribute('data-state')).toBe('processing');
  });

  it('failed: báo không xử lý được, kèm processingError nếu có', () => {
    render(<VideoAttachment attachment={attachment({ url: undefined, processingStatus: 'failed' })} />);
    expect(container.textContent).toContain('Không xử lý được video này.');
    expect(container.textContent).not.toContain('codec');
    render(
      <VideoAttachment
        attachment={attachment({ url: undefined, processingStatus: 'failed', processingError: 'Lỗi codec không hỗ trợ' })}
      />,
    );
    expect(container.textContent).toContain('Lỗi codec không hỗ trợ');
    expect(placeholder()?.getAttribute('data-state')).toBe('failed');
  });

  it('không có trạng thái nào: giữ khung "Video chưa sẵn sàng" như cũ', () => {
    render(<VideoAttachment attachment={attachment({ url: undefined, processingStatus: undefined })} />);
    expect(container.textContent).toContain('Video chưa sẵn sàng');
  });
});

describe('VideoAttachment: tự làm mới khi video đang xử lý', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const advance = async (ms: number) => {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ms);
    });
  };

  it('gọi onRequestRefresh định kỳ (silent) khi queued hoặc processing và chưa có url', async () => {
    const onRequestRefresh = jest.fn();
    render(
      <VideoAttachment attachment={attachment({ url: undefined, processingStatus: 'queued' })} onRequestRefresh={onRequestRefresh} />,
    );
    await advance(8000);
    expect(onRequestRefresh).toHaveBeenCalledTimes(1);
    expect(onRequestRefresh).toHaveBeenCalledWith({ silent: true });
    await advance(12_000);
    expect(onRequestRefresh).toHaveBeenCalledTimes(2);
  });

  it('không làm mới khi video đã sẵn sàng, đã lỗi, hoặc không có onRequestRefresh', async () => {
    const onRequestRefresh = jest.fn();
    render(<VideoAttachment attachment={attachment()} onRequestRefresh={onRequestRefresh} />);
    await advance(120_000);
    render(
      <VideoAttachment attachment={attachment({ url: undefined, processingStatus: 'failed' })} onRequestRefresh={onRequestRefresh} />,
    );
    await advance(120_000);
    render(<VideoAttachment attachment={attachment({ url: undefined, processingStatus: 'processing' })} />);
    await advance(120_000);
    expect(onRequestRefresh).not.toHaveBeenCalled();
  });

  it('dừng khi cha cập nhật video thành ready và khi unmount', async () => {
    const onRequestRefresh = jest.fn();
    render(
      <VideoAttachment attachment={attachment({ url: undefined, processingStatus: 'processing' })} onRequestRefresh={onRequestRefresh} />,
    );
    await advance(8000);
    expect(onRequestRefresh).toHaveBeenCalledTimes(1);
    render(<VideoAttachment attachment={attachment()} onRequestRefresh={onRequestRefresh} />);
    await advance(120_000);
    expect(onRequestRefresh).toHaveBeenCalledTimes(1);
    expect(videos()).toHaveLength(1);

    render(
      <VideoAttachment attachment={attachment({ url: undefined, processingStatus: 'processing' })} onRequestRefresh={onRequestRefresh} />,
    );
    act(() => root.render(null));
    await advance(120_000);
    expect(onRequestRefresh).toHaveBeenCalledTimes(1);
  });
});
