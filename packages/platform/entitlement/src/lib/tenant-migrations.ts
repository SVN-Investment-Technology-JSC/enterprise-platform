/**
 * Danh sách migration của từng module — **nguồn sự thật duy nhất**.
 *
 * Trước đây danh sách này tồn tại hai bản: một trong `apps/migrator` (nâng cấp
 * tenant đã có, chạy lúc khởi động) và một trong `tenant-provisioning.processor`
 * (cấp phát tenant mới, chạy trong worker). Không có gì bắt hai bản khớp nhau,
 * nên chúng đã lệch: một đợt thêm 10 migration chỉ vào bản thứ nhất khiến MỌI
 * tenant tạo mới thiếu 10 migration cho tới lần khởi động stack kế tiếp — đúng
 * vào lúc khách hàng mới vừa đăng ký.
 *
 * Gộp về một chỗ thì lệch là chuyện không thể xảy ra nữa. Thêm migration mới:
 * sửa đúng file này, cả hai đường chạy đều thấy.
 *
 * `version` KHÔNG suy ra được từ tên file — `0003-runtime-model` trỏ vào
 * `0002-runtime-model.sql` do một lần đặt tên lệch trong quá khứ. Đó là lý do
 * danh sách phải khai tay chứ không quét thư mục: quét sẽ đăng ký lại migration
 * đó dưới một `version` khác và chạy lại nó trên các tenant đang chạy.
 */
export interface TenantModuleMigration {
  readonly version: string;
  /** Đường dẫn tương đối từ thư mục `migrations/`. */
  readonly path: string;
}

export const TENANT_MODULE_MIGRATIONS: Readonly<
  Record<string, readonly TenantModuleMigration[]>
> = {
  inventory: [
    { version: '0001-inventory', path: 'tenant/inventory/0001-inventory.sql' },
    { version: '0002-inventory-balance-unique', path: 'tenant/inventory/0002-inventory-balance-unique.sql' },
    { version: '0003-inventory-settings', path: 'tenant/inventory/0003-inventory-settings.sql' },
    { version: '0004-asset-fields', path: 'tenant/inventory/0004-asset-fields.sql' },
    { version: '0005-asset-documents', path: 'tenant/inventory/0005-asset-documents.sql' },
    { version: '0006-merge-assets', path: 'tenant/inventory/0006-merge-assets.sql' },
    // 0007-drop-legacy-assets CỐ Ý chưa có mặt: bảng cũ là đường lui duy nhất
    // của lượt gộp 0006, chỉ đăng ký sau khi bản gộp chạy ổn một chu kỳ vận hành.
  ],
  'procedure-engine': [
    { version: '0001-procedure', path: 'tenant/procedure/0001-procedure.sql' },
    { version: '0002-normalized-model', path: 'tenant/procedure/0002-normalized-model.sql' },
    { version: '0003-runtime-model', path: 'tenant/procedure/0002-runtime-model.sql' },
    { version: '0004-delegation-roles', path: 'tenant/procedure/0004-delegation-roles.sql' },
    { version: '0005-subtask-attachments', path: 'tenant/procedure/0005-subtask-attachments.sql' },
    { version: '0006-attachment-survives-writes', path: 'tenant/procedure/0006-attachment-survives-writes.sql' },
    { version: '0007-procedure-settings', path: 'tenant/procedure/0007-procedure-settings.sql' },
    { version: '0008-definition-category', path: 'tenant/procedure/0008-definition-category.sql' },
    { version: '0009-subtask-materials', path: 'tenant/procedure/0009-subtask-materials.sql' },
  ],
  maintenance: [
    { version: '0001-maintenance', path: 'tenant/maintenance/0001-maintenance.sql' },
    { version: '0002-inventory-integration', path: 'tenant/maintenance/0002-inventory-integration.sql' },
    { version: '0003-incident-and-history', path: 'tenant/maintenance/0003-incident-and-history.sql' },
    { version: '0004-maintenance-settings', path: 'tenant/maintenance/0004-maintenance-settings.sql' },
    { version: '0005-frequency-drop-check', path: 'tenant/maintenance/0005-frequency-drop-check.sql' },
  ],
  crm: [{ version: '0001-crm', path: 'tenant/crm/0001-crm.sql' }],
};

/**
 * Migration của một module; module lạ trả mảng rỗng.
 *
 * Trả rỗng chứ không rơi về CRM như bản cũ của migrator: một `module_key` gõ sai
 * đáng lẽ phải không làm gì, chứ không được âm thầm dựng schema của module khác.
 */
export function tenantModuleMigrations(moduleKey: string): readonly TenantModuleMigration[] {
  return TENANT_MODULE_MIGRATIONS[moduleKey] ?? [];
}
