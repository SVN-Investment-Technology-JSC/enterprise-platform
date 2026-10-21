import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type {
  FinanceBulkApproveRequest,
  SaveFinanceListColumnsRequest,
  FinanceDecisionRequest,
  FinancePostSourcedRequest,
  FinanceProcedureActionRequest,
  FinanceReturnSourceRequest,
  FinanceVoucherKind,
  FinanceVoucherListQuery,
  FinanceVoucherStatus,
  SaveFinanceAccountRequest,
  SaveFinanceApprovalBindingRequest,
  SaveFinanceCounterpartyGroupRequest,
  SaveFinanceReasonRequest,
  SaveFinanceSettingsRequest,
  SaveFinanceVoucherRequest,
} from '@enterprise-platform/contracts-finance';
import { FinanceApplication } from '../application/finance.application.js';
import type { FinanceActor } from '../domain/finance.access.js';
import { FinanceError } from '../domain/finance.error.js';
import type { ForwardedSession } from '../infrastructure/procedure-api.js';

interface FinanceRequest {
  financeActor?: FinanceActor;
  headers?: Record<string, string | string[] | undefined>;
}

const header = (request: FinanceRequest, name: string): string | undefined => {
  const value = request.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
};

/** Phiên của người dùng, chuyển nguyên sang Procedure để Procedure tự quyết định quyền trên hồ sơ. */
const sessionOf = (request: FinanceRequest): ForwardedSession => ({
  cookie: header(request, 'cookie'),
  authorization: header(request, 'authorization'),
  csrf: header(request, 'x-csrf-token'),
});

const bool = (value: string | undefined) => value === 'true' || value === '1';
const int = (value: string | undefined) => (value === undefined || value === '' ? undefined : Number(value));

@Controller('v1')
export class FinanceController {
  constructor(private readonly app: FinanceApplication) {}

  @Get('capabilities')
  capabilities(@Req() request: FinanceRequest) {
    return this.run(() => this.app.describeCapabilities(this.actor(request)));
  }

  @Get('dashboard')
  dashboard(@Req() request: FinanceRequest) {
    return this.run(() => this.app.dashboard(this.actor(request)));
  }

  /* Tài khoản */
  @Get('accounts')
  accounts(@Req() request: FinanceRequest, @Query('includeInactive') includeInactive?: string) {
    return this.run(() => this.app.accounts(this.actor(request), bool(includeInactive)));
  }

  @Get('accounts/:id')
  account(@Req() request: FinanceRequest, @Param('id') id: string) {
    return this.run(() => this.app.account(this.actor(request), id));
  }

  @Post('accounts')
  createAccount(@Req() request: FinanceRequest, @Body() body: SaveFinanceAccountRequest) {
    return this.run(() => this.app.saveAccount(this.actor(request), null, body));
  }

  @Put('accounts/:id')
  updateAccount(@Req() request: FinanceRequest, @Param('id') id: string, @Body() body: SaveFinanceAccountRequest) {
    return this.run(() => this.app.saveAccount(this.actor(request), id, body));
  }

  @Get('accounts/:id/ledger')
  ledger(
    @Req() request: FinanceRequest,
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.run(() => this.app.accountLedger(this.actor(request), id, { from, to, page: int(page), pageSize: int(pageSize) }));
  }

  /* Danh mục và cấu hình */
  @Get('catalogs')
  catalogs(@Req() request: FinanceRequest, @Query('includeInactive') includeInactive?: string) {
    return this.run(() => this.app.catalogs(this.actor(request), bool(includeInactive)));
  }

  @Post('catalogs/reasons')
  createReason(@Req() request: FinanceRequest, @Body() body: SaveFinanceReasonRequest) {
    return this.run(() => this.app.saveReason(this.actor(request), null, body));
  }
  @Put('catalogs/reasons/:id')
  updateReason(@Req() request: FinanceRequest, @Param('id') id: string, @Body() body: SaveFinanceReasonRequest) {
    return this.run(() => this.app.saveReason(this.actor(request), id, body));
  }
  @Post('catalogs/counterparty-groups')
  createGroup(@Req() request: FinanceRequest, @Body() body: SaveFinanceCounterpartyGroupRequest) {
    return this.run(() => this.app.saveCounterpartyGroup(this.actor(request), null, body));
  }
  @Put('catalogs/counterparty-groups/:id')
  updateGroup(@Req() request: FinanceRequest, @Param('id') id: string, @Body() body: SaveFinanceCounterpartyGroupRequest) {
    return this.run(() => this.app.saveCounterpartyGroup(this.actor(request), id, body));
  }

