import { CopyObjectCommand, DeleteObjectsCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  ObjectNotFoundError,
  ObjectTooLargeError,
  S3ObjectStorage,
  type ObjectStoragePort,
} from './adapter-storage.js';

describe('object storage port', () => {
  it('allows an S3-compatible implementation', async () => {
    const storage: ObjectStoragePort = {
      createUploadUrl: async ({ key }) => `https://storage.local/${key}`,
      createDownloadUrl: async (key) => `https://storage.local/${key}`,
      putObject: async () => undefined,
    };
    await expect(
      storage.createUploadUrl({
        key: 'tenant/file.pdf',
        contentType: 'application/pdf',
      }),
    ).resolves.toContain('file.pdf');
  });
});

describe('S3ObjectStorage – sao chép và xoá theo lô', () => {
  const storage = new S3ObjectStorage({
    bucket: 'tenant-files',
    endpoint: 'http://minio.local:9000',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
  });
  const sent: unknown[] = [];
  let respond: (command: unknown) => unknown;

  beforeEach(() => {
    sent.length = 0;
    respond = () => ({});
    jest.spyOn(S3Client.prototype, 'send').mockImplementation((async (command: unknown) => {
      sent.push(command);
      return respond(command);
    }) as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('sao chép ngay trong kho, mã hoá từng đoạn của khoá nguồn nhưng giữ dấu "/"', async () => {
    await storage.copyObject({
      from: 'tenants/t1/shared/abc/v1-HĐ 01.pdf',
      to: 'tenants/t1/shared/def/v1-HĐ 01.pdf',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBeInstanceOf(CopyObjectCommand);
    expect((sent[0] as CopyObjectCommand).input).toEqual({
      Bucket: 'tenant-files',
      Key: 'tenants/t1/shared/def/v1-HĐ 01.pdf',
      CopySource: 'tenant-files/tenants/t1/shared/abc/v1-H%C4%90%2001.pdf',
    });
  });

  it('xoá theo lô tối đa 1000 khoá và gom khoá kho từ chối', async () => {
    const keys = Array.from({ length: 2500 }, (_, index) => `tenants/t1/shared/${index}/file.pdf`);
    respond = (command) =>
      (command as DeleteObjectsCommand).input.Delete?.Objects?.some((object) => object.Key === keys[1500])
        ? { Errors: [{ Key: keys[1500], Code: 'AccessDenied' }, { Code: 'InternalError' }] }
        : {};

    await expect(storage.deleteObjects(keys)).resolves.toEqual({ failed: [keys[1500]] });

    expect(sent).toHaveLength(3);
    const batches = sent.map((command) => (command as DeleteObjectsCommand).input);
    expect(batches.map((input) => input.Delete?.Objects?.length)).toEqual([1000, 1000, 500]);
    expect(batches.every((input) => input.Bucket === 'tenant-files' && input.Delete?.Quiet === true)).toBe(true);
  });

  it('không gọi kho khi không có khoá nào để xoá', async () => {
    await expect(storage.deleteObjects([])).resolves.toEqual({ failed: [] });
    expect(sent).toEqual([]);
  });
});

describe('S3ObjectStorage – đọc object phía máy chủ', () => {
  const storage = new S3ObjectStorage({
    bucket: 'brand-assets',
    endpoint: 'http://minio.local:9000',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
  });
  const sent: unknown[] = [];
  let respond: (command: unknown) => unknown;

  const objectResult = (text: string, extra: Record<string, unknown> = {}) => ({
    ContentLength: Buffer.byteLength(text),
    ContentType: 'image/svg+xml',
    Body: { transformToByteArray: async () => new Uint8Array(Buffer.from(text)), destroy: jest.fn() },
    ...extra,
  });

  beforeEach(() => {
    sent.length = 0;
    respond = () => ({});
    jest.spyOn(S3Client.prototype, 'send').mockImplementation((async (command: unknown) => {
      sent.push(command);
      return respond(command);
    }) as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('đọc đúng bucket và khoá, trả về nội dung, kiểu và cỡ', async () => {
    respond = () => objectResult('<svg />');
    const content = await storage.getObject('platform/brand/icons/a/v1/icon.svg');
    expect(sent[0]).toBeInstanceOf(GetObjectCommand);
    expect((sent[0] as GetObjectCommand).input).toEqual({
      Bucket: 'brand-assets',
      Key: 'platform/brand/icons/a/v1/icon.svg',
    });
    expect(Buffer.from(content.body).toString()).toBe('<svg />');
    expect(content).toMatchObject({ contentType: 'image/svg+xml', sizeBytes: 7 });
  });

  it('ném ObjectNotFoundError khi khoá không có trong kho', async () => {
    respond = () => {
      throw Object.assign(new Error('missing'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
    };
    await expect(storage.getObject('platform/brand/none')).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it('từ chối object lớn hơn maxBytes mà không tải thân', async () => {
    const result = objectResult('x'.repeat(100));
    respond = () => result;
    await expect(storage.getObject('platform/brand/big', { maxBytes: 10 })).rejects.toBeInstanceOf(ObjectTooLargeError);
    expect(result.Body.destroy).toHaveBeenCalled();
  });

  it('chuyển tiếp lỗi khác của kho nguyên vẹn', async () => {
    respond = () => {
      throw Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
    };
    await expect(storage.getObject('platform/brand/x')).rejects.toMatchObject({ name: 'AccessDenied' });
  });
});
