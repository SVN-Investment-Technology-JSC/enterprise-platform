import { workflowProgressFilter } from '../infrastructure/hrm-workflow-filter.js';
import { procedureProgressSchemaReady } from '../infrastructure/hrm-procedure-progress.js';
import { HrmApprovalPolicyService } from '../infrastructure/hrm-approval-policy.js';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Patch,
  ConflictException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import {
  requireDate,
  requireUuid,
  requireText,
} from '../infrastructure/hrm-validation.js';
import { reverseApprovedRequest } from '../infrastructure/hrm-request-reversal.js';
import type { HrmAction } from '@enterprise-platform/contracts-identity';
import { runHrmAutomation } from '../infrastructure/hrm-automation.js';
import { listAuditTrail } from '../infrastructure/hrm-audit-trail.js';
import { procedureDefinitions } from '../infrastructure/hrm-work-references.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import {
  normalizeHrmRequestKind,
  saveHrmProcedureBinding,
} from '../infrastructure/hrm-procedure-links.js';
import { transitionLeave } from '../infrastructure/hrm-leave-operations.js';
import {
  fieldCatalogFor,
  loadBindingMappings,
  saveBindingFieldMappings,
} from '../infrastructure/hrm-field-mappings.js';
import { initialProcedureAttributes } from '../infrastructure/hrm-procedure-bridge.service.js';
import { loadSubtypeCatalog } from '../infrastructure/hrm-subtype-catalog.js';
import {
  fetchPublishedProcedureDefinition,
  procedureUnavailable,
} from '../infrastructure/hrm-procedure-api.js';
import { HrmProcedureBridgeService } from '../infrastructure/hrm-procedure-bridge.service.js';
import {
  draftPayload,
  mapDraft,
} from '../infrastructure/hrm-request-drafts.js';
import {
  assertLifecycleVersion,
  lifecycleAudit,
} from '../infrastructure/hrm-lifecycle.js';
import { lockEmployee } from '../infrastructure/hrm-time.js';
import { yearEndChecklist } from '../infrastructure/hrm-leave-reconcile.js';

