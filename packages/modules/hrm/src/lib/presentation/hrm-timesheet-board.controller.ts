import type {
  HrmBoardFlag,
  HrmMonthCloseState,
  HrmTimesheetBoard,
} from '@enterprise-platform/contracts-hrm';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermission } from '../infrastructure/hrm-access.guard.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { HrmMissingSchemaInterceptor } from '../infrastructure/hrm-missing-schema.interceptor.js';
import { loadBoard } from '../infrastructure/hrm-timesheet-board.js';
import {
  boardFlagsOf,
  emptyFlagCounts,
  parseBoardFlag,
} from '../infrastructure/hrm-timesheet-board-flags.js';
import {
  adjustMonthDay,
  calculateMonth,
  closeMonth,
  closeMonthRequests,
  findMonthPeriods,
  monthCloseState,
  monthInfoOf,
  parseMonth,
  reopenMonth,
  todayInVietnam,
} from '../infrastructure/hrm-timesheet-month.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { requireDate, requireUuid } from '../infrastructure/hrm-validation.js';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
/** Số nhân viên nạp mỗi lượt khi quét cờ lọc toàn tháng, để không giữ cả công ty trong bộ nhớ. */
const SCAN_CHUNK = 100;

/** Cặp ký tự có dấu -> không dấu (cả chữ hoa và thường) để tìm kiếm tiếng Việt không dấu ngay trong SQL. */
const ACCENTED: Record<string, string> = {
  a: 'àáạảãâầấậẩẫăằắặẳẵ',
  e: 'èéẹẻẽêềếệểễ',
  i: 'ìíịỉĩ',
  o: 'òóọỏõôồốộổỗơờớợởỡ',
  u: 'ùúụủũưừứựửữ',
  y: 'ỳýỵỷỹ',
  d: 'đ',
};
const TRANSLATE_FROM: string[] = [];
const TRANSLATE_TO: string[] = [];
for (const [plain, accented] of Object.entries(ACCENTED))
  for (const ch of accented) {
    TRANSLATE_FROM.push(ch, ch.toUpperCase());
    TRANSLATE_TO.push(plain, plain.toUpperCase());
  }
const FROM_CHARS = TRANSLATE_FROM.join('');
const TO_CHARS = TRANSLATE_TO.join('');

/** Chuẩn hóa từ khóa: bỏ dấu, chữ thường, bỏ ký tự đại diện của LIKE. */
export function normalizeSearch(q: string): string {
  return q
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
    .replace(/[\\%_]/g, (c) => `\\${c}`);
}

function positiveInt(value: unknown, fallback: number, max: number, field: string): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1)
    throw new BadRequestException({
      code: 'HRM_INVALID_INPUT',
      message: `${field}: cần là số nguyên dương`,
    });
  return Math.min(n, max);
}

/**
 * Bảng công theo tháng (xem docs/hrm-bang-cong-thiet-ke.md): người có hrm.timesheet.read xem mọi nhân viên, người khác chỉ
 * thấy chính mình; phạm vi do server quyết định. Chốt đơn từ / chốt công / mở lại theo tháng dương lịch.
 */
@UseInterceptors(HrmMissingSchemaInterceptor)
@Controller('v1')
export class HrmTimesheetBoardController {
  constructor(private readonly ctx: HrmContextService) {}

