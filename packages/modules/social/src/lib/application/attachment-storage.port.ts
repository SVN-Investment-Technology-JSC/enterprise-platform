/** Token DI của kho tệp đính kèm. */
export const ATTACHMENT_STORAGE = Symbol('SOCIAL_ATTACHMENT_STORAGE');

export interface AttachmentDownloadOptions {
  readonly inline?: boolean;
  readonly contentType?: string;
  readonly fileName?: string;
}

/**
 * Phần kho object mà phân hệ cần. `S3ObjectStorage` của `adapter-storage`
 * thoả cấu trúc này; test dùng bản giả.
 */
export interface AttachmentStorage {
  createUploadUrl(input: {
    readonly key: string;
    readonly contentType: string;
    readonly expiresInSeconds?: number;
    /** Ký kèm độ dài để URL chỉ nhận đúng số byte này. */
    readonly sizeBytes?: number;
  }): Promise<string>;
  /** Mở lần tải nhiều phần, trả `uploadId`. */
  createMultipartUpload(key: string, contentType: string): Promise<string>;
  /** URL ký sẵn cho một phần, chỉ nhận đúng `sizeBytes` byte. */
  createUploadPartUrl(input: {
    readonly key: string;
    readonly uploadId: string;
    readonly partNumber: number;
    readonly sizeBytes: number;
    readonly expiresInSeconds?: number;
  }): Promise<string>;
  /** Các phần đã lên kho (đã phân trang đến hết); ném lỗi nếu lần tải không còn. */
  listParts(
    key: string,
    uploadId: string,
  ): Promise<readonly { readonly partNumber: number; readonly etag: string; readonly sizeBytes: number }[]>;
  completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: readonly { readonly partNumber: number; readonly etag: string }[],
  ): Promise<void>;
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
  createDownloadUrl(
    key: string,
    expiresInSeconds?: number,
    options?: AttachmentDownloadOptions,
  ): Promise<string>;
  /** Siêu dữ liệu object đã tải lên; ném lỗi nếu chưa có. */
  objectMetadata(key: string): Promise<{ readonly sizeBytes: number; readonly contentType: string }>;
  /** Đọc `maxBytes` byte đầu của object (GetObject có Range), để đối chiếu chữ ký tệp. */
  readHead?(key: string, maxBytes: number): Promise<Uint8Array>;
  deleteObjects(keys: readonly string[]): Promise<{ readonly failed: readonly string[] }>;
}
