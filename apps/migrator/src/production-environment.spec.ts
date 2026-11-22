import { assertMigratorEnvironment } from './production-environment';

describe('assertMigratorEnvironment (ISS-OPS-015)', () => {
  const full = { NODE_ENV: 'production', PLATFORM_DATABASE_URL: 'postgresql://p', TENANT_DATABASE_URL_TEMPLATE: 'postgresql://t/{databaseName}' };

  it('production đủ biến thì chạy tiếp', () => {
    expect(() => assertMigratorEnvironment(full)).not.toThrow();
  });

  it('production thiếu hoặc rỗng thì lỗi nêu tên biến', () => {
    expect(() => assertMigratorEnvironment({ ...full, TENANT_DATABASE_URL_TEMPLATE: '  ' })).toThrow(/TENANT_DATABASE_URL_TEMPLATE/);
    expect(() => assertMigratorEnvironment({ NODE_ENV: 'production' })).toThrow(/PLATFORM_DATABASE_URL, TENANT_DATABASE_URL_TEMPLATE/);
  });

  it('không đòi SEED_SUPERADMIN_PASSWORD và không chạy ngoài production', () => {
    expect(() => assertMigratorEnvironment(full)).not.toThrow();
    expect(() => assertMigratorEnvironment({ NODE_ENV: 'development' })).not.toThrow();
  });
});
