import {
  DATA_IMPORT_SHEETS,
  type DataImportDataset,
  type DataImportIssue,
  type InternalDataImportValidationResponse,
} from '@enterprise-platform/contracts-data-import';
import {
  MaintenanceApplication,
  type MaintenanceActor,
} from '@enterprise-platform/module-maintenance';
import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

interface DataImportBody {
  readonly dataset?: DataImportDataset;
  readonly procedureDefinitionIds?: Readonly<Record<string, string>>;
}

interface InternalRequest extends Request {
  maintenanceActor?: MaintenanceActor;
}

@Controller('v1/internal/data-import')
export class MaintenanceDataImportController {
  constructor(private readonly app: MaintenanceApplication) {}

  @Post('validate')
  async validate(
    @Req() request: InternalRequest,
    @Body() body: DataImportBody,
  ): Promise<InternalDataImportValidationResponse> {
    const actor = this.actor(request);
    const dataset = requiredDataset(body.dataset);
    const workspace = await this.app.workspace(actor);
    const issues: DataImportIssue[] = [];
    const existingAssets = new Set(
      workspace.schedules.map((schedule) => schedule.assetCode),
    );
    // Assets included in this import are validated and created by Inventory
    // before Maintenance executes. Existing assets are resolved through the
    // Inventory API; Maintenance never reads inventory_schema directly.
    const importedAssets = new Set(
      dataset.inventoryAssets.map((asset) => asset.code),
    );
    const availableAssets = new Set(importedAssets);
    for (const assetCode of new Set(
      dataset.maintenanceSchedules.map((schedule) => schedule.assetCode),
    )) {
      if (importedAssets.has(assetCode)) continue;
      try {
        await this.app.getAssetTasks(actor, assetCode);
        availableAssets.add(assetCode);
      } catch (error) {
        issues.push({
          level: 'error',
          code: 'MAINTENANCE_ASSET_UNAVAILABLE',
          message: `Không thể xác minh thiết bị ${assetCode}: ${messageOf(error)}`,
          sheet: DATA_IMPORT_SHEETS.maintenanceSchedules,
        });
      }
    }
    dataset.maintenanceSchedules.forEach((schedule, index) => {
      if (existingAssets.has(schedule.assetCode)) {
        issues.push({
          level: 'error',
          code: 'MAINTENANCE_SCHEDULE_EXISTS',
          message: `Thiết bị ${schedule.assetCode} đã có lịch bảo trì.`,
          sheet: DATA_IMPORT_SHEETS.maintenanceSchedules,
          row: index + 2,
        });
      }
      if (!availableAssets.has(schedule.assetCode)) {
        issues.push({
          level: 'error',
          code: 'MAINTENANCE_ASSET_MISSING',
          message: `Thiết bị ${schedule.assetCode} không tồn tại trong Inventory.`,
          sheet: DATA_IMPORT_SHEETS.maintenanceSchedules,
          row: index + 2,
        });
      }
    });
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
    const dataset = requiredDataset(body.dataset);
    const validation = await this.validate(request, body);
    if (!validation.valid) {
      throw new BadRequestException({
        code: 'MAINTENANCE_IMPORT_INVALID',
        message: 'Dữ liệu Maintenance không hợp lệ.',
        issues: validation.issues,
      });
    }
    const actor = this.actor(request);
    const definitionIds = body.procedureDefinitionIds ?? {};
    for (const schedule of dataset.maintenanceSchedules) {
      const startDate =
        schedule.startDate ??
        new Date(
          Date.now() + (schedule.startOffsetDays ?? 0) * 86_400_000,
        )
          .toISOString()
          .slice(0, 10);
      await this.app.createSchedule(actor, {
        assetCode: schedule.assetCode,
        procedureDefinitionId: schedule.procedureCode
          ? definitionIds[schedule.procedureCode]
          : undefined,
        frequency: schedule.frequency,
        priority: schedule.priority,
        startDate,
        timezone: schedule.timezone,
        activate: schedule.activate ?? true,
      });
    }
    return { status: 'completed' };
  }

  private actor(request: InternalRequest): MaintenanceActor {
    const tenantId = request.maintenanceActor?.tenantId;
    if (!tenantId) throw new BadRequestException('Tenant context không hợp lệ.');
    return {
      tenantId,
      userId: '00000000-0000-4000-8000-000000000005',
      displayName: 'Platform Data Import',
      canManage: true,
      canHandleOccurrences: true,
    };
  }
}

function requiredDataset(dataset: DataImportDataset | undefined): DataImportDataset {
  if (!dataset) throw new BadRequestException('dataset là bắt buộc.');
  return dataset;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
