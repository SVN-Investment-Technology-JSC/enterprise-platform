import {
  DATA_IMPORT_SHEETS,
  type DataImportDataset,
  type DataImportIssue,
  type InternalDataImportValidationResponse,
} from '@enterprise-platform/contracts-data-import';
import {
  InventoryApplication,
  type InventoryActor,
} from '@enterprise-platform/module-inventory';
import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

interface InternalRequest extends Request {
  inventoryActor?: InventoryActor;
}

interface DataImportBody {
  readonly dataset?: DataImportDataset;
  readonly organizationNodeIds?: Readonly<Record<string, string>>;
}

@Controller('v1/internal/data-import')
export class InventoryDataImportController {
  constructor(private readonly app: InventoryApplication) {}

  @Post('validate')
  async validate(
    @Req() request: InternalRequest,
    @Body() body: DataImportBody,
  ): Promise<InternalDataImportValidationResponse> {
    const actor = this.actor(request);
    const dataset = requiredDataset(body.dataset);
    const [warehouses, materials, assets, settings] = await Promise.all([
      this.app.listAllWarehouses(actor),
      this.app.listMaterials(actor),
      this.app.listAssets(actor),
      this.app.getSettings(actor),
    ]);
    const issues: DataImportIssue[] = [];
    const existingWarehouses = new Set(warehouses.map((item) => item.code));
    const existingMaterials = new Set(materials.map((item) => item.code));
    const existingAssets = new Set(assets.map((item) => item.code));

    dataset.inventoryWarehouses.forEach((item, index) => {
      if (existingWarehouses.has(item.code)) {
        issues.push(alreadyExists('WAREHOUSE_EXISTS', `Kho ${item.code} đã tồn tại.`, DATA_IMPORT_SHEETS.inventoryWarehouses, index));
      }
    });
    dataset.inventoryMaterials.forEach((item, index) => {
      if (existingMaterials.has(item.code)) {
        issues.push(alreadyExists('MATERIAL_EXISTS', `Vật tư ${item.code} đã tồn tại.`, DATA_IMPORT_SHEETS.inventoryMaterials, index));
      }
    });
    const allAssets = new Set([
      ...existingAssets,
      ...dataset.inventoryAssets.map((item) => item.code),
    ]);
    dataset.inventoryAssets.forEach((item, index) => {
      if (existingAssets.has(item.code)) {
        issues.push(alreadyExists('ASSET_EXISTS', `Thiết bị ${item.code} đã tồn tại.`, DATA_IMPORT_SHEETS.inventoryAssets, index));
      }
      if (item.parentCode && !allAssets.has(item.parentCode)) {
        issues.push(alreadyExists('ASSET_PARENT_MISSING', `Không tìm thấy thiết bị cha ${item.parentCode}.`, DATA_IMPORT_SHEETS.inventoryAssets, index));
      }
    });

    const allWarehouses = new Set([
      ...existingWarehouses,
      ...dataset.inventoryWarehouses.map((item) => item.code),
    ]);
    const allMaterials = new Set([
      ...existingMaterials,
      ...dataset.inventoryMaterials.map((item) => item.code),
    ]);
    dataset.inventoryOpeningStock.forEach((item, index) => {
      if (!allWarehouses.has(item.warehouseCode)) {
        issues.push(alreadyExists('WAREHOUSE_MISSING', `Không tìm thấy kho ${item.warehouseCode}.`, DATA_IMPORT_SHEETS.inventoryOpeningStock, index));
      }
      if (!allMaterials.has(item.materialCode)) {
        issues.push(alreadyExists('MATERIAL_MISSING', `Không tìm thấy vật tư ${item.materialCode}.`, DATA_IMPORT_SHEETS.inventoryOpeningStock, index));
      }
    });
    dataset.procedureDefinitions.forEach((definition, definitionIndex) => {
      for (const step of definition.steps) {
        for (const material of step.materials ?? []) {
          if (!allMaterials.has(material.materialCode)) {
            issues.push(alreadyExists(
              'PROCEDURE_MATERIAL_MISSING',
              `Quy trình ${definition.code} tham chiếu vật tư ${material.materialCode} không tồn tại trong Inventory.`,
              DATA_IMPORT_SHEETS.procedureDefinitions,
              definitionIndex,
            ));
          }
        }
        for (const assignment of step.assignments ?? []) {
          const assetCode =
            assignment.eTaskSource === 'inventory_asset' &&
            typeof assignment.eTaskConfig?.['assetCode'] === 'string'
              ? assignment.eTaskConfig['assetCode']
              : undefined;
          if (assetCode && !allAssets.has(assetCode)) {
            issues.push(alreadyExists(
              'PROCEDURE_ASSET_MISSING',
              `Quy trình ${definition.code} tham chiếu thiết bị ${assetCode} không tồn tại trong Inventory.`,
              DATA_IMPORT_SHEETS.procedureDefinitions,
              definitionIndex,
            ));
          }
        }
      }
    });
    dataset.procedureInstances.forEach((instance, index) => {
      if (instance.assetCode && !allAssets.has(instance.assetCode)) {
        issues.push(alreadyExists(
          'INSTANCE_ASSET_MISSING',
          `Hồ sơ tham chiếu thiết bị ${instance.assetCode} không tồn tại trong Inventory.`,
          DATA_IMPORT_SHEETS.procedureInstances,
          index,
        ));
      }
    });
    dataset.maintenanceSchedules.forEach((schedule, index) => {
      if (!allAssets.has(schedule.assetCode)) {
        issues.push(alreadyExists(
          'MAINTENANCE_ASSET_MISSING',
          `Lịch bảo trì tham chiếu thiết bị ${schedule.assetCode} không tồn tại trong Inventory.`,
          DATA_IMPORT_SHEETS.maintenanceSchedules,
          index,
        ));
      }
    });
    const catalog = settings['catalog.asset'];
    const value = catalog.value as unknown as
      | Record<string, unknown>
      | undefined;
    if (
      dataset.inventorySettings.length &&
      catalog.version > 0 &&
      value &&
      typeof value === 'object' &&
      Object.values(value).some((item) => Array.isArray(item) && item.length)
    ) {
      issues.push({
        level: 'error',
        code: 'INVENTORY_SETTINGS_ALREADY_CONFIGURED',
        message: 'Danh mục Inventory đã được cấu hình; import không được phép ghi đè.',
        sheet: DATA_IMPORT_SHEETS.inventorySettings,
      });
    }

    return {
      valid: !issues.some((issue) => issue.level === 'error'),
      schemaReady: true,
      issues,
    };
  }

