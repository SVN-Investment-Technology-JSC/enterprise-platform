import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  ListMultipartUploadsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { ObjectNotFoundError, ObjectTooLargeError, S3ObjectStorage } from './adapter-storage.js';

const MIB = 1024 * 1024;

type SendOptions = { abortSignal?: AbortSignal };

describe('S3ObjectStorage – truyền tệp lớn qua đĩa', () => {
  const storage = new S3ObjectStorage({
    bucket: 'b',
    endpoint: 'http://minio.local:9000',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
  });
  let dir: string;
  let sent: unknown[];
  let respond: (command: unknown, options: SendOptions) => unknown | Promise<unknown>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'storage-files-'));
    sent = [];
    respond = () => ({});
    jest.spyOn(S3Client.prototype, 'send').mockImplementation((async (command: unknown, options: SendOptions) => {
      sent.push(command);
      return respond(command, options);
    }) as never);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  const exists = (path: string) => stat(path).then(() => true, () => false);

  describe('downloadToFile', () => {
    it('ghi thân phản hồi xuống đĩa và trả số byte', async () => {
      respond = () => ({ Body: Readable.from([Buffer.from('xin '), Buffer.from('chào')]), ContentLength: 9 });
      const target = join(dir, 'out.bin');
      await expect(storage.downloadToFile('k', target)).resolves.toEqual({ sizeBytes: 9 });
      expect(await readFile(target, 'utf8')).toBe('xin chào');
      expect(sent[0]).toBeInstanceOf(GetObjectCommand);
    });

    it('từ chối sớm theo ContentLength và không tạo tệp', async () => {
      const body = Readable.from([Buffer.alloc(10)]);
      respond = () => ({ Body: body, ContentLength: 10 });
      const target = join(dir, 'out.bin');
      await expect(storage.downloadToFile('k', target, { maxBytes: 5 })).rejects.toBeInstanceOf(ObjectTooLargeError);
      expect(await exists(target)).toBe(false);
      expect(body.destroyed).toBe(true);
    });

    it('chặn theo số byte thực nhận khi ContentLength khai sai, và xoá tệp dở', async () => {
      respond = () => ({
        Body: Readable.from([Buffer.alloc(4), Buffer.alloc(4), Buffer.alloc(4)]),
        ContentLength: 1,
      });
      const target = join(dir, 'out.bin');
      await expect(storage.downloadToFile('k', target, { maxBytes: 6 })).rejects.toBeInstanceOf(ObjectTooLargeError);
      expect(await exists(target)).toBe(false);
    });

    it('xoá tệp dở khi luồng lỗi giữa chừng', async () => {
      async function* broken() {
        yield Buffer.from('một phần');
        throw new Error('mất kết nối');
      }
      respond = () => ({ Body: Readable.from(broken()), ContentLength: 100 });
      const target = join(dir, 'out.bin');
      await expect(storage.downloadToFile('k', target)).rejects.toThrow('mất kết nối');
      expect(await exists(target)).toBe(false);
    });

    it('huỷ bằng signal thì dừng và xoá tệp dở', async () => {
      const controller = new AbortController();
      const stalled = new Readable({ read() { /* never ends */ } });
      stalled.push(Buffer.from('abc'));
      respond = () => ({ Body: stalled, ContentLength: 6 });
      const target = join(dir, 'out.bin');
      const pending = storage.downloadToFile('k', target, { signal: controller.signal });
      setTimeout(() => controller.abort(new Error('đã huỷ')), 50);
      await expect(pending).rejects.toBeDefined();
      expect(await exists(target)).toBe(false);
    });

    it('signal đã huỷ từ trước thì không gọi kho', async () => {
      const controller = new AbortController();
      controller.abort(new Error('đã huỷ'));
      await expect(
        storage.downloadToFile('k', join(dir, 'out.bin'), { signal: controller.signal }),
      ).rejects.toBeDefined();
      expect(sent).toHaveLength(0);
    });

    it('ánh xạ NoSuchKey sang ObjectNotFoundError', async () => {
      respond = () => {
        throw Object.assign(new Error('no'), { name: 'NoSuchKey' });
      };
      await expect(storage.downloadToFile('k', join(dir, 'out.bin'))).rejects.toBeInstanceOf(ObjectNotFoundError);
    });
  });

  describe('uploadFromFile', () => {
    it('tệp nhỏ dùng một PutObject', async () => {
      const source = join(dir, 'small.bin');
      await writeFile(source, Buffer.alloc(1024, 7));
      await expect(storage.uploadFromFile('k', source, 'video/mp4')).resolves.toEqual({ sizeBytes: 1024 });
      expect(sent).toHaveLength(1);
      const put = sent[0] as PutObjectCommand;
      expect(put).toBeInstanceOf(PutObjectCommand);
      expect(put.input.ContentType).toBe('video/mp4');
      expect((put.input.Body as Buffer).byteLength).toBe(1024);
    });

    it('tệp lớn chia phần 8 MiB, tối đa 2 phần song song, rồi hoàn tất đúng thứ tự', async () => {
      const source = join(dir, 'big.bin');
      await writeFile(source, Buffer.alloc(8 * MIB * 3 + 5, 1));
      let active = 0;
      let peak = 0;
      const sizes: number[] = [];
      respond = async (command) => {
        if (command instanceof CreateMultipartUploadCommand) return { UploadId: 'u1' };
        if (command instanceof UploadPartCommand) {
          active += 1;
          peak = Math.max(peak, active);
          sizes[(command.input.PartNumber ?? 1) - 1] = command.input.ContentLength ?? 0;
          await new Promise((resolve) => setTimeout(resolve, 10));
          active -= 1;
          return { ETag: `"e${command.input.PartNumber}"` };
        }
        return {};
      };
      await expect(storage.uploadFromFile('k', source, 'video/mp4')).resolves.toEqual({ sizeBytes: 8 * MIB * 3 + 5 });
      expect(sizes).toEqual([8 * MIB, 8 * MIB, 8 * MIB, 5]);
      expect(peak).toBe(2);
      const complete = sent.find((c) => c instanceof CompleteMultipartUploadCommand) as CompleteMultipartUploadCommand;
      expect(complete.input.MultipartUpload?.Parts).toEqual([1, 2, 3, 4].map((n) => ({ PartNumber: n, ETag: `"e${n}"` })));
      expect(sent.some((c) => c instanceof AbortMultipartUploadCommand)).toBe(false);
    });

    it('lỗi một phần thì abort lần tải và ném lỗi gốc', async () => {
      const source = join(dir, 'big.bin');
      await writeFile(source, Buffer.alloc(8 * MIB * 2 + 1, 1));
      respond = (command) => {
        if (command instanceof CreateMultipartUploadCommand) return { UploadId: 'u1' };
        if (command instanceof UploadPartCommand && command.input.PartNumber === 2) throw new Error('phần 2 hỏng');
        if (command instanceof UploadPartCommand) return { ETag: '"e"' };
        return {};
      };
      await expect(storage.uploadFromFile('k', source, 'video/mp4')).rejects.toThrow('phần 2 hỏng');
      const abort = sent.find((c) => c instanceof AbortMultipartUploadCommand) as AbortMultipartUploadCommand;
      expect(abort.input).toMatchObject({ Key: 'k', UploadId: 'u1' });
      expect(sent.some((c) => c instanceof CompleteMultipartUploadCommand)).toBe(false);
    });

    it('huỷ bằng signal giữa chừng thì abort lần tải', async () => {
      const source = join(dir, 'big.bin');
      await writeFile(source, Buffer.alloc(8 * MIB * 2 + 1, 1));
      const controller = new AbortController();
      respond = (command, options) => {
        if (command instanceof CreateMultipartUploadCommand) return { UploadId: 'u1' };
        if (command instanceof UploadPartCommand) {
          return new Promise((_resolve, reject) => {
            options.abortSignal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
            setTimeout(() => controller.abort(new Error('đã huỷ')), 20);
          });
        }
        return {};
      };
      await expect(storage.uploadFromFile('k', source, 'video/mp4', { signal: controller.signal })).rejects.toBeDefined();
      expect(sent.some((c) => c instanceof AbortMultipartUploadCommand)).toBe(true);
      expect(sent.some((c) => c instanceof CompleteMultipartUploadCommand)).toBe(false);
    });

    it('signal đã huỷ từ trước thì không gọi kho', async () => {
      const source = join(dir, 'small.bin');
      await writeFile(source, 'x');
      const controller = new AbortController();
      controller.abort(new Error('đã huỷ'));
      await expect(storage.uploadFromFile('k', source, 'video/mp4', { signal: controller.signal })).rejects.toBeDefined();
      expect(sent).toHaveLength(0);
    });
  });

  describe('abortIncompleteMultipartUploads', () => {
    it('chỉ abort đúng khoá, không abort khoá chung tiền tố, và đi hết các trang', async () => {
      respond = (command) => {
        if (command instanceof ListMultipartUploadsCommand) {
          if (!command.input.KeyMarker) {
            return {
              Uploads: [
                { Key: 'a/b', UploadId: 'u1' },
                { Key: 'a/bc', UploadId: 'u2' },
              ],
              IsTruncated: true,
              NextKeyMarker: 'a/bc',
              NextUploadIdMarker: 'u2',
            };
          }
          return { Uploads: [{ Key: 'a/b', UploadId: 'u3' }], IsTruncated: false };
        }
        return {};
      };
      await expect(storage.abortIncompleteMultipartUploads('a/b')).resolves.toBe(2);
      const aborted = sent
        .filter((c): c is AbortMultipartUploadCommand => c instanceof AbortMultipartUploadCommand)
        .map((c) => `${c.input.Key}:${c.input.UploadId}`);
      expect(aborted).toEqual(['a/b:u1', 'a/b:u3']);
      const lists = sent.filter((c): c is ListMultipartUploadsCommand => c instanceof ListMultipartUploadsCommand);
      expect(lists.map((c) => c.input.Prefix)).toEqual(['a/b', 'a/b']);
      expect(lists[1].input).toMatchObject({ KeyMarker: 'a/bc', UploadIdMarker: 'u2' });
    });

    it('không có lần tải dở thì trả 0', async () => {
      respond = () => ({ Uploads: [], IsTruncated: false });
      await expect(storage.abortIncompleteMultipartUploads('k')).resolves.toBe(0);
    });
  });
});
