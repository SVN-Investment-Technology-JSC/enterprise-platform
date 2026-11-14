/**
 * Quy tắc thuần của sổ quỹ nghỉ bù (`hrm_schema.comp_off_ledger`, chỉ thêm dòng). Không đụng DB.
 *
 * Số dư tính từ các dòng sổ theo từng lô (`lot_id`): ACCRUAL mở lô; RESERVE, USAGE, EXPIRE trừ; RELEASE cộng lại;
 * ADJUST theo dấu. Khi đơn được duyệt, giữ chỗ chuyển thành đã dùng bằng cặp RELEASE (+) và USAGE (−) cùng giao dịch.
 * Mọi phép tính ngày dùng số nguyên theo phần mười ngày để tránh sai số số thực.
 */

export type LedgerKind = 'ACCRUAL' | 'RESERVE' | 'USAGE' | 'RELEASE' | 'ADJUST' | 'EXPIRE';

export interface LedgerRow {
  readonly kind: LedgerKind;
  /** Dương cộng quỹ, âm trừ quỹ (đã có dấu như trong sổ). */
  readonly days: number;
  readonly lotId: string;
  /** Hạn dùng của lô (chỉ dòng mở lô mang giá trị); null là không hạn. */
  readonly expiresOn?: string | null;
  readonly occurredOn?: string;
  readonly requestId?: string | null;
}

export interface LotBalance {
  readonly lotId: string;
  readonly expiresOn: string | null;
  /** Ngày phát sinh của dòng mở lô, dùng để xếp thứ tự khi cùng hạn. */
  readonly openedOn: string;
  /** Tổng ngày đã cộng vào lô (ACCRUAL và ADJUST dương mở lô). */
  readonly granted: number;
  /** Số còn lại của lô sau mọi giao dịch (kể cả giữ chỗ). */
  readonly remaining: number;
}

const tenths = (days: number) => Math.round(days * 10);
const fromTenths = (t: number) => t / 10 + 0; // +0 đổi -0 thành 0

/** Làm tròn về một chữ số thập phân (đúng cột `numeric(6,1)` của sổ). */
export function roundLedgerDays(days: number): number {
  return fromTenths(tenths(days));
}

/**
 * Số dư từng lô. Một lô chỉ tồn tại khi có dòng mở lô (ACCRUAL, hoặc ADJUST dương có `lotId` chính nó); dòng của lô
 * không rõ nguồn vẫn được giữ để lộ ra số âm thay vì biến mất.
 */
export function lotBalances(rows: readonly LedgerRow[]): LotBalance[] {
  const lots = new Map<string, { expiresOn: string | null; openedOn: string; granted: number; remaining: number }>();
  for (const row of rows) {
    const lot = lots.get(row.lotId) ?? { expiresOn: null, openedOn: row.occurredOn ?? '', granted: 0, remaining: 0 };
    // ADJUST dương luôn mở một lô mới của chính nó (lot_id = id dòng); ADJUST âm trừ vào lô đã có.
    const opens = row.kind === 'ACCRUAL' || (row.kind === 'ADJUST' && row.days > 0);
    if (opens) {
      lot.expiresOn = row.expiresOn ?? null;
      lot.openedOn = row.occurredOn ?? lot.openedOn;
      lot.granted += tenths(row.days);
    }
    lot.remaining += tenths(row.days);
    lots.set(row.lotId, lot);
  }
  return [...lots.entries()].map(([lotId, l]) => ({
    lotId,
    expiresOn: l.expiresOn,
    openedOn: l.openedOn,
    granted: fromTenths(l.granted),
    remaining: fromTenths(l.remaining),
  }));
}

/** Lô còn dùng được tại `asOf` (YYYY-MM-DD): chưa hết hạn và còn số dư dương. */
export function usableLots(lots: readonly LotBalance[], asOf: string): LotBalance[] {
  return lots.filter((l) => l.remaining > 0 && (l.expiresOn === null || l.expiresOn >= asOf));
}

/** Thứ tự dùng lô: gần hết hạn trước, lô không hạn sau cùng, cùng hạn thì lô cũ trước. */
export function sortLotsForUse(lots: readonly LotBalance[], order: 'EXPIRY_FIRST' | 'OLDEST_FIRST' = 'EXPIRY_FIRST'): LotBalance[] {
  const key = (l: LotBalance) => (order === 'EXPIRY_FIRST' ? (l.expiresOn ?? '9999-12-31') : l.openedOn);
  return [...lots].sort((a, b) => key(a).localeCompare(key(b)) || a.openedOn.localeCompare(b.openedOn) || a.lotId.localeCompare(b.lotId));
}

export interface LotAllocation {
  readonly lotId: string;
  /** Số ngày lấy từ lô, luôn dương. */
  readonly days: number;
}

/**
 * Chia `days` ngày vào các lô dùng được theo thứ tự dùng. Trả null khi tổng khả dụng không đủ (không chia một phần).
 */
export function allocateFromLots(
  lots: readonly LotBalance[],
  days: number,
  asOf: string,
  order: 'EXPIRY_FIRST' | 'OLDEST_FIRST' = 'EXPIRY_FIRST',
): LotAllocation[] | null {
  let need = tenths(days);
  if (need <= 0) return [];
  const out: LotAllocation[] = [];
  for (const lot of sortLotsForUse(usableLots(lots, asOf), order)) {
    if (need <= 0) break;
    const take = Math.min(need, tenths(lot.remaining));
    if (take > 0) {
      out.push({ lotId: lot.lotId, days: fromTenths(take) });
      need -= take;
    }
  }
  return need > 0 ? null : out;
}

