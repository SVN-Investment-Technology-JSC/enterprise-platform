import type { CreateCustomRequestPayload } from '@enterprise-platform/contracts-hrm';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import {
  HrmApprovalPolicyService,
  approverPermissions,
} from '../infrastructure/hrm-approval-policy.js';
import {
  createCustomRequest,
  mapCustomRequest,
  transitionCustomRequest,
} from '../infrastructure/hrm-custom-request.js';
import { saveRequestTransport } from '../infrastructure/hrm-fleet.js';
import { HrmMissingSchemaInterceptor } from '../infrastructure/hrm-missing-schema.interceptor.js';
import { HrmProcedureBridgeService } from '../infrastructure/hrm-procedure-bridge.service.js';
import { attachProcedureLinkInfo } from '../infrastructure/hrm-procedure-link-info.js';
import { syncEmployeeProcedureResults } from '../infrastructure/hrm-procedure-sync.js';
import {
  resolveDraftSubmission,
  type DraftSubmission,
} from '../infrastructure/hrm-request-drafts.js';
import { loadActiveCustomType } from '../infrastructure/hrm-request-types.js';
import { submitHrmRequest } from '../infrastructure/hrm-submission.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { rejectionNote, requireUuid } from '../infrastructure/hrm-validation.js';
import { workflowProgressFilter } from '../infrastructure/hrm-workflow-filter.js';

/**
 * Đơn của loại do quản trị tạo (engine GENERIC, kind `custom`). Quyền tạo như các đơn khác (`hrm.self.request`, hoặc
 * `hrm.request.manage` để tạo hộ); duyệt cần `hrm.request.approve` (trong phạm vi) hoặc `hrm.request.approve.all`.
 * Rút đơn đang chờ dùng chung `POST requests/custom/:id/withdraw`.
 */
@UseInterceptors(HrmMissingSchemaInterceptor)
@Controller('v1')
export class HrmCustomRequestController {
  constructor(
    private readonly ctx: HrmContextService,
    private readonly bridge: HrmProcedureBridgeService,
    private readonly approvals: HrmApprovalPolicyService = new HrmApprovalPolicyService(),
  ) {}

  @Post('custom-requests')
  async create(
    @Req() req: Request,
    @Body()
    body: CreateCustomRequestPayload & DraftSubmission & { attributes?: Record<string, unknown> },
  ) {
    const { pool, tenantId, employeeId, principal } = await this.ctx.getRequestContext(
      req,
      body?.employeeId,
    );
    await syncEmployeeProcedureResults(pool, tenantId, employeeId);
    const submission = await resolveDraftSubmission(pool, tenantId, employeeId, 'custom', body);
    body = submission.body;
    const type = await loadActiveCustomType(pool, tenantId, requireUuid(body.typeId, 'Loại đơn'));
    const { row, link } = await submitHrmRequest(
      pool,
      this.bridge,
      {
        tenantId,
        kind: 'custom',
        draft: submission.draft,
        employeeId,
        initiatedBy: principal.userId,
        title: String(type.name),
        attributes: body.attributes,
      },
      async (db) => {
        const created = await createCustomRequest(db, tenantId, principal.userId, { ...body, employeeId });
        // Khối phương tiện chỉ có ở loại đơn bật "Cần phương tiện".
        if (!body.transport || !type.requires_transport) return created;
        const transport = await saveRequestTransport(
          db,
          tenantId,
          {
            table: 'custom_requests',
            sourceType: 'CUSTOM_REQUEST',
            requestId: String(created.id),
            requesterEmployeeId: employeeId,
            sourceLabel: `${String(type.name)}`,
            purpose: created.reason ?? null,
            defaultRange:
              created.from_at && created.to_at
                ? {
                    startAt: new Date(created.from_at).toISOString(),
                    endAt: new Date(created.to_at).toISOString(),
                  }
                : null,
          },
          body.transport,
        );
        return { ...created, ...transport };
      },
    );
    return {
      data: {
        ...mapCustomRequest(row),
        procedureSyncStatus: link?.syncStatus ?? null,
        currentStepName: link?.currentStepName ?? null,
        currentAssigneeName: link?.currentAssigneeName ?? null,
        procedureWarnings: link?.warnings ?? [],
        procedureError: link?.lastError ?? null,
        procedureLinkId: link?.id ?? null,
      },
    };
  }

