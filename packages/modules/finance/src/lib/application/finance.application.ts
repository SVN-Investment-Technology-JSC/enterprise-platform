import { Injectable } from '@nestjs/common';
import {
  FINANCE_VOUCHER_KINDS,
  type FinanceAccount,
  type FinanceCapabilities,
  type FinanceCatalogs,
  type FinanceCostCenter,
  type FinanceCounterpartyGroup,
  type FinanceDashboard,
  type FinanceLedgerEntry,
  type FinancePage,
  type FinanceReason,
  type FinanceReport,
  type FinanceReportQuery,
  type FinanceSettings,
  type FinanceVoucher,
  type FinanceVoucherKind,
  type FinanceVoucherList,
  type FinanceVoucherListQuery,
  type SaveFinanceAccountRequest,
  type SaveFinanceCostCenterRequest,
  type SaveFinanceCounterpartyGroupRequest,
  type SaveFinanceReasonRequest,
  type SaveFinanceSettingsRequest,
  type SaveFinanceVoucherRequest,
} from '@enterprise-platform/contracts-finance';
import {
  can,
  canApprove,
  canCreate,
  canReadAll,
  canSeeBalances,
  creatableKinds,
  hasAnyFinanceAccess,
  type FinanceActor,
} from '../domain/finance.access.js';
import { forbidden, invalid, notFound } from '../domain/finance.error.js';
import { computeVoucherPermissions, isValidDate, normalizeVoucherInput } from '../domain/voucher.rules.js';
import { accountLedger, getAccount, listAccounts, saveAccount, type LedgerQuery } from '../infrastructure/accounts.store.js';
import {
  listCatalogs,
  loadSettings,
  saveCostCenter,
  saveCounterpartyGroup,
  saveReason,
  saveSettings,
} from '../infrastructure/catalogs.store.js';
import { FinanceDatabase, dateOnly, num, optStr, todayVn } from '../infrastructure/finance.database.js';
import { financeDashboard, financeReport } from '../infrastructure/reports.store.js';
import {
  approveVoucher,
  cancelVoucher,
  rejectVoucher,
  reverseVoucher,
  submitVoucher,
} from '../infrastructure/voucher-workflow.js';
import {
  canViewVoucher,
  createVoucher,
  deleteDraft,
  listVouchers,
  loadVoucherRecord,
  mapAttachment,
  mapEvent,
  mapInvoice,
  mapLine,
  mapRelated,
  mapSummary,
  peekNextCode,
  taxAmountOf,
  updateVoucher,
} from '../infrastructure/vouchers.store.js';

function require(actor: FinanceActor, action: string, message: string): void {
  if (!can(actor, action)) throw forbidden(message);
}

/** Dùng được màn hình phiếu của loại này: lập, duyệt, hoặc đọc toàn bộ. */
function requireKindAccess(actor: FinanceActor, kind: FinanceVoucherKind): void {
  if (!FINANCE_VOUCHER_KINDS.includes(kind)) throw invalid('Loại phiếu không hợp lệ.');
  if (!canCreate(actor, kind) && !canApprove(actor, kind) && !canReadAll(actor)) throw forbidden('Bạn không có quyền với loại phiếu này.');
}

@Injectable()
export class FinanceApplication {
  constructor(private readonly database: FinanceDatabase) {}

  capabilities(actor: FinanceActor): FinanceCapabilities {
    if (!hasAnyFinanceAccess(actor)) throw forbidden('Bạn không có quyền sử dụng Tài chính.');
    const kind = (k: FinanceVoucherKind) => ({ create: canCreate(actor, k), approve: canApprove(actor, k) });
    return {
      canManage: can(actor, 'finance.manage'),
      canReadAll: canReadAll(actor),
      receipt: kind('RECEIPT'),
      payment: kind('PAYMENT'),
      transfer: kind('TRANSFER'),
      canManageAccounts: can(actor, 'finance.account.manage'),
      canReadReports: can(actor, 'finance.report.read') || canReadAll(actor),
      canManageSettings: can(actor, 'finance.settings.manage'),
      procedureAvailable: false,
    };
  }

  async dashboard(actor: FinanceActor): Promise<FinanceDashboard> {
    this.capabilities(actor);
    return financeDashboard(await this.database.pool(actor.tenantId), actor.tenantId, actor);
  }

  /* ----------------------------- Tài khoản ----------------------------- */

  async accounts(actor: FinanceActor, includeInactive: boolean): Promise<FinanceAccount[]> {
    this.capabilities(actor);
    const manage = can(actor, 'finance.account.manage') || can(actor, 'finance.settings.manage');
    return listAccounts(await this.database.pool(actor.tenantId), actor.tenantId, {
      includeInactive: includeInactive && manage,
      withBalances: canSeeBalances(actor),
    });
  }

