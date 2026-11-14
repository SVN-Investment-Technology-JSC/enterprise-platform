import type {
  AdjustHrmCompOffRequest,
  ConfirmHrmCompOffConversionRequest,
  DecideHrmTripDayLinesRequest,
  ImportHrmCompOffRequest,
  ReverseHrmCompOffAdjustmentRequest,
  SaveHrmTripDayLinesRequest,
  OverrideHrmOvertimeBlockRequest,
  PreviewHrmOvertimeClassifyRequest,
  SaveHrmOvertimeCompSettingsRequest,
} from '@enterprise-platform/contracts-hrm';
import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Put, Query, Req, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import type { PoolClient } from 'pg';
import {
  adjustCompOff,
  compOffAvailability,
  compOffAdjustmentHistory,
  compOffStatus,
  compOffDetail,
  confirmCompOffConversion,
  expireCompOffLots,
  importCompOffAdjustments,
  listCompOffBalances,
  previewCompOffConversion,
  reverseCompOffAdjustment,
} from '../infrastructure/hrm-comp-off.js';
import { RequirePermission } from '../infrastructure/hrm-access.guard.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { HrmMissingSchemaInterceptor } from '../infrastructure/hrm-missing-schema.interceptor.js';
import {
  listOvertimeBlocks,
  overrideOvertimeBlock,
  previewOvertimeClassification,
} from '../infrastructure/hrm-overtime-blocks.js';
import { readOvertimeCompSettings, removeOvertimeCompVersion, saveOvertimeCompSettings } from '../infrastructure/hrm-overtime-comp-settings.js';
import {
  loadOvertimeCompPolicy,
  type LoadedOvertimeCompPolicy,
} from '../infrastructure/hrm-overtime-blocks.js';
import { overtimeMonthFigures, withEmployeeNames } from '../infrastructure/hrm-overtime-month.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { canDecideTripDayLines, decideTripDayLines, loadTripDayLines, saveTripDayLines } from '../infrastructure/hrm-trip-day-lines.js';
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

  @Delete('overtime-comp/settings/versions/:id')
  @RequirePermission('hrm.policy.manage')
  async removeVersion(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { reason?: string; expectedUpdatedAt?: string },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.policy.manage');
    requireUuid(id, 'Phiên bản');
    return {
      data: await hrmTransaction(pool, (db) => removeOvertimeCompVersion(db, tenantId, principal.userId, id, body ?? {})),
      meta: meta(req),
    };
  }

  // ------------------------------------------------- giờ làm theo ngày của đơn công tác

  /** Xem giờ khai từng ngày của đơn công tác: chính nhân viên, người xác nhận (quản lý trực tiếp, dự phòng) hoặc người quản lý đơn. */
  @Get('business-trip-requests/:id/day-lines')
  @RequirePermission('hrm.read')
  async tripDayLines(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.read');
    const tripId = requireUuid(id, 'Đơn công tác');
    const db = pool as unknown as PoolClient;
    const data = await loadTripDayLines(db, tenantId, tripId);
    const own = await pool.query(`SELECT 1 FROM hrm_schema.employee_directory WHERE tenant_id=$1 AND employee_id=$2 AND user_id=$3`, [
      tenantId,
      data.employeeId,
      principal.userId,
    ]);
    const canDecide = await canDecideTripDayLines(db, tenantId, principal.userId, tripId);
    const manages = principal.permissions?.includes('hrm.request.manage') ?? false;
    if (!own.rowCount && !canDecide && !manages && !(principal.permissions?.includes('hrm.request.approve') ?? false))
      throw new ForbiddenException('Không có quyền xem giờ làm của đơn công tác này');
    return { data: { ...data, canDecide, canEdit: Boolean(own.rowCount) || manages }, meta: meta(req) };
  }

  /** Nhân viên (hoặc người lập hộ) khai giờ dự kiến trước chuyến đi hoặc giờ thực tế sau chuyến đi. */
  @Put('business-trip-requests/:id/day-lines')
  @RequirePermission('hrm.self.request')
  async saveTripDayLines(@Req() req: Request, @Param('id') id: string, @Body() body: SaveHrmTripDayLinesRequest) {
    const tripId = requireUuid(id, 'Đơn công tác');
    const probe = await this.ctx.getContext(req, 'hrm.read');
    const found = await probe.pool.query(`SELECT employee_id FROM hrm_schema.business_trip_requests WHERE tenant_id=$1 AND id=$2`, [probe.tenantId, tripId]);
    if (!found.rows[0]) throw new NotFoundException('Không tìm thấy đơn công tác');
    const { pool, tenantId, principal, employeeId } = await this.ctx.getRequestContextOrProxy(req, found.rows[0].employee_id as string, 'business_trip');
    const data = await hrmTransaction(pool, (db) => saveTripDayLines(db, tenantId, principal.userId, employeeId, tripId, body ?? ({} as SaveHrmTripDayLinesRequest)));
    return { data, meta: meta(req) };
  }

  /** Quản lý trực tiếp hoặc người duyệt dự phòng duyệt hoặc từ chối giờ thực tế. Không có tự duyệt. */
  @Post('business-trip-requests/:id/day-lines/decision')
  @RequirePermission('hrm.read')
  async decideTripDayLines(@Req() req: Request, @Param('id') id: string, @Body() body: DecideHrmTripDayLinesRequest) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.read');
    const tripId = requireUuid(id, 'Đơn công tác');
    const data = await hrmTransaction(pool, (db) => decideTripDayLines(db, tenantId, principal.userId, tripId, body ?? ({} as DecideHrmTripDayLinesRequest)));
    return { data: { ...data, canDecide: true }, meta: meta(req) };
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

  /** Quỹ nghỉ bù đang bật hay tắt trong cấu hình, để màn hình báo cho người dùng. */
  @Get('comp-off/status')
  @RequirePermission('hrm.comp_off.view')
  async status(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.comp_off.view');
    return { data: await compOffStatus(pool, tenantId, todayInVietnam()), meta: meta(req) };
  }

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

  /** Lịch sử điều chỉnh (bấm tay, import, đảo) của mọi nhân viên, cho màn "Lịch sử điều chỉnh". */
  @Get('comp-off/adjustments')
  @RequirePermission('hrm.comp_off.view')
  async adjustmentHistory(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.comp_off.view');
    return { data: await compOffAdjustmentHistory(pool, tenantId), meta: meta(req) };
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

  @Post('comp-off/adjustments/import')
  @RequirePermission('hrm.comp_off.adjust')
  async importAdjustments(@Req() req: Request, @Body() body: ImportHrmCompOffRequest) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.comp_off.adjust');
    return {
      data: await hrmTransaction(pool, (db) => importCompOffAdjustments(db, tenantId, principal.userId, body)),
      meta: meta(req),
    };
  }

  /** Đảo một dòng điều chỉnh (kể cả dòng import) bằng dòng đối ứng, cần lý do. */
  @Post('comp-off/ledger/:id/reverse')
  @RequirePermission('hrm.comp_off.adjust')
  async reverseAdjustment(@Req() req: Request, @Param('id') id: string, @Body() body: ReverseHrmCompOffAdjustmentRequest) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.comp_off.adjust');
    const entryId = requireUuid(id, 'Giao dịch');
    return {
      data: await hrmTransaction(pool, (db) => reverseCompOffAdjustment(db, tenantId, principal.userId, entryId, body?.reason ?? '')),
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
