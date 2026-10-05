import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Pool } from 'pg';
import type { Request } from 'express';
import type {
  ApplyHrmWorkflowActionPayload,
  HrmProcedureLink,
  HrmRequestKind,
  HrmRequestRef,
} from '@enterprise-platform/contracts-hrm';
import {
  type ProcedureDefinition,
  type ProcedureAttributeValue,
} from '@enterprise-platform/contracts-procedure-engine';
import { HrmContextService } from './hrm-context.service.js';
import {
  HRM_REQUEST_TABLES,
  mapHrmProcedureLink,
  normalizeHrmRequestKind,
} from './hrm-procedure-links.js';
import {
  collectUserReferences,
  describeSubmittedAttributes,
  initialProcedureAttributes,
  loadEmployeeUserMap,
} from './hrm-attribute-values.js';
import { procedureFetch } from './hrm-procedure-fetch.js';
import {
  fetchProcedureProgress,
  fetchPublishedProcedureDefinition,
} from './hrm-procedure-api.js';
import { writeProcedureStepProgress } from './hrm-procedure-progress.js';
import {
  fieldDefinition,
  loadBindingMappings,
  mappingForAttribute,
} from './hrm-field-mappings.js';
import { hrmTransaction } from './hrm-transaction.js';
import { requireText, requireUuid } from './hrm-validation.js';

export { initialProcedureAttributes };

/** Keep the browser's legacy code-keyed form compatible with scoped PE values. */
export function initialProcedureValues(
  definition: ProcedureDefinition,
  raw: Record<string, unknown>,
): Record<string, ProcedureAttributeValue> {
  const result: Record<string, ProcedureAttributeValue> = {};
  for (const attribute of initialProcedureAttributes(definition)) {
    const value = raw[attribute.valueKey] ?? raw[attribute.code];
    if (value === undefined || value === null || value === '') continue;
    // Procedure owns normalization, option/required validation and step access.
    result[attribute.valueKey] = (
      typeof value === 'object' && !Array.isArray(value) && 'value' in value
        ? value
        : {
            type: attribute.type,
            // Dữ liệu cũ: thuộc tính tệp lưu một id chuỗi; PE cần mảng.
            value:
              attribute.type === 'file' && typeof value === 'string'
                ? [value]
                : value,
          }
    ) as ProcedureAttributeValue;
  }
  return result;
}

function baseUrl() {
  return (
    process.env.PROCEDURE_API_URL || 'http://localhost:3334/api/procedure'
  ).replace(/\/$/, '');
}
async function requireResponse(response: Response) {
  if (response.ok) return;
  let message = `Procedure trả mã ${response.status}`;
  try {
    const body = (await response.json()) as { message?: string | string[] };
    if (body.message)
      message = Array.isArray(body.message)
        ? body.message.join('; ')
        : body.message;
  } catch {
    /* retain transport status */
  }
  throw new HttpException(message.slice(0, 2000), response.status);
}

const PROCEDURE_ACTIONS = {
  APPROVE: 'approve',
  REJECT: 'reject',
  RETURN: 'return',
  COMPLETE: 'complete',
  CANCEL: 'cancel',
} as const;

/** Chuẩn hóa thao tác (chấp nhận chữ thường); sai thì báo rõ giá trị hợp lệ. */
export function resolveProcedureAction(
  value: unknown,
): (typeof PROCEDURE_ACTIONS)[keyof typeof PROCEDURE_ACTIONS] {
  const key = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!Object.hasOwn(PROCEDURE_ACTIONS, key))
    throw new BadRequestException(
      'Thao tác không hợp lệ; giá trị hợp lệ: APPROVE | REJECT | RETURN | COMPLETE | CANCEL',
    );
  return PROCEDURE_ACTIONS[key as keyof typeof PROCEDURE_ACTIONS];
}

@Injectable()
export class HrmProcedureBridgeService {
  constructor(private readonly ctx: HrmContextService) {}

  startOrResume(
    pool: Pool,
    linkId: string,
    tenantId: string,
  ): Promise<HrmProcedureLink> {
    return startHrmProcedure(pool, linkId, tenantId);
  }

