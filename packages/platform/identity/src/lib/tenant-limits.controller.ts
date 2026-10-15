import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { TenantLimitsService } from './tenant-limits.js';

/** Hạn mức tài nguyên của tenant cho các phân hệ (service token), ví dụ dung lượng tệp. */
@Controller('platform')
export class TenantLimitsController {
  constructor(@Inject(TenantLimitsService) private readonly limits: TenantLimitsService) {}

  @Get('internal/v1/tenant-limits/:tenantId')
  async tenantLimits(@Req() request: Request, @Param('tenantId') tenantId: string) {
    if (
      !process.env.INTERNAL_SERVICE_TOKEN ||
      request.headers['x-service-token'] !== process.env.INTERNAL_SERVICE_TOKEN
    ) {
      throw new UnauthorizedException('Service identity không hợp lệ.');
    }
    const limits = await this.limits.limits(tenantId);
    if (!limits) throw new NotFoundException({ code: 'TENANT_NOT_FOUND' });
    return limits;
  }
}
