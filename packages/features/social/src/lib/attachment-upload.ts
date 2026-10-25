import type {
  AbortSocialAttachmentRequest,
  CompleteSocialAttachmentRequest,
  RefreshSocialUploadPartsRequest,
  RefreshSocialUploadPartsResponse,
  InitiateSocialAttachmentRequest,
  InitiateSocialAttachmentResponse,
  SocialAttachment,
  SocialAttachmentPurpose,
  SocialMultipartPart,
} from '@enterprise-platform/contracts-social';
import type { ImageSize } from './image-size';

/** Số phần tải song song tối đa. */
export const UPLOAD_PART_CONCURRENCY = 3;
/** Chờ trước mỗi lần thử lại của một phần (tối đa 3 lần thử lại). */
export const PART_RETRY_DELAYS_MS: readonly number[] = [500, 1000, 2000];
/** Chờ trước mỗi lần thử lại của lệnh PUT đơn (tối đa 2 lần thử lại). */
export const SINGLE_RETRY_DELAYS_MS: readonly number[] = [500, 1000];

/* ------------------------------------------------------------------- lỗi */

type UploadErrorKind = 'aborted' | 'http' | 'network';

interface UploadError extends Error {
  readonly uploadKind: UploadErrorKind;
  readonly status?: number;
}

function makeError(kind: UploadErrorKind, message: string, status?: number): UploadError {
  return Object.assign(new Error(message), { uploadKind: kind, status }) as UploadError;
}

export const createUploadAbortedError = () => makeError('aborted', 'Đã huỷ tải lên.');
export const createUploadHttpError = (status: number) =>
  makeError('http', 'Kho lưu trữ từ chối tệp tải lên.', status);
export const createUploadNetworkError = () =>
  makeError('network', 'Mất kết nối khi tải tệp lên. Hãy kiểm tra mạng rồi thử lại.');

const kindOf = (error: unknown): UploadErrorKind | undefined =>
  (error as Partial<UploadError> | undefined)?.uploadKind;

/** Lỗi do người dùng huỷ lần tải. */
export function isUploadAborted(error: unknown): boolean {
  return kindOf(error) === 'aborted';
}

/** Chỉ thử lại khi lỗi mạng, 5xx, 408 hoặc 429; không thử lại khi huỷ hay 4xx khác. */
export function isRetryableUploadError(error: unknown): boolean {
  const kind = kindOf(error);
  if (kind === 'network') return true;
  if (kind !== 'http') return false;
  const status = (error as UploadError).status ?? 0;
  return status >= 500 || status === 408 || status === 429;
}

/* ------------------------------------------------------------ PUT có tiến trình */

export interface PutOptions {
  /** Số byte đã gửi của lần PUT này. */
  readonly onProgress?: (loadedBytes: number) => void;
  readonly signal?: AbortSignal;
}

/** Hàm PUT một khối dữ liệu tới URL ký sẵn; tiêm bản giả khi test. */
export type PutBlob = (url: string, body: Blob, contentType: string, options?: PutOptions) => Promise<void>;

/** PUT bằng XMLHttpRequest để có tiến trình gửi thật và huỷ được qua `AbortSignal`. */
export const putWithProgress: PutBlob = (url, body, contentType, options = {}) =>
  new Promise<void>((resolve, reject) => {
    const { onProgress, signal } = options;
    if (signal?.aborted) {
      reject(createUploadAbortedError());
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded);
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(body.size);
        resolve();
      } else {
        reject(createUploadHttpError(xhr.status));
      }
    };
    xhr.onerror = () => {
      cleanup();
      reject(createUploadNetworkError());
    };
    xhr.ontimeout = xhr.onerror;
    xhr.onabort = () => {
      cleanup();
      reject(createUploadAbortedError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    xhr.send(body);
  });

/* ----------------------------------------------------------------- điều phối */

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

