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
  }): Promise<string>;
  createDownloadUrl(
    key: string,
    expiresInSeconds?: number,
    options?: AttachmentDownloadOptions,
  ): Promise<string>;
  /** Siêu dữ liệu object đã tải lên; ném lỗi nếu chưa có. */
  objectMetadata(key: string): Promise<{ readonly sizeBytes: number; readonly contentType: string }>;
  deleteObjects(keys: readonly string[]): Promise<{ readonly failed: readonly string[] }>;
}
