import type { SocialAttachment, SocialMultipartPart } from '@enterprise-platform/contracts-social';
import {
  createUploadHttpError,
  createUploadNetworkError,
  isRetryableUploadError,
  isUploadAborted,
  sendMultipart,
  sendSingle,
  uploadAttachmentWithProgress,
  type AttachmentUploadApi,
  type PutBlob,
} from './attachment-upload';

const noSleep = () => Promise.resolve();

const rejection = async (promise: Promise<unknown>) => promise.then(() => undefined, (error: unknown) => error);

function makeFile(size: number, type = 'video/mp4'): File {
  return new File([new Uint8Array(size)], 'clip.mp4', { type });
}

function makeParts(sizes: readonly number[]): SocialMultipartPart[] {
  return sizes.map((sizeBytes, index) => ({ partNumber: index + 1, url: `https://s3/part-${index + 1}`, sizeBytes }));
}

/** PUT giả: báo tiến trình hai nấc rồi thành công, trừ khi `fail` trả lỗi cho lần gọi đó. */
function fakePut(fail?: (url: string, attempt: number) => unknown) {
  const calls: { url: string; size: number; type: string }[] = [];
  const attempts = new Map<string, number>();
  const put: PutBlob = async (url, body, type, options) => {
    const attempt = (attempts.get(url) ?? 0) + 1;
    attempts.set(url, attempt);
    calls.push({ url, size: body.size, type });
    if (options?.signal?.aborted) throw Object.assign(new Error('x'), { uploadKind: 'aborted' });
    options?.onProgress?.(Math.floor(body.size / 2));
    const error = fail?.(url, attempt);
    if (error) throw error;
    options?.onProgress?.(body.size);
  };
  return { put, calls };
}

describe('lỗi tải lên', () => {
  it('chỉ thử lại lỗi mạng, 5xx, 408 và 429', () => {
    expect(isRetryableUploadError(createUploadNetworkError())).toBe(true);
    expect(isRetryableUploadError(createUploadHttpError(503))).toBe(true);
    expect(isRetryableUploadError(createUploadHttpError(429))).toBe(true);
    expect(isRetryableUploadError(createUploadHttpError(408))).toBe(true);
    expect(isRetryableUploadError(createUploadHttpError(403))).toBe(false);
    expect(isRetryableUploadError(new Error('khác'))).toBe(false);
  });
});

describe('sendMultipart', () => {
  it('cắt đúng cỡ từng phần theo thứ tự và đặt Content-Type', async () => {
    const { put, calls } = fakePut();
    const parts = makeParts([8, 8, 3]);
    await sendMultipart(makeFile(19), 'video/mp4', [parts[2], parts[0], parts[1]], { put, sleep: noSleep });
    expect(calls.map((call) => [call.url, call.size, call.type])).toEqual([
      ['https://s3/part-1', 8, 'video/mp4'],
      ['https://s3/part-2', 8, 'video/mp4'],
      ['https://s3/part-3', 3, 'video/mp4'],
    ]);
  });

  it('báo tiến trình tăng đều và kết thúc bằng 1', async () => {
    const { put } = fakePut();
    const seen: number[] = [];
    await sendMultipart(makeFile(20), 'video/mp4', makeParts([8, 8, 4]), {
      put,
      sleep: noSleep,
      onProgress: (value) => seen.push(value),
    });
    expect(seen.length).toBeGreaterThan(2);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    expect(seen[seen.length - 1]).toBe(1);
  });

  it('phần lỗi mạng chỉ gửi lại chính phần đó', async () => {
    const { put, calls } = fakePut((url, attempt) => (url.endsWith('part-2') && attempt < 3 ? createUploadNetworkError() : undefined));
    await sendMultipart(makeFile(16), 'video/mp4', makeParts([8, 8]), { put, sleep: noSleep });
    expect(calls.filter((call) => call.url.endsWith('part-1'))).toHaveLength(1);
    expect(calls.filter((call) => call.url.endsWith('part-2'))).toHaveLength(3);
  });

  it('thử lại tối đa 3 lần rồi ném lỗi, chờ 500ms, 1s, 2s', async () => {
    const { put, calls } = fakePut(() => createUploadHttpError(500));
    const delays: number[] = [];
    await expect(
      sendMultipart(makeFile(8), 'video/mp4', makeParts([8]), {
        put,
        sleep: (ms) => {
          delays.push(ms);
          return Promise.resolve();
        },
      }),
    ).rejects.toMatchObject({ status: 500 });
    expect(calls).toHaveLength(4);
    expect(delays).toEqual([500, 1000, 2000]);
  });

  it('không thử lại khi 4xx', async () => {
    const { put, calls } = fakePut(() => createUploadHttpError(403));
    await expect(sendMultipart(makeFile(8), 'video/mp4', makeParts([8]), { put, sleep: noSleep })).rejects.toMatchObject({
      status: 403,
    });
    expect(calls).toHaveLength(1);
  });

  it('chạy song song tối đa 3 phần', async () => {
    let running = 0;
    let peak = 0;
    const put: PutBlob = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
    };
    await sendMultipart(makeFile(40), 'video/mp4', makeParts([8, 8, 8, 8, 8]), { put, sleep: noSleep });
    expect(peak).toBe(3);
  });

  it('huỷ thì dừng mọi phần và không thử lại', async () => {
    const controller = new AbortController();
    let calls = 0;
    const put: PutBlob = (_url, _body, _type, options) =>
      new Promise((_resolve, reject) => {
        calls += 1;
        options?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('x'), { uploadKind: 'aborted' })));
      });
    const pending = sendMultipart(makeFile(40), 'video/mp4', makeParts([8, 8, 8, 8, 8]), {
      put,
      sleep: noSleep,
      signal: controller.signal,
    });
    controller.abort();
    expect(isUploadAborted(await rejection(pending))).toBe(true);
    expect(calls).toBe(3);
  });

  it('từ chối khi tổng cỡ các phần không khớp tệp', async () => {
    const { put } = fakePut();
    await expect(sendMultipart(makeFile(10), 'video/mp4', makeParts([8]), { put })).rejects.toThrow();
  });
});

