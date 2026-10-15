import type { SaveFleetDriverRequest, SaveFleetVehicleRequest } from '@enterprise-platform/contracts-hrm';
import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import {
  findAvailability,
  listBookings,
  listDrivers,
  listVehicles,
  saveDriver,
  saveVehicle,
} from '../infrastructure/hrm-fleet.js';
import { HrmMissingSchemaInterceptor } from '../infrastructure/hrm-missing-schema.interceptor.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { requireUuid } from '../infrastructure/hrm-validation.js';

/**
 * Lịch xe công ty. Xem lịch và danh mục cần `hrm.fleet.read`; quản lý xe và tài xế cần `hrm.fleet.manage`.
 * `fleet/availability` mở cho mọi người dùng HRM vì form đơn của nhân viên cần danh sách xe còn trống.
 * Lịch xe không có API ghi riêng: lịch sinh ra cùng đơn (đơn công tác, đơn tự tạo) hoặc qua sự kiện của
 * Workspace và Maintenance.
 */
@UseInterceptors(HrmMissingSchemaInterceptor)
@Controller('v1/fleet')
export class HrmFleetController {
  constructor(private readonly ctx: HrmContextService) {}

  @Get('vehicles')
  async vehicles(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.fleet.read');
    return { data: await listVehicles(pool, tenantId) };
  }

  @Post('vehicles')
  async createVehicle(@Req() req: Request, @Body() body: SaveFleetVehicleRequest) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.fleet.manage');
    return { data: await hrmTransaction(pool, (db) => saveVehicle(db, tenantId, null, body ?? {})) };
  }

  @Patch('vehicles/:id')
  async updateVehicle(@Req() req: Request, @Param('id') id: string, @Body() body: SaveFleetVehicleRequest) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.fleet.manage');
    return { data: await hrmTransaction(pool, (db) => saveVehicle(db, tenantId, requireUuid(id, 'id'), body ?? {})) };
  }

  @Get('drivers')
  async drivers(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.fleet.read');
    return { data: await listDrivers(pool, tenantId) };
  }

  @Post('drivers')
  async createDriver(@Req() req: Request, @Body() body: SaveFleetDriverRequest) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.fleet.manage');
    return { data: await hrmTransaction(pool, (db) => saveDriver(db, tenantId, null, body ?? {})) };
  }

  @Patch('drivers/:id')
  async updateDriver(@Req() req: Request, @Param('id') id: string, @Body() body: SaveFleetDriverRequest) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.fleet.manage');
    return { data: await hrmTransaction(pool, (db) => saveDriver(db, tenantId, requireUuid(id, 'id'), body ?? {})) };
  }

  @Get('bookings')
  async bookings(@Req() req: Request, @Query('from') from: string, @Query('to') to: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.fleet.read');
    return { data: await listBookings(pool, tenantId, from, to) };
  }

  @Get('availability')
  async availability(
    @Req() req: Request,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('excludeSourceType') excludeSourceType?: string,
    @Query('excludeSourceId') excludeSourceId?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const exclude =
      excludeSourceType && excludeSourceId
        ? { sourceType: excludeSourceType as never, sourceId: requireUuid(excludeSourceId, 'excludeSourceId') }
        : undefined;
    return { data: await findAvailability(pool, tenantId, from, to, exclude) };
  }
}
