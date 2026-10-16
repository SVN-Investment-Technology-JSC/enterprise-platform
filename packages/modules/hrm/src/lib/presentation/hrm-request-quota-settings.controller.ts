import { BadRequestException, Body, Controller, Get, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { lifecycleAudit } from '../infrastructure/hrm-lifecycle.js';
import { ENGINE_REQUEST_KIND } from '../infrastructure/hrm-request-types.js';
import {
  countApprovedInMonth,
  quotaTypeCode,
  requestQuotaReady,
} from '../infrastructure/hrm-request-quota.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';

/** Quản trị đơn từ cấu hình hạn mức, cùng quyền với danh mục loại đơn và lý do. */
const PERMISSION = 'hrm.leave.manage';

interface TypeRow {
  code: string;
  name: string;
  engine: keyof typeof ENGINE_REQUEST_KIND;
  active: boolean;
  monthly_limit: number | null;
}

const LIST_SQL = `SELECT c.code, c.name, c.engine, c.active, q.monthly_limit
    FROM hrm_schema.request_reason_categories c
    LEFT JOIN hrm_schema.request_quota_settings q ON q.tenant_id = c.tenant_id AND upper(q.type_code) = upper(c.code)
   WHERE c.tenant_id = $1 AND c.deleted_at IS NULL AND c.active AND c.engine <> 'SHIFT_CHANGE'
   ORDER BY c.sort_order, c.name`;
const LIST_SQL_NO_QUOTA = `SELECT c.code, c.name, c.engine, c.active, NULL::int AS monthly_limit
    FROM hrm_schema.request_reason_categories c
   WHERE c.tenant_id = $1 AND c.deleted_at IS NULL AND c.active AND c.engine <> 'SHIFT_CHANGE'
   ORDER BY c.sort_order, c.name`;

const present = (row: TypeRow) => ({
  typeCode: row.code,
  typeName: row.name,
  active: row.active,
  monthlyLimit: row.monthly_limit === null ? null : Number(row.monthly_limit),
});

/**
 * Hạn mức số đơn được duyệt mỗi tháng của một nhân viên, đặt riêng theo từng loại đơn. Loại đơn không có hạn mức thì
 * không giới hạn. Đã đủ hạn mức thì không tạo thêm đơn, và đơn đang chờ của tháng đó không duyệt được nữa.
 */
@Controller('v1')
export class HrmRequestQuotaSettingsController {
  constructor(private readonly ctx: HrmContextService) {}

  @Get('request-quota-settings')
  async get(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(req, PERMISSION);
    const ready = await requestQuotaReady(pool);
    const res = await pool.query(ready ? LIST_SQL : LIST_SQL_NO_QUOTA, [tenantId]);
    return { data: { ready, items: (res.rows as TypeRow[]).map(present) } };
  }

  /** Lưu cả danh sách: `monthlyLimit` null hoặc thiếu là bỏ hạn mức (không giới hạn) của loại đơn đó. */
  @Put('request-quota-settings')
  async save(@Req() req: Request, @Body() body: { items?: unknown }) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, PERMISSION);
    if (!Array.isArray(body?.items)) throw new BadRequestException('Danh sách hạn mức không hợp lệ.');
    if (!(await requestQuotaReady(pool)))
      throw new BadRequestException(
        'Cơ sở dữ liệu HRM chưa được cập nhật (migration 0064); chạy migration trước khi cấu hình hạn mức đơn.',
      );
    const wanted = new Map<string, number | null>();
    for (const item of body.items as Array<{ typeCode?: unknown; monthlyLimit?: unknown }>) {
      if (typeof item?.typeCode !== 'string' || !item.typeCode)
        throw new BadRequestException('Thiếu mã loại đơn.');
      const limit = item.monthlyLimit ?? null;
      if (limit !== null && (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 1000))
        throw new BadRequestException('Hạn mức phải là số nguyên từ 1 đến 1000, hoặc để trống nếu không giới hạn.');
      wanted.set(item.typeCode.toUpperCase(), limit as number | null);
    }
    await hrmTransaction(pool, async (db) => {
      const types = await db.query(
        'SELECT upper(code) AS code FROM hrm_schema.request_reason_categories WHERE tenant_id = $1 AND deleted_at IS NULL',
        [tenantId],
      );
      const known = new Set(types.rows.map((r) => String(r.code)));
      for (const code of wanted.keys()) if (!known.has(code)) throw new BadRequestException(`Loại đơn ${code} không tồn tại.`);
      for (const [code, limit] of wanted) {
        if (limit === null)
          await db.query(
            'DELETE FROM hrm_schema.request_quota_settings WHERE tenant_id = $1 AND upper(type_code) = $2',
            [tenantId, code],
          );
        else
          await db.query(
            `INSERT INTO hrm_schema.request_quota_settings (tenant_id, type_code, monthly_limit, updated_by)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (tenant_id, type_code) DO UPDATE
               SET monthly_limit = EXCLUDED.monthly_limit, updated_by = EXCLUDED.updated_by, updated_at = now()`,
            [tenantId, code, limit, principal.userId],
          );
      }
      await lifecycleAudit(db, tenantId, principal.userId, 'REQUEST_QUOTA_SETTINGS_SAVED', tenantId, {
        items: [...wanted].map(([typeCode, monthlyLimit]) => ({ typeCode, monthlyLimit })),
      });
    });
    const res = await pool.query(LIST_SQL, [tenantId]);
    return { data: { ready: true, items: (res.rows as TypeRow[]).map(present) } };
  }

  /** Hạn mức và số đơn đã duyệt tháng này của chính người dùng, theo từng loại đơn có đặt hạn mức (cho form tạo đơn). */
  @Get('request-quota/me')
  async mine(@Req() req: Request) {
    const { pool, tenantId, employeeId } = await this.ctx.getRequestContext(req);
    if (!(await requestQuotaReady(pool))) return { data: { items: [] } };
    const res = await pool.query(LIST_SQL, [tenantId]);
    const items = [];
    for (const row of (res.rows as TypeRow[]).filter((r) => r.monthly_limit !== null)) {
      const kind = ENGINE_REQUEST_KIND[row.engine] ?? 'custom';
      const code = quotaTypeCode(kind, { type_code: row.code });
      if (!code) continue;
      const used = await countApprovedInMonth(pool, tenantId, employeeId, kind, code, new Date());
      const limit = Number(row.monthly_limit);
      items.push({ typeCode: row.code, limit, used, remaining: Math.max(0, limit - used) });
    }
    return { data: { items } };
  }
}