@Controller('v1')
export class HrmOperationsController {
  constructor(
    private readonly ctx: HrmContextService,
    private readonly bridge: HrmProcedureBridgeService,
    private readonly approvals: HrmApprovalPolicyService = new HrmApprovalPolicyService(),
  ) {}
  @Get('request-drafts')
  async listDrafts(
    @Req() req: Request,
    @Query('employee_id') employeeId?: string,
  ) {
    const context = await this.ctx.getRequestContext(req, employeeId);
    const result = await context.pool.query(
      "SELECT * FROM hrm_schema.request_drafts WHERE tenant_id=$1 AND employee_id=$2 AND status='DRAFT' ORDER BY updated_at DESC LIMIT 200",
      [context.tenantId, context.employeeId],
    );
    return { data: result.rows.map(mapDraft) };
  }
  @Post('request-drafts/:kind')
  async createDraft(
    @Req() req: Request,
    @Param('kind') kindValue: string,
    @Body() body: { employeeId?: string; payload: unknown },
  ) {
    const kind = normalizeHrmRequestKind(kindValue);
    const { pool, tenantId, employeeId, principal } =
      await this.ctx.getRequestContext(req, body.employeeId);
    const payload = draftPayload(body.payload);
    return hrmTransaction(pool, async (db) => {
      await lockEmployee(db, tenantId, employeeId);
      const row = (
        await db.query(
          'INSERT INTO hrm_schema.request_drafts(tenant_id,employee_id,request_kind,payload,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *',
          [
            tenantId,
            employeeId,
            kind,
            JSON.stringify(payload),
            principal.userId,
          ],
        )
      ).rows[0];
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'REQUEST_DRAFT_CREATED',
        row.id,
        { kind },
      );
      return { data: mapDraft(row) };
    });
  }
  @Patch('request-drafts/:kind/:id')
  async updateDraft(
    @Req() req: Request,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: { payload: unknown; expectedUpdatedAt: string },
  ) {
    return this.mutateDraft(req, kind, id, body, false);
  }
  @Delete('request-drafts/:kind/:id')
  async deleteDraft(
    @Req() req: Request,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: { expectedUpdatedAt: string },
  ) {
    return this.mutateDraft(req, kind, id, body, true);
  }
  private async mutateDraft(
    req: Request,
    kindValue: string,
    id: string,
    body: { expectedUpdatedAt: string; payload?: unknown },
    remove: boolean,
  ) {
    const kind = normalizeHrmRequestKind(kindValue);
    requireUuid(id, 'Bản nháp');
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.read',
    );
    return hrmTransaction(pool, async (db) => {
      const owner = (
        await db.query(
          "SELECT employee_id FROM hrm_schema.request_drafts WHERE tenant_id=$1 AND request_kind=$2 AND id=$3 AND status<>'DELETED'",
          [tenantId, kind, id],
        )
      ).rows[0];
      if (!owner) throw new NotFoundException('Không tìm thấy bản nháp');
      await this.ctx.getRequestContext(req, owner.employee_id);
      await lockEmployee(db, tenantId, owner.employee_id);
      const before = (
        await db.query(
          "SELECT * FROM hrm_schema.request_drafts WHERE tenant_id=$1 AND id=$2 AND status<>'DELETED' FOR UPDATE",
          [tenantId, id],
        )
      ).rows[0];
      if (!before) throw new NotFoundException('Không tìm thấy bản nháp');
      if (before.status !== 'DRAFT')
        throw new ConflictException(
          'Đơn đã gửi; không thể sửa hoặc xóa bản nháp.',
        );
      assertLifecycleVersion(before, body.expectedUpdatedAt);
      const row = (
        await db.query(
          "UPDATE hrm_schema.request_drafts SET payload=$3,status=$4,revision=revision+1,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE tenant_id=$1 AND id=$2 RETURNING *",
          [
            tenantId,
            id,
            JSON.stringify(
              remove ? before.payload : draftPayload(body.payload),
            ),
            remove ? 'DELETED' : 'DRAFT',
          ],
        )
      ).rows[0];
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        remove ? 'REQUEST_DRAFT_DELETED' : 'REQUEST_DRAFT_UPDATED',
        id,
        { kind, before, after: row },
      );
      return { data: mapDraft(row) };
    });
  }
  @Post('requests/:kind/:id/withdraw')
  async withdraw(
    @Req() req: Request,
    @Param('kind') kind: string,
    @Param('id') id: string,
  ) {
    const tables: Record<string, string> = {
      leave: 'leave_requests',
      ot: 'ot_requests',
      business_trip: 'business_trip_requests',
      shift_change: 'shift_change_requests',
      correction: 'attendance_corrections',
      advance: 'salary_advance_requests',
      profile_correction: 'profile_corrections',
    };
    const table = tables[kind];
    if (!table) throw new BadRequestException('Loại đơn không hợp lệ');
    requireUuid(id, 'Đơn');
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.read',
    );
    const outcome = await hrmTransaction(pool, async (db) => {
      const row = (
        await db.query(
          `SELECT * FROM hrm_schema.${table} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
          [tenantId, id],
        )
      ).rows[0];
      if (!row) throw new NotFoundException('Không tìm thấy đơn');
      await this.ctx.getRequestContext(req, row.employee_id);
      if (row.status === 'CANCELLED') return { data: { withdrawn: true } };
      if (!['PENDING', 'PEER_CONFIRMED'].includes(row.status))
        throw new BadRequestException('Chỉ rút đơn chưa được phê duyệt');
      const link = (
        await db.query(
          `SELECT * FROM hrm_schema.procedure_links WHERE tenant_id=$1 AND request_kind=$2 AND request_id=$3 ORDER BY revision DESC LIMIT 1`,
          [tenantId, kind, id],
        )
      ).rows[0];
      if (link) {
        if (!link.instance_id)
          throw new ConflictException(
            'Đơn đang chờ khởi tạo quy trình; thử lại sau khi đồng bộ',
          );
        return { link };
      }
      if (kind === 'leave')
        await transitionLeave(
          db,
          tenantId,
          principal.userId,
          id,
          'CANCELLED',
          'Người gửi rút đơn',
        );
      else
        await db.query(
          `UPDATE hrm_schema.${table} SET status='CANCELLED' WHERE tenant_id=$1 AND id=$2`,
          [tenantId, id],
        );
      await db.query(
        `INSERT INTO hrm_schema.audit_log(tenant_id,actor_id,action,entity_type,entity_id,detail) VALUES($1,$2,'REQUEST_WITHDRAW',$3,$4,'{}')`,
        [tenantId, principal.userId, kind, id],
      );
      return { data: { withdrawn: true } };
    });
    if ('link' in outcome) {
      const link = await this.bridge.applyAction(
        req,
        {
          tenantId,
          kind: normalizeHrmRequestKind(kind),
          requestId: id,
          revision: outcome.link.revision,
        },
        {
          action: 'CANCEL',
          comment: 'Người gửi rút đơn',
          idempotencyKey: `withdraw:${outcome.link.revision}`,
        },
      );
      return {
        data: {
          withdrawn: false,
          procedureSyncStatus: link.syncStatus,
          procedureLinkId: link.id,
        },
      };
    }
    return outcome;
  }
  @Post('requests/:kind/:id/reverse')
  async reverseRequest(
    @Req() req: Request,
    @Param('kind') kindValue: string,
    @Param('id') id: string,
    @Body() body: { expectedUpdatedAt: string; reason: string },
  ) {
    const kind = normalizeHrmRequestKind(kindValue);
    const permissions: Partial<Record<typeof kind, HrmAction>> = {
      leave: 'hrm.leave.approve',
      ot: 'hrm.ot.approve',
      business_trip: 'hrm.trip.approve',
      correction: 'hrm.attendance.approve',
      advance: 'hrm.advance.approve',
    };
    const permission = permissions[kind];
    if (!permission)
      throw new BadRequestException(
        'Loại đơn này cần gửi yêu cầu điều chỉnh mới.',
      );
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      permission,
    );
    requireUuid(id, 'Đơn');
    await this.approvals.assertCanDecide(
      { pool, tenantId, principal },
      id,
      kind,
      'reverse',
    );
    const reason = requireText(body.reason, 'Lý do hủy hiệu lực', 2000);
    return {
      data: await hrmTransaction(pool, (db) =>
        reverseApprovedRequest(
          db,
          tenantId,
          principal.userId,
          kind,
          id,
          body.expectedUpdatedAt,
          reason,
        ),
      ),
    };
  }
  @Get('request-workflows')
  async requestWorkflows(
    @Req() req: Request,
    @Query('assignee') assignee?: string,
    @Query('currentStep') currentStep?: string,
  ) {
    const context = await this.ctx.getContext(req, 'hrm.read'),
      { pool, tenantId } = context;
    const all = this.ctx.has(context, 'hrm.request.read');
    if (!all && !this.ctx.has(context, 'hrm.self.read')) return { data: [] };
    const employeeId = all
      ? null
      : (
          await this.ctx.resolveEmployee(
            pool,
            tenantId,
            context.principal.userId,
          )
        ).employeeId;
    // Cột tiến độ chỉ có sau migration 0029; chưa chạy thì trả null và bỏ qua bộ lọc.
    const progressReady = await procedureProgressSchemaReady(pool);
    const progress = progressReady
      ? workflowProgressFilter('procedure_links', 3, { assignee, currentStep })
      : { sql: 'TRUE', params: [] as unknown[] };
    const progressColumns = progressReady
      ? 'current_step_name,current_assignee_name'
      : 'NULL::text AS current_step_name,NULL::text AS current_assignee_name';
    const result = await pool.query(
      `SELECT id,CASE request_kind WHEN 'leave' THEN 'LEAVE' WHEN 'ot' THEN 'OT' WHEN 'shift_change' THEN 'SHIFT_CHANGE' WHEN 'business_trip' THEN 'BUSINESS_TRIP' WHEN 'correction' THEN 'ATTENDANCE' WHEN 'advance' THEN 'ADVANCE' ELSE 'PROFILE' END AS request_kind,request_id,revision,instance_id,instance_code,sync_status AS status,attempts,last_error,created_at,updated_at,applied_at,${progressColumns} FROM hrm_schema.procedure_links WHERE tenant_id=$1 AND ${progress.sql} AND ($2::uuid IS NULL OR employee_id=$2 OR (request_kind='shift_change' AND EXISTS(SELECT 1 FROM hrm_schema.shift_change_requests r WHERE r.tenant_id=$1 AND r.id=request_id AND r.swap_with_employee_id=$2))) ORDER BY created_at DESC LIMIT 1000`,
      [tenantId, employeeId, ...progress.params],
    );
    return {
      data: result.rows.map((row) => ({
        ...row,
        instanceId: row.instance_id ?? null,
        procedureInstanceId: row.instance_id ?? null,
        procedureRevision: Number(row.revision),
        currentStepName: row.current_step_name ?? null,
        currentAssigneeName: row.current_assignee_name ?? null,
      })),
    };
  }
  @Get('operations/audit')
  async audit(
    @Req() req: Request,
    @Query('action') action?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.audit.read');
    for (const [value, field] of [
      [from, 'Từ ngày'],
      [to, 'Đến ngày'],
    ] as const)
      if (value) requireDate(value, field);
    const size = Math.min(100, Math.max(1, Number(pageSize) || 25));
    const result = await listAuditTrail(pool, tenantId, {
      action: action?.trim() || undefined,
      search: search?.trim().slice(0, 200) || undefined,
      from: from || undefined,
      to: to || undefined,
      page: Math.max(1, Number(page) || 1),
      pageSize: size,
    });
    return {
      data: result.rows,
      meta: { total: result.total, actions: result.actions },
    };
  }
  @Get('operations')
  async get(
    @Req() req: Request,
    @Query('auditAction') auditAction?: string,
    @Query('auditEntityId') auditEntityId?: string,
  ) {
    const context = await this.ctx.getContext(req, 'hrm.read'),
      { pool, tenantId } = context;
    const automation = this.ctx.has(context, 'hrm.automation.manage'),
      integration = this.ctx.has(context, 'hrm.integration.manage'),
      audit = this.ctx.has(context, 'hrm.audit.read');
    if (!automation && !integration && !audit)
      await this.ctx.getContext(req, 'hrm.audit.read');
    const result = await Promise.all([
      automation
        ? pool.query(
            // Cột date trả về chuỗi để không lệch ngày khi serialize theo UTC.
            `SELECT *,to_char(last_success_date,'YYYY-MM-DD') AS last_success_date FROM hrm_schema.automation_settings WHERE tenant_id=$1`,
            [tenantId],
          )
        : null,
      automation
        ? pool.query(
            `SELECT * FROM hrm_schema.automation_runs WHERE tenant_id=$1 ORDER BY started_at DESC LIMIT 100`,
            [tenantId],
          )
        : null,
      integration
        ? pool.query(
            `SELECT id,CASE request_kind WHEN 'leave' THEN 'LEAVE' WHEN 'ot' THEN 'OT' WHEN 'shift_change' THEN 'SHIFT_CHANGE' WHEN 'business_trip' THEN 'BUSINESS_TRIP' WHEN 'correction' THEN 'ATTENDANCE' WHEN 'advance' THEN 'ADVANCE' ELSE 'PROFILE' END AS request_kind,request_kind AS kind,sub_type_code,procedure_definition_id AS definition_id,mode,configuration_status,(mode='PROCEDURE') AS enabled,updated_at FROM hrm_schema.request_procedure_bindings WHERE tenant_id=$1 AND is_active ORDER BY request_kind,sub_type_code NULLS FIRST`,
            [tenantId],
          )
        : null,
      integration
        ? pool.query(
            `SELECT l.id,CASE l.request_kind WHEN 'leave' THEN 'LEAVE' WHEN 'ot' THEN 'OT' WHEN 'shift_change' THEN 'SHIFT_CHANGE' WHEN 'business_trip' THEN 'BUSINESS_TRIP' WHEN 'correction' THEN 'ATTENDANCE' WHEN 'advance' THEN 'ADVANCE' ELSE 'PROFILE' END AS request_kind,l.request_id,l.definition_id,l.definition_version_id,l.instance_id,l.instance_code,l.sync_status AS status,l.attempts,l.last_error,l.legacy_link_id,l.attempted_at,l.created_at,l.updated_at,l.applied_at,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('instanceId',c.instance_id,'sourceType',c.source_type,'sourceId',c.source_id) ORDER BY c.instance_id::text,c.source_type,c.source_id::text) FROM hrm_schema.procedure_correlations c WHERE c.tenant_id=l.tenant_id AND c.link_id=l.id),'[]'::jsonb) AS related_instances
            ,(SELECT ed.employee_code||' · '||ed.full_name FROM hrm_schema.employee_directory ed WHERE ed.tenant_id=l.tenant_id AND ed.employee_id=l.employee_id) AS employee_label,l.title
            FROM hrm_schema.procedure_links l WHERE l.tenant_id=$1 ORDER BY l.created_at DESC LIMIT 200`,
            [tenantId],
          )
        : null,
      audit
        ? pool.query(
            `SELECT * FROM hrm_schema.audit_log WHERE tenant_id=$1
              AND ($2::text IS NULL OR action=$2)
              AND ($3::uuid IS NULL OR entity_id=$3)
              ORDER BY created_at DESC LIMIT 200`,
            [
              tenantId,
              auditAction?.trim() || null,
              auditEntityId?.trim()
                ? requireUuid(auditEntityId, 'Mã đối tượng')
                : null,
            ],
          )
        : null,
    ]);
    return {
      data: {
        settings: result[0]?.rows[0] || null,
        runs: result[1]?.rows || [],
        rules: result[2]?.rows || [],
        workflows: result[3]?.rows || [],
        procedureAvailable: integration
          ? await this.ctx.procedureAvailable(tenantId)
          : undefined,
        audit: result[4]?.rows || [],
      },
    };
  }
  @Post('operations/automation')
  async configure(
    @Req() req: Request,
    @Body()
    body: {
      enabled: boolean;
      timezone: string;
      fromMonth: string;
      carryoverEnabled: boolean;
      runHour: number;
    },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.automation.manage',
    );
    requireDate(`${body.fromMonth}-01`, 'Tháng bắt đầu');
    const start = Date.parse(`${body.fromMonth}-01`),
      now = Date.now();
    if (
      start > now ||
      now - start > 730 * 86400000 ||
      typeof body.enabled !== 'boolean' ||
      typeof body.carryoverEnabled !== 'boolean' ||
      !Number.isInteger(body.runHour) ||
      body.runHour < 0 ||
      body.runHour > 23
    )
      throw new BadRequestException(
        'Cấu hình tác vụ không hợp lệ; tháng bắt đầu phải trong 24 tháng gần nhất',
      );
    try {
      new Intl.DateTimeFormat('en', { timeZone: body.timezone }).format();
    } catch {
      throw new BadRequestException('Múi giờ không hợp lệ');
    }
    const result = await pool.query(
      `INSERT INTO hrm_schema.automation_settings(tenant_id,enabled,timezone,from_month,carryover_enabled,run_hour,configured_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id) DO UPDATE SET enabled=$2,timezone=$3,from_month=$4,carryover_enabled=$5,run_hour=$6,configured_by=$7,updated_at=now(),last_success_date=NULL,last_attempt_at=NULL,last_accrual_month=NULL RETURNING *`,
      [
        tenantId,
        body.enabled,
        body.timezone,
        body.fromMonth,
        body.carryoverEnabled,
        body.runHour,
        principal.userId,
      ],
    );
    return { data: result.rows[0] };
  }
  @Post('operations/automation/run')
  async run(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.automation.manage',
    );
    return { data: await runHrmAutomation(pool, tenantId, true) };
  }
  @Get('operations/leave-year-end-checklist')
  async leaveYearEndChecklist(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.automation.manage',
    );
    const settings = (
      await pool.query(
        `SELECT carryover_enabled,timezone FROM hrm_schema.automation_settings WHERE tenant_id=$1`,
        [tenantId],
      )
    ).rows[0];
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: settings?.timezone || 'Asia/Ho_Chi_Minh',
    });
    return {
      data: await yearEndChecklist(
        pool,
        tenantId,
        today,
        Boolean(settings?.carryover_enabled),
      ),
    };
  }
  @Get('operations/subtype-catalog')
  async subtypeCatalog(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.integration.manage',
    );
    return { data: await loadSubtypeCatalog(pool, tenantId) };
  }
  /** Danh mục trường HRM có thể ánh xạ vào thuộc tính Procedure (lọc theo loại đơn nếu có). */
  @Get('operations/field-catalog')
  async fieldCatalog(
    @Req() req: Request,
    @Query('requestKind') requestKind?: string,
  ) {
    await this.ctx.getContext(req, 'hrm.integration.manage');
    return {
      data: fieldCatalogFor(
        requestKind ? normalizeHrmRequestKind(requestKind) : undefined,
      ),
    };
  }
  /** Thuộc tính cấp quy trình và bước S của định nghĩa đã công bố (đọc qua API Procedure). */
  @Get('operations/procedure-definitions/:definitionId/attributes')
  async definitionAttributes(
    @Req() req: Request,
    @Param('definitionId') definitionId: string,
  ) {
    const { tenantId } = await this.ctx.getContext(
      req,
      'hrm.integration.manage',
    );
    requireUuid(definitionId, 'Quy trình');
    const definition = await fetchPublishedProcedureDefinition(
      tenantId,
      definitionId,
    );
    return {
      data: initialProcedureAttributes(definition).map((attribute) => ({
        code: attribute.code,
        name: attribute.name,
        type: attribute.type,
        required: Boolean(attribute.required),
        scope: attribute.scope,
        valueKey: attribute.valueKey,
        stepId: attribute.scope === 'step' ? attribute.valueKey.split(':')[1] : '',
        stepName: attribute.stepName ?? '',
      })),
    };
  }
  @Get('operations/workflow-rules/:bindingId/field-mappings')
  async fieldMappings(
    @Req() req: Request,
    @Param('bindingId') bindingId: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.integration.manage',
    );
    requireUuid(bindingId, 'Cấu hình quy trình');
    const binding = (
      await pool.query(
        `SELECT id,request_kind,sub_type_code,mode,procedure_definition_id FROM hrm_schema.request_procedure_bindings WHERE tenant_id=$1 AND id=$2`,
        [tenantId, bindingId],
      )
    ).rows[0];
    if (!binding)
      throw new NotFoundException('Không tìm thấy cấu hình quy trình');
    const { mappings, isDefault } = await loadBindingMappings(
      pool,
      tenantId,
      bindingId,
      binding.request_kind,
    );
    return {
      data: {
        bindingId,
        requestKind: binding.request_kind,
        subTypeCode: binding.sub_type_code,
        mode: binding.mode,
        definitionId: binding.procedure_definition_id,
        isDefault,
        mappings,
        catalog: fieldCatalogFor(binding.request_kind),
      },
    };
  }
  @Put('operations/workflow-rules/:bindingId/field-mappings')
  async saveFieldMappings(
    @Req() req: Request,
    @Param('bindingId') bindingId: string,
    @Body() body: { mappings?: unknown },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.integration.manage',
    );
    requireUuid(bindingId, 'Cấu hình quy trình');
    const saved = await hrmTransaction(pool, (db) =>
      saveBindingFieldMappings(db, {
        tenantId,
        bindingId,
        actorId: principal.userId,
        mappings: body?.mappings,
      }),
    );
    return { data: { saved: true, mappings: saved.mappings } };
  }
  @Get('operations/procedure-definitions')
  async definitions(@Req() req: Request) {
    const { tenantId } = await this.ctx.getContext(
      req,
      'hrm.integration.manage',
    );
    return { data: await procedureDefinitions(req, tenantId) };
  }
  @Post('operations/workflow-rules')
  async workflowRule(
    @Req() req: Request,
    @Body()
    body: {
      requestKind: string;
      definitionId?: string;
      enabled?: boolean;
      mode?: 'DIRECT' | 'PROCEDURE';
      subTypeCode?: string;
    },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.integration.manage',
    );
    const kind = normalizeHrmRequestKind(body.requestKind);
    if (!body.mode && typeof body.enabled !== 'boolean')
      throw new BadRequestException('Cần chọn chế độ duyệt');
    const mode = body.mode ?? (body.enabled ? 'PROCEDURE' : 'DIRECT');
    if (mode === 'PROCEDURE' && !(await this.ctx.procedureAvailable(tenantId)))
      throw procedureUnavailable();
    if (
      mode === 'PROCEDURE' &&
      !(await procedureDefinitions(req, tenantId)).some(
        (d) => d.id === body.definitionId,
      )
    )
      throw new BadRequestException(
        'Quy trình phải được công bố và thuộc tenant hiện tại',
      );
    const saved = await hrmTransaction(pool, (db) =>
      saveHrmProcedureBinding(db, {
        tenantId,
        kind,
        subTypeCode: body.subTypeCode,
        mode,
        definitionId: body.definitionId,
        actorId: principal.userId,
      }),
    );
    const { warnings = [], ...binding } = saved as typeof saved & {
      warnings?: string[];
    };
    return { data: { saved: true, binding, warnings } };
  }
  @Post('operations/workflows/:id/retry')
  async retry(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.integration.manage',
    );
    requireUuid(id, 'Liên kết');
    // "Gắn lại quy trình" cho liên kết CONFLICT chưa tạo instance: nạp lại bản chụp định nghĩa
    // hiện hành qua API Procedure (ngoài transaction), vì xung đột thường do định nghĩa đã đổi.
    const preview = (
      await pool.query(
        'SELECT sync_status,instance_id,definition_id FROM hrm_schema.procedure_links WHERE tenant_id=$1 AND id=$2',
        [tenantId, id],
      )
    ).rows[0];
    const relinkSnapshot =
      preview?.sync_status === 'CONFLICT' &&
      !preview.instance_id &&
      preview.definition_id
        ? await fetchPublishedProcedureDefinition(
            tenantId,
            preview.definition_id,
          )
        : null;
    const result = await hrmTransaction(pool, async (db) => {
      const link = (
        await db.query(
          `SELECT id,sync_status,instance_id,attempts,last_error,lease_until FROM hrm_schema.procedure_links
          WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
          [tenantId, id],
        )
      ).rows[0];
      if (!link)
        throw new NotFoundException('Không tìm thấy liên kết Procedure');
      const relink = link.sync_status === 'CONFLICT';
      if (
        (link.sync_status !== 'FAILED' && !relink) ||
        (relink && (link.instance_id || !relinkSnapshot)) ||
        (link.lease_until && new Date(link.lease_until).getTime() > Date.now())
      )
        throw new BadRequestException(
          relink
            ? 'Liên kết đang xung đột; cần đối soát các instance liên quan'
            : 'Chỉ thử lại liên kết đang lỗi và không có tiến trình xử lý',
        );
      const status = link.instance_id ? 'APPLY_PENDING' : 'START_PENDING';
      const queued = (
        await db.query(
          `UPDATE hrm_schema.procedure_links
          SET sync_status=$3,attempted_at=NULL,lease_until=NULL,lease_token=NULL,updated_at=now(),
            last_error=CASE WHEN $4::jsonb IS NULL THEN last_error ELSE NULL END,
            definition_snapshot=COALESCE($4::jsonb,definition_snapshot)
          WHERE tenant_id=$1 AND id=$2 AND sync_status=$5
          RETURNING id,sync_status AS status,attempts,last_error`,
          [
            tenantId,
            id,
            status,
            relink ? JSON.stringify(relinkSnapshot) : null,
            link.sync_status,
          ],
        )
      ).rows[0];
      await db.query(
        `INSERT INTO hrm_schema.audit_log(tenant_id,actor_id,action,entity_type,entity_id,detail)
        VALUES($1,$2,$5,'procedure_link',$3,$4)`,
        [
          tenantId,
          principal.userId,
          id,
          JSON.stringify({
            previousStatus: link.sync_status,
            queuedStatus: status,
            attempts: link.attempts,
            lastError: link.last_error,
          }),
          relink ? 'PROCEDURE_RELINK_QUEUED' : 'PROCEDURE_RETRY_QUEUED',
        ],
      );
      return queued;
    });
    if (!result)
      throw new BadRequestException('Không thể xếp hàng thử lại liên kết');
    return {
      data: {
        queued: true,
        status: result.status,
        attempts: result.attempts,
        lastError: result.last_error,
      },
    };
  }
  @Get('my-notifications')
  async notifications(@Req() req: Request) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.self.read',
    );
    const { employeeId } = await this.ctx.resolveEmployee(
      pool,
      tenantId,
      principal.userId,
    );
    return {
      data: (
        await pool.query(
          `SELECT id,request_kind,request_id,status,created_at,read_at FROM hrm_schema.notifications WHERE tenant_id=$1 AND employee_id=$2 ORDER BY created_at DESC LIMIT 100`,
          [tenantId, employeeId],
        )
      ).rows,
    };
  }
  @Post('my-notifications/:id/read')
  async readNotification(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.self.read',
    );
    const { employeeId } = await this.ctx.resolveEmployee(
      pool,
      tenantId,
      principal.userId,
    );
    const result = await pool.query(
      `UPDATE hrm_schema.notifications SET read_at=COALESCE(read_at,now()) WHERE tenant_id=$1 AND employee_id=$2 AND id=$3 RETURNING id`,
      [tenantId, employeeId, requireUuid(id, 'Thông báo')],
    );
    if (!result.rowCount)
      throw new NotFoundException('Không tìm thấy thông báo');
    return { data: { read: true } };
  }
  @Get('my-calendar')
  async calendar(
    @Req() req: Request,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    requireDate(from, 'Từ ngày');
    requireDate(to, 'Đến ngày');
    if (to < from || Date.parse(to) - Date.parse(from) > 63 * 86400000)
      throw new BadRequestException('Chỉ xem tối đa 63 ngày');
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.self.read',
    );
    const { employeeId } = await this.ctx.resolveEmployee(
      pool,
      tenantId,
      principal.userId,
    );
    const result = await pool.query(
      `SELECT * FROM (
      SELECT 'SHIFT' AS kind,d::date AS date,s.name AS label,s.start_time::text||' – '||s.end_time::text AS detail,a.id::text AS reference_id FROM generate_series($3::date,$4::date,'1 day') d JOIN hrm_schema.shift_assignments a ON a.tenant_id=$1 AND a.employee_id=$2 AND a.status='ACTIVE' AND d::date BETWEEN a.effective_from AND COALESCE(a.effective_to,'infinity'::date) JOIN hrm_schema.shift_definitions s ON s.tenant_id=a.tenant_id AND s.id=a.shift_id
      UNION ALL SELECT day_kind,work_date,name,CASE WHEN paid THEN 'Có hưởng lương' ELSE 'Không hưởng lương' END,id::text FROM hrm_schema.work_calendar WHERE tenant_id=$1 AND work_date BETWEEN $3::date AND $4::date
      UNION ALL SELECT 'LEAVE',d::date,t.name,'Đã duyệt',r.id::text FROM hrm_schema.leave_requests r JOIN hrm_schema.leave_types t ON t.tenant_id=r.tenant_id AND t.id=r.leave_type_id CROSS JOIN LATERAL generate_series(GREATEST(r.from_date,$3::date),LEAST(r.to_date,$4::date),'1 day') d WHERE r.tenant_id=$1 AND r.employee_id=$2 AND r.status='APPROVED'
      UNION ALL SELECT 'OT',work_date,'Tăng ca',start_time::text||' – '||end_time::text,id::text FROM hrm_schema.ot_requests WHERE tenant_id=$1 AND employee_id=$2 AND status='APPROVED' AND work_date BETWEEN $3::date AND $4::date
      UNION ALL SELECT 'BUSINESS_TRIP',d::date,'Công tác','Đã duyệt',r.id::text FROM hrm_schema.business_trip_requests r CROSS JOIN LATERAL generate_series(GREATEST(r.from_date,$3::date),LEAST(r.to_date,$4::date),'1 day') d WHERE r.tenant_id=$1 AND r.employee_id=$2 AND r.status='APPROVED'
    ) events ORDER BY date,kind`,
      [tenantId, employeeId, from, to],
    );
    return {
      data: result.rows.map((row) => ({
        ...row,
        date:
          row.date instanceof Date
            ? `${row.date.getFullYear()}-${String(row.date.getMonth() + 1).padStart(2, '0')}-${String(row.date.getDate()).padStart(2, '0')}`
            : String(row.date).slice(0, 10),
      })),
    };
  }
}
