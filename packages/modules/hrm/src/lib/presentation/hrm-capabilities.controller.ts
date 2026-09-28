import { Controller, Get, Req } from '@nestjs/common';
import { HRM_PERMISSION_ACTIONS } from '@enterprise-platform/contracts-identity';
import type { Request } from 'express';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';

@Controller('v1')
export class HrmCapabilitiesController {
  constructor(private readonly ctx: HrmContextService) {}
  @Get('capabilities')
  async get(@Req() req: Request) {
    const context = await this.ctx.getContext(req, 'module.access');
    return {
      data: {
        actions: HRM_PERMISSION_ACTIONS.filter((a) =>
          this.ctx.has(context, a.key),
        ).map((a) => a.key),
        catalog: HRM_PERMISSION_ACTIONS,
        displayName: context.principal.displayName,
        tenantId: context.tenantId,
      },
    };
  }
}
