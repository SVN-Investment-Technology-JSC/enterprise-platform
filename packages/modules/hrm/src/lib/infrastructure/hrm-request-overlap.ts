import { ConflictException } from '@nestjs/common';
import type { PoolClient } from 'pg';

export type OverlapRequestKind = 'leave' | 'business_trip' | 'ot';

const KIND_LABEL: Record<OverlapRequestKind, string> = {
  leave: 'nghỉ phép',
  business_trip: 'công tác',
  ot: 'làm thêm giờ',
};
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'đang chờ duyệt',
  APPROVED: 'đã duyệt',
};

const vnDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * Nghỉ phép, công tác và làm thêm giờ đều tác động bảng công / lương: một nhân viên không được
 * có hai đơn thuộc ba loại này chồng ngày khi đơn kia còn chờ duyệt hoặc đã duyệt.
 *
 * - Nghỉ phép <-> nghỉ phép, công tác, OT: luôn chặn.
 * - Công tác <-> công tác, nghỉ, OT: chặn. Trường `allow_ot` (đã ẩn khỏi giao diện) tạm không còn
 *   miễn trừ: OT và công tác chồng ngày luôn bị chặn.
 * - OT <-> OT cùng ngày do kiểm tra trùng giờ ở `validateOt` đảm nhiệm (nhiều đơn OT một ngày được phép).
 * Gọi trong giao dịch đã khóa nhân viên.
 */
export async function assertNoRequestOverlap(
  db: Pick<PoolClient, 'query'>,
  tenant: string,
  employeeId: string,
  input: {
    kind: OverlapRequestKind;
    fromDate: string;
    toDate: string;
  },
): Promise<void> {
  const found = await db.query(
    `SELECT kind, from_date, to_date, status, allow_ot FROM (
       SELECT 'leave' AS kind, to_char(from_date,'YYYY-MM-DD') AS from_date, to_char(to_date,'YYYY-MM-DD') AS to_date, status, false AS allow_ot
         FROM hrm_schema.leave_requests
        WHERE tenant_id=$1 AND employee_id=$2 AND status IN ('PENDING','APPROVED')
          AND daterange(from_date,to_date,'[]') && daterange($3::date,$4::date,'[]')
       UNION ALL
       SELECT 'business_trip', to_char(from_date,'YYYY-MM-DD'), to_char(to_date,'YYYY-MM-DD'), status, COALESCE(allow_ot,false)
         FROM hrm_schema.business_trip_requests
        WHERE tenant_id=$1 AND employee_id=$2 AND status IN ('PENDING','APPROVED')
          AND daterange(from_date,to_date,'[]') && daterange($3::date,$4::date,'[]')
       UNION ALL
       SELECT 'ot', to_char(work_date,'YYYY-MM-DD'),
              to_char(work_date + CASE WHEN end_time<=start_time THEN 1 ELSE 0 END,'YYYY-MM-DD'), status, false
         FROM hrm_schema.ot_requests
        WHERE tenant_id=$1 AND employee_id=$2 AND status IN ('PENDING','APPROVED')
          AND daterange(work_date, work_date + CASE WHEN end_time<=start_time THEN 2 ELSE 1 END,'[)')
              && daterange($3::date,$4::date + 1,'[)')
     ) r ORDER BY from_date`,
    [tenant, employeeId, input.fromDate, input.toDate],
  );
  for (const row of found.rows as {
    kind: OverlapRequestKind;
    from_date: string;
    to_date: string;
    status: string;
    allow_ot: boolean;
  }[]) {
    // OT với OT: do kiểm tra trùng giờ lo.
    if (input.kind === 'ot' && row.kind === 'ot') continue;
    const range =
      row.from_date === row.to_date
        ? vnDate(row.from_date)
        : `${vnDate(row.from_date)} - ${vnDate(row.to_date)}`;
    throw new ConflictException(
      `Đã có đơn ${KIND_LABEL[row.kind]} ${STATUS_LABEL[row.status] ?? row.status.toLowerCase()} (${range}) trùng với đơn ${KIND_LABEL[input.kind]} này; nghỉ phép, công tác và làm thêm giờ ảnh hưởng bảng lương nên không được chồng ngày`,
    );
  }
}
