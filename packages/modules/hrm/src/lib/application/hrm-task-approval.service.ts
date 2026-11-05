import type {
  ExecuteTaskActionDto,
  TaskActionResultDto,
  TaskActionType,
  TaskPageResult,
  TaskQueryOptions,
  UniversalApprovalProvider,
  UniversalTaskDto,
} from '@enterprise-platform/contracts-task-approval';
import { validateTaskActionInput } from '@enterprise-platform/contracts-task-approval';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { HrmApprovalPolicyService, type HrmApprovalActor } from '../infrastructure/hrm-approval-policy.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { applyHrmRequestResult } from '../infrastructure/hrm-request-transition.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { HRM_REQUEST_TABLES, normalizeHrmRequestKind } from '../infrastructure/hrm-procedure-links.js';

const VN_DATE = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Ho_Chi_Minh',
});

const VN_TIME = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Ho_Chi_Minh',
});

function formatIsoDate(val: string | Date | null | undefined): string {
  if (!val) return '—';
  const d = typeof val === 'string' ? new Date(val) : val;
  return Number.isNaN(d.getTime()) ? '—' : VN_DATE.format(d);
}

function formatIsoTime(val: string | Date | null | undefined): string {
  if (!val) return '—';
  if (typeof val === 'string') {
    const timeMatch = /^(\d{1,2}:\d{2})(?::\d{2})?$/.exec(val.trim());
    if (timeMatch) return timeMatch[1].padStart(5, '0');
  }
  const d = typeof val === 'string' ? new Date(val) : val;
  return Number.isNaN(d.getTime()) ? String(val) : VN_TIME.format(d);
}

function formatVnd(amount: number | string | null | undefined): string {
  if (amount == null) return '0 ₫';
  const n = typeof amount === 'number' ? amount : Number(amount);
  return Number.isNaN(n)
    ? '0 ₫'
    : new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n);
}

function resolveStatusAndActions(statusRaw?: string): {
  status: UniversalTaskDto['status'];
  availableActions: TaskActionType[];
  step2Status: 'CURRENT' | 'COMPLETED' | 'REJECTED' | 'WAITING';
} {
  const status = (statusRaw || 'PENDING') as UniversalTaskDto['status'];
  if (status === 'APPROVED') {
    return { status: 'APPROVED', availableActions: [], step2Status: 'COMPLETED' };
  }
  if (status === 'REJECTED') {
    return { status: 'REJECTED', availableActions: [], step2Status: 'REJECTED' };
  }
  if (status === 'CANCELLED') {
    return { status: 'CANCELLED', availableActions: [], step2Status: 'WAITING' };
  }
  return { status: 'PENDING', availableActions: ['APPROVE', 'REJECT'], step2Status: 'CURRENT' };
}

export interface HrmTaskActorPrincipal extends HrmApprovalActor {
  tenantId: string;
  userId: string;
  displayName?: string;
  email?: string;
}

@Injectable()
export class HrmTaskApprovalService implements UniversalApprovalProvider {
  constructor(
    private readonly ctx: HrmContextService,
    private readonly approvals: HrmApprovalPolicyService = new HrmApprovalPolicyService(),
  ) {}

