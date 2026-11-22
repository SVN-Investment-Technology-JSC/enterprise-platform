import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import {
  ObjectNotFoundError,
  ObjectRangeNotSatisfiableError,
  ObjectTooLargeError,
  S3ObjectStorage,
} from './adapter-storage.js';

const MIB = 1024 * 1024;

describe('S3ObjectStorage – luồng cho chế độ chuyển tiếp', () => {
  const storage = new S3ObjectStorage({
    bucket: 'b',
    endpoint: 'http://nas.local:9000',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
  });
  let sent: { input: Record<string, unknown> }[];
  let respond: (command: unknown) => unknown;

  beforeEach(() => {
    sent = [];
    respond = () => ({});
    jest.spyOn(S3Client.prototype, 'send').mockImplementation((async (command: { input: Record<string, unknown> }) => {
      sent.push(command);
      return respond(command);
    }) as never);
  });
  afterEach(() => jest.restoreAllMocks());

  /** Luồng `total` byte, chia khúc `chunk` byte như thân yêu cầu của trình duyệt. */
  function body(total: number, chunk = 64 * 1024): Readable {
    const parts: Buffer[] = [];
    for (let offset = 0; offset < total; offset += chunk) parts.push(Buffer.alloc(Math.min(chunk, total - offset), offset % 251));
    return Readable.from(parts);
  }

  describe('uploadStream', () => {
    it('tệp nhỏ: một PutObject với thân đã gom (ký được qua http), kèm kiểu tệp', async () => {
      await expect(storage.uploadStream('k', body(300 * 1024), 'application/pdf')).resolves.toEqual({ sizeBytes: 300 * 1024 });
      expect(sent).toHaveLength(1);
      expect(sent[0]).toBeInstanceOf(PutObjectCommand);
      expect(sent[0]!.input).toMatchObject({ Bucket: 'b', Key: 'k', ContentType: 'application/pdf' });
      expect((sent[0]!.input.Body as Buffer).length).toBe(300 * 1024);
    });

    it('tệp lớn: tải nhiều phần, mỗi phần ít nhất 8 MiB trừ phần cuối, rồi ghép', async () => {
      respond = (command) => {
        if (command instanceof CreateMultipartUploadCommand) return { UploadId: 'u1' };
        if (command instanceof UploadPartCommand) return { ETag: `"e${(command.input as { PartNumber: number }).PartNumber}"` };
        return {};
      };
      const total = 20 * MIB + 5;
      await expect(storage.uploadStream('k', body(total), 'video/mp4')).resolves.toEqual({ sizeBytes: total });
      const parts = sent.filter((command) => command instanceof UploadPartCommand).map((command) => command.input);
      expect(parts.map((part) => part.PartNumber)).toEqual([1, 2, 3]);
      expect((parts[0]!.Body as Buffer).length).toBeGreaterThanOrEqual(8 * MIB);
      expect(parts.reduce((sum, part) => sum + (part.Body as Buffer).length, 0)).toBe(total);
      const complete = sent.find((command) => command instanceof CompleteMultipartUploadCommand)!;
      expect(complete.input).toMatchObject({
        UploadId: 'u1',
        MultipartUpload: { Parts: [{ PartNumber: 1, ETag: '"e1"' }, { PartNumber: 2, ETag: '"e2"' }, { PartNumber: 3, ETag: '"e3"' }] },
      });
    });

    it('vượt maxBytes thì dừng, huỷ phần đã lên', async () => {
      respond = (command) => {
        if (command instanceof CreateMultipartUploadCommand) return { UploadId: 'u2' };
        if (command instanceof UploadPartCommand) return { ETag: '"e"' };
        return {};
      };
      await expect(storage.uploadStream('k', body(12 * MIB), 'application/zip', { maxBytes: 10 * MIB })).rejects.toBeInstanceOf(
        ObjectTooLargeError,
      );
      expect(sent.some((command) => command instanceof AbortMultipartUploadCommand)).toBe(true);
      expect(sent.some((command) => command instanceof CompleteMultipartUploadCommand)).toBe(false);
    });

    it('tệp nhỏ vượt maxBytes thì không ghi gì', async () => {
      await expect(storage.uploadStream('k', body(2000), 'text/plain', { maxBytes: 1000 })).rejects.toBeInstanceOf(ObjectTooLargeError);
      expect(sent).toHaveLength(0);
    });
  });

  describe('openStream', () => {
    it('chuyển Range cho kho, trả luồng cùng các header cần chuyển tiếp', async () => {
      const stream = Readable.from([Buffer.from('abc')]);
      respond = () => ({ Body: stream, ContentType: 'application/pdf', ContentLength: 3, ContentRange: 'bytes 0-2/10', ETag: '"x"' });
      const object = await storage.openStream('k', { range: 'bytes=0-2' });
      expect(sent[0]).toBeInstanceOf(GetObjectCommand);
      expect(sent[0]!.input).toMatchObject({ Key: 'k', Range: 'bytes=0-2' });
      expect(object).toMatchObject({ body: stream, contentType: 'application/pdf', contentLength: 3, contentRange: 'bytes 0-2/10', etag: '"x"' });
    });

    it('không có khoá thì ObjectNotFoundError, đoạn ngoài độ dài thì ObjectRangeNotSatisfiableError', async () => {
      respond = () => {
        throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      };
      await expect(storage.openStream('k')).rejects.toBeInstanceOf(ObjectNotFoundError);
      respond = () => {
        throw Object.assign(new Error('range'), { name: 'InvalidRange', $metadata: { httpStatusCode: 416 } });
      };
      await expect(storage.openStream('k', { range: 'bytes=99-' })).rejects.toBeInstanceOf(ObjectRangeNotSatisfiableError);
    });
  });
});
