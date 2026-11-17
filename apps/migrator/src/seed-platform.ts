import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { createPostgresPool, inTransaction } from '@enterprise-platform/adapter-database';

type PostgresPool = ReturnType<typeof createPostgresPool>;
type SeedClient = Parameters<Parameters<typeof inTransaction>[1]>[0];

const derivePassword = promisify(scrypt);

export const SUPER_ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/**
 * Seed chỉ tạo dữ liệu khi chưa có. Super Admin và danh mục phân hệ đã có trong DB được giữ nguyên,
 * trừ khi người vận hành đặt SEED_SUPERADMIN_RESET_PASSWORD=true để đặt lại mật khẩu Super Admin.
 */
export async function seedPlatform(pool: PostgresPool, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await inTransaction(pool, async (client) => {
    await client.query(`INSERT INTO authorization_schema.roles (id, key, name, scope) VALUES
      ('e0000000-0000-4000-8000-000000000001', 'platform-admin', 'Platform Admin', 'platform'),
      ('e0000000-0000-4000-8000-000000000002', 'tenant-admin', 'Tenant Admin', 'tenant')
      ON CONFLICT (id) DO NOTHING`);
    await seedSuperAdmin(client, env);
    await client.query(`INSERT INTO authorization_schema.permissions (id, key, description) VALUES ('e1000000-0000-4000-8000-000000000001', 'platform.manage', 'Quản trị Platform Core'), ('e1000000-0000-4000-8000-000000000002', 'tenant.manage', 'Quản trị tenant'), ('e1000000-0000-4000-8000-000000000003', 'procedure.read', 'Đọc Procedure Engine'), ('e1000000-0000-4000-8000-000000000004', 'procedure.manage', 'Quản trị Procedure Engine'), ('e1000000-0000-4000-8000-000000000007', 'maintenance.read', 'Đọc Maintenance'), ('e1000000-0000-4000-8000-000000000008', 'maintenance.manage', 'Quản trị Maintenance'), ('e1000000-0000-4000-8000-000000000009', 'inventory.read', 'Đọc Inventory'), ('e1000000-0000-4000-8000-000000000010', 'inventory.manage', 'Quản trị Inventory'), ('e1000000-0000-4000-8000-000000000011', 'inventory.transaction.write', 'Ghi nhận giao dịch Inventory'), ('e1000000-0000-4000-8000-000000000014', 'hrm.read', 'Đọc HRM'), ('e1000000-0000-4000-8000-000000000013', 'hrm.manage', 'Quản trị HRM'), ('e1000000-0000-4000-8000-000000000020', 'workspace.read', 'Đọc Workspace'), ('e1000000-0000-4000-8000-000000000021', 'workspace.manage', 'Quản trị Workspace'), ('e1000000-0000-4000-8000-000000000022', 'workspace.task.write', 'Ghi dự án và công việc Workspace'), ('e1000000-0000-4000-8000-000000000023', 'workspace.document.write', 'Ghi tài liệu Workspace'), ('e1000000-0000-4000-8000-000000000024', 'workspace.project.create', 'Tạo dự án Workspace'), ('e1000000-0000-4000-8000-000000000025', 'workspace.document.delete', 'Xóa và lưu trữ tài liệu Workspace'), ('e1000000-0000-4000-8000-000000000026', 'inventory.stocktake.create', 'Tạo đợt kiểm kê và nhập số đếm Inventory'), ('e1000000-0000-4000-8000-000000000027', 'inventory.stocktake.approve', 'Duyệt và ghi sổ kiểm kê Inventory'), ('e1000000-0000-4000-8000-000000000028', 'shared.read', 'Đọc tài liệu công ty'), ('e1000000-0000-4000-8000-000000000029', 'shared.manage', 'Quản trị kho tài liệu công ty'), ('e1000000-0000-4000-8000-000000000030', 'shared.document.write', 'Ghi tài liệu công ty'), ('e1000000-0000-4000-8000-000000000031', 'shared.document.delete', 'Lưu trữ và xoá tài liệu công ty'), ('e1000000-0000-4000-8000-000000000032', 'social.read', 'Xem Mạng nội bộ'), ('e1000000-0000-4000-8000-000000000033', 'social.post.write', 'Đăng bài và bình luận Mạng nội bộ'), ('e1000000-0000-4000-8000-000000000034', 'social.post.moderate', 'Kiểm duyệt bài viết và bình luận Mạng nội bộ'), ('e1000000-0000-4000-8000-000000000035', 'social.manage', 'Quản trị chuyên mục Mạng nội bộ'), ('e1000000-0000-4000-8000-000000000036', 'crm.read', 'Xem CRM trong phạm vi dữ liệu của mình'), ('e1000000-0000-4000-8000-000000000037', 'crm.read.all', 'Xem toàn bộ dữ liệu CRM'), ('e1000000-0000-4000-8000-000000000038', 'crm.opportunity.write', 'Quản lý khách hàng, lead, cơ hội và hoạt động CRM'), ('e1000000-0000-4000-8000-000000000039', 'crm.quote.write', 'Lập báo giá CRM'), ('e1000000-0000-4000-8000-000000000040', 'crm.quote.approve', 'Duyệt báo giá CRM'), ('e1000000-0000-4000-8000-000000000041', 'crm.order.write', 'Lập và xác nhận đơn bán'), ('e1000000-0000-4000-8000-000000000042', 'crm.contract.write', 'Quản lý hợp đồng CRM'), ('e1000000-0000-4000-8000-000000000043', 'crm.receivable.write', 'Thu tiền và điều chỉnh công nợ CRM'), ('e1000000-0000-4000-8000-000000000044', 'crm.warranty.write', 'Xử lý bảo hành và đổi trả'), ('e1000000-0000-4000-8000-000000000045', 'crm.report.read', 'Xem báo cáo CRM'), ('e1000000-0000-4000-8000-000000000046', 'crm.manage', 'Quản trị CRM'), ('e1000000-0000-4000-8000-000000000047', 'correspondence.read', 'Xem Văn thư'), ('e1000000-0000-4000-8000-000000000048', 'correspondence.letter.register', 'Tiếp nhận, phân loại và trình công văn'), ('e1000000-0000-4000-8000-000000000049', 'correspondence.letter.direct', 'Chỉ đạo công văn'), ('e1000000-0000-4000-8000-000000000050', 'correspondence.manage', 'Quản trị Văn thư'), ('e1000000-0000-4000-8000-000000000051', 'correspondence.letter.read-all', 'Xem mọi công văn'), ('e1000000-0000-4000-8000-000000000052', 'correspondence.letter.confidential', 'Xem công văn mật'), ('e1000000-0000-4000-8000-000000000053', 'correspondence.letter.publish', 'Phát hành công văn đi'), ('e1000000-0000-4000-8000-000000000054', 'correspondence.letter.archive', 'Lưu trữ hồ sơ công văn'), ('e1000000-0000-4000-8000-000000000055', 'correspondence.config', 'Cấu hình Văn thư'), ('e1000000-0000-4000-8000-000000000056', 'correspondence.outgoing.create', 'Soạn công văn đi'), ('e1000000-0000-4000-8000-000000000057', 'correspondence.report.read', 'Xem báo cáo Văn thư') ON CONFLICT (id) DO NOTHING`);
    await client.query(`INSERT INTO authorization_schema.role_permissions (role_id, permission_id) SELECT 'e0000000-0000-4000-8000-000000000001'::uuid, id FROM authorization_schema.permissions WHERE key IN ('platform.manage','platform.tenants.delete') UNION ALL SELECT 'e0000000-0000-4000-8000-000000000002'::uuid, id FROM authorization_schema.permissions WHERE key NOT LIKE 'platform.%' ON CONFLICT DO NOTHING`);
    await client.query(`INSERT INTO authorization_schema.user_roles (user_id, role_id, membership_id, assignment_key) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e0000000-0000-4000-8000-000000000001', NULL, 'platform-superadmin') ON CONFLICT (assignment_key) DO NOTHING`);
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM module_registry_schema.modules WHERE id = 'f0000000-0000-4000-8000-000000000005' AND key = 'hrm') THEN
          IF NOT EXISTS (SELECT 1 FROM module_registry_schema.modules WHERE id = 'f0000000-0000-4000-8000-000000000006') THEN
            INSERT INTO module_registry_schema.modules (id, key, name, description, launch_url, icon, version, status)
            SELECT 'f0000000-0000-4000-8000-000000000006', 'hrm-temp', name, description, launch_url, icon, version, status
            FROM module_registry_schema.modules WHERE id = 'f0000000-0000-4000-8000-000000000005';
          END IF;
          UPDATE subscription_schema.tenant_entitlements SET module_id = 'f0000000-0000-4000-8000-000000000006' WHERE module_id = 'f0000000-0000-4000-8000-000000000005';
          UPDATE subscription_schema.plan_modules SET module_id = 'f0000000-0000-4000-8000-000000000006' WHERE module_id = 'f0000000-0000-4000-8000-000000000005';
          DELETE FROM module_registry_schema.modules WHERE id = 'f0000000-0000-4000-8000-000000000005';
          UPDATE module_registry_schema.modules SET key = 'hrm' WHERE id = 'f0000000-0000-4000-8000-000000000006';
        END IF;
      END $$;
    `);
    await client.query(`INSERT INTO module_registry_schema.modules (id, key, name, description, launch_url, icon, version) VALUES ('f0000000-0000-4000-8000-000000000001', 'procedure-engine', 'Procedure Engine', 'Thiết kế và vận hành quy trình RCSI', '/modules/procedure', 'PE', '1.0.0'), ('f0000000-0000-4000-8000-000000000003', 'maintenance', 'Maintenance', 'Thiết bị, kế hoạch và bảo trì phòng ngừa', '/modules/maintenance', 'MT', '1.0.0'), ('f0000000-0000-4000-8000-000000000004', 'inventory', 'Inventory', 'Tài sản, vật tư, kho và giao dịch tồn kho', '/modules/inventory', 'IV', '1.0.0'), ('f0000000-0000-4000-8000-000000000005', 'workspace', 'Workspace', 'Dự án, công việc, tài liệu và lịch biểu', '/modules/workspace', 'WS', '1.0.0'), ('f0000000-0000-4000-8000-000000000006', 'hrm', 'HRM & Chấm công', 'Quản lý nhân sự, hồ sơ, chấm công và chi trả lương', '/modules/hrm', 'HRM', '1.0.0'), ('f0000000-0000-4000-8000-000000000007', 'assistant', 'Trợ lý Savina', 'Hỏi cách dùng ERP và số liệu trong phạm vi quyền của người hỏi', '/modules/assistant', 'TL', '1.0.0'),
('f0000000-0000-4000-8000-000000000008', 'finance', 'Tài chính', 'Phiếu thu, phiếu chi, chuyển tiền, tài khoản và báo cáo cho kế toán', '/modules/finance', 'FIN', '1.0.0'), ('f0000000-0000-4000-8000-000000000009', 'shared', 'Hệ dùng chung', 'Tài liệu công ty và dịch vụ dùng chung giữa các phân hệ', '/modules/shared', 'DC', '1.0.0'), ('f0000000-0000-4000-8000-000000000010', 'social', 'Mạng nội bộ', 'Bảng tin, bài viết, bình luận và trao đổi nội bộ của công ty', '/modules/social', 'MN', '1.0.0'), ('f0000000-0000-4000-8000-000000000011', 'crm', 'CRM', 'Khách hàng, cơ hội, báo giá, hợp đồng, đơn bán, công nợ và bảo hành', '/modules/crm', 'BH', '1.0.0'), ('f0000000-0000-4000-8000-000000000012', 'correspondence', 'Văn thư', 'Công văn đến, chỉ đạo, phòng ban xử lý, phát hành và lưu trữ hồ sơ', '/modules/correspondence', 'VT', '1.0.0') ON CONFLICT (id) DO UPDATE SET key = EXCLUDED.key, launch_url = EXCLUDED.launch_url, version = EXCLUDED.version`);
  });
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url');
  const derived = (await derivePassword(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString('base64url')}`;
}

async function seedSuperAdmin(client: SeedClient, env: NodeJS.ProcessEnv): Promise<void> {
  const reset = env.SEED_SUPERADMIN_RESET_PASSWORD?.trim().toLowerCase() === 'true';
  const existing = await client.query<{ id: string }>('SELECT id FROM identity_schema.users WHERE id = $1', [SUPER_ADMIN_ID]);
  const exists = existing.rows.length > 0;
  if (exists && !reset) return;
  const password = env.SEED_SUPERADMIN_PASSWORD;
  if (!password) {
    throw new Error(reset
      ? 'SEED_SUPERADMIN_PASSWORD is required when SEED_SUPERADMIN_RESET_PASSWORD=true.'
      : 'SEED_SUPERADMIN_PASSWORD is required to create the Platform Super Admin (no Super Admin exists yet).');
  }
  const hash = await hashPassword(password);
  if (!exists) {
    await client.query(`INSERT INTO identity_schema.users (id, email, display_name, password_hash, kind) VALUES ($1, 'superadmin@platform.local', 'Platform Super Admin', $2, 'platform-admin') ON CONFLICT (id) DO NOTHING`, [SUPER_ADMIN_ID, hash]);
    return;
  }
  await client.query(`UPDATE identity_schema.users SET password_hash = $2, status = 'active' WHERE id = $1`, [SUPER_ADMIN_ID, hash]);
}
