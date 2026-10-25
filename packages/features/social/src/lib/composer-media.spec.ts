import type { SocialAttachment } from '@enterprise-platform/contracts-social';
import {
  buildGalleryItems,
  buildMediaPayload,
  canMoveItem,
  countLayoutMedia,
  moveItem,
  orderedAttachmentIds,
  type ComposerMediaFile,
} from './composer-media';

const attachment = (id: string, overrides: Partial<SocialAttachment> = {}): SocialAttachment => ({
  id,
  fileName: `${id}.bin`,
  contentType: 'application/octet-stream',
  sizeBytes: 10,
  isImage: false,
  ...overrides,
});

const image = (key: string, overrides: Partial<ComposerMediaFile> = {}): ComposerMediaFile => ({
  key,
  fileName: `${key}.png`,
  isImage: true,
  status: 'done',
  attachment: attachment(key, { isImage: true, url: `https://files.test/${key}.png` }),
  ...overrides,
});

const video = (key: string, overrides: Partial<ComposerMediaFile> = {}): ComposerMediaFile => ({
  key,
  fileName: `${key}.mp4`,
  isImage: false,
  isVideo: true,
  status: 'done',
  attachment: attachment(key, { isVideo: true, processingStatus: 'ready' }),
  ...overrides,
});

const doc = (key: string, overrides: Partial<ComposerMediaFile> = {}): ComposerMediaFile => ({
  key,
  fileName: `${key}.pdf`,
  isImage: false,
  status: 'done',
  attachment: attachment(key),
  ...overrides,
});

describe('orderedAttachmentIds', () => {
  it('ảnh và video theo thứ tự đang sắp, tài liệu đứng cuối', () => {
    const list = [doc('d1'), video('v1'), image('i1'), doc('d2'), image('i2')];
    expect(orderedAttachmentIds(list)).toEqual(['v1', 'i1', 'i2', 'd1', 'd2']);
  });

  it('bỏ tệp đang tải, tệp lỗi và video xử lý lỗi; giữ video đang xử lý', () => {
    const list = [
      image('i1', { status: 'uploading', attachment: undefined }),
      image('i2'),
      video('v1', { attachment: attachment('v1', { isVideo: true, processingStatus: 'failed' }) }),
      video('v2', { attachment: attachment('v2', { isVideo: true, processingStatus: 'processing' }) }),
      doc('d1', { status: 'error', attachment: undefined }),
      video('v3', { status: 'uploading', attachment: undefined }),
    ];
    expect(orderedAttachmentIds(list)).toEqual(['i2', 'v2']);
  });

  it('danh sách rỗng cho mảng rỗng', () => {
    expect(orderedAttachmentIds([])).toEqual([]);
  });
});

describe('buildMediaPayload', () => {
  it('gửi thứ tự đã đổi cùng bố cục, mặc định auto', () => {
    const list = moveItem([image('i1'), video('v1'), doc('d1')], 'v1', 'earlier');
    expect(buildMediaPayload(list, 'featured')).toEqual({ attachmentIds: ['v1', 'i1', 'd1'], mediaLayout: 'featured' });
    expect(buildMediaPayload(list, undefined).mediaLayout).toBe('auto');
  });
});

describe('moveItem / canMoveItem', () => {
  const list = [image('a'), doc('d'), video('b'), image('c')];

  it('đổi chỗ với mục media kề, bỏ qua tài liệu ở giữa', () => {
    expect(moveItem(list, 'b', 'earlier').map((item) => item.key)).toEqual(['b', 'd', 'a', 'c']);
    expect(moveItem(list, 'a', 'later').map((item) => item.key)).toEqual(['b', 'd', 'a', 'c']);
    expect(moveItem(list, 'b', 'later').map((item) => item.key)).toEqual(['a', 'd', 'c', 'b']);
  });

  it('không vượt biên: trả đúng danh sách cũ', () => {
    expect(moveItem(list, 'a', 'earlier')).toBe(list);
    expect(moveItem(list, 'c', 'later')).toBe(list);
    expect(canMoveItem(list, 'a', 'earlier')).toBe(false);
    expect(canMoveItem(list, 'a', 'later')).toBe(true);
  });

  it('tài liệu và khoá lạ không di chuyển', () => {
    expect(moveItem(list, 'd', 'later')).toBe(list);
    expect(moveItem(list, 'zzz', 'later')).toBe(list);
  });

  it('không sửa danh sách gốc', () => {
    const copy = [...list];
    moveItem(list, 'b', 'earlier');
    expect(list).toEqual(copy);
  });
});

