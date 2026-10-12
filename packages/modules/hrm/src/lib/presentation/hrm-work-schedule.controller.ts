import type {
  CreateHolidayRequest,
  HrmApplyScheduleRequest,
  HrmCancelScheduleRequest,
  HrmCopyScheduleRequest,
  HrmOrgUnitOption,
  SaveScheduleTemplateRequest,
} from '@enterprise-platform/contracts-hrm';
import type { HrmAction } from '@enterprise-platform/contracts-identity';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { normalizePattern, patternShiftIds, type WeekdayRule } from '../domain/work-schedule.js';
import { RequirePermission } from '../infrastructure/hrm-access.guard.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { lifecycleAudit } from '../infrastructure/hrm-lifecycle.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { isoDate } from '../infrastructure/hrm-time.js';
import {
  applySchedule,
  assertWorkScheduleReady,
  cancelHoliday,
  cancelSchedule,
  copySchedule,
  createHoliday,
  guard,
  loadShifts,
  previewSchedule,
  queryScheduleAudit,
  queryScheduleExport,
  queryScheduleGrid,
  queryScheduleList,
  validateScope,
  type ApplyScheduleInput,
} from '../infrastructure/hrm-work-schedule.js';
import { requireDate, requireText, requireUuid } from '../infrastructure/hrm-validation.js';
import {
  applyRule,
  cancelRule,
  endRule,
  isOpenEnded,
  listRules,
  previewRule,
} from '../infrastructure/hrm-work-schedule-rules.js';

const meta = (req: Request) => ({ requestId: req.headers['x-request-id'] as string });

/**
 * Phân ca làm việc: mẫu lịch tuần, gán lịch (từng người / hàng loạt / phòng ban / toàn công ty),
 * ngoại lệ, ngày lễ, nhật ký. Dùng danh mục ca có sẵn (shift_definitions); không tạo danh mục ca riêng.
 * Quyền kiểm ở đây (backend), không chỉ ẩn menu.
 */
@Controller('v1')
export class HrmWorkScheduleController {
  constructor(private readonly ctx: HrmContextService) {}

  /** Quyền cần cho một thao tác ghi lịch: ngoại lệ cần quyền lịch lễ/ngoại lệ; nhiều người/phòng ban/toàn công ty cần quyền hàng loạt. */
  private requiredFor(input: { kind?: string; scope?: { type?: string }; conflictMode?: string }): HrmAction[] {
    const needed = new Set<HrmAction>();
    needed.add(input.scope?.type === 'EMPLOYEE' ? 'hrm.schedule.manage' : 'hrm.schedule.bulk');
    if (input.kind === 'EXCEPTION' || input.conflictMode === 'OVERWRITE_ALL') needed.add('hrm.schedule.calendar');
    return [...needed];
  }

  private async context(req: Request, permissions: HrmAction[]) {
    let result: Awaited<ReturnType<HrmContextService['getContext']>> | undefined;
    for (const permission of permissions) result = await this.ctx.getContext(req, permission);
    return result!;
  }

  /** Danh sách đơn vị tổ chức để chọn phạm vi phân ca. */
  @RequirePermission('hrm.schedule.read')
  @Get('shift-units')
  async listUnits(@Req() req: Request) {
    const { pool } = await this.ctx.getContext(req, 'hrm.schedule.read');
    const res = await pool.query(
      `SELECT id, parent_id, code, name FROM core_schema.organization_nodes
        WHERE deleted_at IS NULL AND category <> 'position' AND status = 'active'
        ORDER BY sort_order, name`,
    );
    const data: HrmOrgUnitOption[] = res.rows.map((r) => ({
      id: r.id,
      parentId: r.parent_id ?? null,
      code: r.code,
      name: r.name,
    }));
    return { data, meta: meta(req) };
  }

  // ------------------------------------------------------------------ Mẫu lịch tuần

  private mapTemplate(row: Record<string, unknown>, days: Record<string, unknown>[]) {
    return {
      id: row.id as string,
      code: row.code as string,
      name: row.name as string,
      description: (row.description as string | null) ?? null,
      status: row.status as 'ACTIVE' | 'INACTIVE',
      days: days
        .filter((d) => d.template_id === row.id)
        .map((d) => ({ weekday: Number(d.weekday), dayType: d.day_type as 'SHIFT' | 'OFF', shiftId: (d.shift_id as string | null) ?? null }))
        .sort((a, b) => a.weekday - b.weekday),
      createdAt: new Date(row.created_at as string).toISOString(),
      updatedAt: new Date(row.updated_at as string).toISOString(),
    };
  }

