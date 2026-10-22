import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { TENANT_STORAGE_WRITE_TIMEOUT_SECONDS, TENANT_UPLOAD_URL_TTL_SECONDS } from './storage-limits.js';

export interface ObjectStorageUpload {
  readonly key: string;
  readonly contentType: string;
  readonly expiresInSeconds?: number;
}

export interface ObjectStoragePut {
  readonly key: string;
  readonly contentType: string;
  readonly body: string | Uint8Array;
}

/**
 * Cách trình duyệt nhận tệp qua URL ký sẵn. Mặc định giữ nguyên siêu dữ liệu
 * của object; `inline` ép mở ngay trong trình duyệt (xem trước) thay vì tải về.
 */
export interface ObjectStorageDownloadOptions {
  readonly inline?: boolean;
  /** Ghi đè `Content-Type` của phản hồi, để trình duyệt biết cách hiển thị. */
  readonly contentType?: string;
  readonly fileName?: string;
}

export interface ObjectStoragePort {
  createUploadUrl(input: ObjectStorageUpload): Promise<string>;
  createDownloadUrl(
    key: string,
    expiresInSeconds?: number,
    options?: ObjectStorageDownloadOptions,
  ): Promise<string>;
  putObject(input: ObjectStoragePut): Promise<void>;
}

export interface ObjectStorageCopy {
  /** Khoá nguồn đã có trong kho. */
  readonly from: string;
  readonly to: string;
}

export interface ObjectStorageReadOptions {
  /** Từ chối (không tải về) khi object lớn hơn mức này, để một khoá bất thường không làm đầy bộ nhớ. */
  readonly maxBytes?: number;
}

export interface ObjectStorageContent {
  readonly body: Uint8Array;
  readonly contentType: string;
  readonly sizeBytes: number;
}

/** Khoá không có trong kho (S3 `NoSuchKey`/`NotFound`). */
export class ObjectNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`Object not found: ${key}`);
    this.name = 'ObjectNotFoundError';
  }
}

/** Object lớn hơn `maxBytes` mà người gọi cho phép. */
export class ObjectTooLargeError extends Error {
  constructor(
    readonly key: string,
    readonly sizeBytes: number,
    readonly maxBytes: number,
  ) {
    super(`Object ${key} is ${sizeBytes} bytes, above the ${maxBytes} byte limit`);
    this.name = 'ObjectTooLargeError';
  }
}

/**
 * Đọc nội dung object phía máy chủ qua địa chỉ nội bộ. Tách khỏi các cổng khác
 * để module chỉ cần ghi hay chỉ cần ký URL không phải khai thêm hàm này.
 */
export interface ObjectStorageReadPort {
  /** Ném `ObjectNotFoundError` khi khoá không có, `ObjectTooLargeError` khi quá `maxBytes`. */
  getObject(key: string, options?: ObjectStorageReadOptions): Promise<ObjectStorageContent>;
}

/**
 * Thao tác phía máy chủ trên đối tượng đã có: sao chép và xoá. Tách khỏi
 * `ObjectStoragePort` để các module chỉ cần ký URL không phải khai thêm hai
 * hàm này.
 */
export interface ObjectStorageManagementPort extends ObjectStoragePort {
  /** Sao chép ngay trong kho, tệp không đi qua máy chủ ứng dụng. */
  copyObject(input: ObjectStorageCopy): Promise<void>;
  /**
   * Xoá theo lô. Khoá không còn trong kho coi như đã xoá; trả về những khoá
   * kho từ chối xoá để nơi gọi ghi nhận.
   */
  deleteObjects(keys: readonly string[]): Promise<{ readonly failed: readonly string[] }>;
}

/** Giới hạn của S3 cho một lệnh `DeleteObjects`. */
const DELETE_BATCH_SIZE = 1000;

export interface S3ObjectStorageOptions {
  /** Docker/private address used only by server-side calls. */
  readonly internalEndpoint?: string;
  /** HTTPS address embedded into presigned URLs returned to browsers. */
  readonly publicEndpoint?: string;
  /** @deprecated Use internalEndpoint and publicEndpoint instead. */
  readonly endpoint?: string;
  readonly region?: string;
  readonly bucket: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly forcePathStyle?: boolean;
}

export class S3ObjectStorage implements ObjectStorageManagementPort, ObjectStorageReadPort {
  private readonly internalClient: S3Client;
  private readonly publicClient: S3Client;

