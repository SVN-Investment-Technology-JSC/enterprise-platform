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
  ) {}

  // --------------------------------------------------------------------------
  // Overtime (OT) Requests (P2_S3_HRM_API.md § 16)
  // --------------------------------------------------------------------------

  @Get('procedure-definitions/binding')
  async getBindingDefinition(
    @Req() req: Request,
    @Query('kind') kind: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    if (!kind) {
      throw new BadRequestException('Query parameter "kind" is required');
    }
    const def = await this.bridge.getBindingDefinitionWithAttributes(pool, tenantId, kind as any);
    return { data: def };
  }

  @Post('ot-requests')
  async createOtRequest(
    @Req() req: Request,
    @Body() body: CreateOtRequestPayload & { attributes?: Record<string, unknown> },
  ) {
    const { pool, tenantId, employeeId } = await this.ctx.getRequestContext(
      req,
      body.employeeId,
    );
    const row = await hrmTransaction(pool, (db) =>
      createOvertime(db, tenantId, { ...body, employeeId }),
    );
    // Payload thuộc tính để PE Node S và Gateway đánh giá rẽ nhánh
    const otHours = Math.round((body.plannedMinutes / 60) * 100) / 100;
    const procAttributes: Record<string, unknown> = {
      so_gio_ot: otHours,
      ot_hours: otHours,
      loai_ot: body.otType || 'WEEKDAY',
      is_night_ot: Boolean(body.isNightOt || body.otType === 'NIGHT'),
      ly_do: body.reason,
      ...(body.attributes || {}),
    };

    // Link with Procedure Engine (B1: Tạo phiếu từ theo id nhân viên)
    const proc = await this.bridge.linkAndStartProcedure(
      pool,
      tenantId,
      'ot',
      row.id,
      employeeId,
      `Đơn làm thêm giờ (${body.plannedMinutes} phút) - Ngày ${body.workDate}`,
      procAttributes,
    );

    if (proc) {
      const updated = await pool.query(
        `UPDATE hrm_schema.ot_requests SET
          procedure_instance_id = $3,
          current_step_name = $4,
          workflow_status = 'IN_PROGRESS',
          updated_at = now()
         WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [tenantId, row.id, proc.procedureInstanceId, proc.stepName],
      );
      return {
        data: this.mapOt(updated.rows[0]),
        meta: { requestId: req.headers['x-request-id'] as string },
      };
    }

    return {
      data: this.mapOt(row),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('ot-requests')
  async listOtRequests(
    @Req() req: Request,
    @Query('employee_id') employeeId?: string,
    @Query('from') fromDate?: string,
    @Query('to') toDate?: string,
  ) {
    const {
      pool,
      tenantId,
      employeeId: visibleEmployeeId,
    } = await this.ctx.scoped(req, 'hrm.request.read', employeeId);
    employeeId = visibleEmployeeId;
    const res = await pool.query(
      `SELECT * FROM hrm_schema.ot_requests
       WHERE tenant_id = $1
         AND ($2::uuid IS NULL OR employee_id = $2)
         AND ($3::date IS NULL OR work_date >= $3)
         AND ($4::date IS NULL OR work_date <= $4)
       ORDER BY work_date DESC`,
      [tenantId, employeeId || null, fromDate || null, toDate || null],
    );
    return {
      data: res.rows.map(this.mapOt),
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
    @Body() body: CreateBusinessTripRequestPayload & { attributes?: Record<string, unknown> },
  ) {
    const { pool, tenantId, employeeId } = await this.ctx.getRequestContext(
      req,
      body.employeeId,
    );
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
    const res = await hrmTransaction(pool, async (db) => {
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
      return db.query(
        `INSERT INTO hrm_schema.business_trip_requests (
        tenant_id, employee_id, business_trip_type, destination, from_date, to_date,
        days_count, allow_ot, per_diem_policy_id, reason, status, work_item_id, subtask_id, work_reference
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING', $11, $12, $13)
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
        ],
      );
    });
    const inserted = res.rows[0];

    // Payload thuộc tính để PE Node S và Gateway đánh giá rẽ nhánh
    const procAttributes: Record<string, unknown> = {
      so_ngay_cong_tac: Number(body.daysCount),
      days_count: Number(body.daysCount),
      loai_cong_tac: body.businessTripType || 'DOMESTIC',
      dia_diem: body.destination,
      allow_ot: Boolean(body.allowOt),
      ly_do: body.reason,
      ...(body.attributes || {}),
    };

    // Link with Procedure Engine (B1: Tạo phiếu từ theo id nhân viên)
    const proc = await this.bridge.linkAndStartProcedure(
      pool,
      tenantId,
      'business_trip',
      inserted.id,
      employeeId,
      `Đơn công tác (${body.destination}) - Từ ${body.fromDate} đến ${body.toDate}`,
      procAttributes,
    );

    if (proc) {
      const updated = await pool.query(
        `UPDATE hrm_schema.business_trip_requests SET
          procedure_instance_id = $3,
          current_step_name = $4,
          workflow_status = 'IN_PROGRESS',
          updated_at = now()
         WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [tenantId, inserted.id, proc.procedureInstanceId, proc.stepName],
      );
      return {
        data: this.mapTrip(updated.rows[0]),
        meta: { requestId: req.headers['x-request-id'] as string },
      };
    }

    return {
      data: this.mapTrip(inserted),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('business-trip-requests')
  async listBusinessTripRequests(
    @Req() req: Request,
    @Query('employee_id') employeeId?: string,
    @Query('status') status?: string,
  ) {
    const {
      pool,
      tenantId,
      employeeId: visibleEmployeeId,
    } = await this.ctx.scoped(req, 'hrm.request.read', employeeId);
    employeeId = visibleEmployeeId;
    const res = await pool.query(
      `SELECT * FROM hrm_schema.business_trip_requests
       WHERE tenant_id = $1
         AND ($2::uuid IS NULL OR employee_id = $2)
         AND ($3::text IS NULL OR status = $3)
       ORDER BY from_date DESC`,
      [tenantId, employeeId || null, status || null],
    );
    return {
      data: res.rows.map(this.mapTrip),
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
    const res = await hrmTransaction(pool, async (db) => {
      const found = await db.query(
        `SELECT * FROM hrm_schema.business_trip_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId, id],
      );
      const trip = found.rows[0];
      if (!trip) throw new NotFoundException('Không tìm thấy đơn công tác');
      if (trip.status === 'APPROVED') return found;
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
        `UPDATE hrm_schema.business_trip_requests SET status='APPROVED',approved_by=$3,approved_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [tenantId, id, principal.userId],
      );
    });
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
    const res = await hrmTransaction(pool, async (db) => {
      const found = await db.query(
        `SELECT * FROM hrm_schema.business_trip_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId, id],
      );
      const trip = found.rows[0];
      if (!trip) throw new NotFoundException('Không tìm thấy đơn công tác');
      if (trip.status === 'CANCELLED') return found;
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
    @Body() body: CreateShiftChangeRequestPayload,
  ) {
    const { pool, tenantId } = await this.ctx.getRequestContext(
      req,
      body.employeeId,
    );
    requireDate(body.fromDate, 'fromDate');
    requireDate(body.toDate, 'toDate');
    requireText(body.reason, 'reason', 2000);
    if (
      body.toDate < body.fromDate ||
      Date.parse(body.toDate) - Date.parse(body.fromDate) > 62 * 86400000
    )
      throw new BadRequestException('Khoảng đổi ca không hợp lệ');
    const res = await hrmTransaction(pool, async (db) => {
      requireUuid(body.employeeId, 'employeeId');
      requireUuid(body.currentShiftId, 'currentShiftId');
      requireUuid(body.requestedShiftId, 'requestedShiftId');
      const employees = [
        body.employeeId,
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
      return db.query(
        `INSERT INTO hrm_schema.shift_change_requests (
        tenant_id, employee_id, change_type, current_shift_id, requested_shift_id,
        from_date, to_date, swap_with_employee_id, reason, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING')
      RETURNING *`,
        [
          tenantId,
          body.employeeId,
          body.changeType || 'SWAP',
          body.currentShiftId,
          body.requestedShiftId,
          body.fromDate,
          body.toDate,
          body.swapWithEmployeeId || null,
          body.reason,
        ],
      );
    });
    return {
      data: this.mapShiftChange(res.rows[0]),
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
    const res = await pool.query(
      `UPDATE hrm_schema.shift_change_requests SET
        swap_peer_confirmed = $3,
        status = CASE WHEN $3 = true THEN 'PEER_CONFIRMED' ELSE 'REJECTED' END,
        updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING' AND swap_with_employee_id=$4
      RETURNING *`,
      [tenantId, id, confirmed, employee.employeeId],
    );
    if (res.rows.length === 0) {
      throw new BadRequestException({
        code: 'HRM_SHIFT_CHANGE_CANNOT_CONFIRM',
        message: 'Shift change request not found or not in PENDING state',
      });
    }
    return {
      data: this.mapShiftChange(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('shift-change-requests')
  async listShiftChanges(
    @Req() req: Request,
    @Query('employee_id') employeeId?: string,
  ) {
    const {
      pool,
      tenantId,
      employeeId: visibleEmployeeId,
    } = await this.ctx.scoped(req, 'hrm.request.read', employeeId);
    employeeId = visibleEmployeeId;
    const res = await pool.query(
      `SELECT * FROM hrm_schema.shift_change_requests
       WHERE tenant_id = $1 AND ($2::uuid IS NULL OR employee_id = $2 OR swap_with_employee_id = $2)
       ORDER BY from_date DESC`,
      [tenantId, employeeId || null],
    );
    return {
      data: res.rows.map(this.mapShiftChange),
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

  @Get('procedure-progress/:procedureInstanceId')
  async getProcedureProgress(
    @Req() req: Request,
    @Param('procedureInstanceId') procedureInstanceId: string,
    @Query('kind') kind?: string,
    @Query('request_id') requestId?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const result = await this.bridge.getProcedureProgress(
      pool,
      tenantId,
      procedureInstanceId,
      kind as any,
      requestId,
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
        meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
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
      workflowStatus: row.workflow_status as string | null,
      approvedBy: row.approved_by as string | null,
      approvedAt: row.approved_at ? String(row.approved_at) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
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
      destinationLat: row.destination_lat ? Number(row.destination_lat) : null,
      destinationLng: row.destination_lng ? Number(row.destination_lng) : null,
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
      workflowStatus: row.workflow_status as string | null,
      approvedBy: row.approved_by as string | null,
      approvedAt: row.approved_at ? String(row.approved_at) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
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
      workflowStatus: row.workflow_status as string | null,
      approvedBy: row.approved_by as string | null,
      approvedAt: row.approved_at ? String(row.approved_at) : null,
      appliedAt: row.applied_at ? String(row.applied_at) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
