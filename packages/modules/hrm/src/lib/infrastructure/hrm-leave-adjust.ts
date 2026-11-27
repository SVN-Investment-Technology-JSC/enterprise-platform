import { randomUUID } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { ImportHrmLeaveRequest, ImportHrmLeaveResult } from '@enterprise-platform/contracts-hrm';
import { unpostedUsableEntitlement } from './hrm-annual-leave.js';
import { applyLeaveDelta, pendingReservedDays } from './hrm-leave-balance.js';
import { ensureLeaveBalance } from './hrm-leave-operations.js';
import { lifecycleAudit } from './hrm-lifecycle.js';
import { isoDate, lockEmployee } from './hrm-time.js';

export interface LeaveAdjustmentInput {
  readonly employeeId: string;
  readonly leaveTypeId: string;
  readonly daysAdjusted: number;
  readonly reason: string;
  readonly year: number;
  readonly operationKey: string | null;
}

/** Tiền tố khóa thao tác của dòng điều chỉnh sinh ra từ import Excel; lịch sử dùng nó để gắn nhãn "Import Excel". */
export const LEAVE_IMPORT_KEY_PREFIX = 'import:';

/**
 * Ghi một lần điều chỉnh quỹ phép (cộng hoặc trừ ngày) và dòng giao dịch ADJUSTMENT tương ứng.
 * Dùng chung cho điều chỉnh tay từng người và import Excel; người gọi tự bọc transaction.
 */
