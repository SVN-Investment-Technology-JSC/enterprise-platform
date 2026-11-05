import type {
  ContractActionRequest,
  ContractDetail,
  ContractListQuery,
  ContractSummary,
  CrmPage,
  SaveContractRequest,
  SavePaymentTermsRequest,
} from '@enterprise-platform/contracts-crm';
import { Body, Controller, Get, Inject, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ContractService } from '../application/contract.service.js';
import { CrmNotFoundError } from '../domain/crm.error.js';
import { crmActor, runCrm, type CrmRequest } from './crm-http.js';

type Payload<T> = T | undefined;
const body = <T>(value: Payload<T>): T => value ?? ({} as T);

/**
 * Hợp đồng ba loại, giá khung, đợt thanh toán (T4-02, T4-03). Đọc với
 * `crm.read` trong phạm vi dữ liệu; ghi và chuyển trạng thái với
 * `crm.contract.write`, kiểm ở `ContractService`. Thao tác gửi `revision` để
 * không ghi đè người khác.
 */
@Controller('v1')
export class ContractsController {
  constructor(@Inject(ContractService) private readonly contracts: ContractService) {}

  @Get('contracts')
  list(@Req() request: CrmRequest, @Query() query: ContractListQuery): Promise<CrmPage<ContractSummary>> {
    return runCrm(() => this.contracts.list(crmActor(request), query));
  }

  @Post('contracts')
  create(@Req() request: CrmRequest, @Body() payload: Payload<SaveContractRequest>): Promise<ContractDetail> {
    return runCrm(() => this.contracts.create(crmActor(request), body(payload)));
  }

  @Get('contracts/:id')
  get(@Req() request: CrmRequest, @Param('id') id: string): Promise<ContractDetail> {
    return runCrm(() => this.contracts.get(crmActor(request), id));
  }

  @Patch('contracts/:id')
  update(@Req() request: CrmRequest, @Param('id') id: string, @Body() payload: Payload<Partial<SaveContractRequest>>): Promise<ContractDetail> {
    return runCrm(() => this.contracts.update(crmActor(request), id, body(payload)));
  }

  @Put('contracts/:id/payment-terms')
  savePaymentTerms(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Body() payload: Payload<SavePaymentTermsRequest>,
  ): Promise<ContractDetail> {
    return runCrm(() => this.contracts.savePaymentTerms(crmActor(request), id, body(payload)));
  }

  /** `confirm`, `cancel`, `complete`, `liquidate`. */
  @Post('contracts/:id/:action')
  act(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() payload: Payload<ContractActionRequest>,
  ): Promise<ContractDetail> {
    return runCrm(() => {
      const actor = crmActor(request);
      const input = body(payload);
      switch (action) {
        case 'confirm':
          return this.contracts.confirm(actor, id, input);
        case 'cancel':
          return this.contracts.cancel(actor, id, input);
        case 'complete':
          return this.contracts.complete(actor, id, input);
        case 'liquidate':
          return this.contracts.liquidate(actor, id, input);
        default:
          return Promise.reject(new CrmNotFoundError());
      }
    });
  }
}