  async applyAction(
    req: Request,
    ref: HrmRequestRef,
    input: ApplyHrmWorkflowActionPayload & { idempotencyKey: string },
  ): Promise<HrmProcedureLink> {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    if (tenantId !== ref.tenantId)
      throw new NotFoundException('Không tìm thấy đơn trong tenant');
    requireUuid(ref.requestId, 'Đơn');
    requireText(input.idempotencyKey, 'Mã thao tác', 180);
    const kind = normalizeHrmRequestKind(ref.kind);
    const link = (
      await pool.query(
        `SELECT * FROM hrm_schema.procedure_links WHERE tenant_id=$1 AND request_kind=$2 AND request_id=$3 AND revision=$4`,
        [tenantId, kind, ref.requestId, ref.revision],
      )
    ).rows[0];
    if (!link) throw new NotFoundException('Đơn chưa liên kết Procedure');
    if (!link.instance_id || ['CONFLICT', 'APPLIED'].includes(link.sync_status))
      throw new ConflictException('Quy trình chưa sẵn sàng hoặc đã kết thúc');
    const action = resolveProcedureAction(input.action);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    for (const name of ['authorization', 'cookie', 'x-csrf-token']) {
      const value = req.headers[name];
      if (typeof value === 'string') headers[name] = value;
    }
    // The user's session is mandatory: only Procedure may authorize the current role.
    const response = await procedureFetch(
      `${baseUrl()}/v1/instances/${link.instance_id}/actions`,
      {
        method: 'POST',
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          action,
          comment: input.comment,
          returnToStepId: input.returnToStepId,
          attributeValues: input.attributeValues,
          idempotencyKey: `hrm:${link.id}:${input.idempotencyKey}`,
        }),
      },
    );
    await requireResponse(response);
    // No HRM status/effect is written here. The durable inbox applies terminal outcomes.
    return mapHrmProcedureLink(await this.link(pool, tenantId, link.id));
  }

  async getProcedureProgress(
    pool: Pool,
    tenantId: string,
    instanceId: string,
    _kind?: HrmRequestKind,
    _requestId?: string,
    actorUserId?: string,
  ) {
    requireUuid(instanceId, 'Hồ sơ Procedure');
    const link = (
      await pool.query(
        `SELECT l.* FROM hrm_schema.procedure_links l JOIN hrm_schema.procedure_correlations c
      ON c.tenant_id=l.tenant_id AND c.link_id=l.id WHERE l.tenant_id=$1 AND c.instance_id=$2 LIMIT 1`,
        [tenantId, instanceId],
      )
    ).rows[0];
    if (!link) return null;
    // Đọc tiến độ qua API nội bộ của Procedure, không đọc procedure_schema.
    const progress = await fetchProcedureProgress(
      tenantId,
      instanceId,
      actorUserId,
    );
    if (!progress) return null;
    return {
      instanceId: progress.instanceId,
      instanceCode: progress.instanceCode,
      status: progress.status,
      currentStepId: progress.currentStepId,
      currentStepName: progress.currentStepName,
      currentAssigneeName: progress.currentAssigneeName,
      // Người dùng hiện tại có đang được giao bước hiện tại không (undefined nếu PE chưa hỗ trợ).
      canAct: progress.canAct,
      completedAt: progress.completedAt,
      steps: progress.steps.map((step) => ({
        id: step.id,
        name: step.name,
        status: step.status,
        order: step.order,
        currentRoleStage: step.currentRoleStage,
        slaHours: step.slaHours,
        slaDueAt: step.slaDueAt,
        completedAt: step.completedAt,
        roleTitle: step.roleTitle,
      })),
      activity: progress.activity,
      submittedAttributes: await this.submittedAttributes(pool, tenantId, link),
      syncStatus: link.sync_status,
      lastError: link.last_error,
      hrmSynced: link.sync_status === 'APPLIED',
    };
  }

  /** Thuộc tính đã nhập của đơn, đọc từ procedure_links.attributes (bảng HRM) + bản chụp định nghĩa. */
  private async submittedAttributes(
    pool: Pool,
    tenantId: string,
    link: { attributes?: unknown; definition_snapshot?: unknown },
  ) {
    try {
      const attributes = (link.attributes ?? {}) as Record<string, unknown>;
      const specs = initialProcedureAttributes(
        (link.definition_snapshot ?? {}) as ProcedureDefinition,
      );
      if (!specs.length || !Object.keys(attributes).length) return [];
      const users = await loadEmployeeUserMap(
        pool,
        tenantId,
        collectUserReferences(specs, attributes),
      );
      const fileIds = specs
        .filter((spec) => spec.type === 'file')
        .flatMap((spec) => {
          const raw = attributes[spec.valueKey] ?? attributes[spec.code];
          const value =
            raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw
              ? (raw as { value: unknown }).value
              : raw;
          return (Array.isArray(value) ? value : [value]).filter(
            (id): id is string =>
              typeof id === 'string' &&
              /^[0-9a-f-]{36}$/i.test(id),
          );
        });
      const fileNames = new Map<string, string>();
      if (fileIds.length) {
        const rows = (
          await pool.query(
            'SELECT id,file_name FROM hrm_schema.attachments WHERE tenant_id=$1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL',
            [tenantId, fileIds],
          )
        ).rows;
        for (const row of rows) fileNames.set(row.id, row.file_name);
      }
      return describeSubmittedAttributes(specs, attributes, users, fileNames);
    } catch {
      return [];
    }
  }

  async getBindingDefinitionWithAttributes(
    pool: Pool,
    tenantId: string,
    requestKind: HrmRequestKind,
    subTypeCode?: string,
  ) {
    const kind = normalizeHrmRequestKind(requestKind);
    const rows = (
      await pool.query(
        `SELECT * FROM hrm_schema.request_procedure_bindings WHERE tenant_id=$1 AND request_kind=$2
      AND is_active AND (sub_type_code IS NULL OR sub_type_code=$3)`,
        [tenantId, kind, subTypeCode || null],
      )
    ).rows;
    const specific = rows.filter((row) => row.sub_type_code === subTypeCode);
    const selected = specific.length
      ? specific
      : rows.filter((row) => row.sub_type_code == null);
    // Chưa có binding = DIRECT mặc định.
    if (!selected.length) {
      // Chỉ có binding theo mã loại con mà chưa chọn loại con: báo mã rõ để FE
      // hiển thị "Chọn loại đơn con để tải biểu mẫu" thay vì im lặng.
      if (!subTypeCode) {
        const subTypeBindings = (
          await pool.query(
            `SELECT 1 FROM hrm_schema.request_procedure_bindings WHERE tenant_id=$1 AND request_kind=$2
          AND is_active AND sub_type_code IS NOT NULL AND mode='PROCEDURE' LIMIT 1`,
            [tenantId, kind],
          )
        ).rows;
        if (subTypeBindings.length)
          return {
            code: 'SUBTYPE_REQUIRED' as const,
            message: 'Chọn loại đơn con để tải biểu mẫu',
            definitionId: null,
            definitionName: '',
            definitionCode: '',
            attributes: [],
          };
      }
      return null;
    }
    const binding = selected[0];
    if (
      selected.some(
        (row) =>
          row.configuration_status === 'CONFLICT' ||
          row.mode !== binding.mode ||
          row.procedure_definition_id !== binding.procedure_definition_id,
      )
    )
      throw new ConflictException('Cấu hình quy trình xung đột');
    if (binding.mode === 'DIRECT') return null;
    // Đọc qua API nội bộ của Procedure, không đọc procedure_schema.
    const definition = await fetchPublishedProcedureDefinition(
      tenantId,
      binding.procedure_definition_id,
    );
    // FIX-E-05: gắn ánh xạ trường HRM vào từng thuộc tính để form ẩn (OVERWRITE) hoặc điền sẵn (PREFILL).
    const { mappings } = await loadBindingMappings(
      pool,
      tenantId,
      binding.id,
      kind,
    );
    return {
      definitionId: definition.id,
      definitionName: definition.name,
      definitionCode: definition.code,
      attributes: initialProcedureAttributes(definition).map((attribute) => {
        const mapping = mappingForAttribute(mappings, attribute);
        const field = mapping ? fieldDefinition(mapping.hrmField) : undefined;
        return {
          ...attribute,
          required: Boolean(attribute.required),
          mapping: mapping
            ? {
                hrmField: mapping.hrmField,
                mode: mapping.mode,
                group: field?.group,
                label: field?.label,
              }
            : null,
        };
      }),
    };
  }

  private async link(pool: Pool, tenantId: string, id: string) {
    const row = (
      await pool.query(
        'SELECT * FROM hrm_schema.procedure_links WHERE tenant_id=$1 AND id=$2',
        [tenantId, id],
      )
    ).rows[0];
    if (!row) throw new NotFoundException('Không tìm thấy liên kết Procedure');
    return row;
  }
}

