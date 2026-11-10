import { randomUUID } from 'node:crypto';
import type {
  AdjustHrmCompOffRequest,
  ConfirmHrmCompOffConversionRequest,
  HrmCompOffAvailability,
  HrmCompOffBalanceDetail,
  HrmCompOffBalanceRow,
  HrmCompOffConversionPreview,
  HrmCompOffConversionResult,
  HrmCompOffConversionRow,
  HrmCompOffLedgerEntry,
} from '@enterprise-platform/contracts-hrm';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  accrualDate,
  accrualKey,
  allocateFromLots,
  approveReleaseKey,
  expireKey,
  expiryDate,
  refundKey,
  requestLotNets,
  reserveKey,
  roundLedgerDays,
  summarizeLedger,
  usageKey,
  type LedgerKind,
  type LedgerRow,
} from '../domain/comp-off-ledger.js';
import { validateCompOffUsageDays } from '../domain/overtime-monthly-cap.js';
import { lifecycleAudit } from './hrm-lifecycle.js';
import { loadOvertimeCompPolicy } from './hrm-overtime-blocks.js';
import {
  overtimeMonthFigures,
  readOvertimeCompSnapshot,
  withEmployeeNames,
  type EmployeeOvertimeFigures,
} from './hrm-overtime-month.js';
import { isoDate, lockEmployee } from './hrm-time.js';

type Db = Pick<PoolClient, 'query'>;

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
const monthOf = (date: string) => date.slice(0, 7);
const fmt = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

function rowToLedger(r: Record<string, any>): LedgerRow {
  return {
    kind: r.kind as LedgerKind,
    days: Number(r.days),
    lotId: r.lot_id,
    expiresOn: r.expires_on ? isoDate(r.expires_on) : null,
    occurredOn: r.occurred_on ? isoDate(r.occurred_on) : undefined,
    requestId: r.request_id ?? null,
  };
}

/** Các dòng sổ của một nhân viên (hoặc cả tenant, nhóm theo nhân viên), theo thứ tự thời gian. */
export async function loadLedgerRows(db: Db, tenant: string, employeeId: string): Promise<LedgerRow[]> {
  const res = await db.query(
    `SELECT kind,days,lot_id,expires_on,occurred_on,request_id FROM hrm_schema.comp_off_ledger WHERE tenant_id=$1 AND employee_id=$2 ORDER BY created_at,id`,
    [tenant, employeeId],
  );
  return res.rows.map(rowToLedger);
}

async function loadLedgerByEmployee(db: Db, tenant: string): Promise<Map<string, LedgerRow[]>> {
  const res = await db.query(
    `SELECT employee_id,kind,days,lot_id,expires_on,occurred_on,request_id FROM hrm_schema.comp_off_ledger WHERE tenant_id=$1 ORDER BY created_at,id`,
    [tenant],
  );
  const map = new Map<string, LedgerRow[]>();
  for (const r of res.rows) {
    const list = map.get(r.employee_id) ?? [];
    list.push(rowToLedger(r));
    map.set(r.employee_id, list);
  }
  return map;
}

/**
 * Tạo loại nghỉ "Nghỉ bù" của tenant nếu chưa có: có lương, không trừ phép năm, đánh dấu `comp_off` (số dư lấy từ sổ quỹ).
 * Đã có loại mã COMPENSATORY thì chỉ đánh dấu. Chạy lại được.
 */
export async function ensureCompOffLeaveType(db: Db, tenant: string): Promise<string> {
  const marked = await db.query(
    `SELECT id FROM hrm_schema.leave_types WHERE tenant_id=$1 AND comp_off AND deleted_at IS NULL`,
    [tenant],
  );
  if (marked.rows[0]) return marked.rows[0].id as string;
  const byCode = await db.query(
    `UPDATE hrm_schema.leave_types SET comp_off=true,deduct_balance=false,paid=true,active=true,deleted_at=NULL,updated_at=now() WHERE tenant_id=$1 AND code='COMPENSATORY' RETURNING id`,
    [tenant],
  );
  if (byCode.rows[0]) return byCode.rows[0].id as string;
  const created = await db.query(
    `INSERT INTO hrm_schema.leave_types (tenant_id,code,name,unit,paid,deduct_balance,comp_off,active) VALUES ($1,'COMPENSATORY','Nghỉ bù','DAYS',true,false,true,true) RETURNING id`,
    [tenant],
  );
  return created.rows[0].id as string;
}

