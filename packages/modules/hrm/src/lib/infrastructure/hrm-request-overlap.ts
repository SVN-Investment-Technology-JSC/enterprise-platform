import { BadRequestException, ConflictException } from '@nestjs/common';
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
 * Giờ bắt đầu / kết thúc của đơn nghỉ phép hoặc công tác, chuẩn hoá về `HH:mm`. Bỏ trống = cả ngày.
 * Ném 400 khi sai định dạng, hoặc đơn trong một ngày có giờ kết thúc không sau giờ bắt đầu.
 */
export function requestTimeWindow(body: {
  fromDate: string;
  toDate: string;
  startTime?: unknown;
  endTime?: unknown;
}): { startTime: string | null; endTime: string | null } {
  const norm = (value: unknown, label: string): string | null => {
    if (value === undefined || value === null || value === '') return null;
    const text = String(value);
    if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(text))
      throw new BadRequestException(`${label} không hợp lệ`);
    return text.slice(0, 5);
  };
  const startTime = norm(body.startTime, 'Giờ bắt đầu');
  const endTime = norm(body.endTime, 'Giờ kết thúc');
  if (startTime && endTime && body.fromDate === body.toDate && endTime <= startTime)
    throw new BadRequestException('Giờ kết thúc phải sau giờ bắt đầu');
  return { startTime, endTime };
}

/** Khoảng thời gian của một đơn, dạng `YYYY-MM-DDTHH:mm` (đầu mút phải mở). */
function describeWindow(start: string, end: string, hasTimes: boolean): string {
  const startDate = start.slice(0, 10);
  const endMoment = new Date(end + ':00Z');
  // Đơn cả ngày được lưu đến 00:00 ngày kế: hiển thị ngày cuối là ngày liền trước.
  const endDate = hasTimes ? end.slice(0, 10) : new Date(endMoment.getTime() - 60000).toISOString().slice(0, 10);
  const startTime = start.slice(11, 16);
  const endTime = end.slice(11, 16);
  if (!hasTimes) return startDate === endDate ? vnDate(startDate) : `${vnDate(startDate)} - ${vnDate(endDate)}`;
  return startDate === endDate
    ? `${vnDate(startDate)} ${startTime} - ${endTime}`
    : `${vnDate(startDate)} ${startTime} - ${vnDate(endDate)} ${endTime}`;
}

/**
 * Nghỉ phép, công tác và làm thêm giờ đều tác động bảng công / lương: một nhân viên không được
 * có hai đơn thuộc ba loại này chồng NHAU VỀ THỜI GIAN khi đơn kia còn chờ duyệt hoặc đã duyệt.
 *
 * Chốt chặn xét theo GIỜ trong cùng ngày, không chỉ theo ngày: nghỉ buổi sáng và OT buổi tối cùng
 * một ngày không chồng nhau nên cùng được gửi. Đơn nghỉ phép / công tác trải nhiều ngày chiếm cả khoảng liên tục
 * từ giờ bắt đầu ngày đầu đến giờ kết thúc ngày cuối. Đơn không có giờ (đơn cũ hoặc client không gửi)
 * chiếm cả ngày, như cách xét theo ngày trước đây.
 *
 * - Nghỉ phép <-> nghỉ phép, công tác, OT: chặn khi giờ chồng nhau.
 * - Công tác <-> công tác, nghỉ, OT: chặn khi giờ chồng nhau. Trường `allow_ot` (đã ẩn khỏi giao diện) không còn
 *   miễn trừ.
 * - OT <-> OT cùng ngày do kiểm tra trùng giờ ở `validateOt` đảm nhiệm (nhiều đơn OT một ngày được phép).
 * Gọi trong giao dịch đã khóa nhân viên.
 */
export async function assertNoRequestOverlap(
  db: Pick<PoolClient, 'query'>,
  tenant: string,
  employeeId: string,
  input: {
    kind: OverlapRequestKind;
    /** Ngày bắt đầu (đơn OT: ngày làm việc). */
    fromDate: string;
    /** Ngày kết thúc (đơn OT qua nửa đêm: ngày kế tiếp). */
    toDate: string;
    /** Giờ bắt đầu ở ngày đầu, `HH:mm`; bỏ trống = từ đầu ngày. */
    startTime?: string | null;
    /** Giờ kết thúc ở ngày cuối, `HH:mm`; bỏ trống = hết ngày. */
    endTime?: string | null;
  },
): Promise<void> {
  const startTime = input.startTime || null;
  const endTime = input.endTime || null;
  const found = await db.query(
    `SELECT kind, status, has_times, allow_ot,
            to_char(s,'YYYY-MM-DD"T"HH24:MI') AS s, to_char(e,'YYYY-MM-DD"T"HH24:MI') AS e
       FROM (
       SELECT 'leave' AS kind, status, (start_time IS NOT NULL OR end_time IS NOT NULL) AS has_times, false AS allow_ot,
              from_date + COALESCE(start_time, '00:00'::time) AS s,
              CASE WHEN end_time IS NULL THEN (to_date + 1)::timestamp ELSE to_date + end_time END AS e
         FROM hrm_schema.leave_requests
        WHERE tenant_id=$1 AND employee_id=$2 AND status IN ('PENDING','APPROVED')
       UNION ALL
       SELECT 'business_trip', status, (start_time IS NOT NULL OR end_time IS NOT NULL), COALESCE(allow_ot,false),
              from_date + COALESCE(start_time, '00:00'::time),
              CASE WHEN end_time IS NULL THEN (to_date + 1)::timestamp ELSE to_date + end_time END
         FROM hrm_schema.business_trip_requests
        WHERE tenant_id=$1 AND employee_id=$2 AND status IN ('PENDING','APPROVED')
       UNION ALL
       SELECT 'ot', status, true, false,
              work_date + start_time,
              work_date + end_time + CASE WHEN end_time<=start_time THEN interval '1 day' ELSE interval '0 day' END
         FROM hrm_schema.ot_requests
        WHERE tenant_id=$1 AND employee_id=$2 AND status IN ('PENDING','APPROVED')
     ) r
     WHERE r.s < r.e
       AND tsrange(r.s, r.e, '[)') && tsrange(
             $3::date + COALESCE($5::time, '00:00'::time),
             CASE WHEN $6::time IS NULL THEN ($4::date + 1)::timestamp ELSE $4::date + $6::time END,
             '[)')
     ORDER BY s`,
    [tenant, employeeId, input.fromDate, input.toDate, startTime, endTime],
  );
  for (const row of found.rows as {
    kind: OverlapRequestKind;
    status: string;
    has_times: boolean;
    s: string;
    e: string;
  }[]) {
    // OT với OT: do kiểm tra trùng giờ lo.
    if (input.kind === 'ot' && row.kind === 'ot') continue;
    throw new ConflictException(
      `Đã có đơn ${KIND_LABEL[row.kind]} ${STATUS_LABEL[row.status] ?? row.status.toLowerCase()} (${describeWindow(row.s, row.e, row.has_times)}) trùng thời gian với đơn ${KIND_LABEL[input.kind]} này; nghỉ phép, công tác và làm thêm giờ ảnh hưởng bảng lương nên không được chồng giờ`,
    );
  }
}
