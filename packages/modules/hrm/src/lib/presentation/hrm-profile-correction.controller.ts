import { attachProcedureLinkInfo } from '../infrastructure/hrm-procedure-link-info.js';
import { HrmApprovalPolicyService } from '../infrastructure/hrm-approval-policy.js';
import { workflowProgressFilter } from '../infrastructure/hrm-workflow-filter.js';
import {
  resolveDraftSubmission,
  type DraftSubmission,
} from '../infrastructure/hrm-request-drafts.js';
import { approveProfileCorrection } from '../infrastructure/hrm-request-transition.js';
import {
  profileCorrectionFields as fields,
  profileCorrectionValue as value,
} from '../infrastructure/hrm-request-transition.js';
import {
  parseDocumentChanges,
  validateDocumentChanges,
} from '../infrastructure/hrm-profile-documents.js';
import { submitHrmRequest } from '../infrastructure/hrm-submission.js';
import { HrmProcedureBridgeService } from '../infrastructure/hrm-procedure-bridge.service.js';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { lockEmployee } from '../infrastructure/hrm-time.js';
import { requireDate, requireText } from '../infrastructure/hrm-validation.js';

@Controller('v1/profile-corrections')
export class HrmProfileCorrectionController {
  constructor(
    private readonly ctx: HrmContextService,
    private readonly bridge: HrmProcedureBridgeService,
    private readonly approvals: HrmApprovalPolicyService = new HrmApprovalPolicyService(),
  ) {}
  @Get()
  async list(
    @Req() req: Request,
    @Query('employee_id') employeeId?: string,
    @Query('status') status?: string,
    @Query('forApproval') forApproval?: string,
    @Query('assignee') assignee?: string,
    @Query('currentStep') currentStep?: string,
  ) {
    const {
      pool,
      tenantId,
      principal,
      employeeId: visibleEmployeeId,
    } = await this.ctx.scoped(req, 'hrm.request.read', employeeId);
    employeeId = visibleEmployeeId;
    const approvalScope =
      forApproval === '1'
        ? await this.approvals.listFilter(
            { pool, tenantId, principal },
            'profile_correction',
            'profile_corrections',
            4,
          )
        : { sql: 'TRUE', params: [] as unknown[] };
    const progress = workflowProgressFilter(
      'profile_corrections',
      4 + approvalScope.params.length,
      { assignee, currentStep },
    );
    const result = await pool.query(
      `SELECT * FROM hrm_schema.profile_corrections WHERE tenant_id=$1 AND ($2::uuid IS NULL OR employee_id=$2) AND ($3::text IS NULL OR status=$3) AND ${approvalScope.sql} AND ${progress.sql} ORDER BY created_at DESC`,
      [
        tenantId,
        employeeId || null,
        status || null,
        ...approvalScope.params,
        ...progress.params,
      ],
    );
    return {
      data: await attachProcedureLinkInfo(
        pool,
        tenantId,
        'profile_correction',
        result.rows.map((r) => ({
          ...r,
          employeeId: r.employee_id,
          createdAt: r.created_at,
          procedureInstanceId: r.procedure_instance_id ?? null,
          currentStepName: r.current_step_name ?? null,
          currentAssigneeName: r.current_assignee_name ?? null,
          workflowStatus: r.workflow_status ?? null,
        })),
      ),
    };
  }
  @Post()
  async create(
    @Req() req: Request,
    @Body()
    body: DraftSubmission & {
      changes?: Record<string, string | null>;
      documentChanges?: unknown;
      reason: string;
      attributes?: Record<string, unknown>;
    },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.self.request',
    );
    const { employeeId } = await this.ctx.resolveEmployee(
      pool,
      tenantId,
      principal.userId,
    );
    const submission = await resolveDraftSubmission(
      pool,
      tenantId,
      employeeId,
      'profile_correction',
      body,
    );
    body = submission.body;
    requireText(body.reason, 'reason', 3000);
    const documentChanges = parseDocumentChanges(body.documentChanges);
    const changes = body.changes ?? {};
    if (
      typeof changes !== 'object' ||
      Array.isArray(changes) ||
      (!Object.keys(changes).length && !documentChanges.length)
    )
      throw new BadRequestException('Cần dữ liệu thay đổi');
    for (const [key, v] of Object.entries(changes)) {
      if (!Object.hasOwn(fields, key) || (v !== null && typeof v !== 'string'))
        throw new BadRequestException('Trường thay đổi không được hỗ trợ');
      if (v !== null && v.length > 255)
        throw new BadRequestException('Giá trị quá dài');
      if (
        (key === 'dateOfBirth' ||
          key === 'identityCardIssuedDate' ||
          key === 'identityCardExpiryDate') &&
        v
      )
        requireDate(v, key);
      if (key === 'fullName') requireText(v, key, 180);
      if (key === 'gender' && v && !['MALE', 'FEMALE', 'OTHER'].includes(v))
        throw new BadRequestException('Giới tính không hợp lệ');
    }
    const { row, link } = await submitHrmRequest(
      pool,
      this.bridge,
      {
        tenantId,
        kind: 'profile_correction',
        draft: submission.draft,
        employeeId,
        initiatedBy: principal.userId,
        title: 'Đơn điều chỉnh hồ sơ',
        attributes: body.attributes,
      },
      async (db) => {
        await lockEmployee(db, tenantId, employeeId);
        const profile = await db.query(
          `SELECT * FROM hrm_schema.employee_directory WHERE tenant_id=$1 AND employee_id=$2`,
          [tenantId, employeeId],
        );
        await validateDocumentChanges(db, tenantId, employeeId, documentChanges);
        const previous = Object.fromEntries(
          Object.keys(changes).map((key) => [
            key,
            value(profile.rows[0][fields[key]]),
          ]),
        );
        const result = await db.query(
          `INSERT INTO hrm_schema.profile_corrections (tenant_id,employee_id,changes,previous_values,reason,submitted_by,document_changes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            tenantId,
            employeeId,
            JSON.stringify(changes),
            JSON.stringify(previous),
            body.reason,
            principal.userId,
            JSON.stringify(documentChanges),
          ],
        );
        return result.rows[0];
      },
    );
    return {
      data: {
        ...row,
        employeeId: row.employee_id,
        procedureInstanceId: link?.instanceId ?? null,
        procedureSyncStatus: link?.syncStatus ?? null,

        currentStepName: link?.currentStepName ?? null,

        currentAssigneeName: link?.currentAssigneeName ?? null,

        procedureWarnings: link?.warnings ?? [],

        procedureError: link?.lastError ?? null,
        procedureLinkId: link?.id ?? null,
      },
    };
  }
  @Post(':id/approve')
  async approve(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.profile.approve',
    );
    await this.approvals.assertCanDecide(
      { pool, tenantId, principal },
      id,
      'profile_correction',
      'approve',
    );
    return hrmTransaction(pool, (db) =>
      approveProfileCorrection(db, tenantId, principal.userId, id),
    );
  }
  @Post(':id/reject')
  async reject(
    @Req() req: Request,
    @Param('id') id: string,
    @Body('reason') reason: string,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.profile.approve',
    );
    await this.approvals.assertCanDecide(
      { pool, tenantId, principal },
      id,
      'profile_correction',
      'reject',
    );
    requireText(reason, 'reason', 2000);
    const result = await pool.query(
      `UPDATE hrm_schema.profile_corrections SET status='REJECTED',approved_by=$3,rejection_reason=$4,approved_at=now() WHERE tenant_id=$1 AND id=$2 AND status='PENDING' RETURNING *`,
      [tenantId, id, principal.userId, reason],
    );
    if (!result.rowCount)
      throw new ConflictException('Đơn không còn chờ duyệt');
    return { data: result.rows[0] };
  }
}