/** Chờ `ms` mili giây; bị huỷ giữa chừng thì ném lỗi huỷ. */
export const sleepWithSignal: Sleep = (ms, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createUploadAbortedError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(createUploadAbortedError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/** Chạy `task`, thử lại theo `delays` khi lỗi tạm thời. */
export async function withRetry<T>(
  task: () => Promise<T>,
  delays: readonly number[],
  sleep: Sleep,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    if (signal?.aborted) throw createUploadAbortedError();
    try {
      return await task();
    } catch (error) {
      if (signal?.aborted && !isUploadAborted(error)) throw createUploadAbortedError();
      const delay = delays[attempt];
      if (delay === undefined || !isRetryableUploadError(error)) throw error;
      await sleep(delay, signal);
    }
  }
}

/** URL của một phần cấp lúc `initiate` chỉ dùng được trong khoảng này; quá thì xin lại URL mới. */
const PART_URL_FRESH_MS = 120_000;

export interface SendOptions {
  /** Xin URL mới cho một phần (khi URL cũ đã quá cũ hoặc phần phải thử lại). Thiếu thì luôn dùng URL cấp ban đầu. */
  readonly refreshPartUrl?: (partNumber: number) => Promise<string>;
  /** Đồng hồ (tiêm được để test). */
  readonly now?: () => number;
  /** Phần đã gửi, từ 0 đến 1. */
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
  readonly put?: PutBlob;
  readonly sleep?: Sleep;
}

function fraction(loaded: number, total: number): number {
  return total <= 0 ? 1 : Math.max(0, Math.min(1, loaded / total));
}

/** Tải một tệp nhỏ bằng một lệnh PUT, thử lại 2 lần khi lỗi mạng hoặc 5xx. */
export async function sendSingle(
  url: string,
  file: Blob,
  contentType: string,
  options: SendOptions = {},
): Promise<void> {
  const { onProgress, signal, put = putWithProgress, sleep = sleepWithSignal } = options;
  await withRetry(
    () => put(url, file, contentType, { signal, onProgress: (loaded) => onProgress?.(fraction(loaded, file.size)) }),
    SINGLE_RETRY_DELAYS_MS,
    sleep,
    signal,
  );
}

/**
 * Tải từng phần song song (tối đa 3). Phần i cắt từ tệp theo thứ tự `partNumber`, đúng `sizeBytes` byte.
 * Một phần lỗi tạm thời được thử lại riêng; lỗi cuối cùng hoặc huỷ thì dừng mọi phần còn lại.
 */
export async function sendMultipart(
  file: Blob,
  contentType: string,
  parts: readonly SocialMultipartPart[],
  options: SendOptions = {},
): Promise<void> {
  const { onProgress, signal, put = putWithProgress, sleep = sleepWithSignal, refreshPartUrl, now = Date.now } = options;
  const startedAt = now();
  const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  const total = ordered.reduce((sum, part) => sum + part.sizeBytes, 0);
  if (total !== file.size) throw new Error('Kích thước các phần tải lên không khớp với tệp.');

  let offset = 0;
  const slices = ordered.map((part) => {
    const start = offset;
    offset += part.sizeBytes;
    return { part, start };
  });

  const loadedByPart = new Array<number>(ordered.length).fill(0);
  let reported = 0;
  const report = () => {
    const sent = loadedByPart.reduce((sum, value) => sum + value, 0);
    const next = Math.max(reported, fraction(sent, file.size));
    if (next !== reported) {
      reported = next;
      onProgress?.(next);
    }
  };

  const inner = new AbortController();
  const onOuterAbort = () => inner.abort();
  if (signal?.aborted) inner.abort();
  else signal?.addEventListener('abort', onOuterAbort, { once: true });

  let cursor = 0;
  let failure: unknown;
  let failed = false;
  const worker = async () => {
    while (!failed && !inner.signal.aborted) {
      const index = cursor;
      cursor += 1;
      const slice = slices[index];
      if (!slice) return;
      const blob = file.slice(slice.start, slice.start + slice.part.sizeBytes);
      let attempt = 0;
      try {
        await withRetry(
          async () => {
            loadedByPart[index] = 0;
            // URL cấp lúc initiate sống ngắn: phần bắt đầu muộn hoặc phải thử lại thì xin URL mới.
            const stale = attempt > 0 || now() - startedAt > PART_URL_FRESH_MS;
            attempt += 1;
            const url = stale && refreshPartUrl ? await refreshPartUrl(slice.part.partNumber) : slice.part.url;
            return put(url, blob, contentType, {
              signal: inner.signal,
              onProgress: (loaded) => {
                loadedByPart[index] = Math.min(loaded, slice.part.sizeBytes);
                report();
              },
            });
          },
          PART_RETRY_DELAYS_MS,
          sleep,
          inner.signal,
        );
        loadedByPart[index] = slice.part.sizeBytes;
        report();
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
          inner.abort();
        }
        return;
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(UPLOAD_PART_CONCURRENCY, slices.length) }, worker));
  } finally {
    signal?.removeEventListener('abort', onOuterAbort);
  }
  if (signal?.aborted) throw createUploadAbortedError();
  if (failed) throw failure;
}

