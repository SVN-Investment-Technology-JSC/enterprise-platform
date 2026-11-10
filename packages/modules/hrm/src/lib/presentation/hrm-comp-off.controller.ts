import type {
  AdjustHrmCompOffRequest,
  ConfirmHrmCompOffConversionRequest,
  OverrideHrmOvertimeBlockRequest,
  PreviewHrmOvertimeClassifyRequest,
  SaveHrmOvertimeCompSettingsRequest,
} from '@enterprise-platform/contracts-hrm';
import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Put, Query, Req, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import type { PoolClient } from 'pg';
import {
  adjustCompOff,
  compOffAvailability,
  compOffDetail,
  confirmCompOffConversion,
  expireCompOffLots,
  listCompOffBalances,
  previewCompOffConversion,
} from '../infrastructure/hrm-comp-off.js';
import { RequirePermission } from '../infrastructure/hrm-access.guard.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { HrmMissingSchemaInterceptor } from '../infrastructure/hrm-missing-schema.interceptor.js';
import {
  listOvertimeBlocks,
  overrideOvertimeBlock,
  previewOvertimeClassification,
} from '../infrastructure/hrm-overtime-blocks.js';
import { readOvertimeCompSettings, saveOvertimeCompSettings } from '../infrastructure/hrm-overtime-comp-settings.js';
import {
  loadOvertimeCompPolicy,
  type LoadedOvertimeCompPolicy,
} from '../infrastructure/hrm-overtime-blocks.js';
import { overtimeMonthFigures, withEmployeeNames } from '../infrastructure/hrm-overtime-month.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { requireDate, requireUuid } from '../infrastructure/hrm-validation.js';
import { parseMonth, todayInVietnam } from '../infrastructure/hrm-timesheet-month.js';

const meta = (req: Request) => ({ requestId: req.headers['x-request-id'] as string });

/**
 * Làm thêm theo quy tắc trần và quỹ nghỉ bù: cấu hình chính sách, phân loại làm thêm / ca đêm từng ca, tổng hợp theo
 * tháng, sổ quỹ nghỉ bù và chuyển đổi giờ dư. Thiết kế: docs/HRM_THIET_KE_QUY_NGHI_BU_VA_CHOT_CHAN_DON_TU.md.
 */
@UseInterceptors(HrmMissingSchemaInterceptor)
@Controller('v1')
export class HrmCompOffController {
  constructor(private readonly ctx: HrmContextService) {}

  // ---------------------------------------------------------------- cấu hình

  @Get('overtime-comp/settings')
  @RequirePermission('hrm.policy.view')
  async settings(@Req() req: Request, @Query('asOf') asOf?: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.policy.view');
    return { data: await readOvertimeCompSettings(pool, tenantId, asOf ? requireDate(asOf, 'asOf') : undefined), meta: meta(req) };
  }

