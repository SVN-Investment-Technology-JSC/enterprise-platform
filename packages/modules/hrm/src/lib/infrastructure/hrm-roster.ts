import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { requireDate, requireUuid } from './hrm-validation.js';

export async function validateRoster(
  db: PoolClient,
  tenantId: string,
  employeeId: string,
  shiftId: string,
  from: string,
  to: string | null,
  excludingId: string | null = null,
) {
  requireUuid(shiftId, 'shiftId');
  requireDate(from, 'effectiveFrom');
  if (to && requireDate(to, 'effectiveTo') < from)
    throw new BadRequestException('Ngày kết thúc phải từ ngày bắt đầu');
  const shift = (
    await db.query(
      `SELECT * FROM hrm_schema.shift_definitions WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE' FOR SHARE`,
      [tenantId, shiftId],
    )
  ).rows[0];
  if (!shift)
    throw new BadRequestException(
      'Ca không thuộc tenant hoặc đã ngừng sử dụng',
    );
  const employee = (
    await db.query(
      'SELECT join_date,employment_status FROM hrm_schema.employee_profiles WHERE tenant_id=$1 AND employee_id=$2',
      [tenantId, employeeId],
    )
  ).rows[0];
  if (!employee) throw new NotFoundException('Không tìm thấy nhân viên');
  if (['RESIGNED', 'TERMINATED'].includes(employee.employment_status))
    throw new BadRequestException('Nhân viên đã ngừng hoạt động');
  const overlaps = await db.query(
    `SELECT a.id FROM hrm_schema.shift_assignments a
    JOIN hrm_schema.shift_definitions s ON s.id=a.shift_id AND s.tenant_id=a.tenant_id
    WHERE a.tenant_id=$1 AND a.employee_id=$2 AND a.status='ACTIVE' AND ($8::uuid IS NULL OR a.id<>$8)
    AND (daterange(a.effective_from,COALESCE(a.effective_to,'infinity'::date),'[]') && daterange($3::date,COALESCE($4::date,'infinity'::date),'[]')
    OR (s.cross_midnight AND a.effective_to=$3::date-1 AND s.end_time>$5::time)
    OR ($6::boolean AND a.effective_from=$4::date+1 AND s.start_time<$7::time))`,
    [
      tenantId,
      employeeId,
      from,
      to,
      shift.start_time,
      shift.cross_midnight,
      shift.end_time,
      excludingId,
    ],
  );
  if (overlaps.rowCount)
    throw new BadRequestException({
      code: 'HRM_SHIFT_ASSIGNMENT_OVERLAP',
      message: 'Lịch phân ca trùng ngày hoặc chồng giờ với ca đêm liền kề.',
    });
}
