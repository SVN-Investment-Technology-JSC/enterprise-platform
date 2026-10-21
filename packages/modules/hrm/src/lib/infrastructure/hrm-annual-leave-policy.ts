import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  AnnualLeaveCarryover,
  AnnualLeavePolicy,
  AnnualLeavePolicyResponse,
  CreateLeaveAccrualScheduleRequest,
  HrmLeaveAccrualBasis,
  HrmLeaveSeniorityTier,
  SaveAnnualLeavePolicyRequest,
} from '@enterprise-platform/contracts-hrm';
import { validateSeniorityTiers } from '../domain/annual-leave-entitlement.js';
import { lifecycleAudit, timestamp } from './hrm-lifecycle.js';
import {
  accrualScheduleUsage,
  insertAccrualSchedule,
  lockAccrualConfiguration,
  mutateAccrualSchedule,
  validateAccrualSchedule,
  type AccrualMutation,
} from './hrm-leave-schedule.js';
import { recomputeAnnualLeaveYear } from './hrm-annual-leave-recompute.js';
import { isoDate } from './hrm-time.js';
import { requireDate, requireUuid } from './hrm-validation.js';

/**
 * Phép năm chỉ có MỘT cấu hình: mỗi tenant có đúng một lý do nghỉ `is_annual`, một chính sách
 * (lịch cộng phép mới nhất + mốc thâm niên + cột chuyển phép của lý do đó). Sửa chính sách dùng lại
 * các hàm của lịch cộng phép (tạo lịch, sửa tại chỗ khi chưa cộng, tạo phiên bản mới có hiệu lực từ
 * một tháng); phiên bản cũ vẫn nằm trong bảng và tra được qua nhật ký kiểm toán.
 */

export const ANNUAL_ONLY_MESSAGE = 'Chỉ cấu hình phép năm tại Chính sách phép năm';

const DEFAULT_CARRYOVER_EXPIRY_MONTH = 3;
const MAX_DAYS = 366;
/** Chính sách phép năm không nhập lý do: nhật ký kiểm toán và lịch cộng phép dùng ghi chú cố định này. */
const POLICY_CHANGE_NOTE = 'Cập nhật chính sách phép năm';

const round2 = (value: number) => Math.round(value * 100) / 100;

const NO_CARRYOVER: AnnualLeaveCarryover = {
  allowed: false,
  maxDays: 0,
  expiryMonth: DEFAULT_CARRYOVER_EXPIRY_MONTH,
};

/** Gọi trong giao dịch: chỉ lý do phép năm mới được tạo/sửa lịch cộng phép (409 nếu không). */
export async function assertAnnualLeaveType(
  db: PoolClient,
  tenant: string,
  leaveTypeId: string,
) {
  const type = (
    await db.query(
      'SELECT id,is_annual FROM hrm_schema.leave_types WHERE tenant_id=$1 AND id=$2',
      [tenant, leaveTypeId],
    )
  ).rows[0];
  if (!type) throw new NotFoundException('Không tìm thấy loại nghỉ');
  if (!type.is_annual) throw new ConflictException(ANNUAL_ONLY_MESSAGE);
}

/** Dữ liệu đã kiểm tra của `PUT /annual-leave-policy`. */
export interface AnnualLeavePolicyInput {
  readonly leaveTypeId?: string;
  readonly accrualBasis: HrmLeaveAccrualBasis;
  readonly annualDays: number;
  readonly startOffsetMonths: number;
  readonly advanceAllowed: boolean;
  readonly seniorityTiers: readonly HrmLeaveSeniorityTier[];
  readonly effectiveFrom?: string;
  /** Phép năm không chuyển sang năm sau: luôn là 0. */
  readonly maxCarryoverDays: number;
  readonly carryoverExpiryMonth?: number;
  readonly expectedUpdatedAt?: string;
}

function invalid(message: string): never {
  throw new BadRequestException({ code: 'HRM_INVALID_INPUT', message });
}

/**
 * Căn cứ ngày vào làm dùng cách cộng cũ: chỉ có một chu kỳ thâm niên đều (mỗi N năm cộng M ngày:
 * 5 năm +1, 10 năm +2...) và không có mốc bắt đầu sau N tháng.
 */
