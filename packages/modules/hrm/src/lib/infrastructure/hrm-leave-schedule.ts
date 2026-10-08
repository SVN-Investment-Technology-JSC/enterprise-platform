import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { CreateLeaveAccrualScheduleRequest } from '@enterprise-platform/contracts-hrm';
import { assertLifecycleVersion, lifecycleAudit } from './hrm-lifecycle.js';
import { isoDate } from './hrm-time.js';
import { requireDate, requireText } from './hrm-validation.js';
import { validateSeniorityTiers } from '../domain/annual-leave-entitlement.js';
import { loadSeniorityTiers } from './hrm-annual-leave.js';

export async function lockAccrualConfiguration(db: PoolClient, tenant: string) {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `hrm-accrual-config:${tenant}`,
  ]);
}
export function validateAccrualSchedule(
  body: CreateLeaveAccrualScheduleRequest,
) {
  requireDate(body.effectiveFrom, 'Ngày hiệu lực');
  if (
    body.effectiveTo &&
    requireDate(body.effectiveTo, 'Ngày kết thúc') < body.effectiveFrom
  )
    throw new BadRequestException('Ngày kết thúc không hợp lệ');
  if (
    !['MONTHLY', 'QUARTERLY', 'YEARLY'].includes(body.accrualFrequency) ||
    !Number.isFinite(body.accrualAmount) ||
    body.accrualAmount < 0 ||
    body.accrualAmount > 366
  )
    throw new BadRequestException('Chu kỳ hoặc định mức phép không hợp lệ');
  if (
    body.accrualBasis !== 'CONTRACT_SIGN_DATE' &&
    body.prorationRule &&
    !['BY_JOIN_DATE', 'NONE'].includes(body.prorationRule)
  )
    throw new BadRequestException('Quy tắc phân bổ không hợp lệ');
  for (const n of [body.seniorityBonusYears ?? 5, body.seniorityBonusDays ?? 1])
    if (!Number.isFinite(n) || n < 0 || n > 100)
      throw new BadRequestException('Định mức thâm niên không hợp lệ');
  const basis = body.accrualBasis ?? 'JOIN_DATE';
  if (!['JOIN_DATE', 'CONTRACT_SIGN_DATE'].includes(basis))
    throw new BadRequestException('Mốc tính phép không hợp lệ');
  const offset = body.startOffsetMonths ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset > 120)
    throw new BadRequestException(
      'Số tháng bắt đầu tính phép phải là số nguyên từ 0 đến 120',
    );
  try {
    validateSeniorityTiers(body.seniorityTiers ?? []);
  } catch (error) {
    throw new BadRequestException((error as Error).message);
  }
  if (basis === 'CONTRACT_SIGN_DATE') {
    if (body.accrualFrequency !== 'MONTHLY')
      throw new BadRequestException(
        'Lịch tính theo ngày ký HĐ phải cộng theo tháng',
      );
    if (
      body.annualDays == null ||
      !Number.isFinite(body.annualDays) ||
      body.annualDays < 0 ||
      body.annualDays > 366
    )
      throw new BadRequestException('Định mức phép năm phải từ 0 đến 366 ngày');
  }
}

/** Chuẩn hoá giá trị cột của lịch cộng phép từ request đã kiểm tra. */
export function accrualScheduleColumns(body: CreateLeaveAccrualScheduleRequest) {
  const contract = body.accrualBasis === 'CONTRACT_SIGN_DATE';
  return {
    accrualBasis: body.accrualBasis ?? 'JOIN_DATE',
    startOffsetMonths: body.startOffsetMonths ?? 0,
    advanceAllowed: Boolean(body.advanceAllowed),
    annualDays: contract ? Number(body.annualDays) : null,
    // Lịch theo HĐ cộng định mức theo tháng = định mức năm / 12 (để hiển thị).
    accrualAmount: contract
      ? Math.round((Number(body.annualDays) / 12) * 100) / 100
      : body.accrualAmount,
    prorationRule: contract ? 'HALF_MONTH' : body.prorationRule || null,
    seniorityBonusYears: contract ? 0 : (body.seniorityBonusYears ?? 5),
    seniorityBonusDays: contract ? 0 : (body.seniorityBonusDays ?? 1),
  };
}

