import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { policyForMonth, validateEffectiveMonth, validateMonthStandard } from '../domain/standard-workdays.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { lifecycleAudit } from '../infrastructure/hrm-lifecycle.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { requireUuid } from '../infrastructure/hrm-validation.js';
import { todayInVietnam } from '../infrastructure/hrm-timesheet-month.js';

const PERMISSION = 'hrm.time.configure';

function mapPolicy(row: Record<string, any>) {
  return {
    id: String(row.id),
    effectiveMonth: String(row.effective_month),
    mode: row.mode as 'DYNAMIC' | 'FIXED',
    workdays: row.workdays == null ? null : Number(row.workdays),
    note: (row.note as string | null) ?? null,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

const currentMonthOf = () => todayInVietnam().slice(0, 7);

/**
 * Chính sách công chuẩn của bảng công: mỗi chính sách có hiệu lực từ một tháng đến khi có chính sách mới thay thế.
 * Tách khỏi công chuẩn trong chính sách lương, vốn chỉ dùng cho tính lương. Chưa có chính sách thì công chuẩn động.
 * Chỉ ban hành hoặc xóa chính sách từ tháng hiện tại trở đi để giữ nguyên lịch sử.
 */
@Controller('v1/timesheet-standards')
export class HrmTimesheetStandardController {
  constructor(private readonly ctx: HrmContextService) {}

  @Get()
  async list(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(req, PERMISSION);
    const res = await pool.query(
      `SELECT * FROM hrm_schema.timesheet_standard_policies WHERE tenant_id = $1 ORDER BY effective_month DESC`,
      [tenantId],
    );
    const policies = res.rows.map(mapPolicy);
    const currentMonth = currentMonthOf();
    return {
      data: { policies, currentMonth, currentId: policyForMonth(policies, currentMonth)?.id ?? null },
      meta: { total: policies.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  /** Ban hành chính sách mới từ một tháng; cùng tháng đã có chính sách thì thay thế nội dung. */
  @Post()
  async issue(
    @Req() req: Request,
    @Body() body: { effectiveMonth?: unknown; mode?: unknown; workdays?: unknown; note?: unknown },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, PERMISSION);
    const monthError = validateEffectiveMonth(body?.effectiveMonth, currentMonthOf());
    if (monthError) throw new BadRequestException(monthError);
    const invalid = validateMonthStandard(body);
    if (invalid) throw new BadRequestException(invalid);
    const effectiveMonth = body.effectiveMonth as string;
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;
    const workdays = body.mode === 'FIXED' ? Number(body.workdays) : null;
    const row = await hrmTransaction(pool, async (db) => {
      const saved = await db.query(
        `INSERT INTO hrm_schema.timesheet_standard_policies (tenant_id, effective_month, mode, workdays, note, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id, effective_month) DO UPDATE
           SET mode = EXCLUDED.mode, workdays = EXCLUDED.workdays, note = EXCLUDED.note,
               updated_by = EXCLUDED.updated_by, updated_at = now()
         RETURNING *`,
        [tenantId, effectiveMonth, body.mode, workdays, note, principal.userId],
      );
      await lifecycleAudit(db, tenantId, principal.userId, 'TIMESHEET_STANDARD_ISSUED', saved.rows[0].id, {
        effectiveMonth,
        mode: body.mode,
        workdays,
      });
      return saved.rows[0];
    });
    return { data: mapPolicy(row) };
  }

  /** Xóa chính sách chưa có hiệu lực (tháng bắt đầu sau tháng hiện tại). */
  @Delete(':id')
  async remove(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, PERMISSION);
    requireUuid(id, 'Chính sách');
    await hrmTransaction(pool, async (db) => {
      const found = await db.query(
        `SELECT * FROM hrm_schema.timesheet_standard_policies WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, id],
      );
      const row = found.rows[0];
      if (!row) throw new NotFoundException('Không tìm thấy chính sách công chuẩn');
      if (String(row.effective_month) <= currentMonthOf())
        throw new BadRequestException('Chính sách đã có hiệu lực, không xóa được; hãy ban hành chính sách mới để thay thế');
      await db.query(`DELETE FROM hrm_schema.timesheet_standard_policies WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
      await lifecycleAudit(db, tenantId, principal.userId, 'TIMESHEET_STANDARD_REMOVED', id, {
        effectiveMonth: row.effective_month,
      });
    });
    return { data: { id } };
  }
}
