import type {
  DataImportDataset,
  DataImportIssue,
  ImportProcedureDefinitionRow,
  InternalDataImportValidationResponse,
} from '@enterprise-platform/contracts-data-import';
import type {
  CreateProcedureDefinitionRequest,
  CreateProcedureStepInput,
  ProcedureETaskConfig,
} from '@enterprise-platform/contracts-procedure-engine';
import {
  ProcedureEngineApplication,
  type ProcedureActor,
} from '@enterprise-platform/module-procedure-engine';
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
  readonly organizationNodeIds?: Readonly<Record<string, string>>;
}

interface InternalRequest extends Request {
  procedureActor?: { tenantId: string };
}

@Controller('v1/internal/data-import')
export class ProcedureDataImportController {
  constructor(private readonly app: ProcedureEngineApplication) {}

  @Post('validate')
  async validate(
    @Req() request: InternalRequest,
    @Body() body: DataImportBody,
  ): Promise<InternalDataImportValidationResponse> {
    const dataset = requiredDataset(body.dataset);
    const workspace = await this.app.getWorkspace(this.actor(request));
    const existing = new Set(workspace.definitions.map((item) => item.code));
    const availableDefinitions = new Set([
      ...existing,
      ...dataset.procedureDefinitions.map((item) => item.code),
    ]);
    const definitionStatuses = new Map(
      workspace.definitions.map((item) => [item.code, item.status]),
    );
    dataset.procedureDefinitions.forEach((item) => {
      definitionStatuses.set(item.code, item.draft ? 'draft' : 'published');
    });
    const issues: DataImportIssue[] = [];
    dataset.procedureDefinitions.forEach((definition, index) => {
      if (existing.has(definition.code)) {
        issues.push({
          level: 'error',
          code: 'PROCEDURE_EXISTS',
          message: `Quy trình ${definition.code} đã tồn tại.`,
          sheet: 'PROCEDURES',
          row: index + 2,
        });
      }
      try {
        this.app.validateDefinitionImport(
          toDefinitionRequest(definition, {}, {}, false),
        );
      } catch (error) {
        issues.push({
          level: 'error',
          code: 'PROCEDURE_DOMAIN_INVALID',
          message: `${definition.code}: ${messageOf(error)}`,
          sheet: 'PROCEDURES',
          row: index + 2,
          field: 'stepsJson',
        });
      }
    });
    dataset.procedureInstances.forEach((instance, index) => {
      if (!availableDefinitions.has(instance.definitionCode)) {
        issues.push({
          level: 'error',
          code: 'INSTANCE_DEFINITION_MISSING',
          message: `Không tìm thấy quy trình ${instance.definitionCode}.`,
          sheet: 'PROCEDURE_INSTANCES',
          row: index + 2,
          field: 'definitionCode',
        });
      } else if (definitionStatuses.get(instance.definitionCode) !== 'published') {
        issues.push({
          level: 'error',
          code: 'INSTANCE_DEFINITION_NOT_PUBLISHED',
          message: `Quy trình ${instance.definitionCode} chưa được công bố nên không thể mở hồ sơ.`,
          sheet: 'PROCEDURE_INSTANCES',
          row: index + 2,
          field: 'definitionCode',
        });
      }
    });
    dataset.maintenanceSchedules.forEach((schedule, index) => {
      if (
        schedule.procedureCode &&
        !availableDefinitions.has(schedule.procedureCode)
      ) {
        issues.push({
          level: 'error',
          code: 'SCHEDULE_PROCEDURE_MISSING',
          message: `Không tìm thấy quy trình ${schedule.procedureCode}.`,
          sheet: 'MAINTENANCE_SCHEDULES',
          row: index + 2,
          field: 'procedureCode',
        });
      } else if (
        schedule.procedureCode &&
        definitionStatuses.get(schedule.procedureCode) !== 'published'
      ) {
        issues.push({
          level: 'error',
          code: 'SCHEDULE_PROCEDURE_NOT_PUBLISHED',
          message: `Quy trình ${schedule.procedureCode} chưa được công bố nên không thể gắn lịch bảo trì.`,
          sheet: 'MAINTENANCE_SCHEDULES',
          row: index + 2,
          field: 'procedureCode',
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
        code: 'PROCEDURE_IMPORT_INVALID',
        message: 'Dữ liệu Procedure không hợp lệ.',
        issues: validation.issues,
      });
    }
    const actor = this.actor(request);
    const nodeIds = body.organizationNodeIds ?? {};
    const workspace = await this.app.getWorkspace(actor);
    const definitionIds: Record<string, string> = Object.fromEntries(
      workspace.definitions.map((definition) => [
        definition.code,
        definition.id,
      ]),
    );
    const drafts = new Map<
      string,
      { id: string; stepIds: Readonly<Record<string, string>> }
    >();

    // First pass creates every draft. The second pass can therefore resolve
    // links between definitions regardless of their row order in the workbook.
    for (const blueprint of dataset.procedureDefinitions) {
      const created = await this.app.createDefinition(
        actor,
        toDefinitionRequest(blueprint, nodeIds, definitionIds, false),
      );
      const stepIds = Object.fromEntries(
        created.steps.map((step) => [step.key, step.id]),
      );
      definitionIds[blueprint.code] = created.id;
      drafts.set(blueprint.code, { id: created.id, stepIds });
    }

    for (const blueprint of dataset.procedureDefinitions) {
      const draft = drafts.get(blueprint.code);
      if (!draft) {
        throw new BadRequestException(
          `Không đọc lại được bản nháp ${blueprint.code}.`,
        );
      }
      const requestBody = toDefinitionRequest(
        blueprint,
        nodeIds,
        definitionIds,
        true,
        draft.stepIds,
      );
      const patched = await this.app.updateDefinition(actor, draft.id, {
        name: requestBody.name,
        description: requestBody.description,
        kind: requestBody.kind,
        category: requestBody.category,
        steps: requestBody.steps,
      });
      const finalDefinition = blueprint.draft
        ? patched
        : await this.app.publishDefinition(actor, patched.id);
      definitionIds[blueprint.code] = finalDefinition.id;
    }

    for (const instance of dataset.procedureInstances) {
      const definitionId = definitionIds[instance.definitionCode];
      if (!definitionId) {
        throw new BadRequestException(
          `Không tìm thấy quy trình ${instance.definitionCode} để mở hồ sơ.`,
        );
      }
      await this.app.startInstance(actor, {
        definitionId,
        title: instance.title,
        assetCode: instance.assetCode,
        idempotencyKey: instance.idempotencyKey,
      });
    }

    return { status: 'completed', definitionIds };
  }

  private actor(request: InternalRequest): ProcedureActor {
    const header = request.headers['x-tenant-id'];
    const tenantId =
      request.procedureActor?.tenantId ??
      (Array.isArray(header) ? header[0] : header)?.trim();
    if (!tenantId) throw new BadRequestException('Tenant context không hợp lệ.');
    return {
      tenantId,
      userId: '00000000-0000-4000-8000-000000000004',
      membershipId: '00000000-0000-4000-8000-000000000004',
      displayName: 'Platform Data Import',
      canDesign: true,
      isOverride: true,
      organizationUnitIds: [],
      positionIds: [],
    };
  }
}

function toDefinitionRequest(
  blueprint: ImportProcedureDefinitionRow,
  nodeIds: Readonly<Record<string, string>>,
  definitionIds: Readonly<Record<string, string>>,
  includeControls: boolean,
  stepIds: Readonly<Record<string, string>> = {},
): CreateProcedureDefinitionRequest {
  return {
    code: blueprint.code,
    name: blueprint.name,
    description: blueprint.description,
    kind: blueprint.kind,
    category: blueprint.category,
    steps: blueprint.steps.map(
      (step, index): CreateProcedureStepInput => ({
        key: step.key,
        order: index + 1,
        name: step.name,
        description: step.description,
        slaHours: step.slaHours,
        linkedDefinitionId: step.linkedDefinitionCode
          ? definitionIds[step.linkedDefinitionCode]
          : undefined,
        materials: step.materials ? [...step.materials] : undefined,
        assignments: step.assignments
          .filter((assignment) => includeControls || assignment.role !== 'C')
          .map((assignment) => ({
            role: assignment.role,
            subjectType: 'organization_unit',
            subjectId:
              nodeIds[assignment.subjectNodeCode] ?? assignment.subjectNodeCode,
            subjectLabel: assignment.subjectLabel,
            fixedRollbackStepId:
              includeControls && assignment.rollbackToStepKey
                ? stepIds[assignment.rollbackToStepKey]
                : undefined,
            eTaskSource: assignment.eTaskSource,
            eTaskConfig: assignment.eTaskConfig as
              | ProcedureETaskConfig
              | undefined,
          })),
      }),
    ),
  };
}

function requiredDataset(dataset: DataImportDataset | undefined): DataImportDataset {
  if (!dataset) throw new BadRequestException('dataset là bắt buộc.');
  return dataset;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