  @RequirePermission('hrm.read')
  @Get('timesheet-board')
  async board(
    @Req() req: Request,
    @Query('month') monthParam?: string,
    @Query('employee_id') employeeParam?: string,
    @Query('q') q?: string,
    @Query('page') pageParam?: string,
    @Query('page_size') pageSizeParam?: string,
    @Query('self') selfParam?: string,
    @Query('flag') flagParam?: string,
  ): Promise<{ data: HrmTimesheetBoard }> {
    const range = parseMonth(monthParam);
    let flag: HrmBoardFlag | null;
    try {
      flag = parseBoardFlag(flagParam);
    } catch (e) {
      throw new BadRequestException({
        code: 'HRM_INVALID_INPUT',
        message: e instanceof Error ? e.message : 'flag không hợp lệ',
      });
    }
    const requested = employeeParam ? requireUuid(employeeParam, 'employee_id') : undefined;
    const page = positiveInt(pageParam, 1, 100000, 'page');
    const pageSize = positiveInt(pageSizeParam, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, 'page_size');
    // Có hrm.timesheet.read: mọi nhân viên. Không có: chỉ nhân viên của chính mình, xin người khác thì 403.
    // self=1: bỏ qua quyền xem tất cả, luôn chỉ nhân viên của chính người dùng (tab "Bảng công của tôi").
    const selfOnly = selfParam === '1' || selfParam === 'true';
    let scope: Awaited<ReturnType<HrmContextService['scoped']>>;
    if (selfOnly) {
      const context = await this.ctx.getContext(req, 'hrm.self.read');
      const own = await this.ctx.resolveEmployee(context.pool, context.tenantId, context.principal.userId);
      if (requested && requested !== own.employeeId)
        throw new ForbiddenException('Chỉ được xem dữ liệu của bản thân');
      scope = { ...context, employeeId: own.employeeId };
    } else scope = await this.ctx.scoped(req, 'hrm.timesheet.read', requested);
    const canViewAll = !selfOnly && Boolean(this.ctx.has(scope, 'hrm.timesheet.read'));
    const onlyEmployee = canViewAll ? requested : scope.employeeId;
    const search = canViewAll && q?.trim() ? normalizeSearch(q) : null;
    const { pool, tenantId } = scope;

    const [list, periods] = await Promise.all([
      pool.query(
        `SELECT d.employee_id
           FROM hrm_schema.employee_directory d
           JOIN hrm_schema.employee_profiles p ON p.tenant_id=d.tenant_id AND p.employee_id=d.employee_id
          WHERE d.tenant_id=$1 AND d.deleted_at IS NULL AND d.join_date<=$3::date AND (p.inactive_from IS NULL OR p.inactive_from>$2::date)
            AND ($4::uuid IS NULL OR d.employee_id=$4::uuid)
            AND ($5::text IS NULL OR translate(coalesce(d.employee_code,'')||' '||coalesce(d.full_name,''), $6::text, $7::text) ILIKE '%'||$5::text||'%' ESCAPE '\\' OR d.employee_id::text=$8::text)
          ORDER BY d.employee_code, d.employee_id`,
        [tenantId, range.from, range.to, onlyEmployee ?? null, search, FROM_CHARS, TO_CHARS, q?.trim() ?? ''],
      ),
      findMonthPeriods(pool, tenantId, range),
    ]);
    const month = monthInfoOf(range, periods);
    const boardInput = {
      from: range.from,
      to: range.to,
      today: todayInVietnam(),
      lockedPeriodId: month.state === 'LOCKED' ? month.periodId : null,
      periodId: month.periodId,
    };
    const allIds = list.rows.map((r) => r.employee_id as string);

    // Bộ lọc nhanh và số đếm tính trên TOÀN BỘ nhân viên khớp tìm kiếm của tháng, rồi mới phân trang;
    // nếu chỉ lọc trong trang đang xem thì kết quả đổi theo cỡ trang.
    const counts: Record<HrmBoardFlag | 'ALL', number> = emptyFlagCounts(allIds.length);
    const matched: string[] = [];
    for (let i = 0; i < allIds.length; i += SCAN_CHUNK) {
      const chunk = allIds.slice(i, i + SCAN_CHUNK);
      const scanned = await loadBoard(pool, tenantId, { ...boardInput, employeeIds: chunk });
      const flagsById = new Map(scanned.employees.map((e) => [e.employeeId, boardFlagsOf(e)]));
      for (const id of chunk) {
        const flags = flagsById.get(id) ?? new Set<HrmBoardFlag>();
        for (const f of flags) counts[f] += 1;
        if (!flag || flags.has(flag)) matched.push(id);
      }
    }
    const pageIds = matched.slice((page - 1) * pageSize, page * pageSize);
    const loaded = await loadBoard(pool, tenantId, { ...boardInput, employeeIds: pageIds });
    const order = new Map(pageIds.map((id, i) => [id, i]));
    const employees = [...loaded.employees].sort(
      (x, y) => (order.get(x.employeeId) ?? 0) - (order.get(y.employeeId) ?? 0),
    );
    return {
      data: {
        month,
        canViewAll,
        calendar: loaded.calendar,
        employees,
        meta: { total: matched.length, page, pageSize, counts },
      },
    };
  }