  /**
   * Lấy danh sách các đơn đang chờ người dùng hiện tại phê duyệt
   */
  async getPendingTasks(
    tenantId: string,
    actorId: string,
    options?: TaskQueryOptions,
    principal?: HrmApprovalActor,
  ): Promise<TaskPageResult> {
    const pool = await this.ctx.getPoolForTenant(tenantId);
    const actorPrincipal = principal ?? (await this.ctx.loadActorPrincipal(tenantId, actorId));
    const limit = options?.limit ?? 20;
    const offset = options?.offset ?? 0;

    const tasks: UniversalTaskDto[] = [];

    // 1. Leave Requests
    try {
      const scope = await this.approvals.listFilter(
        { pool, tenantId, principal: actorPrincipal },
        'leave',
        'lr',
        2,
      );
      const res = await pool.query(
        `SELECT lr.id, lr.employee_id, lr.from_date, lr.to_date, lr.duration, lr.reason,
                lr.status, lr.created_at, lr.created_on_behalf, lr.on_behalf_by_name, lr.on_behalf_reason, lr.submitted_by,
                lt.name as leave_type_name, ed.full_name, ed.employee_code, ed.department_name,
                ed.position_name, ed.user_id, ed.work_email,
                COALESCE(lr.procedure_instance_id, pl.instance_id) as link_instance_id
           FROM hrm_schema.leave_requests lr
           LEFT JOIN hrm_schema.leave_types lt ON lt.id = lr.leave_type_id
           LEFT JOIN hrm_schema.employee_directory ed ON ed.employee_id = lr.employee_id
           LEFT JOIN hrm_schema.procedure_links pl ON pl.tenant_id = lr.tenant_id AND pl.request_kind = 'leave' AND pl.request_id = lr.id
          WHERE lr.tenant_id = $1 AND lr.status = 'PENDING' AND ${scope.sql}
          ORDER BY lr.created_at DESC LIMIT $${scope.params.length + 2}`,
        [tenantId, ...scope.params, limit],
      );

      for (const row of res.rows) {
        tasks.push(this.mapLeaveToTask(row, tenantId));
      }
    } catch (err: any) {
      console.warn('[HrmTaskApproval] Error fetching leave tasks:', err?.message || err);
    }

    // 2. Overtime Requests
    try {
      const scope = await this.approvals.listFilter(
        { pool, tenantId, principal: actorPrincipal },
        'ot',
        'ot',
        2,
      );
      const res = await pool.query(
        `SELECT ot.id, ot.employee_id, ot.work_date, ot.start_time, ot.end_time,
                ot.planned_minutes, ot.reason, ot.status, ot.created_at,
                ot.created_on_behalf, ot.on_behalf_by_name, ot.on_behalf_reason, ot.submitted_by,
                ot.paid, ed.full_name, ed.employee_code, ed.department_name,
                ed.position_name, ed.user_id, ed.work_email,
                COALESCE(ot.procedure_instance_id, pl.instance_id) as link_instance_id
           FROM hrm_schema.ot_requests ot
           LEFT JOIN hrm_schema.employee_directory ed ON ed.employee_id = ot.employee_id
           LEFT JOIN hrm_schema.procedure_links pl ON pl.tenant_id = ot.tenant_id AND pl.request_kind = 'ot' AND pl.request_id = ot.id
          WHERE ot.tenant_id = $1 AND ot.status = 'PENDING' AND ${scope.sql}
          ORDER BY ot.created_at DESC LIMIT $${scope.params.length + 2}`,
        [tenantId, ...scope.params, limit],
      );

      for (const row of res.rows) {
        tasks.push(this.mapOtToTask(row, tenantId));
      }
    } catch (err: any) {
      console.warn('[HrmTaskApproval] Error fetching ot tasks:', err?.message || err);
    }

    // 3. Business Trip Requests
    try {
      const scope = await this.approvals.listFilter(
        { pool, tenantId, principal: actorPrincipal },
        'business_trip',
        'bt',
        2,
      );
      const res = await pool.query(
        `SELECT bt.id, bt.employee_id, bt.from_date, bt.to_date, bt.destination,
                bt.days_count, bt.reason, bt.status, bt.created_at,
                bt.created_on_behalf, bt.on_behalf_by_name, bt.on_behalf_reason, bt.submitted_by,
                ed.full_name, ed.employee_code, ed.department_name, ed.position_name, ed.user_id, ed.work_email,
                COALESCE(bt.procedure_instance_id, pl.instance_id) as link_instance_id
           FROM hrm_schema.business_trip_requests bt
           LEFT JOIN hrm_schema.employee_directory ed ON ed.employee_id = bt.employee_id
           LEFT JOIN hrm_schema.procedure_links pl ON pl.tenant_id = bt.tenant_id AND pl.request_kind = 'business_trip' AND pl.request_id = bt.id
          WHERE bt.tenant_id = $1 AND bt.status = 'PENDING' AND ${scope.sql}
          ORDER BY bt.created_at DESC LIMIT $${scope.params.length + 2}`,
        [tenantId, ...scope.params, limit],
      );

      for (const row of res.rows) {
        tasks.push(this.mapBusinessTripToTask(row, tenantId));
      }
    } catch (err: any) {
      console.warn('[HrmTaskApproval] Error fetching business trip tasks:', err?.message || err);
    }

    // 4. Attendance Corrections
    try {
      const scope = await this.approvals.listFilter(
        { pool, tenantId, principal: actorPrincipal },
        'correction',
        'ac',
        2,
      );
      const res = await pool.query(
        `SELECT ac.id, ac.employee_id, ac.request_date, ac.reason,
                ac.status, ac.created_at, ac.new_check_in_at, ac.new_check_out_at,
                ac.old_check_in_at, ac.old_check_out_at,
                ac.created_on_behalf, ac.on_behalf_by_name, ac.on_behalf_reason, ac.submitted_by,
                ed.full_name, ed.employee_code, ed.department_name, ed.position_name, ed.user_id, ed.work_email,
                COALESCE(ac.procedure_instance_id, pl.instance_id) as link_instance_id
           FROM hrm_schema.attendance_corrections ac
           LEFT JOIN hrm_schema.employee_directory ed ON ed.employee_id = ac.employee_id
           LEFT JOIN hrm_schema.procedure_links pl ON pl.tenant_id = ac.tenant_id AND pl.request_kind = 'correction' AND pl.request_id = ac.id
          WHERE ac.tenant_id = $1 AND ac.status = 'PENDING' AND ${scope.sql}
          ORDER BY ac.created_at DESC LIMIT $${scope.params.length + 2}`,
        [tenantId, ...scope.params, limit],
      );

      for (const row of res.rows) {
        tasks.push(this.mapCorrectionToTask(row, tenantId));
      }
    } catch (err: any) {
      console.warn('[HrmTaskApproval] Error fetching correction tasks:', err?.message || err);
    }

    // 5. Shift Change Requests
    try {
      const scope = await this.approvals.listFilter(
        { pool, tenantId, principal: actorPrincipal },
        'shift_change',
        'sc',
        2,
      );
      const res = await pool.query(
        `SELECT sc.id, sc.employee_id, sc.from_date as work_date, sc.reason,
                sc.status, sc.created_at,
                ed.full_name, ed.employee_code, ed.department_name, ed.position_name, ed.user_id, ed.work_email,
                COALESCE(sc.procedure_instance_id, pl.instance_id) as link_instance_id
           FROM hrm_schema.shift_change_requests sc
           LEFT JOIN hrm_schema.employee_directory ed ON ed.employee_id = sc.employee_id
           LEFT JOIN hrm_schema.procedure_links pl ON pl.tenant_id = sc.tenant_id AND pl.request_kind = 'shift_change' AND pl.request_id = sc.id
          WHERE sc.tenant_id = $1 AND sc.status = 'PENDING' AND ${scope.sql}
          ORDER BY sc.created_at DESC LIMIT $${scope.params.length + 2}`,
        [tenantId, ...scope.params, limit],
      );

      for (const row of res.rows) {
        tasks.push(this.mapShiftChangeToTask(row, tenantId));
      }
    } catch (err: any) {
      console.warn('[HrmTaskApproval] Error fetching shift change tasks:', err?.message || err);
    }

    // 6. Salary Advance Requests
    try {
      const scope = await this.approvals.listFilter(
        { pool, tenantId, principal: actorPrincipal },
        'advance',
        'sa',
        2,
      );
      const res = await pool.query(
        `SELECT sa.id, sa.employee_id, sa.requested_amount, sa.reason,
                sa.status, sa.created_at, sa.number_of_installments,
                ed.full_name, ed.employee_code, ed.department_name, ed.position_name, ed.user_id, ed.work_email,
                COALESCE(sa.procedure_instance_id, pl.instance_id) as link_instance_id
           FROM hrm_schema.salary_advance_requests sa
           LEFT JOIN hrm_schema.employee_directory ed ON ed.employee_id = sa.employee_id
           LEFT JOIN hrm_schema.procedure_links pl ON pl.tenant_id = sa.tenant_id AND pl.request_kind = 'advance' AND pl.request_id = sa.id
          WHERE sa.tenant_id = $1 AND sa.status = 'PENDING' AND ${scope.sql}
          ORDER BY sa.created_at DESC LIMIT $${scope.params.length + 2}`,
        [tenantId, ...scope.params, limit],
      );

      for (const row of res.rows) {
        tasks.push(this.mapAdvanceToTask(row, tenantId));
      }
    } catch (err: any) {
      console.warn('[HrmTaskApproval] Error fetching advance tasks:', err?.message || err);
    }

    // 7. Custom Requests
    try {
      const scope = await this.approvals.listFilter(
        { pool, tenantId, principal: actorPrincipal },
        'custom',
        'cr',
        2,
      );
      const res = await pool.query(
        `SELECT cr.id, cr.employee_id, cr.type_name, cr.status, cr.created_at,
                cr.fields as form_data, ed.full_name, ed.employee_code, ed.department_name, ed.position_name,
                ed.user_id, ed.work_email,
                COALESCE(cr.procedure_instance_id, pl.instance_id) as link_instance_id
           FROM hrm_schema.custom_requests cr
           LEFT JOIN hrm_schema.employee_directory ed ON ed.employee_id = cr.employee_id
           LEFT JOIN hrm_schema.procedure_links pl ON pl.tenant_id = cr.tenant_id AND pl.request_kind = 'custom' AND pl.request_id = cr.id
          WHERE cr.tenant_id = $1 AND cr.status = 'PENDING' AND ${scope.sql}
          ORDER BY cr.created_at DESC LIMIT $${scope.params.length + 2}`,
        [tenantId, ...scope.params, limit],
      );

      for (const row of res.rows) {
        tasks.push(this.mapCustomToTask(row, tenantId));
      }
    } catch (err: any) {
      console.warn('[HrmTaskApproval] Error fetching custom tasks:', err?.message || err);
    }

    // Sắp xếp đơn mới nhất lên đầu
    tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const pagedItems = tasks.slice(offset, offset + limit);
    return {
      items: pagedItems,
      total: tasks.length,
      limit,
      offset,
    };
  }