  @Get('custom-requests')
  async list(
    @Req() req: Request,
    @Query('employee_id') employeeId?: string,
    @Query('type_id') typeId?: string,
    @Query('status') status?: string,
    @Query('from') fromDate?: string,
    @Query('to') toDate?: string,
    @Query('forApproval') forApproval?: string,
    @Query('assignee') assignee?: string,
    @Query('currentStep') currentStep?: string,
  ) {
    const {
      pool,
      tenantId,
      principal,
      employeeId: visibleEmployeeId,
    } = await this.ctx.scoped(
      req,
      'hrm.request.read',
      employeeId,
      forApproval === '1' ? approverPermissions('custom') : [],
    );
    employeeId = visibleEmployeeId;
    if (typeId) requireUuid(typeId, 'Loại đơn');
    if (status && !['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(status))
      throw new BadRequestException('Trạng thái không hợp lệ.');
    if (employeeId) await syncEmployeeProcedureResults(pool, tenantId, employeeId);
    const approvalScope =
      forApproval === '1'
        ? await this.approvals.listFilter({ pool, tenantId, principal }, 'custom', 'custom_requests', 7)
        : { sql: 'TRUE', params: [] as unknown[] };
    const progress = workflowProgressFilter('custom_requests', 7 + approvalScope.params.length, {
      assignee,
      currentStep,
    });
    const res = await pool.query(
      `SELECT * FROM hrm_schema.custom_requests
        WHERE tenant_id = $1
          AND ($2::uuid IS NULL OR employee_id = $2)
          AND ($3::uuid IS NULL OR type_id = $3)
          AND ($4::text IS NULL OR status = $4)
          AND ($5::date IS NULL OR created_at >= $5)
          AND ($6::date IS NULL OR created_at < $6::date + 1)
          AND ${approvalScope.sql}
          AND ${progress.sql}
        ORDER BY created_at DESC`,
      [
        tenantId,
        employeeId || null,
        typeId || null,
        status || null,
        fromDate || null,
        toDate || null,
        ...approvalScope.params,
        ...progress.params,
      ],
    );
    return {
      data: await attachProcedureLinkInfo(pool, tenantId, 'custom', res.rows.map(mapCustomRequest)),
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('custom-requests/:id/approve')
  async approve(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.approverContext(req, 'hrm.request.approve', 'custom', id);
    requireUuid(id, 'Đơn');
    await this.approvals.assertCanDecide({ pool, tenantId, principal }, id, 'custom', 'approve');
    const row = await hrmTransaction(pool, (db) =>
      transitionCustomRequest(db, tenantId, principal.userId, id, 'APPROVED'),
    );
    return { data: mapCustomRequest(row), meta: { requestId: req.headers['x-request-id'] as string } };
  }

  @Post('custom-requests/:id/reject')
  async reject(@Req() req: Request, @Param('id') id: string, @Body('reason') reason: string) {
    const { pool, tenantId, principal } = await this.ctx.approverContext(req, 'hrm.request.approve', 'custom', id);
    requireUuid(id, 'Đơn');
    await this.approvals.assertCanDecide({ pool, tenantId, principal }, id, 'custom', 'reject');
    const text = rejectionNote(reason) ?? undefined;
    const row = await hrmTransaction(pool, (db) =>
      transitionCustomRequest(db, tenantId, principal.userId, id, 'REJECTED', text),
    );
    return { data: mapCustomRequest(row), meta: { requestId: req.headers['x-request-id'] as string } };
  }
}
