export const DATA_IMPORT_SHEETS = {
  users: 'USERS',
  organizationNodeTypes: 'ORG_NODE_TYPES',
  organizationTrees: 'ORG_TREES',
  organizationNodes: 'ORG_NODES',
  organizationAssignments: 'ORG_ASSIGNMENTS',
  inventorySettings: 'INVENTORY_SETTINGS',
  inventoryWarehouses: 'WAREHOUSES',
  inventoryMaterials: 'MATERIALS',
  inventoryAssets: 'ASSETS',
  inventoryOpeningStock: 'OPENING_STOCK',
  procedureDefinitions: 'PROCEDURES',
  procedureInstances: 'PROCEDURE_INSTANCES',
  maintenanceSchedules: 'MAINTENANCE_SCHEDULES',
} as const;

export type DataImportSheetName =
  (typeof DATA_IMPORT_SHEETS)[keyof typeof DATA_IMPORT_SHEETS];

export type DataImportModuleKey =
  | 'inventory'
  | 'procedure-engine'
  | 'maintenance';

export interface ImportTenantUserRow {
  readonly fullName: string;
  readonly email: string;
  readonly temporaryPassword: string;
  readonly systemRole: 'tenant-admin' | 'tenant-user';
}

export interface ImportOrganizationNodeTypeRow {
  readonly code: string;
  readonly name: string;
  readonly category: 'unit' | 'position';
  readonly description?: string;
  readonly sortOrder?: number;
}

export interface ImportOrganizationTreeRow {
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly isPrimary?: boolean;
}

export interface ImportOrganizationNodeRow {
  readonly treeCode: string;
  readonly parentCode?: string;
  readonly nodeTypeCode: string;
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly sortOrder?: number;
}

export interface ImportOrganizationAssignmentRow {
  readonly nodeCode: string;
  readonly userEmail: string;
  readonly isPrimary?: boolean;
  readonly startDate?: string;
  readonly note?: string;
}

export interface ImportInventorySettingsRow {
  readonly types: readonly string[];
  readonly enabledStatuses: readonly string[];
  readonly usageStates: readonly string[];
}

export interface ImportWarehouseRow {
  readonly code: string;
  readonly name: string;
  readonly type?: 'PHYSICAL' | 'VIRTUAL_IN_TRANSIT';
  readonly organizationNodeCode?: string;
  readonly location?: string;
}

export interface ImportMaterialRow {
  readonly code: string;
  readonly name: string;
  readonly category: 'SPARE_PART' | 'CONSUMABLE' | 'TOOL' | 'ROTABLE';
  readonly unit: string;
  readonly minStock?: number;
  readonly maxStock?: number;
  readonly isSerialized?: boolean;
  readonly barcode?: string;
  readonly manufactureYear?: number;
  readonly supplier?: string;
  readonly manufacturer?: string;
  readonly purchasePrice?: number;
  readonly currency?: string;
}

export interface ImportAssetTaskItem {
  readonly key: string;
  readonly name: string;
  readonly durationMinutes?: number;
  readonly note?: string;
}

export interface ImportAssetRow {
  readonly code: string;
  readonly name: string;
  readonly type: string;
  readonly parentCode?: string;
  readonly organizationNodeCode?: string;
  readonly status?: string;
  readonly criticality?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  readonly specs?: Record<string, unknown>;
  readonly taskTemplate?: readonly ImportAssetTaskItem[];
  readonly unit?: string;
  readonly purchasePrice?: number;
  readonly currency?: string;
  readonly warrantyUntil?: string;
  readonly manufactureYear?: number;
  readonly supplier?: string;
  readonly manufacturer?: string;
}

export interface ImportOpeningStockRow {
  readonly warehouseCode: string;
  readonly materialCode: string;
  readonly quantity: number;
  readonly unitCost: number;
  readonly note?: string;
}

export interface ImportProcedureMaterialRow {
  readonly materialCode: string;
  readonly quantity: number;
}

export interface ImportProcedureAssignmentRow {
  readonly role: 'S' | 'R' | 'E' | 'C' | 'A' | 'I';
  readonly subjectNodeCode: string;
  readonly subjectLabel?: string;
  readonly rollbackToStepKey?: string;
  readonly eTaskSource?: 'manual' | 'inventory_asset';
  readonly eTaskConfig?: Record<string, unknown>;
}

export interface ImportProcedureStepRow {
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly slaHours?: number;
  readonly linkedDefinitionCode?: string;
  readonly materials?: readonly ImportProcedureMaterialRow[];
  readonly assignments: readonly ImportProcedureAssignmentRow[];
}

export interface ImportProcedureDefinitionRow {
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly kind: 'process' | 'maintenance_linked';
  readonly category?: string;
  readonly draft?: boolean;
  readonly steps: readonly ImportProcedureStepRow[];
}

export interface ImportProcedureInstanceRow {
  readonly definitionCode: string;
  readonly title: string;
  readonly idempotencyKey: string;
  readonly assetCode?: string;
}

