import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { isoDate } from './hrm-time.js';
import { requireDate } from './hrm-validation.js';

type Db = Pick<PoolClient, 'query'>;

/**
 * Công tác phí: mức tiền cho MỘT ngày công tác, theo hình thức công tác (nội địa, quốc tế, liên điểm), có phiên bản theo
 * ngày hiệu lực. Tiền được tính khi tính công (calculateTimesheet) theo ngày thực tế của đơn công tác đã duyệt và được
 * đóng băng trong dòng công của kỳ chốt; bảng lương chỉ cộng lại, không tự suy ra mức.
 * Dự trù phụ phí (vé, khách sạn) nhập trong đơn công tác chỉ là dự trù, không phải khoản trả.
 */
export const TRIP_TYPES = ['DOMESTIC', 'OVERSEAS', 'INTERSITE'] as const;
export type TripType = (typeof TRIP_TYPES)[number];

export interface TripAllowanceRate {
  id: string;
  tripType: TripType;
  dailyAmount: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: 'ACTIVE' | 'CANCELLED';
  note: string | null;
  createdAt: string;
}

const MAX_DAILY_AMOUNT = 1_000_000_000;

export function mapRate(row: Record<string, unknown>): TripAllowanceRate {
  return {
    id: row.id as string,
    tripType: row.trip_type as TripType,
    dailyAmount: Number(row.daily_amount),
    effectiveFrom: isoDate(row.effective_from),
    effectiveTo: row.effective_to ? isoDate(row.effective_to) : null,
    status: row.status as 'ACTIVE' | 'CANCELLED',
    note: (row.note as string | null) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

export async function listTripAllowanceRates(db: Db, tenant: string): Promise<TripAllowanceRate[]> {
  const res = await db.query(
    `SELECT * FROM hrm_schema.business_trip_allowance_rates WHERE tenant_id=$1 ORDER BY trip_type, effective_from DESC, created_at DESC`,
    [tenant],
  );
  return res.rows.map(mapRate);
}

/** Mức hiệu lực của hình thức công tác tại một ngày; không có mức thì null (không tự bịa mức). */
export function rateFor(
  rates: readonly Pick<TripAllowanceRate, 'tripType' | 'dailyAmount' | 'effectiveFrom' | 'effectiveTo'>[],
  tripType: string,
  date: string,
): number | null {
  const hit = rates.find(
    (r) => r.tripType === tripType && r.effectiveFrom <= date && (!r.effectiveTo || r.effectiveTo >= date),
  );
  return hit ? hit.dailyAmount : null;
}

/** Các mức đang hiệu lực (dùng khi tính công cả kỳ). */
export async function loadActiveRates(db: Db, tenant: string): Promise<TripAllowanceRate[]> {
  const res = await db.query(
    `SELECT * FROM hrm_schema.business_trip_allowance_rates WHERE tenant_id=$1 AND status='ACTIVE'`,
    [tenant],
  );
  return res.rows.map(mapRate);
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/**
 * Thêm phiên bản mức công tác phí từ một ngày. Phiên bản đang mở của cùng hình thức được kết thúc vào ngày trước đó;
 * không cho thêm phiên bản bắt đầu trước hoặc trùng phiên bản đã có (tạo phiên bản mới từ ngày sau cùng).
 */
export async function createTripAllowanceRate(
  db: PoolClient,
  tenant: string,
  actorId: string,
  body: { tripType?: unknown; dailyAmount?: unknown; effectiveFrom?: unknown; note?: unknown },
): Promise<TripAllowanceRate> {
  if (!TRIP_TYPES.includes(body.tripType as TripType))
    throw new BadRequestException('Hình thức công tác không hợp lệ (nội địa, quốc tế hoặc liên điểm)');
  const amount = Number(body.dailyAmount);
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_DAILY_AMOUNT)
    throw new BadRequestException('Mức công tác phí mỗi ngày không hợp lệ');
  const from = requireDate(body.effectiveFrom, 'Ngày hiệu lực');
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`trip-allowance:${tenant}:${body.tripType}`]);
  const latest = await db.query(
    `SELECT * FROM hrm_schema.business_trip_allowance_rates WHERE tenant_id=$1 AND trip_type=$2 AND status='ACTIVE' ORDER BY effective_from DESC LIMIT 1 FOR UPDATE`,
    [tenant, body.tripType],
  );
  const last = latest.rows[0];
  if (last && isoDate(last.effective_from) >= from)
    throw new ConflictException(
      `Đã có mức công tác phí hiệu lực từ ${isoDate(last.effective_from)}; chọn ngày hiệu lực sau ngày đó hoặc huỷ phiên bản gần nhất.`,
    );
  if (last && (!last.effective_to || isoDate(last.effective_to) >= from))
    await db.query(
      `UPDATE hrm_schema.business_trip_allowance_rates SET effective_to=$2::date, updated_at=now() WHERE id=$1`,
      [last.id, addDays(from, -1)],
    );
  const created = await db.query(
    `INSERT INTO hrm_schema.business_trip_allowance_rates (tenant_id,trip_type,daily_amount,effective_from,note,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [tenant, body.tripType, amount, from, note, actorId],
  );
  await db.query(
    `INSERT INTO hrm_schema.audit_log (tenant_id,actor_id,action,entity_id,detail) VALUES ($1,$2,'TRIP_ALLOWANCE_RATE_CREATED',$3,$4)`,
    [tenant, actorId, created.rows[0].id, JSON.stringify({ tripType: body.tripType, amount, from, previousId: last?.id ?? null })],
  );
  return mapRate(created.rows[0]);
}

/** Huỷ phiên bản gần nhất của hình thức (không xoá cứng); phiên bản trước đó được mở lại đến ngày kết thúc cũ của nó. */
export async function cancelTripAllowanceRate(
  db: PoolClient,
  tenant: string,
  actorId: string,
  id: string,
): Promise<void> {
  const found = await db.query(
    `SELECT * FROM hrm_schema.business_trip_allowance_rates WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [tenant, id],
  );
  const row = found.rows[0];
  if (!row) throw new NotFoundException('Không tìm thấy mức công tác phí');
  if (row.status === 'CANCELLED') throw new ConflictException('Mức công tác phí đã được huỷ');
  const newer = await db.query(
    `SELECT 1 FROM hrm_schema.business_trip_allowance_rates WHERE tenant_id=$1 AND trip_type=$2 AND status='ACTIVE' AND effective_from > $3::date LIMIT 1`,
    [tenant, row.trip_type, row.effective_from],
  );
  if (newer.rowCount) throw new ConflictException('Chỉ huỷ được phiên bản gần nhất của hình thức công tác này');
  await db.query(`UPDATE hrm_schema.business_trip_allowance_rates SET status='CANCELLED', updated_at=now() WHERE id=$1`, [id]);
  // Phiên bản liền trước từng bị kết thúc vào ngày trước phiên bản này: mở lại như cũ.
  await db.query(
    `UPDATE hrm_schema.business_trip_allowance_rates SET effective_to=$4::date, updated_at=now()
      WHERE tenant_id=$1 AND trip_type=$2 AND status='ACTIVE' AND effective_to = ($3::date - 1)`,
    [tenant, row.trip_type, row.effective_from, row.effective_to ?? null],
  );
  await db.query(
    `INSERT INTO hrm_schema.audit_log (tenant_id,actor_id,action,entity_id,detail) VALUES ($1,$2,'TRIP_ALLOWANCE_RATE_CANCELLED',$3,$4)`,
    [tenant, actorId, id, JSON.stringify({ before: row })],
  );
}

export interface DayTripAllowance {
  requestId: string;
  tripType: string;
  /** Tỷ lệ ca được công tác bao phủ (1 = cả ngày). */
  ratio: number;
  rate: number | null;
  amount: number;
}

/** Công tác phí của một ngày: mức theo hình thức nhân tỷ lệ phần ca đã công tác; chưa có mức thì amount = 0 và rate = null. */
export function dayTripAllowance(
  rates: readonly Pick<TripAllowanceRate, 'tripType' | 'dailyAmount' | 'effectiveFrom' | 'effectiveTo'>[],
  date: string,
  scheduledMinutes: number,
  trips: readonly { requestId: string; tripType: string; coveredMinutes: number }[],
): DayTripAllowance[] {
  if (scheduledMinutes <= 0) return [];
  return trips.map((t) => {
    const ratio = Math.min(1, Math.round((t.coveredMinutes / scheduledMinutes) * 10000) / 10000);
    const rate = rateFor(rates, t.tripType, date);
    return {
      requestId: t.requestId,
      tripType: t.tripType,
      ratio,
      rate,
      amount: rate == null ? 0 : Math.round(rate * ratio),
    };
  });
}