export async function startHrmProcedure(
  pool: Pool,
  linkId: string,
  tenantId: string,
): Promise<HrmProcedureLink> {
  requireUuid(linkId, 'Liên kết');
  requireUuid(tenantId, 'Tenant');
  const lease = randomUUID();
  const claimed = (
    await pool.query(
      `UPDATE hrm_schema.procedure_links SET lease_token=$3,lease_until=now()+interval '30 seconds',
      attempts=attempts+1,attempted_at=now(),updated_at=now()
      WHERE tenant_id=$1 AND id=$2 AND instance_id IS NULL AND sync_status IN ('START_PENDING','FAILED')
        AND (lease_until IS NULL OR lease_until<now()) RETURNING *`,
      [tenantId, linkId, lease],
    )
  ).rows[0];
  if (!claimed)
    return mapHrmProcedureLink(await findProcedureLink(pool, tenantId, linkId));
  let progress: Partial<HrmProcedureLink> = {};
  try {
    if (!process.env.INTERNAL_SERVICE_TOKEN)
      throw new Error('Chưa cấu hình INTERNAL_SERVICE_TOKEN');
    if (!claimed.definition_id || !claimed.definition_snapshot)
      throw new Error('Thiếu bản chụp quy trình; cần đối soát cấu hình');
    const response = await procedureFetch(`${baseUrl()}/v1/internal/instances`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': tenantId,
        'x-service-token': process.env.INTERNAL_SERVICE_TOKEN,
      },
      body: JSON.stringify({
        definitionId: claimed.definition_id,
        title: claimed.title,
        sourceType: claimed.source_type,
        sourceId: claimed.source_id,
        idempotencyKey: claimed.start_idempotency_key,
        initiatedBy: claimed.initiated_by,
        // FIX-E-01: PE tự hoàn thành bước S của người nộp trong cùng giao dịch tạo hồ sơ.
        autoCompleteInitiatorStep: true,
        expectedDefinitionSnapshot: claimed.definition_snapshot,
        attributeValues: initialProcedureValues(
          claimed.definition_snapshot as ProcedureDefinition,
          claimed.attributes ?? {},
        ),
      }),
    });
    await requireResponse(response);
    const instance = (await response.json()) as {
      id?: string;
      code?: string;
      currentStepName?: string;
      currentAssigneeName?: string;
      sequence?: number;
      warnings?: string[];
    };
    requireUuid(instance.id, 'Hồ sơ Procedure');
    progress = procedureStartProgress(instance);
    await hrmTransaction(pool, async (db) => {
      const current = (
        await db.query(
          'SELECT * FROM hrm_schema.procedure_links WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
          [tenantId, linkId],
        )
      ).rows[0];
      if (current.lease_token !== lease) return;
      if (current.instance_id && current.instance_id !== instance.id)
        throw new ConflictException('Liên kết có instance khác; cần đối soát');
      await db.query(
        `UPDATE hrm_schema.procedure_links SET instance_id=$3,instance_code=$4,sync_status='RUNNING',last_error=NULL,
          lease_until=NULL,lease_token=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        [tenantId, linkId, instance.id, instance.code || ''],
      );
      await db.query(
        `INSERT INTO hrm_schema.procedure_correlations(tenant_id,link_id,instance_id,source_type,source_id)
          VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [tenantId, linkId, instance.id, claimed.source_type, claimed.source_id],
      );
      // Ghi tiến độ ngay khi nhận phản hồi tạo instance (bước đầu sau khi PE tự hoàn thành S).
      await writeProcedureStepProgress(db, tenantId, linkId, {
        stepName: instance.currentStepName,
        assigneeName: instance.currentAssigneeName,
        sequence: instance.sequence ?? 1,
      });
      const kind = normalizeHrmRequestKind(claimed.request_kind);
      await db.query(
        `UPDATE hrm_schema.${HRM_REQUEST_TABLES[kind]} SET procedure_instance_id=$3 WHERE tenant_id=$1 AND id=$2`,
        [tenantId, claimed.request_id, instance.id],
      );
    });
  } catch (error) {
    const conflict =
      error instanceof ConflictException ||
      (error as { code?: string }).code === '23505';
    const lastError = (
      error instanceof Error ? error.message : 'Không khởi tạo được Procedure'
    ).slice(0, 2000);
    await pool.query(
      `UPDATE hrm_schema.procedure_links SET sync_status=$4,last_error=$5,lease_until=NULL,lease_token=NULL,updated_at=now()
        WHERE tenant_id=$1 AND id=$2 AND lease_token=$3`,
      [tenantId, linkId, lease, conflict ? 'CONFLICT' : 'FAILED', lastError],
    );
    progress = { lastError };
  }
  return {
    ...mapHrmProcedureLink(await findProcedureLink(pool, tenantId, linkId)),
    ...progress,
  };
}

/** Tiến độ PE trả lúc tạo hồ sơ (bước hiện tại, người xử lý, cảnh báo) để trả cho phản hồi tạo đơn. */
export function procedureStartProgress(instance: {
  currentStepName?: string;
  currentAssigneeName?: string;
  warnings?: string[];
}): Partial<HrmProcedureLink> {
  return {
    ...(instance.currentStepName
      ? { currentStepName: instance.currentStepName }
      : {}),
    ...(instance.currentAssigneeName
      ? { currentAssigneeName: instance.currentAssigneeName }
      : {}),
    ...(instance.warnings?.length ? { warnings: instance.warnings } : {}),
  };
}

async function findProcedureLink(pool: Pool, tenantId: string, id: string) {
  const row = (
    await pool.query(
      'SELECT * FROM hrm_schema.procedure_links WHERE tenant_id=$1 AND id=$2',
      [tenantId, id],
    )
  ).rows[0];
  if (!row) throw new NotFoundException('Không tìm thấy liên kết Procedure');
  return row;
}