  @Put('overtime-comp/settings')
  @RequirePermission('hrm.policy.manage')
  async saveSettings(@Req() req: Request, @Body() body: SaveHrmOvertimeCompSettingsRequest) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.policy.manage');
    return {
      data: await hrmTransaction(pool, (db) => saveOvertimeCompSettings(db, tenantId, principal.userId, body)),
      meta: meta(req),
    };
  }

  // ---------------------------------------------------------- phân loại ca

  /** Xem trước phân loại làm thêm / ca đêm khi lập đơn: tự xem của mình, hoặc người có quyền tạo hộ. */
  @Post('overtime-comp/classify-preview')
  @RequirePermission('hrm.self.request')
  async classifyPreview(@Req() req: Request, @Body() body: PreviewHrmOvertimeClassifyRequest) {
    const { pool, tenantId, employeeId } = await this.ctx.getRequestContextOrProxy(
      req,
      body?.employeeId ? requireUuid(body.employeeId, 'employeeId') : undefined,
      'ot',
    );
    return {
      data: await previewOvertimeClassification(pool as unknown as PoolClient, tenantId, { ...body, employeeId }),
      meta: meta(req),
    };
  }

  @Get('overtime-comp/blocks')
  @RequirePermission('hrm.overtime.classify')
  async blocks(@Req() req: Request, @Query('month') month?: string, @Query('employeeId') employeeId?: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.overtime.classify');
    const range = parseMonth(month);
    return {
      data: await listOvertimeBlocks(pool, tenantId, range.month, employeeId ? requireUuid(employeeId, 'employeeId') : undefined),
      meta: meta(req),
    };
  }

  @Patch('overtime-comp/blocks/:id')
  @RequirePermission('hrm.overtime.classify')
  async overrideBlock(@Req() req: Request, @Param('id') id: string, @Body() body: OverrideHrmOvertimeBlockRequest) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.overtime.classify');
    return {
      data: await hrmTransaction(pool, (db) => overrideOvertimeBlock(db, tenantId, principal.userId, requireUuid(id, 'id'), body ?? {})),
      meta: meta(req),
    };
  }

  /** Tổng hợp làm thêm của tháng theo nhân viên (giờ thực tế, tính lương, ca đêm, giờ dư, ngày nghỉ bù đề xuất). */
  @Get('overtime-comp/month-summary')
  @RequirePermission('hrm.comp_off.view')
  async monthSummary(@Req() req: Request, @Query('month') month?: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.comp_off.view');
    const range = parseMonth(month);
    const loaded: LoadedOvertimeCompPolicy = await loadOvertimeCompPolicy(pool, tenantId, range.month);
    const figures = loaded.policy.enabled ? await overtimeMonthFigures(pool, tenantId, range.month, loaded.policy) : [];
    return {
      data: { month: range.month, enabled: loaded.policy.enabled, rows: await withEmployeeNames(pool, tenantId, range.month, figures) },
      meta: meta(req),
    };
  }

  // ------------------------------------------------------------------- quỹ

  @Get('comp-off/balances')
  @RequirePermission('hrm.comp_off.view')
  async balances(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.comp_off.view');
    return { data: await listCompOffBalances(pool, tenantId, todayInVietnam()), meta: meta(req) };
  }

  /** Số dư khả dụng cho form đơn nghỉ: của mình, hoặc của người được tạo hộ. */
  @Get('comp-off/availability')
  @RequirePermission('hrm.self.request')
  async availability(@Req() req: Request, @Query('employeeId') employeeId?: string, @Query('date') date?: string) {
    const { pool, tenantId, employeeId: target } = await this.ctx.getRequestContextOrProxy(
      req,
      employeeId ? requireUuid(employeeId, 'employeeId') : undefined,
      'leave',
    );
    return { data: await compOffAvailability(pool, tenantId, target, date ? requireDate(date, 'date') : todayInVietnam()), meta: meta(req) };
  }

  @Get('comp-off/balances/:employeeId')
  @RequirePermission('hrm.comp_off.view')
  async detail(@Req() req: Request, @Param('employeeId') employeeId: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.comp_off.view');
    return { data: await compOffDetail(pool, tenantId, requireUuid(employeeId, 'employeeId'), todayInVietnam()), meta: meta(req) };
  }

  @Get('comp-off/conversion-preview')
  @RequirePermission('hrm.comp_off.view')
  async conversionPreview(@Req() req: Request, @Query('month') month?: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.comp_off.view');
    return { data: await previewCompOffConversion(pool, tenantId, parseMonth(month).month), meta: meta(req) };
  }

  @Post('comp-off/conversions')
  @RequirePermission('hrm.comp_off.convert')
  async convert(@Req() req: Request, @Body() body: ConfirmHrmCompOffConversionRequest) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.comp_off.convert');
    if (!Array.isArray(body?.rows) || !body.rows.length) throw new BadRequestException('Chưa chọn nhân viên để chuyển đổi');
    if (body.rows.length > 1000) throw new BadRequestException('Mỗi lần chuyển đổi tối đa 1000 nhân viên');
    const month = parseMonth(body.month).month;
    const rows = body.rows.map((r) => ({ ...r, employeeId: requireUuid(r.employeeId, 'employeeId') }));
    return {
      data: await hrmTransaction(pool, (db) => confirmCompOffConversion(db, tenantId, principal.userId, { month, rows })),
      meta: meta(req),
    };
  }

  @Post('comp-off/adjustments')
  @RequirePermission('hrm.comp_off.adjust')
  async adjust(@Req() req: Request, @Body() body: AdjustHrmCompOffRequest) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.comp_off.adjust');
    const employeeId = requireUuid(body?.employeeId, 'employeeId');
    return {
      data: await hrmTransaction(pool, (db) => adjustCompOff(db, tenantId, principal.userId, { ...body, employeeId })),
      meta: meta(req),
    };
  }

  /** Hết hạn các lô quá hạn. Chưa có lịch chạy tự động: HR hoặc tác vụ nền gọi API này. */
  @Post('comp-off/expire')
  @RequirePermission('hrm.comp_off.adjust')
  async expire(@Req() req: Request) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.comp_off.adjust');
    return {
      data: { expired: await hrmTransaction(pool, (db) => expireCompOffLots(db, tenantId, principal.userId, todayInVietnam())) },
      meta: meta(req),
    };
  }
}