  /**
   * Lấy chi tiết tác vụ theo taskId ("hrm:kind:id" hoặc "kind:id")
   */
  async getTaskDetail(
    tenantId: string,
    actorId: string,
    taskId: string,
    principal?: HrmApprovalActor,
  ): Promise<UniversalTaskDto> {
    const parts = taskId.split(':');
    const kind = parts.length === 3 ? parts[1] : parts.length === 2 ? parts[0] : 'leave';
    const id = parts.length === 3 ? parts[2] : parts.length === 2 ? parts[1] : parts[0];

    const normalizedKind = normalizeHrmRequestKind(kind);
    const table = HRM_REQUEST_TABLES[normalizedKind];
    if (!table) throw new NotFoundException(`Không tìm thấy loại đơn: ${kind}`);

    const pool = await this.ctx.getPoolForTenant(tenantId);
    const actorPrincipal = principal ?? (await this.ctx.loadActorPrincipal(tenantId, actorId));

    // Kiểm tra phạm vi
    await this.approvals.assertCanDecide(
      { pool, tenantId, principal: actorPrincipal },
      id,
      normalizedKind as any,
      'approve',
    );

    const query = `
      SELECT r.*, ed.full_name, ed.employee_code, ed.department_name, ed.position_name, ed.user_id, ed.work_email,
             COALESCE(r.procedure_instance_id, link.instance_id) as link_instance_id
        FROM hrm_schema.${table} r
        LEFT JOIN hrm_schema.employee_directory ed ON ed.employee_id = r.employee_id
        LEFT JOIN hrm_schema.procedure_links link ON link.tenant_id = r.tenant_id AND link.request_kind = $2 AND link.request_id = r.id
       WHERE r.tenant_id = $1 AND r.id = $3
    `;

    const res = await pool.query(query, [tenantId, normalizedKind, id]);
    const row = res.rows[0];
    if (!row) throw new NotFoundException('Không tìm thấy đơn yêu cầu này.');

    switch (normalizedKind) {
      case 'leave':
        return this.mapLeaveToTask(row, tenantId);
      case 'ot':
        return this.mapOtToTask(row, tenantId);
      case 'business_trip':
        return this.mapBusinessTripToTask(row, tenantId);
      case 'correction':
        return this.mapCorrectionToTask(row, tenantId);
      case 'shift_change':
        return this.mapShiftChangeToTask(row, tenantId);
      case 'advance':
        return this.mapAdvanceToTask(row, tenantId);
      case 'custom':
        return this.mapCustomToTask(row, tenantId);
      default:
        return this.mapLeaveToTask(row, tenantId);
    }
  }