describe('sendMultipart: URL từng phần quá cũ', () => {
  it('phần bắt đầu muộn (quá 2 phút) dùng URL mới; phần bắt đầu sớm dùng URL cấp ban đầu', async () => {
    const { put, calls } = fakePut();
    let clock = 0;
    const refreshed: number[] = [];
    // Mỗi lần gọi `put` cho đồng hồ nhảy thêm 3 phút để các phần sau thấy URL đã cũ.
    const slowPut: PutBlob = async (url, body, type, options) => {
      clock += 180_000;
      return put(url, body, type, options);
    };
    await sendMultipart(makeFile(19), 'video/mp4', makeParts([8, 8, 3]), {
      put: slowPut,
      sleep: noSleep,
      now: () => clock,
      refreshPartUrl: async (partNumber) => {
        refreshed.push(partNumber);
        return `https://s3/fresh-${partNumber}`;
      },
    });
    expect(calls).toHaveLength(3);
    expect(refreshed.length).toBeGreaterThan(0);
    expect(calls[0]?.url).toBe('https://s3/part-1');
    expect(calls.slice(1).every((call) => call.url.startsWith('https://s3/fresh-'))).toBe(true);
  });

  it('phần phải thử lại thì xin URL mới cho lần thử lại', async () => {
    const { put, calls } = fakePut((url, attempt) =>
      url === 'https://s3/part-2' && attempt === 1 ? createUploadHttpError(503) : undefined,
    );
    const refreshed: number[] = [];
    await sendMultipart(makeFile(19), 'video/mp4', makeParts([8, 8, 3]), {
      put,
      sleep: noSleep,
      refreshPartUrl: async (partNumber) => {
        refreshed.push(partNumber);
        return `https://s3/part-${partNumber}-retry`;
      },
    });
    expect(refreshed).toEqual([2]);
    expect(calls.map((call) => call.url)).toContain('https://s3/part-2-retry');
  });
});

describe('sendSingle', () => {
  it('thử lại 2 lần khi lỗi mạng rồi thành công', async () => {
    const { put, calls } = fakePut((_url, attempt) => (attempt < 3 ? createUploadNetworkError() : undefined));
    const seen: number[] = [];
    await sendSingle('https://s3/one', makeFile(10), 'video/mp4', { put, sleep: noSleep, onProgress: (v) => seen.push(v) });
    expect(calls).toHaveLength(3);
    expect(seen[seen.length - 1]).toBe(1);
  });
});

describe('uploadAttachmentWithProgress', () => {
  const attachment = { id: 'att-1' } as SocialAttachment;

  function makeApi(multipart: boolean, put: PutBlob) {
    const api = {
      initiate: jest.fn(async () => ({
        attachmentId: 'att-1',
        uploadUrl: multipart ? '' : 'https://s3/one',
        expiresInSeconds: 600,
        multipart: multipart ? { uploadId: 'up-1', parts: makeParts([8, 4]) } : undefined,
      })),
      complete: jest.fn(async () => attachment),
      abort: jest.fn(async () => undefined),
      put,
      sleep: noSleep,
    };
    return api satisfies AttachmentUploadApi;
  }

  it('tải nhiều phần rồi complete kèm uploadId, tiến trình kết thúc bằng 1', async () => {
    const { put } = fakePut();
    const api = makeApi(true, put);
    const seen: number[] = [];
    const result = await uploadAttachmentWithProgress(makeFile(12), 'comment', { api, onProgress: (v) => seen.push(v) });
    expect(result).toBe(attachment);
    expect(api.complete).toHaveBeenCalledWith('att-1', { uploadId: 'up-1' });
    expect(seen[seen.length - 1]).toBe(1);
    expect(api.abort).not.toHaveBeenCalled();
  });

  it('tải một PUT rồi complete không có uploadId', async () => {
    const { put, calls } = fakePut();
    const api = makeApi(false, put);
    await uploadAttachmentWithProgress(makeFile(12), 'comment', { api });
    expect(calls).toHaveLength(1);
    expect(api.complete).toHaveBeenCalledWith('att-1', {});
  });

  it('huỷ sau khi initiate thì gọi abort và ném lỗi huỷ', async () => {
    const controller = new AbortController();
    const put: PutBlob = (_url, _body, _type, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('x'), { uploadKind: 'aborted' })));
      });
    const api = makeApi(true, put);
    const pending = uploadAttachmentWithProgress(makeFile(12), 'comment', { api, signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    expect(isUploadAborted(await rejection(pending))).toBe(true);
    expect(api.abort).toHaveBeenCalledWith('att-1', { uploadId: 'up-1' });
    expect(api.complete).not.toHaveBeenCalled();
  });

  it('lỗi gọi abort bị bỏ qua', async () => {
    const controller = new AbortController();
    const { put } = fakePut();
    const api = makeApi(false, put);
    api.initiate.mockImplementationOnce(async () => {
      controller.abort();
      return { attachmentId: 'att-1', uploadUrl: 'https://s3/one', expiresInSeconds: 600, multipart: undefined };
    });
    api.abort.mockRejectedValue(new Error('mạng'));
    const error = await rejection(uploadAttachmentWithProgress(makeFile(1), 'comment', { api, signal: controller.signal }));
    expect(isUploadAborted(error)).toBe(true);
    expect(api.abort).toHaveBeenCalled();
  });
});
