import { S3ObjectStorage } from '@enterprise-platform/adapter-storage';
import type { DocumentStorage } from '../application/document-store.port.js';

/**
 * Kho tài liệu CRM trên S3/MinIO, dùng `S3ObjectStorage` có sẵn và cùng biến môi trường với Workspace, Kho:
 * `S3_INTERNAL_ENDPOINT` (server gọi trong mạng nội bộ, dùng cho HEAD), `S3_PUBLIC_ENDPOINT` (host trong URL
 * ký mà trình duyệt mở). Máy chủ không nhận byte của file; chỉ ký URL và hỏi dung lượng (HEAD).
 */
export class S3DocumentStorage implements DocumentStorage {
  constructor(
    private readonly storage: Pick<S3ObjectStorage, 'createUploadUrl' | 'createDownloadUrl' | 'objectMetadata'> = new S3ObjectStorage({
      internalEndpoint: process.env.S3_INTERNAL_ENDPOINT ?? process.env.S3_ENDPOINT ?? 'http://minio:9000',
      publicEndpoint: process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT ?? 'http://localhost:9010',
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: process.env.S3_BUCKET ?? 'enterprise-platform',
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'platform',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'platform-development-secret',
    }),
  ) {}

  createUploadUrl(input: { key: string; contentType: string; sizeBytes: number; expiresInSeconds: number }): Promise<string> {
    // `sizeBytes` làm URL chỉ nhận đúng số byte đã khai (ký kèm content-length).
    return this.storage.createUploadUrl({
      key: input.key,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      expiresInSeconds: input.expiresInSeconds,
    });
  }

  createDownloadUrl(key: string, expiresInSeconds: number): Promise<string> {
    return this.storage.createDownloadUrl(key, expiresInSeconds);
  }

  async objectSize(key: string): Promise<number | null> {
    try {
      return (await this.storage.objectMetadata(key)).sizeBytes;
    } catch (error) {
      const name = (error as { name?: string }).name;
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (name === 'NotFound' || name === 'NoSuchKey' || status === 404) return null;
      throw error;
    }
  }
}