  /* Dự án và công việc của Workspace, để hạch toán và gắn đối tượng liên quan */
  @Get('workspace/projects')
  workspaceProjects(@Req() request: FinanceRequest, @Query('search') search?: string) {
    return this.run(() => this.app.workspaceProjects(this.actor(request), search));
  }
  @Get('workspace/projects/:projectId/work-items')
  workspaceWorkItems(@Req() request: FinanceRequest, @Param('projectId') projectId: string) {
    return this.run(() => this.app.workspaceWorkItems(this.actor(request), projectId));
  }

  /** Tab "Thu chi" của dự án bên Workspace. */
  @Get('projects/:projectId/vouchers')
  projectVouchers(@Req() request: FinanceRequest, @Param('projectId') projectId: string) {
    return this.run(() => this.app.projectVouchers(this.actor(request), sessionOf(request), projectId));
  }

  @Get('settings')
  settings(@Req() request: FinanceRequest) {
    return this.run(() => this.app.settings(this.actor(request)));
  }
  @Put('settings')
  saveSettings(@Req() request: FinanceRequest, @Body() body: SaveFinanceSettingsRequest) {
    return this.run(() => this.app.saveSettings(this.actor(request), body));
  }

  /* Phiếu */
  @Get('vouchers')
  vouchers(
    @Req() request: FinanceRequest,
    @Query('kind') kind: FinanceVoucherKind,
    @Query('status') status?: FinanceVoucherStatus,
    @Query('search') search?: string,
    @Query('accountId') accountId?: string,
    @Query('reasonId') reasonId?: string,
    @Query('projectId') projectId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('scope') scope?: FinanceVoucherListQuery['scope'],
    @Query('source') source?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.run(() =>
      this.app.listVouchers(this.actor(request), {
        kind,
        status: status || undefined,
        search,
        accountId: accountId || undefined,
        reasonId: reasonId || undefined,
        projectId: projectId || undefined,
        from: from || undefined,
        to: to || undefined,
        scope: scope || undefined,
        source: source === 'procedure' ? 'procedure' : undefined,
        page: int(page),
        pageSize: int(pageSize),
      }),
    );
  }

  @Get('vouchers/next-code')
  nextCode(@Req() request: FinanceRequest, @Query('kind') kind: FinanceVoucherKind, @Query('date') date?: string) {
    return this.run(() => this.app.nextCode(this.actor(request), kind, date));
  }

  /** Từ id lần gửi (sourceId của hồ sơ trong Procedure) về phiếu, để hồ sơ quy trình liên kết ngược sang Tài chính. */
  @Get('vouchers/by-link/:linkId')
  voucherByLink(@Req() request: FinanceRequest, @Param('linkId') linkId: string) {
    return this.run(() => this.app.voucherOfProcedureLink(this.actor(request), linkId));
  }

  @Get('vouchers/:id')
  voucher(@Req() request: FinanceRequest, @Param('id') id: string) {
    return this.run(() => this.app.voucher(this.actor(request), id));
  }

  @Post('vouchers')
  createVoucher(@Req() request: FinanceRequest, @Body() body: SaveFinanceVoucherRequest) {
    return this.run(() => this.app.createVoucher(this.actor(request), body));
  }

  @Put('vouchers/:id')
  updateVoucher(@Req() request: FinanceRequest, @Param('id') id: string, @Body() body: SaveFinanceVoucherRequest) {
    return this.run(() => this.app.updateVoucher(this.actor(request), id, body));
  }

  @Delete('vouchers/:id')
  @HttpCode(204)
  async deleteVoucher(@Req() request: FinanceRequest, @Param('id') id: string) {
    await this.run(() => this.app.deleteVoucher(this.actor(request), id));
  }

