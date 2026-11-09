import type { CrmTask, CrmTaskApprovalTarget, CrmTaskList } from '@enterprise-platform/contracts-crm';
import { isUuid } from '../domain/fields.js';
import { canViewQuoteCost } from './crm-access.js';
import type { CrmActor } from './crm-actor.js';
import type { CrmTaskStore, OwnerTaskRecord, PendingApprovalRecord } from './crm-task-store.port.js';
import type { CrmDataScopeService } from './data-scope.js';
import type { ProcedureActionableReader } from './quote-store.port.js';
import type { PeopleDirectory } from './sales-store.port.js';

/** Mỗi nhóm việc tối đa chừng này dòng (plan mục 17.4). */
export const CRM_TASK_LIST_MAX = 200;
/** Số việc chờ duyệt đọc ra để lọc theo người xem (trước khi cắt còn `CRM_TASK_LIST_MAX`). */
const PENDING_CANDIDATES = 500;
/** Quy trình nhận tối đa 100 mã hồ sơ mỗi lần hỏi. */
const ACTIONABLE_BATCH = 100;

/** Phần QuoteService dùng: báo giá đang chờ chính người xem duyệt (bộ lọc, cờ trên màn báo giá). */
export interface AwaitingApprovalReader {
  /** Id các báo giá có việc chờ người xem duyệt (báo giá hoặc PAKD trình riêng). */
  awaitingQuoteIds(actor: CrmActor): Promise<string[]>;
  /** Đích duyệt nếu báo giá (phiên bản hiện tại hoặc PAKD trình riêng của nó) đang chờ người xem duyệt. */
  awaitingTarget(actor: CrmActor, quoteId: string): Promise<CrmTaskApprovalTarget | null>;
}

interface AwaitingItem {
  readonly record: PendingApprovalRecord;
  readonly approval: CrmTaskApprovalTarget;
}

/** Liên kết còn hiệu lực: kết quả sẽ đến từ Quy trình. Liên kết lỗi chưa tạo được phiên, hoặc đã đóng, thì duyệt tay. */
function viaProcedure(record: PendingApprovalRecord): boolean {
  const link = record.link;
  return !!link && link.status !== 'CLOSED' && !(link.status === 'FAILED' && !link.instanceId);
}

const byNewest = (left: CrmTask, right: CrmTask) => (right.at ?? '').localeCompare(left.at ?? '');

/**
 * Việc cần xử lý trong CRM (plan mục 17.4, D3-32).
 *
 * - **Chờ tôi duyệt**: báo giá Chờ duyệt và PAKD trình riêng đang chờ, trong phạm vi dữ liệu; không bao giờ có việc do
 *   chính người xem trình. Qua Quy trình: hồ sơ đang chạy mà Quy trình nói người xem thao tác được (hỏi theo lô 100
 *   mã); Quy trình lỗi thì ghi log và chỉ trả việc duyệt trực tiếp. Trực tiếp: người xem có `crm.quote.approve` (hoặc
 *   quản trị tenant).
 * - **Việc của tôi**: báo giá người xem phụ trách bị từ chối duyệt, đã duyệt chờ gửi khách; PAKD trình riêng bị từ
 *   chối khi phiên bản hiện tại còn Nháp.
 * - Biên lợi nhuận chỉ có khi người xem được xem giá vốn. Mới nhất trước, mỗi nhóm tối đa 200 dòng.
 */
export class CrmTaskService implements AwaitingApprovalReader {
  constructor(
    private readonly store: CrmTaskStore,
    private readonly scopes: Pick<CrmDataScopeService, 'resolve'>,
    private readonly procedures: ProcedureActionableReader,
    private readonly people?: PeopleDirectory,
    private readonly warn: (message: string) => void = () => undefined,
  ) {}