/** Loại nghỉ "Nghỉ bù" hiện có (không tạo mới). */
export async function compOffLeaveTypeId(db: Db, tenant: string): Promise<string | null> {
  const res = await db.query(
    `SELECT id FROM hrm_schema.leave_types WHERE tenant_id=$1 AND comp_off AND deleted_at IS NULL AND active`,
    [tenant],
  );
  return (res.rows[0]?.id as string | undefined) ?? null;
}

/** Số dư khả dụng cho form đơn nghỉ của một nhân viên tại một ngày. */
export async function compOffAvailability(
  db: Db,
  tenant: string,
  employeeId: string,
  asOf: string = today(),
): Promise<HrmCompOffAvailability> {
  const { policy } = await loadOvertimeCompPolicy(db, tenant, monthOf(asOf), employeeId);
  const summary = summarizeLedger(await loadLedgerRows(db, tenant, employeeId), asOf);
  return {
    enabled: policy.enabled,
    available: summary.available,
    reserved: summary.reserved,
    usageStepDays: policy.usageStepDays,
    nextExpiry: summary.nextExpiry,
    leaveTypeId: await compOffLeaveTypeId(db, tenant),
  };
}

/**
 * Giữ chỗ số ngày nghỉ bù cho đơn nghỉ mới gửi, lấy từ lô gần hết hạn trước. Gọi trong giao dịch đã khóa nhân viên
 * (`lockEmployee`) để hai đơn đồng thời không dùng chung số dư. Gọi lại với cùng đơn không ghi thêm dòng.
 */
export async function reserveCompOff(
  db: Db,
  tenant: string,
  actor: string,
  input: { employeeId: string; requestId: string; days: number; usageDate: string },
): Promise<void> {
  const { policy } = await loadOvertimeCompPolicy(db, tenant, monthOf(input.usageDate), input.employeeId);
  if (!policy.enabled)
    throw new BadRequestException('Quy tắc làm thêm và nghỉ bù chưa được bật nên chưa thể tạo đơn nghỉ bù');
  const invalid = validateCompOffUsageDays(input.days, policy.usageStepDays);
  if (invalid) throw new BadRequestException(invalid);
  const rows = await loadLedgerRows(db, tenant, input.employeeId);
  const summary = summarizeLedger(rows, input.usageDate);
  const allocation = allocateFromLots(summary.lots, input.days, input.usageDate);
  if (!allocation)
    throw new BadRequestException(
      `Quỹ nghỉ bù không đủ: còn ${fmt(summary.available)} ngày khả dụng (đang giữ chỗ ${fmt(summary.reserved)} ngày), đơn này ${fmt(input.days)} ngày`,
    );
  for (const part of allocation)
    await db.query(
      `INSERT INTO hrm_schema.comp_off_ledger (tenant_id,employee_id,kind,days,occurred_on,lot_id,request_id,idempotency_key,created_by)
       VALUES ($1,$2,'RESERVE',$3,$4::date,$5,$6,$7,$8) ON CONFLICT (tenant_id,idempotency_key) DO NOTHING`,
      [tenant, input.employeeId, -part.days, today(), part.lotId, input.requestId, reserveKey(input.requestId, part.lotId), actor],
    );
}

/**
 * Cập nhật sổ quỹ theo kết quả của đơn nghỉ bù. Duyệt: giữ chỗ thành đã dùng (RELEASE và USAGE cùng giao dịch).
 * Từ chối, rút, hủy (kể cả hủy sau khi đã duyệt): hoàn phần đơn đang chiếm. Gọi lại không tạo giao dịch thứ hai.
 */
