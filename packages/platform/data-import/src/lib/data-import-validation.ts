import {
  DATA_IMPORT_SHEETS,
  dataImportRowCounts,
  type DataImportDataset,
  type DataImportIssue,
  type DataImportSheetName,
} from '@enterprise-platform/contracts-data-import';

export interface ExistingCoreImportState {
  readonly userEmails: ReadonlySet<string>;
  readonly nodeTypeCodes: ReadonlySet<string>;
  readonly treeCodes: ReadonlySet<string>;
  readonly nodeCodes: ReadonlySet<string>;
  readonly assignmentKeys: ReadonlySet<string>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE = /^[A-Z0-9][A-Z0-9._/-]{0,99}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateImportDataset(
  dataset: DataImportDataset,
  existing: ExistingCoreImportState,
): DataImportIssue[] {
  const issues: DataImportIssue[] = [];
  const counts = dataImportRowCounts(dataset);
  if (!Object.values(counts).some((count) => count > 0)) {
    issues.push(error('EMPTY_DATASET', 'File không có dòng dữ liệu để import.'));
    return issues;
  }

  validateUsers(dataset, existing, issues);
  validateOrganization(dataset, existing, issues);
  validateInventory(dataset, existing, issues);
  validateProcedures(dataset, existing, issues);
  validateMaintenance(dataset, issues);
  return issues;
}

function validateUsers(
  dataset: DataImportDataset,
  existing: ExistingCoreImportState,
  issues: DataImportIssue[],
): void {
  const seen = new Set<string>();
  dataset.users.forEach((user, index) => {
    const row = index + 2;
    if (!user.fullName.trim()) {
      issues.push(error('USER_NAME_REQUIRED', 'Họ tên là bắt buộc.', DATA_IMPORT_SHEETS.users, row, 'fullName'));
    }
    const email = user.email.trim().toLowerCase();
    if (!EMAIL.test(email)) {
      issues.push(error('USER_EMAIL_INVALID', 'Email người dùng không hợp lệ.', DATA_IMPORT_SHEETS.users, row, 'email'));
    }
    if (user.temporaryPassword.length < 12 || user.temporaryPassword.length > 128) {
      issues.push(error('USER_PASSWORD_INVALID', 'Mật khẩu tạm phải có từ 12 đến 128 ký tự.', DATA_IMPORT_SHEETS.users, row, 'temporaryPassword'));
    }
    if (!['tenant-admin', 'tenant-user'].includes(user.systemRole)) {
      issues.push(error('USER_ROLE_INVALID', 'systemRole chỉ nhận tenant-admin hoặc tenant-user.', DATA_IMPORT_SHEETS.users, row, 'systemRole'));
    }
    duplicateOrExisting(email, seen, existing.userEmails, issues, DATA_IMPORT_SHEETS.users, row, 'email', 'Email');
  });
  if (dataset.users.length) {
    issues.push({
      level: 'warning',
      code: 'TEMPORARY_PASSWORDS_INCLUDED',
      message: 'Workbook chứa mật khẩu tạm. Yêu cầu người dùng đổi mật khẩu sau lần đăng nhập đầu tiên.',
      sheet: DATA_IMPORT_SHEETS.users,
    });
  }
}

function validateOrganization(
  dataset: DataImportDataset,
  existing: ExistingCoreImportState,
  issues: DataImportIssue[],
): void {
  const typeCodes = new Set(existing.nodeTypeCodes);
  const newTypes = new Set<string>();
  dataset.organizationNodeTypes.forEach((item, index) => {
    const row = index + 2;
    validateCode(item.code, issues, DATA_IMPORT_SHEETS.organizationNodeTypes, row);
    if (!item.name.trim()) issues.push(error('NAME_REQUIRED', 'Tên loại node là bắt buộc.', DATA_IMPORT_SHEETS.organizationNodeTypes, row, 'name'));
    if (!['unit', 'position'].includes(item.category)) issues.push(error('CATEGORY_INVALID', 'category chỉ nhận unit hoặc position.', DATA_IMPORT_SHEETS.organizationNodeTypes, row, 'category'));
    duplicateOrExisting(item.code, newTypes, existing.nodeTypeCodes, issues, DATA_IMPORT_SHEETS.organizationNodeTypes, row, 'code', 'Mã loại node');
    typeCodes.add(item.code);
  });

  const treeCodes = new Set(existing.treeCodes);
  const newTrees = new Set<string>();
  dataset.organizationTrees.forEach((item, index) => {
    const row = index + 2;
    validateCode(item.code, issues, DATA_IMPORT_SHEETS.organizationTrees, row);
    if (!item.name.trim()) issues.push(error('NAME_REQUIRED', 'Tên sơ đồ là bắt buộc.', DATA_IMPORT_SHEETS.organizationTrees, row, 'name'));
    duplicateOrExisting(item.code, newTrees, existing.treeCodes, issues, DATA_IMPORT_SHEETS.organizationTrees, row, 'code', 'Mã sơ đồ');
    treeCodes.add(item.code);
  });
  if (dataset.organizationTrees.filter((tree) => tree.isPrimary).length > 1) {
    issues.push(error('MULTIPLE_PRIMARY_TREES', 'Chỉ được có một sơ đồ chính trong file.', DATA_IMPORT_SHEETS.organizationTrees));
  }

  const nodeCodes = new Set(existing.nodeCodes);
  const newNodes = new Set<string>();
  dataset.organizationNodes.forEach((item, index) => {
    const row = index + 2;
    validateCode(item.code, issues, DATA_IMPORT_SHEETS.organizationNodes, row);
    duplicateOrExisting(item.code, newNodes, existing.nodeCodes, issues, DATA_IMPORT_SHEETS.organizationNodes, row, 'code', 'Mã node');
    if (!item.name.trim()) issues.push(error('NAME_REQUIRED', 'Tên node là bắt buộc.', DATA_IMPORT_SHEETS.organizationNodes, row, 'name'));
    if (!treeCodes.has(item.treeCode)) issues.push(error('TREE_REFERENCE_MISSING', `Không tìm thấy sơ đồ ${item.treeCode}.`, DATA_IMPORT_SHEETS.organizationNodes, row, 'treeCode'));
    if (!typeCodes.has(item.nodeTypeCode)) issues.push(error('NODE_TYPE_REFERENCE_MISSING', `Không tìm thấy loại node ${item.nodeTypeCode}.`, DATA_IMPORT_SHEETS.organizationNodes, row, 'nodeTypeCode'));
    nodeCodes.add(item.code);
  });
  dataset.organizationNodes.forEach((item, index) => {
    if (item.parentCode && !nodeCodes.has(item.parentCode)) {
      issues.push(error('PARENT_NODE_MISSING', `Không tìm thấy node cha ${item.parentCode}.`, DATA_IMPORT_SHEETS.organizationNodes, index + 2, 'parentCode'));
    }
  });
  validateNodeCycles(dataset, issues);

  const userEmails = new Set([
    ...existing.userEmails,
    ...dataset.users.map((user) => user.email.toLowerCase()),
  ]);
  const assignments = new Set<string>();
  dataset.organizationAssignments.forEach((item, index) => {
    const row = index + 2;
    if (!nodeCodes.has(item.nodeCode)) issues.push(error('ASSIGNMENT_NODE_MISSING', `Không tìm thấy node ${item.nodeCode}.`, DATA_IMPORT_SHEETS.organizationAssignments, row, 'nodeCode'));
    if (!userEmails.has(item.userEmail.toLowerCase())) issues.push(error('ASSIGNMENT_USER_MISSING', `Không tìm thấy người dùng ${item.userEmail}.`, DATA_IMPORT_SHEETS.organizationAssignments, row, 'userEmail'));
    const key = `${item.nodeCode}:${item.userEmail.toLowerCase()}`;
    if (assignments.has(key)) issues.push(error('DUPLICATE_ASSIGNMENT', 'Bổ nhiệm bị lặp trong file.', DATA_IMPORT_SHEETS.organizationAssignments, row));
    if (existing.assignmentKeys.has(key)) issues.push(error('ASSIGNMENT_EXISTS', 'Bổ nhiệm đã tồn tại trong Tenant Core.', DATA_IMPORT_SHEETS.organizationAssignments, row));
    assignments.add(key);
    if (item.startDate && !ISO_DATE.test(item.startDate)) issues.push(error('DATE_INVALID', 'startDate phải theo định dạng YYYY-MM-DD.', DATA_IMPORT_SHEETS.organizationAssignments, row, 'startDate'));
  });
}

function validateNodeCycles(dataset: DataImportDataset, issues: DataImportIssue[]): void {
  const parent = new Map(dataset.organizationNodes.map((node) => [node.code, node.parentCode]));
  for (const node of dataset.organizationNodes) {
    const seen = new Set<string>([node.code]);
    let cursor = node.parentCode;
    while (cursor && parent.has(cursor)) {
      if (seen.has(cursor)) {
        issues.push(error('ORGANIZATION_CYCLE', `Cây tổ chức có vòng lặp tại node ${node.code}.`, DATA_IMPORT_SHEETS.organizationNodes));
        return;
      }
      seen.add(cursor);
      cursor = parent.get(cursor);
    }
  }
}

function validateInventory(
  dataset: DataImportDataset,
  existing: ExistingCoreImportState,
  issues: DataImportIssue[],
): void {
  const nodes = new Set([
    ...existing.nodeCodes,
    ...dataset.organizationNodes.map((node) => node.code),
  ]);
  if (dataset.inventorySettings.length > 1) {
    issues.push(error('MULTIPLE_INVENTORY_SETTINGS', 'Sheet INVENTORY_SETTINGS chỉ được có một dòng.', DATA_IMPORT_SHEETS.inventorySettings));
  }
  for (const [index, settings] of dataset.inventorySettings.entries()) {
    if (![settings.types, settings.enabledStatuses, settings.usageStates].every((values) => values.length > 0)) {
      issues.push(error('INVENTORY_SETTINGS_EMPTY', 'Ba danh mục Inventory không được để trống.', DATA_IMPORT_SHEETS.inventorySettings, index + 2));
    }
  }

  const warehouses = new Set<string>();
  dataset.inventoryWarehouses.forEach((item, index) => {
    const row = index + 2;
    validateCode(item.code, issues, DATA_IMPORT_SHEETS.inventoryWarehouses, index + 2);
    if (!item.name.trim()) issues.push(error('NAME_REQUIRED', 'Tên kho là bắt buộc.', DATA_IMPORT_SHEETS.inventoryWarehouses, index + 2, 'name'));
    duplicate(item.code, warehouses, issues, DATA_IMPORT_SHEETS.inventoryWarehouses, index + 2, 'Mã kho');
    if (item.organizationNodeCode && !nodes.has(item.organizationNodeCode)) {
      issues.push(error('WAREHOUSE_ORG_NODE_MISSING', `Không tìm thấy node ${item.organizationNodeCode}.`, DATA_IMPORT_SHEETS.inventoryWarehouses, row, 'organizationNodeCode'));
    }
  });
  const materials = new Set<string>();
  dataset.inventoryMaterials.forEach((item, index) => {
    const row = index + 2;
    validateCode(item.code, issues, DATA_IMPORT_SHEETS.inventoryMaterials, row);
    duplicate(item.code, materials, issues, DATA_IMPORT_SHEETS.inventoryMaterials, row, 'Mã vật tư');
    if (!item.name.trim() || !item.unit.trim()) issues.push(error('MATERIAL_REQUIRED_FIELDS', 'Tên và đơn vị tính là bắt buộc.', DATA_IMPORT_SHEETS.inventoryMaterials, row));
    if (!['SPARE_PART', 'CONSUMABLE', 'TOOL', 'ROTABLE'].includes(item.category)) issues.push(error('MATERIAL_CATEGORY_INVALID', 'Nhóm vật tư không hợp lệ.', DATA_IMPORT_SHEETS.inventoryMaterials, row, 'category'));
    if ((item.minStock ?? 0) < 0 || (item.maxStock ?? 0) < 0) issues.push(error('STOCK_BOUNDS_INVALID', 'Tồn min/max không được âm.', DATA_IMPORT_SHEETS.inventoryMaterials, row));
  });
  const assets = new Set<string>();
  dataset.inventoryAssets.forEach((item, index) => {
    const row = index + 2;
    validateCode(item.code, issues, DATA_IMPORT_SHEETS.inventoryAssets, row);
    duplicate(item.code, assets, issues, DATA_IMPORT_SHEETS.inventoryAssets, row, 'Mã thiết bị');
    if (!item.name.trim() || !item.type.trim()) issues.push(error('ASSET_REQUIRED_FIELDS', 'Tên và loại thiết bị là bắt buộc.', DATA_IMPORT_SHEETS.inventoryAssets, row));
    if (item.organizationNodeCode && !nodes.has(item.organizationNodeCode)) {
      issues.push(error('ASSET_ORG_NODE_MISSING', `Không tìm thấy node ${item.organizationNodeCode}.`, DATA_IMPORT_SHEETS.inventoryAssets, row, 'organizationNodeCode'));
    }
  });
  dataset.inventoryOpeningStock.forEach((item, index) => {
    const row = index + 2;
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) issues.push(error('QUANTITY_INVALID', 'Số lượng phải lớn hơn 0.', DATA_IMPORT_SHEETS.inventoryOpeningStock, row, 'quantity'));
    if (!Number.isFinite(item.unitCost) || item.unitCost < 0) issues.push(error('UNIT_COST_INVALID', 'Đơn giá không được âm.', DATA_IMPORT_SHEETS.inventoryOpeningStock, row, 'unitCost'));
  });
}

