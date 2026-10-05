import { attachProcedureLinkInfo } from '../infrastructure/hrm-procedure-link-info.js';
import { HrmApprovalPolicyService } from '../infrastructure/hrm-approval-policy.js';
import { workflowProgressFilter } from '../infrastructure/hrm-workflow-filter.js';
import {
  resolveDraftSubmission,
  type DraftSubmission,
} from '../infrastructure/hrm-request-drafts.js';
import { approveBusinessTrip } from '../infrastructure/hrm-request-transition.js';
import {
  normalizeHrmRequestKind,
  prepareHrmProcedureLink,
} from '../infrastructure/hrm-procedure-links.js';
import type { ApplyHrmWorkflowActionPayload } from '@enterprise-platform/contracts-hrm';
import {
  submitHrmRequest,
} from '../infrastructure/hrm-submission.js';
import type {
  CreateBusinessTripRequestPayload,
  CreateOtRequestPayload,
  CreateShiftChangeRequestPayload,
  HrmBusinessTripRequest,
  HrmOtRequest,
  HrmShiftChangeRequest,
} from '@enterprise-platform/contracts-hrm';
import {
  BadRequestException,
  ConflictException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { workReferences } from '../infrastructure/hrm-work-references.js';
import {
  createOvertime,
  approveOvertime,
} from '../infrastructure/hrm-overtime.js';
import { approveShiftChange } from '../infrastructure/hrm-shift-change.js';
import {
  assertOpenDate,
  assertOpenRange,
  lockEmployee,
  isoDate,
} from '../infrastructure/hrm-time.js';
import {
  requireDate,
  requireText,
  requireUuid,
} from '../infrastructure/hrm-validation.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { HrmProcedureBridgeService } from '../infrastructure/hrm-procedure-bridge.service.js';

@Controller('v1')
export class HrmRequestController {
  constructor(
    private readonly ctx: HrmContextService,
    private readonly bridge: HrmProcedureBridgeService,
    private readonly approvals: HrmApprovalPolicyService = new HrmApprovalPolicyService(),
  ) {}

  // --------------------------------------------------------------------------
  // Overtime (OT) Requests (P2_S3_HRM_API.md § 16)
  // --------------------------------------------------------------------------

  @Get('procedure-definitions/binding')
  async getBindingDefinition(
    @Req() req: Request,
    @Query('kind') kind: string,
    @Query('subTypeCode') subTypeCode?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    if (!kind) {
      throw new BadRequestException('Query parameter "kind" is required');
    }
    const def = await this.bridge.getBindingDefinitionWithAttributes(
      pool,
      tenantId,
      kind as any,
      subTypeCode?.trim() || undefined,
    );
    return { data: def };
  }

  @Post('ot-requests')
  async createOtRequest(
    @Req() req: Request,
    @Body()
    body: CreateOtRequestPayload &
      DraftSubmission & { attributes?: Record<string, unknown> },
  ) {
    const { pool, tenantId, employeeId, principal } =
      await this.ctx.getRequestContext(req, body.employeeId);
    const submission = await resolveDraftSubmission(
      pool,
      tenantId,
      employeeId,
      'ot',
      body,
    );
    body = submission.body;
    const { row, link } = await submitHrmRequest(
      pool,
      this.bridge,
      {
        tenantId,
        kind: 'ot',
        draft: submission.draft,
        employeeId,
        initiatedBy: principal.userId,
        title: 'Đơn làm thêm giờ',
        attributes: body.attributes,
      },
      (db) => createOvertime(db, tenantId, { ...body, employeeId }),
    );
    return {
      data: {
        ...this.mapOt(row),
        procedureSyncStatus: link?.syncStatus ?? null,

        currentStepName: link?.currentStepName ?? null,

        currentAssigneeName: link?.currentAssigneeName ?? null,

        procedureWarnings: link?.warnings ?? [],

        procedureError: link?.lastError ?? null,
        procedureLinkId: link?.id ?? null,
      },
    };
  }

  @Get('ot-requests')
  async listOtRequests(
    @Req() req: Request,
    @Query('employee_id') employeeId?: string,
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
    } = await this.ctx.scoped(req, 'hrm.request.read', employeeId);
    employeeId = visibleEmployeeId;
    const approvalScope =
      forApproval === '1'
        ? await this.approvals.listFilter(
            { pool, tenantId, principal },
            'ot',
            'ot_requests',
            5,
          )
        : { sql: 'TRUE', params: [] as unknown[] };
    const progress = workflowProgressFilter(
      'ot_requests',
      5 + approvalScope.params.length,
      { assignee, currentStep },
    );
    const res = await pool.query(
      `SELECT * FROM hrm_schema.ot_requests
       WHERE tenant_id = $1
         AND ($2::uuid IS NULL OR employee_id = $2)
         AND ($3::date IS NULL OR work_date >= $3)
         AND ($4::date IS NULL OR work_date <= $4)
         AND ${approvalScope.sql}
         AND ${progress.sql}
       ORDER BY work_date DESC`,
      [
        tenantId,
        employeeId || null,
        fromDate || null,
        toDate || null,
        ...approvalScope.params,
        ...progress.params,
      ],
    );
    return {
      data: await attachProcedureLinkInfo(
        pool,
        tenantId,
        'ot',
        res.rows.map(this.mapOt),
      ),
      meta: {
        total: res.rows.length,
        requestId: req.headers['x-request-id'] as string,
      },
    };
  }

  @Post('ot-requests/:id/approve')
  async approveOtRequest(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.ot.approve',
    );
    await this.approvals.assertCanDecide(
      { pool, tenantId, principal },
      id,
      'ot',
      'approve',
    );
    const row = await hrmTransaction(pool, (db) =>
      approveOvertime(db, tenantId, principal.userId, id),
    );
    const res = { rows: [row] };
    return {
      data: this.mapOt(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('ot-requests/:id/reject')
  async rejectOtRequest(
    @Req() req: Request,
    @Param('id') id: string,
    @Body('reason') reason: string,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.ot.approve',
    );
    await this.approvals.assertCanDecide(
      { pool, tenantId, principal },
      id,
      'ot',
      'reject',
    );
    requireText(reason, 'Lý do từ chối', 2000);
    const res = await hrmTransaction(pool, async (db) => {
      const result = await db.query(
        `UPDATE hrm_schema.ot_requests SET
        status = 'REJECTED', approved_by = $3, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status IN ('PENDING','PEER_CONFIRMED') RETURNING *`,
        [tenantId, id, principal.userId],
      );
      if (result.rowCount)
        await db.query(
          `INSERT INTO hrm_schema.audit_log(tenant_id,actor_id,action,entity_type,entity_id,detail) VALUES($1,$2,'REQUEST_REJECT','OT',$3,$4)`,
          [tenantId, principal.userId, id, JSON.stringify({ reason })],
        );
      return result;
    });
    if (res.rows.length === 0) {
      throw new NotFoundException({
        code: 'HRM_OT_NOT_FOUND',
        message: 'OT request not found',
      });
    }
    return {
      data: this.mapOt(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  // --------------------------------------------------------------------------
  // Business Trip Requests (P2_S3_HRM_API.md § 17)
  // --------------------------------------------------------------------------

  @Get('work-references')
  async workItems(@Req() req: Request) {
    const { tenantId } = await this.ctx.getContext(req, 'hrm.self.request');
    return { data: await workReferences(req, tenantId) };
  }

  @Post('business-trip-requests')
  async createBusinessTripRequest(
    @Req() req: Request,
    @Body()
    body: CreateBusinessTripRequestPayload &
      DraftSubmission & {
        attributes?: Record<string, unknown>;
      },
  ) {
    const { pool, tenantId, employeeId, principal } =
      await this.ctx.getRequestContext(req, body.employeeId);
    const submission = await resolveDraftSubmission(
      pool,
      tenantId,
      employeeId,
      'business_trip',
      body,
    );
    body = submission.body;
    requireDate(body.fromDate, 'fromDate');
    requireDate(body.toDate, 'toDate');
    requireText(body.reason, 'reason', 2000);
    requireText(body.destination, 'destination', 255);
    const maxDays =
      (Date.parse(body.toDate) - Date.parse(body.fromDate)) / 86400000 + 1;
    if (
      maxDays < 1 ||
      maxDays > 366 ||
      !Number.isFinite(body.daysCount) ||
      body.daysCount <= 0 ||
      body.daysCount > maxDays
    )
      throw new BadRequestException('Thời gian công tác không hợp lệ');
    let reference: Record<string, unknown> = {};
    let projectName: string | null = null;
    if (body.projectId) {
      requireUuid(body.projectId, 'Dự án');
      const available = (
        await pool.query(
          "SELECT to_regclass('workspace_schema.projects') AS relation",
        )
      ).rows[0]?.relation;
      if (!available)
        throw new BadRequestException(
          'Danh mục dự án chưa được cấp cho tenant; có thể liên kết hồ sơ công việc',
        );
      const project = (
        await pool.query(
          'SELECT id,name FROM workspace_schema.projects WHERE id=$1',
          [body.projectId],
        )
      ).rows[0];
      if (!project)
        throw new BadRequestException('Dự án không tồn tại trong tenant');
      projectName = String(project.name);
    }
    if (
      (body.destinationLat != null) !== (body.destinationLng != null) ||
      (body.destinationLat != null &&
        (!Number.isFinite(body.destinationLat) ||
          Math.abs(body.destinationLat) > 90 ||
          !Number.isFinite(body.destinationLng) ||
          Math.abs(body.destinationLng!) > 180))
    )
      throw new BadRequestException('Tọa độ địa điểm công tác không hợp lệ');
    if (body.workItemId) {
      const items = await workReferences(req, tenantId),
        item = items.find((i) => i.id === body.workItemId);
      if (!item || ['cancelled', 'rejected'].includes(item.status))
        throw new BadRequestException('Đầu việc không còn hợp lệ');
      if (
        body.subtaskId &&
        !item.subtasks?.some((s) => s.id === body.subtaskId)
      )
        throw new BadRequestException(
          'Đầu việc con không thuộc hồ sơ liên kết',
        );
      reference = {
        module: 'procedure',
        id: item.id,
        code: item.code,
        title: item.title,
        subtaskId: body.subtaskId || null,
      };
    } else if (body.subtaskId)
      throw new BadRequestException('Cần hồ sơ cha khi chọn đầu việc con');
    const { row, link } = await submitHrmRequest(
      pool,
      this.bridge,
      {
        tenantId,
        kind: 'business_trip',
        draft: submission.draft,
        employeeId,
        initiatedBy: principal.userId,
        title: 'Đơn công tác',
        attributes: body.attributes,
      },
      async (db) => {
        await lockEmployee(db, tenantId, employeeId);
        const dates = await db.query(
          `SELECT to_char(d,'YYYY-MM-DD') AS date FROM generate_series($1::date,$2::date,'1 day') d`,
          [body.fromDate, body.toDate],
        );
        for (const day of dates.rows)
          await assertOpenDate(db, tenantId, day.date);
        const conflict = await db.query(
          `SELECT id FROM hrm_schema.business_trip_requests WHERE tenant_id=$1 AND employee_id=$2 AND status IN ('PENDING','APPROVED') AND daterange(from_date,to_date,'[]') && daterange($3::date,$4::date,'[]') UNION ALL SELECT id FROM hrm_schema.leave_requests WHERE tenant_id=$1 AND employee_id=$2 AND status IN ('PENDING','APPROVED') AND daterange(from_date,to_date,'[]') && daterange($3::date,$4::date,'[]') LIMIT 1`,
          [tenantId, employeeId, body.fromDate, body.toDate],
        );
        if (conflict.rowCount)
          throw new BadRequestException('Trùng lịch công tác hoặc nghỉ phép');
        if (body.perDiemPolicyId) {
          const policy = await db.query(
            `SELECT id FROM hrm_schema.policies WHERE tenant_id=$1 AND id=$2`,
            [tenantId, body.perDiemPolicyId],
          );
          if (!policy.rowCount)
            throw new BadRequestException(
              'Chính sách công tác không thuộc tenant',
            );
        }
        const inserted = await db.query(
          `INSERT INTO hrm_schema.business_trip_requests (
        tenant_id, employee_id, business_trip_type, destination, from_date, to_date,
        days_count, allow_ot, per_diem_policy_id, reason, status, work_item_id, subtask_id, work_reference,project_id,project_name,destination_lat,destination_lng
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING', $11, $12, $13,$14,$15,$16,$17)
      RETURNING *`,
          [
            tenantId,
            employeeId,
            body.businessTripType || 'DOMESTIC',
            body.destination,
            body.fromDate,
            body.toDate,
            body.daysCount,
            body.allowOt ?? false,
            body.perDiemPolicyId || null,
            body.reason,
            body.workItemId || null,
            body.subtaskId || null,
            JSON.stringify(reference),
            body.projectId || null,
            projectName,
            body.destinationLat ?? null,
            body.destinationLng ?? null,
          ],
        );
        return inserted.rows[0];
      },
    );

    return {
      data: {
        ...this.mapTrip(row),
        procedureSyncStatus: link?.syncStatus ?? null,

        currentStepName: link?.currentStepName ?? null,

        currentAssigneeName: link?.currentAssigneeName ?? null,

        procedureWarnings: link?.warnings ?? [],

        procedureError: link?.lastError ?? null,
        procedureLinkId: link?.id ?? null,
      },
    };
  }

  @Get('business-trip-requests')
  async listBusinessTripRequests(
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
            'business_trip',
            'business_trip_requests',
            4,
          )
        : { sql: 'TRUE', params: [] as unknown[] };
    const progress = workflowProgressFilter(
      'business_trip_requests',
      4 + approvalScope.params.length,
      { assignee, currentStep },
    );
    const res = await pool.query(
      `SELECT * FROM hrm_schema.business_trip_requests
       WHERE tenant_id = $1
         AND ($2::uuid IS NULL OR employee_id = $2)
         AND ($3::text IS NULL OR status = $3)
         AND ${approvalScope.sql}
         AND ${progress.sql}
       ORDER BY from_date DESC`,
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
        'business_trip',
        res.rows.map(this.mapTrip),
      ),
      meta: {
        total: res.rows.length,
        requestId: req.headers['x-request-id'] as string,
      },
    };
  }

  @Post('business-trip-requests/:id/approve')
  async approveBusinessTrip(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.trip.approve',
    );
    await this.approvals.assertCanDecide(
      { pool, tenantId, principal },
      id,
      'business_trip',
      'approve',
    );
    const res = await hrmTransaction(pool, (db) =>
      approveBusinessTrip(db, tenantId, principal.userId, id),
    );
    return {
      data: this.mapTrip(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('business-trip-requests/:id/reject')
  async rejectBusinessTrip(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.trip.approve',
    );
    await this.approvals.assertCanDecide(
      { pool, tenantId, principal },
      id,
      'business_trip',
      'reject',
    );
    const res = await hrmTransaction(pool, async (db) => {
      const found = await db.query(
        `SELECT * FROM hrm_schema.business_trip_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId, id],
      );
      const trip = found.rows[0];
      if (!trip) throw new NotFoundException('Không tìm thấy đơn công tác');
      if (trip.status === 'REJECTED') return found;
      if (trip.status !== 'PENDING')
        throw new BadRequestException('Trạng thái đơn không cho phép thao tác');
      await lockEmployee(db, tenantId, trip.employee_id);
      const dates = await db.query(
        `SELECT to_char(d,'YYYY-MM-DD') AS date FROM generate_series($1::date,$2::date,'1 day') d`,
        [trip.from_date, trip.to_date],
      );
      for (const day of dates.rows)
        await assertOpenDate(db, tenantId, day.date);
      return db.query(
        `UPDATE hrm_schema.business_trip_requests SET status='REJECTED',approved_by=$3,approved_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [tenantId, id, principal.userId],
      );
    });
    return {
      data: this.mapTrip(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('business-trip-requests/:id/cancel')
  async cancelBusinessTrip(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.trip.approve',
    );
    await this.approvals.assertCanDecide(
      { pool, tenantId, principal },
      id,
      'business_trip',
      'cancel',
    );
    const res = await hrmTransaction(pool, async (db) => {
      const found = await db.query(
        `SELECT * FROM hrm_schema.business_trip_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId, id],
      );
      const trip = found.rows[0];
      if (!trip) throw new NotFoundException('Không tìm thấy đơn công tác');
      if (trip.status === 'CANCELLED') return found;
      if (trip.status === 'APPROVED')
        throw new ConflictException(
          'Đơn đã duyệt: dùng Hủy hiệu lực tại hộp xử lý đơn để giữ lý do và lịch sử phê duyệt.',
        );
      if (!['PENDING', 'APPROVED'].includes(trip.status))
        throw new BadRequestException('Trạng thái đơn không cho phép thao tác');
      await lockEmployee(db, tenantId, trip.employee_id);
      const dates = await db.query(
        `SELECT to_char(d,'YYYY-MM-DD') AS date FROM generate_series($1::date,$2::date,'1 day') d`,
        [trip.from_date, trip.to_date],
      );
      for (const day of dates.rows)
        await assertOpenDate(db, tenantId, day.date);
      return db.query(
        `UPDATE hrm_schema.business_trip_requests SET status='CANCELLED',approved_by=$3,approved_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [tenantId, id, principal.userId],
      );
    });
    return {
      data: this.mapTrip(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  // --------------------------------------------------------------------------
  // Shift Change Requests (P2_S3_HRM_API.md § 18)
  // --------------------------------------------------------------------------

  @Post('shift-change-requests')
  async createShiftChangeRequest(
    @Req() req: Request,
    @Body()
    body: CreateShiftChangeRequestPayload &
      DraftSubmission & {
        attributes?: Record<string, unknown>;
      },
  ) {
    const { pool, tenantId, employeeId, principal } =
      await this.ctx.getRequestContext(req, body.employeeId);
    const submission = await resolveDraftSubmission(
      pool,
      tenantId,
      employeeId,
      'shift_change',
      body,
    );
    body = submission.body;
    requireDate(body.fromDate, 'fromDate');
    requireDate(body.toDate, 'toDate');
    requireText(body.reason, 'reason', 2000);
    if (
      body.changeType !== undefined &&
      body.changeType !== null &&
      !['SWAP', 'CHANGE_SHIFT'].includes(body.changeType)
    )
      throw new BadRequestException(
        'Loại đổi ca không hợp lệ (SWAP hoặc CHANGE_SHIFT)',
      );
    if (
      body.toDate < body.fromDate ||
      Date.parse(body.toDate) - Date.parse(body.fromDate) > 62 * 86400000
    )
      throw new BadRequestException('Khoảng đổi ca không hợp lệ');
    const { row, link } = await submitHrmRequest(
      pool,
      this.bridge,
      {
        tenantId,
        kind: 'shift_change',
        draft: submission.draft,
        employeeId,
        initiatedBy: principal.userId,
        title: 'Đơn đổi ca',
        attributes: body.attributes,
      },
      async (db) => {
        requireUuid(employeeId, 'employeeId');
        requireUuid(body.currentShiftId, 'currentShiftId');
        requireUuid(body.requestedShiftId, 'requestedShiftId');
        const employees = [
          employeeId,
          ...(body.swapWithEmployeeId
            ? [requireUuid(body.swapWithEmployeeId, 'swapWithEmployeeId')]
            : []),
        ].sort();
        if (
          new Set(employees).size !== employees.length ||
          body.currentShiftId === body.requestedShiftId
        )
          throw new BadRequestException('Nhân viên hoặc ca đổi trùng nhau');
        if ((body.changeType || 'SWAP') === 'SWAP' && !body.swapWithEmployeeId)
          throw new BadRequestException('Cần chọn người đổi cùng');
        for (const employee of employees)
          await lockEmployee(db, tenantId, employee);
        await assertOpenRange(db, tenantId, body.fromDate, body.toDate);
        const shifts = await db.query(
          `SELECT id FROM hrm_schema.shift_definitions WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND status='ACTIVE' FOR SHARE`,
          [tenantId, [body.currentShiftId, body.requestedShiftId]],
        );
        if (shifts.rowCount !== 2)
          throw new BadRequestException('Ca không hoạt động trong tenant');
        const inserted = await db.query(
          `INSERT INTO hrm_schema.shift_change_requests (
        tenant_id, employee_id, change_type, current_shift_id, requested_shift_id,
        from_date, to_date, swap_with_employee_id, reason, status,submitted_by,submitted_attributes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING',$10,$11)
      RETURNING *`,
          [
            tenantId,
            employeeId,
            body.changeType || 'SWAP',
            body.currentShiftId,
            body.requestedShiftId,
            body.fromDate,
            body.toDate,
            body.swapWithEmployeeId || null,
            body.reason,
            principal.userId,
            JSON.stringify(body.attributes ?? {}),
          ],
        );
        return inserted.rows[0];
      },
    );
    return {
      data: {
        ...this.mapShiftChange(row),
        procedureSyncStatus: link?.syncStatus ?? null,

        currentStepName: link?.currentStepName ?? null,

        currentAssigneeName: link?.currentAssigneeName ?? null,

        procedureWarnings: link?.warnings ?? [],

        procedureError: link?.lastError ?? null,
        procedureLinkId: link?.id ?? null,
      },
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('shift-change-requests/:id/peer-confirm')
  async peerConfirmShiftChange(
    @Req() req: Request,
    @Param('id') id: string,
    @Body('confirmed') confirmed: boolean,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.self.request',
    );
    const employee = await this.ctx.resolveEmployee(
      pool,
      tenantId,
      principal.userId,
    );
    if (typeof confirmed !== 'boolean')
      throw new BadRequestException('Cần xác nhận đồng ý hoặc từ chối');
    requireUuid(id, 'Đơn đổi ca');
    const result = await hrmTransaction(pool, async (db) => {
      const prior = (
        await db.query(
          'SELECT * FROM hrm_schema.shift_change_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
          [tenantId, id],
        )
      ).rows[0];
      if (
        !prior ||
        prior.status !== 'PENDING' ||
        prior.swap_with_employee_id !== employee.employeeId
      )
        throw new BadRequestException('Đơn không còn chờ bạn xác nhận');
      const row = (
        await db.query(
          `UPDATE hrm_schema.shift_change_requests SET swap_peer_confirmed=$3,status=CASE WHEN $3 THEN 'PEER_CONFIRMED' ELSE 'REJECTED' END,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
          [tenantId, id, confirmed],
        )
      ).rows[0];
      if (!confirmed) return { row, link: null };
      if (!row.submitted_by)
        throw new BadRequestException(
          'Đơn cũ thiếu thông tin người gửi; cần HR đối soát',
        );
      const link = await prepareHrmProcedureLink(db, {
        tenantId,
        kind: 'shift_change',
        requestId: id,
        revision: Number(row.revision ?? 1),
        employeeId: row.employee_id,
        initiatedBy: row.submitted_by,
        title: 'Đơn đổi ca',
        attributes: row.submitted_attributes ?? {},
        fieldRow: row,
      });
      return { row, link };
    });
    const link = result.link
      ? await this.bridge.startOrResume(pool, result.link.id, tenantId)
      : null;
    return {
      data: {
        ...this.mapShiftChange(result.row),
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

  @Get('shift-change-requests')
  async listShiftChanges(
    @Req() req: Request,
    @Query('employee_id') employeeId?: string,
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
            'shift_change',
            'shift_change_requests',
            3,
          )
        : { sql: 'TRUE', params: [] as unknown[] };
    const progress = workflowProgressFilter(
      'shift_change_requests',
      3 + approvalScope.params.length,
      { assignee, currentStep },
    );
    const res = await pool.query(
      `SELECT * FROM hrm_schema.shift_change_requests
       WHERE tenant_id = $1 AND ($2::uuid IS NULL OR employee_id = $2 OR swap_with_employee_id = $2)
         AND ${approvalScope.sql}
         AND ${progress.sql}
       ORDER BY from_date DESC`,
      [tenantId, employeeId || null, ...approvalScope.params, ...progress.params],
    );
    return {
      data: await attachProcedureLinkInfo(
        pool,
        tenantId,
        'shift_change',
        res.rows.map(this.mapShiftChange),
      ),
      meta: {
        total: res.rows.length,
        requestId: req.headers['x-request-id'] as string,
      },
    };
  }

  @Post('shift-change-requests/:id/approve')
  async approveShiftChange(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.shift.approve',
    );
    await this.approvals.assertCanDecide(
      { pool, tenantId, principal },
      id,
      'shift_change',
      'approve',
    );
    const row = await hrmTransaction(pool, (db) =>
      approveShiftChange(db, tenantId, principal.userId, id),
    );
    const res = { rows: [row] };
    return {
      data: this.mapShiftChange(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('shift-change-requests/:id/reject')
  async rejectShiftChange(
    @Req() req: Request,
    @Param('id') id: string,
    @Body('reason') reason: string,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.shift.approve',
    );
    await this.approvals.assertCanDecide(
      { pool, tenantId, principal },
      id,
      'shift_change',
      'reject',
    );
    requireText(reason, 'Lý do từ chối', 2000);
    const res = await hrmTransaction(pool, async (db) => {
      const result = await db.query(
        `UPDATE hrm_schema.shift_change_requests SET
        status = 'REJECTED', approved_by = $3, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status IN ('PENDING','PEER_CONFIRMED') RETURNING *`,
        [tenantId, id, principal.userId],
      );
      if (result.rowCount)
        await db.query(
          `INSERT INTO hrm_schema.audit_log(tenant_id,actor_id,action,entity_type,entity_id,detail) VALUES($1,$2,'REQUEST_REJECT','SHIFT_CHANGE',$3,$4)`,
          [tenantId, principal.userId, id, JSON.stringify({ reason })],
        );
      return result;
    });
    if (res.rows.length === 0) {
      throw new NotFoundException({
        code: 'HRM_SHIFT_CHANGE_NOT_FOUND',
        message: 'Shift change request not found',
      });
    }
    return {
      data: this.mapShiftChange(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  // --------------------------------------------------------------------------
  // Dynamic Procedure Progress & Real-time Reverse Sync
  // --------------------------------------------------------------------------

  @Post('requests/:kind/:id/actions')
  async procedureAction(
    @Req() req: Request,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body()
    body: ApplyHrmWorkflowActionPayload & {
      idempotencyKey: string;
      revision?: number;
    },
  ) {
    const { tenantId, pool, principal } = await this.ctx.getContext(
      req,
      'hrm.read',
    );
    await this.approvals.assertNotSelfDecision(
      { pool, tenantId, principal },
      id,
      normalizeHrmRequestKind(kind),
      String(body.action ?? ''),
    );
    return {
      data: await this.bridge.applyAction(
        req,
        {
          tenantId,
          kind: normalizeHrmRequestKind(kind),
          requestId: id,
          revision: body.revision ?? 1,
        },
        body,
      ),
    };
  }

  @Get('procedure-progress/:procedureInstanceId')
  async getProcedureProgress(
    @Req() req: Request,
    @Param('procedureInstanceId') procedureInstanceId: string,
    @Query('kind') kind?: string,
    @Query('request_id') requestId?: string,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.read',
    );
    requireUuid(procedureInstanceId, 'Hồ sơ Procedure');
    const linked = (
      await pool.query(
        `SELECT l.employee_id FROM hrm_schema.procedure_links l JOIN hrm_schema.procedure_correlations c ON c.tenant_id=l.tenant_id AND c.link_id=l.id WHERE l.tenant_id=$1 AND c.instance_id=$2 LIMIT 1`,
        [tenantId, procedureInstanceId],
      )
    ).rows[0];
    if (!linked)
      throw new NotFoundException('Không tìm thấy liên kết quy trình');
    await this.ctx.getRequestContext(
      req,
      linked.employee_id,
      'hrm.request.read',
      'hrm.self.read',
    );
    const result = await this.bridge.getProcedureProgress(
      pool,
      tenantId,
      procedureInstanceId,
      kind as any,
      requestId,
      principal.userId,
    );

    if (!result) {
      throw new NotFoundException({
        code: 'PROCEDURE_INSTANCE_NOT_FOUND',
        message: 'Procedure instance not found',
      });
    }

    return {
      data: result,
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  // --------------------------------------------------------------------------
  // Workspace Projects Integration
  // --------------------------------------------------------------------------

  @Get('workspace-projects')
  async listWorkspaceProjects(@Req() req: Request) {
    const { pool } = await this.ctx.getContext(req, 'hrm.read');
    try {
      const res = await pool.query(
        `SELECT id, code, name, status, start_date, end_date
         FROM workspace_schema.projects
         ORDER BY created_at DESC`,
      );
      return {
        data: res.rows.map((r: any) => ({
          id: r.id as string,
          code: r.code as string,
          name: r.name as string,
          status: r.status as string,
          startDate: r.start_date ? String(r.start_date) : null,
          endDate: r.end_date ? String(r.end_date) : null,
        })),
        meta: {
          total: res.rows.length,
          requestId: req.headers['x-request-id'] as string,
        },
      };
    } catch {
      // Fallback nếu schema workspace_schema chưa khởi tạo trong DB
      return {
        data: [],
        meta: { total: 0, requestId: req.headers['x-request-id'] as string },
      };
    }
  }

  private mapOt(row: Record<string, unknown>): HrmOtRequest {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      employeeId: row.employee_id as string,
      workDate: isoDate(row.work_date),
      startTime: String(row.start_time),
      endTime: String(row.end_time),
      plannedMinutes: Number(row.planned_minutes),
      approvedMinutes: Number(row.approved_minutes || 0),
      actualMinutes: Number(row.actual_minutes || 0),
      billableOtMinutes: Number(row.billable_ot_minutes || 0),
      otType: row.ot_type as any,
      otRateMultiplier: Number(row.ot_rate_multiplier || 1.5),
      isNightOt: Boolean(row.is_night_ot),
      exceedsDailyLimit: Boolean(row.exceeds_daily_limit),
      exceedsMonthlyLimit: Boolean(row.exceeds_monthly_limit),
      policyVersionId: row.policy_version_id as string | null,
      monthlyAccumulatedOtMinutes: Number(
        row.monthly_accumulated_ot_minutes || 0,
      ),
      reason: row.reason as string,
      status: row.status as any,
      workflowInstanceId: row.workflow_instance_id as string | null,
      procedureInstanceId: row.procedure_instance_id as string | null,
      currentStepName: row.current_step_name as string | null,
      currentAssigneeName: (row.current_assignee_name ?? null) as string | null,
      workflowStatus: row.workflow_status as string | null,
      approvedBy: row.approved_by as string | null,
      approvedAt: row.approved_at ? String(row.approved_at) : null,
      createdAt: new Date(row.created_at as string).toISOString(),
      updatedAt: new Date(row.updated_at as string).toISOString(),
    };
  }

  private mapTrip(row: Record<string, unknown>): HrmBusinessTripRequest {
    return {
      id: row.id as string,
      workItemId: row.work_item_id as string | null,
      subtaskId: row.subtask_id as string | null,
      workReference: row.work_reference as Record<string, unknown>,
      tenantId: row.tenant_id as string,
      employeeId: row.employee_id as string,
      businessTripType: row.business_trip_type as any,
      destination: row.destination as string,
      projectId: row.project_id as string | null,
      projectName: row.project_name as string | null,
      destinationLat:
        row.destination_lat != null ? Number(row.destination_lat) : null,
      destinationLng:
        row.destination_lng != null ? Number(row.destination_lng) : null,
      fromDate: isoDate(row.from_date),
      toDate: isoDate(row.to_date),
      daysCount: Number(row.days_count),
      allowOt: Boolean(row.allow_ot),
      perDiemPolicyId: row.per_diem_policy_id as string | null,
      reason: row.reason as string,
      status: row.status as any,
      workflowInstanceId: row.workflow_instance_id as string | null,
      procedureInstanceId: row.procedure_instance_id as string | null,
      currentStepName: row.current_step_name as string | null,
      currentAssigneeName: (row.current_assignee_name ?? null) as string | null,
      workflowStatus: row.workflow_status as string | null,
      approvedBy: row.approved_by as string | null,
      approvedAt: row.approved_at ? String(row.approved_at) : null,
      createdAt: new Date(row.created_at as string).toISOString(),
      updatedAt: new Date(row.updated_at as string).toISOString(),
    };
  }

  private mapShiftChange(row: Record<string, unknown>): HrmShiftChangeRequest {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      employeeId: row.employee_id as string,
      changeType: row.change_type as any,
      currentShiftId: row.current_shift_id as string,
      requestedShiftId: row.requested_shift_id as string,
      fromDate: isoDate(row.from_date),
      toDate: isoDate(row.to_date),
      swapWithEmployeeId: row.swap_with_employee_id as string | null,
      swapPeerConfirmed: Boolean(row.swap_peer_confirmed),
      reason: row.reason as string,
      status: row.status as any,
      workflowInstanceId: row.workflow_instance_id as string | null,
      procedureInstanceId: row.procedure_instance_id as string | null,
      currentStepName: row.current_step_name as string | null,
      currentAssigneeName: (row.current_assignee_name ?? null) as string | null,
      workflowStatus: row.workflow_status as string | null,
      approvedBy: row.approved_by as string | null,
      approvedAt: row.approved_at ? String(row.approved_at) : null,
      appliedAt: row.applied_at ? String(row.applied_at) : null,
      createdAt: new Date(row.created_at as string).toISOString(),
      updatedAt: new Date(row.updated_at as string).toISOString(),
    };
  }
}
