import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { resolveShiftRow } from './hrm-shift-resolution.js';
import { assertOpenDate, isoDate, lockEmployee } from './hrm-time.js';

async function replaceRange(
  db: PoolClient,
  tenant: string,
  employee: string,
  from: string,
  to: string,
  oldShift: string,
  newShift: string,
) {
  const assignments = await db.query(
    `SELECT * FROM hrm_schema.shift_assignments WHERE tenant_id=$1 AND employee_id=$2 AND status='ACTIVE' AND daterange(effective_from,COALESCE(effective_to,'infinity'::date),'[]') && daterange($3::date,$4::date,'[]') FOR UPDATE`,
    [tenant, employee, from, to],
  );
  if (!assignments.rows.length) {
    // Không có phân ca cá nhân: ca đang là ca kế thừa từ đơn vị; đổi ca = tạo ngoại lệ cá nhân.
    const days = await db.query(
      `SELECT to_char(d,'YYYY-MM-DD') AS date FROM generate_series($1::date,$2::date,'1 day') d`,
      [from, to],
    );
    for (const day of days.rows) {
      const picked = await resolveShiftRow(
        db,
        tenant,
        employee,
        day.date,
        'Asia/Ho_Chi_Minh',
      );
      if (!picked || picked.row.id !== oldShift)
        throw new BadRequestException('Lịch ca hiện tại khác nội dung đơn đổi ca');
    }
    await db.query(
      `INSERT INTO hrm_schema.shift_assignments (tenant_id,employee_id,shift_id,effective_from,effective_to,source) VALUES ($1,$2,$3,$4,$5,'SWAP_REQUEST')`,
      [tenant, employee, newShift, from, to],
    );
    return;
  }
  if (assignments.rows.some((a) => a.shift_id !== oldShift))
    throw new BadRequestException('Lịch ca hiện tại khác nội dung đơn đổi ca');
  const coverage = await db.query(
    `SELECT count(*)::int AS n FROM generate_series($3::date,$4::date,'1 day') d WHERE (SELECT count(*) FROM hrm_schema.shift_assignments a WHERE a.tenant_id=$1 AND a.employee_id=$2 AND a.status='ACTIVE' AND d::date>=a.effective_from AND (a.effective_to IS NULL OR d::date<=a.effective_to))<>1`,
    [tenant, employee, from, to],
  );
  if (coverage.rows[0].n)
    throw new BadRequestException(
      'Lịch ca bị thiếu hoặc trùng trong khoảng đổi',
    );
  for (const a of assignments.rows) {
    await db.query(
      `UPDATE hrm_schema.shift_assignments SET status='SUPERSEDED',updated_at=now() WHERE tenant_id=$1 AND id=$2`,
      [tenant, a.id],
    );
    if (isoDate(a.effective_from) < from)
      await db.query(
        `INSERT INTO hrm_schema.shift_assignments (tenant_id,employee_id,shift_id,effective_from,effective_to,source) VALUES ($1,$2,$3,$4,$5::date-1,$6)`,
        [tenant, employee, a.shift_id, a.effective_from, from, a.source],
      );
    if (!a.effective_to || isoDate(a.effective_to) > to)
      await db.query(
        `INSERT INTO hrm_schema.shift_assignments (tenant_id,employee_id,shift_id,effective_from,effective_to,source) VALUES ($1,$2,$3,$4::date+1,$5,$6)`,
        [tenant, employee, a.shift_id, to, a.effective_to, a.source],
      );
  }
  await db.query(
    `INSERT INTO hrm_schema.shift_assignments (tenant_id,employee_id,shift_id,effective_from,effective_to,source) VALUES ($1,$2,$3,$4,$5,'SWAP_REQUEST')`,
    [tenant, employee, newShift, from, to],
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