export async function settleCompOffRequest(
  db: Db,
  tenant: string,
  actor: string,
  input: { employeeId: string; requestId: string; target: 'APPROVED' | 'REJECTED' | 'CANCELLED' },
): Promise<void> {
  const res = await db.query(
    `SELECT kind,days,lot_id,expires_on,occurred_on,request_id FROM hrm_schema.comp_off_ledger WHERE tenant_id=$1 AND request_id=$2 ORDER BY created_at,id`,
    [tenant, input.requestId],
  );
  const nets = requestLotNets(res.rows.map(rowToLedger), input.requestId);
  const insert = (kind: 'RELEASE' | 'USAGE', days: number, lotId: string, key: string) =>
    db.query(
      `INSERT INTO hrm_schema.comp_off_ledger (tenant_id,employee_id,kind,days,occurred_on,lot_id,request_id,idempotency_key,created_by)
       VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9) ON CONFLICT (tenant_id,idempotency_key) DO NOTHING`,
      [tenant, input.employeeId, kind, days, today(), lotId, input.requestId, key, actor],
    );
  for (const net of nets) {
    if (net.held <= 0) continue;
    if (input.target === 'APPROVED') {
      if (net.used) continue;
      await insert('RELEASE', net.held, net.lotId, approveReleaseKey(input.requestId, net.lotId));
      await insert('USAGE', -net.held, net.lotId, usageKey(input.requestId, net.lotId));
    } else {
      await insert('RELEASE', net.held, net.lotId, refundKey(input.requestId, net.lotId, input.target));
    }
  }
}

/** Số dư của mọi nhân viên có phát sinh quỹ, kèm tên. */
export async function listCompOffBalances(db: Db, tenant: string, asOf: string = today()): Promise<HrmCompOffBalanceRow[]> {
  const byEmployee = await loadLedgerByEmployee(db, tenant);
  const ids = [...byEmployee.keys()];
  const names = await db.query(
    `SELECT employee_id,employee_code,full_name FROM hrm_schema.employee_directory WHERE tenant_id=$1 AND employee_id=ANY($2::uuid[])`,
    [tenant, ids],
  );
  const nameOf = new Map(names.rows.map((r) => [r.employee_id as string, r]));
  return ids
    .map((employeeId) => {
      const s = summarizeLedger(byEmployee.get(employeeId) ?? [], asOf);
      return {
        employeeId,
        employeeCode: (nameOf.get(employeeId)?.employee_code as string | undefined) ?? null,
        employeeName: (nameOf.get(employeeId)?.full_name as string | undefined) ?? null,
        accrued: s.accrued,
        used: s.used,
        reserved: s.reserved,
        expired: s.expired,
        adjusted: s.adjusted,
        available: s.available,
        nextExpiry: s.nextExpiry,
      };
    })
    .sort((a, b) => (a.employeeCode ?? '').localeCompare(b.employeeCode ?? '') || a.employeeId.localeCompare(b.employeeId));
}