describe('countLayoutMedia', () => {
  it('chỉ đếm ảnh và video còn hiện, không tính tài liệu, tệp lỗi, video xử lý lỗi', () => {
    const list = [
      image('i1'),
      video('v1'),
      doc('d1'),
      image('i2', { status: 'error', attachment: undefined }),
      video('v2', { attachment: attachment('v2', { isVideo: true, processingStatus: 'failed' }) }),
      image('i3', { status: 'uploading', attachment: undefined }),
    ];
    expect(countLayoutMedia(list)).toBe(3);
  });
});

describe('buildGalleryItems', () => {
  it('ảnh đã tải xong dùng URL của máy chủ; đang tải dùng URL tạm', () => {
    const items = buildGalleryItems([
      image('i1'),
      image('i2', { status: 'uploading', attachment: undefined, objectUrl: 'blob:local-2' }),
    ]);
    expect(items[0]).toMatchObject({ key: 'i1', kind: 'image', alt: 'i1.png', url: 'https://files.test/i1.png' });
    expect(items[1]).toMatchObject({ key: 'i2', kind: 'image', url: 'blob:local-2' });
    expect(items[1].processingStatus).toBeUndefined();
  });

  it('ảnh vừa tải xong mà server chưa trả URL thì vẫn dùng URL tạm', () => {
    const [item] = buildGalleryItems([
      image('i1', { attachment: attachment('i1', { isImage: true }), objectUrl: 'blob:local' }),
    ]);
    expect(item.url).toBe('blob:local');
  });

  it('video sẵn sàng: poster và URL phát từ attachment, không có trạng thái xử lý', () => {
    const [item] = buildGalleryItems([
      video('v1', {
        objectUrl: 'blob:local',
        attachment: attachment('v1', {
          isVideo: true,
          processingStatus: 'ready',
          url: 'https://files.test/v1.mp4',
          posterUrl: 'https://files.test/v1.jpg',
          durationMs: 5000,
          width: 1280,
          height: 720,
        }),
      }),
    ]);
    expect(item).toMatchObject({
      kind: 'video',
      url: 'https://files.test/v1.mp4',
      posterUrl: 'https://files.test/v1.jpg',
      durationMs: 5000,
      width: 1280,
      height: 720,
    });
    expect(item.processingStatus).toBeUndefined();
  });

  it('video đang xử lý: khung đầu từ URL tạm cùng trạng thái', () => {
    const [item] = buildGalleryItems([
      video('v1', {
        objectUrl: 'blob:local',
        attachment: attachment('v1', { isVideo: true, processingStatus: 'queued', url: 'https://files.test/raw.mp4' }),
      }),
    ]);
    expect(item).toMatchObject({ url: 'blob:local', processingStatus: 'queued' });
    expect(item.posterUrl).toBeUndefined();
  });

  it('video đang tải lên hiện như đang xử lý, dùng URL tạm', () => {
    const [item] = buildGalleryItems([
      video('v1', { status: 'uploading', attachment: undefined, objectUrl: 'blob:local' }),
    ]);
    expect(item).toMatchObject({ kind: 'video', url: 'blob:local', processingStatus: 'processing' });
  });

  it('video của bài đang sửa dùng attachment có sẵn khi không có URL tạm', () => {
    const [item] = buildGalleryItems([
      video('v1', { attachment: attachment('v1', { isVideo: true, url: 'https://files.test/v1.mp4' }) }),
    ]);
    expect(item.url).toBe('https://files.test/v1.mp4');
  });

  it('bỏ tài liệu, tệp lỗi và video xử lý lỗi; giữ thứ tự', () => {
    const items = buildGalleryItems([
      video('v1'),
      doc('d1'),
      image('i1', { status: 'error', attachment: undefined }),
      video('v2', { attachment: attachment('v2', { isVideo: true, processingStatus: 'failed', processingError: 'x' }) }),
      image('i2'),
    ]);
    expect(items.map((item) => item.key)).toEqual(['v1', 'i2']);
  });
});
