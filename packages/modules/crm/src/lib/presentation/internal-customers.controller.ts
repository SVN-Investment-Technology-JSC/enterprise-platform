import type { CrmCustomerReferencePage } from '@enterprise-platform/contracts-integration';
import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import { CustomerService } from '../application/customer.service.js';
import { crmActor, runCrm, type CrmRequest } from './crm-http.js';

/**
 * Route nội bộ cho phân hệ khác tra khách hàng của Bán hàng (D1).
 *
 * Đường dẫn có `/v1/internal/` nên `CrmAccessGuard` xác thực `x-service-token`
 * và `x-tenant-id` thay cho cookie người dùng; actor là hệ thống. Chỉ đọc, chỉ
 * trả mã, tên, MST và phiên bản.
 */
@Controller('v1/internal')
export class InternalCustomersController {
  constructor(@Inject(CustomerService) private readonly customers: CustomerService) {}

  /** `?search=` (đầu mã, đầu MST, đầu từ trong tên) hoặc `?ids=a,b`; `limit` tối đa 100. */
  @Get('customers')
  lookup(
    @Req() request: CrmRequest,
    @Query('search') search?: string,
    @Query('ids') ids?: string | string[],
    @Query('limit') limit?: string,
  ): Promise<CrmCustomerReferencePage> {
    return runCrm(async () => ({
      items: await this.customers.lookup(crmActor(request), { search, ids, limit }),
    }));
  }
}
