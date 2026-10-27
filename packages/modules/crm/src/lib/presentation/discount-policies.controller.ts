import type { DiscountPolicy, SaveDiscountPolicyRequest } from '@enterprise-platform/contracts-crm';
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import { DiscountPolicyService } from '../application/discount-policy.service.js';
import { crmActor, runCrm, type CrmRequest } from './crm-http.js';

/** Chính sách chiết khấu: đọc với `crm.read`, ghi với `crm.manage` (kiểm ở service). */
@Controller('v1')
export class DiscountPoliciesController {
  constructor(@Inject(DiscountPolicyService) private readonly policies: DiscountPolicyService) {}

  @Get('discount-policies')
  list(@Req() request: CrmRequest): Promise<DiscountPolicy[]> {
    return runCrm(() => this.policies.list(crmActor(request)));
  }

  @Post('discount-policies')
  create(@Req() request: CrmRequest, @Body() body: SaveDiscountPolicyRequest): Promise<DiscountPolicy> {
    return runCrm(() => this.policies.create(crmActor(request), body ?? ({} as never)));
  }

  @Get('discount-policies/:id')
  get(@Req() request: CrmRequest, @Param('id') id: string): Promise<DiscountPolicy> {
    return runCrm(() => this.policies.get(crmActor(request), id));
  }

  @Patch('discount-policies/:id')
  update(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Body() body: SaveDiscountPolicyRequest,
  ): Promise<DiscountPolicy> {
    return runCrm(() => this.policies.update(crmActor(request), id, body ?? ({} as never)));
  }

  @Delete('discount-policies/:id')
  @HttpCode(204)
  remove(@Req() request: CrmRequest, @Param('id') id: string): Promise<void> {
    return runCrm(() => this.policies.remove(crmActor(request), id));
  }
}
