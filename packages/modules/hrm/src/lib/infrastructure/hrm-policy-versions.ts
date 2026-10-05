import { BadRequestException, ConflictException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { lifecycleAudit } from './hrm-lifecycle.js';
import { assertOpenRange, isoDate } from './hrm-time.js';

export interface PolicyVersionLike {
  id: string;
  policy_id?: string;
  version_no?: number;
  effective_from: string;
  effective_to: string | null;
  config_json?: Record<string, unknown> | null;
  status?: string;
}

export interface PublishRange {
  from: string;
  to: string | null;
  employeeIds: string[];
}

export interface PublishConflict {
  id: string;
  versionNo?: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string;
}

/** Scope: empty list means the whole company; two scopes collide when both are
 * company-wide or when two employee lists share an employee. A company-wide
 * version and an employee-scoped version do not collide (the scoped one wins in
 * resolvePolicy), which allows piloting a policy for one group first. */
export function scopesCollide(a: string[], b: string[]): boolean {
  if (!a.length && !b.length) return true;
  if (!a.length || !b.length) return false;
  return a.some((id) => b.includes(id));
}

export function versionEmployeeIds(
  config: Record<string, unknown> | null | undefined,
): string[] {
  const ids = config?.employeeIds;
  return Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : [];
}

function rangesOverlap(
  aFrom: string,
  aTo: string | null,
  bFrom: string,
  bTo: string | null,
) {
  return (!bTo || aFrom <= bTo) && (!aTo || bFrom <= aTo);
}

export function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Pure planning step: which existing versions must be closed, and which block the publish. */
export function planPolicyPublish(
  existing: PolicyVersionLike[],
  range: PublishRange,
  excludeVersionId?: string,
) {
  const toClose: PolicyVersionLike[] = [];
  const conflicts: PublishConflict[] = [];
  const warnings: string[] = [];
  for (const v of existing) {
    if (v.id === excludeVersionId || v.status === 'DRAFT') continue;
    if (!scopesCollide(versionEmployeeIds(v.config_json), range.employeeIds))
      continue;
    if (!rangesOverlap(v.effective_from, v.effective_to, range.from, range.to))
      continue;
    const info = {
      id: v.id,
      versionNo: v.version_no,
      effectiveFrom: v.effective_from,
      effectiveTo: v.effective_to,
    };
    if (v.effective_from >= range.from)
      conflicts.push({
        ...info,
        reason: 'Phiên bản này bắt đầu cùng hoặc sau ngày hiệu lực mới',
      });
    else if (v.effective_to)
      conflicts.push({
        ...info,
        reason: 'Phiên bản này đã có ngày kết thúc và giao với khoảng mới',
      });
    else toClose.push(v);
  }
  if (range.to && toClose.length)
    warnings.push(
      `Sau ngày ${range.to} sẽ không còn phiên bản nào áp dụng cho phạm vi này`,
    );
  return { toClose, conflicts, warnings };
}

export function conflictMessage(conflicts: PublishConflict[]) {
  return (
    'Khoảng hiệu lực giao với phiên bản đã có: ' +
    conflicts
      .map(
        (c) =>
          `v${c.versionNo ?? '?'} (${c.effectiveFrom} - ${c.effectiveTo ?? 'chưa kết thúc'}; ${c.reason})`,
      )
      .join('; ') +
    '. Điều chỉnh ngày hiệu lực hoặc phạm vi áp dụng.'
  );
}

/** Accept both snake_case (seed) and camelCase (settings screen) attendance keys. */
const aliases: Record<string, string> = {
  break_minutes: 'breakMinutes',
  grace_late_minutes: 'graceLateMinutes',
  grace_early_minutes: 'graceEarlyMinutes',
  workday_standard_minutes: 'workdayStandardMinutes',
  require_ip: 'requireIp',
  allowed_ips: 'allowedIps',
  require_gps: 'requireGps',
  max_gps_accuracy_meters: 'maxGpsAccuracyMeters',
  require_device: 'requireDevice',
  employee_ids: 'employeeIds',
};
export function readPolicyConfig(
  config: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config ?? {})) {
    const camel = aliases[key] ?? key;
    if (!(camel in out) || camel === key) out[camel] = value;
  }
  return out;
}

/** New config wins; keys it does not declare are inherited from the base version. */
export function inheritConfig(
  base: Record<string, unknown> | null | undefined,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const declared = new Set(
    Object.keys(next).map((k) => aliases[k] ?? k),
  );
  const kept = Object.fromEntries(
    Object.entries(base ?? {}).filter(([k]) => !declared.has(aliases[k] ?? k)),
  );
  return { ...kept, ...next };
}

