import { CRM_NO_CAPABILITIES } from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './crm-actor.js';
import type { CrmTaskStore, OwnerTaskRecord, PendingApprovalRecord } from './crm-task-store.port.js';
import { CRM_TASK_LIST_MAX, CrmTaskService } from './crm-task.service.js';
import type { CrmDataScope } from './data-scope.js';

const TENANT = 'tenant-1';
const ME = 'user-me';
const OTHER = 'user-other';

const actor = (extra: Partial<CrmActor> = {}): CrmActor => ({
  ...CRM_NO_CAPABILITIES,
  tenantId: TENANT,
  userId: ME,
  displayName: 'Tôi',
  ...extra,
});

let sequence = 0;
function pending(extra: Partial<PendingApprovalRecord> = {}): PendingApprovalRecord {
  sequence += 1;
  return {
    subject: 'QUOTE',
    quoteId: `quote-${sequence}`,
    quoteCode: `BG${sequence}`,
    quoteName: null,
    versionNo: 1,
    customerId: 'customer-1',
    customerName: 'Khách A',
    ownerUserId: OTHER,
    submittedBy: OTHER,
    submittedAt: new Date(Date.UTC(2026, 10, 1, 0, sequence)).toISOString(),
    totalAmount: 1000,
    marginPercent: 12.5,
    reasons: ['Chiết khấu vượt hạn mức.'],
    link: null,
    ...extra,
  };
}

function owned(extra: Partial<OwnerTaskRecord> = {}): OwnerTaskRecord {
  sequence += 1;
  return {
    kind: 'QUOTE_REJECTED',
    quoteId: `quote-${sequence}`,
    quoteCode: `BG${sequence}`,
    quoteName: null,
    versionNo: 1,
    customerId: 'customer-1',
    customerName: 'Khách A',
    ownerUserId: ME,
    actorUserId: OTHER,
    at: new Date(Date.UTC(2026, 10, 1, 0, sequence)).toISOString(),
    totalAmount: 1000,
    marginPercent: 10,
    reasons: ['Giá thấp'],
    ...extra,
  };
}

class FakeStore implements CrmTaskStore {
  constructor(
    public pendingRows: PendingApprovalRecord[] = [],
    public ownerRows: OwnerTaskRecord[] = [],
  ) {}
  lastPending: { scope: CrmDataScope; quoteIds?: readonly string[] } | null = null;
  async pendingApprovals(_tenantId: string, scope: CrmDataScope, options: { limit: number; quoteIds?: readonly string[] }) {
    this.lastPending = { scope, quoteIds: options.quoteIds };
    return this.pendingRows.filter((row) => !options.quoteIds || options.quoteIds.includes(row.quoteId));
  }
  async ownerTasks(_tenantId: string, ownerUserId: string) {
    return this.ownerRows.filter((row) => row.ownerUserId === ownerUserId);
  }
}

class FakeProcedures {
  calls: string[][] = [];
  fail = false;
  constructor(private readonly mine: Set<string> = new Set()) {}
  async actionableInstanceIds(_tenantId: string, _actorUserId: string, ids: readonly string[]) {
    this.calls.push([...ids]);
    if (this.fail) throw new Error('Quy trình đang không khả dụng.');
    return ids.filter((id) => this.mine.has(id));
  }
}

const scopes = { resolve: async (): Promise<CrmDataScope> => ({ kind: 'all' }) };
const running = (instanceId: string) => ({ status: 'RUNNING', instanceId, instanceCode: `HS-${instanceId}` });