  @Post('vouchers/:id/submit')
  @HttpCode(200)
  submit(@Req() request: FinanceRequest, @Param('id') id: string) {
    return this.run(() => this.app.submit(this.actor(request), id));
  }
  /* Cột hiển thị riêng của người dùng */
  @Get('preferences/list-columns/:listKey')
  listColumns(@Req() request: FinanceRequest, @Param('listKey') listKey: string) {
    return this.run(() => this.app.listColumns(this.actor(request), listKey));
  }
  @Put('preferences/list-columns/:listKey')
  saveListColumns(@Req() request: FinanceRequest, @Param('listKey') listKey: string, @Body() body: SaveFinanceListColumnsRequest) {
    return this.run(() => this.app.saveListColumns(this.actor(request), listKey, body?.columns === undefined ? undefined : body.columns));
  }

  @Post('vouchers/bulk-approve')
  @HttpCode(200)
  bulkApprove(@Req() request: FinanceRequest, @Body() body: FinanceBulkApproveRequest) {
    return this.run(() => this.app.bulkApprove(this.actor(request), body));
  }
  @Post('vouchers/:id/approve')
  @HttpCode(200)
  approve(@Req() request: FinanceRequest, @Param('id') id: string, @Body() body: FinanceDecisionRequest) {
    return this.run(() => this.app.approve(this.actor(request), id, body?.note));
  }
  @Post('vouchers/:id/reject')
  @HttpCode(200)
  reject(@Req() request: FinanceRequest, @Param('id') id: string, @Body() body: FinanceDecisionRequest) {
    return this.run(() => this.app.reject(this.actor(request), id, body?.note));
  }
  @Post('vouchers/:id/cancel')
  @HttpCode(200)
  cancel(@Req() request: FinanceRequest, @Param('id') id: string, @Body() body: FinanceDecisionRequest) {
    return this.run(() => this.app.cancel(this.actor(request), sessionOf(request), id, body?.note));
  }
  @Post('vouchers/:id/procedure-action')
  @HttpCode(200)
  procedureAction(@Req() request: FinanceRequest, @Param('id') id: string, @Body() body: FinanceProcedureActionRequest) {
    return this.run(() => this.app.procedureAction(this.actor(request), sessionOf(request), id, body));
  }
  @Post('vouchers/:id/procedure-retry')
  @HttpCode(200)
  procedureRetry(@Req() request: FinanceRequest, @Param('id') id: string) {
    return this.run(() => this.app.retryProcedure(this.actor(request), id));
  }
  /* Phiếu tạo từ hồ sơ quy trình (bước Tài chính) */
  @Post('vouchers/:id/post-sourced')
  @HttpCode(200)
  postSourced(@Req() request: FinanceRequest, @Param('id') id: string, @Body() body: FinancePostSourcedRequest) {
    return this.run(() => this.app.postSourced(this.actor(request), id, { note: body?.note, revision: body?.revision }));
  }
  @Post('vouchers/:id/return-source')
  @HttpCode(200)
  returnSource(@Req() request: FinanceRequest, @Param('id') id: string, @Body() body: FinanceReturnSourceRequest & { revision?: number }) {
    return this.run(() => this.app.returnSourced(this.actor(request), id, { reason: body?.reason, revision: body?.revision }));
  }
  @Post('vouchers/:id/take-over')
  @HttpCode(200)
  takeOver(@Req() request: FinanceRequest, @Param('id') id: string) {
    return this.run(() => this.app.takeOverSourced(this.actor(request), id));
  }
  @Post('vouchers/:id/retry-source-reversal')
  @HttpCode(200)
  retrySourceReversal(@Req() request: FinanceRequest, @Param('id') id: string) {
    return this.run(() => this.app.retrySourceReversal(this.actor(request), id));
  }

  @Post('vouchers/:id/reverse')
  @HttpCode(200)
  reverse(@Req() request: FinanceRequest, @Param('id') id: string, @Body() body: FinanceDecisionRequest) {
    return this.run(() => this.app.reverse(this.actor(request), id, body?.note));
  }