function mapRow(row: any): PolicyVersionLike {
  return {
    ...row,
    effective_from: isoDate(row.effective_from),
    effective_to: row.effective_to ? isoDate(row.effective_to) : null,
  };
}

export async function lockPolicyType(
  db: PoolClient,
  tenantId: string,
  policyType: string,
) {
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
    `hrm-policy:${tenantId}:${policyType}`,
  ]);
}

async function versionsOfType(
  db: PoolClient,
  tenantId: string,
  policyType: string,
) {
  const result = await db.query(
    `SELECT v.* FROM hrm_schema.policy_versions v JOIN hrm_schema.policies p ON p.id=v.policy_id
     WHERE p.tenant_id=$1 AND p.policy_type=$2 AND p.status='ACTIVE' ORDER BY v.effective_from, v.version_no FOR UPDATE OF v`,
    [tenantId, policyType],
  );
  return result.rows.map(mapRow);
}

/** Close open versions of the same type+scope; 409 when a bounded version still intersects. */
export async function closeConflictingVersions(
  db: PoolClient,
  tenantId: string,
  policyType: string,
  range: PublishRange,
  options: { excludeVersionId?: string; touchUpdatedAt?: boolean } = {},
) {
  const existing = await versionsOfType(db, tenantId, policyType);
  const plan = planPolicyPublish(existing, range, options.excludeVersionId);
  if (plan.conflicts.length)
    throw new ConflictException({
      code: 'HRM_POLICY_VERSION_CONFLICT',
      message: conflictMessage(plan.conflicts),
      conflicts: plan.conflicts,
    });
  for (const v of plan.toClose)
    await db.query(
      `UPDATE hrm_schema.policy_versions SET effective_to=$2::date,status='SUPERSEDED'${
        options.touchUpdatedAt
          ? ",updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond')"
          : ''
      } WHERE id=$1`,
      [v.id, dayBefore(range.from)],
    );
  return { closed: plan.toClose, warnings: plan.warnings, existing };
}

export interface PublishOptions {
  effectiveFrom: string;
  effectiveTo?: string | null;
  employeeIds?: string[];
  config: Record<string, unknown>;
  reason: string;
  actorId: string;
  /** Used only when the tenant has no ACTIVE policy of this type yet. */
  defaultCode: string;
  defaultName: string;
  inherit?: boolean;
  touchUpdatedAt?: boolean;
  /** Payroll controller performs its own payroll-period guard. */
  skipPeriodGuard?: boolean;
}