  @Post('execute')
  async execute(
    @Req() request: InternalRequest,
    @Body() body: DataImportBody,
  ) {
    const actor = this.actor(request);
    const dataset = requiredDataset(body.dataset);
    const validation = await this.validate(request, body);
    if (!validation.valid) {
      throw new BadRequestException({
        code: 'INVENTORY_IMPORT_INVALID',
        message: 'Dữ liệu Inventory không hợp lệ.',
        issues: validation.issues,
      });
    }
    const organizationNodeIds = body.organizationNodeIds ?? {};

    for (const item of dataset.inventoryWarehouses) {
      await this.app.createWarehouse(actor, {
        code: item.code,
        name: item.name,
        type: item.type,
        location: item.location,
        orgUnitId: item.organizationNodeCode
          ? organizationNodeIds[item.organizationNodeCode]
          : undefined,
      });
    }
    for (const item of dataset.inventoryMaterials) {
      await this.app.createMaterial(actor, item);
    }

    const existingAssets = new Set(
      (await this.app.listAssets(actor)).map((asset) => asset.code),
    );
    const createdAssets = new Set(existingAssets);
    let pending = [...dataset.inventoryAssets];
    while (pending.length) {
      const ready = pending.filter(
        (item) => !item.parentCode || createdAssets.has(item.parentCode),
      );
      if (!ready.length) {
        throw new BadRequestException('Không thể xác định thứ tự thiết bị cha/con.');
      }
      for (const item of ready) {
        await this.app.createAsset(actor, {
          ...item,
          orgUnitId: item.organizationNodeCode
            ? organizationNodeIds[item.organizationNodeCode]
            : undefined,
        });
        createdAssets.add(item.code);
      }
      pending = pending.filter((item) => !ready.includes(item));
    }

    for (const item of dataset.inventoryOpeningStock) {
      await this.app.receiveStock(actor, {
        ...item,
        referenceType: 'OPENING_BALANCE',
        note: item.note ?? 'Tồn đầu kỳ từ Data Import',
      });
    }
    const settingsInput = dataset.inventorySettings[0];
    if (settingsInput) {
      const settings = await this.app.getSettings(actor);
      await this.app.updateSetting(actor, 'catalog.asset', {
        value: settingsInput,
        expectedVersion: settings['catalog.asset'].version,
      });
    }
    return { status: 'completed' };
  }

  private actor(request: InternalRequest): InventoryActor {
    const tenantId = request.inventoryActor?.tenantId;
    if (!tenantId) throw new BadRequestException('Tenant context không hợp lệ.');
    return {
      tenantId,
      userId: '00000000-0000-4000-8000-000000000003',
      displayName: 'Platform Data Import',
      canManage: true,
      canWriteTransactions: true,
    };
  }
}

function requiredDataset(dataset: DataImportDataset | undefined): DataImportDataset {
  if (!dataset) throw new BadRequestException('dataset là bắt buộc.');
  return dataset;
}

function alreadyExists(
  code: string,
  message: string,
  sheet: DataImportIssue['sheet'],
  zeroBasedIndex: number,
): DataImportIssue {
  return { level: 'error', code, message, sheet, row: zeroBasedIndex + 2 };
}
