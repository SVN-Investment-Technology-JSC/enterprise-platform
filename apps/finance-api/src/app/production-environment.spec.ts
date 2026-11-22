import { assertServiceEnvironment, PRODUCTION_REQUIRED_ENV } from '@enterprise-platform/platform-module-access/runtime';

const complete = {
  NODE_ENV: 'production',
  PLATFORM_DATABASE_URL: 'postgresql://platform:secret@platform-db:5432/platform',
  TENANT_DATABASE_URL_TEMPLATE: 'postgresql://tenant:secret@tenant-db:5432/{databaseName}',
  PLATFORM_JWKS_URL: 'http://api:3333/api/auth/v1/jwks',
  PLATFORM_ACCESS_DECISION_URL: 'http://api:3333/api/platform/internal/v1/access-decisions',
  PLATFORM_TENANT_DATABASE_API_URL: 'http://api:3333/api/platform/internal/v1/tenant-databases',
  PROCEDURE_API_URL: 'http://procedure-api:3334/api/procedure',
  WORKSPACE_API_URL: 'http://workspace-api:3337/api/workspace',
  S3_INTERNAL_ENDPOINT: 'http://minio:9000',
  S3_PUBLIC_ENDPOINT: 'https://minio.example.com',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'enterprise-platform',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  INTERNAL_SERVICE_TOKEN: 'token',
};

// OPS015-11: finance-api dùng hàm kiểm chung thay cho assert-production-env.ts riêng.
describe('finance-api: kiểm biến môi trường production', () => {
  it('danh sách của finance-api giữ đủ các biến cũ', () => {
    expect(PRODUCTION_REQUIRED_ENV['finance-api']).toEqual(
      expect.arrayContaining([
        'PROCEDURE_API_URL',
        'WORKSPACE_API_URL',
        'S3_INTERNAL_ENDPOINT',
        'S3_PUBLIC_ENDPOINT',
        'S3_REGION',
        'S3_BUCKET',
        'S3_ACCESS_KEY_ID',
        'S3_SECRET_ACCESS_KEY',
        'INTERNAL_SERVICE_TOKEN',
      ]),
    );
  });

  it('không kiểm khi không phải production', () => {
    expect(() => assertServiceEnvironment('finance-api', { NODE_ENV: 'development' })).not.toThrow();
  });

  it('đủ cấu hình thì cho khởi động', () => {
    expect(() => assertServiceEnvironment('finance-api', complete)).not.toThrow();
  });

  it('thiếu cấu hình thì nêu đúng tên service và tên biến còn thiếu', () => {
    expect(() =>
      assertServiceEnvironment('finance-api', { ...complete, S3_BUCKET: '', INTERNAL_SERVICE_TOKEN: ' ' }),
    ).toThrow(/^finance-api .*thiếu biến môi trường INTERNAL_SERVICE_TOKEN, S3_BUCKET\./);
  });

  it('thiếu địa chỉ Workspace thì không khởi động (hạch toán dự án/công việc cần tra cứu Workspace)', () => {
    expect(() => assertServiceEnvironment('finance-api', { ...complete, WORKSPACE_API_URL: '' })).toThrow(
      /WORKSPACE_API_URL/,
    );
  });
});
