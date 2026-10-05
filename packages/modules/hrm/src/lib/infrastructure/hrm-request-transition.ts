import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  HrmRequestRef,
  HrmTerminalStatus,
} from '@enterprise-platform/contracts-hrm';
import {
  assertOpenDate,
  assertOpenRange,
  isoDate,
  isoTime,
  lockEmployee,
  resolvePolicy,
  recalculateAttendance,
} from './hrm-time.js';
import {
  applyDocumentChanges,
  parseDocumentChanges,
} from './hrm-profile-documents.js';
import { transitionLeave } from './hrm-leave-operations.js';
import { approveOvertime } from './hrm-overtime.js';
import { approveShiftChange } from './hrm-shift-change.js';
import {
  HRM_REQUEST_TABLES,
  normalizeHrmRequestKind,
} from './hrm-procedure-links.js';

export async function approveAttendanceCorrection(
  db: PoolClient,
  tenantId: string,
  actorId: string,
  id: string,
) {
  const result = await db.query(
    `SELECT * FROM hrm_schema.attendance_corrections WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [tenantId, id],
  );
  const correction = result.rows[0];
  if (!correction) throw new NotFoundException('Không tìm thấy đơn giải trình');
  if (correction.status === 'APPROVED') return correction;
  if (correction.status !== 'PENDING')
    throw new BadRequestException('Đơn không còn chờ duyệt');
  const date = isoDate(correction.request_date);
  await lockEmployee(db, tenantId, correction.employee_id);
  await assertOpenDate(db, tenantId, date);
  const sessions =
    correction.corrected_sessions ||
    (correction.new_check_in_at && correction.new_check_out_at
      ? [
          {
            start: isoTime(correction.new_check_in_at),
            end: isoTime(correction.new_check_out_at),
          },
        ]
      : []);
  if (!sessions.length)
    throw new BadRequestException(
      'Đơn cũ thiếu giờ vào/ra; cần gửi lại đầy đủ',
    );
  const policy = await resolvePolicy(
    db,
    tenantId,
    'ATTENDANCE',
    date,
    correction.employee_id,
  );
  const timezone = String(policy?.config_json.timezone || 'Asia/Ho_Chi_Minh');
  await db.query(
    `UPDATE hrm_schema.attendance_events SET voided_by_correction_id=$4 WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$3 AND voided_by_correction_id IS NULL`,
    [tenantId, correction.employee_id, date, id],
  );
  for (let index = 0; index < sessions.length; index++) {
    const session = sessions[index];
    for (const [kind, at] of [
      ['IN', session.start],
      ['OUT', session.end],
    ]) {
      await db.query(
        `INSERT INTO hrm_schema.attendance_events (tenant_id,employee_id,work_date,event_kind,occurred_at,source,external_event_id,evidence,created_by)
            VALUES ($1,$2,$3,$4,$5,'MANUAL_CORRECTION',$6,$7,$8)`,
        [
          tenantId,
          correction.employee_id,
          date,
          kind,
          at,
          `${id}:${index}:${kind}`,
          JSON.stringify({ correctionId: id }),
          actorId,
        ],
      );
    }
  }
  await recalculateAttendance(
    db,
    tenantId,
    correction.employee_id,
    date,
    timezone,
    'MANUAL_CORRECTION',
  );
  const updated = await db.query(
    `UPDATE hrm_schema.attendance_corrections SET status='APPROVED',approved_by=$3,approved_at=now(),applied_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
    [tenantId, id, actorId],
  );
  return updated.rows[0];
}

export async function approveBusinessTrip(
  db: PoolClient,
  tenantId: string,
  actorId: string,
  id: string,
) {
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
  for (const day of dates.rows) await assertOpenDate(db, tenantId, day.date);
  return db.query(
    `UPDATE hrm_schema.business_trip_requests SET status='APPROVED',approved_by=$3,approved_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
    [tenantId, id, actorId],
  );
}
export const profileCorrectionFields: Record<string, string> = {
  fullName: 'full_name',
  dateOfBirth: 'date_of_birth',
  gender: 'gender',
  identityCardNumber: 'identity_card_number',
  identityCardIssuedDate: 'identity_card_issued_date',
  identityCardIssuedPlace: 'identity_card_issued_place',
  identityCardExpiryDate: 'identity_card_expiry_date',
  taxCode: 'tax_code',
  socialInsuranceNumber: 'social_insurance_number',
};
export const profileCorrectionValue = (v: unknown) =>
  v instanceof Date ? isoDate(v) : (v ?? null);

export async function approveProfileCorrection(
  db: PoolClient,
  tenantId: string,
  actorId: string,
  id: string,
) {
  const result = await db.query(
    `SELECT * FROM hrm_schema.profile_corrections WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [tenantId, id],
  );
  const correction = result.rows[0];
  if (!correction) throw new NotFoundException('Không tìm thấy đơn');
  if (correction.status === 'APPROVED') return { data: correction };
  if (correction.status !== 'PENDING')
    throw new ConflictException('Đơn không còn chờ duyệt');
  await lockEmployee(db, tenantId, correction.employee_id);
  const profile = await db.query(
    `SELECT * FROM hrm_schema.employee_directory WHERE tenant_id=$1 AND employee_id=$2`,
    [tenantId, correction.employee_id],
  );
  for (const [key, v] of Object.entries(correction.changes)) {
    if (!Object.hasOwn(profileCorrectionFields, key))
      throw new BadRequestException('Trường thay đổi không hợp lệ');
    if (
      profileCorrectionValue(profile.rows[0][profileCorrectionFields[key]]) !==
      correction.previous_values[key]
    )
      throw new ConflictException(
        'Hồ sơ đã thay đổi sau khi gửi đơn; cần gửi lại để đối chiếu',
      );
    if (key === 'fullName')
      await db.query(
        `UPDATE core_schema.employees SET full_name=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        [tenantId, correction.employee_id, v],
      );
    else
      await db.query(
        `UPDATE hrm_schema.employee_profiles SET ${profileCorrectionFields[key]}=$3,updated_by=$4,updated_at=now() WHERE tenant_id=$1 AND employee_id=$2`,
        [tenantId, correction.employee_id, v, actorId],
      );
  }
  const documentChanges = parseDocumentChanges(correction.document_changes);
  if (documentChanges.length)
    await applyDocumentChanges(
      db,
      tenantId,
      correction.employee_id,
      actorId,
      documentChanges,
    );
  await db.query(
    `INSERT INTO hrm_schema.audit_log (tenant_id,actor_id,action,entity_id,detail) VALUES ($1,$2,'PROFILE_CORRECTION_APPROVED',$3,$4)`,
    [
      tenantId,
      actorId,
      id,
      JSON.stringify({
        before: correction.previous_values,
        after: correction.changes,
        documentChanges,
      }),
    ],
  );
  return {
    data: (
      await db.query(
        `UPDATE hrm_schema.profile_corrections SET status='APPROVED',approved_by=$3,approved_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [tenantId, id, actorId],
      )
    ).rows[0],
  };
}

