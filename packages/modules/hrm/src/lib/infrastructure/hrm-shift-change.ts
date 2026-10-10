import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { resolveShiftRow, workScheduleTableExists } from './hrm-shift-resolution.js';
import { assertOpenDate, isoDate, lockEmployee } from './hrm-time.js';

/**
 * Đổi ca được ghi thành ngoại lệ trong lịch phân ca từng ngày (dòng cũ nếu có chuyển CANCELLED, không xoá).
 * Ca hiện tại của từng ngày (từ lịch từng ngày hoặc lịch định kỳ) phải khớp với ca trong đơn.
 */
async function replaceRange(
  db: PoolClient,
  tenant: string,
  employee: string,
  from: string,
  to: string,
  oldShift: string,
  newShift: string,
) {
  if (!(await workScheduleTableExists(db, tenant)))
    throw new ConflictException({
      code: 'HRM_SCHEDULE_NOT_MIGRATED',
      message: 'Dữ liệu phân ca chưa được khởi tạo cho tenant này; cần chạy migration HRM 0035 trước.',
    });
  const days = await db.query(
    `SELECT to_char(d,'YYYY-MM-DD') AS date FROM generate_series($1::date,$2::date,'1 day') d`,
    [from, to],
  );
  for (const day of days.rows) {
    const picked = await resolveShiftRow(db, tenant, employee, day.date, 'Asia/Ho_Chi_Minh');
    if (!picked || picked.row.id !== oldShift)
      throw new BadRequestException('Lịch ca hiện tại khác nội dung đơn đổi ca');
  }
  const before = await db.query(
    `UPDATE hrm_schema.employee_work_days SET status='CANCELLED', cancel_reason='SHIFT_CHANGE_REQUEST', updated_at=now()
      WHERE tenant_id=$1 AND employee_id=$2 AND status='ACTIVE' AND work_date BETWEEN $3::date AND $4::date
      RETURNING work_date, day_type, shift_id, source`,
    [tenant, employee, from, to],
  );
  const shift = await db.query(
    `SELECT code,name,to_char(start_time,'HH24:MI') AS start_time,to_char(end_time,'HH24:MI') AS end_time,break_minutes FROM hrm_schema.shift_definitions WHERE tenant_id=$1 AND id=$2`,
    [tenant, newShift],
  );
  const s = shift.rows[0];
  await db.query(
    `INSERT INTO hrm_schema.employee_work_days (tenant_id,employee_id,work_date,day_type,shift_id,source,shift_snapshot,note,status)
     SELECT $1,$2,d::date,'SHIFT',$5::uuid,'EXCEPTION',$6::jsonb,'Đổi ca theo đơn đã duyệt','ACTIVE' FROM generate_series($3::date,$4::date,'1 day') d`,
    [
      tenant,
      employee,
      from,
      to,
      newShift,
      JSON.stringify({ code: s.code, name: s.name, startTime: s.start_time, endTime: s.end_time, breakMinutes: Number(s.break_minutes ?? 0) }),
    ],
  );
  await db.query(
    `INSERT INTO hrm_schema.work_schedule_audit (tenant_id,action,employee_id,from_date,to_date,before,after,reason)
     VALUES ($1,'SHIFT_CHANGE',$2,$3,$4,$5,$6,'Đơn đổi ca đã duyệt')`,
    [
      tenant,
      employee,
      from,
      to,
      JSON.stringify(before.rows.map((r) => ({ date: isoDate(r.work_date), dayType: r.day_type, shiftId: r.shift_id, source: r.source }))),
      JSON.stringify({ shiftId: newShift, from, to, source: 'EXCEPTION' }),
    ],
  );
}

export async function approveShiftChange(
  db: PoolClient,
  tenant: string,
  actor: string,
  id: string,
) {
  const result = await db.query(
    `SELECT * FROM hrm_schema.shift_change_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [tenant, id],
  );
  const change = result.rows[0];
  if (!change) throw new NotFoundException('Không tìm thấy đơn đổi ca');
  if (change.status === 'APPROVED') return change;
  if (!['PENDING', 'PEER_CONFIRMED'].includes(change.status))
    throw new BadRequestException('Đơn không còn chờ duyệt');
  if (
    change.change_type === 'SWAP' &&
    (!change.swap_with_employee_id || !change.swap_peer_confirmed)
  )
    throw new BadRequestException('Người đổi cùng chưa xác nhận');
  const employees = [
    change.employee_id,
    ...(change.change_type === 'SWAP' ? [change.swap_with_employee_id] : []),
  ].sort();
  if (new Set(employees).size !== employees.length)
    throw new BadRequestException('Không thể đổi ca với chính mình');
  for (const employee of employees) await lockEmployee(db, tenant, employee);
  const shift = await db.query(
    `SELECT id FROM hrm_schema.shift_definitions WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND status='ACTIVE'`,
    [tenant, [change.current_shift_id, change.requested_shift_id]],
  );
  if (shift.rowCount !== 2)
    throw new BadRequestException(
      'Ca đổi phải khác nhau và đang hoạt động trong tenant',
    );
  const from = isoDate(change.from_date),
    to = isoDate(change.to_date);
  const dates = await db.query(
    `SELECT to_char(d,'YYYY-MM-DD') AS date FROM generate_series($1::date,$2::date,'1 day') d`,
    [from, to],
  );
  for (const day of dates.rows) await assertOpenDate(db, tenant, day.date);
  await replaceRange(
    db,
    tenant,
    change.employee_id,
    from,
    to,
    change.current_shift_id,
    change.requested_shift_id,
  );
  if (change.change_type === 'SWAP')
    await replaceRange(
      db,
      tenant,
      change.swap_with_employee_id,
      from,
      to,
      change.requested_shift_id,
      change.current_shift_id,
    );
  const updated = await db.query(
    `UPDATE hrm_schema.shift_change_requests SET status='APPROVED',approved_by=$3,approved_at=now(),applied_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
    [tenant, id, actor],
  );
  return updated.rows[0];
}