export async function replaceSeniorityTiers(
  db: PoolClient,
  tenant: string,
  scheduleId: string,
  tiers: CreateLeaveAccrualScheduleRequest['seniorityTiers'],
) {
  await db.query(
    'DELETE FROM hrm_schema.leave_seniority_tiers WHERE tenant_id=$1 AND schedule_id=$2',
    [tenant, scheduleId],
  );
  for (const tier of tiers ?? [])
    await db.query(
      'INSERT INTO hrm_schema.leave_seniority_tiers(tenant_id,schedule_id,min_years,bonus_days) VALUES($1,$2,$3,$4)',
      [tenant, scheduleId, tier.minYears, tier.bonusDays],
    );
}
export type AccrualMutation = Partial<CreateLeaveAccrualScheduleRequest> & {
  expectedUpdatedAt: string;
  reason: string;
};
export async function mutateAccrualSchedule(
  db: PoolClient,
  tenant: string,
  actor: string,
  typeId: string,
  id: string,
  body: AccrualMutation,
  action: 'edit' | 'delete' | 'version' | 'deactivate',
) {
  requireText(body.reason, 'Lý do', 1000);
  await lockAccrualConfiguration(db, tenant);
  const type = (
    await db.query(
      'SELECT id FROM hrm_schema.leave_types WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
      [tenant, typeId],
    )
  ).rows[0];
  if (!type) throw new NotFoundException('Không tìm thấy loại nghỉ');
  const before = (
    await db.query(
      'SELECT * FROM hrm_schema.leave_accrual_schedules WHERE tenant_id=$1 AND leave_type_id=$2 AND id=$3 FOR UPDATE',
      [tenant, typeId, id],
    )
  ).rows[0];
  if (!before) throw new NotFoundException('Không tìm thấy lịch cộng phép');
  assertLifecycleVersion(before, body.expectedUpdatedAt);
  const usage = (
    await db.query(
      `SELECT count(*)::int AS count,to_char(max((date_trunc('month',CASE WHEN operation_key ~ ':[0-9]{4}-[0-9]{2}$' THEN to_date(right(operation_key,7),'YYYY-MM') ELSE created_at END)+interval '1 month - 1 day')::date),'YYYY-MM-DD') AS last_month FROM hrm_schema.leave_transactions WHERE tenant_id=$1 AND accrual_schedule_id=$2`,
      [tenant, id],
    )
  ).rows[0];
  if (usage.count && ['edit', 'delete'].includes(action))
    throw new ConflictException(
      'Lịch đã cộng phép; tạo phiên bản mới hoặc kết thúc hiệu lực, không sửa lịch sử.',
    );
  if (action === 'delete') {
    await lifecycleAudit(db, tenant, actor, 'LEAVE_SCHEDULE_DELETED', id, {
      before,
      reason: body.reason,
    });
    await db.query(
      'DELETE FROM hrm_schema.leave_accrual_schedules WHERE tenant_id=$1 AND id=$2',
      [tenant, id],
    );
    return { id, deleted: true };
  }
  const beforePolicy = {
    accrualBasis: before.accrual_basis as 'JOIN_DATE' | 'CONTRACT_SIGN_DATE',
    startOffsetMonths: Number(before.start_offset_months ?? 0),
    advanceAllowed: Boolean(before.advance_allowed),
    annualDays: before.annual_days == null ? null : Number(before.annual_days),
    seniorityTiers:
      (await loadSeniorityTiers(db, tenant, [id])).get(id) ?? [],
  };
  const next: CreateLeaveAccrualScheduleRequest =
    action === 'deactivate'
      ? {
          policyVersionId: before.policy_version_id,
          accrualFrequency: before.accrual_frequency,
          accrualAmount: Number(before.accrual_amount),
          prorationRule: before.proration_rule,
          seniorityBonusYears: Number(before.seniority_bonus_years),
          seniorityBonusDays: Number(before.seniority_bonus_days),
          ...beforePolicy,
          effectiveFrom: isoDate(before.effective_from),
          effectiveTo: body.effectiveTo,
        }
      : {
          policyVersionId:
            body.policyVersionId === undefined
              ? before.policy_version_id
              : body.policyVersionId,
          accrualFrequency: body.accrualFrequency ?? before.accrual_frequency,
          accrualAmount: body.accrualAmount ?? Number(before.accrual_amount),
          prorationRule: body.prorationRule ?? before.proration_rule,
          seniorityBonusYears:
            body.seniorityBonusYears ?? Number(before.seniority_bonus_years),
          seniorityBonusDays:
            body.seniorityBonusDays ?? Number(before.seniority_bonus_days),
          accrualBasis: body.accrualBasis ?? beforePolicy.accrualBasis,
          startOffsetMonths:
            body.startOffsetMonths ?? beforePolicy.startOffsetMonths,
          advanceAllowed: body.advanceAllowed ?? beforePolicy.advanceAllowed,
          annualDays:
            body.annualDays === undefined
              ? beforePolicy.annualDays
              : body.annualDays,
          seniorityTiers: body.seniorityTiers ?? beforePolicy.seniorityTiers,
          effectiveFrom: body.effectiveFrom ?? isoDate(before.effective_from),
          effectiveTo:
            body.effectiveTo === undefined
              ? before.effective_to
                ? isoDate(before.effective_to)
                : null
              : body.effectiveTo,
        };
  validateAccrualSchedule(next);
  if (action === 'deactivate') {
    if (!next.effectiveTo)
      throw new BadRequestException('Cần ngày kết thúc hiệu lực');
    if (usage.last_month && next.effectiveTo < usage.last_month)
      throw new ConflictException(
        'Không được kết thúc trước tháng đã cộng phép',
      );
    if (before.effective_to && next.effectiveTo > isoDate(before.effective_to))
      throw new ConflictException(
        'Không kéo dài lịch đã kết thúc; tạo phiên bản mới',
      );
  }
  if (action === 'version') {
    if (
      !body.effectiveFrom ||
      !body.effectiveFrom.endsWith('-01') ||
      body.effectiveFrom <= isoDate(before.effective_from) ||
      (usage.last_month && body.effectiveFrom <= usage.last_month)
    )
      throw new ConflictException(
        'Phiên bản mới phải bắt đầu đầu tháng, sau hiệu lực cũ và tháng đã cộng phép',
      );
    const month = Number(body.effectiveFrom.slice(5, 7));
    const cycleStart = (frequency: string) =>
      frequency === 'YEARLY'
        ? month === 1
        : frequency === 'QUARTERLY'
          ? (month - 1) % 3 === 0
          : true;
    if (
      !cycleStart(before.accrual_frequency) ||
      !cycleStart(next.accrualFrequency)
    )
      throw new ConflictException(
        'Phiên bản mới phải bắt đầu đầu chu kỳ tháng/quý/năm của cả lịch cũ và mới.',
      );
    await db.query(
      "UPDATE hrm_schema.leave_accrual_schedules SET effective_to=LEAST(COALESCE(effective_to,'infinity'::date),$3::date-1),updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE tenant_id=$1 AND id=$2",
      [tenant, id, next.effectiveFrom],
    );
  }
  if (
    next.policyVersionId &&
    !(
      await db.query(
        'SELECT v.id FROM hrm_schema.policy_versions v JOIN hrm_schema.policies p ON p.id=v.policy_id WHERE p.tenant_id=$1 AND v.id=$2',
        [tenant, next.policyVersionId],
      )
    ).rowCount
  )
    throw new BadRequestException('Phiên bản chính sách không thuộc tenant');
  const overlap = await db.query(
    "SELECT id FROM hrm_schema.leave_accrual_schedules WHERE tenant_id=$1 AND leave_type_id=$2 AND ($5::uuid IS NULL OR id<>$5) AND daterange(effective_from,COALESCE(effective_to,'infinity'::date),'[]') && daterange($3::date,COALESCE($4::date,'infinity'::date),'[]')",
    [
      tenant,
      typeId,
      next.effectiveFrom,
      next.effectiveTo || null,
      action === 'version' ? null : id,
    ],
  );
  if (overlap.rowCount)
    throw new ConflictException('Lịch cộng phép trùng thời gian hiệu lực');
  const cols = accrualScheduleColumns(next);
  const values = [
    tenant,
    typeId,
    next.policyVersionId || null,
    next.accrualFrequency,
    cols.accrualAmount,
    cols.prorationRule,
    cols.seniorityBonusYears,
    cols.seniorityBonusDays,
    next.effectiveFrom,
    next.effectiveTo || null,
    cols.accrualBasis,
    cols.startOffsetMonths,
    cols.advanceAllowed,
    cols.annualDays,
  ];
  const row =
    action === 'version'
      ? (
          await db.query(
            'INSERT INTO hrm_schema.leave_accrual_schedules(tenant_id,leave_type_id,policy_version_id,accrual_frequency,accrual_amount,proration_rule,seniority_bonus_years,seniority_bonus_days,effective_from,effective_to,accrual_basis,start_offset_months,advance_allowed,annual_days) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *',
            values,
          )
        ).rows[0]
      : (
          await db.query(
            "UPDATE hrm_schema.leave_accrual_schedules SET policy_version_id=$3,accrual_frequency=$4,accrual_amount=$5,proration_rule=$6,seniority_bonus_years=$7,seniority_bonus_days=$8,effective_from=$9,effective_to=$10,accrual_basis=$11,start_offset_months=$12,advance_allowed=$13,annual_days=$14,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE tenant_id=$1 AND leave_type_id=$2 AND id=$15 RETURNING *",
            [...values, id],
          )
        ).rows[0];
  await replaceSeniorityTiers(db, tenant, row.id, next.seniorityTiers ?? []);
  await lifecycleAudit(
    db,
    tenant,
    actor,
    `LEAVE_SCHEDULE_${action.toUpperCase()}`,
    id,
    { before, after: row, reason: body.reason },
  );
  return { ...row, seniority_tiers: next.seniorityTiers ?? [] };
}
