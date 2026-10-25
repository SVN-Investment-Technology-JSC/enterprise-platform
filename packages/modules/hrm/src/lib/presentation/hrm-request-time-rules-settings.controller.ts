import { BadRequestException, Body, Controller, Get, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { lifecycleAudit } from '../infrastructure/hrm-lifecycle.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import {
  NO_TIME_RULE,
  requestTimeRulesReady,
  TIME_RULE_KINDS,
  type RequestTimeRule,
} from '../infrastructure/hrm-request-time-rules.js';
import { RequirePermission } from '../infrastructure/hrm-access.guard.js';

/** Quản trị đơn từ cấu hình quy tắc thời gian, cùng quyền với hạn mức đơn và danh mục loại đơn. */
const PERMISSION = 'hrm.leave.manage';

const KIND_LABELS: Record<string, string> = {
  leave: 'Nghỉ phép',
  ot: 'Làm thêm giờ',
  business_trip: 'Công tác',
  shift_change: 'Đổi ca',
  correction: 'Giải trình công',
  advance: 'Ứng lương',
  profile_correction: 'Sửa hồ sơ',
  custom: 'Đơn tuỳ chỉnh',
};

const LIMITS = {
  minNoticeDays: { min: 0, max: 365, label: 'Báo trước tối thiểu' },
  maxBackdateDays: { min: 0, max: 365, label: 'Tạo lùi tối đa' },
  escalateAfterDays: { min: 1, max: 90, label: 'Chuyển dự phòng sau' },
} as const;

type RuleField = keyof typeof LIMITS;

const present = (kind: string, rule: RequestTimeRule) => ({
  requestKind: kind,
  label: KIND_LABELS[kind] ?? kind,
  ...rule,
});

async function listRules(
  pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  tenantId: string,
) {
  const res = await pool.query(
    `SELECT request_kind, min_notice_days, max_backdate_days, escalate_after_days
       FROM hrm_schema.request_time_rules WHERE tenant_id = $1`,
    [tenantId],
  );
  const byKind = new Map(res.rows.map((r) => [String(r['request_kind']), r]));
  return TIME_RULE_KINDS.map((kind) => {
    const row = byKind.get(kind);
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return present(
      kind,
      row
        ? {
            minNoticeDays: num(row['min_notice_days']),
            maxBackdateDays: num(row['max_backdate_days']),
            escalateAfterDays: num(row['escalate_after_days']),
          }
        : NO_TIME_RULE,
    );
  });
}

/**
 * Quy tắc thời gian riêng theo từng loại đơn: báo trước tối thiểu, tạo lùi tối đa, chuyển cho người dự phòng sau N ngày.
 * Ô để trống là chưa dùng quy tắc đó (mặc định).
 */
@Controller('v1')
export class HrmRequestTimeRulesSettingsController {
  constructor(private readonly ctx: HrmContextService) {}

  @RequirePermission(PERMISSION)
  @Get('request-time-rules')
  async get(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(req, PERMISSION);
    const ready = await requestTimeRulesReady(pool);
    const items = ready
      ? await listRules(pool, tenantId)
      : TIME_RULE_KINDS.map((kind) => present(kind, NO_TIME_RULE));
    return { data: { ready, items } };
  }

  /** Lưu các loại đơn có trong danh sách; mọi ô null (hoặc thiếu) là bỏ toàn bộ quy tắc của loại đó. */
  @RequirePermission(PERMISSION)
  @Put('request-time-rules')
  async save(@Req() req: Request, @Body() body: { items?: unknown }) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, PERMISSION);
    if (!Array.isArray(body?.items)) throw new BadRequestException('Danh sách quy tắc thời gian không hợp lệ.');
    if (!(await requestTimeRulesReady(pool)))
      throw new BadRequestException(
        'Cơ sở dữ liệu HRM chưa được cập nhật (migration 0076); chạy migration trước khi cấu hình quy tắc thời gian.',
      );
    const wanted = new Map<string, RequestTimeRule>();
    for (const item of body.items as Array<Record<string, unknown>>) {
      const kind = item?.['requestKind'];
      if (typeof kind !== 'string' || !(TIME_RULE_KINDS as readonly string[]).includes(kind))
        throw new BadRequestException('Loại đơn không hợp lệ.');
      const rule: RequestTimeRule = { ...NO_TIME_RULE };
      for (const field of Object.keys(LIMITS) as RuleField[]) {
        const value = item[field] ?? null;
        const { min, max, label } = LIMITS[field];
        if (value !== null && (!Number.isInteger(value) || (value as number) < min || (value as number) > max))
          throw new BadRequestException(`${label}: nhập số nguyên từ ${min} đến ${max} ngày, hoặc để trống nếu không dùng.`);
        rule[field] = value as number | null;
      }
      wanted.set(kind, rule);
    }
    await hrmTransaction(pool, async (db) => {
      for (const [kind, rule] of wanted) {
        if (rule.minNoticeDays === null && rule.maxBackdateDays === null && rule.escalateAfterDays === null)
          await db.query('DELETE FROM hrm_schema.request_time_rules WHERE tenant_id = $1 AND request_kind = $2', [tenantId, kind]);
        else
          await db.query(
            `INSERT INTO hrm_schema.request_time_rules
               (tenant_id, request_kind, min_notice_days, max_backdate_days, escalate_after_days, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (tenant_id, request_kind) DO UPDATE
               SET min_notice_days = EXCLUDED.min_notice_days, max_backdate_days = EXCLUDED.max_backdate_days,
                   escalate_after_days = EXCLUDED.escalate_after_days, updated_by = EXCLUDED.updated_by, updated_at = now()`,
            [tenantId, kind, rule.minNoticeDays, rule.maxBackdateDays, rule.escalateAfterDays, principal.userId],
          );
      }
      await lifecycleAudit(db, tenantId, principal.userId, 'REQUEST_TIME_RULES_SAVED', tenantId, {
        items: [...wanted].map(([requestKind, rule]) => ({ requestKind, ...rule })),
      });
    });
    return { data: { ready: true, items: await listRules(pool, tenantId) } };
  }
}