export interface ImportMaintenanceScheduleRow {
  readonly assetCode: string;
  readonly procedureCode?: string;
  readonly frequency: 'day' | 'week' | 'month' | 'quarter' | 'year';
  readonly priority?: 'Low' | 'Normal' | 'High';
  readonly startDate?: string;
  readonly startOffsetDays?: number;
  readonly timezone?: string;
  readonly activate?: boolean;
}

export interface DataImportDataset {
  readonly users: readonly ImportTenantUserRow[];
  readonly organizationNodeTypes: readonly ImportOrganizationNodeTypeRow[];
  readonly organizationTrees: readonly ImportOrganizationTreeRow[];
  readonly organizationNodes: readonly ImportOrganizationNodeRow[];
  readonly organizationAssignments: readonly ImportOrganizationAssignmentRow[];
  readonly inventorySettings: readonly ImportInventorySettingsRow[];
  readonly inventoryWarehouses: readonly ImportWarehouseRow[];
  readonly inventoryMaterials: readonly ImportMaterialRow[];
  readonly inventoryAssets: readonly ImportAssetRow[];
  readonly inventoryOpeningStock: readonly ImportOpeningStockRow[];
  readonly procedureDefinitions: readonly ImportProcedureDefinitionRow[];
  readonly procedureInstances: readonly ImportProcedureInstanceRow[];
  readonly maintenanceSchedules: readonly ImportMaintenanceScheduleRow[];
}

export type DataImportDatasetKey = keyof DataImportDataset;

export interface DataImportIssue {
  readonly level: 'error' | 'warning';
  readonly code: string;
  readonly message: string;
  readonly sheet?: DataImportSheetName | 'SYSTEM';
  readonly row?: number;
  readonly field?: string;
}

export interface DataImportCheck {
  readonly key:
    | 'tenant'
    | 'tenant-admin'
    | 'tenant-database'
    | `module:${DataImportModuleKey}`
    | `schema:${DataImportModuleKey}`
    | 'file';
  readonly label: string;
  readonly status: 'passed' | 'failed' | 'not-required';
  readonly detail: string;
}

export interface DataImportTenantTarget {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly adminEmail?: string;
}

export interface DataImportPreviewResponse {
  readonly previewId: string;
  readonly valid: boolean;
  readonly sourceFiles: readonly string[];
  readonly target?: DataImportTenantTarget;
  readonly requiredModules: readonly DataImportModuleKey[];
  readonly rowCounts: Readonly<Record<DataImportDatasetKey, number>>;
  readonly checks: readonly DataImportCheck[];
  readonly issues: readonly DataImportIssue[];
}

export interface DataImportExecutionResponse {
  readonly status: 'completed';
  readonly importId: string;
  readonly target: DataImportTenantTarget;
  readonly importedRows: Readonly<Record<DataImportDatasetKey, number>>;
  readonly completedAt: string;
}

export interface InternalDataImportValidationResponse {
  readonly valid: boolean;
  readonly issues: readonly DataImportIssue[];
  readonly schemaReady: boolean;
}

export function emptyDataImportDataset(): DataImportDataset {
  return {
    users: [],
    organizationNodeTypes: [],
    organizationTrees: [],
    organizationNodes: [],
    organizationAssignments: [],
    inventorySettings: [],
    inventoryWarehouses: [],
    inventoryMaterials: [],
    inventoryAssets: [],
    inventoryOpeningStock: [],
    procedureDefinitions: [],
    procedureInstances: [],
    maintenanceSchedules: [],
  };
}

export function dataImportRowCounts(
  dataset: DataImportDataset,
): Readonly<Record<DataImportDatasetKey, number>> {
  return Object.fromEntries(
    Object.entries(dataset).map(([key, rows]) => [key, rows.length]),
  ) as Readonly<Record<DataImportDatasetKey, number>>;
}

export function requiredDataImportModules(
  dataset: DataImportDataset,
): readonly DataImportModuleKey[] {
  const modules: DataImportModuleKey[] = [];
  const procedureNeedsInventory =
    dataset.procedureInstances.some((instance) => Boolean(instance.assetCode)) ||
    dataset.procedureDefinitions.some((definition) =>
      definition.steps.some(
        (step) =>
          Boolean(step.materials?.length) ||
          step.assignments.some(
            (assignment) => assignment.eTaskSource === 'inventory_asset',
          ),
      ),
    );
  if (
    dataset.inventorySettings.length ||
    dataset.inventoryWarehouses.length ||
    dataset.inventoryMaterials.length ||
    dataset.inventoryAssets.length ||
    dataset.inventoryOpeningStock.length ||
    procedureNeedsInventory ||
    dataset.maintenanceSchedules.length
  ) {
    modules.push('inventory');
  }
  if (
    dataset.procedureDefinitions.length ||
    dataset.procedureInstances.length ||
    dataset.maintenanceSchedules.some((schedule) =>
      Boolean(schedule.procedureCode),
    )
  ) {
    modules.push('procedure-engine');
  }
  if (dataset.maintenanceSchedules.length) modules.push('maintenance');
  return modules;
}
