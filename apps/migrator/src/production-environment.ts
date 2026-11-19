/**
 * Kiểm biến môi trường bắt buộc của migrator khi chạy production (ISS-OPS-015).
 *
 * Migrator build bằng esbuild không gói (`bundle: false`), nên không dùng được hàm chung ở
 * `@enterprise-platform/platform-module-access/runtime`; danh sách ở đây giữ khớp với bảng chung.
 * `SEED_SUPERADMIN_PASSWORD` không bắt buộc: seed chỉ đòi khi tạo mới hoặc đặt lại Super Admin (ISS-OPS-003).
 */
export const MIGRATOR_REQUIRED_ENV = ['PLATFORM_DATABASE_URL', 'TENANT_DATABASE_URL_TEMPLATE'] as const;

export function assertMigratorEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): void {
  if (env['NODE_ENV'] !== 'production') return;
  const missing = MIGRATOR_REQUIRED_ENV.filter((name) => !env[name]?.trim());
  if (missing.length) {
    throw new Error(`migrator không khởi động được trong production: thiếu biến môi trường ${missing.join(', ')}.`);
  }
}
