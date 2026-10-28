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

/**
 * Tenant-core migrations shared by new-tenant provisioning, deploy-time
 * upgrades and module provisioning. Keep the explicit order: historical
 * filenames are not a reliable ordering key.
 */
export const TENANT_CORE_MIGRATIONS: readonly TenantModuleMigration[] = [
  { version: '0001-core-schema', path: 'tenant/core/0001-core-schema.sql' },
  {
    version: '0002-organization-soft-delete',
    path: 'tenant/core/0002-organization-soft-delete.sql',
  },
  {
    version: '0003-organization-tree-layout',
    path: 'tenant/core/0003-organization-tree-layout.sql',
  },
  {
    version: '0004-organization-category',
    path: 'tenant/core/0004-organization-category.sql',
  },
  {
    version: '0005-organization-head-position',
    path: 'tenant/core/0005-organization-head-position.sql',
  },
  {
    version: '0006-position-reports-to',
    path: 'tenant/core/0006-position-reports-to.sql',
  },
  {
    version: '0005-tenant-rbac-legacy-compat',
    path: 'tenant/core/0005-tenant-rbac-legacy-compat.sql',
  },
  {
    version: '0005-tenant-rbac',
    path: 'tenant/core/0005-tenant-rbac.sql',
  },
  {
    version: '0007-default-tenant-user-role',
    path: 'tenant/core/0007-default-tenant-user-role.sql',
  },
  { version: '0006-employees', path: 'tenant/core/0006-employees.sql' },
  {
    version: '0007-org-hrm-bridge',
    path: 'tenant/core/0007-org-hrm-bridge.sql',
  },
  {
    version: '0008-org-outbox-triggers',
    path: 'tenant/core/0008-org-outbox-triggers.sql',
  },
  {
    version: '0009-assignment-source-decision',
    path: 'tenant/core/0009-assignment-source-decision.sql',
  },
  {
    version: '0010-outbox-envelope-and-node-types',
    path: 'tenant/core/0010-outbox-envelope-and-node-types.sql',
  },
  {
    version: '0008-notifications',
    path: 'tenant/core/0008-notifications.sql',
  },
  {
    // Phải chạy sau các migration RBAC (0005-tenant-rbac, 0007-default-tenant-user-role).
    version: '0011-module-access-from-actions',
    path: 'tenant/core/0011-module-access-from-actions.sql',
  },
  {
    // Thay hàm trigger của 0005-tenant-rbac; cần outbox của tenant/0001-integration.
    version: '0012-authorization-changed-event',
    path: 'tenant/core/0012-authorization-changed-event.sql',
  },
  {
    // Dùng hàm trigger của 0012-authorization-changed-event.
    version: '0013-user-permission-grants',
    path: 'tenant/core/0013-user-permission-grants.sql',
  },
  { version: '0014-user-profiles', path: 'tenant/core/0014-user-profiles.sql' },
  // Chat nội bộ của core: chạy cho mọi tenant, không phụ thuộc phân hệ nào được bật.
  { version: '0015-core-chat', path: 'tenant/core/0015-core-chat.sql' },
  { version: '0016-web-push-subscriptions', path: 'tenant/core/0016-web-push-subscriptions.sql' },
  {
    version: '0014-hrm-request-approve-merge',
    path: 'tenant/core/0014-hrm-request-approve-merge.sql',
  },
];

export const TENANT_MODULE_MIGRATIONS: Readonly<
  Record<string, readonly TenantModuleMigration[]>
