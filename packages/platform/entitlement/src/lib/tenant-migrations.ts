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
  hrm: [
    { version: '0001-hrm', path: 'tenant/hrm/0001-hrm.sql' },
    {
      version: '0002-employee-identity',
      path: 'tenant/hrm/0002-employee-identity.sql',
    },
    {
      version: '0002-hrm-procedure-integration',
      path: 'tenant/hrm/0002-hrm-procedure-integration.sql',
    },
    {
      version: '0003-hrm-requests-enhancement',
      path: 'tenant/hrm/0003-hrm-requests-enhancement.sql',
    },
    {
      version: '0003-time-operations',
      path: 'tenant/hrm/0003-time-operations.sql',
    },
    {
      version: '0004-leave-operations',
      path: 'tenant/hrm/0004-leave-operations.sql',
    },
    {
      version: '0005-timesheet-calculation',
      path: 'tenant/hrm/0005-timesheet-calculation.sql',
    },
    {
      version: '0006-payroll-formulas',
      path: 'tenant/hrm/0006-payroll-formulas.sql',
    },
    {
      version: '0007-work-references',
      path: 'tenant/hrm/0007-work-references.sql',
    },
    {
      version: '0008-profile-corrections',
      path: 'tenant/hrm/0008-profile-corrections.sql',
    },
    {
      version: '0009-leave-carryover',
      path: 'tenant/hrm/0009-leave-carryover.sql',
    },
    { version: '0010-attachments', path: 'tenant/hrm/0010-attachments.sql' },
    {
      version: '0011-advance-settlement',
      path: 'tenant/hrm/0011-advance-settlement.sql',
    },
    {
      version: '0012-operations-and-workflow',
      path: 'tenant/hrm/0012-operations-and-workflow.sql',
    },
    // Compatibility must precede 0013 for tenants with the legacy family table.
    // Versions are durable identities; execution follows this explicit order.
    {
      version: '0014-hrm-profile-compatibility',
      path: 'tenant/hrm/0014-hrm-profile-compatibility.sql',
    },
    {
      version: '0013-payroll-support',
      path: 'tenant/hrm/0013-payroll-support.sql',
    },
    {
      version: '0015-hrm-procedure-sync',
      path: 'tenant/hrm/0015-hrm-procedure-sync.sql',
    },
    {
      version: '0015-procedure-definition-snapshot',
      path: 'tenant/hrm/0015-procedure-definition-snapshot.sql',
    },
    {
      version: '0015-shift-submission',
      path: 'tenant/hrm/0015-shift-submission.sql',
    },
    { version: '0016-hrm-lifecycle', path: 'tenant/hrm/0016-hrm-lifecycle.sql' },
    { version: '0016-family-contract-lifecycle', path: 'tenant/hrm/0016-family-contract-lifecycle.sql' },
  ],
  inventory: [
    { version: '0001-inventory', path: 'tenant/inventory/0001-inventory.sql' },
    {
      version: '0002-inventory-balance-unique',
      path: 'tenant/inventory/0002-inventory-balance-unique.sql',
    },
    {
      version: '0003-inventory-settings',
      path: 'tenant/inventory/0003-inventory-settings.sql',
    },
    {
      version: '0004-asset-fields',
      path: 'tenant/inventory/0004-asset-fields.sql',
    },
    {
      version: '0005-asset-documents',
      path: 'tenant/inventory/0005-asset-documents.sql',
    },
    {
      version: '0006-merge-assets',
      path: 'tenant/inventory/0006-merge-assets.sql',
    },
    {
      version: '0008-material-origin',
      path: 'tenant/inventory/0008-material-origin.sql',
    },
    {
      version: '0009-usage-state',
      path: 'tenant/inventory/0009-usage-state.sql',
    },
    { version: '0010-stocktake', path: 'tenant/inventory/0010-stocktake.sql' },
    // 0007-drop-legacy-assets CỐ Ý chưa có mặt: bảng cũ là đường lui duy nhất
    // của lượt gộp 0006, chỉ đăng ký sau khi bản gộp chạy ổn một chu kỳ vận hành.
  ],
  'procedure-engine': [
    { version: '0001-procedure', path: 'tenant/procedure/0001-procedure.sql' },
    {
      version: '0002-normalized-model',
      path: 'tenant/procedure/0002-normalized-model.sql',
    },
    {
      version: '0003-runtime-model',
      path: 'tenant/procedure/0002-runtime-model.sql',
    },
    {
      version: '0004-delegation-roles',
      path: 'tenant/procedure/0004-delegation-roles.sql',
    },
    {
      version: '0005-subtask-attachments',
      path: 'tenant/procedure/0005-subtask-attachments.sql',
    },
    {
      version: '0006-attachment-survives-writes',
      path: 'tenant/procedure/0006-attachment-survives-writes.sql',
    },
    {
      version: '0007-procedure-settings',
      path: 'tenant/procedure/0007-procedure-settings.sql',
    },
    {
      version: '0008-definition-category',
      path: 'tenant/procedure/0008-definition-category.sql',
    },
    {
      version: '0009-subtask-materials',
      path: 'tenant/procedure/0009-subtask-materials.sql',
    },
    {
      version: '0010-migrate-unit-assignments-to-positions',
      path: 'tenant/procedure/0010-migrate-unit-assignments-to-positions.sql',
    },
    {
      version: '0011-dynamic-assignment',
      path: 'tenant/procedure/0011-dynamic-assignment.sql',
    },
    {
      version: '0012-step-instance-orphan-step',
      path: 'tenant/procedure/0012-step-instance-orphan-step.sql',
    },
  ],
  maintenance: [
    {
      version: '0001-maintenance',
      path: 'tenant/maintenance/0001-maintenance.sql',
    },
    {
      version: '0002-inventory-integration',
      path: 'tenant/maintenance/0002-inventory-integration.sql',
    },
    {
      version: '0003-incident-and-history',
      path: 'tenant/maintenance/0003-incident-and-history.sql',
    },
    {
      version: '0004-maintenance-settings',
      path: 'tenant/maintenance/0004-maintenance-settings.sql',
    },
    {
      version: '0005-frequency-drop-check',
      path: 'tenant/maintenance/0005-frequency-drop-check.sql',
    },
    {
      version: '0006-occurrence-attachments',
      path: 'tenant/maintenance/0006-occurrence-attachments.sql',
    },
  ],
  workspace: [
    { version: '0001-workspace', path: 'tenant/workspace/0001-workspace.sql' },
    { version: '0002-workspace-documents', path: 'tenant/workspace/0002-workspace-documents.sql' },
    { version: '0003-workspace-calendar', path: 'tenant/workspace/0003-workspace-calendar.sql' },
    { version: '0004-workspace-chat', path: 'tenant/workspace/0004-workspace-chat.sql' },
    { version: '0005-workspace-dashboard', path: 'tenant/workspace/0005-workspace-dashboard.sql' },
    { version: '0006-workspace-finance-index', path: 'tenant/workspace/0006-workspace-finance-index.sql' },
    { version: '0007-workspace-cost-entries', path: 'tenant/workspace/0007-workspace-cost-entries.sql' },
    {
      version: '0008-workspace-folder-unique-names',
      path: 'tenant/workspace/0008-workspace-folder-unique-names.sql',
    },
    {
      version: '0009-workspace-folder-active-unique',
      path: 'tenant/workspace/0009-workspace-folder-active-unique.sql',
    },
  ],
};

/**
 * Migration của một module; module lạ trả mảng rỗng.
 *
 * Trả rỗng thay vì chọn nhầm module: một `module_key` gõ sai
 * đáng lẽ phải không làm gì, chứ không được âm thầm dựng schema của module khác.
 */
export function tenantModuleMigrations(
  moduleKey: string,
): readonly TenantModuleMigration[] {
  return TENANT_MODULE_MIGRATIONS[moduleKey] ?? [];
}
