/**
 * Kiểm biến môi trường bắt buộc lúc khởi động (ISS-OPS-015).
 *
 * Chỉ chạy khi `NODE_ENV=production`: dev và test giữ giá trị mặc định trỏ về localhost như cũ. Production thiếu một biến
 * thì dịch vụ dừng ngay với tên biến, thay vì chạy tiếp với khoá tự sinh, token rỗng hay địa chỉ localhost rồi lỗi 401/403
 * khó hiểu về sau.
 *
 * File này không import thư viện ngoài nào để migrator và các worker dùng được qua
 * `@enterprise-platform/platform-module-access/runtime` mà không kéo theo Nest.
 */

export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

/** Biến cần để mở DB của tenant theo mẫu URL (PostgresPoolRegistry, resolveTenantDatabaseUrl). */
const TENANT_DATABASE = ['TENANT_DATABASE_URL_TEMPLATE'] as const;

/** Kho tệp S3 (`x-s3-environment` trong compose). */
export const S3_REQUIRED_ENV = [
  'S3_INTERNAL_ENDPOINT',
  'S3_PUBLIC_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
] as const;

/** API phân hệ: DB platform (healthcheck), DB tenant, và đường gọi về Platform (`x-platform-access-environment`). */
const MODULE_API = [
  'PLATFORM_DATABASE_URL',
  ...TENANT_DATABASE,
  'INTERNAL_SERVICE_TOKEN',
  'PLATFORM_JWKS_URL',
  'PLATFORM_ACCESS_DECISION_URL',
  'PLATFORM_TENANT_DATABASE_API_URL',
] as const;

/**
 * Danh sách biến bắt buộc ở production theo từng service.
 *
 * Mỗi danh sách phải là tập con các biến compose triển khai (`infrastructure/docker/compose.coolify.yml`) đặt cho đúng
 * service đó: một biến có trong đây mà compose không đặt thì service không khởi động được. Biến mã có đọc nhưng compose
 * chưa đặt thì không đưa vào đây cho tới khi compose được bổ sung.
 */
export const PRODUCTION_REQUIRED_ENV = {
  api: [
    'PLATFORM_DATABASE_URL',
    'TENANT_DATABASE_ADMIN_URL',
    ...TENANT_DATABASE,
    'INTERNAL_SERVICE_TOKEN',
    'AUTH_PRIVATE_KEY',
    'AUTH_PUBLIC_KEY',
    'INVENTORY_INTERNAL_API_URL',
    'PROCEDURE_INTERNAL_API_URL',
    'MAINTENANCE_INTERNAL_API_URL',
  ],
  'procedure-api': [
    ...MODULE_API,
    'TENANT_CORE_ORGANIZATION_CONTEXT_URL',
    ...S3_REQUIRED_ENV,
    'INVENTORY_API_URL',
    'HRM_API_URL',
    'FINANCE_API_URL',
    'CRM_API_URL',
  ],
  'maintenance-api': [
    ...MODULE_API,
    'TENANT_CORE_ORGANIZATION_CONTEXT_URL',
    ...S3_REQUIRED_ENV,
    'PROCEDURE_API_URL',
    'INVENTORY_API_URL',
    'HRM_API_URL',
  ],
  'inventory-api': [...MODULE_API, ...S3_REQUIRED_ENV],
  'finance-api': [...MODULE_API, ...S3_REQUIRED_ENV, 'PROCEDURE_API_URL', 'WORKSPACE_API_URL'],
  'hrm-api': [...MODULE_API, ...S3_REQUIRED_ENV, 'PROCEDURE_API_URL'],
  'workspace-api': [
    ...MODULE_API,
    'TENANT_CORE_ORGANIZATION_CONTEXT_URL',
    ...S3_REQUIRED_ENV,
    'HRM_API_URL',
    'CRM_API_URL',
    'PROCEDURE_API_URL',
  ],
  'shared-api': [
    ...MODULE_API,
    'TENANT_CORE_ORGANIZATION_CONTEXT_URL',
    ...S3_REQUIRED_ENV,
    'PLATFORM_TENANT_LIMITS_URL',
  ],
  'social-api': [
    ...MODULE_API,
    'TENANT_CORE_ORGANIZATION_CONTEXT_URL',
    ...S3_REQUIRED_ENV,
    'HRM_API_URL',
    'SHARED_API_URL',
  ],
  'crm-api': [
    ...MODULE_API,
    'TENANT_CORE_ORGANIZATION_CONTEXT_URL',
    ...S3_REQUIRED_ENV,
    'INVENTORY_API_URL',
    'PROCEDURE_API_URL',
    'FINANCE_API_URL',
  ],
  'correspondence-api': [...MODULE_API, 'TENANT_CORE_ORGANIZATION_CONTEXT_URL', 'SHARED_API_URL'],
  'realtime-api': [
    'PLATFORM_DATABASE_URL',
    ...TENANT_DATABASE,
    'PLATFORM_INTERNAL_URL',
    'WORKSPACE_INTERNAL_URL',
    'PROCEDURE_INTERNAL_URL',
    'SOCIAL_INTERNAL_URL',
    'RABBITMQ_URL',
    'VALKEY_URL',
    'REALTIME_ALLOWED_ORIGINS',
  ],
  'notification-worker': [
    'PLATFORM_DATABASE_URL',
    ...TENANT_DATABASE,
    'RABBITMQ_URL',
    'INTERNAL_SERVICE_TOKEN',
    'TENANT_CORE_ORGANIZATION_CONTEXT_URL',
  ],
  worker: [
    'PLATFORM_DATABASE_URL',
    ...TENANT_DATABASE,
    'RABBITMQ_URL',
    'INTERNAL_SERVICE_TOKEN',
    'TENANT_CORE_ORGANIZATION_CONTEXT_URL',
    ...S3_REQUIRED_ENV,
    'PROCEDURE_API_URL',
    'HRM_API_URL',
    'INVENTORY_API_URL',
    'FINANCE_API_URL',
    'CRM_API_URL',
  ],
  'video-worker': ['PLATFORM_DATABASE_URL', ...TENANT_DATABASE, 'RABBITMQ_URL', ...S3_REQUIRED_ENV],
  // migrator kiểm ở apps/migrator/src/production-environment.ts: bản build esbuild (bundle: false) không nạp được
  // đường phụ `/runtime` của thư viện này lúc chạy.
} as const satisfies Record<string, readonly string[]>;