  constructor(private readonly options: S3ObjectStorageOptions) {
    const createClient = (endpoint: string | undefined) => new S3Client({
      endpoint,
      region: options.region ?? 'us-east-1',
      forcePathStyle: options.forcePathStyle ?? Boolean(endpoint),
      credentials:
        options.accessKeyId && options.secretAccessKey
          ? {
              accessKeyId: options.accessKeyId,
              secretAccessKey: options.secretAccessKey,
          }
          : undefined,
    });

    // A presigned URL is consumed by a browser, so it must contain a public
    // hostname. Server-side writes stay on the private Docker network.
    this.internalClient = createClient(
      options.internalEndpoint ?? options.endpoint ?? options.publicEndpoint,
    );
    this.publicClient = createClient(
      options.publicEndpoint ?? options.endpoint ?? options.internalEndpoint,
    );
  }

  createUploadUrl(input: ObjectStorageUpload): Promise<string> {
    return getSignedUrl(
      this.publicClient,
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: input.key,
        ContentType: input.contentType,
      }),
      { expiresIn: Math.min(input.expiresInSeconds ?? TENANT_UPLOAD_URL_TTL_SECONDS, TENANT_UPLOAD_URL_TTL_SECONDS) },
    );
  }

  createDownloadUrl(
    key: string,
    expiresInSeconds = 300,
    options: ObjectStorageDownloadOptions = {},
  ): Promise<string> {
    // Ký kèm tham số `response-content-*`: kho trả đúng các header này cho
    // riêng URL này, không đổi siêu dữ liệu lưu trên object.
    const disposition = options.inline
      ? `inline${options.fileName ? `; filename*=UTF-8''${encodeURIComponent(options.fileName)}` : ''}`
      : undefined;
    return getSignedUrl(
      this.publicClient,
      new GetObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        ResponseContentDisposition: disposition,
        ResponseContentType: options.contentType,
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  async putObject(input: ObjectStoragePut): Promise<void> {
    await this.internalClient.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: input.key,
        ContentType: input.contentType,
        Body: input.body,
      }),
      { abortSignal: AbortSignal.timeout(TENANT_STORAGE_WRITE_TIMEOUT_SECONDS * 1000) },
    );
  }

  async copyObject(input: ObjectStorageCopy): Promise<void> {
    // `CopySource` là "bucket/khoá" đã mã hoá từng đoạn; dấu "/" giữ nguyên.
    const source = `${this.options.bucket}/${input.from.split('/').map(encodeURIComponent).join('/')}`;
    await this.internalClient.send(
      new CopyObjectCommand({ Bucket: this.options.bucket, Key: input.to, CopySource: source }),
      { abortSignal: AbortSignal.timeout(TENANT_STORAGE_WRITE_TIMEOUT_SECONDS * 1000) },
    );
  }

  async deleteObjects(keys: readonly string[]): Promise<{ readonly failed: readonly string[] }> {
    const failed: string[] = [];
    for (let start = 0; start < keys.length; start += DELETE_BATCH_SIZE) {
      const batch = keys.slice(start, start + DELETE_BATCH_SIZE);
      const result = await this.internalClient.send(
        new DeleteObjectsCommand({
          Bucket: this.options.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
        { abortSignal: AbortSignal.timeout(TENANT_STORAGE_WRITE_TIMEOUT_SECONDS * 1000) },
      );
      for (const error of result.Errors ?? []) if (error.Key) failed.push(error.Key);
    }
    return { failed };
  }

  async getObject(key: string, options: ObjectStorageReadOptions = {}): Promise<ObjectStorageContent> {
    try {
      const result = await this.internalClient.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(TENANT_STORAGE_WRITE_TIMEOUT_SECONDS * 1000) },
      );
      const declared = result.ContentLength ?? 0;
      if (options.maxBytes !== undefined && declared > options.maxBytes) {
        // Không đọc thân phản hồi; huỷ luồng để giải phóng kết nối.
        (result.Body as { destroy?: () => void } | undefined)?.destroy?.();
        throw new ObjectTooLargeError(key, declared, options.maxBytes);
      }
      const body = result.Body ? await result.Body.transformToByteArray() : new Uint8Array();
      if (options.maxBytes !== undefined && body.byteLength > options.maxBytes) {
        throw new ObjectTooLargeError(key, body.byteLength, options.maxBytes);
      }
      return {
        body,
        contentType: result.ContentType ?? 'application/octet-stream',
        sizeBytes: body.byteLength,
      };
    } catch (error) {
      const name = (error as { name?: string }).name;
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (name === 'NoSuchKey' || name === 'NotFound' || status === 404) throw new ObjectNotFoundError(key);
      throw error;
    }
  }

  async objectMetadata(key: string): Promise<{sizeBytes: number; contentType: string}> {
    const result = await this.internalClient.send(new HeadObjectCommand({Bucket:this.options.bucket,Key:key}),
      {abortSignal:AbortSignal.timeout(TENANT_STORAGE_WRITE_TIMEOUT_SECONDS*1000)});
    return {sizeBytes:result.ContentLength ?? 0,contentType:result.ContentType ?? 'application/octet-stream'};
  }
}