function legacyCycle(tiers: readonly HrmLeaveSeniorityTier[]) {
  if (!tiers.length) return { years: 0, days: 0 };
  const first = tiers[0];
  const regular = tiers.every(
    (tier, i) =>
      tier.minYears === first.minYears * (i + 1) &&
      round2(tier.bonusDays) === round2(first.bonusDays * (i + 1)),
  );
  if (!regular)
    invalid(
      'Căn cứ ngày vào làm chỉ hỗ trợ mốc thâm niên theo chu kỳ đều (mỗi N năm cộng thêm M ngày)',
    );
  return { years: first.minYears, days: first.bonusDays };
}

export function validateAnnualLeavePolicyInput(
  body: SaveAnnualLeavePolicyRequest,
): AnnualLeavePolicyInput {
  if (!body || typeof body !== 'object')
    invalid('Cần gửi nội dung chính sách phép năm');
  const leaveTypeId =
    body.leaveTypeId === undefined || body.leaveTypeId === null
      ? undefined
      : requireUuid(body.leaveTypeId, 'Lý do nghỉ');
  if (!['JOIN_DATE', 'CONTRACT_SIGN_DATE'].includes(body.accrualBasis))
    invalid('Căn cứ tính phép không hợp lệ');
  if (
    typeof body.annualDays !== 'number' ||
    !Number.isFinite(body.annualDays) ||
    body.annualDays < 0 ||
    body.annualDays > MAX_DAYS
  )
    invalid('Số ngày phép năm phải từ 0 đến 366');
  if (
    !Number.isInteger(body.startOffsetMonths) ||
    body.startOffsetMonths < 0 ||
    body.startOffsetMonths > 120
  )
    invalid('Số tháng bắt đầu tính phép phải là số nguyên từ 0 đến 120');
  if (typeof body.advanceAllowed !== 'boolean')
    invalid('Cần chọn có cho ứng phép hay không');
  const rawTiers = body.seniorityTiers ?? [];
  if (!Array.isArray(rawTiers)) invalid('Mốc thâm niên không hợp lệ');
  const tiers = rawTiers
    .map((t) => ({ minYears: t?.minYears, bonusDays: t?.bonusDays }))
    .sort((a, b) => Number(a.minYears) - Number(b.minYears));
  if (tiers.length > 1) invalid('Chỉ được cấu hình một mốc phép thâm niên');
  try {
    validateSeniorityTiers(tiers);
  } catch (error) {
    invalid((error as Error).message);
  }
  if (body.accrualBasis === 'JOIN_DATE') {
    if (body.startOffsetMonths !== 0)
      invalid('Căn cứ ngày vào làm không hỗ trợ bắt đầu hưởng phép sau N tháng');
    legacyCycle(tiers);
  }
  if (body.effectiveFrom !== undefined) {
    requireDate(body.effectiveFrom, 'Ngày hiệu lực');
    if (!body.effectiveFrom.endsWith('-01-01'))
      invalid('Chính sách phép năm chỉ có hiệu lực từ ngày đầu năm (01/01)');
  }
  if (
    body.maxCarryoverDays !== undefined &&
    body.maxCarryoverDays !== 0
  )
    invalid('Phép năm không chuyển sang năm sau (số ngày chuyển luôn là 0)');
  if (
    body.carryoverExpiryMonth !== undefined &&
    (!Number.isInteger(body.carryoverExpiryMonth) ||
      body.carryoverExpiryMonth < 1 ||
      body.carryoverExpiryMonth > 12)
  )
    invalid('Tháng hết hạn phép chuyển phải từ 1 đến 12');
  if (
    body.expectedUpdatedAt !== undefined &&
    (typeof body.expectedUpdatedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T/.test(body.expectedUpdatedAt) ||
      !Number.isFinite(Date.parse(body.expectedUpdatedAt)))
  )
    invalid('expectedUpdatedAt không hợp lệ');
  return {
    leaveTypeId,
    accrualBasis: body.accrualBasis,
    annualDays: body.annualDays,
    startOffsetMonths: body.startOffsetMonths,
    advanceAllowed: body.advanceAllowed,
    seniorityTiers: tiers as HrmLeaveSeniorityTier[],
    effectiveFrom: body.effectiveFrom,
    maxCarryoverDays: 0,
    carryoverExpiryMonth: body.carryoverExpiryMonth,
    expectedUpdatedAt: body.expectedUpdatedAt,
  };
}