export type ProductionService = keyof typeof PRODUCTION_REQUIRED_ENV;

export function isProductionEnvironment(env: EnvironmentSource = process.env): boolean {
  return env.NODE_ENV === 'production';
}

/** Tên các biến chưa đặt; giá trị rỗng hoặc chỉ có khoảng trắng coi như chưa đặt. */
export function missingEnvironment(names: readonly string[], env: EnvironmentSource = process.env): string[] {
  return names.filter((name) => !env[name]?.trim());
}

/**
 * Production: ném lỗi nêu tên service và các biến còn thiếu. Môi trường khác: không làm gì.
 *
 * @example assertRequiredEnvironment('hrm-api', PRODUCTION_REQUIRED_ENV['hrm-api']);
 */
export function assertRequiredEnvironment(
  service: string,
  names: readonly string[],
  env: EnvironmentSource = process.env,
): void {
  if (!isProductionEnvironment(env)) return;
  const missing = missingEnvironment(names, env);
  if (missing.length) {
    throw new Error(
      `${service} không khởi động được trong production: thiếu biến môi trường ${missing.join(', ')}. ` +
        'Kiểm tra cấu hình biến môi trường của service này trên nơi triển khai (compose.coolify.yml, Coolify).',
    );
  }
}

/** Kiểm theo danh sách của service trong `PRODUCTION_REQUIRED_ENV`. */
export function assertServiceEnvironment(service: ProductionService, env: EnvironmentSource = process.env): void {
  assertRequiredEnvironment(service, PRODUCTION_REQUIRED_ENV[service], env);
}

/**
 * Đọc một biến bắt buộc ở production. Dev/test thiếu biến thì dùng `developmentFallback` (hành vi cũ); production thiếu
 * thì ném lỗi nêu tên biến, không bao giờ trả giá trị dev.
 */
export function productionRequiredValue(
  service: string,
  name: string,
  developmentFallback: string,
  env: EnvironmentSource = process.env,
): string {
  const value = env[name];
  if (value?.trim()) return value;
  assertRequiredEnvironment(service, [name], env);
  return developmentFallback;
}