  @RequirePermission('hrm.schedule.read')
  @Get('work-schedule-templates')
  async listTemplates(@Req() req: Request, @Query('status') status?: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.schedule.read');
    await assertWorkScheduleReady(pool, tenantId);
    const t = await pool.query(
      `SELECT * FROM hrm_schema.work_schedule_templates WHERE tenant_id = $1 AND ($2::text IS NULL OR status = $2) ORDER BY name`,
      [tenantId, status === 'ACTIVE' || status === 'INACTIVE' ? status : null],
    );
    const d = await pool.query(`SELECT * FROM hrm_schema.work_schedule_template_days WHERE tenant_id = $1`, [tenantId]);
    return { data: t.rows.map((r) => this.mapTemplate(r, d.rows)), meta: { total: t.rows.length, ...meta(req) } };
  }

  private templateInput(body: SaveScheduleTemplateRequest) {
    const code = requireText(body.code, 'code', 50).toUpperCase();
    if (!/^[A-Z0-9_-]+$/.test(code)) throw new BadRequestException({ code: 'HRM_INVALID_INPUT', message: 'code chỉ gồm chữ, số, gạch ngang và gạch dưới' });
    const name = requireText(body.name, 'name', 200);
    const days = (body.days ?? []) as WeekdayRule[];
    guard(() => normalizePattern(days));
    return {
      code,
      name,
      description: body.description?.toString().slice(0, 2000) || null,
      status: body.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
      days: days.filter((d) => d.dayType !== 'SKIP'),
    };
  }

  private async writeTemplateDays(db: Parameters<typeof loadShifts>[0], tenantId: string, templateId: string, days: WeekdayRule[]) {
    await loadShifts(db, tenantId, patternShiftIds(days));
    await db.query(`DELETE FROM hrm_schema.work_schedule_template_days WHERE tenant_id = $1 AND template_id = $2`, [tenantId, templateId]);
    if (days.length)
      await db.query(
        `INSERT INTO hrm_schema.work_schedule_template_days (tenant_id, template_id, weekday, day_type, shift_id)
         SELECT $1, $2, u.weekday, u.day_type, u.shift_id FROM unnest($3::smallint[], $4::text[], $5::uuid[]) AS u(weekday, day_type, shift_id)`,
        [tenantId, templateId, days.map((d) => d.weekday), days.map((d) => d.dayType), days.map((d) => d.shiftId ?? null)],
      );
  }

