import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  TENANT_CORE_MIGRATIONS,
  TENANT_MODULE_MIGRATIONS,
  tenantModuleMigrations,
} from './tenant-migrations';

/**
 * Chốt chặn cho đúng lỗi đã xảy ra: thêm file `.sql` mà quên đăng ký.
 *
 * Trước khi có nguồn sự thật duy nhất, một migration quên đăng ký chỉ lộ ra khi
 * có người tạo tenant mới rồi thấy module hỏng. Test này bắt ngay lúc build.
 */
const REPO_ROOT = join(__dirname, '../../../../..');
const MIGRATIONS_ROOT = join(REPO_ROOT, 'migrations');

/** Migration cố ý chưa đăng ký, kèm lý do — phải nêu tên ở đây mới được vắng mặt. */
const DELIBERATELY_UNREGISTERED: Readonly<Record<string, string>> = {
  'tenant/inventory/0007-drop-legacy-assets.sql':
    'Bảng cũ là đường lui của lượt gộp 0006; chỉ đăng ký sau một chu kỳ vận hành ổn định.',
};

const MODULE_DIRECTORIES: Readonly<Record<string, string>> = {
  hrm: 'tenant/hrm',
  inventory: 'tenant/inventory',
  'procedure-engine': 'tenant/procedure',
  maintenance: 'tenant/maintenance',
  workspace: 'tenant/workspace',
};

const DELIBERATELY_UNREGISTERED_CORE = new Set([
  // Legacy RBAC shape superseded by 0005-tenant-rbac and retained only for
  // upgrade fixtures. Running it for a new tenant would create the old model.
  'tenant/core/0005-tenant-roles-and-permissions.sql',
]);

describe('danh sách migration của tenant', () => {
  it('cấp mới và nâng cấp tenant cùng nhận notification schema', () => {
    expect(TENANT_CORE_MIGRATIONS).toContainEqual({
      version: '0008-notifications',
      path: 'tenant/core/0008-notifications.sql',
    });
  });

  it('registry tenant-core bao phủ mọi migration đang được triển khai', () => {
    const registered = new Set(TENANT_CORE_MIGRATIONS.map((item) => item.path));
    const missing = readdirSync(join(MIGRATIONS_ROOT, 'tenant/core'))
      .filter((file) => file.endsWith('.sql'))
      .map((file) => `tenant/core/${file}`)
      .filter(
        (path) =>
          !registered.has(path) && !DELIBERATELY_UNREGISTERED_CORE.has(path),
      );
    expect(missing).toEqual([]);
  });

  it('registry tenant-core không trỏ tới file không tồn tại', () => {
    const files = new Set(
      readdirSync(join(MIGRATIONS_ROOT, 'tenant/core')).map(
        (file) => `tenant/core/${file}`,
      ),
    );
    expect(TENANT_CORE_MIGRATIONS.filter((item) => !files.has(item.path))).toEqual([]);
  });

  it('bao phủ mọi thư mục module, kể cả module mới thêm', () => {
    const directories = readdirSync(join(MIGRATIONS_ROOT, 'tenant'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'core')
      .map((entry) => `tenant/${entry.name}`)
      .sort();
    expect(Object.values(MODULE_DIRECTORIES).sort()).toEqual(directories);
  });

  it('mọi file .sql đều được đăng ký, trừ những file cố ý bỏ qua', () => {
    const registered = new Set(
      Object.values(TENANT_MODULE_MIGRATIONS).flatMap((list) => list.map((item) => item.path)),
    );

    const missing: string[] = [];
    for (const directory of Object.values(MODULE_DIRECTORIES)) {
      for (const file of readdirSync(join(MIGRATIONS_ROOT, directory))) {
        if (!file.endsWith('.sql')) continue;
        const path = `${directory}/${file}`;
        if (registered.has(path) || path in DELIBERATELY_UNREGISTERED) continue;
        missing.push(path);
      }
    }

    expect(missing).toEqual([]);
  });

  it('không đăng ký file không tồn tại', () => {
    const all = new Set<string>();
    for (const directory of Object.values(MODULE_DIRECTORIES)) {
      for (const file of readdirSync(join(MIGRATIONS_ROOT, directory))) {
        all.add(`${directory}/${file}`);
      }
    }

    const dangling = Object.values(TENANT_MODULE_MIGRATIONS)
      .flatMap((list) => list.map((item) => item.path))
      .filter((path) => !all.has(path));

    expect(dangling).toEqual([]);
  });

  it('version không trùng nhau trong cùng một module', () => {
    for (const [moduleKey, list] of Object.entries(TENANT_MODULE_MIGRATIONS)) {
      const versions = list.map((item) => item.version);
      expect({ moduleKey, count: new Set(versions).size }).toEqual({
        moduleKey,
        count: versions.length,
      });
    }
  });

  it('module lạ trả mảng rỗng, không rơi về module khác', () => {
    expect(tenantModuleMigrations('khong-ton-tai')).toEqual([]);
  });
});
