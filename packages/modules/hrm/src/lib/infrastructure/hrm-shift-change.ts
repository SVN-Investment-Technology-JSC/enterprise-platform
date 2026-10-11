import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { resolveDay, workScheduleTableExists } from './hrm-shift-resolution.js';
import {
  assertOpenRange,
  dayKindOf,
  isUnassignedSunday,
  isoDate,
  lockEmployee,
  resolvePolicy,
} from './hrm-time.js';
import { loadExisting } from './hrm-work-schedule.js';
import {
  approvedConflicts,
  findRequestConflicts,
  requestConflictException,
} from './hrm-work-schedule-requests.js';

/**
 * Đổi ca được ghi thành ngoại lệ trong lịch phân ca từng ngày (dòng cũ nếu có chuyển CANCELLED, không xoá).
 * Chỉ ngày đang làm đúng ca trong đơn mới được đổi; ngày OFF, ngày lễ (kể cả lễ vẫn giữ ca) và ngày nghỉ hằng tuần
 * trong khoảng đơn được bỏ qua, không bị ghi đè. Ngày làm việc đang ở ca khác ca trong đơn thì từ chối.
 */
interface RangePlan {
  employee: string;
  /** Ngày sẽ đổi sang ca mới. */
  changeDays: string[];
  /** Ngày trong khoảng đơn nhưng không phải ngày làm đúng ca cũ (OFF, lễ, nghỉ hằng tuần): giữ nguyên. */
  skippedDays: string[];
}

async function planRange(
  db: PoolClient,
  tenant: string,
  employee: string,
  from: string,
  to: string,
  oldShift: string,
): Promise<RangePlan> {
  if (!(await workScheduleTableExists(db, tenant)))
    throw new ConflictException({
      code: 'HRM_SCHEDULE_NOT_MIGRATED',
      message: 'Dữ liệu phân ca chưa được khởi tạo cho tenant này; cần chạy migration HRM 0035 trước.',
    });
  const days = await db.query(
    `SELECT to_char(d,'YYYY-MM-DD') AS date FROM generate_series($1::date,$2::date,'1 day') d`,
    [from, to],
  );
  const changeDays: string[] = [];
  const skippedDays: string[] = [];
  for (const day of days.rows) {
    const policy = await resolvePolicy(db, tenant, 'ATTENDANCE', day.date, employee);
    const timezone = String(policy?.config_json?.timezone || 'Asia/Ho_Chi_Minh');
    const resolved = await resolveDay(db, tenant, employee, day.date, timezone);
    if (resolved.scheduleDayType === 'OFF' || resolved.scheduleDayType === 'HOLIDAY') {
      skippedDays.push(day.date);
      continue;
    }
    const kind = await dayKindOf(db, tenant, day.date, employee);
    if (!resolved.picked && (kind === 'OFF' || kind === 'HOLIDAY' || isUnassignedSunday(day.date, kind, false))) {
      skippedDays.push(day.date);
      continue;
    }
    if (!resolved.picked || resolved.picked.row.id !== oldShift)
      throw new BadRequestException(
        `Lịch ca hiện tại ngày ${day.date.slice(8)}/${day.date.slice(5, 7)}/${day.date.slice(0, 4)} khác nội dung đơn đổi ca`,
      );
    changeDays.push(day.date);
  }
  if (!changeDays.length)
    throw new BadRequestException('Khoảng đổi ca không có ngày làm việc nào đang dùng ca cũ trong đơn');
  return { employee, changeDays, skippedDays };
}

async function applyRange(
  db: PoolClient,
  tenant: string,
  plan: RangePlan,
  newShift: string,
  requestId: string,
) {
  const { employee, changeDays, skippedDays } = plan;
  const before = await db.query(
    `UPDATE hrm_schema.employee_work_days SET status='CANCELLED', cancel_reason='SHIFT_CHANGE_REQUEST', updated_at=now()
      WHERE tenant_id=$1 AND employee_id=$2 AND status='ACTIVE' AND work_date = ANY($3::date[])
      RETURNING work_date, day_type, shift_id, source`,
    [tenant, employee, changeDays],
  );
  const shift = await db.query(
    `SELECT code,name,to_char(start_time,'HH24:MI') AS start_time,to_char(end_time,'HH24:MI') AS end_time,break_minutes FROM hrm_schema.shift_definitions WHERE tenant_id=$1 AND id=$2`,
    [tenant, newShift],
  );
  const s = shift.rows[0];
  await db.query(
    `INSERT INTO hrm_schema.employee_work_days (tenant_id,employee_id,work_date,day_type,shift_id,source,shift_snapshot,note,status)
     SELECT $1,$2,d::date,'SHIFT',$4::uuid,'EXCEPTION',$5::jsonb,'Đổi ca theo đơn đã duyệt','ACTIVE' FROM unnest($3::date[]) AS d`,
    [
      tenant,
      employee,
      changeDays,
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
      changeDays[0],
      changeDays[changeDays.length - 1],
      JSON.stringify(before.rows.map((r) => ({ date: isoDate(r.work_date), dayType: r.day_type, shiftId: r.shift_id, source: r.source }))),
      JSON.stringify({ shiftId: newShift, days: changeDays, skippedDays, requestId, source: 'EXCEPTION' }),
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
  await assertOpenRange(db, tenant, from, to);
  const plans = [
    {
      plan: await planRange(db, tenant, change.employee_id, from, to, change.current_shift_id),
      newShift: change.requested_shift_id as string,
    },
    ...(change.change_type === 'SWAP'
      ? [
          {
            plan: await planRange(db, tenant, change.swap_with_employee_id, from, to, change.requested_shift_id),
            newShift: change.current_shift_id as string,
          },
        ]
      : []),
  ];
  // Ca mới không được làm lệch đơn nghỉ/công tác đã duyệt của chính ngày đó (phút nghỉ hưởng lương đã chốt theo ca cũ).
  const existing = await loadExisting(
    db,
    tenant,
    plans.map((p) => p.plan.employee),
    from,
    to,
  );
  const conflicts = approvedConflicts(
    await findRequestConflicts(
      db,
      tenant,
      plans.flatMap(({ plan, newShift }) =>
        plan.changeDays.map((date) => ({
          employeeId: plan.employee,
          date,
          after: { dayType: 'SHIFT' as const, shiftId: newShift },
        })),
      ),
      existing,
    ),
  );
  if (conflicts.length) throw requestConflictException(conflicts);
  for (const { plan, newShift } of plans) await applyRange(db, tenant, plan, newShift, id);
  const updated = await db.query(
    `UPDATE hrm_schema.shift_change_requests SET status='APPROVED',approved_by=$3,approved_at=now(),applied_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
    [tenant, id, actor],
  );
  return updated.rows[0];
}
