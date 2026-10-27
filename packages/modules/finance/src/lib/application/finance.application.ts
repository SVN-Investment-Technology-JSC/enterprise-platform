import { Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import {
  FINANCE_BULK_APPROVE_MAX,
  FINANCE_STEP_VOUCHER_KINDS,
  FINANCE_VOUCHER_KINDS,
  type FinanceAccount,
  type FinanceBulkApproveRequest,
  type FinanceBulkApproveResult,
  type FinanceListColumns,
  type FinanceInstanceReversalCheck,
  type FinanceIntegrationCapabilities,
  type FinanceVoucherSource,
  type FinanceVoucherSourceState,
  type FinanceApprovalBinding,
  type FinanceProcedureActionRequest,
  type SaveFinanceApprovalBindingRequest,
  type SaveFinanceApprovalBindingResponse,
  type FinanceCapabilities,
  type FinanceCatalogs,
  type FinanceCounterpartyGroup,
  type FinanceDashboard,
  type FinanceLedgerEntry,
  type FinancePage,
  type FinanceProjectVoucherList,
  type FinanceReason,
  type FinanceReport,
  type FinanceLedgerReport,
  type FinanceLedgerReportQuery,
  type FinanceReportQuery,
  type FinanceSettings,
  type FinanceVoucher,
  type FinanceVoucherKind,
  type FinanceVoucherList,
  type FinanceVoucherListQuery,
  type SaveFinanceAccountRequest,
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
import { FinanceError, conflict, forbidden, invalid, notFound } from '../domain/finance.error.js';
import { computeVoucherPermissions, isValidDate, normalizeVoucherInput } from '../domain/voucher.rules.js';
import { accountLedger, getAccount, listAccounts, saveAccount, type LedgerQuery } from '../infrastructure/accounts.store.js';
import {
  listCatalogs,
  loadSettings,
  saveCounterpartyGroup,
  saveReason,
  saveSettings,
} from '../infrastructure/catalogs.store.js';
import type { InternalProjectOptionList, InternalWorkItemOption } from '@enterprise-platform/contracts-workspace';
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
  FINANCE_STEP_UNVERIFIED_CODE,
  applyProcedureAction,
  fetchPublishedProcedureDefinition,
  isProcedureReachable,
  listPublishedProcedures,
  procedureStepCanAct,
  procedureUnavailable,
  type ForwardedSession,
} from '../infrastructure/procedure-api.js';
import {
  activeHandler,
  loadSourceRow,
  mapSource,
  openSourceCandidates,
  postSourcedVoucher,
  retrySourceReversal,
  returnSourcedVoucher,
  sourceReversalCheck,
  takeOverSourcedVoucher,
  updateSourcedVoucher,
} from '../infrastructure/voucher-sources.store.js';
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
import { financeDashboard, financeLedgerReport, financeReport } from '../infrastructure/reports.store.js';
import { loadListColumns, saveListColumns } from '../infrastructure/user-preferences.store.js';
import { listWorkspaceProjects, listWorkspaceWorkItems, projectFinanceAccess } from '../infrastructure/workspace-api.js';
import { resolveWorkspaceLinks } from '../infrastructure/workspace-links.js';
import {
  approveVoucher,
  cancelVoucher,
  isProcedureSource,
  rejectVoucher,
  reverseVoucher,
  submitVoucher,
} from '../infrastructure/voucher-workflow.js';
import {
  applyExternalSourceRequest,
  externalSourceState,
  externalSourceStateOfVoucher,
  parseExternalSourceRequest,
  planExternalVoucher,
} from '../infrastructure/external-sources.store.js';
import {
  canViewVoucher,
  createVoucher,
  deleteDraft,
  listProjectVouchers,
  listVouchers,
  loadStoredLinks,
  loadVoucherRecord,
  mapAttachment,
  mapEvent,
  mapInvoice,
  mapLine,
  mapRelatedProject,
  mapSummary,
  peekNextCode,
  taxAmountOf,
  updateVoucher,
} from '../infrastructure/vouchers.store.js';

function requirePermission(actor: FinanceActor, action: string, message: string): void {
  if (!can(actor, action)) throw forbidden(message);
}

/** Dùng được màn hình phiếu của loại này: lập, duyệt, hoặc đọc toàn bộ. */
function requireKindAccess(actor: FinanceActor, kind: FinanceVoucherKind): void {
  if (!FINANCE_VOUCHER_KINDS.includes(kind)) throw invalid('Loại phiếu không hợp lệ.');
  if (!canCreate(actor, kind) && !canApprove(actor, kind) && !canReadAll(actor)) throw forbidden('Bạn không có quyền với loại phiếu này.');
}

/** Số phiếu đang chờ tối đa được hỏi Procedure cho bộ lọc "Chờ tôi ghi sổ" (mới nhất trước). */
const TO_POST_CANDIDATE_LIMIT = 50;

type Pg = Parameters<typeof loadVoucherRecord>[0];

/** Procedure dùng được cho tenant: nhớ kết quả ngắn để mỗi lần tải màn hình không phải gọi mạng. */
const AVAILABILITY_TTL_MS = 10_000;

type BulkRow = QueryResultRow & { id?: unknown; code?: unknown };
const BULK_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    requirePermission(actor, 'finance.account.manage', 'Bạn không có quyền quản lý tài khoản.');
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
    requirePermission(actor, 'finance.settings.manage', 'Bạn không có quyền cấu hình danh mục.');
    return this.database.transaction(actor.tenantId, (db) => saveReason(db, actor.tenantId, id, input));
  }
  async saveCounterpartyGroup(actor: FinanceActor, id: string | null, input: SaveFinanceCounterpartyGroupRequest): Promise<FinanceCounterpartyGroup> {
    requirePermission(actor, 'finance.settings.manage', 'Bạn không có quyền cấu hình danh mục.');
    return this.database.transaction(actor.tenantId, (db) => saveCounterpartyGroup(db, actor.tenantId, id, input));
  }

  /* ------------------- Dự án và công việc của Workspace ------------------- */

  /** Dự án để chọn khi hạch toán / gắn liên quan. Cả tenant: kế toán không nhất thiết là thành viên dự án. */
  async workspaceProjects(actor: FinanceActor, search: string | undefined): Promise<InternalProjectOptionList> {
    this.capabilities(actor);
    return listWorkspaceProjects(actor.tenantId, search);
  }

  async workspaceWorkItems(actor: FinanceActor, projectId: string): Promise<{ items: InternalWorkItemOption[] }> {
    this.capabilities(actor);
    if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw invalid('Dự án không hợp lệ.');
    const items = await listWorkspaceWorkItems(actor.tenantId, projectId);
    if (!items) throw notFound('dự án');
    return { items };
  }

  /**
   * Thu chi của một dự án cho tab "Tài chính" bên Workspace. Hai lớp quyền, cần cả hai: Workspace quyết người này có được xem
   * tài chính dự án (chủ nhiệm, quản lý, quản trị tenant); Tài chính quyết người này có được xem phiếu (`finance.read`).
   * Số tiền tổng hợp chỉ đúng khi tính trên mọi phiếu của dự án, nên người chỉ thấy phiếu của mình không nhận số liệu một phần.
   */
  async projectVouchers(actor: FinanceActor, session: ForwardedSession, projectId: string): Promise<FinanceProjectVoucherList> {
    this.capabilities(actor);
    if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw invalid('Dự án không hợp lệ.');
    const access = await projectFinanceAccess(session, projectId);
    if (access === 'NOT_FOUND') throw notFound('dự án');
    if (access === 'FORBIDDEN') throw forbidden('Bạn không có quyền xem thu chi của dự án này.');
    requirePermission(actor, 'finance.read', 'Bạn chưa có quyền xem phiếu thu chi ở module Tài chính (cần quyền xem toàn bộ phiếu).');
    return listProjectVouchers(await this.database.pool(actor.tenantId), actor.tenantId, projectId.toLowerCase());
  }

  async settings(actor: FinanceActor): Promise<FinanceSettings> {
    this.capabilities(actor);
    return loadSettings(await this.database.pool(actor.tenantId), actor.tenantId);
  }
  async saveSettings(actor: FinanceActor, input: SaveFinanceSettingsRequest): Promise<FinanceSettings> {
    requirePermission(actor, 'finance.settings.manage', 'Bạn không có quyền cấu hình Tài chính.');
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
    const restrictIds = query.scope === 'to-post' ? await this.vouchersAwaitingMe(pool, actor, query.kind) : undefined;
    return listVouchers(pool, actor.tenantId, actor, query, settings.allowSelfApproval, restrictIds);
  }

  /**
   * "Chờ tôi ghi sổ": phiếu từ quy trình đang chờ mà tôi được giao bước Tài chính. Người được gán thẳng khớp ngay theo
   * `assignee_ids`; vai giao cho chức danh/đơn vị thì hỏi Procedure (`can-act`) — Tài chính không tự giải sơ đồ tổ chức.
   * Procedure không trả lời thì phiếu đó không vào danh sách (quyền thật vẫn kiểm khi thao tác).
   */
  private async vouchersAwaitingMe(pool: Pg, actor: FinanceActor, kind: FinanceVoucherKind): Promise<string[]> {
    if (!canApprove(actor, kind)) return [];
    const candidates = await openSourceCandidates(pool, actor.tenantId, kind, TO_POST_CANDIDATE_LIMIT);
    const settings = await loadSettings(pool, actor.tenantId);
    const checks = await Promise.all(
      candidates.map(async (row) => {
        // Nguồn ngoài Quy trình (Bán hàng): mọi người duyệt phiếu thu đều ghi sổ được, trừ người lập khi không cho tự duyệt.
        if (!isProcedureSource(row)) return row.created_by !== actor.userId || settings.allowSelfApproval ? String(row.voucher_id) : null;
        const direct = ((row.assignee_ids as string[] | null) ?? []).includes(actor.userId);
        if (direct) return String(row.voucher_id);
        const subjects = (row.assignee_subjects as unknown[] | null) ?? [];
        if (!subjects.length) return null;
        try {
          const result = await procedureStepCanAct(actor.tenantId, String(row.instance_id), String(row.step_instance_id), {
            userId: actor.userId,
            activation: num(row.activation),
          });
          return result.allowed ? String(row.voucher_id) : null;
        } catch {
          return null;
        }
      }),
    );
    return checks.filter((id): id is string => id !== null);
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
    let source: FinanceVoucherSource | null = null;
    if (summary.approvalMode === 'INHERITED') {
      const sourceRow = await loadSourceRow(db, actor.tenantId, id);
      if (sourceRow) {
        const procedureSource = isProcedureSource(sourceRow);
        const waiting = summary.status === 'DRAFT' && sourceRow.status === 'OPEN' && canApprove(actor, kind);
        const decision = !waiting
          ? { canAct: null, reason: null }
          : procedureSource
            ? await this.stepDecision(actor, sourceRow)
            : { canAct: true, reason: null };
        // Nguồn ngoài Quy trình chưa qua ai duyệt: người lập không tự ghi sổ khi cài đặt không cho tự duyệt (vẫn trả lại được).
        const selfBlocked = !procedureSource && summary.createdBy === actor.userId && !settings.allowSelfApproval;
        source = mapSource(
          sourceRow,
          selfBlocked && decision.canAct ? false : decision.canAct,
          selfBlocked && decision.canAct ? 'Không được tự duyệt phiếu do mình lập.' : decision.reason,
        );
        const handler = activeHandler(sourceRow);
        const heldByOther = Boolean(handler && handler.userId !== actor.userId);
        const act = decision.canAct === true;
        permissions.sourced = {
          canEditSourced: act && !heldByOther,
          canPost: act && !heldByOther && !selfBlocked,
          canReturnSource: act && !heldByOther,
          canTakeOver: act && heldByOther,
          canRetryReversal: sourceRow.status === 'REVERSAL_PENDING' && summary.status === 'APPROVED' && canApprove(actor, kind),
        };
        // Phiếu nguồn Bán hàng đã ghi sổ: người có quyền duyệt đảo thủ công như phiếu thường (nguồn Quy trình chỉ đảo theo hồ sơ).
        if (!procedureSource) permissions.canReverse = summary.status === 'APPROVED' && canApprove(actor, kind);
      }
    }
    return {
      ...summary,
      counterpartyGroupId: optStr(row.counterparty_group_id),
      counterpartyAccountNo: optStr(row.counterparty_account_no),
      counterpartyBank: optStr(row.counterparty_bank),
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
      relatedProjects: record.related.map(mapRelatedProject),
      attachments: record.attachments.map(mapAttachment),
      events: record.events.map(mapEvent),
      posted: Boolean(row.posted_at),
      procedure,
      source,
      permissions,
    };
  }

  async createVoucher(actor: FinanceActor, input: SaveFinanceVoucherRequest): Promise<FinanceVoucher> {
    const voucher = normalizeVoucherInput(input);
    if (!canCreate(actor, voucher.kind)) throw forbidden('Bạn không có quyền lập loại phiếu này.');
    // Hỏi Workspace trước và NGOÀI giao dịch: không giữ kết nối cơ sở dữ liệu trong lúc chờ mạng.
    const links = await resolveWorkspaceLinks(actor.tenantId, voucher, null);
    const id = await this.database.transaction(actor.tenantId, (db) => createVoucher(db, actor.tenantId, actor, voucher, links));
    return this.voucher(actor, id);
  }

  /**
   * Sửa phiếu. Nháp thì lưu lỏng như trước. Bị từ chối hoặc đang chờ duyệt trực tiếp thì coi như gửi duyệt lại ngay
   * (không còn bước "Lưu nháp" riêng): tính lại chế độ duyệt (DIRECT/PROCEDURE) NGOÀI giao dịch giống hệt `submit()`,
   * vì việc đó có thể cần hỏi Procedure Engine qua mạng, rồi tạo liên kết quy trình trong cùng giao dịch nếu cần.
   */
  async updateVoucher(actor: FinanceActor, id: string, input: SaveFinanceVoucherRequest): Promise<FinanceVoucher> {
    const pool = await this.database.pool(actor.tenantId);
    const current = (await pool.query(`SELECT status, approval_mode FROM finance_schema.vouchers WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, id])).rows[0] as
      | { status: string; approval_mode: string }
      | undefined;
    if (current?.approval_mode === 'INHERITED') return this.updateSourced(actor, id, input);
    const voucher = normalizeVoucherInput(input);
    if (!canCreate(actor, voucher.kind)) throw forbidden('Bạn không có quyền lập loại phiếu này.');
    if (!current) throw notFound('phiếu');
    const resubmitting = current.status === 'REJECTED' || (current.status === 'PENDING' && current.approval_mode === 'DIRECT');

    const stored = await loadStoredLinks(pool, actor.tenantId, id);
    const links = await resolveWorkspaceLinks(actor.tenantId, voucher, stored);

    if (!resubmitting) {
      await this.database.transaction(actor.tenantId, (db) => updateVoucher(db, actor.tenantId, actor, id, voucher, input.revision, links, null));
      return this.voucher(actor, id);
    }

    const binding = await bindingFor(pool, actor.tenantId, voucher.kind);
    let definition: Awaited<ReturnType<typeof fetchPublishedProcedureDefinition>> | null = null;
    if (binding.mode === 'PROCEDURE' && binding.procedureDefinitionId) {
      if (!(await this.procedureAvailable(actor.tenantId))) throw procedureUnavailable();
      definition = await fetchPublishedProcedureDefinition(actor.tenantId, binding.procedureDefinitionId);
    }
    const linkId = await this.database.transaction(actor.tenantId, async (db) => {
      const row = await updateVoucher(db, actor.tenantId, actor, id, voucher, input.revision, links, definition ? 'PROCEDURE' : 'DIRECT');
      return definition ? createProcedureLink(db, actor.tenantId, row, definition, actor.userId) : null;
    });
    if (linkId) {
      const link = await startProcedureForLink(pool, actor.tenantId, linkId);
      if (link.instanceId) await reconcileLink(pool, actor.tenantId, linkId).catch(() => undefined);
    }
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

  /**
   * Duyệt nhiều phiếu chờ duyệt trực tiếp một lượt. Từng phiếu chạy đúng luật của duyệt một phiếu (quyền, tự duyệt,
   * khoá sổ, số dư...) trong giao dịch riêng, lần lượt theo thứ tự gửi lên; phiếu không duyệt được trả về kèm lý do.
   */
  async bulkApprove(actor: FinanceActor, input: FinanceBulkApproveRequest): Promise<FinanceBulkApproveResult> {
    this.capabilities(actor);
    const ids = [...new Set(Array.isArray(input?.ids) ? input.ids.filter((id): id is string => typeof id === 'string') : [])];
    if (!ids.length) throw invalid('Chọn ít nhất một phiếu để duyệt.');
    if (ids.length > FINANCE_BULK_APPROVE_MAX) throw invalid(`Mỗi lần duyệt tối đa ${FINANCE_BULK_APPROVE_MAX} phiếu.`);
    if (ids.some((id) => !BULK_UUID.test(id))) throw invalid('Mã phiếu không hợp lệ.');
    const pool = await this.database.pool(actor.tenantId);
    const codes = new Map(
      ((await pool.query(`SELECT id, code FROM finance_schema.vouchers WHERE tenant_id=$1 AND id = ANY($2::uuid[])`, [actor.tenantId, ids])).rows as BulkRow[]).map(
        (row) => [String(row.id), String(row.code)],
      ),
    );
    const result: FinanceBulkApproveResult = { approved: [], failed: [] };
    for (const id of ids) {
      try {
        await this.database.transaction(actor.tenantId, (db) => approveVoucher(db, actor.tenantId, actor, id, input.note));
        const code = (
          (await pool.query(`SELECT code FROM finance_schema.vouchers WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, id])).rows[0] as BulkRow | undefined
        )?.code;
        result.approved.push({ id, code: String(code ?? codes.get(id) ?? '') });
      } catch (error) {
        result.failed.push({
          id,
          code: codes.get(id) ?? null,
          message: error instanceof FinanceError ? error.message : 'Không duyệt được phiếu này.',
        });
      }
    }
    return result;
  }

  /** Cột hiển thị riêng của người dùng cho danh sách phiếu (mỗi người một bộ, theo từng loại phiếu). */
  async listColumns(actor: FinanceActor, listKey: string): Promise<FinanceListColumns> {
    this.capabilities(actor);
    return loadListColumns(await this.database.pool(actor.tenantId), actor.tenantId, actor.userId, listKey);
  }

  async saveListColumns(actor: FinanceActor, listKey: string, columns: unknown): Promise<FinanceListColumns> {
    this.capabilities(actor);
    return saveListColumns(await this.database.pool(actor.tenantId), actor.tenantId, actor.userId, listKey, columns);
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

  /* ------------------------- Phiếu tạo từ hồ sơ quy trình ------------------------- */

  /** Hỏi Procedure người xem có được thao tác ở bước Tài chính không; không hỏi được thì coi như không (fail closed). */
  private async stepDecision(actor: FinanceActor, source: Record<string, unknown>): Promise<{ canAct: boolean | null; reason: string | null }> {
    try {
      const result = await procedureStepCanAct(actor.tenantId, String(source.instance_id), String(source.step_instance_id), {
        userId: actor.userId,
        activation: num(source.activation),
      });
      return { canAct: result.allowed, reason: result.allowed ? null : (result.reason ?? 'Bạn không được giao bước Tài chính của hồ sơ này.') };
    } catch (error) {
      if (error instanceof FinanceError && error.code === FINANCE_STEP_UNVERIFIED_CODE) return { canAct: null, reason: error.message };
      throw error;
    }
  }

  /**
   * Điều kiện chung trước mọi thao tác của kế toán trên phiếu có nguồn, kiểm NGOÀI giao dịch: có quyền duyệt loại phiếu (D8) và
   * Procedure xác nhận đang được giao bước (D8, D9). Trả về lần kích hoạt đã xác nhận; trong giao dịch kiểm lại không đổi.
   */
  private async confirmStep(actor: FinanceActor, id: string): Promise<number> {
    this.capabilities(actor);
    const pool = await this.database.pool(actor.tenantId);
    const row = (await pool.query(`SELECT kind, approval_mode, created_by FROM finance_schema.vouchers WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, id]))
      .rows[0] as { kind: FinanceVoucherKind; approval_mode: string; created_by: string } | undefined;
    if (!row) throw notFound('phiếu');
    if (row.approval_mode !== 'INHERITED') throw conflict('FINANCE_VOUCHER_STATE', 'Phiếu không tạo từ hồ sơ quy trình.');
    if (!canApprove(actor, row.kind)) throw forbidden('Bạn không có quyền ghi sổ loại phiếu này.');
    const source = await loadSourceRow(pool, actor.tenantId, id);
    if (!source) throw conflict('FINANCE_VOUCHER_STATE', 'Phiếu không tạo từ hồ sơ quy trình.');
    // Nguồn ngoài Quy trình không có bước để hỏi: quyền duyệt loại phiếu là đủ (tự duyệt kiểm lúc ghi sổ, trong giao dịch).
    if (!isProcedureSource(source)) return num(source.activation);
    const result = await procedureStepCanAct(actor.tenantId, String(source.instance_id), String(source.step_instance_id), {
      userId: actor.userId,
      activation: num(source.activation),
    });
    if (!result.allowed) throw forbidden(result.reason ?? 'Bạn không được giao bước Tài chính của hồ sơ này.');
    return num(source.activation);
  }

  /** Kế toán lưu phần được nhập của phiếu có nguồn; trường lấy từ hồ sơ giữ nguyên. */
  private async updateSourced(actor: FinanceActor, id: string, input: SaveFinanceVoucherRequest): Promise<FinanceVoucher> {
    const activation = await this.confirmStep(actor, id);
    const pool = await this.database.pool(actor.tenantId);
    const source = await loadSourceRow(pool, actor.tenantId, id);
    const record = await loadVoucherRecord(pool, actor.tenantId, id);
    const current = record.row;
    // Dòng chi tiết và nội dung thuộc hồ sơ: chuẩn hoá phần còn lại với đúng dòng đang lưu để không bị chặn bởi dữ liệu client.
    const voucher = normalizeVoucherInput({
      ...input,
      kind: current.kind as FinanceVoucherKind,
      content: String(current.content),
      lines: record.lines.map((line) => ({
        lineNo: num(line.line_no),
        description: String(line.description),
        quantity: num(line.quantity),
        unitAmount: num(line.unit_amount),
        total: num(line.total),
      })),
      relatedProjectIds: input.relatedProjectIds ?? [],
    });
    const lockedAllocation = ((source?.locked_fields as string[] | null) ?? []).includes('allocation');
    const stored = await loadStoredLinks(pool, actor.tenantId, id);
    if (lockedAllocation && stored?.allocation)
      voucher.allocation = { type: stored.allocation.type, projectId: stored.allocation.projectId, workItemId: stored.allocation.workItemId };
    const links = await resolveWorkspaceLinks(actor.tenantId, voucher, stored);
    await this.database.transaction(actor.tenantId, (db) =>
      updateSourcedVoucher(db, actor.tenantId, actor, id, voucher, links, { activation, revision: input.revision }),
    );
    return this.voucher(actor, id);
  }

  /** Ghi sổ phiếu có nguồn và báo Procedure đóng bước Tài chính. */
  async postSourced(actor: FinanceActor, id: string, input: { note?: string; revision?: number }): Promise<FinanceVoucher> {
    const activation = await this.confirmStep(actor, id);
    await this.database.transaction(actor.tenantId, (db) =>
      postSourcedVoucher(db, actor.tenantId, actor, id, { activation, revision: input.revision }, input.note),
    );
    return this.voucher(actor, id);
  }

  /** Trả hồ sơ về bước đã cấu hình trong quy trình, kèm lý do. */
  async returnSourced(actor: FinanceActor, id: string, input: { reason?: string; revision?: number }): Promise<FinanceVoucher> {
    if (!input.reason?.trim()) throw invalid('Nhập lý do trả hồ sơ.');
    const activation = await this.confirmStep(actor, id);
    await this.database.transaction(actor.tenantId, (db) =>
      returnSourcedVoucher(db, actor.tenantId, actor, id, { activation, revision: input.revision }, input.reason),
    );
    return this.voucher(actor, id);
  }

  /** Nhận xử lý thay người đang giữ khoá mềm. */
  async takeOverSourced(actor: FinanceActor, id: string): Promise<FinanceVoucher> {
    const activation = await this.confirmStep(actor, id);
    await this.database.transaction(actor.tenantId, (db) => takeOverSourcedVoucher(db, actor.tenantId, actor, id, { activation }));
    return this.voucher(actor, id);
  }

  /* -------------------- Phiếu có nguồn từ phân hệ khác (API nội bộ) -------------------- */

  /**
   * Phân hệ khác (Bán hàng) yêu cầu tạo phiếu thu nháp có nguồn. Hỏi Workspace (nếu có dự án) NGOÀI giao dịch, rồi tạo hoặc trả lại
   * phiếu cũ theo khoá chống lặp trong một giao dịch.
   */
  async createExternalVoucherSource(tenantId: string, body: unknown): Promise<FinanceVoucherSourceState> {
    const request = parseExternalSourceRequest(body);
    const plan = await planExternalVoucher(request, (allocation) => resolveWorkspaceLinks(tenantId, { allocation, relatedProjectIds: [] }, null));
    return this.database.transaction(tenantId, async (db) => {
      const { voucherId } = await applyExternalSourceRequest(db, tenantId, request, plan);
      return externalSourceStateOfVoucher(db, tenantId, voucherId);
    });
  }

  /** Trạng thái phiếu của một bản ghi nguồn (đối soát khi bên nguồn mất sự kiện). */
  async externalVoucherSourceState(tenantId: string, sourceModule: string | undefined, sourceRef: string): Promise<FinanceVoucherSourceState> {
    return externalSourceState(await this.database.pool(tenantId), tenantId, sourceModule ?? '', sourceRef);
  }

  /** Procedure hỏi lúc công bố quy trình có bước Tài chính (dịch vụ nội bộ, không có người dùng). */
  integrationCapabilities(): FinanceIntegrationCapabilities {
    return { voucherKinds: [...FINANCE_STEP_VOUCHER_KINDS] };
  }

  /* ------------------------------- Đính kèm ------------------------------- */

  /** Bước 1: tạo bản ghi và URL ký sẵn để trình duyệt tải thẳng lên kho; tệp chưa hiện trên phiếu cho tới khi xác nhận. */
  async createAttachment(actor: FinanceActor, voucherId: string, input: { fileName?: unknown; contentType?: unknown; sizeBytes?: unknown; purpose?: unknown }) {
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
    requirePermission(actor, 'finance.settings.manage', 'Bạn không có quyền cấu hình quy trình duyệt.');
    return listBindings(await this.database.pool(actor.tenantId), actor.tenantId);
  }

  async saveApprovalBinding(actor: FinanceActor, kind: FinanceVoucherKind, input: SaveFinanceApprovalBindingRequest): Promise<SaveFinanceApprovalBindingResponse> {
    requirePermission(actor, 'finance.settings.manage', 'Bạn không có quyền cấu hình quy trình duyệt.');
    const pool = await this.database.pool(actor.tenantId);
    return saveBinding(pool, actor.tenantId, actor.userId, kind, input);
  }

  /** Các quy trình đã công bố để chọn, theo quyền Procedure của chính người cấu hình. */
  async procedureDefinitions(actor: FinanceActor, session: ForwardedSession) {
    requirePermission(actor, 'finance.settings.manage', 'Bạn không có quyền cấu hình quy trình duyệt.');
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

  /** Hồ sơ đã huỷ hiệu lực mà phiếu chưa đảo được: người có quyền ghi sổ thử đảo lại ngay (lỗi thì báo lại cho người dùng). */
  async retrySourceReversal(actor: FinanceActor, id: string): Promise<FinanceVoucher> {
    this.capabilities(actor);
    const voucher = await this.voucher(actor, id);
    if (!voucher.permissions.sourced.canRetryReversal) throw forbidden('Bạn không thể đảo lại phiếu này.');
    const outcome = await this.database.transaction(actor.tenantId, (db) =>
      retrySourceReversal(db, actor.tenantId, id, { userId: actor.userId, displayName: actor.displayName }),
    );
    const updated = await this.voucher(actor, id);
    if (outcome === 'conflict') throw conflict('FINANCE_SOURCE_REVERSAL', updated.source?.reversalError ?? 'Chưa đảo được phiếu.');
    return updated;
  }

  /** Procedure hỏi trước khi huỷ hiệu lực một hồ sơ có thể có bước Tài chính (chỉ đọc, dịch vụ nội bộ). */
  async instanceReversalCheck(tenantId: string, instanceId: string): Promise<FinanceInstanceReversalCheck> {
    return sourceReversalCheck(await this.database.pool(tenantId), tenantId, instanceId);
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

  async ledgerReport(actor: FinanceActor, query: FinanceLedgerReportQuery): Promise<FinanceLedgerReport> {
    if (!can(actor, 'finance.report.read') && !canReadAll(actor)) throw forbidden('Bạn không có quyền xem báo cáo.');
    return financeLedgerReport(await this.database.pool(actor.tenantId), actor.tenantId, query);
  }

  /** Dùng cho kiểm thử: danh sách loại phiếu người dùng được phép lập. */
  creatableKinds(actor: FinanceActor): FinanceVoucherKind[] {
    return creatableKinds(actor);
  }
}

export { dateOnly };