/** Tổng ngày khả dụng (đã trừ giữ chỗ) tại `asOf`. */
export function availableDays(lots: readonly LotBalance[], asOf: string): number {
  return fromTenths(usableLots(lots, asOf).reduce((n, l) => n + tenths(l.remaining), 0));
}

export interface RequestLotNet {
  readonly lotId: string;
  /** Số ngày đơn đang chiếm của lô (dương). 0 nghĩa là đã hoàn hết. */
  readonly held: number;
  /** Đã có dòng USAGE cho đơn ở lô này. */
  readonly used: boolean;
}

/**
 * Tình trạng của một đơn nghỉ bù theo từng lô: `held` = −(tổng RESERVE + USAGE + RELEASE của đơn trong lô).
 * Đơn mới gửi có held > 0 và chưa used; đơn đã duyệt có held > 0 và used; đơn đã hoàn có held = 0.
 */
export function requestLotNets(rows: readonly LedgerRow[], requestId: string): RequestLotNet[] {
  const nets = new Map<string, { sum: number; used: boolean }>();
  for (const row of rows) {
    if (row.requestId !== requestId) continue;
    if (row.kind !== 'RESERVE' && row.kind !== 'USAGE' && row.kind !== 'RELEASE') continue;
    const net = nets.get(row.lotId) ?? { sum: 0, used: false };
    net.sum += tenths(row.days);
    if (row.kind === 'USAGE') net.used = true;
    nets.set(row.lotId, net);
  }
  return [...nets.entries()].map(([lotId, n]) => ({ lotId, held: fromTenths(-n.sum), used: n.used }));
}

/** Tháng `YYYY-MM` cộng `offset` tháng. */
export function addMonths(month: string, offset: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + offset;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Ngày phát sinh quỹ: mùng 1 của tháng bảng công (offset 0) hoặc tháng kế tiếp (offset 1). */
export function accrualDate(periodMonth: string, offset: 0 | 1): string {
  return `${addMonths(periodMonth, offset)}-01`;
}

/** Hạn dùng của lô: ngày cuối của tháng thứ `months` kể từ tháng cộng quỹ; 0 là không hạn. */
export function expiryDate(accrualOn: string, months: number): string | null {
  if (!(months > 0)) return null;
  const month = addMonths(accrualOn.slice(0, 7), months);
  const [y, m] = month.split('-').map(Number) as [number, number];
  // Ngày 0 của tháng kế tiếp là ngày cuối của tháng này.
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}

export const accrualKey = (employeeId: string, periodMonth: string) => `accrual:${employeeId}:${periodMonth}`;
export const reserveKey = (requestId: string, lotId: string) => `reserve:${requestId}:${lotId}`;
export const approveReleaseKey = (requestId: string, lotId: string) => `approve-release:${requestId}:${lotId}`;
export const usageKey = (requestId: string, lotId: string) => `usage:${requestId}:${lotId}`;
export const refundKey = (requestId: string, lotId: string, status: string) => `refund:${requestId}:${lotId}:${status}`;
export const expireKey = (lotId: string) => `expire:${lotId}`;

export interface LedgerSummary {
  readonly accrued: number;
  readonly adjusted: number;
  readonly expired: number;
  /** Số ngày của các đơn đã duyệt (đã trừ phần hoàn khi đơn bị hủy sau duyệt). */
  readonly used: number;
  /** Số ngày đang giữ chỗ cho các đơn chưa duyệt. */
  readonly reserved: number;
  /** Còn dùng được ngay tại `asOf`. */
  readonly available: number;
  readonly lots: readonly LotBalance[];
  /** Lô còn số dư có hạn dùng gần nhất. */
  readonly nextExpiry: { readonly days: number; readonly on: string } | null;
}

/** Tổng hợp số dư của một nhân viên từ các dòng sổ của họ. */
export function summarizeLedger(rows: readonly LedgerRow[], asOf: string): LedgerSummary {
  const sum = (kind: LedgerKind) => rows.filter((r) => r.kind === kind).reduce((n, r) => n + tenths(r.days), 0);
  const lots = lotBalances(rows);
  let used = 0;
  let reserved = 0;
  for (const requestId of new Set(rows.map((r) => r.requestId).filter((id): id is string => Boolean(id)))) {
    for (const net of requestLotNets(rows, requestId)) {
      if (net.used) used += tenths(net.held);
      else reserved += tenths(net.held);
    }
  }
  const expiring = usableLots(lots, asOf)
    .filter((l) => l.expiresOn !== null)
    .sort((a, b) => (a.expiresOn as string).localeCompare(b.expiresOn as string))[0];
  return {
    accrued: fromTenths(sum('ACCRUAL')),
    adjusted: fromTenths(sum('ADJUST')),
    expired: fromTenths(-sum('EXPIRE')),
    used: fromTenths(used),
    reserved: fromTenths(reserved),
    available: availableDays(lots, asOf),
    lots,
    nextExpiry: expiring ? { days: expiring.remaining, on: expiring.expiresOn as string } : null,
  };
}
