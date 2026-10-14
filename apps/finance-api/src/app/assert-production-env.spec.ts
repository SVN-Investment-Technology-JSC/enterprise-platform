import { assertProductionEnvironment } from './assert-production-env';

const complete = {
  NODE_ENV: 'production',
  PROCEDURE_API_URL: 'http://procedure-api:3334/api/procedure',
  S3_INTERNAL_ENDPOINT: 'http://minio:9000',
  S3_PUBLIC_ENDPOINT: 'https://minio.example.com',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'enterprise-platform',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  INTERNAL_SERVICE_TOKEN: 'token',
} as NodeJS.ProcessEnv;

describe('assertProductionEnvironment', () => {
  it('không kiểm khi không phải production', () => {
    expect(() => assertProductionEnvironment({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('đủ cấu hình thì cho khởi động', () => {
    expect(() => assertProductionEnvironment(complete)).not.toThrow();
  });

  it('thiếu cấu hình thì nêu đúng tên biến còn thiếu', () => {
    expect(() => assertProductionEnvironment({ ...complete, S3_BUCKET: '', INTERNAL_SERVICE_TOKEN: ' ' })).toThrow(/S3_BUCKET, INTERNAL_SERVICE_TOKEN/);
  });
});