  async account(actor: FinanceActor, id: string): Promise<FinanceAccount> {
    this.capabilities(actor);
    return getAccount(await this.database.pool(actor.tenantId), actor.tenantId, id, canSeeBalances(actor));
  }

  async saveAccount(actor: FinanceActor, id: string | null, input: SaveFinanceAccountRequest): Promise<FinanceAccount> {
    require(actor, 'finance.account.manage', 'Bạn không có quyền quản lý tài khoản.');
    return this.database.transaction(actor.tenantId, async (db) => {
      const savedId = await saveAccount(db, actor.tenantId, actor.userId, id, input);
      return getAccount(db, actor.tenantId, savedId, true);
    });
  }

  async accountLedger(actor: FinanceActor, id: string, query: LedgerQuery) {
    if (!canSeeBalances(actor)) throw forbidden('Bạn không có quyền xem sổ tài khoản.');
    return accountLedger(await this.database.pool(actor.tenantId), actor.tenantId, id, query) satisfies Promise<
      FinancePage<FinanceLedgerEntry> & { openingBalance: number }
    >;
  }

  /* ------------------------------ Danh mục ------------------------------ */

  async catalogs(actor: FinanceActor, includeInactive: boolean): Promise<FinanceCatalogs> {
    this.capabilities(actor);
    const pool = await this.database.pool(actor.tenantId);
    return listCatalogs(pool, actor.tenantId, includeInactive && can(actor, 'finance.settings.manage'));
  }

  async saveReason(actor: FinanceActor, id: string | null, input: SaveFinanceReasonRequest): Promise<FinanceReason> {
    require(actor, 'finance.settings.manage', 'Bạn không có quyền cấu hình danh mục.');
    return this.database.transaction(actor.tenantId, (db) => saveReason(db, actor.tenantId, id, input));
  }
  async saveCounterpartyGroup(actor: FinanceActor, id: string | null, input: SaveFinanceCounterpartyGroupRequest): Promise<FinanceCounterpartyGroup> {
    require(actor, 'finance.settings.manage', 'Bạn không có quyền cấu hình danh mục.');
    return this.database.transaction(actor.tenantId, (db) => saveCounterpartyGroup(db, actor.tenantId, id, input));
  }
  async saveCostCenter(actor: FinanceActor, id: string | null, input: SaveFinanceCostCenterRequest): Promise<FinanceCostCenter> {
    require(actor, 'finance.settings.manage', 'Bạn không có quyền cấu hình danh mục.');
    return this.database.transaction(actor.tenantId, (db) => saveCostCenter(db, actor.tenantId, id, input));
  }

  async settings(actor: FinanceActor): Promise<FinanceSettings> {
    this.capabilities(actor);
    return loadSettings(await this.database.pool(actor.tenantId), actor.tenantId);
  }
  async saveSettings(actor: FinanceActor, input: SaveFinanceSettingsRequest): Promise<FinanceSettings> {
    require(actor, 'finance.settings.manage', 'Bạn không có quyền cấu hình Tài chính.');
    return this.database.transaction(actor.tenantId, (db) => saveSettings(db, actor.tenantId, actor.userId, input));
  }

  /* -------------------------------- Phiếu -------------------------------- */

  async nextCode(actor: FinanceActor, kind: FinanceVoucherKind, date: string | undefined): Promise<{ code: string }> {
    requireKindAccess(actor, kind);
    const when = date && isValidDate(date) ? date : todayVn();
    return { code: await peekNextCode(await this.database.pool(actor.tenantId), actor.tenantId, kind, when) };
  }

  async listVouchers(actor: FinanceActor, query: FinanceVoucherListQuery): Promise<FinanceVoucherList> {
    requireKindAccess(actor, query.kind);
    const pool = await this.database.pool(actor.tenantId);
    const settings = await loadSettings(pool, actor.tenantId);
    return listVouchers(pool, actor.tenantId, actor, query, settings.allowSelfApproval);
  }

  async voucher(actor: FinanceActor, id: string): Promise<FinanceVoucher> {
    this.capabilities(actor);
    return this.buildVoucher(await this.database.pool(actor.tenantId), actor, id);
  }

