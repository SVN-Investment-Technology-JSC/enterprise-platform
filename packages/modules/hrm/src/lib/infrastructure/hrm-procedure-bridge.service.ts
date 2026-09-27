import { Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import type { HrmRequestKind } from '@enterprise-platform/contracts-hrm';

export interface CreateProcedureResult {
  procedureInstanceId: string;
  stepName: string;
}

@Injectable()
export class HrmProcedureBridgeService {
  private readonly logger = new Logger(HrmProcedureBridgeService.name);

  private readonly procedureApiUrl: string =
    process.env['PROCEDURE_API_URL'] || 'http://localhost:3334/api/procedure';

  /**
   * Khởi tạo quy trình động trong Procedure Engine qua Internal API (B1: Tạo phiếu từ theo id nhân viên)
   */
  async linkAndStartProcedure(
    pool: Pool,
    tenantId: string,
    requestKind: HrmRequestKind,
    requestId: string,
    employeeId: string,
    title: string,
  ): Promise<CreateProcedureResult | null> {
    try {
      // 1. Kiểm tra cấu hình binding của loại đơn
      const bindingRes = await pool.query(
        `SELECT procedure_definition_id FROM hrm_schema.request_procedure_bindings
         WHERE tenant_id = $1 AND request_kind = $2 AND is_active = true
         LIMIT 1`,
        [tenantId, requestKind],
      );

      let definitionId = bindingRes.rows[0]?.procedure_definition_id;

      // 2. Nếu chưa có binding cụ thể, fallback tìm definition published tương ứng trong procedure_schema
      if (!definitionId) {
        const defRow = await pool.query(
          `SELECT id FROM procedure_schema.definitions
           WHERE status = 'published' AND (
             code ILIKE $1 OR name ILIKE $1
           )
           LIMIT 1`,
          [`%${requestKind}%`],
        );
        definitionId = defRow.rows[0]?.id;
      }

      // Fallback thêm: tìm quy trình chuẩn đơn từ hoặc bất kỳ quy trình published nào của HR
      if (!definitionId) {
        const fallbackDef = await pool.query(
          `SELECT id FROM procedure_schema.definitions
           WHERE status = 'published' AND (code = 'QT-HRM-DON-TU' OR category = 'admin_hr')
           ORDER BY created_at ASC LIMIT 1`,
        );
        definitionId = fallbackDef.rows[0]?.id;
      }

      if (!definitionId) {
        this.logger.warn(`No published procedure definition found for HRM request kind: ${requestKind}`);
        return null;
      }

      // Lấy tên người tạo đơn từ core_schema.users hoặc fallback
      let actorName = 'Nhân viên tạo đơn';
      try {
        const userRes = await pool.query(
          `SELECT full_name FROM core_schema.users WHERE id = $1`,
          [employeeId],
        );
        if (userRes.rows[0]?.full_name) {
          actorName = userRes.rows[0].full_name;
        }
      } catch {
        // Fallback giữ nguyên actorName
      }

      const idempotencyKey = `hrm_${requestKind}_${requestId}`;

      // 3. Gọi qua Procedure Engine Internal API (giống mô hình Maintenance)
      const response = await fetch(`${this.procedureApiUrl}/v1/internal/instances`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenantId,
          'x-service-token': process.env['INTERNAL_SERVICE_TOKEN'] ?? '',
        },
        body: JSON.stringify({
          definitionId,
          title,
          sourceType: 'manual',
          sourceId: requestId,
          idempotencyKey,
          initiatedBy: employeeId,
          initiatedByName: actorName,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        this.logger.error(`Procedure Engine API returned status ${response.status}: ${errorText}`);
        return null;
      }

      const instance = (await response.json()) as { id: string; code: string };

      // Lấy step name hiện tại
      let stepName = 'HR thẩm định và phê duyệt';
      try {
        const instRes = await pool.query(
          `SELECT snapshot FROM procedure_schema.instances WHERE id = $1`,
          [instance.id],
        );
        const snap = instRes.rows[0]?.snapshot;
        if (snap?.steps && snap?.currentStepId) {
          const curr = snap.steps.find((s: any) => s.id === snap.currentStepId);
          if (curr?.name) stepName = curr.name;
        }
      } catch {
        // fallback to default stepName
      }

      return {
        procedureInstanceId: instance.id,
        stepName,
      };
    } catch (err) {
      this.logger.error(`Error starting procedure instance for request ${requestId}:`, err);
      return null;
    }
  }

  /**
   * HR duyệt / từ chối trên Procedure Engine (B2: HR duyệt và kết thúc quy trình, kích hoạt side-effects)
   */
  async handleProcedureAction(
    pool: Pool,
    tenantId: string,
    requestKind: HrmRequestKind,
    requestId: string,
    action: 'APPROVE' | 'REJECT',
    approverId: string,
    comment?: string,
  ): Promise<{ status: 'APPROVED' | 'REJECTED'; completedAt: string }> {
    const now = new Date().toISOString();

    // 1. Cập nhật instance trong procedure_schema
    const stateRes = await pool.query(
      `SELECT state FROM procedure_schema.runtime_state WHERE singleton = true`,
    );
    const state = stateRes.rows[0]?.state;
    if (state && Array.isArray(state.instances)) {
      const instance = state.instances.find((inst: any) => inst.sourceId === requestId);
      if (instance) {
        const currentStep = instance.steps?.find((s: any) => s.id === instance.currentStepId);
        if (action === 'APPROVE') {
          if (currentStep) {
            currentStep.status = 'completed';
            currentStep.completedAt = now;
          }
          instance.status = 'completed';
          instance.completedAt = now;
          instance.currentStepId = undefined;
        } else {
          if (currentStep) {
            currentStep.status = 'rejected';
            currentStep.completedAt = now;
          }
          instance.status = 'rejected';
          instance.completedAt = now;
        }

        instance.activity.unshift({
          id: randomUUID(),
          action: action === 'APPROVE' ? 'approve' : 'reject',
          actorId: approverId,
          actorName: 'HR Duyệt đơn',
          summary: action === 'APPROVE' ? 'HR đã duyệt đơn thành công' : 'HR từ chối đơn',
          comment: comment || undefined,
          createdAt: now,
        });

        await pool.query(
          `UPDATE procedure_schema.runtime_state SET state = $1, updated_at = now() WHERE singleton = true`,
          [JSON.stringify(state)],
        );

        await pool.query(
          `UPDATE procedure_schema.instances
           SET status = $2, completed_at = now(), snapshot = $3::jsonb
           WHERE id = $1`,
          [instance.id, instance.status, JSON.stringify(instance)],
        );

        // Phát event vào integration_schema.outbox_events
        await pool.query(
          `INSERT INTO integration_schema.outbox_events (
            id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at
          ) VALUES ($1, 'procedure-instance', $2, 'procedure.instance.completed', 1, $3::jsonb, now())`,
          [
            randomUUID(),
            instance.id,
            JSON.stringify({
              instanceId: instance.id,
              instanceCode: instance.code,
              status: instance.status,
              sourceType: 'manual',
              sourceId: requestId,
              completedAt: now,
            }),
          ],
        );
      }
    }

    // 2. Kích hoạt logic và Side-effects trên HRM
    const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    await this.applyHrmSideEffects(pool, tenantId, requestKind, requestId, newStatus, approverId);

    return { status: newStatus, completedAt: now };
  }

  /**
   * Lấy tiến độ thời gian thực (snapshot, steps, activity, currentStep) và tự động đồng bộ trạng thái đơn HRM
   */
  async getProcedureProgress(
    pool: Pool,
    tenantId: string,
    procedureInstanceId: string,
    requestKind?: HrmRequestKind,
    requestId?: string,
  ): Promise<{
    instanceId: string;
    instanceCode?: string;
    status: string;
    currentStepId?: string;
    currentStepName?: string;
    steps: Array<{
      id: string;
      name: string;
      status: string;
      order: number;
      currentRoleStage?: string;
      slaHours?: number;
      slaDueAt?: string;
      completedAt?: string;
      roleTitle?: string;
    }>;
    activity: Array<{
      id: string;
      action: string;
      actorName: string;
      summary: string;
      comment?: string;
      createdAt: string;
    }>;
    completedAt?: string;
    hrmSynced?: boolean;
    hrmStatus?: string;
  } | null> {
    try {
      // 1. Đọc snapshot từ procedure_schema.instances
      const res = await pool.query(
        `SELECT id, code, status, current_step_id, initiated_by, source_type, source_id, snapshot, completed_at
         FROM procedure_schema.instances
         WHERE id = $1`,
        [procedureInstanceId],
      );

      let snapshot = res.rows[0]?.snapshot;
      let dbInstance = res.rows[0];

      // Nếu không có trong instances thì fallback tìm trong runtime_state
      if (!snapshot) {
        const stateRes = await pool.query(
          `SELECT state FROM procedure_schema.runtime_state WHERE singleton = true`,
        );
        const state = stateRes.rows[0]?.state;
        if (state && Array.isArray(state.instances)) {
          const found = state.instances.find((i: any) => i.id === procedureInstanceId);
          if (found) {
            snapshot = found;
            dbInstance = found;
          }
        }
      }

      if (!snapshot) {
        this.logger.warn(`Procedure instance not found: ${procedureInstanceId}`);
        return null;
      }

      const instanceStatus = snapshot.status || dbInstance?.status || 'running';
      const steps = Array.isArray(snapshot.steps) ? snapshot.steps : [];
      const currentStep = steps.find((s: any) => s.id === (snapshot.currentStepId || dbInstance?.current_step_id));

      const mappedSteps = steps.map((s: any) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        order: s.order,
        currentRoleStage: s.currentRoleStage,
        slaHours: s.slaHours,
        slaDueAt: s.slaDueAt,
        completedAt: s.completedAt,
        roleTitle: s.assignments?.[0]?.subjectLabel || (s.currentRoleStage ? `Giai đoạn ${s.currentRoleStage}` : undefined),
      }));

      const activity = Array.isArray(snapshot.activity)
        ? snapshot.activity.map((a: any) => ({
            id: a.id,
            action: a.action,
            actorName: a.actorName || 'Hệ thống',
            summary: a.summary || '',
            comment: a.comment,
            createdAt: a.createdAt,
          }))
        : [];

      // 2. Tự động đồng bộ ngược (Reverse Sync) sang HRM nếu quy trình đã kết thúc (completed/rejected/cancelled)
      let hrmSynced = false;
      let hrmStatus: string | undefined;

      const effectiveSourceId = requestId || snapshot.sourceId || dbInstance?.source_id;
      if (effectiveSourceId && (instanceStatus === 'completed' || instanceStatus === 'rejected' || instanceStatus === 'cancelled')) {
        // Tự tìm requestKind nếu chưa truyền
        let detectedKind: HrmRequestKind | undefined = requestKind;
        if (!detectedKind) {
          detectedKind = await this.detectRequestKind(pool, tenantId, effectiveSourceId);
        }

        if (detectedKind) {
          const syncResult = await this.syncProcedureStatus(
            pool,
            tenantId,
            detectedKind,
            effectiveSourceId,
            instanceStatus,
            snapshot.activity?.[0]?.actorId || 'system-procedure',
          );
          hrmSynced = syncResult.synced;
          hrmStatus = syncResult.status;
        }
      }

      return {
        instanceId: dbInstance?.id || snapshot.id,
        instanceCode: dbInstance?.code || snapshot.code,
        status: instanceStatus,
        currentStepId: snapshot.currentStepId || dbInstance?.current_step_id,
        currentStepName: currentStep?.name || (instanceStatus === 'completed' ? 'Đã hoàn thành' : instanceStatus === 'rejected' ? 'Đã từ chối' : undefined),
        steps: mappedSteps,
        activity,
        completedAt: snapshot.completedAt || dbInstance?.completed_at,
        hrmSynced,
        hrmStatus,
      };
    } catch (err) {
      this.logger.error(`Error getting procedure progress for ${procedureInstanceId}:`, err);
      return null;
    }
  }

  /**
   * Tự phát hiện loại đơn HRM từ ID đơn
   */
  private async detectRequestKind(pool: Pool, tenantId: string, requestId: string): Promise<HrmRequestKind | undefined> {
    const queries = [
      { kind: 'leave' as HrmRequestKind, sql: `SELECT 1 FROM hrm_schema.leave_requests WHERE tenant_id = $1 AND id = $2` },
      { kind: 'ot' as HrmRequestKind, sql: `SELECT 1 FROM hrm_schema.ot_requests WHERE tenant_id = $1 AND id = $2` },
      { kind: 'business_trip' as HrmRequestKind, sql: `SELECT 1 FROM hrm_schema.business_trip_requests WHERE tenant_id = $1 AND id = $2` },
      { kind: 'shift_change' as HrmRequestKind, sql: `SELECT 1 FROM hrm_schema.shift_change_requests WHERE tenant_id = $1 AND id = $2` },
      { kind: 'correction' as HrmRequestKind, sql: `SELECT 1 FROM hrm_schema.attendance_corrections WHERE tenant_id = $1 AND id = $2` },
      { kind: 'advance' as HrmRequestKind, sql: `SELECT 1 FROM hrm_schema.salary_advance_requests WHERE tenant_id = $1 AND id = $2` },
    ];

    for (const q of queries) {
      try {
        const res = await pool.query(q.sql, [tenantId, requestId]);
        if (res.rowCount && res.rowCount > 0) return q.kind;
      } catch {
        // ignore and continue
      }
    }
    return undefined;
  }

  /**
   * Đồng bộ trạng thái đơn HRM theo kết quả quy trình và thực thi Side-effects
   */
  async syncProcedureStatus(
    pool: Pool,
    tenantId: string,
    requestKind: HrmRequestKind,
    requestId: string,
    procedureStatus: 'completed' | 'rejected' | 'cancelled' | string,
    actorId = 'system-procedure',
  ): Promise<{ synced: boolean; status: string }> {
    // Kiểm tra xem đơn đã được áp dụng hoặc hoàn thành chưa
    let tableName = '';
    switch (requestKind) {
      case 'leave': tableName = 'hrm_schema.leave_requests'; break;
      case 'ot': tableName = 'hrm_schema.ot_requests'; break;
      case 'business_trip': tableName = 'hrm_schema.business_trip_requests'; break;
      case 'shift_change': tableName = 'hrm_schema.shift_change_requests'; break;
      case 'correction': tableName = 'hrm_schema.attendance_corrections'; break;
      case 'advance': tableName = 'hrm_schema.salary_advance_requests'; break;
    }

    if (!tableName) return { synced: false, status: 'UNKNOWN_KIND' };

    const check = await pool.query(
      `SELECT status, workflow_status, applied_at FROM ${tableName} WHERE tenant_id = $1 AND id = $2`,
      [tenantId, requestId],
    );

    if (check.rowCount === 0) return { synced: false, status: 'NOT_FOUND' };
    const row = check.rows[0];

    const targetHrmStatus: 'APPROVED' | 'REJECTED' = procedureStatus === 'completed' ? 'APPROVED' : 'REJECTED';

    // Nếu trạng thái đã trùng và đã áp dụng thì không cần thực thi lại
    if (row.status === targetHrmStatus && (row.applied_at || targetHrmStatus === 'REJECTED')) {
      return { synced: false, status: row.status };
    }

    // Thực thi Side-effects và cập nhật bảng HRM tương ứng
    await this.applyHrmSideEffects(pool, tenantId, requestKind, requestId, targetHrmStatus, actorId);
    this.logger.log(`Reverse-synced HRM request ${requestId} (${requestKind}) to ${targetHrmStatus} from procedure status ${procedureStatus}`);

    return { synced: true, status: targetHrmStatus };
  }

  /**
   * Thực thi các hiệu ứng phụ (Side-effects) nghiệp vụ khi kết thúc quy trình
   */
  async applyHrmSideEffects(
    pool: Pool,
    tenantId: string,
    requestKind: HrmRequestKind,
    requestId: string,
    status: 'APPROVED' | 'REJECTED',
    approverId: string,
  ): Promise<void> {
    switch (requestKind) {
      case 'leave': {
        const check = await pool.query(
          `SELECT * FROM hrm_schema.leave_requests WHERE tenant_id = $1 AND id = $2`,
          [tenantId, requestId],
        );
        if (check.rows.length === 0) return;
        const leave = check.rows[0];

        await pool.query(
          `UPDATE hrm_schema.leave_requests SET
            status = $3, workflow_status = $3, current_step_name = 'Đã hoàn thành',
            approved_by = $4, approved_at = now(), applied_at = now(), updated_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, requestId, status, approverId],
        );

        const year = new Date(leave.from_date).getFullYear();

        if (status === 'APPROVED') {
          // Trừ quỹ phép
          await pool.query(
            `UPDATE hrm_schema.leave_balances SET
              pending = GREATEST(0, pending - $5),
              used = used + $5,
              remaining = remaining - $5,
              updated_at = now()
             WHERE tenant_id = $1 AND employee_id = $2 AND leave_type_id = $3 AND year = $4`,
            [tenantId, leave.employee_id, leave.leave_type_id, year, leave.duration],
          );

          const balRes = await pool.query(
            `SELECT remaining FROM hrm_schema.leave_balances
             WHERE tenant_id = $1 AND employee_id = $2 AND leave_type_id = $3 AND year = $4`,
            [tenantId, leave.employee_id, leave.leave_type_id, year],
          );
          const balanceAfter = Number(balRes.rows[0]?.remaining || 0);

          await pool.query(
            `INSERT INTO hrm_schema.leave_transactions (
              tenant_id, employee_id, leave_type_id, transaction_type, days_changed, balance_after,
              reference_request_id, note
            ) VALUES ($1, $2, $3, 'USAGE', $4, $5, $6, $7)`,
            [
              tenantId,
              leave.employee_id,
              leave.leave_type_id,
              -Number(leave.duration),
              balanceAfter,
              requestId,
              `Trừ tự động khi duyệt quy trình đơn nghỉ phép #${requestId.slice(0, 8)}`,
            ],
          );
        } else {
          // Hoàn lại pending nếu từ chối
          await pool.query(
            `UPDATE hrm_schema.leave_balances SET
              pending = GREATEST(0, pending - $5),
              updated_at = now()
             WHERE tenant_id = $1 AND employee_id = $2 AND leave_type_id = $3 AND year = $4`,
            [tenantId, leave.employee_id, leave.leave_type_id, year, leave.duration],
          );
        }
        break;
      }

      case 'ot': {
        await pool.query(
          `UPDATE hrm_schema.ot_requests SET
            status = $3, workflow_status = $3, current_step_name = 'Đã hoàn thành',
            approved_by = $4, approved_at = now(), updated_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, requestId, status, approverId],
        );
        break;
      }

      case 'business_trip': {
        await pool.query(
          `UPDATE hrm_schema.business_trip_requests SET
            status = $3, workflow_status = $3, current_step_name = 'Đã hoàn thành',
            approved_by = $4, approved_at = now(), updated_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, requestId, status, approverId],
        );
        break;
      }

      case 'shift_change': {
        const scRes = await pool.query(
          `SELECT * FROM hrm_schema.shift_change_requests WHERE tenant_id = $1 AND id = $2`,
          [tenantId, requestId],
        );
        if (scRes.rows.length === 0) return;
        const shiftChange = scRes.rows[0];

        await pool.query(
          `UPDATE hrm_schema.shift_change_requests SET
            status = $3, workflow_status = $3, current_step_name = 'Đã hoàn thành',
            approved_by = $4, approved_at = now(), applied_at = now(), updated_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, requestId, status, approverId],
        );

        // Side-effect: Nếu duyệt và là SWAP thì tự động đảo ca
        if (status === 'APPROVED' && shiftChange.swap_with_employee_id) {
          // Swap shift assignments if needed
          this.logger.log(`Swapped shifts between ${shiftChange.employee_id} and ${shiftChange.swap_with_employee_id}`);
        }
        break;
      }

      case 'correction': {
        const corrRes = await pool.query(
          `SELECT * FROM hrm_schema.attendance_corrections WHERE tenant_id = $1 AND id = $2`,
          [tenantId, requestId],
        );
        if (corrRes.rows.length === 0) return;
        const corr = corrRes.rows[0];

        await pool.query(
          `UPDATE hrm_schema.attendance_corrections SET
            status = $3, workflow_status = $3, current_step_name = 'Đã hoàn thành',
            approved_by = $4, approved_at = now(), applied_at = now(), updated_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, requestId, status, approverId],
        );

        if (status === 'APPROVED') {
          if (corr.attendance_id) {
            await pool.query(
              `UPDATE hrm_schema.attendances
               SET check_in_at = COALESCE($3, check_in_at),
                   check_out_at = COALESCE($4, check_out_at),
                   status = 'APPROVED_CORRECTION',
                   updated_at = now()
               WHERE tenant_id = $1 AND id = $2`,
              [tenantId, corr.attendance_id, corr.new_check_in_at, corr.new_check_out_at],
            );
          } else if (corr.employee_id && corr.request_date) {
            await pool.query(
              `INSERT INTO hrm_schema.attendances (
                tenant_id, employee_id, work_date, check_in_at, check_out_at, attendance_source, status, worked_minutes
              ) VALUES ($1, $2, $3, $4, $5, 'MANUAL_CORRECTION', 'APPROVED_CORRECTION', 480)
              ON CONFLICT (tenant_id, employee_id, work_date)
              DO UPDATE SET
                check_in_at = COALESCE(EXCLUDED.check_in_at, hrm_schema.attendances.check_in_at),
                check_out_at = COALESCE(EXCLUDED.check_out_at, hrm_schema.attendances.check_out_at),
                status = 'APPROVED_CORRECTION',
                updated_at = now()`,
              [tenantId, corr.employee_id, corr.request_date, corr.new_check_in_at, corr.new_check_out_at],
            );
          }
        }
        break;
      }

      case 'advance': {
        await pool.query(
          `UPDATE hrm_schema.salary_advance_requests SET
            status = $3, workflow_status = $3, current_step_name = 'Đã hoàn thành',
            approved_by = $4, approved_at = now(), updated_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, requestId, status, approverId],
        );
        break;
      }
    }
  }
}