  /* Đính kèm chứng từ */
  @Post('vouchers/:id/attachments')
  createAttachment(@Req() request: FinanceRequest, @Param('id') id: string, @Body() body: { fileName?: string; contentType?: string; sizeBytes?: number; purpose?: string }) {
    return this.run(() => this.app.createAttachment(this.actor(request), id, body ?? {}));
  }
  @Post('vouchers/:id/attachments/:attachmentId/complete')
  @HttpCode(200)
  completeAttachment(@Req() request: FinanceRequest, @Param('id') id: string, @Param('attachmentId') attachmentId: string) {
    return this.run(() => this.app.completeAttachment(this.actor(request), id, attachmentId));
  }
  @Get('vouchers/:id/attachments/:attachmentId/download')
  downloadAttachment(@Req() request: FinanceRequest, @Param('id') id: string, @Param('attachmentId') attachmentId: string) {
    return this.run(() => this.app.downloadAttachment(this.actor(request), id, attachmentId));
  }
  @Delete('vouchers/:id/attachments/:attachmentId')
  @HttpCode(204)
  async removeAttachment(@Req() request: FinanceRequest, @Param('id') id: string, @Param('attachmentId') attachmentId: string) {
    await this.run(() => this.app.removeAttachment(this.actor(request), id, attachmentId));
  }

  /* Quy trình duyệt */
  @Get('approval-bindings')
  approvalBindings(@Req() request: FinanceRequest) {
    return this.run(() => this.app.approvalBindings(this.actor(request)));
  }
  @Put('approval-bindings/:kind')
  saveApprovalBinding(@Req() request: FinanceRequest, @Param('kind') kind: FinanceVoucherKind, @Body() body: SaveFinanceApprovalBindingRequest) {
    return this.run(() => this.app.saveApprovalBinding(this.actor(request), kind, body));
  }
  @Get('approval-bindings/procedure-definitions')
  procedureDefinitions(@Req() request: FinanceRequest) {
    return this.run(() => this.app.procedureDefinitions(this.actor(request), sessionOf(request)));
  }

  /** Route nội bộ cho Procedure (service token): loại phiếu bước Tài chính tạo được, hỏi lúc công bố quy trình. */
  @Get('internal/integration/capabilities')
  integrationCapabilities(@Req() request: FinanceRequest) {
    return this.run(() => {
      this.actor(request);
      return this.app.integrationCapabilities();
    });
  }

  /** Route nội bộ cho Procedure (service token, không có người dùng): huỷ hiệu lực hồ sơ có được không. */
  @Get('internal/procedure-links/:linkId/reversal-check')
  reversalCheck(@Req() request: FinanceRequest, @Param('linkId') linkId: string) {
    return this.run(() => this.app.procedureReversalCheck(this.actor(request).tenantId, linkId));
  }

  /** Route nội bộ cho Procedure (service token): huỷ hiệu lực một hồ sơ (có thể có bước Tài chính) có được không. */
  @Get('internal/instances/:instanceId/reversal-check')
  instanceReversalCheck(@Req() request: FinanceRequest, @Param('instanceId') instanceId: string) {
    return this.run(() => this.app.instanceReversalCheck(this.actor(request).tenantId, instanceId));
  }

  /* Báo cáo */
  @Get('reports/summary')
  report(
    @Req() request: FinanceRequest,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('accountId') accountId?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.run(() =>
      this.app.report(this.actor(request), { from, to, accountId: accountId || undefined, projectId: projectId || undefined }),
    );
  }

  @Get('reports/ledger')
  ledgerReport(
    @Req() request: FinanceRequest,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('accountId') accountId?: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    return this.run(() =>
      this.app.ledgerReport(this.actor(request), { from, to, accountId: accountId || undefined, offset: int(offset), limit: int(limit) }),
    );
  }

  private actor(request: FinanceRequest): FinanceActor {
    if (!request.financeActor) throw new HttpException({ code: 'UNAUTHORIZED', message: 'Thiếu danh tính người dùng.' }, 401);
    return request.financeActor;
  }

  /** Đổi lỗi nghiệp vụ thành HTTP kèm mã lỗi ổn định cho giao diện; lỗi lạ giữ nguyên để Nest ghi log 500. */
  private async run<T>(work: () => Promise<T> | T): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof FinanceError)
        throw new HttpException({ code: error.code, message: error.message, details: error.details }, error.status);
      throw error;
    }
  }
}
