import type {
  AdjustmentActionRequest,
  AdjustmentListQuery,
  ApplyCreditRequest,
  CreateAdjustmentRequest,
  CreateReceiptRequest,
  CreditDecisionRequest,
  CrmPage,
  CustomerAgingRow,
  CustomerLedger,
  ReceiptActionRequest,
  ReceiptDetail,
  ReceiptListQuery,
  ReceiptSummary,
  ReceivableAdjustment,
  ReceivableAgingQuery,
  ReceivableSettings,
  ResendReceiptRequest,
  SalesOrderDetail,
} from '@enterprise-platform/contracts-crm';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import { CreditApprovalService } from '../application/credit-limit.service.js';
import { ReceivableAdjustmentService } from '../application/receivable-adjustment.service.js';
import { ReceivableService } from '../application/receivable.service.js';
import { CrmNotFoundError } from '../domain/crm.error.js';
import { crmActor, runCrm, type CrmRequest } from './crm-http.js';

type Payload<T> = T | undefined;
const body = <T>(value: Payload<T>): T => value ?? ({} as T);

/**
 * Công nợ phải thu (GĐ5): tuổi nợ, sổ công nợ theo khách, lần thu tiền và phân
 * bổ, điều chỉnh, cấu hình; duyệt vượt hạn mức của đơn; ghi nhận đợt thanh toán
 * nghiệm thu. Đọc với `crm.read` trong phạm vi dữ liệu; ghi kiểm quyền ở service.
 * Không có route sửa dòng sổ hay số dư (TC-AR-08).
 */
@Controller('v1')
export class ReceivablesController {
  constructor(
    @Inject(ReceivableService) private readonly receivables: ReceivableService,
    @Inject(ReceivableAdjustmentService) private readonly adjustments: ReceivableAdjustmentService,
    @Inject(CreditApprovalService) private readonly credit: CreditApprovalService,
  ) {}

  @Get('receivables/aging')
  aging(@Req() request: CrmRequest, @Query() query: ReceivableAgingQuery): Promise<CrmPage<CustomerAgingRow>> {
    return runCrm(() => this.receivables.aging(crmActor(request), query));
  }

  @Get('receivables/customers/:customerId')
  ledger(@Req() request: CrmRequest, @Param('customerId') customerId: string): Promise<CustomerLedger> {
    return runCrm(() => this.receivables.ledger(crmActor(request), customerId));
  }

  /** Phân bổ tiền trả trước (dòng CREDIT chưa gắn khoản nợ) vào khoản nợ phát sinh sau (T5-16). */
  @Post('receivables/credits/:entryId/apply')
  @HttpCode(200)
  applyCredit(
    @Req() request: CrmRequest,
    @Param('entryId') entryId: string,
    @Body() payload: Payload<ApplyCreditRequest>,
  ): Promise<CustomerLedger> {
    return runCrm(() => this.receivables.applyCredit(crmActor(request), entryId, body(payload)));
  }

  @Get('receivable-settings')
  settings(@Req() request: CrmRequest): Promise<ReceivableSettings> {
    return runCrm(() => this.receivables.settings(crmActor(request)));
  }

  @Put('receivable-settings')
  saveSettings(@Req() request: CrmRequest, @Body() payload: Payload<Partial<ReceivableSettings>>): Promise<ReceivableSettings> {
    return runCrm(() => this.receivables.saveSettings(crmActor(request), body(payload)));
  }

  @Get('receipts')
  listReceipts(@Req() request: CrmRequest, @Query() query: ReceiptListQuery): Promise<CrmPage<ReceiptSummary>> {
    return runCrm(() => this.receivables.listReceipts(crmActor(request), query));
  }

  @Post('receipts')
  createReceipt(@Req() request: CrmRequest, @Body() payload: Payload<CreateReceiptRequest>): Promise<ReceiptDetail> {
    return runCrm(() => this.receivables.createReceipt(crmActor(request), body(payload)));
  }

  @Get('receipts/:id')
  getReceipt(@Req() request: CrmRequest, @Param('id') id: string): Promise<ReceiptDetail> {
    return runCrm(() => this.receivables.getReceipt(crmActor(request), id));
  }

  /** `resend` (sửa rồi gửi lại lần thu bị trả lại), `cancel`. */
  @Post('receipts/:id/:action')
  @HttpCode(200)
  receiptAction(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() payload: Payload<ResendReceiptRequest & ReceiptActionRequest>,
  ): Promise<ReceiptDetail> {
    return runCrm(() => {
      const actor = crmActor(request);
      if (action === 'resend') return this.receivables.resendReceipt(actor, id, body(payload));
      if (action === 'cancel') return this.receivables.cancelReceipt(actor, id, body(payload));
      return Promise.reject(new CrmNotFoundError());
    });
  }

  @Get('receivable-adjustments')
  listAdjustments(@Req() request: CrmRequest, @Query() query: AdjustmentListQuery): Promise<CrmPage<ReceivableAdjustment>> {
    return runCrm(() => this.adjustments.list(crmActor(request), query));
  }

  @Post('receivable-adjustments')
  createAdjustment(@Req() request: CrmRequest, @Body() payload: Payload<CreateAdjustmentRequest>): Promise<ReceivableAdjustment> {
    return runCrm(() => this.adjustments.create(crmActor(request), body(payload)));
  }

  @Get('receivable-adjustments/:id')
  getAdjustment(@Req() request: CrmRequest, @Param('id') id: string): Promise<ReceivableAdjustment> {
    return runCrm(() => this.adjustments.get(crmActor(request), id));
  }

  /** `approve`, `cancel`. */
  @Post('receivable-adjustments/:id/:action')
  @HttpCode(200)
  adjustmentAction(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() payload: Payload<AdjustmentActionRequest>,
  ): Promise<ReceivableAdjustment> {
    return runCrm(() => {
      const actor = crmActor(request);
      if (action === 'approve') return this.adjustments.approve(actor, id, body(payload));
      if (action === 'cancel') return this.adjustments.cancel(actor, id, body(payload));
      return Promise.reject(new CrmNotFoundError());
    });
  }

  /** Duyệt (`approve`) hoặc từ chối (`reject`) vượt hạn mức công nợ của đơn, khi duyệt trực tiếp trong Bán hàng. */
  @Post('orders/:id/credit-approval/:decision')
  @HttpCode(200)
  creditDecision(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('decision') decision: string,
    @Body() payload: Payload<CreditDecisionRequest>,
  ): Promise<SalesOrderDetail> {
    return runCrm(() => {
      if (decision !== 'approve' && decision !== 'reject') return Promise.reject(new CrmNotFoundError());
      return this.credit.decide(crmActor(request), id, decision === 'approve', body(payload));
    });
  }

  /** Ghi nhận đợt thanh toán điều kiện nghiệm thu (tạm thời đến khi có nghiệm thu, CON-04). */
  @Post('contracts/:id/payment-terms/:termId/trigger')
  @HttpCode(204)
  triggerPaymentTerm(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('termId') termId: string,
    @Body() payload: Payload<{ date?: string | null }>,
  ): Promise<void> {
    return runCrm(() => this.receivables.triggerPaymentTerm(crmActor(request), id, termId, body(payload).date));
  }
}