> = {
  // Trợ lý (savina-agent) không có bảng trong DB tenant; migration rỗng để bật phân hệ được.
  assistant: [{ version: '0001-assistant', path: 'tenant/assistant/0001-assistant.sql' }],
  // Bán hàng: khách hàng, cơ hội, báo giá, hợp đồng, đơn bán, công nợ, bảo hành.
  crm: [
    { version: '0001-crm-foundation', path: 'tenant/crm/0001-crm-foundation.sql' },
    { version: '0002-customers', path: 'tenant/crm/0002-customers.sql' },
    { version: '0003-leads-opportunities', path: 'tenant/crm/0003-leads-opportunities.sql' },
    { version: '0004-activities', path: 'tenant/crm/0004-activities.sql' },
    { version: '0005-pricing', path: 'tenant/crm/0005-pricing.sql' },
    { version: '0006-quotes', path: 'tenant/crm/0006-quotes.sql' },
    { version: '0007-contracts', path: 'tenant/crm/0007-contracts.sql' },
    { version: '0008-sales-orders', path: 'tenant/crm/0008-sales-orders.sql' },
    { version: '0009-receivables', path: 'tenant/crm/0009-receivables.sql' },
    { version: '0010-warranty', path: 'tenant/crm/0010-warranty.sql' },
  ],
  finance: [
    { version: '0001-finance', path: 'tenant/finance/0001-finance.sql' },
    { version: '0002-finance-approval', path: 'tenant/finance/0002-finance-approval.sql' },
    { version: '0003-finance-attachments', path: 'tenant/finance/0003-finance-attachments.sql' },
    { version: '0004-finance-workspace-links', path: 'tenant/finance/0004-finance-workspace-links.sql' },
    { version: '0005-finance-voucher-codes', path: 'tenant/finance/0005-finance-voucher-codes.sql' },
    { version: '0006-finance-voucher-sources', path: 'tenant/finance/0006-finance-voucher-sources.sql' },
    { version: '0007-finance-source-reversal', path: 'tenant/finance/0007-finance-source-reversal.sql' },
    { version: '0008-voucher-attachment-purpose', path: 'tenant/finance/0008-voucher-attachment-purpose.sql' },
    { version: '0009-finance-negative-balance-user-columns', path: 'tenant/finance/0009-finance-negative-balance-user-columns.sql' },
    { version: '0010-external-source', path: 'tenant/finance/0010-external-source.sql' },
  ],
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
    {
      version: '0016-hrm-lifecycle',
      path: 'tenant/hrm/0016-hrm-lifecycle.sql',
    },
    {
      version: '0016-family-contract-lifecycle',
      path: 'tenant/hrm/0016-family-contract-lifecycle.sql',
    },
    {
      version: '0016-time-lifecycle',
      path: 'tenant/hrm/0016-time-lifecycle.sql',
    },
    {
      version: '0017-hrm-request-drafts',
      path: 'tenant/hrm/0017-hrm-request-drafts.sql',
    },
    {
      version: '0018-hrm-request-reversals',
      path: 'tenant/hrm/0018-hrm-request-reversals.sql',
    },
    {
      version: '0019-timesheet-attachment-lifecycle',
      path: 'tenant/hrm/0019-timesheet-attachment-lifecycle.sql',
    },
    {
      version: '0020-payroll-lifecycle',
      path: 'tenant/hrm/0020-payroll-lifecycle.sql',
    },
    {
      version: '0021-hrm-offboarding-event',
      path: 'tenant/hrm/0021-hrm-offboarding-event.sql',
    },
    {
      version: '0022-hrm-policy-single-owner',
      path: 'tenant/hrm/0022-hrm-policy-single-owner.sql',
    },
    {
      version: '0024-leave-type-merge',
      path: 'tenant/hrm/0024-leave-type-merge.sql',
    },
    {
      version: '0026-payroll-segregation-of-duties',
      path: 'tenant/hrm/0026-payroll-segregation-of-duties.sql',
    },
    {
      version: '0027-hrm-default-direct-bindings',
      path: 'tenant/hrm/0027-hrm-default-direct-bindings.sql',
    },
    {
      version: '0028-hrm-approval-policy',
      path: 'tenant/hrm/0028-hrm-approval-policy.sql',
    },
    {
      version: '0029-hrm-procedure-step-progress',
      path: 'tenant/hrm/0029-hrm-procedure-step-progress.sql',
    },
    {
      version: '0030-hrm-procedure-field-mappings',
      path: 'tenant/hrm/0030-hrm-procedure-field-mappings.sql',
    },
    {
      version: '0031-hrm-profile-documents',
      path: 'tenant/hrm/0031-hrm-profile-documents.sql',
    },
    {
      version: '0032-hrm-personnel-decisions',
      path: 'tenant/hrm/0032-hrm-personnel-decisions.sql',
    },
    {
      version: '0033-leave-annual-policy',
      path: 'tenant/hrm/0033-leave-annual-policy.sql',
    },
    {
      version: '0034-hrm-unit-shift-assignments',
      path: 'tenant/hrm/0034-hrm-unit-shift-assignments.sql',
    },
    {
      version: '0035-hrm-work-schedules',
      path: 'tenant/hrm/0035-hrm-work-schedules.sql',
    },
    {
      version: '0036-hrm-work-schedule-rules',
      path: 'tenant/hrm/0036-hrm-work-schedule-rules.sql',
    },
    {
      version: '0035-leave-no-pending-hold',
      path: 'tenant/hrm/0035-leave-no-pending-hold.sql',
    },
    {
      version: '0036-leave-unpaid-no-balance',
      path: 'tenant/hrm/0036-leave-unpaid-no-balance.sql',
    },
    {
      version: '0037-request-reason-catalog',
      path: 'tenant/hrm/0037-request-reason-catalog.sql',
    },
    {
      version: '0038-request-reason-categories',
      path: 'tenant/hrm/0038-request-reason-categories.sql',
    },
    {
      version: '0039-request-catalog-codes',
      path: 'tenant/hrm/0039-request-catalog-codes.sql',
    },
    {
      version: '0043-ot-type-info-no-coordinates',
      path: 'tenant/hrm/0043-ot-type-info-no-coordinates.sql',
    },
    {
      version: '0044-hrm-annual-leave-single-policy',
      path: 'tenant/hrm/0044-hrm-annual-leave-single-policy.sql',
    },
    {
      version: '0045-hrm-request-reasons',
      path: 'tenant/hrm/0045-hrm-request-reasons.sql',
    },
    {
      version: '0046-hrm-timesheet-month-close',
      path: 'tenant/hrm/0046-hrm-timesheet-month-close.sql',
    },
    {
      version: '0047-hrm-request-types',
      path: 'tenant/hrm/0047-hrm-request-types.sql',
    },
    {
      version: '0048-hrm-timesheet-payroll-linkage',
      path: 'tenant/hrm/0048-hrm-timesheet-payroll-linkage.sql',
    },
    {
      version: '0049-hrm-ot-reason-rate',
      path: 'tenant/hrm/0049-hrm-ot-reason-rate.sql',
    },
    {
      version: '0050-hrm-request-comments',
      path: 'tenant/hrm/0050-hrm-request-comments.sql',
    },
    {
      version: '0051-hrm-leave-settlements-legacy',
      path: 'tenant/hrm/0051-hrm-leave-settlements-legacy.sql',
    },
    {
      version: '0052-hrm-timesheet-standard-policies',
      path: 'tenant/hrm/0052-hrm-timesheet-standard-policies.sql',
    },
    {
      version: '0053-hrm-schedule-auto-attendance',
      path: 'tenant/hrm/0053-hrm-schedule-auto-attendance.sql',
    },
    {
      version: '0054-hrm-direct-fallback-position',
      path: 'tenant/hrm/0054-hrm-direct-fallback-position.sql',
    },
    {
      version: '0055-hrm-auto-attendance-settings',
      path: 'tenant/hrm/0055-hrm-auto-attendance-settings.sql',
    },
    { version: '0056-hrm-fleet', path: 'tenant/hrm/0056-hrm-fleet.sql' },
    {
      version: '0056-hrm-shift-soft-delete',
      path: 'tenant/hrm/0056-hrm-shift-soft-delete.sql',
    },
    {
      version: '0057-hrm-leave-type-code-partial-unique',
      path: 'tenant/hrm/0057-hrm-leave-type-code-partial-unique.sql',
    },
    {
      version: '0058-hrm-system-request-type-legacy-code',
      path: 'tenant/hrm/0058-hrm-system-request-type-legacy-code.sql',
    },
    {
      version: '0059-hrm-request-comment-attachments',
      path: 'tenant/hrm/0059-hrm-request-comment-attachments.sql',
    },
    {
      version: '0060-hrm-personnel-decision-recorded',
      path: 'tenant/hrm/0060-hrm-personnel-decision-recorded.sql',
    },
    {
      version: '0061-hrm-personnel-decision-revoke',
      path: 'tenant/hrm/0061-hrm-personnel-decision-revoke.sql',
    },
    {
      version: '0062-hrm-personnel-decision-chain',
      path: 'tenant/hrm/0062-hrm-personnel-decision-chain.sql',
    },
    {
      version: '0063-hrm-leave-adjustment-actor-required',
      path: 'tenant/hrm/0063-hrm-leave-adjustment-actor-required.sql',
    },
    {
      version: '0064-hrm-request-quota-settings',
      path: 'tenant/hrm/0064-hrm-request-quota-settings.sql',
    },
    {
      version: '0065-hrm-attendance-source-auto',
      path: 'tenant/hrm/0065-hrm-attendance-source-auto.sql',
    },
    {
      version: '0066-hrm-auto-attendance-employees',
      path: 'tenant/hrm/0066-hrm-auto-attendance-employees.sql',
    },
    {
      version: '0067-hrm-backfill-calendar-holidays',
      path: 'tenant/hrm/0067-hrm-backfill-calendar-holidays.sql',
    },
    {
      version: '0068-hrm-drop-attendance-devices',
      path: 'tenant/hrm/0068-hrm-drop-attendance-devices.sql',
    },
    {
      version: '0021-notification-outbox-v1',
      path: 'tenant/hrm/0021-notification-outbox-v1.sql',
    },
    {
      version: '0034-hrm-offboarding-event-envelope',
      path: 'tenant/hrm/0034-hrm-offboarding-event-envelope.sql',
    },
    {
      version: '0034-hrm-request-project-links',
      path: 'tenant/hrm/0034-hrm-request-project-links.sql',
    },
    {
      version: '0035-hrm-request-trip-links',
      path: 'tenant/hrm/0035-hrm-request-trip-links.sql',
    },
    {
      version: '0036-hrm-project-request-reversed',
      path: 'tenant/hrm/0036-hrm-project-request-reversed.sql',
    },
    {
      version: '0052-leave-transaction-trigger-source',
      path: 'tenant/hrm/0052-leave-transaction-trigger-source.sql',
    },
    {
      version: '0069-hrm-request-on-behalf',
      path: 'tenant/hrm/0069-hrm-request-on-behalf.sql',
    },
    {
      version: '0070-hrm-attendance-site-assignments',
      path: 'tenant/hrm/0070-hrm-attendance-site-assignments.sql',
    },
    {
      version: '0071-hrm-attendance-location-settings',
      path: 'tenant/hrm/0071-hrm-attendance-location-settings.sql',
    },
    {
      version: '0072-hrm-attendance-site-unit-exclusions',
      path: 'tenant/hrm/0072-hrm-attendance-site-unit-exclusions.sql',
    },
    {
      version: '0073-hrm-direct-approver-source',
      path: 'tenant/hrm/0073-hrm-direct-approver-source.sql',
    },
    {
      version: '0074-hrm-correction-on-behalf',
      path: 'tenant/hrm/0074-hrm-correction-on-behalf.sql',
    },
    {
      version: '0075-hrm-last-resort-approver',
      path: 'tenant/hrm/0075-hrm-last-resort-approver.sql',
    },
    {
      version: '0076-hrm-request-time-rules',
      path: 'tenant/hrm/0076-hrm-request-time-rules.sql',
    },
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
    {
      version: '0011-stock-documents',
      path: 'tenant/inventory/0011-stock-documents.sql',
    },
    {
      version: '0012-reservation-source',
      path: 'tenant/inventory/0012-reservation-source.sql',
    },
    {
      version: '0013-serial-quality',
      path: 'tenant/inventory/0013-serial-quality.sql',
    },
    { version: '0014-lots', path: 'tenant/inventory/0014-lots.sql' },
    {
      version: '0015-quality-blocked',
      path: 'tenant/inventory/0015-quality-blocked.sql',
    },
    { version: '0016-costing', path: 'tenant/inventory/0016-costing.sql' },
    {
      version: '0017-service-kind',
      path: 'tenant/inventory/0017-service-kind.sql',
    },
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
    {
      version: '0013-instance-reversal',
      path: 'tenant/procedure/0013-instance-reversal.sql',
    },
    {
      version: '0014-everyone-subject',
      path: 'tenant/procedure/0014-everyone-subject.sql',
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
    {
      version: '0007-maintenance-fleet-transport',
      path: 'tenant/maintenance/0007-maintenance-fleet-transport.sql',
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
    {
      version: '0010-workspace-document-folder-refs',
      path: 'tenant/workspace/0010-workspace-document-folder-refs.sql',
    },
    {
      version: '0011-workspace-participants-project-type',
      path: 'tenant/workspace/0011-workspace-participants-project-type.sql',
    },
    {
      version: '0012-workspace-procedure-requests',
      path: 'tenant/workspace/0012-workspace-procedure-requests.sql',
    },
    {
      version: '0013-workspace-project-requests',
      path: 'tenant/workspace/0013-workspace-project-requests.sql',
    },
    {
      version: '0014-workspace-project-request-trip-links',
      path: 'tenant/workspace/0014-workspace-project-request-trip-links.sql',
    },
    {
      version: '0015-workspace-workday-rules',
      path: 'tenant/workspace/0015-workspace-workday-rules.sql',
    },
    {
      version: '0016-workspace-saved-filter-project-requests',
      path: 'tenant/workspace/0016-workspace-saved-filter-project-requests.sql',
    },
    {
      version: '0017-workspace-work-item-reversal',
      path: 'tenant/workspace/0017-workspace-work-item-reversal.sql',
    },
    {
      version: '0018-workspace-project-request-reversal',
      path: 'tenant/workspace/0018-workspace-project-request-reversal.sql',
    },
    {
      version: '0019-workspace-status-history-deletion-log',
      path: 'tenant/workspace/0019-workspace-status-history-deletion-log.sql',
    },
    {
      version: '0020-workspace-project-role-definitions',
      path: 'tenant/workspace/0020-workspace-project-role-definitions.sql',
    },
    {
      version: '0021-workspace-standalone-tasks',
      path: 'tenant/workspace/0021-workspace-standalone-tasks.sql',
    },
    {
      version: '0022-workspace-fleet-transport',
      path: 'tenant/workspace/0022-workspace-fleet-transport.sql',
    },
    {
      version: '0023-workspace-customers-contracts',
      path: 'tenant/workspace/0023-workspace-customers-contracts.sql',
    },
    {
      version: '0024-workspace-document-audience',
      path: 'tenant/workspace/0024-workspace-document-audience.sql',
    },
    {
      version: '0025-workspace-contract-project',
      path: 'tenant/workspace/0025-workspace-contract-project.sql',
    },
    {
      version: '0026-workspace-project-groups',
      path: 'tenant/workspace/0026-workspace-project-groups.sql',
    },
    {
      version: '0027-workspace-project-archive',
      path: 'tenant/workspace/0027-workspace-project-archive.sql',
    },
    {
      version: '0028-workspace-project-code-rule',
      path: 'tenant/workspace/0028-workspace-project-code-rule.sql',
    },
    {
      version: '0029-workspace-inline-edit',
      path: 'tenant/workspace/0029-workspace-inline-edit.sql',
    },
    {
      version: '0030-workspace-standalone-inline-edit',
      path: 'tenant/workspace/0030-workspace-standalone-inline-edit.sql',
    },
    { version: '0031-crm-customer-link', path: 'tenant/workspace/0031-crm-customer-link.sql' },
  ],
  // Hệ dùng chung: phần đầu là Tài liệu công ty (kho tách khỏi tài liệu dự án).
  shared: [
    { version: '0001-shared-documents', path: 'tenant/shared/0001-shared-documents.sql' },
    { version: '0002-shared-trash', path: 'tenant/shared/0002-shared-trash.sql' },
    { version: '0003-shared-folder-shares', path: 'tenant/shared/0003-shared-folder-shares.sql' },
  ],
  // Mạng nội bộ: bảng tin công ty.
  social: [
    { version: '0001-social-feed', path: 'tenant/social/0001-social-feed.sql' },
    { version: '0002-social-groups', path: 'tenant/social/0002-social-groups.sql' },
    { version: '0003-social-post-p2', path: 'tenant/social/0003-social-post-p2.sql' },
    {
      version: '0004-social-visibility-groups-v2',
      path: 'tenant/social/0004-social-visibility-groups-v2.sql',
    },
    { version: '0005-social-comment-reactions', path: 'tenant/social/0005-social-comment-reactions.sql' },
    { version: '0006-social-comment-attachments', path: 'tenant/social/0006-social-comment-attachments.sql' },
    { version: '0007-social-video-processing', path: 'tenant/social/0007-social-video-processing.sql' },
    { version: '0008-social-post-media-layout', path: 'tenant/social/0008-social-post-media-layout.sql' },
    { version: '0009-social-post-topics', path: 'tenant/social/0009-social-post-topics.sql' },
    { version: '0010-social-more-reactions', path: 'tenant/social/0010-social-more-reactions.sql' },
    { version: '0011-social-bookmark-folders', path: 'tenant/social/0011-social-bookmark-folders.sql' },
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