function validateProcedures(
  dataset: DataImportDataset,
  existing: ExistingCoreImportState,
  issues: DataImportIssue[],
): void {
  const nodes = new Set([...existing.nodeCodes, ...dataset.organizationNodes.map((node) => node.code)]);
  const definitions = new Set<string>();
  dataset.procedureDefinitions.forEach((definition, index) => {
    const row = index + 2;
    validateCode(definition.code, issues, DATA_IMPORT_SHEETS.procedureDefinitions, row);
    duplicate(definition.code, definitions, issues, DATA_IMPORT_SHEETS.procedureDefinitions, row, 'Mã quy trình');
    if (!definition.name.trim() || !definition.steps.length) issues.push(error('PROCEDURE_REQUIRED_FIELDS', 'Tên và ít nhất một bước là bắt buộc.', DATA_IMPORT_SHEETS.procedureDefinitions, row));
    if (!['process', 'maintenance_linked'].includes(definition.kind)) issues.push(error('PROCEDURE_KIND_INVALID', 'Loại quy trình không hợp lệ.', DATA_IMPORT_SHEETS.procedureDefinitions, row, 'kind'));
    const stepKeys = new Set<string>();
    definition.steps.forEach((step) => {
      if (!step.key?.trim() || !step.name?.trim()) issues.push(error('PROCEDURE_STEP_INVALID', `Quy trình ${definition.code} có bước thiếu key/name.`, DATA_IMPORT_SHEETS.procedureDefinitions, row, 'stepsJson'));
      if (stepKeys.has(step.key)) issues.push(error('DUPLICATE_STEP_KEY', `Quy trình ${definition.code} lặp bước ${step.key}.`, DATA_IMPORT_SHEETS.procedureDefinitions, row, 'stepsJson'));
      stepKeys.add(step.key);
      for (const assignment of step.assignments ?? []) {
        if (!['S', 'R', 'E', 'C', 'A', 'I'].includes(assignment.role)) issues.push(error('RACI_ROLE_INVALID', `Vai ${assignment.role} không hợp lệ.`, DATA_IMPORT_SHEETS.procedureDefinitions, row, 'stepsJson'));
        if (!nodes.has(assignment.subjectNodeCode)) issues.push(error('PROCEDURE_SUBJECT_MISSING', `Không tìm thấy node ${assignment.subjectNodeCode}.`, DATA_IMPORT_SHEETS.procedureDefinitions, row, 'stepsJson'));
      }
      for (const material of step.materials ?? []) {
        if (!Number.isFinite(material.quantity) || material.quantity <= 0) issues.push(error('PROCEDURE_MATERIAL_QUANTITY_INVALID', `Số lượng vật tư ${material.materialCode} phải lớn hơn 0.`, DATA_IMPORT_SHEETS.procedureDefinitions, row, 'stepsJson'));
      }
    });
    for (const step of definition.steps) {
      for (const assignment of step.assignments ?? []) {
        if (assignment.rollbackToStepKey && !stepKeys.has(assignment.rollbackToStepKey)) issues.push(error('ROLLBACK_STEP_MISSING', `Không tìm thấy bước quay lại ${assignment.rollbackToStepKey}.`, DATA_IMPORT_SHEETS.procedureDefinitions, row, 'stepsJson'));
      }
    }
  });
  dataset.procedureInstances.forEach((instance, index) => {
    if (!instance.title.trim() || !instance.idempotencyKey.trim()) issues.push(error('INSTANCE_REQUIRED_FIELDS', 'Tiêu đề và idempotencyKey là bắt buộc.', DATA_IMPORT_SHEETS.procedureInstances, index + 2));
  });
}