async function loadAnnualType(db: PoolClient, tenant: string, lock = false) {
  return (
    await db.query(
      `SELECT * FROM hrm_schema.leave_types WHERE tenant_id=$1 AND is_annual AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`,
      [tenant],
    )
  ).rows[0];
}

async function loadSchedules(
  db: PoolClient,
  tenant: string,
  leaveTypeId: string,
  lock = false,
) {
  return (
    await db.query(
      `SELECT * FROM hrm_schema.leave_accrual_schedules WHERE tenant_id=$1 AND leave_type_id=$2 ORDER BY effective_from DESC${lock ? ' FOR UPDATE' : ''}`,
      [tenant, leaveTypeId],
    )
  ).rows;
}

/** Dấu phiên bản của chính sách: lần cập nhật gần nhất của lý do phép năm hoặc của một lịch cộng phép. */
function policyVersion(
  type: Record<string, any>,
  schedules: Record<string, any>[],
): string {
  const times = [type.updated_at, ...schedules.map((s) => s.updated_at)].map(
    (v) => Date.parse(timestamp(v)),
  );
  return new Date(Math.max(...times)).toISOString();
}

/** Số ngày phép một năm của lịch (lịch cũ theo ngày vào làm không lưu `annual_days`). */
function scheduleAnnualDays(row: Record<string, any>): number {
  if (row.annual_days != null) return Number(row.annual_days);
  const perYear: Record<string, number> = { MONTHLY: 12, QUARTERLY: 4, YEARLY: 1 };
  return round2(Number(row.accrual_amount) * (perYear[row.accrual_frequency] ?? 0));
}

/** Đọc chính sách phép năm hiện hành (và danh sách lý do chọn được khi chưa có). */
export async function readAnnualLeavePolicy(
  db: PoolClient,
  tenant: string,
): Promise<AnnualLeavePolicyResponse> {
  const type = await loadAnnualType(db, tenant);
  if (!type) {
    const candidates = await db.query(
      `SELECT t.id,t.code,t.name,t.paid,t.deduct_balance FROM hrm_schema.leave_types t
        WHERE t.tenant_id=$1 AND t.deleted_at IS NULL AND t.active=true AND t.merged_into_id IS NULL
          AND t.unit='DAYS' AND NOT t.is_annual
          AND ((t.paid AND t.deduct_balance) OR NOT EXISTS (
                SELECT 1 FROM hrm_schema.leave_requests r WHERE r.tenant_id=t.tenant_id AND r.leave_type_id=t.id))
        ORDER BY t.code ASC`,
      [tenant],
    );
    return {
      leaveType: null,
      candidates: candidates.rows.map((row) => ({
        id: row.id as string,
        code: row.code as string,
        name: row.name as string,
        paid: Boolean(row.paid),
        deductBalance: Boolean(row.deduct_balance),
      })),
      policy: null,
      closedOtherSchedules: 0,
    };
  }
  const schedules = await loadSchedules(db, tenant, type.id);
  const latest = schedules[0];
  let policy: AnnualLeavePolicy | null = null;
  if (latest) {
    const tiers = await db.query(
      'SELECT min_years,bonus_days FROM hrm_schema.leave_seniority_tiers WHERE tenant_id=$1 AND schedule_id=$2 ORDER BY min_years',
      [tenant, latest.id],
    );
    policy = {
      accrualBasis: latest.accrual_basis as HrmLeaveAccrualBasis,
      annualDays: scheduleAnnualDays(latest),
      startOffsetMonths: Number(latest.start_offset_months ?? 0),
      advanceAllowed: Boolean(latest.advance_allowed),
      effectiveFrom: isoDate(latest.effective_from),
      seniorityTiers: tiers.rows.map((t) => ({
        minYears: Number(t.min_years),
        bonusDays: Number(t.bonus_days),
      })),
      carryover: NO_CARRYOVER,
      updatedAt: policyVersion(type, schedules),
    };
  }
  return {
    leaveType: { id: type.id, code: type.code, name: type.name },
    candidates: [],
    policy,
    closedOtherSchedules: 0,
  };
}

