import { ConflictException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { addDays, enumerateDates, localHm, zonedMs } from './hrm-timesheet-board.js';

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

const DEFAULT_TIME_ZONE = 'Asia/Ho_Chi_Minh';

/**
 * Khoảng giờ bận của đơn công tác theo TỪNG NGÀY: mỗi ngày từ giờ bắt đầu đến giờ kết thúc ghi trên đơn
 * (không tính cả đêm giữa hai ngày công tác). Trả về null khi đơn không có giờ cụ thể: khi đó cả ngày đều bận.
 */
export function tripBusyWindows(
  trip: { from_date: string; to_date: string; from_at?: string | null; to_at?: string | null },
  timeZone: string = DEFAULT_TIME_ZONE,
): { date: string; from: number; to: number }[] | null {
  const startHm = localHm(trip.from_at ?? null, timeZone);
  const endHm = localHm(trip.to_at ?? null, timeZone);
  if (!startHm || !endHm) return null;
  return enumerateDates(trip.from_date, trip.to_date).map((date) => {
    const from = zonedMs(date, startHm, timeZone);
    const to = zonedMs(endHm > startHm ? date : addDays(date, 1), endHm, timeZone);
    return { date, from, to };
  });
}

export interface OverlapOptions {
  timeZone?: string;
}

/**
 * Công tác có chặn OT không. Công tác nhiều ngày chỉ bận trong khoảng giờ của đơn ở từng ngày; đơn thiếu giờ cụ thể
 * (hoặc OT thiếu giờ) thì mọi ngày chung đều bận. Không có ngày miễn trừ: Chủ nhật hay ngày nghỉ cũng không được trùng giờ.
 */
export function tripBlocksOt(
  trip: { from_date: string; to_date: string; from_at?: string | null; to_at?: string | null },
  ot: { fromDate: string; toDate: string; from: number; to: number },
  options: OverlapOptions = {},
): boolean {
  const busy = tripBusyWindows(trip, options.timeZone);
  let dates: string[];
  if (busy && Number.isFinite(ot.from) && Number.isFinite(ot.to)) {
    const hit = busy.filter((w) => windowsOverlap(w, { from: ot.from, to: ot.to }));
    if (!hit.length) return false;
    dates = hit.map((w) => w.date);
  } else {
    const from = trip.from_date > ot.fromDate ? trip.from_date : ot.fromDate;
    const to = trip.to_date < ot.toDate ? trip.to_date : ot.toDate;
    dates = from <= to ? enumerateDates(from, to) : [];
  }
  return dates.length > 0;
}

export const windowsOverlap = (a: { from: number; to: number }, b: { from: number; to: number }) =>
  a.from < b.to && b.from < a.to;

const vnDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * Nghỉ phép, công tác và làm thêm giờ đều tác động bảng công / lương: một nhân viên không được
 * có hai đơn thuộc ba loại này chồng ngày khi đơn kia còn chờ duyệt hoặc đã duyệt.
 *
 * - Nghỉ phép <-> nghỉ phép, công tác, OT: luôn chặn.
 * - Công tác <-> công tác, nghỉ: chặn.
 * - Công tác <-> OT: được phép cùng ngày nếu khác giờ. Trùng giờ luôn bị chặn, kể cả Chủ nhật hay ngày nghỉ. Công tác nhiều ngày chỉ bận trong khoảng giờ của đơn ở từng ngày
 *   (xem `tripBusyWindows`), nên OT ngoài khoảng giờ đó (ví dụ buổi tối) vẫn được nhận; trùng giờ thì chặn. Đơn thiếu
 *   giờ cụ thể ở một trong hai bên thì cả ngày công tác đều bận. Trường `allow_ot` không còn miễn trừ.
 * - OT <-> OT cùng ngày do kiểm tra trùng giờ ở `validateOt` đảm nhiệm (nhiều đơn OT một ngày được phép).
 * - Khi đơn mới và đơn cũ ĐỀU có giờ cụ thể (`fromAt`/`toAt`) thì chỉ chặn khi hai khoảng giờ thực sự chồng nhau
 *   (nghỉ sáng và nghỉ chiều cùng ngày không chồng); thiếu giờ ở một trong hai bên thì giữ quy tắc theo ngày.
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
    /** Mốc tuyệt đối (ISO) của đơn mới khi đơn có giờ cụ thể. */
    fromAt?: string | null;
    toAt?: string | null;
  },
  options: OverlapOptions = {},
): Promise<void> {
  const newFrom = input.fromAt ? Date.parse(input.fromAt) : NaN;
  const newTo = input.toAt ? Date.parse(input.toAt) : NaN;
  const found = await db.query(
    // from_at/to_at đọc qua to_jsonb để truy vấn vẫn chạy trên tenant chưa có migration 0047.
    `SELECT kind, from_date, to_date, status, allow_ot, from_at, to_at FROM (
       SELECT 'leave' AS kind, to_char(from_date,'YYYY-MM-DD') AS from_date, to_char(to_date,'YYYY-MM-DD') AS to_date, status, false AS allow_ot,
              to_jsonb(lr)->>'from_at' AS from_at, to_jsonb(lr)->>'to_at' AS to_at
         FROM hrm_schema.leave_requests lr
        WHERE tenant_id=$1 AND employee_id=$2 AND status IN ('PENDING','APPROVED')
          AND daterange(from_date,to_date,'[]') && daterange($3::date,$4::date,'[]')
       UNION ALL
       SELECT 'business_trip', to_char(from_date,'YYYY-MM-DD'), to_char(to_date,'YYYY-MM-DD'), status, COALESCE(allow_ot,false),
              to_jsonb(bt)->>'from_at', to_jsonb(bt)->>'to_at'
         FROM hrm_schema.business_trip_requests bt
        WHERE tenant_id=$1 AND employee_id=$2 AND status IN ('PENDING','APPROVED')
          AND daterange(from_date,to_date,'[]') && daterange($3::date,$4::date,'[]')
       UNION ALL
       SELECT 'ot', to_char(work_date,'YYYY-MM-DD'),
              to_char(work_date + CASE WHEN end_time<=start_time THEN 1 ELSE 0 END,'YYYY-MM-DD'), status, false,
              to_jsonb(ot)->>'from_at', to_jsonb(ot)->>'to_at'
         FROM hrm_schema.ot_requests ot
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
    from_at?: string | null;
    to_at?: string | null;
  }[]) {
    // OT với OT: do kiểm tra trùng giờ lo.
    if (input.kind === 'ot' && row.kind === 'ot') continue;
    // OT và công tác: so khoảng giờ OT với giờ bận của công tác ở từng ngày (không dùng khoảng liên tục nhiều ngày).
    if (
      (input.kind === 'ot' && row.kind === 'business_trip') ||
      (input.kind === 'business_trip' && row.kind === 'ot')
    ) {
      const otRow = input.kind === 'ot'
        ? { fromDate: input.fromDate, toDate: input.toDate, from: newFrom, to: newTo }
        : {
            fromDate: row.from_date,
            toDate: row.to_date,
            from: row.from_at ? Date.parse(row.from_at) : NaN,
            to: row.to_at ? Date.parse(row.to_at) : NaN,
          };
      const trip =
        input.kind === 'business_trip'
          ? { from_date: input.fromDate, to_date: input.toDate, from_at: input.fromAt, to_at: input.toAt }
          : row;
      if (!tripBlocksOt(trip, otRow, options)) continue;
    } else {
      // Cả hai đơn đều có giờ cụ thể: chỉ chặn khi hai khoảng giờ chồng nhau.
      const oldFrom = row.from_at ? Date.parse(row.from_at) : NaN;
      const oldTo = row.to_at ? Date.parse(row.to_at) : NaN;
      if (
        Number.isFinite(newFrom) &&
        Number.isFinite(newTo) &&
        Number.isFinite(oldFrom) &&
        Number.isFinite(oldTo) &&
        !(oldFrom < newTo && newFrom < oldTo)
      )
        continue;
    }
    const range =
      row.from_date === row.to_date
        ? vnDate(row.from_date)
        : `${vnDate(row.from_date)} - ${vnDate(row.to_date)}`;
    throw new ConflictException(
      `Đã có đơn ${KIND_LABEL[row.kind]} ${STATUS_LABEL[row.status] ?? row.status.toLowerCase()} (${range}) trùng với đơn ${KIND_LABEL[input.kind]} này; nghỉ phép, công tác và làm thêm giờ ảnh hưởng bảng lương nên không được chồng ngày`,
    );
  }
}