  async myTasks(actor: CrmActor): Promise<CrmTaskList> {
    const [awaiting, owned, names] = await Promise.all([
      this.awaiting(actor),
      this.store.ownerTasks(actor.tenantId, actor.userId, CRM_TASK_LIST_MAX),
      this.names(actor.tenantId),
    ]);
    const costVisible = canViewQuoteCost(actor);
    const name = (userId: string | null) => (userId ? (names.get(userId) ?? null) : null);
    const awaitingMe = awaiting
      .map(({ record, approval }): CrmTask => ({
        kind: record.subject === 'QUOTE' ? 'QUOTE_APPROVAL' : 'BUSINESS_PLAN_APPROVAL',
        ...common(record, costVisible, name),
        actorUserId: record.submittedBy,
        actorName: name(record.submittedBy),
        at: record.submittedAt,
        reasons: record.reasons,
        approval,
      }))
      .sort(byNewest)
      .slice(0, CRM_TASK_LIST_MAX);
    const mine = owned
      .map((record: OwnerTaskRecord): CrmTask => ({
        kind: record.kind,
        ...common(record, costVisible, name),
        actorUserId: record.actorUserId,
        actorName: name(record.actorUserId),
        at: record.at,
        reasons: record.reasons,
        approval: null,
      }))
      .sort(byNewest)
      .slice(0, CRM_TASK_LIST_MAX);
    return { awaitingMe, mine };
  }

  async awaitingQuoteIds(actor: CrmActor): Promise<string[]> {
    return [...new Set((await this.awaiting(actor)).map((item) => item.record.quoteId))];
  }

  async awaitingTarget(actor: CrmActor, quoteId: string): Promise<CrmTaskApprovalTarget | null> {
    if (!isUuid(quoteId)) return null;
    return (await this.awaiting(actor, [quoteId]))[0]?.approval ?? null;
  }

  /** Việc chờ người xem duyệt (chưa sắp xếp, chưa cắt). */
  private async awaiting(actor: CrmActor, quoteIds?: readonly string[]): Promise<AwaitingItem[]> {
    const scope = await this.scopes.resolve(actor);
    const records = (
      await this.store.pendingApprovals(actor.tenantId, scope, { limit: PENDING_CANDIDATES, ...(quoteIds ? { quoteIds } : {}) })
    ).filter((record) => record.submittedBy !== actor.userId);
    const canApprove = actor.canApproveQuote || actor.isTenantAdmin;
    const instanceIds = records.flatMap((record) => (viaProcedure(record) && record.link?.instanceId ? [record.link.instanceId] : []));
    const actionable = await this.actionable(actor, instanceIds);
    const items: AwaitingItem[] = [];
    for (const record of records) {
      if (!viaProcedure(record)) {
        if (canApprove) {
          items.push({ record, approval: { subject: record.subject, mode: 'DIRECT', procedureInstanceId: null, procedureInstanceCode: null } });
        }
      } else if (record.link?.instanceId && actionable.has(record.link.instanceId)) {
        items.push({
          record,
          approval: {
            subject: record.subject,
            mode: 'PROCEDURE',
            procedureInstanceId: record.link.instanceId,
            procedureInstanceCode: record.link.instanceCode,
          },
        });
      }
    }
    return items;
  }

  /** Hồ sơ người xem thao tác được, hỏi Quy trình theo lô; Quy trình lỗi thì coi như không có (không làm hỏng cả trang). */
  private async actionable(actor: CrmActor, instanceIds: readonly string[]): Promise<Set<string>> {
    const ids = [...new Set(instanceIds)];
    if (!ids.length) return new Set();
    const batches: string[][] = [];
    for (let index = 0; index < ids.length; index += ACTIONABLE_BATCH) batches.push(ids.slice(index, index + ACTIONABLE_BATCH));
    try {
      const results = await Promise.all(
        batches.map((batch) => this.procedures.actionableInstanceIds(actor.tenantId, actor.userId, batch)),
      );
      return new Set(results.flat());
    } catch (error) {
      this.warn(
        `Không hỏi được Quy trình hồ sơ người dùng ${actor.userId} xử lý được (tenant ${actor.tenantId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return new Set();
    }
  }

  /** Tên người theo danh bạ; danh bạ lỗi thì để trống tên, vẫn trả việc. */
  private async names(tenantId: string): Promise<Map<string, string>> {
    if (!this.people) return new Map();
    try {
      return new Map((await this.people.people(tenantId)).map((person) => [person.userId, person.displayName]));
    } catch {
      return new Map();
    }
  }
}

function common(
  record: PendingApprovalRecord | OwnerTaskRecord,
  costVisible: boolean,
  name: (userId: string | null) => string | null,
) {
  return {
    quoteId: record.quoteId,
    quoteCode: record.quoteCode,
    quoteName: record.quoteName,
    versionNo: record.versionNo,
    customerId: record.customerId,
    customerName: record.customerName,
    ownerUserId: record.ownerUserId,
    ownerName: name(record.ownerUserId),
    totalAmount: record.totalAmount,
    marginPercent: costVisible ? record.marginPercent : null,
  };
}