/** Các trường lịch cộng phép sinh ra từ chính sách (cộng hằng tháng = định mức năm / 12). */
function scheduleFields(
  input: AnnualLeavePolicyInput,
): Omit<CreateLeaveAccrualScheduleRequest, 'effectiveFrom' | 'effectiveTo'> {
  const common = {
    accrualFrequency: 'MONTHLY' as const,
    accrualAmount: round2(input.annualDays / 12),
    accrualBasis: input.accrualBasis,
    advanceAllowed: input.advanceAllowed,
    seniorityTiers: input.seniorityTiers,
  };
  if (input.accrualBasis === 'CONTRACT_SIGN_DATE')
    return {
      ...common,
      annualDays: input.annualDays,
      startOffsetMonths: input.startOffsetMonths,
    };
  const cycle = legacyCycle(input.seniorityTiers);
  return {
    ...common,
    annualDays: null,
    startOffsetMonths: 0,
    prorationRule: 'BY_JOIN_DATE',
    seniorityBonusYears: cycle.years,
    seniorityBonusDays: cycle.days,
  };
}

interface ClosedSchedule {
  readonly scheduleId: string;
  readonly leaveTypeId: string;
  readonly action: 'deactivate' | 'delete';
  readonly effectiveTo?: string;
}

/**
 * Lần đầu đặt phép năm: chỉ phép năm còn được tự động cộng, nên kết thúc mọi lịch cộng phép đang hiệu lực
 * (hoặc sắp hiệu lực) của các lý do nghỉ khác. Dùng lại `mutateAccrualSchedule`:
 * - kết thúc hết tháng hiện tại (không trước tháng đã cộng phép, đúng luật 'deactivate');
 * - lịch chưa bắt đầu và chưa cộng lần nào thì xoá (không có gì để giữ).
 */
async function closeOtherAccrualSchedules(
  db: PoolClient,
  tenant: string,
  actor: string,
  annualTypeId: string,
  reason: string,
): Promise<ClosedSchedule[]> {
  const monthEnd = (
    await db.query(
      `SELECT to_char(date_trunc('month',CURRENT_DATE)+interval '1 month - 1 day','YYYY-MM-DD') AS month_end`,
    )
  ).rows[0].month_end as string;
  const others = (
    await db.query(
      `SELECT * FROM hrm_schema.leave_accrual_schedules WHERE tenant_id=$1 AND leave_type_id<>$2 AND (effective_to IS NULL OR effective_to>$3::date) ORDER BY leave_type_id, effective_from FOR UPDATE`,
      [tenant, annualTypeId, monthEnd],
    )
  ).rows;
  const closed: ClosedSchedule[] = [];
  for (const row of others) {
    const usage = await accrualScheduleUsage(db, tenant, row.id);
    const from = isoDate(row.effective_from);
    const lastAccrued = usage.last_month ?? '';
    const end = [monthEnd, lastAccrued].sort().pop() as string;
    const mutation: AccrualMutation = {
      expectedUpdatedAt: timestamp(row.updated_at),
      reason,
    };
    if (!usage.count && from > end) {
      await mutateAccrualSchedule(db, tenant, actor, row.leave_type_id, row.id, mutation, 'delete');
      closed.push({ scheduleId: row.id, leaveTypeId: row.leave_type_id, action: 'delete' });
      continue;
    }
    const effectiveTo = from > end ? from : end;
    await mutateAccrualSchedule(
      db,
      tenant,
      actor,
      row.leave_type_id,
      row.id,
      { ...mutation, effectiveTo },
      'deactivate',
    );
    closed.push({
      scheduleId: row.id,
      leaveTypeId: row.leave_type_id,
      action: 'deactivate',
      effectiveTo,
    });
  }
  return closed;
}

