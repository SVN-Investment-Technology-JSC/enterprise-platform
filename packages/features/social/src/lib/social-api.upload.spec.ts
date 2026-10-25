import type { SocialAttachment } from '@enterprise-platform/contracts-social';

import { uploadAttachment } from './social-api';

const mockUpload = jest.fn(async () => ({ id: 'a' }) as SocialAttachment);
const mockReadImageSize = jest.fn();

jest.mock('@enterprise-platform/shared-ui', () => ({ authFetch: jest.fn() }));
jest.mock('./attachment-upload', () => ({ uploadAttachmentWithProgress: (...args: unknown[]) => mockUpload(...(args as [])) }));
jest.mock('./image-size', () => ({ readImageSize: (...args: unknown[]) => mockReadImageSize(...args) }));

const fileOf = (type: string) => new File(['x'], 'f', { type });
const lastOptions = () =>
  (mockUpload.mock.calls.at(-1) as unknown as [File, string, { dimensions?: unknown }])[2];

beforeEach(() => {
  mockUpload.mockClear();
  mockReadImageSize.mockReset();
});

describe('uploadAttachment: kích thước ảnh', () => {
  it('ảnh chưa có kích thước thì tự đọc và truyền xuống (không chờ ở đây)', async () => {
    const pending = Promise.resolve({ width: 4, height: 3 });
    mockReadImageSize.mockReturnValue(pending);
    await uploadAttachment(fileOf('image/png'), 'post');
    expect(mockReadImageSize).toHaveBeenCalledTimes(1);
    expect(lastOptions().dimensions).toBe(pending);
  });

  it('có sẵn kích thước thì không đọc lại', async () => {
    await uploadAttachment(fileOf('image/png'), 'post', { dimensions: { width: 1, height: 2 } });
    expect(mockReadImageSize).not.toHaveBeenCalled();
    expect(lastOptions().dimensions).toEqual({ width: 1, height: 2 });
  });

  it('video và tài liệu không đọc kích thước ảnh', async () => {
    await uploadAttachment(fileOf('video/mp4'), 'post');
    await uploadAttachment(fileOf('application/pdf'), 'comment');
    expect(mockReadImageSize).not.toHaveBeenCalled();
    expect(lastOptions().dimensions).toBeUndefined();
  });
});