function validateMaintenance(dataset: DataImportDataset, issues: DataImportIssue[]): void {
  const scheduledAssets = new Set<string>();
  dataset.maintenanceSchedules.forEach((schedule, index) => {
    const row = index + 2;
    duplicate(schedule.assetCode, scheduledAssets, issues, DATA_IMPORT_SHEETS.maintenanceSchedules, row, 'Thiết bị có lịch');
    if (!['day', 'week', 'month', 'quarter', 'year'].includes(schedule.frequency)) issues.push(error('FREQUENCY_INVALID', 'Tần suất bảo trì không hợp lệ.', DATA_IMPORT_SHEETS.maintenanceSchedules, row, 'frequency'));
    if (schedule.priority && !['Low', 'Normal', 'High'].includes(schedule.priority)) issues.push(error('PRIORITY_INVALID', 'Độ ưu tiên bảo trì không hợp lệ.', DATA_IMPORT_SHEETS.maintenanceSchedules, row, 'priority'));
    if (schedule.startDate && !ISO_DATE.test(schedule.startDate)) issues.push(error('DATE_INVALID', 'startDate phải theo định dạng YYYY-MM-DD.', DATA_IMPORT_SHEETS.maintenanceSchedules, row, 'startDate'));
    if (!schedule.startDate && schedule.startOffsetDays === undefined) issues.push(error('SCHEDULE_START_REQUIRED', 'Cần startDate hoặc startOffsetDays.', DATA_IMPORT_SHEETS.maintenanceSchedules, row));
  });
}

function validateCode(value: string, issues: DataImportIssue[], sheet: DataImportSheetName, row: number): void {
  if (!CODE.test(value)) issues.push(error('CODE_INVALID', `Mã “${value}” không hợp lệ.`, sheet, row, 'code'));
}

function duplicate(value: string, seen: Set<string>, issues: DataImportIssue[], sheet: DataImportSheetName, row: number, label: string): void {
  if (seen.has(value)) issues.push(error('DUPLICATE_VALUE', `${label} ${value} bị lặp trong file.`, sheet, row));
  seen.add(value);
}

function duplicateOrExisting(value: string, seen: Set<string>, existing: ReadonlySet<string>, issues: DataImportIssue[], sheet: DataImportSheetName, row: number, field: string, label: string): void {
  duplicate(value, seen, issues, sheet, row, label);
  if (existing.has(value)) issues.push(error('VALUE_ALREADY_EXISTS', `${label} ${value} đã tồn tại trong tenant.`, sheet, row, field));
}

function error(code: string, message: string, sheet: DataImportSheetName | 'SYSTEM' = 'SYSTEM', row?: number, field?: string): DataImportIssue {
  return { level: 'error', code, message, sheet, row, field };
}
