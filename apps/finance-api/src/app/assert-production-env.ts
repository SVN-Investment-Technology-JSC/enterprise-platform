const REQUIRED_PRODUCTION_ENV = [
  'PROCEDURE_API_URL',
  'WORKSPACE_API_URL',
  'S3_INTERNAL_ENDPOINT',
  'S3_PUBLIC_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'INTERNAL_SERVICE_TOKEN',
] as const;

/** Production fail-fast: thiếu cấu hình thì dịch vụ không khởi động (dev/test không bị ảnh hưởng). */
export function assertProductionEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  const missing = REQUIRED_PRODUCTION_ENV.filter((name) => !env[name]?.trim());
  if (missing.length)
    throw new Error(
      `finance-api không khởi động được trong production: thiếu biến môi trường ${missing.join(', ')}. ` +
        'Kiểm tra x-s3-environment, PROCEDURE_API_URL, WORKSPACE_API_URL và INTERNAL_SERVICE_TOKEN trong compose.',
    );
}