export async function approveSalaryAdvance(
  db: PoolClient,
  tenantId: string,
  actorId: string,
  id: string,
  amount?: number,
) {
  if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0))
    throw new BadRequestException('Số tiền duyệt không hợp lệ');
  const row = (
    await db.query(
      'SELECT * FROM hrm_schema.salary_advance_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
      [tenantId, id],
    )
  ).rows[0];
  if (!row) throw new NotFoundException('Không tìm thấy đơn tạm ứng');
  if (row.status === 'APPROVED') {
    if (amount !== undefined && Number(row.approved_amount) !== amount)
      throw new ConflictException('Số tiền đã duyệt khác yêu cầu');
    return row;
  }
  if (
    row.status !== 'PENDING' ||
    (amount ?? Number(row.requested_amount)) > Number(row.requested_amount)
  )
    throw new BadRequestException(
      'Đơn không còn chờ duyệt hoặc số tiền vượt đề nghị',
    );
  await lockEmployee(db, tenantId, row.employee_id);
  return (
    await db.query(
      `UPDATE hrm_schema.salary_advance_requests SET status='APPROVED',approved_amount=COALESCE($4,requested_amount),approved_by=$3,approved_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [tenantId, id, actorId, amount ?? null],
    )
  ).rows[0];
}

/** One domain transition for direct approval and the durable Procedure inbox. Caller owns the transaction. */
export async function applyHrmRequestResult(
  db: PoolClient,
  ref: HrmRequestRef,
  target: HrmTerminalStatus,
  actorId: string,
  reason?: string,
): Promise<void> {
  const kind = normalizeHrmRequestKind(ref.kind),
    table = HRM_REQUEST_TABLES[kind];
  const row = (
    await db.query(
      `SELECT * FROM hrm_schema.${table} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [ref.tenantId, ref.requestId],
    )
  ).rows[0];
  if (!row) throw new NotFoundException('Không tìm thấy đơn');
  if (Number(row.revision ?? 1) !== ref.revision)
    throw new ConflictException('Phiên bản đơn đã thay đổi');
  if (row.status === target) return;
  if (!['PENDING', 'PEER_CONFIRMED'].includes(row.status))
    throw new ConflictException('Đơn không còn chờ duyệt');
  if (kind === 'leave') {
    await transitionLeave(
      db,
      ref.tenantId,
      actorId,
      ref.requestId,
      target,
      reason,
    );
    return;
  }
  if (target === 'APPROVED') {
    switch (kind) {
      case 'ot':
        await approveOvertime(db, ref.tenantId, actorId, ref.requestId);
        return;
      case 'shift_change':
        await approveShiftChange(db, ref.tenantId, actorId, ref.requestId);
        return;
      case 'business_trip':
        await approveBusinessTrip(db, ref.tenantId, actorId, ref.requestId);
        return;
      case 'correction':
        await approveAttendanceCorrection(
          db,
          ref.tenantId,
          actorId,
          ref.requestId,
        );
        return;
      case 'advance':
        await approveSalaryAdvance(db, ref.tenantId, actorId, ref.requestId);
        return;
      case 'profile_correction':
        await approveProfileCorrection(
          db,
          ref.tenantId,
          actorId,
          ref.requestId,
        );
        return;
    }
  }
  await lockEmployee(db, ref.tenantId, row.employee_id);
  if (['ot', 'shift_change', 'business_trip', 'correction'].includes(kind)) {
    const from = isoDate(row.work_date || row.from_date || row.request_date),
      to = isoDate(row.to_date || row.work_date || row.request_date);
    await assertOpenRange(db, ref.tenantId, from, to);
  }
  const updatedAt = kind === 'profile_correction' ? '' : ',updated_at=now()';
  await db.query(
    `UPDATE hrm_schema.${table} SET status=$3,approved_by=$4,approved_at=now()${updatedAt} WHERE tenant_id=$1 AND id=$2`,
    [ref.tenantId, ref.requestId, target, actorId],
  );
}
