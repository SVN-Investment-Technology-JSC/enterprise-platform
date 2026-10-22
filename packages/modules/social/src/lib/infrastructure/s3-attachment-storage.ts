import { S3ObjectStorage } from '@enterprise-platform/adapter-storage';
import type { AttachmentStorage } from '../application/attachment-storage.port.js';

/**
 * Kho tệp đính kèm trên S3/MinIO, cấu hình từ biến môi trường như Hệ dùng
 * chung: `S3_INTERNAL_ENDPOINT` (server gọi kho), `S3_PUBLIC_ENDPOINT` (host
 * trong URL ký sẵn cho trình duyệt), `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`,
 * `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
 */
export function createS3AttachmentStorage(): AttachmentStorage {
  return new S3ObjectStorage({
    internalEndpoint: process.env['S3_INTERNAL_ENDPOINT'] ?? process.env['S3_ENDPOINT'] ?? 'http://minio:9000',
    publicEndpoint: process.env['S3_PUBLIC_ENDPOINT'] ?? process.env['S3_ENDPOINT'] ?? 'http://localhost:9010',
    region: process.env['S3_REGION'] ?? 'us-east-1',
    bucket: process.env['S3_BUCKET'] ?? 'enterprise-platform',
    accessKeyId: process.env['S3_ACCESS_KEY_ID'] ?? 'platform',
    secretAccessKey: process.env['S3_SECRET_ACCESS_KEY'] ?? 'platform-development-secret',
  });
}