export async function publishPolicyVersion(
  db: PoolClient,
  tenantId: string,
  policyType: string,
  options: PublishOptions,
) {
  const employeeIds = options.employeeIds ?? [];
  const to = options.effectiveTo || null;
  if (to && to < options.effectiveFrom)
    throw new BadRequestException(
      'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu hiệu lực',
    );
  await lockPolicyType(db, tenantId, policyType);
  if (!options.skipPeriodGuard) {
    const locked = await db.query(
      `SELECT period_code FROM hrm_schema.payroll_periods WHERE tenant_id=$1 AND status IN ('LOCKED','PAID') AND to_date>=$2::date`,
      [tenantId, options.effectiveFrom],
    );
    if (locked.rowCount)
      throw new BadRequestException(
        'Không xuất bản chính sách hồi tố vào kỳ lương đã chốt',
      );
    if (policyType !== 'PAYROLL')
      await assertOpenRange(db, tenantId, options.effectiveFrom, to);
  }
  // Reuse the tenant's ACTIVE record of this type (oldest first) instead of creating another one.
  let policyId = (
    await db.query(
      `SELECT id FROM hrm_schema.policies WHERE tenant_id=$1 AND policy_type=$2 AND status='ACTIVE' ORDER BY (code=$3) DESC, created_at, id LIMIT 1`,
      [tenantId, policyType, options.defaultCode],
    )
  ).rows[0]?.id as string | undefined;
  if (!policyId)
    policyId = (
      await db.query(
        `INSERT INTO hrm_schema.policies (tenant_id,code,name,policy_type,created_by) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id,code) DO UPDATE SET status='ACTIVE',updated_at=now() RETURNING id`,
        [
          tenantId,
          options.defaultCode,
          options.defaultName,
          policyType,
          options.actorId,
        ],
      )
    ).rows[0].id as string;
  const range: PublishRange = { from: options.effectiveFrom, to, employeeIds };
  const { closed, warnings, existing } = await closeConflictingVersions(
    db,
    tenantId,
    policyType,
    range,
    { touchUpdatedAt: options.touchUpdatedAt },
  );
  let config = { ...options.config };
  if (employeeIds.length) config.employeeIds = employeeIds;
  else delete config.employeeIds;
  if (options.inherit) {
    const base = existing
      .filter(
        (v) =>
          v.status !== 'DRAFT' &&
          v.effective_from <= range.from &&
          scopesCollide(versionEmployeeIds(v.config_json), employeeIds),
      )
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
    if (base) config = inheritConfig(base.config_json, config);
  }
  const inserted = (
    await db.query(
      `INSERT INTO hrm_schema.policy_versions (policy_id,version_no,effective_from,effective_to,config_json,status,created_by)
       SELECT $1,COALESCE(max(version_no),0)+1,$2,$3,$4,'ACTIVE',$5 FROM hrm_schema.policy_versions WHERE policy_id=$1 RETURNING *`,
      [policyId, range.from, to, JSON.stringify(config), options.actorId],
    )
  ).rows[0];
  await lifecycleAudit(
    db,
    tenantId,
    options.actorId,
    'POLICY_VERSION_PUBLISHED',
    inserted.id,
    {
      policyType,
      effectiveFrom: range.from,
      effectiveTo: to,
      employeeIds,
      closed: closed.map((v) => ({
        id: v.id,
        versionNo: v.version_no,
        effectiveTo: dayBefore(range.from),
      })),
      reason: options.reason,
    },
  );
  return {
    version: inserted,
    closed: closed.map((v) => ({
      id: v.id,
      versionNo: v.version_no,
      effectiveFrom: v.effective_from,
      effectiveTo: dayBefore(range.from),
    })),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Delete / reopen (FIX-C-05)
// ---------------------------------------------------------------------------

export type VersionStatusByDate = 'UPCOMING' | 'CURRENT' | 'EXPIRED';
export function versionStatusByDate(
  v: { effective_from: string; effective_to: string | null },
  today: string,
): VersionStatusByDate {
  if (v.effective_from > today) return 'UPCOMING';
  if (v.effective_to && v.effective_to < today) return 'EXPIRED';
  return 'CURRENT';
}

/** Pure rule: only the newest, not-yet-effective version of its scope chain may be removed. */
export function planVersionRemoval(
  target: PolicyVersionLike,
  all: PolicyVersionLike[],
  today: string,
): { previous: PolicyVersionLike | null; reopenTo: string | null } {
  if (target.effective_from <= today)
    throw new ConflictException(
      'Phiên bản đã có hiệu lực; không xóa. Tạo phiên bản mới hoặc kết thúc phiên bản này để giữ lịch sử.',
    );
  const scope = versionEmployeeIds(target.config_json);
  const sameChain = all.filter(
    (v) =>
      v.id !== target.id &&
      v.status !== 'DRAFT' &&
      scopesCollide(versionEmployeeIds(v.config_json), scope),
  );
  const later = sameChain.filter(
    (v) =>
      v.effective_from > target.effective_from ||
      (v.effective_from === target.effective_from &&
        (v.version_no ?? 0) > (target.version_no ?? 0)),
  );
  if (later.length)
    throw new ConflictException(
      `Không xóa phiên bản ở giữa chuỗi: còn phiên bản mới hơn (${later
        .map((v) => `v${v.version_no ?? '?'} từ ${v.effective_from}`)
        .join(', ')}). Xóa phiên bản mới nhất trước.`,
    );
  const closedDay = dayBefore(target.effective_from);
  const previous =
    sameChain
      .filter((v) => v.effective_to === closedDay)
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ??
    null;
  return { previous, reopenTo: previous ? target.effective_to : null };
}

/** Run inside the delete transaction, before the row is deleted. */
export async function reopenPreviousVersion(
  db: PoolClient,
  tenantId: string,
  policyType: string,
  target: PolicyVersionLike,
  today: string,
  touchUpdatedAt = true,
) {
  const all = await versionsOfType(db, tenantId, policyType);
  const plan = planVersionRemoval(target, all, today);
  if (plan.previous)
    await db.query(
      `UPDATE hrm_schema.policy_versions SET effective_to=$2::date,status='ACTIVE'${
        touchUpdatedAt
          ? ",updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond')"
          : ''
      } WHERE id=$1`,
      [plan.previous.id, plan.reopenTo],
    );
  return plan.previous;
}

export function todayInVietnam(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date());
}
