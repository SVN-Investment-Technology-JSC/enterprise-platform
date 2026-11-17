import { occurrenceAttachmentStorageOptions } from './occurrence-attachment.service.js';

const production = {
  NODE_ENV: 'production',
  S3_INTERNAL_ENDPOINT: 'http://minio:9000',
  S3_PUBLIC_ENDPOINT: 'https://files.example.com',
  S3_REGION: 'ap-southeast-1',
  S3_BUCKET: 'erp',
  S3_ACCESS_KEY_ID: 'prod-key',
  S3_SECRET_ACCESS_KEY: 'prod-secret',
};

describe('occurrenceAttachmentStorageOptions', () => {
  it('OPS015-07: production thiếu S3_ACCESS_KEY_ID thì lỗi khởi động, không dùng khoá dev "platform"', () => {
    expect(() => occurrenceAttachmentStorageOptions({ ...production, S3_ACCESS_KEY_ID: undefined })).toThrow(
      /^maintenance-api .*S3_ACCESS_KEY_ID/,
    );
  });

  it('OPS015-07: production thiếu secret (hoặc chỉ khoảng trắng) cũng lỗi, không dùng secret dev', () => {
    expect(() => occurrenceAttachmentStorageOptions({ ...production, S3_SECRET_ACCESS_KEY: ' ' })).toThrow(
      /S3_SECRET_ACCESS_KEY/,
    );
  });

  it('production đủ cấu hình thì dùng đúng giá trị đã đặt', () => {
    expect(occurrenceAttachmentStorageOptions(production)).toEqual({
      internalEndpoint: 'http://minio:9000',
      publicEndpoint: 'https://files.example.com',
      region: 'ap-southeast-1',
      bucket: 'erp',
      accessKeyId: 'prod-key',
      secretAccessKey: 'prod-secret',
    });
  });

  it('dev thiếu cấu hình thì giữ MinIO local như cũ', () => {
    expect(occurrenceAttachmentStorageOptions({ NODE_ENV: 'development' })).toMatchObject({
      internalEndpoint: 'http://localhost:9010',
      accessKeyId: 'platform',
      secretAccessKey: 'platform-development-secret',
    });
  });
});