  private async templateById(db: Parameters<typeof loadShifts>[0], tenantId: string, id: string) {
    const t = await db.query(`SELECT * FROM hrm_schema.work_schedule_templates WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
    if (!t.rows[0]) throw new NotFoundException('Không tìm thấy mẫu lịch');
    const d = await db.query(`SELECT * FROM hrm_schema.work_schedule_template_days WHERE tenant_id = $1 AND template_id = $2`, [tenantId, id]);
    return this.mapTemplate(t.rows[0], d.rows);
  }

  @RequirePermission('hrm.schedule.manage')
  @Post('work-schedule-templates')
  async createTemplate(@Req() req: Request, @Body() body: SaveScheduleTemplateRequest) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.schedule.manage');
    const input = this.templateInput(body);
    const id = await hrmTransaction(pool, async (db) => {
      await assertWorkScheduleReady(db, tenantId);
      const dup = await db.query(`SELECT 1 FROM hrm_schema.work_schedule_templates WHERE tenant_id = $1 AND code = $2`, [tenantId, input.code]);
      if (dup.rowCount) throw new ConflictException({ code: 'HRM_SCHEDULE_TEMPLATE_DUPLICATE', message: `Mã mẫu lịch ${input.code} đã tồn tại` });
      const res = await db.query(
        `INSERT INTO hrm_schema.work_schedule_templates (tenant_id, code, name, description, status, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [tenantId, input.code, input.name, input.description, input.status, principal.userId],
      );
      await this.writeTemplateDays(db, tenantId, res.rows[0].id, input.days);
      await lifecycleAudit(db, tenantId, principal.userId, 'WORK_SCHEDULE_TEMPLATE_CREATED', res.rows[0].id, { input });
      return res.rows[0].id as string;
    });
    return { data: await this.templateById(pool, tenantId, id), meta: meta(req) };
  }

  /** Sửa mẫu KHÔNG đổi lịch đã gán (lịch đã sinh sẵn từng ngày). Muốn áp mẫu mới cho lịch cũ dùng /reapply. */
  @RequirePermission('hrm.schedule.manage')
  @Patch('work-schedule-templates/:id')
  async updateTemplate(@Req() req: Request, @Param('id') id: string, @Body() body: SaveScheduleTemplateRequest) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.schedule.manage');
    requireUuid(id, 'id');
    const input = this.templateInput(body);
    await hrmTransaction(pool, async (db) => {
      await assertWorkScheduleReady(db, tenantId);
      const found = await db.query(`SELECT * FROM hrm_schema.work_schedule_templates WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, id]);
      if (!found.rows[0]) throw new NotFoundException('Không tìm thấy mẫu lịch');
      const dup = await db.query(`SELECT 1 FROM hrm_schema.work_schedule_templates WHERE tenant_id = $1 AND code = $2 AND id <> $3`, [tenantId, input.code, id]);
      if (dup.rowCount) throw new ConflictException({ code: 'HRM_SCHEDULE_TEMPLATE_DUPLICATE', message: `Mã mẫu lịch ${input.code} đã tồn tại` });
      const before = await this.templateById(db, tenantId, id);
      await db.query(
        `UPDATE hrm_schema.work_schedule_templates SET code = $3, name = $4, description = $5, status = $6, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id, input.code, input.name, input.description, input.status],
      );
      await this.writeTemplateDays(db, tenantId, id, input.days);
      await lifecycleAudit(db, tenantId, principal.userId, 'WORK_SCHEDULE_TEMPLATE_UPDATED', id, { before, after: input });
    });
    return { data: await this.templateById(pool, tenantId, id), meta: meta(req) };
  }

  @RequirePermission('hrm.schedule.manage')
  @Post('work-schedule-templates/:id/copy')
  async copyTemplate(@Req() req: Request, @Param('id') id: string, @Body() body: { code: string; name: string }) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.schedule.manage');
    requireUuid(id, 'id');
    const source = await this.templateById(pool, tenantId, id);
    const copy = this.templateInput({ code: body.code, name: body.name, description: source.description, status: 'ACTIVE', days: source.days });
    const newId = await hrmTransaction(pool, async (db) => {
      const dup = await db.query(`SELECT 1 FROM hrm_schema.work_schedule_templates WHERE tenant_id = $1 AND code = $2`, [tenantId, copy.code]);
      if (dup.rowCount) throw new ConflictException({ code: 'HRM_SCHEDULE_TEMPLATE_DUPLICATE', message: `Mã mẫu lịch ${copy.code} đã tồn tại` });
      const res = await db.query(
        `INSERT INTO hrm_schema.work_schedule_templates (tenant_id, code, name, description, status, created_by) VALUES ($1,$2,$3,$4,'ACTIVE',$5) RETURNING id`,
        [tenantId, copy.code, copy.name, copy.description, principal.userId],
      );
      await this.writeTemplateDays(db, tenantId, res.rows[0].id, copy.days);
      await lifecycleAudit(db, tenantId, principal.userId, 'WORK_SCHEDULE_TEMPLATE_COPIED', res.rows[0].id, { sourceId: id });
      return res.rows[0].id as string;
    });
    return { data: await this.templateById(pool, tenantId, newId), meta: meta(req) };
  }

  /** Ngừng dùng mẫu (không xoá cứng: các đợt đã áp dụng vẫn tham chiếu mẫu này). */
  @RequirePermission('hrm.schedule.manage')
  @Post('work-schedule-templates/:id/deactivate')
  async deactivateTemplate(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.schedule.manage');
    requireUuid(id, 'id');
    await hrmTransaction(pool, async (db) => {
      const res = await db.query(
        `UPDATE hrm_schema.work_schedule_templates SET status = 'INACTIVE', updated_at = now() WHERE tenant_id = $1 AND id = $2 RETURNING id`,
        [tenantId, id],
      );
      if (!res.rowCount) throw new NotFoundException('Không tìm thấy mẫu lịch');
      await lifecycleAudit(db, tenantId, principal.userId, 'WORK_SCHEDULE_TEMPLATE_DEACTIVATED', id, {});
    });
    return { data: { id }, meta: meta(req) };
  }

  /**
   * Chủ động áp lại mẫu (đã sửa) cho những nhân viên từng được gán từ mẫu này trong khoảng ngày.
   * dryRun mặc định: chỉ xem phạm vi ảnh hưởng. Giữ ngoại lệ và ngày lễ.
   */
  @RequirePermission('hrm.schedule.bulk')
  @Post('work-schedule-templates/:id/reapply')
  async reapplyTemplate(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { fromDate: string; toDate: string; confirm?: boolean; dryRun?: boolean; reason?: string },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.schedule.bulk');
    requireUuid(id, 'id');
    const from = requireDate(body.fromDate, 'fromDate');
    const to = requireDate(body.toDate, 'toDate');
    const build = async (db: Parameters<typeof loadShifts>[0]): Promise<ApplyScheduleInput> => {
      await assertWorkScheduleReady(db, tenantId);
      const ids = await db.query(
        `SELECT DISTINCT w.employee_id FROM hrm_schema.employee_work_days w JOIN hrm_schema.work_schedule_batches b ON b.id = w.batch_id
          WHERE w.tenant_id = $1 AND w.status = 'ACTIVE' AND w.source = 'TEMPLATE' AND b.template_id = $2 AND w.work_date BETWEEN $3::date AND $4::date`,
        [tenantId, id, from, to],
      );
      if (!ids.rowCount) throw new BadRequestException({ code: 'HRM_INVALID_INPUT', message: 'Không có nhân viên nào đang dùng mẫu này trong khoảng ngày đã chọn' });
      return {
        scope: { type: 'EMPLOYEES', employeeIds: ids.rows.map((r) => r.employee_id as string) },
        templateId: id,
        fromDate: from,
        toDate: to,
        conflictMode: 'OVERWRITE_KEEP_EXCEPTIONS',
        reason: body.reason ?? 'Áp lại mẫu lịch đã chỉnh sửa',
        confirm: body.confirm === true,
      };
    };
    if (body.dryRun !== false && body.confirm !== true) {
      const preview = await previewSchedule(pool, tenantId, await build(pool));
      return { data: preview, meta: meta(req) };
    }
    const result = await hrmTransaction(pool, async (db) => applySchedule(db, tenantId, principal.userId, await build(db)));
    return { data: result, meta: meta(req) };
  }

  // ------------------------------------------------------------------ Tra cứu lịch

  private scheduleQuery(q: Record<string, string | undefined>) {
    return {
      from: q.from as string,
      to: q.to as string,
      unitId: q.unitId || null,
      includeChildUnits: q.includeChildUnits !== 'false',
      employeeId: q.employeeId || null,
      q: q.q || null,
      coverage: q.coverage === 'unassigned' ? ('unassigned' as const) : null,
      page: q.page ? Number(q.page) : undefined,
      pageSize: q.pageSize ? Number(q.pageSize) : undefined,
    };
  }

  @RequirePermission('hrm.schedule.read')
  @Get('work-schedules/grid')
  async grid(@Req() req: Request, @Query() query: Record<string, string | undefined>) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.schedule.read');
    return { ...(await queryScheduleGrid(pool, tenantId, this.scheduleQuery(query))), requestId: meta(req).requestId };
  }

  @RequirePermission('hrm.schedule.read')
  @Get('work-schedules/list')
  async list(@Req() req: Request, @Query() query: Record<string, string | undefined>) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.schedule.read');
    const result = await queryScheduleList(pool, tenantId, this.scheduleQuery(query));
    return { data: result.rows, meta: { ...result.meta, ...meta(req) } };
  }

  /** Dữ liệu từng ngày (gồm cả ngày từ lịch định kỳ) để xuất Excel/CSV theo bộ lọc, tối đa 100.000 dòng. */
  @RequirePermission('hrm.schedule.read')
  @Get('work-schedules/export')
  async exportSchedule(@Req() req: Request, @Query() query: Record<string, string | undefined>) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.schedule.read');
    const q = this.scheduleQuery(query);
    const data = await queryScheduleExport(pool, tenantId, q);
    await lifecycleAudit(pool, tenantId, principal.userId, 'WORK_SCHEDULE_EXPORT', tenantId, { from: q.from, to: q.to, rows: data.length });
    return { data, meta: { total: data.length, ...meta(req) } };
  }

  // ------------------------------------------------------------------ Lịch định kỳ (không có ngày kết thúc)

  @RequirePermission('hrm.schedule.read')
  @Get('work-schedules/rules')
  async rules(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('scopeType') scopeType?: string,
    @Query('unitId') unitId?: string,
    @Query('employeeId') employeeId?: string,
    @Query('activeOn') activeOn?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.schedule.read');
    const data = await listRules(pool, tenantId, { status, scopeType, unitId, employeeId, activeOn });
    return { data, meta: { total: data.length, ...meta(req) } };
  }

  /** Kết thúc / huỷ lịch định kỳ: của một nhân viên cần quyền gán; của phòng ban hoặc toàn công ty cần quyền hàng loạt. */
  private async ruleContext(req: Request, id: string) {
    const first = await this.ctx.getContext(req, 'hrm.schedule.manage');
    requireUuid(id, 'id');
    const found = await first.pool.query(`SELECT scope_type FROM hrm_schema.work_schedule_rules WHERE tenant_id = $1 AND id = $2`, [first.tenantId, id]);
    if (!found.rows[0]) throw new NotFoundException('Không tìm thấy lịch định kỳ');
    return found.rows[0].scope_type === 'EMPLOYEE' ? first : await this.ctx.getContext(req, 'hrm.schedule.bulk');
  }

  @RequirePermission('hrm.schedule.manage')
  @Post('work-schedules/rules/:id/end')
  async endRule(@Req() req: Request, @Param('id') id: string, @Body() body: { endDate: string; reason?: string }) {
    const { pool, tenantId, principal } = await this.ruleContext(req, id);
    const data = await hrmTransaction(pool, (db) => endRule(db, tenantId, principal.userId, id, body?.endDate, body?.reason?.toString().slice(0, 500) || null));
    return { data, meta: meta(req) };
  }

  @RequirePermission('hrm.schedule.manage')
  @Post('work-schedules/rules/:id/cancel')
  async cancelRule(@Req() req: Request, @Param('id') id: string, @Body() body: { reason?: string } = {}) {
    const { pool, tenantId, principal } = await this.ruleContext(req, id);
    const data = await hrmTransaction(pool, (db) => cancelRule(db, tenantId, principal.userId, id, body?.reason?.toString().slice(0, 500) || null));
    return { data, meta: meta(req) };
  }

  @RequirePermission('hrm.schedule.read')
  @Get('work-schedules/audit')
  async audit(@Req() req: Request, @Query('employeeId') employeeId?: string, @Query('batchId') batchId?: string, @Query('limit') limit?: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.schedule.read');
    const data = await queryScheduleAudit(pool, tenantId, { employeeId, batchId, limit: limit ? Number(limit) : undefined });
    return { data, meta: { total: data.length, ...meta(req) } };
  }

  // ------------------------------------------------------------------ Ghi lịch

  @RequirePermission('hrm.schedule.manage')
  @Post('work-schedules/preview')
  async preview(@Req() req: Request, @Body() body: HrmApplyScheduleRequest) {
    const scope = guard(() => validateScope(body?.scope as never));
    const { pool, tenantId } = await this.context(req, this.requiredFor({ ...body, scope }));
    const input = body as unknown as ApplyScheduleInput;
    const data = isOpenEnded(input) ? await previewRule(pool, tenantId, input) : await previewSchedule(pool, tenantId, input);
    return { data, meta: meta(req) };
  }

  @RequirePermission('hrm.schedule.manage')
  @Post('work-schedules')
  async apply(@Req() req: Request, @Body() body: HrmApplyScheduleRequest) {
    const scope = guard(() => validateScope(body?.scope as never));
    const { pool, tenantId, principal } = await this.context(req, this.requiredFor({ ...body, scope }));
    const input = body as unknown as ApplyScheduleInput;
    const data = await hrmTransaction<unknown>(pool, (db) =>
      isOpenEnded(input) ? applyRule(db, tenantId, principal.userId, input) : applySchedule(db, tenantId, principal.userId, input),
    );
    return { data, meta: meta(req) };
  }

  @RequirePermission('hrm.schedule.manage')
  @Post('work-schedules/cancel')
  async cancel(@Req() req: Request, @Body() body: HrmCancelScheduleRequest) {
    const scope = guard(() => validateScope(body?.scope as never));
    const needed = this.requiredFor({ scope });
    if (body.includeExceptions) needed.push('hrm.schedule.calendar');
    const { pool, tenantId, principal } = await this.context(req, needed);
    const data = await hrmTransaction(pool, (db) =>
      cancelSchedule(db, tenantId, principal.userId, body as never, body.dryRun === true),
    );
    return { data, meta: meta(req) };
  }

  @RequirePermission('hrm.schedule.bulk')
  @Post('work-schedules/copy')
  async copy(@Req() req: Request, @Body() body: HrmCopyScheduleRequest) {
    guard(() => validateScope(body?.scope as never));
    const { pool, tenantId, principal } = await this.context(req, ['hrm.schedule.bulk', ...(body.conflictMode === 'OVERWRITE_ALL' ? (['hrm.schedule.calendar'] as HrmAction[]) : [])]);
    const data = await hrmTransaction(pool, (db) =>
      copySchedule(db, tenantId, principal.userId, body as never, body.dryRun === true),
    );
    return { data, meta: meta(req) };
  }

  // ------------------------------------------------------------------ Ngày lễ / đặc biệt

  @RequirePermission('hrm.schedule.read')
  @Get('work-schedule-holidays')
  async listHolidays(@Req() req: Request, @Query('year') year?: string, @Query('status') status?: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.schedule.read');
    await assertWorkScheduleReady(pool, tenantId);
    const y = year ? Number(year) : null;
    if (y !== null && (!Number.isInteger(y) || y < 2000 || y > 2100)) throw new BadRequestException({ code: 'HRM_INVALID_INPUT', message: 'year không hợp lệ' });
    const res = await pool.query(
      `SELECT h.*, s.code AS shift_code FROM hrm_schema.company_holidays h LEFT JOIN hrm_schema.shift_definitions s ON s.id = h.shift_id
        WHERE h.tenant_id = $1 AND ($2::int IS NULL OR (h.from_date <= make_date($2::int,12,31) AND h.to_date >= make_date($2::int,1,1)))
          AND ($3::text IS NULL OR h.status = $3) ORDER BY h.from_date`,
      [tenantId, y, status === 'ACTIVE' || status === 'CANCELLED' ? status : null],
    );
    return {
      data: res.rows.map((h) => ({
        id: h.id as string,
        name: h.name as string,
        kind: h.kind,
        fromDate: isoDate(h.from_date),
        toDate: isoDate(h.to_date),
        scopeType: h.scope_type,
        scope: h.scope,
        treatment: h.treatment,
        shiftId: h.shift_id ?? null,
        shiftCode: h.shift_code ?? null,
        paid: h.paid,
        note: h.note ?? null,
        status: h.status,
      })),
      meta: { total: res.rows.length, ...meta(req) },
    };
  }

  @RequirePermission('hrm.schedule.calendar')
  @Post('work-schedule-holidays')
  async createHoliday(@Req() req: Request, @Body() body: CreateHolidayRequest) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.schedule.calendar');
    const data = await hrmTransaction(pool, (db) => createHoliday(db, tenantId, principal.userId, body as never));
    return { data, meta: meta(req) };
  }

  @RequirePermission('hrm.schedule.calendar')
  @Post('work-schedule-holidays/:id/cancel')
  async cancelHoliday(@Req() req: Request, @Param('id') id: string, @Body() body: { reason?: string } = {}) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.schedule.calendar');
    const data = await hrmTransaction(pool, (db) => cancelHoliday(db, tenantId, principal.userId, id, body?.reason?.toString().slice(0, 500) || null));
    return { data, meta: meta(req) };
  }
}
