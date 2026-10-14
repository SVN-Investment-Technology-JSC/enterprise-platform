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
  FinanceDecisionRequest,
  FinanceVoucherKind,
  FinanceVoucherListQuery,
  FinanceVoucherStatus,
  SaveFinanceAccountRequest,
  SaveFinanceCostCenterRequest,
  SaveFinanceCounterpartyGroupRequest,
  SaveFinanceReasonRequest,
  SaveFinanceSettingsRequest,
  SaveFinanceVoucherRequest,
} from '@enterprise-platform/contracts-finance';
import { FinanceApplication } from '../application/finance.application.js';
import type { FinanceActor } from '../domain/finance.access.js';
import { FinanceError } from '../domain/finance.error.js';

interface FinanceRequest {
  financeActor?: FinanceActor;
}

const bool = (value: string | undefined) => value === 'true' || value === '1';
const int = (value: string | undefined) => (value === undefined || value === '' ? undefined : Number(value));

@Controller('v1')
export class FinanceController {
  constructor(private readonly app: FinanceApplication) {}

  @Get('capabilities')
  capabilities(@Req() request: FinanceRequest) {
    return this.run(() => this.app.capabilities(this.actor(request)));
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
  @Post('catalogs/cost-centers')
  createCostCenter(@Req() request: FinanceRequest, @Body() body: SaveFinanceCostCenterRequest) {
    return this.run(() => this.app.saveCostCenter(this.actor(request), null, body));
  }
  @Put('catalogs/cost-centers/:id')
  updateCostCenter(@Req() request: FinanceRequest, @Param('id') id: string, @Body() body: SaveFinanceCostCenterRequest) {
    return this.run(() => this.app.saveCostCenter(this.actor(request), id, body));
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
    @Query('costCenterId') costCenterId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('scope') scope?: FinanceVoucherListQuery['scope'],
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
        costCenterId: costCenterId || undefined,
        from: from || undefined,
        to: to || undefined,
        scope: scope || undefined,
        page: int(page),
        pageSize: int(pageSize),
      }),
    );
  }

  @Get('vouchers/next-code')
  nextCode(@Req() request: FinanceRequest, @Query('kind') kind: FinanceVoucherKind, @Query('date') date?: string) {
    return this.run(() => this.app.nextCode(this.actor(request), kind, date));
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
    return this.run(() => this.app.cancel(this.actor(request), id, body?.note));
  }
  @Post('vouchers/:id/reverse')
  @HttpCode(200)
  reverse(@Req() request: FinanceRequest, @Param('id') id: string, @Body() body: FinanceDecisionRequest) {
    return this.run(() => this.app.reverse(this.actor(request), id, body?.note));
  }

  /* Báo cáo */
  @Get('reports/summary')
  report(
    @Req() request: FinanceRequest,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('accountId') accountId?: string,
    @Query('costCenterId') costCenterId?: string,
  ) {
    return this.run(() =>
      this.app.report(this.actor(request), { from, to, accountId: accountId || undefined, costCenterId: costCenterId || undefined }),
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