describe('CrmTaskService (plan mục 17.4)', () => {
  it('trực tiếp: người có quyền duyệt thấy, không thấy việc mình trình; không có quyền thì không thấy', async () => {
    const theirs = pending();
    const own = pending({ submittedBy: ME });
    const store = new FakeStore([theirs, own]);
    const service = new CrmTaskService(store, scopes, new FakeProcedures());
    const approver = await service.myTasks(actor({ canApproveQuote: true }));
    expect(approver.awaitingMe.map((task) => task.quoteId)).toEqual([theirs.quoteId]);
    expect(approver.awaitingMe[0]).toMatchObject({
      kind: 'QUOTE_APPROVAL',
      actorUserId: OTHER,
      reasons: ['Chiết khấu vượt hạn mức.'],
      approval: { subject: 'QUOTE', mode: 'DIRECT', procedureInstanceId: null, procedureInstanceCode: null },
    });
    expect((await service.myTasks(actor({ isTenantAdmin: true }))).awaitingMe).toHaveLength(1);
    expect((await service.myTasks(actor())).awaitingMe).toEqual([]);
  });

  it('qua Quy trình: chỉ hồ sơ Quy trình giao cho người xem; liên kết lỗi chưa có phiên thì về duyệt trực tiếp', async () => {
    const assigned = pending({ link: running('i-1') });
    const notAssigned = pending({ link: running('i-2') });
    const starting = pending({ link: { status: 'START_PENDING', instanceId: null, instanceCode: null } });
    const failed = pending({ subject: 'BUSINESS_PLAN', link: { status: 'FAILED', instanceId: null, instanceCode: null } });
    const procedures = new FakeProcedures(new Set(['i-1']));
    const service = new CrmTaskService(new FakeStore([assigned, notAssigned, starting, failed]), scopes, procedures);
    const list = await service.myTasks(actor());
    // Không có quyền duyệt trực tiếp: chỉ việc Quy trình giao.
    expect(list.awaitingMe.map((task) => task.quoteId)).toEqual([assigned.quoteId]);
    expect(list.awaitingMe[0].approval).toEqual({ subject: 'QUOTE', mode: 'PROCEDURE', procedureInstanceId: 'i-1', procedureInstanceCode: 'HS-i-1' });
    expect(procedures.calls).toEqual([['i-1', 'i-2']]);
    const approver = await service.myTasks(actor({ canApproveQuote: true }));
    expect(approver.awaitingMe.map((task) => [task.quoteId, task.kind, task.approval?.mode])).toEqual([
      [failed.quoteId, 'BUSINESS_PLAN_APPROVAL', 'DIRECT'],
      [assigned.quoteId, 'QUOTE_APPROVAL', 'PROCEDURE'],
    ]);
  });

  it('hỏi Quy trình theo lô tối đa 100 hồ sơ', async () => {
    const rows = Array.from({ length: 250 }, (_, index) => pending({ link: running(`i-${index}`) }));
    const procedures = new FakeProcedures(new Set(['i-0', 'i-249']));
    const service = new CrmTaskService(new FakeStore(rows), scopes, procedures);
    const list = await service.myTasks(actor());
    expect(procedures.calls.map((ids) => ids.length)).toEqual([100, 100, 50]);
    expect(list.awaitingMe).toHaveLength(2);
  });

  it('Quy trình lỗi: ghi log, vẫn trả việc duyệt trực tiếp và việc của tôi', async () => {
    const direct = pending();
    const viaProcedure = pending({ link: running('i-9') });
    const procedures = new FakeProcedures(new Set(['i-9']));
    procedures.fail = true;
    const warnings: string[] = [];
    const service = new CrmTaskService(new FakeStore([direct, viaProcedure], [owned()]), scopes, procedures, undefined, (message) =>
      warnings.push(message),
    );
    const list = await service.myTasks(actor({ canApproveQuote: true }));
    expect(list.awaitingMe.map((task) => task.quoteId)).toEqual([direct.quoteId]);
    expect(list.mine).toHaveLength(1);
    expect(warnings).toEqual([expect.stringContaining('Quy trình đang không khả dụng.')]);
  });

  it('biên chỉ hiện khi được xem giá vốn; tên lấy từ danh bạ, danh bạ lỗi thì để trống', async () => {
    const store = new FakeStore([pending()], [owned()]);
    const people = { people: async () => [{ userId: OTHER, displayName: 'Người khác' }, { userId: ME, displayName: 'Tôi' }] };
    const service = new CrmTaskService(store, scopes, new FakeProcedures(), people);
    const approver = await service.myTasks(actor({ canApproveQuote: true }));
    expect(approver.awaitingMe[0]).toMatchObject({ marginPercent: 12.5, ownerName: 'Người khác', actorName: 'Người khác' });
    expect(approver.mine[0]).toMatchObject({ kind: 'QUOTE_REJECTED', ownerName: 'Tôi', actorName: 'Người khác', approval: null });
    const viewer = await service.myTasks(actor({ isTenantAdmin: false, canApproveQuote: false }));
    expect(viewer.mine[0].marginPercent).toBeNull();
    const broken = new CrmTaskService(store, scopes, new FakeProcedures(), { people: async () => Promise.reject(new Error('down')) });
    expect((await broken.myTasks(actor({ canApproveQuote: true }))).awaitingMe[0].ownerName).toBeNull();
  });

  it('mới nhất trước, mỗi nhóm tối đa 200 dòng', async () => {
    const rows = Array.from({ length: 230 }, () => pending());
    const mine = Array.from({ length: 230 }, () => owned());
    const service = new CrmTaskService(new FakeStore(rows, mine), scopes, new FakeProcedures());
    const list = await service.myTasks(actor({ canApproveQuote: true }));
    expect(list.awaitingMe).toHaveLength(CRM_TASK_LIST_MAX);
    expect(list.mine).toHaveLength(CRM_TASK_LIST_MAX);
    const ats = list.awaitingMe.map((task) => task.at ?? '');
    expect([...ats].sort().reverse()).toEqual(ats);
    expect(list.awaitingMe[0].quoteId).toBe(rows[rows.length - 1].quoteId);
  });

  it('cờ trên màn báo giá và bộ lọc dùng cùng cách tính', async () => {
    const target = pending({ link: running('i-7') });
    const store = new FakeStore([target, pending()]);
    const service = new CrmTaskService(store, scopes, new FakeProcedures(new Set(['i-7'])));
    expect(await service.awaitingTarget(actor(), 'not-a-uuid')).toBeNull();
    expect(await service.awaitingQuoteIds(actor())).toEqual([target.quoteId]);
    expect(await service.awaitingQuoteIds(actor({ canApproveQuote: true }))).toHaveLength(2);
  });
});