export async function applyLeaveAdjustment(
  db: PoolClient,
  tenantId: string,
  actorId: string,
  body: LeaveAdjustmentInput,
): Promise<Record<string, unknown>> {
  await lockEmployee(db, tenantId, body.employeeId);
  const type = await db.query(
    `SELECT CASE WHEN is_annual THEN 0 ELSE negative_limit END AS negative_limit FROM hrm_schema.leave_types WHERE tenant_id=$1 AND id=$2`,
    [tenantId, body.leaveTypeId],
  );
  if (!type.rows[0]) throw new NotFoundException('Không tìm thấy loại nghỉ');
  const balance = await ensureLeaveBalance(db, tenantId, body.employeeId, body.leaveTypeId, body.year);
  // Kiểm tra theo đúng số "Còn lại" đang hiển thị: số dư ghi sổ + phần đến hạn/ứng chưa ghi sổ - đơn chờ duyệt.
  // Nếu chỉ xét số dư ghi sổ thì không thể trừ phần ứng phép (số dư ghi sổ tụt xuống âm rồi tự về 0 khi cộng phép tháng).
  const usable = await unpostedUsableEntitlement(
    db,
    tenantId,
    body.employeeId,
    body.leaveTypeId,
    body.year,
    Number(balance.accrued),
    isoDate((await db.query('SELECT CURRENT_DATE AS today')).rows[0].today),
  );
  const reserved = await pendingReservedDays(db, tenantId, body.employeeId, body.leaveTypeId, body.year);
  if (
    Number(balance.remaining) + usable.extra + body.daysAdjusted - reserved <
    -Number(type.rows[0].negative_limit) - 0.005
  )
    throw new BadRequestException('Điều chỉnh vượt hạn mức âm phép');
  const updated = await applyLeaveDelta(db, tenantId, balance.id, {
    adjusted: body.daysAdjusted,
    remaining: body.daysAdjusted,
  });
  const tx = await db.query(
    `INSERT INTO hrm_schema.leave_transactions (tenant_id,employee_id,leave_type_id,transaction_type,days_changed,balance_after,note,balance_year,actor_id,operation_key) VALUES ($1,$2,$3,'ADJUSTMENT',$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      tenantId,
      body.employeeId,
      body.leaveTypeId,
      body.daysAdjusted,
      updated.remaining,
      body.reason,
      body.year,
      actorId,
      body.operationKey,
    ],
  );
  return tx.rows[0];
}

/**
 * Import điều chỉnh quỹ phép năm hàng loạt từ danh sách (Excel). Mỗi dòng là một lần điều chỉnh cộng hoặc trừ ngày,
 * ghi thành giao dịch ADJUSTMENT có tài khoản thực hiện để hiện trong "Lịch sử điều chỉnh". SAVEPOINT từng dòng để
 * dòng lỗi (sai mã nhân viên, vượt hạn mức âm) không làm hỏng cả lô.
 */
export async function importLeaveAdjustments(
  db: PoolClient,
  tenantId: string,
  actorId: string,
  body: ImportHrmLeaveRequest,
): Promise<ImportHrmLeaveResult> {
  const inputRows = Array.isArray(body?.rows) ? body.rows : [];
  if (inputRows.length === 0) throw new BadRequestException('Danh sách import quỹ phép năm không được để trống');
  if (inputRows.length > 1000) throw new BadRequestException('Mỗi lần import tối đa 1.000 dòng');
  if (!actorId) throw new BadRequestException('Không xác định được tài khoản thực hiện import');

  const types = await db.query<{ id: string }>(
    `SELECT id FROM hrm_schema.leave_types
      WHERE tenant_id=$1 AND is_annual AND active=true AND deleted_at IS NULL ORDER BY code LIMIT 1`,
    [tenantId],
  );
  const leaveTypeId = types.rows[0]?.id;
  if (!leaveTypeId) throw new BadRequestException('Chưa cấu hình loại nghỉ Phép năm');

  const emp = await db.query<{ id: string; employee_code: string | null }>(
    `SELECT employee_id AS id, employee_code FROM hrm_schema.employee_directory WHERE tenant_id=$1`,
    [tenantId],
  );
  const byCode = new Map<string, string>();
  for (const row of emp.rows) {
    const code = (row.employee_code ?? '').trim().toUpperCase();
    if (code) byCode.set(code, row.id);
  }

  const batchId = randomUUID();
  const currentYear = new Date().getFullYear();
  const skipped: Array<{ rowIndex: number; employeeCode: string; reason: string }> = [];
  let applied = 0;

  for (let i = 0; i < inputRows.length; i += 1) {
    const item = inputRows[i];
    const rowIndex = i + 1;
    const rawCode = String(item?.employeeCode ?? '').trim();
    const skip = (reason: string) => skipped.push({ rowIndex, employeeCode: rawCode, reason });
    const employeeId = byCode.get(rawCode.toUpperCase());
    if (!employeeId) {
      skip('Không tìm thấy mã nhân viên');
      continue;
    }
    const reason = String(item?.reason ?? '').trim();
    if (!reason) {
      skip('Thiếu lý do điều chỉnh');
      continue;
    }
    if (reason.length > 2000) {
      skip('Lý do tối đa 2000 ký tự');
      continue;
    }
    const days = Number(item?.days);
    if (!Number.isFinite(days) || days === 0 || Math.abs(days) > 366) {
      skip('Số ngày phải khác 0 và không quá 366');
      continue;
    }
    const year = item?.year === undefined || item.year === null ? currentYear : Number(item.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2200) {
      skip('Năm không hợp lệ');
      continue;
    }

    await db.query('SAVEPOINT sp_leave_import');
    try {
      await applyLeaveAdjustment(db, tenantId, actorId, {
        employeeId,
        leaveTypeId,
        daysAdjusted: days,
        reason,
        year,
        operationKey: `${LEAVE_IMPORT_KEY_PREFIX}${batchId}:${rowIndex}`,
      });
      await db.query('RELEASE SAVEPOINT sp_leave_import');
      applied += 1;
    } catch (error) {
      await db.query('ROLLBACK TO SAVEPOINT sp_leave_import');
      await db.query('RELEASE SAVEPOINT sp_leave_import');
      skip(error instanceof Error ? error.message : 'Lỗi điều chỉnh quỹ phép');
    }
  }

  // Một dòng nhật ký cho cả lần import: ai nhập, tệp nào, bao nhiêu dòng thành công và bị bỏ qua.
  await lifecycleAudit(db, tenantId, actorId, 'LEAVE_BALANCE_IMPORTED', batchId, {
    fileName: String(body?.fileName ?? '').slice(0, 200) || null,
    total: inputRows.length,
    applied,
    skipped: skipped.length,
  });
  return { batchId, applied, skipped };
}
