import { Inject, Injectable } from '@nestjs/common';
import {
  FINANCE_VOUCHER_KINDS,
  type FinanceAccount,
  type FinanceApprovalBinding,
  type FinanceProcedureActionRequest,
  type SaveFinanceApprovalBindingRequest,
  type SaveFinanceApprovalBindingResponse,
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
import { conflict, forbidden, invalid, notFound } from '../domain/finance.error.js';
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
import {
  FINANCE_STORAGE,
  attachmentDownload,
  completeAttachment,
  createAttachment,
  removeAttachment,
  type FinanceStoragePort,
} from '../infrastructure/attachments.store.js';
import { FinanceDatabase, dateOnly, num, optStr, todayVn } from '../infrastructure/finance.database.js';
import {
  applyProcedureAction,
  fetchPublishedProcedureDefinition,
  isProcedureReachable,
  listPublishedProcedures,
  procedureUnavailable,
  type ForwardedSession,
} from '../infrastructure/procedure-api.js';
import {
  bindingFor,
  createProcedureLink,
  currentLink,
  listBindings,
  procedureView,
  reconcileLink,
  retryLink,
  reversalCheck,
  saveBinding,
  startProcedureForLink,
  voucherOfLink,
} from '../infrastructure/procedure-links.store.js';
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

/** Procedure dùng được cho tenant: nhớ kết quả ngắn để mỗi lần tải màn hình không phải gọi mạng. */
const AVAILABILITY_TTL_MS = 10_000;

@Injectable()
export class FinanceApplication {
  private readonly availability = new Map<string, { value: boolean; expiresAt: number }>();

  constructor(
    private readonly database: FinanceDatabase,
    @Inject(FINANCE_STORAGE) private readonly storage: FinanceStoragePort,
  ) {}

  async procedureAvailable(tenantId: string): Promise<boolean> {
    const cached = this.availability.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const value = await isProcedureReachable(tenantId);
    this.availability.set(tenantId, { value, expiresAt: Date.now() + AVAILABILITY_TTL_MS });
    return value;
  }

  /** Quyền hiện tại kèm tình trạng Procedure (cần gọi mạng), dùng cho endpoint /capabilities. */
  async describeCapabilities(actor: FinanceActor): Promise<FinanceCapabilities> {
    return { ...this.capabilities(actor), procedureAvailable: await this.procedureAvailable(actor.tenantId) };
  }

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
    const procedure = summary.approvalMode === 'PROCEDURE' ? await procedureView(db, actor.tenantId, id, actor.userId) : null;
    const permissions = computeVoucherPermissions({
      status: summary.status,
      createdBy: summary.createdBy,
      actorId: actor.userId,
      canCreate: canCreate(actor, kind),
      canApprove: canApprove(actor, kind),
      allowSelfApproval: settings.allowSelfApproval,
      approvalMode: summary.approvalMode,
      procedureCanAct: procedure?.canAct ?? null,
    });
    // Phiếu kẹt (chưa tạo được hồ sơ, hoặc quy trình đã duyệt nhưng chưa ghi sổ được): người lập và người duyệt được thử lại.
    if (procedure && ['START_PENDING', 'FAILED', 'CONFLICT'].includes(procedure.syncStatus))
      permissions.canRetryProcedure = (summary.createdBy === actor.userId && canCreate(actor, kind)) || canApprove(actor, kind);
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
      procedure,
      permissions,
    };
  }

  async createVoucher(actor: FinanceActor, input: SaveFinanceVoucherRequest): Promise<FinanceVoucher> {
    const voucher = normalizeVoucherInput(input);
    if (!canCreate(actor, voucher.kind)) throw forbidden('Bạn không có quyền lập loại phiếu này.');
    const id = await this.database.transaction(actor.tenantId, (db) => createVoucher(db, actor.tenantId, actor, voucher));
    return this.voucher(actor, id);
  }

  async updateVoucher(actor: FinanceActor, id: string, input: SaveFinanceVoucherRequest): Promise<FinanceVoucher> {
    const voucher = normalizeVoucherInput(input);
    if (!canCreate(actor, voucher.kind)) throw forbidden('Bạn không có quyền lập loại phiếu này.');
    await this.database.transaction(actor.tenantId, (db) => updateVoucher(db, actor.tenantId, actor, id, voucher, input.revision));
    return this.voucher(actor, id);
  }

  async deleteVoucher(actor: FinanceActor, id: string): Promise<void> {
    this.capabilities(actor);
    await this.database.transaction(actor.tenantId, (db) => deleteDraft(db, actor.tenantId, actor, id));
  }

  /**
   * Gửi duyệt. Loại phiếu đang gán quy trình thì tạo liên kết trong CÙNG giao dịch với việc chuyển sang chờ duyệt (hoặc cùng huỷ),
   * rồi tạo hồ sơ trong Procedure sau khi commit; lỗi ở bước đó không làm mất lần gửi mà để tiến trình nền thử lại.
   */
  async submit(actor: FinanceActor, id: string): Promise<FinanceVoucher> {
    this.capabilities(actor);
    const pool = await this.database.pool(actor.tenantId);
    const found = (await pool.query(`SELECT kind FROM finance_schema.vouchers WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, id])).rows[0] as
      | { kind: FinanceVoucherKind }
      | undefined;
    if (!found) throw notFound('phiếu');
    const binding = await bindingFor(pool, actor.tenantId, found.kind);

    let definition: Awaited<ReturnType<typeof fetchPublishedProcedureDefinition>> | null = null;
    if (binding.mode === 'PROCEDURE' && binding.procedureDefinitionId) {
      // Đã cấu hình duyệt qua quy trình mà Procedure không khả dụng: dừng thay vì lặng lẽ duyệt trực tiếp.
      if (!(await this.procedureAvailable(actor.tenantId))) throw procedureUnavailable();
      definition = await fetchPublishedProcedureDefinition(actor.tenantId, binding.procedureDefinitionId);
    }

    const linkId = await this.database.transaction(actor.tenantId, async (db) => {
      const row = await submitVoucher(db, actor.tenantId, actor, id, definition ? 'PROCEDURE' : 'DIRECT');
      return definition ? createProcedureLink(db, actor.tenantId, row, definition, actor.userId) : null;
    });
    if (linkId) {
      const link = await startProcedureForLink(pool, actor.tenantId, linkId);
      // Quy trình chỉ có bước S sẽ tự hoàn thành ngay khi tạo: áp kết quả luôn thay vì chờ sự kiện.
      if (link.instanceId) await reconcileLink(pool, actor.tenantId, linkId).catch(() => undefined);
    }
    return this.voucher(actor, id);
  }

  async approve(actor: FinanceActor, id: string, note?: string): Promise<FinanceVoucher> {
    this.capabilities(actor);
    await this.database.transaction(actor.tenantId, (db) => approveVoucher(db, actor.tenantId, actor, id, note));
    return this.voucher(actor, id);
  }

  async reject(actor: FinanceActor, id: string, note?: string): Promise<FinanceVoucher> {
    this.capabilities(actor);
    await this.database.transaction(actor.tenantId, (db) => rejectVoucher(db, actor.tenantId, actor, id, note));
    return this.voucher(actor, id);
  }

  /**
   * Huỷ phiếu chưa ghi sổ. Phiếu đang chạy trong quy trình thì huỷ hồ sơ bên Procedure trước (bằng phiên của người dùng:
   * Procedure quyết định có cho huỷ không), rồi mới huỷ phiếu; lần gửi bị đóng nên sự kiện đến muộn không áp lại.
   */
  async cancel(actor: FinanceActor, session: ForwardedSession, id: string, note?: string): Promise<FinanceVoucher> {
    this.capabilities(actor);
    const pool = await this.database.pool(actor.tenantId);
    const row = (await pool.query(`SELECT status, approval_mode FROM finance_schema.vouchers WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, id])).rows[0] as
      | { status: string; approval_mode: string }
      | undefined;
    if (row?.status === 'PENDING' && row.approval_mode === 'PROCEDURE') {
      const link = await currentLink(pool, actor.tenantId, id);
      if (link?.instanceId && link.syncStatus === 'RUNNING')
        await applyProcedureAction(session, link.instanceId, {
          action: 'cancel',
          comment: note?.trim() || 'Huỷ phiếu',
          idempotencyKey: `finance:${link.id}:cancel`,
        });
    }
    await this.database.transaction(actor.tenantId, async (db) => {
      await cancelVoucher(db, actor.tenantId, actor, id, note);
      await db.query(`UPDATE finance_schema.procedure_links SET sync_status='CLOSED', updated_at=now() WHERE voucher_id=$1 AND sync_status NOT IN ('APPLIED','CLOSED')`, [id]);
    });
    return this.voucher(actor, id);
  }

  async reverse(actor: FinanceActor, id: string, note?: string): Promise<FinanceVoucher> {
    this.capabilities(actor);
    await this.database.transaction(actor.tenantId, (db) => reverseVoucher(db, actor.tenantId, actor, id, note));
    return this.voucher(actor, id);
  }

  /* ------------------------------- Đính kèm ------------------------------- */

  /** Bước 1: tạo bản ghi và URL ký sẵn để trình duyệt tải thẳng lên kho; tệp chưa hiện trên phiếu cho tới khi xác nhận. */
  async createAttachment(actor: FinanceActor, voucherId: string, input: { fileName?: unknown; contentType?: unknown; sizeBytes?: unknown }) {
    this.capabilities(actor);
    return this.database.transaction(actor.tenantId, (db) => createAttachment(db, this.storage, actor.tenantId, actor, voucherId, input));
  }

  /** Bước 2: xác nhận tệp đã lên kho đúng kích thước và định dạng. */
  async completeAttachment(actor: FinanceActor, voucherId: string, attachmentId: string) {
    this.capabilities(actor);
    return completeAttachment(await this.database.pool(actor.tenantId), this.storage, actor.tenantId, actor, voucherId, attachmentId);
  }

  async downloadAttachment(actor: FinanceActor, voucherId: string, attachmentId: string) {
    this.capabilities(actor);
    const pool = await this.database.pool(actor.tenantId);
    await this.buildVoucher(pool, actor, voucherId); // người không xem được phiếu nhận 404
    return attachmentDownload(pool, this.storage, actor.tenantId, voucherId, attachmentId);
  }

  async removeAttachment(actor: FinanceActor, voucherId: string, attachmentId: string): Promise<void> {
    this.capabilities(actor);
    await this.database.transaction(actor.tenantId, (db) => removeAttachment(db, actor.tenantId, actor, voucherId, attachmentId));
  }

  /* --------------------------- Duyệt qua quy trình --------------------------- */

  /**
   * Duyệt / từ chối / trả lại hồ sơ quy trình của phiếu bằng phiên của chính người dùng. Procedure quyết định người này có được
   * thao tác bước hiện tại hay không; nếu thao tác làm hồ sơ kết thúc thì áp kết quả vào phiếu ngay (không chờ sự kiện).
   */
  async procedureAction(actor: FinanceActor, session: ForwardedSession, id: string, input: FinanceProcedureActionRequest): Promise<FinanceVoucher> {
    this.capabilities(actor);
    if (!['approve', 'reject', 'return'].includes(input.action)) throw invalid('Thao tác không hợp lệ.');
    if (!input.idempotencyKey?.trim()) throw invalid('Thiếu mã thao tác.');
    if ((input.action === 'reject' || input.action === 'return') && !input.comment?.trim()) throw invalid('Nhập lý do.');
    const voucher = await this.voucher(actor, id); // kiểm quyền xem
    if (voucher.approvalMode !== 'PROCEDURE' || voucher.status !== 'PENDING') throw conflict('FINANCE_VOUCHER_STATE', 'Phiếu không đang chờ duyệt qua quy trình.');
    const pool = await this.database.pool(actor.tenantId);
    const link = await currentLink(pool, actor.tenantId, id);
    if (!link?.instanceId || link.syncStatus !== 'RUNNING') throw conflict('FINANCE_PROCEDURE_STATE', 'Hồ sơ quy trình chưa sẵn sàng hoặc đã kết thúc.');
    await applyProcedureAction(session, link.instanceId, {
      action: input.action,
      comment: input.comment?.trim(),
      idempotencyKey: `finance:${link.id}:${input.idempotencyKey.trim()}`,
    });
    await reconcileLink(pool, actor.tenantId, link.id, { userId: actor.userId, displayName: actor.displayName }).catch(() => undefined);
    return this.voucher(actor, id);
  }

  /** Thử lại khi phiếu kẹt: chưa tạo được hồ sơ, hoặc quy trình đã duyệt nhưng chưa ghi sổ được. */
  async retryProcedure(actor: FinanceActor, id: string): Promise<FinanceVoucher> {
    this.capabilities(actor);
    const voucher = await this.voucher(actor, id);
    if (!voucher.permissions.canRetryProcedure) throw forbidden('Bạn không thể thử lại phiếu này.');
    const pool = await this.database.pool(actor.tenantId);
    const link = await currentLink(pool, actor.tenantId, id);
    if (!link) throw conflict('FINANCE_PROCEDURE_STATE', 'Phiếu không có lần gửi qua quy trình.');
    await retryLink(pool, actor.tenantId, link.id, { userId: actor.userId, displayName: actor.displayName });
    return this.voucher(actor, id);
  }

  /** Cấu hình duyệt theo loại phiếu. */
  async approvalBindings(actor: FinanceActor): Promise<FinanceApprovalBinding[]> {
    require(actor, 'finance.settings.manage', 'Bạn không có quyền cấu hình quy trình duyệt.');
    return listBindings(await this.database.pool(actor.tenantId), actor.tenantId);
  }

  async saveApprovalBinding(actor: FinanceActor, kind: FinanceVoucherKind, input: SaveFinanceApprovalBindingRequest): Promise<SaveFinanceApprovalBindingResponse> {
    require(actor, 'finance.settings.manage', 'Bạn không có quyền cấu hình quy trình duyệt.');
    const pool = await this.database.pool(actor.tenantId);
    return saveBinding(pool, actor.tenantId, actor.userId, kind, input);
  }

  /** Các quy trình đã công bố để chọn, theo quyền Procedure của chính người cấu hình. */
  async procedureDefinitions(actor: FinanceActor, session: ForwardedSession) {
    require(actor, 'finance.settings.manage', 'Bạn không có quyền cấu hình quy trình duyệt.');
    return listPublishedProcedures(session, actor.tenantId);
  }

  /** Từ hồ sơ quy trình (sourceId = id lần gửi) tìm về phiếu để mở trong Tài chính. */
  async voucherOfProcedureLink(actor: FinanceActor, linkId: string): Promise<{ id: string; kind: FinanceVoucherKind }> {
    this.capabilities(actor);
    const found = await voucherOfLink(await this.database.pool(actor.tenantId), actor.tenantId, linkId);
    if (!found) throw notFound('phiếu');
    await this.voucher(actor, found.id); // người không xem được phiếu nhận 404, không lộ mã phiếu
    return found;
  }

  /** Procedure hỏi trước khi huỷ hiệu lực hồ sơ (chỉ đọc), do dịch vụ nội bộ gọi nên không có người dùng. */
  async procedureReversalCheck(tenantId: string, linkId: string): Promise<{ allowed: boolean; reason?: string }> {
    return reversalCheck(await this.database.pool(tenantId), tenantId, linkId);
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