  /**
   * Thực thi hành động duyệt / từ chối
   */
  async executeAction(
    tenantId: string,
    actorId: string,
    taskId: string,
    dto: ExecuteTaskActionDto,
    principal?: HrmApprovalActor,
  ): Promise<TaskActionResultDto> {
    // 1. Kiểm tra validation cơ sở
    try {
      validateTaskActionInput(dto);
    } catch (err: any) {
      throw new BadRequestException({
        code: err.code || 'TASK_VALIDATION_ERROR',
        message: err.message,
      });
    }

    const parts = taskId.split(':');
    const kind = parts.length === 3 ? parts[1] : parts.length === 2 ? parts[0] : 'leave';
    const id = parts.length === 3 ? parts[2] : parts.length === 2 ? parts[1] : parts[0];

    const normalizedKind = normalizeHrmRequestKind(kind);
    const table = HRM_REQUEST_TABLES[normalizedKind];
    if (!table) throw new BadRequestException(`Loại đơn không hợp lệ: ${kind}`);

    const pool = await this.ctx.getPoolForTenant(tenantId);
    const actorPrincipal = principal ?? (await this.ctx.loadActorPrincipal(tenantId, actorId));

    const decision = dto.action === 'APPROVE' ? 'approve' : 'reject';

    // 2. Kiểm tra thẩm quyền duyệt (chống tự duyệt, phạm vi cấp dưới)
    await this.approvals.assertCanDecide(
      { pool, tenantId, principal: actorPrincipal },
      id,
      normalizedKind as any,
      decision,
    );

    const targetStatus = dto.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

    // 3. Thực thi cập nhật trạng thái trong Transaction
    await hrmTransaction(pool, async (db) => {
      // Đọc trạng thái hiện tại để tránh xung đột
      const cur = await db.query(
        `SELECT * FROM hrm_schema.${table} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId, id],
      );
      if (cur.rows.length === 0) throw new NotFoundException('Không tìm thấy đơn.');
      const row = cur.rows[0];

      const currentRevision = Number(row.revision ?? 1);

      await applyHrmRequestResult(
        db,
        {
          tenantId,
          kind: normalizedKind,
          requestId: id,
          revision: currentRevision,
        },
        targetStatus,
        actorId,
        dto.reason?.trim() || undefined,
      );

      // 4. Ghi nhận ý kiến vào luồng trao đổi request_comments nếu có lý do
      if (dto.reason?.trim()) {
        await db.query(
          `INSERT INTO hrm_schema.request_comments
             (tenant_id, request_kind, request_id, author_user_id, author_name, kind, decision, body)
           VALUES ($1, $2, $3, $4, $5, 'DECISION', $6, $7)`,
          [
            tenantId,
            normalizedKind,
            id,
            actorId,
            (actorPrincipal as { displayName?: string }).displayName || 'Người phê duyệt',
            dto.action,
            dto.reason.trim(),
          ],
        );
      }
    });

    return {
      success: true,
      taskId,
      action: dto.action,
      newStatus: targetStatus,
      completedAt: new Date().toISOString(),
      message: dto.action === 'APPROVE' ? 'Phê duyệt đơn thành công' : 'Đã từ chối đơn',
    };
  }

  // --------------------------------------------------------------------------
  // Các hàm mapping sang UniversalTaskDto
  // --------------------------------------------------------------------------

  private mapLeaveToTask(row: Record<string, any>, tenantId: string): UniversalTaskDto {
    const isWorkflow = Boolean(row.link_instance_id);
    const durationDays = row.duration != null ? Number(row.duration) : 1;
    const period = `${formatIsoDate(row.from_date)} – ${formatIsoDate(row.to_date)}`;
    const createdOnBehalf = row.created_on_behalf === true;
    const submitter = createdOnBehalf
      ? {
          userId: row.submitted_by || undefined,
          fullName: row.on_behalf_by_name || 'Người tạo hộ',
        }
      : undefined;
    const onBehalfReason = createdOnBehalf ? (row.on_behalf_reason || undefined) : undefined;
    const resolved = resolveStatusAndActions(row.status);

    return {
      taskId: `hrm:leave:${row.id}`,
      tenantId,
      sourceModule: 'hrm',
      entityType: 'LEAVE_REQUEST',
      entityId: row.id,
      title: `Đơn nghỉ phép (${row.leave_type_name || 'Nghỉ phép'}) · ${row.full_name}`,
      code: `NP-${row.id.slice(0, 8).toUpperCase()}`,
      requester: {
        userId: row.user_id || '',
        fullName: row.full_name,
        departmentName: row.department_name,
        positionName: row.position_name,
        email: row.work_email,
      },
      createdOnBehalf,
      submitter,
      onBehalfReason,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      priority: durationDays >= 5 ? 'HIGH' : 'NORMAL',
      approvalMode: isWorkflow ? 'WORKFLOW' : 'LOCAL',
      approvalOwner: isWorkflow ? 'procedure' : 'hrm',
      workflowInstanceId: row.link_instance_id || undefined,
      status: resolved.status,
      availableActions: resolved.availableActions,
      version: row.revision != null ? Number(row.revision) : undefined,
      detailUrl: `/modules/hrm/approvals?type=leave&request=${row.id}`,
      blocks: {
        summary: {
          items: [
            { label: 'Loại nghỉ phép', value: row.leave_type_name || 'Nghỉ phép năm' },
            { label: 'Thời gian', value: period },
            { label: 'Số ngày nghỉ', value: `${durationDays} ngày` },
            ...(createdOnBehalf
              ? [
                  { label: 'Hình thức nộp', value: 'Đơn tạo hộ' },
                  { label: 'Người tạo hộ', value: row.on_behalf_by_name || '—' },
                  ...(row.on_behalf_reason ? [{ label: 'Lý do tạo hộ', value: row.on_behalf_reason }] : []),
                ]
              : []),
          ],
        },
        attributes: {
          title: 'Chi tiết đề nghị',
          items: [
            { key: 'reason', label: 'Lý do nghỉ', value: row.reason || '—' },
            ...(row.description ? [{ key: 'description', label: 'Ghi chú thêm', value: row.description }] : []),
            ...(row.handover_to ? [{ key: 'handoverTo', label: 'Người bàn giao', value: row.handover_to }] : []),
          ],
        },
        timeline: {
          title: 'Tiến trình phê duyệt',
          steps: [
            {
              stepId: 'step-1',
              stepName: createdOnBehalf ? 'Nộp đơn (Tạo hộ)' : 'Nộp đơn',
              status: 'COMPLETED',
              actedAt: formatIsoDate(row.created_at),
              assigneeName: createdOnBehalf && row.on_behalf_by_name
                ? `${row.on_behalf_by_name} (Tạo hộ cho ${row.full_name})`
                : row.full_name,
            },
            {
              stepId: 'step-2',
              stepName: isWorkflow ? 'Quy trình phê duyệt (PE)' : 'Trưởng bộ phận phê duyệt',
              status: resolved.step2Status,
              actedAt: row.approved_at ? formatIsoDate(row.approved_at) : row.rejected_at ? formatIsoDate(row.rejected_at) : undefined,
            },
          ],
        },
      },
    };
  }

  private mapOtToTask(row: Record<string, any>, tenantId: string): UniversalTaskDto {
    const isWorkflow = Boolean(row.link_instance_id);
    const minutes = Number(row.planned_minutes || 0);
    const hours = (minutes / 60).toFixed(1);
    const timeRange = row.start_time && row.end_time
      ? `${formatIsoTime(row.start_time)} – ${formatIsoTime(row.end_time)}`
      : [row.start_time, row.end_time].filter(Boolean).map(formatIsoTime).join(' – ') || '—';
    const createdOnBehalf = row.created_on_behalf === true;
    const submitter = createdOnBehalf
      ? {
          userId: row.submitted_by || undefined,
          fullName: row.on_behalf_by_name || 'Người tạo hộ',
        }
      : undefined;
    const onBehalfReason = createdOnBehalf ? (row.on_behalf_reason || undefined) : undefined;
    const resolved = resolveStatusAndActions(row.status);

    return {
      taskId: `hrm:ot:${row.id}`,
      tenantId,
      sourceModule: 'hrm',
      entityType: 'OT_REQUEST',
      entityId: row.id,
      title: `Đơn làm thêm giờ (OT) · ${row.full_name}`,
      code: `OT-${row.id.slice(0, 8).toUpperCase()}`,
      requester: {
        userId: row.user_id || '',
        fullName: row.full_name,
        departmentName: row.department_name,
        positionName: row.position_name,
      },
      createdOnBehalf,
      submitter,
      onBehalfReason,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      priority: minutes >= 240 ? 'HIGH' : 'NORMAL',
      approvalMode: isWorkflow ? 'WORKFLOW' : 'LOCAL',
      approvalOwner: isWorkflow ? 'procedure' : 'hrm',
      workflowInstanceId: row.link_instance_id || undefined,
      status: resolved.status,
      availableActions: resolved.availableActions,
      version: row.revision != null ? Number(row.revision) : undefined,
      detailUrl: `/modules/hrm/approvals?type=ot&request=${row.id}`,
      blocks: {
        summary: {
          items: [
            { label: 'Ngày làm thêm', value: formatIsoDate(row.work_date) },
            { label: 'Khung giờ', value: timeRange },
            { label: 'Thời lượng OT', value: `${minutes} phút (~${hours} giờ)` },
            { label: 'Chế độ công', value: row.paid === false ? 'Không tính lương' : 'Có tính lương' },
            ...(createdOnBehalf
              ? [
                  { label: 'Hình thức nộp', value: 'Đơn tạo hộ' },
                  { label: 'Người tạo hộ', value: row.on_behalf_by_name || '—' },
                  ...(row.on_behalf_reason ? [{ label: 'Lý do tạo hộ', value: row.on_behalf_reason }] : []),
                ]
              : []),
          ],
        },
        attributes: {
          title: 'Nội dung làm thêm',
          items: [
            { key: 'reason', label: 'Lý do / Công việc', value: row.reason || '—' },
            ...(row.description ? [{ key: 'description', label: 'Chi tiết kế hoạch', value: row.description }] : []),
          ],
        },
        timeline: {
          title: 'Tiến trình phê duyệt',
          steps: [
            {
              stepId: 'step-1',
              stepName: createdOnBehalf ? 'Nộp đơn (Tạo hộ)' : 'Nộp đơn',
              status: 'COMPLETED',
              actedAt: formatIsoDate(row.created_at),
              assigneeName: createdOnBehalf && row.on_behalf_by_name
                ? `${row.on_behalf_by_name} (Tạo hộ cho ${row.full_name})`
                : row.full_name,
            },
            {
              stepId: 'step-2',
              stepName: isWorkflow ? 'Quy trình phê duyệt (PE)' : 'Trưởng bộ phận phê duyệt',
              status: resolved.step2Status,
              actedAt: row.approved_at ? formatIsoDate(row.approved_at) : row.rejected_at ? formatIsoDate(row.rejected_at) : undefined,
            },
          ],
        },
      },
    };
  }

  private mapBusinessTripToTask(row: Record<string, any>, tenantId: string): UniversalTaskDto {
    const isWorkflow = Boolean(row.link_instance_id);
    const period = `${formatIsoDate(row.from_date)} – ${formatIsoDate(row.to_date)}`;
    const createdOnBehalf = row.created_on_behalf === true;
    const submitter = createdOnBehalf
      ? {
          userId: row.submitted_by || undefined,
          fullName: row.on_behalf_by_name || 'Người tạo hộ',
        }
      : undefined;
    const onBehalfReason = createdOnBehalf ? (row.on_behalf_reason || undefined) : undefined;
    const resolved = resolveStatusAndActions(row.status);

    return {
      taskId: `hrm:business_trip:${row.id}`,
      tenantId,
      sourceModule: 'hrm',
      entityType: 'BUSINESS_TRIP_REQUEST',
      entityId: row.id,
      title: `Đơn công tác (${row.destination || 'Công tác'}) · ${row.full_name}`,
      code: `CT-${row.id.slice(0, 8).toUpperCase()}`,
      requester: {
        userId: row.user_id || '',
        fullName: row.full_name,
        departmentName: row.department_name,
        positionName: row.position_name,
      },
      createdOnBehalf,
      submitter,
      onBehalfReason,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      priority: 'NORMAL',
      approvalMode: isWorkflow ? 'WORKFLOW' : 'LOCAL',
      approvalOwner: isWorkflow ? 'procedure' : 'hrm',
      workflowInstanceId: row.link_instance_id || undefined,
      status: resolved.status,
      availableActions: resolved.availableActions,
      version: row.revision != null ? Number(row.revision) : undefined,
      detailUrl: `/modules/hrm/approvals?type=business_trip&request=${row.id}`,
      blocks: {
        summary: {
          items: [
            { label: 'Địa điểm công tác', value: row.destination || '—' },
            { label: 'Thời gian', value: period },
            { label: 'Số ngày công tác', value: `${row.days_count || 1} ngày` },
            ...(createdOnBehalf
              ? [
                  { label: 'Hình thức nộp', value: 'Đơn tạo hộ' },
                  { label: 'Người tạo hộ', value: row.on_behalf_by_name || '—' },
                  ...(row.on_behalf_reason ? [{ label: 'Lý do tạo hộ', value: row.on_behalf_reason }] : []),
                ]
              : []),
          ],
        },
        attributes: {
          title: 'Mục đích & Kế hoạch',
          items: [
            { key: 'reason', label: 'Mục đích công tác', value: row.reason || '—' },
            ...(row.description ? [{ key: 'description', label: 'Kế hoạch công tác', value: row.description }] : []),
          ],
        },
        timeline: {
          title: 'Tiến trình phê duyệt',
          steps: [
            {
              stepId: 'step-1',
              stepName: createdOnBehalf ? 'Nộp đơn (Tạo hộ)' : 'Nộp đơn',
              status: 'COMPLETED',
              actedAt: formatIsoDate(row.created_at),
              assigneeName: createdOnBehalf && row.on_behalf_by_name
                ? `${row.on_behalf_by_name} (Tạo hộ cho ${row.full_name})`
                : row.full_name,
            },
            {
              stepId: 'step-2',
              stepName: isWorkflow ? 'Quy trình phê duyệt (PE)' : 'Trưởng bộ phận phê duyệt',
              status: resolved.step2Status,
              actedAt: row.approved_at ? formatIsoDate(row.approved_at) : row.rejected_at ? formatIsoDate(row.rejected_at) : undefined,
            },
          ],
        },
      },
    };
  }

  private mapCorrectionToTask(row: Record<string, any>, tenantId: string): UniversalTaskDto {
    const isWorkflow = Boolean(row.link_instance_id);
    const createdOnBehalf = row.created_on_behalf === true;
    const submitter = createdOnBehalf
      ? {
          userId: row.submitted_by || undefined,
          fullName: row.on_behalf_by_name || 'Người tạo hộ',
        }
      : undefined;
    const onBehalfReason = createdOnBehalf ? (row.on_behalf_reason || undefined) : undefined;
    const resolved = resolveStatusAndActions(row.status);

    return {
      taskId: `hrm:correction:${row.id}`,
      tenantId,
      sourceModule: 'hrm',
      entityType: 'ATTENDANCE_CORRECTION_REQUEST',
      entityId: row.id,
      title: `Đơn giải trình công · ${row.full_name}`,
      code: `GT-${row.id.slice(0, 8).toUpperCase()}`,
      requester: {
        userId: row.user_id || '',
        fullName: row.full_name,
        departmentName: row.department_name,
        positionName: row.position_name,
      },
      createdOnBehalf,
      submitter,
      onBehalfReason,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      priority: 'NORMAL',
      approvalMode: isWorkflow ? 'WORKFLOW' : 'LOCAL',
      approvalOwner: isWorkflow ? 'procedure' : 'hrm',
      workflowInstanceId: row.link_instance_id || undefined,
      status: resolved.status,
      availableActions: resolved.availableActions,
      version: row.revision != null ? Number(row.revision) : undefined,
      detailUrl: `/modules/hrm/approvals?type=correction&request=${row.id}`,
      blocks: {
        summary: {
          items: [
            { label: 'Ngày cần giải trình', value: formatIsoDate(row.request_date) },
            { label: 'Giờ vào đề nghị', value: formatIsoTime(row.new_check_in_at) },
            { label: 'Giờ ra đề nghị', value: formatIsoTime(row.new_check_out_at) },
            ...(createdOnBehalf
              ? [
                  { label: 'Hình thức nộp', value: 'Đơn tạo hộ' },
                  { label: 'Người tạo hộ', value: row.on_behalf_by_name || '—' },
                  ...(row.on_behalf_reason ? [{ label: 'Lý do tạo hộ', value: row.on_behalf_reason }] : []),
                ]
              : []),
          ],
        },
        attributes: {
          title: 'Chi tiết giải trình',
          items: [
            { key: 'reason', label: 'Căn cứ điều chỉnh', value: row.reason || '—' },
            ...(row.old_check_in_at || row.old_check_out_at
              ? [
                  {
                    key: 'currentPunches',
                    label: 'Giờ đã chấm trong ngày',
                    value: `Vào: ${formatIsoTime(row.old_check_in_at)} · Ra: ${formatIsoTime(row.old_check_out_at)}`,
                  },
                ]
              : []),
            ...(row.description ? [{ key: 'description', label: 'Mô tả chi tiết', value: row.description }] : []),
          ],
        },
        timeline: {
          title: 'Tiến trình phê duyệt',
          steps: [
            {
              stepId: 'step-1',
              stepName: createdOnBehalf ? 'Nộp đơn (Tạo hộ)' : 'Nộp đơn',
              status: 'COMPLETED',
              actedAt: formatIsoDate(row.created_at),
              assigneeName: createdOnBehalf && row.on_behalf_by_name
                ? `${row.on_behalf_by_name} (Tạo hộ cho ${row.full_name})`
                : row.full_name,
            },
            {
              stepId: 'step-2',
              stepName: isWorkflow ? 'Quy trình phê duyệt (PE)' : 'Trưởng bộ phận phê duyệt',
              status: resolved.step2Status,
              actedAt: row.approved_at ? formatIsoDate(row.approved_at) : row.rejected_at ? formatIsoDate(row.rejected_at) : undefined,
            },
          ],
        },
      },
    };
  }

  private mapShiftChangeToTask(row: Record<string, any>, tenantId: string): UniversalTaskDto {
    const isWorkflow = Boolean(row.link_instance_id);
    const resolved = resolveStatusAndActions(row.status);

    return {
      taskId: `hrm:shift_change:${row.id}`,
      tenantId,
      sourceModule: 'hrm',
      entityType: 'SHIFT_CHANGE_REQUEST',
      entityId: row.id,
      title: `Đơn xin đổi ca · ${row.full_name}`,
      code: `DC-${row.id.slice(0, 8).toUpperCase()}`,
      requester: {
        userId: row.user_id || '',
        fullName: row.full_name,
        departmentName: row.department_name,
        positionName: row.position_name,
      },
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      priority: 'NORMAL',
      approvalMode: isWorkflow ? 'WORKFLOW' : 'LOCAL',
      approvalOwner: isWorkflow ? 'procedure' : 'hrm',
      workflowInstanceId: row.link_instance_id || undefined,
      status: resolved.status,
      availableActions: resolved.availableActions,
      version: row.revision != null ? Number(row.revision) : undefined,
      detailUrl: `/modules/hrm/approvals?type=shift_change&request=${row.id}`,
      blocks: {
        summary: {
          items: [
            { label: 'Ngày đổi ca', value: formatIsoDate(row.work_date) },
          ],
        },
        attributes: {
          title: 'Chi tiết đổi ca',
          items: [
            { key: 'reason', label: 'Lý do đổi ca', value: row.reason || '—' },
            ...(row.description ? [{ key: 'description', label: 'Ghi chú', value: row.description }] : []),
          ],
        },
        timeline: {
          title: 'Tiến trình phê duyệt',
          steps: [
            {
              stepId: 'step-1',
              stepName: 'Nộp đơn',
              status: 'COMPLETED',
              actedAt: formatIsoDate(row.created_at),
              assigneeName: row.full_name,
            },
            {
              stepId: 'step-2',
              stepName: isWorkflow ? 'Quy trình phê duyệt (PE)' : 'Trưởng bộ phận phê duyệt',
              status: resolved.step2Status,
              actedAt: row.approved_at ? formatIsoDate(row.approved_at) : row.rejected_at ? formatIsoDate(row.rejected_at) : undefined,
            },
          ],
        },
      },
    };
  }

  private mapAdvanceToTask(row: Record<string, any>, tenantId: string): UniversalTaskDto {
    const isWorkflow = Boolean(row.link_instance_id);
    const resolved = resolveStatusAndActions(row.status);

    return {
      taskId: `hrm:advance:${row.id}`,
      tenantId,
      sourceModule: 'hrm',
      entityType: 'SALARY_ADVANCE_REQUEST',
      entityId: row.id,
      title: `Đơn đề nghị tạm ứng lương · ${row.full_name}`,
      code: `TU-${row.id.slice(0, 8).toUpperCase()}`,
      requester: {
        userId: row.user_id || '',
        fullName: row.full_name,
        departmentName: row.department_name,
        positionName: row.position_name,
      },
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      priority: 'NORMAL',
      approvalMode: isWorkflow ? 'WORKFLOW' : 'LOCAL',
      approvalOwner: isWorkflow ? 'procedure' : 'hrm',
      workflowInstanceId: row.link_instance_id || undefined,
      status: resolved.status,
      availableActions: resolved.availableActions,
      version: row.revision != null ? Number(row.revision) : undefined,
      detailUrl: `/modules/hrm/approvals?type=advance&request=${row.id}`,
      blocks: {
        summary: {
          items: [
            { label: 'Số tiền tạm ứng', value: formatVnd(row.requested_amount) },
            { label: 'Số kỳ thu hồi', value: `${row.number_of_installments || 1} kỳ` },
          ],
        },
        attributes: {
          title: 'Lý do tạm ứng',
          items: [
            { key: 'reason', label: 'Căn cứ', value: row.reason || row.description || '—' },
          ],
        },
        timeline: {
          title: 'Tiến trình phê duyệt',
          steps: [
            {
              stepId: 'step-1',
              stepName: 'Nộp đơn',
              status: 'COMPLETED',
              actedAt: formatIsoDate(row.created_at),
              assigneeName: row.full_name,
            },
            {
              stepId: 'step-2',
              stepName: isWorkflow ? 'Quy trình phê duyệt (PE)' : 'Trưởng bộ phận phê duyệt',
              status: resolved.step2Status,
              actedAt: row.approved_at ? formatIsoDate(row.approved_at) : row.rejected_at ? formatIsoDate(row.rejected_at) : undefined,
            },
          ],
        },
      },
    };
  }

  private mapCustomToTask(row: Record<string, any>, tenantId: string): UniversalTaskDto {
    const isWorkflow = Boolean(row.link_instance_id);
    const resolved = resolveStatusAndActions(row.status);

    return {
      taskId: `hrm:custom:${row.id}`,
      tenantId,
      sourceModule: 'hrm',
      entityType: 'CUSTOM_REQUEST',
      entityId: row.id,
      title: `${row.type_name || 'Đơn tùy chỉnh'} · ${row.full_name}`,
      code: `DC-${row.id.slice(0, 8).toUpperCase()}`,
      requester: {
        userId: row.user_id || '',
        fullName: row.full_name,
        departmentName: row.department_name,
        positionName: row.position_name,
      },
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      priority: 'NORMAL',
      approvalMode: isWorkflow ? 'WORKFLOW' : 'LOCAL',
      approvalOwner: isWorkflow ? 'procedure' : 'hrm',
      workflowInstanceId: row.link_instance_id || undefined,
      status: resolved.status,
      availableActions: resolved.availableActions,
      version: row.revision != null ? Number(row.revision) : undefined,
      detailUrl: `/modules/hrm/approvals?type=custom&request=${row.id}`,
      blocks: {
        summary: {
          items: [
            { label: 'Loại đơn', value: row.type_name || 'Đơn tuỳ chỉnh' },
          ],
        },
        attributes: {
          title: 'Chi tiết đề nghị',
          items: [
            ...(row.form_data && typeof row.form_data === 'object'
              ? Object.entries(row.form_data).map(([k, v]) => ({ key: k, label: k, value: String(v ?? '—') }))
              : [{ key: 'note', label: 'Ghi chú', value: '—' }]),
          ],
        },
        timeline: {
          title: 'Tiến trình phê duyệt',
          steps: [
            {
              stepId: 'step-1',
              stepName: 'Nộp đơn',
              status: 'COMPLETED',
              actedAt: formatIsoDate(row.created_at),
              assigneeName: row.full_name,
            },
            {
              stepId: 'step-2',
              stepName: isWorkflow ? 'Quy trình phê duyệt (PE)' : 'Trưởng bộ phận phê duyệt',
              status: resolved.step2Status,
              actedAt: row.approved_at ? formatIsoDate(row.approved_at) : row.rejected_at ? formatIsoDate(row.rejected_at) : undefined,
            },
          ],
        },
      },
    };
  }
}