function mapEntry(r: Record<string, any>): HrmCompOffLedgerEntry {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: r.id,
    kind: r.kind,
    days: Number(r.days),
    occurredOn: isoDate(r.occurred_on),
    lotId: r.lot_id,
    expiresOn: r.expires_on ? isoDate(r.expires_on) : null,
    periodMonth: r.period_month ?? null,
    sourceHours: n(r.source_hours),
    capHours: n(r.cap_hours),
    excessHours: n(r.excess_hours),
    requestId: r.request_id ?? null,
    reason: r.reason ?? null,
    createdBy: r.created_by ?? null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

/** Chi tiết quỹ của một nhân viên: các lô và sổ giao dịch (mới nhất trước). */
export async function compOffDetail(
  db: Db,
  tenant: string,
  employeeId: string,
  asOf: string = today(),
): Promise<HrmCompOffBalanceDetail> {
  const { policy } = await loadOvertimeCompPolicy(db, tenant, monthOf(asOf), employeeId);
  const entries = await db.query(
    `SELECT * FROM hrm_schema.comp_off_ledger WHERE tenant_id=$1 AND employee_id=$2 ORDER BY created_at DESC,id DESC LIMIT 500`,
    [tenant, employeeId],
  );
  const summary = summarizeLedger(await loadLedgerRows(db, tenant, employeeId), asOf);
  return {
    employeeId,
    available: summary.available,
    reserved: summary.reserved,
    usageStepDays: policy.usageStepDays,
    lots: summary.lots.map((l) => ({
      lotId: l.lotId,
      openedOn: l.openedOn,
      expiresOn: l.expiresOn,
      granted: l.granted,
      remaining: l.remaining,
    })),
    entries: entries.rows.map(mapEntry),
  };
}

/** Kỳ công đã chốt của tháng cùng ảnh chụp chính sách; null khi chưa chốt. */
async function lockedSnapshot(db: Db, tenant: string, month: string) {
  const period = await db.query(
    `SELECT id,status,policy_snapshot FROM hrm_schema.timesheet_periods WHERE tenant_id=$1 AND period_code=$2`,
    [tenant, month],
  );
  const row = period.rows[0];
  if (!row || row.status !== 'LOCKED') return { locked: false, snapshot: null };
  return { locked: true, snapshot: readOvertimeCompSnapshot(row.policy_snapshot) };
}

/**
 * Xem trước chuyển đổi giờ dư thành nghỉ bù của một tháng. Tháng đã chốt đọc ảnh chụp lúc chốt; tháng chưa chốt tính trực
 * tiếp theo chính sách hiện tại (chỉ để xem, chưa chuyển đổi được).
 */
export async function previewCompOffConversion(db: Db, tenant: string, month: string): Promise<HrmCompOffConversionPreview> {
  const { locked, snapshot } = await lockedSnapshot(db, tenant, month);
  const live = await loadOvertimeCompPolicy(db, tenant, month);
  const policy = snapshot?.policy ?? live.policy;
  const figures: EmployeeOvertimeFigures[] = snapshot
    ? Object.values(snapshot.employees)
    : policy.enabled
      ? await overtimeMonthFigures(db, tenant, month, policy)
      : [];
  const named = await withEmployeeNames(db, tenant, month, figures);
  const ledger = await loadLedgerByEmployee(db, tenant);
  const keys = await db.query(
    `SELECT employee_id,days FROM hrm_schema.comp_off_ledger WHERE tenant_id=$1 AND kind='ACCRUAL' AND period_month=$2`,
    [tenant, month],
  );
  const converted = new Map(keys.rows.map((r) => [r.employee_id as string, Number(r.days)]));
  const accrualOn = accrualDate(month, policy.accrualMonthOffset);
  const expiresOn = expiryDate(accrualOn, policy.expiryMonths);
  const rows: HrmCompOffConversionRow[] = named.map((f) => {
    const done = converted.get(f.employeeId);
    const owned = (() => {
      const s = summarizeLedger(ledger.get(f.employeeId) ?? [], accrualOn);
      return roundLedgerDays(s.available + s.reserved);
    })();
    const room = policy.accumulationCapDays === null ? null : Math.max(0, roundLedgerDays(policy.accumulationCapDays - owned));
    let status: HrmCompOffConversionRow['status'] = 'READY';
    let note: string | null = null;
    if (done !== undefined) status = 'CONVERTED';
    else if (!(f.compDays > 0)) status = 'NOTHING';
    else if (room !== null && room <= 0) {
      status = 'CAP_REACHED';
      note = `Đã đạt trần tích lũy ${fmt(policy.accumulationCapDays as number)} ngày`;
    } else if (room !== null && room < f.compDays) note = `Chỉ chuyển được tối đa ${fmt(room)} ngày do trần tích lũy`;
    return { ...f, status, convertedDays: done ?? null, accrualOn, expiresOn, note };
  });
  return { month, locked, enabled: policy.enabled, rows };
}

/**
 * Xác nhận chuyển đổi: ghi một lô ACCRUAL cho mỗi nhân viên được chọn. Chỉ làm khi tháng đã chốt công và quy tắc đang bật.
 * HR chỉnh số ngày khác đề xuất thì phải có lý do. Một nhân viên chỉ chuyển đổi một lần cho mỗi tháng.
 */
export async function confirmCompOffConversion(
  db: PoolClient,
  tenant: string,
  actor: string,
  body: ConfirmHrmCompOffConversionRequest,
): Promise<HrmCompOffConversionResult> {
  const { locked, snapshot } = await lockedSnapshot(db, tenant, body.month);
  if (!locked)
    throw new ConflictException(`Tháng ${body.month.slice(5)}/${body.month.slice(0, 4)} chưa chốt công nên chưa chuyển đổi được`);
  if (!snapshot?.policy.enabled)
    throw new BadRequestException('Tháng này chốt công khi chưa bật quy tắc làm thêm và nghỉ bù; không có giờ dư để chuyển đổi');
  const policy = snapshot.policy;
  const accrualOn = accrualDate(body.month, policy.accrualMonthOffset);
  const expiresOn = expiryDate(accrualOn, policy.expiryMonths);
  const result: { created: number; skipped: { employeeId: string; reason: string }[] } = { created: 0, skipped: [] };
  for (const row of body.rows) {
    const figures = snapshot.employees[row.employeeId];
    const skip = (reason: string) => result.skipped.push({ employeeId: row.employeeId, reason });
    if (!figures || !(figures.compDays > 0)) {
      skip('Không có giờ làm thêm vượt trần trong tháng');
      continue;
    }
    await lockEmployee(db, tenant, row.employeeId);
    let days = row.days === undefined ? figures.compDays : roundLedgerDays(Number(row.days));
    if (!Number.isFinite(days) || days <= 0) {
      skip('Số ngày phải lớn hơn 0');
      continue;
    }
    if (days !== figures.compDays && !String(row.reason ?? '').trim()) {
      skip(`Số ngày khác đề xuất (${fmt(figures.compDays)}) nên cần nhập lý do`);
      continue;
    }
    if (policy.accumulationCapDays !== null) {
      const s = summarizeLedger(await loadLedgerRows(db, tenant, row.employeeId), accrualOn);
      const room = Math.max(0, roundLedgerDays(policy.accumulationCapDays - (s.available + s.reserved)));
      days = Math.min(days, room);
      if (days <= 0) {
        skip(`Đã đạt trần tích lũy ${fmt(policy.accumulationCapDays)} ngày`);
        continue;
      }
    }
    const id = randomUUID();
    const inserted = await db.query(
      `INSERT INTO hrm_schema.comp_off_ledger
         (id,tenant_id,employee_id,kind,days,occurred_on,lot_id,expires_on,period_month,source_hours,cap_hours,excess_hours,factor,day_basis_hours,policy_snapshot,reason,idempotency_key,created_by)
       VALUES ($1,$2,$3,'ACCRUAL',$4,$5::date,$1,$6::date,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16)
       ON CONFLICT (tenant_id,idempotency_key) DO NOTHING RETURNING id`,
      [
        id,
        tenant,
        row.employeeId,
        days,
        accrualOn,
        expiresOn,
        body.month,
        figures.actualOtHours,
        policy.monthlyCapHours,
        figures.excessOtHours,
        policy.compFactor,
        policy.dayBasisHours ?? policy.normalHoursPerDay,
        JSON.stringify(policy),
        String(row.reason ?? '').trim() || null,
        accrualKey(row.employeeId, body.month),
        actor,
      ],
    );
    if (!inserted.rows[0]) {
      skip('Đã chuyển đổi cho tháng này');
      continue;
    }
    result.created++;
    await lifecycleAudit(db, tenant, actor, 'COMP_OFF_ACCRUED', row.employeeId, {
      month: body.month,
      days,
      proposed: figures.compDays,
      excessHours: figures.excessOtHours,
    });
  }
  return { month: body.month, ...result };
}

/**
 * Điều chỉnh tay (có lý do): dương mở một lô mới, âm trừ vào các lô gần hết hạn trước. Không để quỹ âm.
 */
export async function adjustCompOff(
  db: PoolClient,
  tenant: string,
  actor: string,
  body: AdjustHrmCompOffRequest,
): Promise<{ available: number }> {
  const reason = String(body.reason ?? '').trim();
  if (!reason) throw new BadRequestException('Cần nhập lý do điều chỉnh quỹ nghỉ bù');
  const days = roundLedgerDays(Number(body.days));
  if (!Number.isFinite(days) || days === 0 || Math.abs(days) > 365)
    throw new BadRequestException('Số ngày điều chỉnh phải khác 0 và không quá 365 ngày');
  await lockEmployee(db, tenant, body.employeeId);
  const date = today();
  const rows = await loadLedgerRows(db, tenant, body.employeeId);
  const summary = summarizeLedger(rows, date);
  if (days > 0) {
    const { policy } = await loadOvertimeCompPolicy(db, tenant, monthOf(date), body.employeeId);
    const id = randomUUID();
    const expires = body.expiresOn === undefined ? expiryDate(date, policy.expiryMonths) : body.expiresOn;
    await db.query(
      `INSERT INTO hrm_schema.comp_off_ledger (id,tenant_id,employee_id,kind,days,occurred_on,lot_id,expires_on,reason,idempotency_key,created_by)
       VALUES ($1,$2,$3,'ADJUST',$4,$5::date,$1,$6::date,$7,$8,$9)`,
      [id, tenant, body.employeeId, days, date, expires, reason, `adjust:${id}`, actor],
    );
  } else {
    const allocation = allocateFromLots(summary.lots, -days, date);
    if (!allocation)
      throw new BadRequestException(`Không đủ số dư để trừ ${fmt(-days)} ngày: còn ${fmt(summary.available)} ngày khả dụng`);
    for (const part of allocation) {
      const id = randomUUID();
      await db.query(
        `INSERT INTO hrm_schema.comp_off_ledger (id,tenant_id,employee_id,kind,days,occurred_on,lot_id,reason,idempotency_key,created_by)
         VALUES ($1,$2,$3,'ADJUST',$4,$5::date,$6,$7,$8,$9)`,
        [id, tenant, body.employeeId, -part.days, date, part.lotId, reason, `adjust:${id}`, actor],
      );
    }
  }
  await lifecycleAudit(db, tenant, actor, 'COMP_OFF_ADJUSTED', body.employeeId, { days, reason });
  const after = summarizeLedger(await loadLedgerRows(db, tenant, body.employeeId), date);
  return { available: after.available };
}

/**
 * Hết hạn lô: với mỗi lô quá hạn còn số dư dương, ghi một dòng EXPIRE trừ phần còn lại. Chạy lại cùng ngày không ghi thêm.
 * Trả số lô đã hết hạn. Chưa gắn lịch chạy tự động: gọi qua API của HR hoặc tác vụ nền.
 */
export async function expireCompOffLots(db: PoolClient, tenant: string, actor: string | null, asOf: string = today()): Promise<number> {
  const due = await db.query(
    `SELECT employee_id,lot_id,sum(days)::numeric AS remaining
       FROM hrm_schema.comp_off_ledger WHERE tenant_id=$1
      GROUP BY employee_id,lot_id
     HAVING bool_or(expires_on IS NOT NULL AND expires_on<$2::date) AND sum(days)>0`,
    [tenant, asOf],
  );
  let expired = 0;
  for (const lot of due.rows) {
    await lockEmployee(db, tenant, lot.employee_id);
    const inserted = await db.query(
      `INSERT INTO hrm_schema.comp_off_ledger (tenant_id,employee_id,kind,days,occurred_on,lot_id,reason,idempotency_key,created_by)
       SELECT $1::uuid,$2::uuid,'EXPIRE',-sum(days),$4::date,$3::uuid,'Hết hạn dùng',$5::text,$6::uuid FROM hrm_schema.comp_off_ledger WHERE tenant_id=$1 AND lot_id=$3 HAVING sum(days)>0
       ON CONFLICT (tenant_id,idempotency_key) DO NOTHING RETURNING id`,
      [tenant, lot.employee_id, lot.lot_id, asOf, `${expireKey(lot.lot_id)}:${asOf}`, actor],
    );
    if (inserted.rows[0]) expired++;
  }
  return expired;
}
