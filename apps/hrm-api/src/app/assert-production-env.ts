const REQUIRED_PRODUCTION_ENV = [
  'PROCEDURE_API_URL',
  'S3_INTERNAL_ENDPOINT',
  'S3_PUBLIC_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
] as const;

/** Production fail-fast (ISS-OPS-001): dev/test is never affected. */
export function assertProductionEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.NODE_ENV !== 'production') return;
  const missing = REQUIRED_PRODUCTION_ENV.filter((name) => !env[name]?.trim());
  if (missing.length)
    throw new Error(
      `hrm-api không khởi động được trong production: thiếu biến môi trường ${missing.join(', ')}. ` +
        'Kiểm tra x-s3-environment và PROCEDURE_API_URL trong compose.',
    );
}