  private async buildVoucher(
    db: Parameters<typeof loadVoucherRecord>[0],
    actor: FinanceActor,
    id: string,
  ): Promise<FinanceVoucher> {
    const record = await loadVoucherRecord(db, actor.tenantId, id);
    const row = record.row;
    const kind = row.kind as FinanceVoucherKind;
    if (!canViewVoucher(actor, row)) throw notFound('phiếu');
    const settings = await loadSettings(db, actor.tenantId);
    const summary = mapSummary(row);
    return {
      ...summary,
      counterpartyGroupId: optStr(row.counterparty_group_id),
      counterpartyAccountNo: optStr(row.counterparty_account_no),
      counterpartyBank: optStr(row.counterparty_bank),
      costCenterId: optStr(row.cost_center_id),
      costCenterName: optStr(row.cost_center_name),
      taxIncluded: Boolean(row.tax_included),
      taxRate: num(row.tax_rate),
      taxAmount: taxAmountOf(row),
      note: optStr(row.note),
      decisionNote: optStr(row.decision_note),
      decidedBy: optStr(row.decided_by),
      decidedByName: optStr(row.decided_by_name),
      revision: num(row.revision),
      lines: record.lines.map(mapLine),
      invoices: record.invoices.map(mapInvoice),
      related: record.related.map(mapRelated),
      attachments: record.attachments.map(mapAttachment),
      events: record.events.map(mapEvent),
      posted: Boolean(row.posted_at),
      procedure: null,
      permissions: computeVoucherPermissions({
        status: summary.status,
        createdBy: summary.createdBy,
        actorId: actor.userId,
        canCreate: canCreate(actor, kind),
        canApprove: canApprove(actor, kind),
        allowSelfApproval: settings.allowSelfApproval,
        approvalMode: summary.approvalMode,
        procedureCanAct: null,
      }),
    };
  }

  async createVoucher(actor: FinanceActor, input: SaveFinanceVoucherRequest): Promise<FinanceVoucher> {
    const voucher = normalizeVoucherInput(input);
    if (!canCreate(actor, voucher.kind)) throw forbidden('Bạn không có quyền lập loại phiếu này.');
    return this.database.transaction(actor.tenantId, async (db) => {
      const id = await createVoucher(db, actor.tenantId, actor, voucher);
      return this.buildVoucher(db, actor, id);
    });
  }

  async updateVoucher(actor: FinanceActor, id: string, input: SaveFinanceVoucherRequest): Promise<FinanceVoucher> {
    const voucher = normalizeVoucherInput(input);
    if (!canCreate(actor, voucher.kind)) throw forbidden('Bạn không có quyền lập loại phiếu này.');
    return this.database.transaction(actor.tenantId, async (db) => {
      await updateVoucher(db, actor.tenantId, actor, id, voucher, input.revision);
      return this.buildVoucher(db, actor, id);
    });
  }

  async deleteVoucher(actor: FinanceActor, id: string): Promise<void> {
    this.capabilities(actor);
    await this.database.transaction(actor.tenantId, (db) => deleteDraft(db, actor.tenantId, actor, id));
  }

  async submit(actor: FinanceActor, id: string): Promise<FinanceVoucher> {
    this.capabilities(actor);
    return this.database.transaction(actor.tenantId, async (db) => {
      await submitVoucher(db, actor.tenantId, actor, id);
      return this.buildVoucher(db, actor, id);
    });
  }
  async approve(actor: FinanceActor, id: string, note?: string): Promise<FinanceVoucher> {
    this.capabilities(actor);
    return this.database.transaction(actor.tenantId, async (db) => {
      await approveVoucher(db, actor.tenantId, actor, id, note);
      return this.buildVoucher(db, actor, id);
    });
  }
  async reject(actor: FinanceActor, id: string, note?: string): Promise<FinanceVoucher> {
    this.capabilities(actor);
    return this.database.transaction(actor.tenantId, async (db) => {
      await rejectVoucher(db, actor.tenantId, actor, id, note);
      return this.buildVoucher(db, actor, id);
    });
  }
  async cancel(actor: FinanceActor, id: string, note?: string): Promise<FinanceVoucher> {
    this.capabilities(actor);
    return this.database.transaction(actor.tenantId, async (db) => {
      await cancelVoucher(db, actor.tenantId, actor, id, note);
      return this.buildVoucher(db, actor, id);
    });
  }
  async reverse(actor: FinanceActor, id: string, note?: string): Promise<FinanceVoucher> {
    this.capabilities(actor);
    return this.database.transaction(actor.tenantId, async (db) => {
      await reverseVoucher(db, actor.tenantId, actor, id, note);
      return this.buildVoucher(db, actor, id);
    });
  }

  /* -------------------------------- Báo cáo -------------------------------- */

  async report(actor: FinanceActor, query: FinanceReportQuery): Promise<FinanceReport> {
    if (!can(actor, 'finance.report.read') && !canReadAll(actor)) throw forbidden('Bạn không có quyền xem báo cáo.');
    return financeReport(await this.database.pool(actor.tenantId), actor.tenantId, query);
  }

  /** Dùng cho kiểm thử: danh sách loại phiếu người dùng được phép lập. */
  creatableKinds(actor: FinanceActor): FinanceVoucherKind[] {
    return creatableKinds(actor);
  }
}

export { dateOnly };