/** Ngày 01/01 của năm liền sau năm chứa `date` (YYYY-MM-DD): mốc hiệu lực mới không bao giờ chồng lên thời gian đã có. */
/** Ngày 01/01 của năm chứa `date`. */
const startOfYear = (date: string) => `${date.slice(0, 4)}-01-01`;

/**
 * Lịch chưa cộng phép được sửa tại chỗ: dời về 01/01 của năm đó, trừ khi chồng lên lịch trước (dữ liệu cũ bắt đầu giữa năm).
 */
const editStart = (current: Record<string, any>, previous?: Record<string, any>) => {
  const from = isoDate(current.effective_from);
  const start = startOfYear(from);
  return previous?.effective_to && isoDate(previous.effective_to) >= start ? from : start;
};

export const firstOfNextYear = (date: string) => `${Number(date.slice(0, 4)) + 1}-01-01`;

/**
 * Lưu chính sách phép năm trong MỘT giao dịch (caller mở bằng hrmTransaction):
 * khoá cấu hình cộng phép → đặt/xác nhận lý do phép năm (ép có lương, trừ quỹ) → lưu cột chuyển phép
 * → tạo lịch mới / sửa lịch chưa cộng / tạo phiên bản mới (đóng lịch cũ) → ghi nhật ký kiểm toán.
 */