  @RequirePermission('hrm.timesheet.read')
  @Get('timesheet-months/:month/close-state')
  async closeState(
    @Req() req: Request,
    @Param('month') month: string,
  ): Promise<{ data: HrmMonthCloseState }> {
    const range = parseMonth(month);
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.timesheet.read');
    return { data: await monthCloseState(pool, tenantId, range) };
  }

  @RequirePermission('hrm.timesheet.calculate')
  @Post('timesheet-months/:month/close-requests')
  async closeRequests(
    @Req() req: Request,
    @Param('month') month: string,
  ): Promise<{ data: HrmMonthCloseState }> {
    const range = parseMonth(month);
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.timesheet.calculate');
    return {
      data: await hrmTransaction(pool, async (db) => {
        await closeMonthRequests(db, tenantId, principal.userId, range);
        return monthCloseState(db, tenantId, range);
      }),
    };
  }

  /** Tính công tháng (chưa khóa): ghi dòng công kể cả ngày bất thường để xem và điều chỉnh trước khi chốt. */
  @RequirePermission('hrm.timesheet.calculate')
  @Post('timesheet-months/:month/calculate')
  async calculate(
    @Req() req: Request,
    @Param('month') month: string,
  ): Promise<{ data: HrmMonthCloseState & { result: { count: number; abnormal: number } } }> {
    const range = parseMonth(month);
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.timesheet.calculate');
    return {
      data: await hrmTransaction(pool, async (db) => {
        const result = await calculateMonth(db, tenantId, principal.userId, range);
        return { ...(await monthCloseState(db, tenantId, range)), result };
      }),
    };
  }

  /** Điều chỉnh công một ngày (số công hoặc phút công hưởng lương) với căn cứ bắt buộc; chỉ khi tháng đã tính công, chưa chốt. */
  @RequirePermission('hrm.timesheet.adjust')
  @Post('timesheet-months/:month/adjust')
  async adjustDay(
    @Req() req: Request,
    @Param('month') month: string,
    @Body()
    body: {
      employeeId?: string;
      date?: string;
      workdayUnits?: number;
      paidMinutes?: number;
      reason?: string;
    },
  ) {
    const range = parseMonth(month);
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.timesheet.adjust');
    const employeeId = requireUuid(body?.employeeId, 'employeeId');
    const date = requireDate(body?.date, 'Ngày công');
    for (const value of [body?.paidMinutes, body?.workdayUnits])
      if (value !== undefined && (!Number.isFinite(value) || value < 0))
        throw new BadRequestException('Số công không hợp lệ');
    if (body?.paidMinutes === undefined && body?.workdayUnits === undefined)
      throw new BadRequestException('Cần nhập số công hoặc phút công hưởng lương');
    const row = await hrmTransaction(pool, (db) =>
      adjustMonthDay(db, tenantId, principal.userId, range, employeeId, date, {
        paidMinutes: body.paidMinutes,
        workdayUnits: body.workdayUnits,
        reason: body.reason ?? '',
      }),
    );
    return { data: { id: row.id, paidMinutes: Number(row.paid_minutes), workdayUnits: Number(row.workday_units) } };
  }

  @RequirePermission('hrm.timesheet.calculate')
  @Post('timesheet-months/:month/close')
  async close(
    @Req() req: Request,
    @Param('month') month: string,
  ): Promise<{ data: HrmMonthCloseState }> {
    const range = parseMonth(month);
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.timesheet.calculate');
    return {
      data: await hrmTransaction(pool, async (db) => {
        await closeMonth(db, tenantId, principal.userId, range);
        return monthCloseState(db, tenantId, range);
      }),
    };
  }

  @RequirePermission('hrm.timesheet.reopen')
  @Post('timesheet-months/:month/reopen')
  async reopen(
    @Req() req: Request,
    @Param('month') month: string,
    @Body('reason') reason: string,
  ): Promise<{ data: HrmMonthCloseState }> {
    const range = parseMonth(month);
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.timesheet.reopen');
    return {
      data: await hrmTransaction(pool, async (db) => {
        await reopenMonth(db, tenantId, principal.userId, range, reason);
        return monthCloseState(db, tenantId, range);
      }),
    };
  }
}