/* ------------------------------------------------------------ luồng công khai */

/** Các lời gọi API; `social-api.ts` cấp bản thật, test cấp bản giả. */
export interface AttachmentUploadApi {
  initiate(body: InitiateSocialAttachmentRequest): Promise<InitiateSocialAttachmentResponse>;
  complete(attachmentId: string, body: CompleteSocialAttachmentRequest): Promise<SocialAttachment>;
  abort(attachmentId: string, body: AbortSocialAttachmentRequest): Promise<unknown>;
  /** Ký lại URL cho các phần (có thể thiếu: khi đó luôn dùng URL cấp ban đầu). */
  refreshParts?(attachmentId: string, body: RefreshSocialUploadPartsRequest): Promise<RefreshSocialUploadPartsResponse>;
  readonly put?: PutBlob;
  readonly sleep?: Sleep;
}

export interface UploadAttachmentOptions {
  readonly api: AttachmentUploadApi;
  /** Phần đã tải, từ 0 đến 1. */
  readonly onProgress?: (fraction: number) => void;
  /**
   * Gọi ngay khi server đã cấp tệp (sau `initiate`, trước khi tải): để ô soạn biết `attachmentId` và `uploadId`
   * mà dọn tệp dang dở khi người dùng đóng tab. Chỉ gọi một lần, không chờ.
   */
  readonly onInitiated?: (ticket: { readonly attachmentId: string; readonly uploadId?: string }) => void;
  readonly signal?: AbortSignal;
  /**
   * Chỉ ảnh: kích thước của tệp được tải lên (hoặc lời hứa đang đọc, để đọc song song với việc tải). Chỉ chờ trước
   * `complete`; đọc lỗi hay thiếu thì bỏ qua, không chặn việc tải.
   */
  readonly dimensions?: ImageSize | Promise<ImageSize | undefined>;
}

/**
 * Xin URL, tải (một PUT hoặc nhiều phần), rồi báo hoàn tất. Bị huỷ hoặc tải lỗi sau khi đã xin URL
 * thì gọi `abort` (không chặn, lỗi bỏ qua) để server dọn; lỗi huỷ nhận biết bằng `isUploadAborted`.
 */
export async function uploadAttachmentWithProgress(
  file: File,
  purpose: SocialAttachmentPurpose,
  options: UploadAttachmentOptions,
): Promise<SocialAttachment> {
  const { api, onProgress, onInitiated, signal, dimensions } = options;
  if (signal?.aborted) throw createUploadAbortedError();
  const ticket = await api.initiate({
    fileName: file.name,
    contentType: file.type,
    sizeBytes: file.size,
    purpose,
  });
  const uploadId = ticket.multipart?.uploadId;
  onInitiated?.({ attachmentId: ticket.attachmentId, uploadId });
  const abortRemote = () => {
    void Promise.resolve()
      .then(() => api.abort(ticket.attachmentId, uploadId ? { uploadId } : {}))
      .catch(() => undefined);
  };
  if (signal?.aborted) {
    abortRemote();
    throw createUploadAbortedError();
  }
  onProgress?.(0);
  const refreshParts = api.refreshParts;
  const send: SendOptions = {
    onProgress,
    signal,
    put: api.put,
    sleep: api.sleep,
    refreshPartUrl:
      refreshParts && uploadId
        ? async (partNumber) => {
            const { parts } = await refreshParts.call(api, ticket.attachmentId, { uploadId, partNumbers: [partNumber] });
            const fresh = parts.find((part) => part.partNumber === partNumber);
            if (!fresh) throw new Error('Không xin được URL tải lên mới.');
            return fresh.url;
          }
        : undefined,
  };
  try {
    if (ticket.multipart) await sendMultipart(file, file.type, ticket.multipart.parts, send);
    else await sendSingle(ticket.uploadUrl, file, file.type, send);
  } catch (error) {
    abortRemote();
    throw signal?.aborted && !isUploadAborted(error) ? createUploadAbortedError() : error;
  }
  if (signal?.aborted) {
    abortRemote();
    throw createUploadAbortedError();
  }
  const size = await Promise.resolve(dimensions).catch(() => undefined);
  const attachment = await api.complete(ticket.attachmentId, {
    ...(uploadId ? { uploadId } : {}),
    ...(size ? { width: size.width, height: size.height } : {}),
  });
  onProgress?.(1);
  return attachment;
}