export async function saveAnnualLeavePolicy(
  db: PoolClient,
  tenant: string,
  actor: string,
  input: AnnualLeavePolicyInput,
): Promise<{
  mode: 'create' | 'edit' | 'version';
  /** Số lịch cộng phép của các lý do khác đã kết thúc/xoá (chỉ khác 0 ở lần đầu đặt phép năm). */
  closedOtherSchedules: number;
}> {
  await lockAccrualConfiguration(db, tenant);
  const existing = await loadAnnualType(db, tenant, true);
  if (existing && input.leaveTypeId && input.leaveTypeId !== existing.id)
    throw new ConflictException(
      'Đã có lý do phép năm; không đổi sang lý do nghỉ khác tại đây',
    );
  let type = existing;
  if (!type) {
    if (!input.leaveTypeId)
      invalid('Chưa có phép năm: cần chọn một lý do nghỉ làm phép năm');
    type = (
      await db.query(
        'SELECT * FROM hrm_schema.leave_types WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',
        [tenant, input.leaveTypeId],
      )
    ).rows[0];
    if (!type) throw new NotFoundException('Không tìm thấy lý do nghỉ');
    if (!type.active || type.merged_into_id)
      throw new ConflictException('Lý do nghỉ đã ngừng hoặc đã được gộp');
    if (type.unit !== 'DAYS')
      invalid('Phép năm phải tính theo ngày');
  }
  const schedules = await loadSchedules(db, tenant, type.id, true);
  if (
    existing &&
    input.expectedUpdatedAt !== undefined &&
    policyVersion(existing, schedules) !== timestamp(input.expectedUpdatedAt)
  )
    throw new ConflictException({
      code: 'HRM_STALE_VERSION',
      message:
        'Dữ liệu đã được người khác thay đổi. Tải lại bản ghi trước khi lưu.',
    });
  // Phép năm luôn có lương và trừ quỹ; đổi chế độ của lý do đã có đơn sẽ làm sai quỹ/bảng công cũ.
  if (!type.paid || !type.deduct_balance) {
    const used = await db.query(
      'SELECT id FROM hrm_schema.leave_requests WHERE tenant_id=$1 AND leave_type_id=$2 LIMIT 1',
      [tenant, type.id],
    );
    if (used.rowCount)
      throw new ConflictException(
        'Lý do nghỉ đã có đơn nhưng không có lương hoặc không trừ quỹ phép; chọn hoặc tạo lý do nghỉ khác làm phép năm.',
      );
  }
  const before = await readAnnualLeavePolicy(db, tenant);
  // Phép năm không chuyển sang năm sau: ép tắt chuyển phép, số ngày chuyển luôn 0.
  const expiryMonth = DEFAULT_CARRYOVER_EXPIRY_MONTH;
  try {
    await db.query(
      `UPDATE hrm_schema.leave_types SET is_annual=true,paid=true,deduct_balance=true,active=true,carryover_allowed=false,max_carryover_days=0,carryover_expiry_month=$3,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE tenant_id=$1 AND id=$2`,
      [tenant, type.id, expiryMonth],
    );
  } catch (error) {
    if ((error as { code?: string })?.code === '23505')
      throw new ConflictException('Đã có lý do phép năm');
    throw error;
  }

  const fields = scheduleFields(input);
  const current = schedules[0];
  const year = new Date().getUTCFullYear();
  let mode: 'create' | 'edit' | 'version';
  let saved: Record<string, any>;
  if (!current || current.effective_to) {
    // Chưa có lịch, hoặc lịch mới nhất đã kết thúc: tạo lịch mới, không chồng lịch cũ.
    mode = 'create';
    const created: CreateLeaveAccrualScheduleRequest = {
      ...fields,
      effectiveFrom:
        input.effectiveFrom ??
        (current
          ? firstOfNextYear(isoDate(current.effective_to))
          : `${year}-01-01`),
      effectiveTo: null,
    };
    validateAccrualSchedule(created);
    saved = await insertAccrualSchedule(db, tenant, type.id, created);
  } else {
    const usage = await accrualScheduleUsage(db, tenant, current.id);
    // Chính sách đổi thì có hiệu lực từ 01/01 của năm áp dụng (mặc định năm nay) và quỹ phép năm đó được tính lại:
    // - lịch hiện hành bắt đầu từ năm áp dụng trở đi: sửa tại chỗ (đã cộng phép thì vẫn sửa, số ghi sổ được điều chỉnh sau);
    // - lịch hiện hành bắt đầu từ năm trước: kết thúc lịch cũ trước 01/01 và tạo phiên bản mới từ năm áp dụng.
    const wantFrom = input.effectiveFrom ?? `${year}-01-01`;
    const currentFrom = isoDate(current.effective_from);
    const inPlace = currentFrom >= wantFrom;
    mode = inPlace ? 'edit' : 'version';
    const mutation: AccrualMutation = {
      ...fields,
      effectiveFrom: inPlace
        ? (input.effectiveFrom ?? editStart(current, schedules[1]))
        : wantFrom,
      expectedUpdatedAt: timestamp(current.updated_at),
      reason: POLICY_CHANGE_NOTE,
      allowAccruedYear: true,
    };
    saved = await mutateAccrualSchedule(
      db,
      tenant,
      actor,
      type.id,
      current.id,
      mutation,
      inPlace ? (usage.count ? 'revise' : 'edit') : 'version',
    );
  }
  if (input.accrualBasis === 'JOIN_DATE')
    // Cách cộng cũ không dùng `annual_days`; lưu lại để đọc chính sách đúng số ngày đã nhập.
    await db.query(
      'UPDATE hrm_schema.leave_accrual_schedules SET annual_days=$3 WHERE tenant_id=$1 AND id=$2',
      [tenant, saved.id, input.annualDays],
    );

  const closed = existing
    ? []
    : await closeOtherAccrualSchedules(db, tenant, actor, type.id, POLICY_CHANGE_NOTE);
  // Tính lại quỹ phép đã ghi sổ của các năm từ năm áp dụng đến năm nay theo chính sách mới.
  const recomputed = [];
  for (
    let y = Number(isoDate(saved.effective_from).slice(0, 4));
    y <= year;
    y++
  )
    recomputed.push(
      await recomputeAnnualLeaveYear(
        db,
        tenant,
        actor,
        type.id,
        y,
        'Tính lại phép năm theo chính sách mới',
      ),
    );
  const after = await readAnnualLeavePolicy(db, tenant);
  await lifecycleAudit(db, tenant, actor, 'ANNUAL_LEAVE_POLICY_SAVED', type.id, {
    mode,
    scheduleId: saved.id,
    designated: !existing,
    reactivated: Boolean(existing && !existing.active),
    leaveType: { id: type.id, code: type.code, name: type.name },
    before: before.policy,
    after: after.policy,
    closedOtherSchedules: closed.length,
    closedSchedules: closed,
    recomputed,
    reason: POLICY_CHANGE_NOTE,
  });
  return { mode, closedOtherSchedules: closed.length };
}
