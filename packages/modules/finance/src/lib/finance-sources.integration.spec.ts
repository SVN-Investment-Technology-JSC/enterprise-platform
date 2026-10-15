import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import type { FinanceStepVoucherRequestedPayload, SaveFinanceVoucherRequest } from '@enterprise-platform/contracts-finance';
import type { Pool } from 'pg';
import { FinanceApplication } from './application/finance.application.js';
import type { FinanceActor } from './domain/finance.access.js';
import { FakeFinanceStorage, TestFinanceDatabase, dropTestDatabase } from './finance-test-support.js';
import { todayVn } from './infrastructure/finance.database.js';
import { isFinanceProcedureEvent, receiveFinanceProcedureEvent } from './infrastructure/procedure-events.js';

const integration = process.env.FINANCE_TEST_ADMIN_URL ? describe : describe.skip;

const PE = 'http://pe.test/api/procedure';
const WS = 'http://ws.test/api/workspace';

integration('Tài chính: phiếu tạo từ bước Tài chính của quy trình (PostgreSQL, Procedure/Workspace giả lập)', () => {
  const databaseName = 'finance_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const today = todayVn();
  let admin: ReturnType<typeof createPostgresPool>;
  let pool: Pool;
  let app: FinanceApplication;
  const originalFetch = global.fetch;

  const actor = (name: string, permissions: string[]): FinanceActor => ({ tenantId, userId: randomUUID(), displayName: name, permissions });
  const requester = actor('Người đề nghị', ['finance.payment.create']);
  const cashierA = actor('Kế toán A', ['finance.payment.approve']);
  const cashierB = actor('Kế toán B', ['finance.payment.approve']);
  const outsider = actor('Kế toán ngoài bước', ['finance.payment.approve']);
  const viewer = actor('Người xem', ['finance.read']);
  const manager = actor('Quản trị tài chính', ['finance.manage']);

  // ---- Procedure / Workspace giả lập ----
  const pe = { available: true, allowed: new Set<string>(), calls: 0 };
  const ws = { available: true };
  const PROJECT = { id: randomUUID(), code: 'DA001', name: 'Dự án A', status: 'active' };
  const WORK_ITEM = { id: randomUUID(), code: 'CV-7', title: 'Mua vật tư', status: 'in_progress', project: { id: PROJECT.id } };

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fakeFetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(PE)) {
      if (!pe.available) throw new Error('connect ECONNREFUSED');
      const canAct = /^\/v1\/internal\/instances\/([^/]+)\/steps\/([^/]+)\/can-act$/.exec(url.slice(PE.length));
      if (canAct && init?.method === 'POST') {
        pe.calls += 1;
        const body = JSON.parse(String(init.body)) as { userId: string };
        return json(pe.allowed.has(body.userId) ? { allowed: true } : { allowed: false, reason: 'Bạn không giữ vai R của bước này.' });
      }
      return json({}, 404);
    }
    if (url.startsWith(WS)) {
      if (!ws.available) throw new Error('connect ECONNREFUSED');
      const path = url.slice(WS.length);
      if (path === `/v1/internal/projects/${PROJECT.id}`) return json(PROJECT);
      if (path === `/v1/internal/work-items/${WORK_ITEM.id}`) return json(WORK_ITEM);
      return json({}, 404);
    }
    return originalFetch(input as string, init);
  });

  const requested = (over: Partial<FinanceStepVoucherRequestedPayload> = {}, values: Partial<FinanceStepVoucherRequestedPayload['values']> = {}) => {
    const payload: FinanceStepVoucherRequestedPayload = {
      instanceId: randomUUID(),
      instanceCode: `PR-${Math.floor(Math.random() * 10_000)}`,
      instanceTitle: 'Đề nghị thanh toán',
      definitionId: randomUUID(),
      definitionName: 'Đề nghị thanh toán',
      stepInstanceId: randomUUID(),
      stepName: 'Chi tiền',
      activation: 1,
      voucherKind: 'PAYMENT',
      values: {
        amount: 2_500_000,
        content: 'Thanh toán tiền in ấn',
        counterpartyName: 'Công ty In Nhanh',
        counterpartyAccountNo: '0123456789',
        counterpartyBank: 'VCB',
        voucherDate: null,
        ...values,
      },
      initiatedBy: requester.userId,
      initiatedByName: requester.displayName,
      assigneeIds: [cashierA.userId],
      assigneeSubjects: [],
      assigneeLabel: 'Kế toán thanh toán',
      requestedAt: new Date().toISOString(),
      ...over,
    };
    return payload;
  };
  const event = (payload: FinanceStepVoucherRequestedPayload, over: Partial<IntegrationEventEnvelope> = {}): IntegrationEventEnvelope => ({
    id: randomUUID(),
    type: 'procedure.step.finance_voucher_requested',
    version: 1,
    occurredAt: new Date().toISOString(),
    tenantId,
    source: 'procedure-engine',
    correlationId: payload.instanceId,
    payload,
    ...over,
  });
  const voucherIdOf = async (instanceId: string) =>
    String((await pool.query(`SELECT voucher_id FROM finance_schema.voucher_sources WHERE instance_id=$1`, [instanceId])).rows[0]?.voucher_id);
  const outbox = async (voucherId: string) =>
    (
      await pool.query(`SELECT event_type, payload FROM integration_schema.outbox_events WHERE aggregate_id=$1 AND event_type LIKE 'finance.voucher.%' ORDER BY occurred_at, id`, [
        voucherId,
      ])
    ).rows.filter((row) => ['finance.voucher.linked', 'finance.voucher.posted', 'finance.voucher.returned'].includes(row.event_type)) as {
      event_type: string;
      payload: { payload: Record<string, unknown> };
    }[];
  const rejects = async (promise: Promise<unknown>, code: string) => {
    const error = await promise.then(() => null, (e: { code?: string }) => e);
    expect(error?.code).toBe(code);
  };

  let accountId: string;
  let reasonId: string;
  let groupId: string;
  const accountantInput = (over: Partial<SaveFinanceVoucherRequest> = {}): SaveFinanceVoucherRequest => ({
    kind: 'PAYMENT',
    voucherDate: today,
    postingDate: today,
    content: 'Client cố sửa nội dung',
    reasonId,
    accountId,
    counterpartyGroupId: groupId,
    counterpartyName: 'Client cố sửa người nhận',
    lines: [{ description: 'Client cố sửa dòng', quantity: 1, unitAmount: 1, total: 1 }],
    ...over,
  });

  beforeAll(async () => {
    process.env['PROCEDURE_API_URL'] = PE;
    process.env['WORKSPACE_API_URL'] = WS;
    process.env['INTERNAL_SERVICE_TOKEN'] = 'test-token';
    global.fetch = fakeFetch as unknown as typeof fetch;
    const url = new URL(process.env['FINANCE_TEST_ADMIN_URL'] as string);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString()) as unknown as Pool;
    await pool.query(await readFile(resolve(process.cwd(), '../../../migrations/tenant/0001-integration.sql'), 'utf8'));
    const directory = resolve(process.cwd(), '../../../migrations/tenant/finance');
    for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) await pool.query(await readFile(resolve(directory, file), 'utf8'));
    app = new FinanceApplication(new TestFinanceDatabase(pool), new FakeFinanceStorage());

    accountId = (
      await app.saveAccount(manager, null, { code: 'VCB', name: 'Vietcombank', accountType: 'BANK', bankName: 'VCB', accountNumber: '0011', openingBalance: 100_000_000, openingDate: '2026-01-01' })
    ).id;
    reasonId = (await app.saveReason(manager, null, { kind: 'PAYMENT', code: 'TT', name: 'Thanh toán nhà cung cấp' })).id;
    groupId = (await app.catalogs(manager, false)).counterpartyGroups[0].id;
  }, 120_000);

  afterAll(async () => {
    global.fetch = originalFetch;
    if (admin) {
      await dropTestDatabase(admin, pool, databaseName);
      await admin.end();
    } else await pool?.end();
  }, 60_000);

  beforeEach(() => {
    pe.available = true;
    pe.allowed = new Set([cashierA.userId, cashierB.userId]);
    ws.available = true;
  });

  it('capabilities nội bộ cho Procedure lúc công bố', () => {
    expect(app.integrationCapabilities()).toEqual({ voucherKinds: ['PAYMENT', 'RECEIPT'] });
  });

  it('nhận yêu cầu: tạo đúng một phiếu nháp INHERITED, khoá trường lấy từ hồ sơ, báo linked; giao lặp không sinh phiếu thứ hai', async () => {
    const payload = requested({ projectId: PROJECT.id });
    const first = event(payload);
    expect(isFinanceProcedureEvent(first)).toBe(true);
    expect(await receiveFinanceProcedureEvent(pool, tenantId, first)).toBe('created');
    expect(await receiveFinanceProcedureEvent(pool, tenantId, first)).toBe('ignored'); // cùng mã sự kiện
    expect(await receiveFinanceProcedureEvent(pool, tenantId, event(payload))).toBe('relinked'); // cùng lần kích hoạt
    expect(Number((await pool.query(`SELECT count(*) FROM finance_schema.voucher_sources WHERE instance_id=$1`, [payload.instanceId])).rows[0].count)).toBe(1);

    const id = await voucherIdOf(payload.instanceId);
    const voucher = await app.voucher(cashierA, id);
    expect(voucher).toMatchObject({
      status: 'DRAFT',
      approvalMode: 'INHERITED',
      code: expect.stringMatching(/^NHAP_PC_\d{4}_\d{4}$/),
      totalAmount: 2_500_000,
      content: 'Thanh toán tiền in ấn',
      counterpartyName: 'Công ty In Nhanh',
      createdBy: requester.userId,
      sourceCode: payload.instanceCode,
      allocation: { type: 'PROJECT', projectId: PROJECT.id, projectCode: 'DA001' },
    });
    expect(voucher.lines).toHaveLength(1);
    expect(voucher.source).toMatchObject({
      instanceCode: payload.instanceCode,
      status: 'OPEN',
      activation: 1,
      assigneeLabel: 'Kế toán thanh toán',
      canAct: true,
      lockedFields: expect.arrayContaining(['amount', 'content', 'counterpartyName', 'allocation']),
    });
    expect(voucher.permissions).toMatchObject({ canEdit: false, canSubmit: false, canApprove: false, canDelete: false, canReverse: false });
    expect(voucher.permissions.sourced).toEqual({ canEditSourced: true, canPost: true, canReturnSource: true, canTakeOver: false, canRetryReversal: false });

    const sent = await outbox(id);
    expect(sent.map((row) => row.event_type)).toEqual(['finance.voucher.linked', 'finance.voucher.linked']);
    expect(sent[0].payload.payload).toMatchObject({ instanceId: payload.instanceId, stepInstanceId: payload.stepInstanceId, activation: 1, voucherId: id, status: 'DRAFT', amount: 2_500_000 });
  });

  it('hạch toán theo công việc của hồ sơ; Workspace không trả lời thì vẫn tạo phiếu, để trống hạch toán cho kế toán chọn', async () => {
    const byWorkItem = requested({ workItemId: WORK_ITEM.id });
    await receiveFinanceProcedureEvent(pool, tenantId, event(byWorkItem));
    expect((await app.voucher(cashierA, await voucherIdOf(byWorkItem.instanceId))).allocation).toMatchObject({
      type: 'WORK_ITEM',
      projectId: PROJECT.id,
      workItemId: WORK_ITEM.id,
      workItemCode: 'CV-7',
    });

    ws.available = false;
    const offline = requested({ projectId: PROJECT.id });
    await receiveFinanceProcedureEvent(pool, tenantId, event(offline));
    const voucher = await app.voucher(cashierA, await voucherIdOf(offline.instanceId));
    expect(voucher.allocation).toBeNull();
    expect(voucher.source?.lockedFields).not.toContain('allocation');
    expect(voucher.source?.requestedProjectId).toBe(PROJECT.id);
    expect(voucher.events.some((e) => e.note?.includes('Chưa xác nhận được dự án'))).toBe(true);

    const none = requested();
    await receiveFinanceProcedureEvent(pool, tenantId, event(none));
    expect((await app.voucher(cashierA, await voucherIdOf(none.instanceId))).allocation).toBeNull();
  });

  it('người đề nghị và thao tác thường không đụng được phiếu có nguồn; đảo trực tiếp bị chặn', async () => {
    const payload = requested();
    await receiveFinanceProcedureEvent(pool, tenantId, event(payload));
    const id = await voucherIdOf(payload.instanceId);
    const own = await app.voucher(requester, id);
    expect(own.source?.canAct).toBeNull(); // không có quyền ghi sổ: không hỏi Procedure
    expect(own.permissions.sourced.canPost).toBe(false);
    await rejects(app.submit(requester, id), 'FINANCE_SOURCE_MANAGED');
    await rejects(app.deleteVoucher(requester, id), 'FINANCE_SOURCE_MANAGED');
    await rejects(app.cancel(requester, {}, id, 'x'), 'FINANCE_SOURCE_MANAGED');
    await rejects(app.updateVoucher(requester, id, accountantInput()), 'FINANCE_FORBIDDEN');
    await rejects(app.approve(cashierA, id), 'FINANCE_VOUCHER_STATE');
  });

  it('ghi sổ: trường lấy từ hồ sơ giữ nguyên, khoá mềm, nhận xử lý thay, cấp mã chính thức, báo posted; ghi sổ lần hai bị chặn', async () => {
    const payload = requested({ projectId: PROJECT.id });
    await receiveFinanceProcedureEvent(pool, tenantId, event(payload));
    const id = await voucherIdOf(payload.instanceId);

    // Chưa đủ điều kiện (thiếu tài khoản, lý do, đối tượng).
    await rejects(app.postSourced(cashierA, id, {}), 'FINANCE_POST_INVALID');

    const saved = await app.updateVoucher(cashierA, id, accountantInput({ revision: (await app.voucher(cashierA, id)).revision }));
    expect(saved).toMatchObject({
      content: 'Thanh toán tiền in ấn',
      counterpartyName: 'Công ty In Nhanh',
      totalAmount: 2_500_000,
      accountId,
      reasonId,
      allocation: { type: 'PROJECT', projectId: PROJECT.id },
    });
    expect(saved.lines.map((line) => line.total)).toEqual([2_500_000]);
    expect(saved.source).toMatchObject({ handlingBy: cashierA.userId, handlingByName: 'Kế toán A' });

    // Người khác thấy "đang xử lý": chỉ được nhận xử lý thay.
    const seenByB = await app.voucher(cashierB, id);
    expect(seenByB.permissions.sourced).toEqual({ canEditSourced: false, canPost: false, canReturnSource: false, canTakeOver: true, canRetryReversal: false });
    await rejects(app.postSourced(cashierB, id, {}), 'FINANCE_SOURCE_HANDLED');
    await app.takeOverSourced(cashierB, id);
    expect((await app.voucher(cashierB, id)).events.some((e) => e.action === 'TAKEN_OVER' && e.actorName === 'Kế toán B')).toBe(true);

    // Phiên bản cũ bị từ chối.
    await rejects(app.postSourced(cashierB, id, { revision: 1 }), 'FINANCE_REVISION_CONFLICT');

    // Hai người cùng ghi sổ: đúng một lần.
    await app.takeOverSourced(cashierA, id);
    const results = await Promise.allSettled([app.postSourced(cashierA, id, {}), app.postSourced(cashierA, id, {})]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const posted = await app.voucher(cashierA, id);
    expect(posted).toMatchObject({ status: 'APPROVED', code: expect.stringMatching(/^PC-\d{4}-\d{4}$/), decidedBy: cashierA.userId });
    expect(posted.source?.status).toBe('POSTED');
    expect(Number((await pool.query(`SELECT count(*) FROM finance_schema.ledger_entries WHERE voucher_id=$1`, [id])).rows[0].count)).toBe(1);

    const postedEvents = (await outbox(id)).filter((row) => row.event_type === 'finance.voucher.posted');
    expect(postedEvents).toHaveLength(1);
    expect(postedEvents[0].payload.payload).toMatchObject({ instanceId: payload.instanceId, activation: 1, code: posted.code, amount: 2_500_000, postedBy: cashierA.userId });

    await rejects(app.postSourced(cashierA, id, {}), 'FINANCE_SOURCE_STATE');
    await rejects(app.reverse(cashierA, id, 'sai'), 'FINANCE_SOURCE_MANAGED');

    // Yêu cầu đến lại sau khi đã ghi sổ: báo lại posted thay vì tạo gì mới.
    expect(await receiveFinanceProcedureEvent(pool, tenantId, event({ ...payload, activation: 2 }))).toBe('reposted');
  });

  it('quyền thao tác do Procedure quyết (D8): có quyền duyệt mà không được giao bước thì bị chặn; Procedure sập thì từ chối', async () => {
    const payload = requested({ assigneeIds: [], assigneeSubjects: [{ subjectType: 'position', subjectId: randomUUID(), subjectLabel: 'Kế toán' }] });
    await receiveFinanceProcedureEvent(pool, tenantId, event(payload));
    const id = await voucherIdOf(payload.instanceId);

    const seen = await app.voucher(outsider, id);
    expect(seen.source?.canAct).toBe(false);
    expect(seen.permissions.sourced.canPost).toBe(false);
    await rejects(app.postSourced(outsider, id, {}), 'FINANCE_FORBIDDEN');
    await rejects(app.returnSourced(outsider, id, { reason: 'x' }), 'FINANCE_FORBIDDEN');
    await rejects(app.postSourced(viewer, id, {}), 'FINANCE_FORBIDDEN'); // chỉ có quyền xem

    pe.available = false;
    const offline = await app.voucher(cashierA, id);
    expect(offline.source).toMatchObject({ canAct: null, canActReason: expect.stringContaining('Không xác minh được') });
    await rejects(app.postSourced(cashierA, id, {}), 'FINANCE_STEP_UNVERIFIED');
  });

  it('trả hồ sơ: bắt buộc lý do, báo returned, phiếu chỉ xem; hồ sơ quay lại thì cập nhật đúng phiếu đó, giữ phần kế toán đã nhập', async () => {
    const payload = requested({ projectId: PROJECT.id });
    await receiveFinanceProcedureEvent(pool, tenantId, event(payload));
    const id = await voucherIdOf(payload.instanceId);
    await app.updateVoucher(cashierA, id, accountantInput());

    await rejects(app.returnSourced(cashierA, id, { reason: '  ' }), 'FINANCE_INVALID');
    const returned = await app.returnSourced(cashierA, id, { reason: 'Sai số tài khoản người nhận' });
    expect(returned.source?.status).toBe('RETURNED');
    expect(returned.permissions.sourced.canPost).toBe(false);
    const returnedEvent = (await outbox(id)).find((row) => row.event_type === 'finance.voucher.returned');
    expect(returnedEvent?.payload.payload).toMatchObject({ instanceId: payload.instanceId, activation: 1, reason: 'Sai số tài khoản người nhận', actorId: cashierA.userId });
    await rejects(app.updateVoucher(cashierA, id, accountantInput()), 'FINANCE_SOURCE_STATE');

    // Sự kiện cũ (lần kích hoạt trước) đến muộn: bỏ qua.
    expect(await receiveFinanceProcedureEvent(pool, tenantId, event(payload))).toBe('ignored');

    const again = { ...payload, activation: 2, stepInstanceId: randomUUID(), values: { ...payload.values, amount: 3_000_000, counterpartyAccountNo: '999' } };
    expect(await receiveFinanceProcedureEvent(pool, tenantId, event(again))).toBe('updated');
    const updated = await app.voucher(cashierA, id);
    expect(updated).toMatchObject({ totalAmount: 3_000_000, counterpartyAccountNo: '999', accountId, reasonId, status: 'DRAFT' });
    expect(updated.source).toMatchObject({ status: 'OPEN', activation: 2, handlingBy: null });
    expect(updated.lines.map((line) => line.total)).toEqual([3_000_000]);
    expect(Number((await pool.query(`SELECT count(*) FROM finance_schema.voucher_sources WHERE instance_id=$1`, [payload.instanceId])).rows[0].count)).toBe(1);

    await app.postSourced(cashierA, id, {});
    const posted = (await outbox(id)).find((row) => row.event_type === 'finance.voucher.posted');
    expect(posted?.payload.payload).toMatchObject({ activation: 2, stepInstanceId: again.stepInstanceId, amount: 3_000_000 });
  });

  it('bộ lọc: chờ tôi ghi sổ (gán thẳng hoặc qua Procedure), chờ ghi sổ (tất cả), từ quy trình, tìm theo mã hồ sơ', async () => {
    const direct = requested({ assigneeIds: [cashierB.userId] });
    const viaPosition = requested({ assigneeIds: [], assigneeSubjects: [{ subjectType: 'position', subjectId: randomUUID() }] });
    const notMine = requested({ assigneeIds: [cashierA.userId] });
    for (const payload of [direct, viaPosition, notMine]) await receiveFinanceProcedureEvent(pool, tenantId, event(payload));
    const [directId, viaPositionId, notMineId] = await Promise.all([direct, viaPosition, notMine].map((p) => voucherIdOf(p.instanceId)));

    pe.allowed = new Set([cashierB.userId]); // B giữ chức danh của bước
    const mine = await app.listVouchers(cashierB, { kind: 'PAYMENT', scope: 'to-post', pageSize: 100 });
    const mineIds = mine.items.map((item) => item.id);
    expect(mineIds).toEqual(expect.arrayContaining([directId, viaPositionId]));
    expect(mineIds).not.toContain(notMineId);

    const all = await app.listVouchers(cashierB, { kind: 'PAYMENT', scope: 'awaiting-post', pageSize: 100 });
    expect(all.items.map((item) => item.id)).toEqual(expect.arrayContaining([directId, viaPositionId, notMineId]));
    expect((await app.listVouchers(viewer, { kind: 'PAYMENT', scope: 'awaiting-post' })).total).toBe(0);

    const sourced = await app.listVouchers(viewer, { kind: 'PAYMENT', source: 'procedure', pageSize: 100 });
    expect(sourced.items.every((item) => item.approvalMode === 'INHERITED' && item.sourceCode)).toBe(true);
    const found = await app.listVouchers(viewer, { kind: 'PAYMENT', search: direct.instanceCode, pageSize: 100 });
    expect(found.items.map((item) => item.id)).toContain(directId);
  });

  /* ---------------------- Giai đoạn 5: hồ sơ huỷ / huỷ hiệu lực ---------------------- */

  const instanceEvent = (type: 'procedure.instance.completed' | 'procedure.instance.reversed', payload: Record<string, unknown>): IntegrationEventEnvelope => ({
    id: randomUUID(),
    type,
    version: 1,
    occurredAt: new Date().toISOString(),
    tenantId,
    source: 'procedure-engine',
    correlationId: String(payload.instanceId),
    payload: { sourceType: 'manual', sourceId: randomUUID(), ...payload },
  });
  const reversed = (instanceId: string, reason = 'Nhập sai hồ sơ') =>
    instanceEvent('procedure.instance.reversed', { instanceId, instanceCode: 'PR', reason, reversedBy: manager.userId, reversedByName: 'Quản trị' });
  const lockBooks = (until: string | null) =>
    pool.query(
      `INSERT INTO finance_schema.settings (tenant_id, books_locked_until) VALUES ($1,$2)
       ON CONFLICT (tenant_id) DO UPDATE SET books_locked_until=EXCLUDED.books_locked_until`,
      [tenantId, until],
    );
  const balance = async () =>
    Number(
      (await pool.query(`SELECT COALESCE(SUM(amount),0) AS s FROM finance_schema.ledger_entries WHERE account_id=$1`, [accountId])).rows[0].s,
    );
  /** Hồ sơ tới bước Tài chính, kế toán nhập và ghi sổ. */
  const postedFromInstance = async () => {
    const payload = requested();
    await receiveFinanceProcedureEvent(pool, tenantId, event(payload));
    const id = await voucherIdOf(payload.instanceId);
    await app.updateVoucher(cashierA, id, accountantInput());
    await app.postSourced(cashierA, id, {});
    return { payload, id };
  };

  it('huỷ hiệu lực hồ sơ sau khi ghi sổ: đảo phiếu vào hôm nay, phiếu ĐÃ HUỶ, nguồn đóng; sự kiện giao lại không đảo hai lần', async () => {
    const { payload, id } = await postedFromInstance();
    const before = await balance();
    expect(await app.instanceReversalCheck(tenantId, payload.instanceId)).toEqual({ allowed: true });

    const first = reversed(payload.instanceId);
    expect(isFinanceProcedureEvent(first)).toBe(true);
    expect(await receiveFinanceProcedureEvent(pool, tenantId, first)).toBe('applied');
    expect(await receiveFinanceProcedureEvent(pool, tenantId, first)).toBe('ignored');
    expect(await balance()).toBe(before + 2_500_000);

    const voucher = await app.voucher(cashierA, id);
    expect(voucher).toMatchObject({ status: 'CANCELLED', code: expect.stringMatching(/^PC-\d{4}-\d{4}$/), decidedBy: manager.userId });
    expect(voucher.source?.status).toBe('CLOSED');
    expect(voucher.events.some((e) => e.action === 'REVERSED' && e.note?.includes('bị huỷ hiệu lực: Nhập sai hồ sơ'))).toBe(true);
    const reversals = (await pool.query(`SELECT posted_date, is_reversal FROM finance_schema.ledger_entries WHERE voucher_id=$1 AND is_reversal`, [id])).rows;
    expect(reversals).toHaveLength(1);
    expect(await receiveFinanceProcedureEvent(pool, tenantId, reversed(payload.instanceId))).toBe('ignored'); // phiếu đã huỷ
  });

  it('kỳ hiện tại đã khoá sổ: reversal-check chặn; nếu vẫn huỷ hiệu lực thì nguồn chờ đảo (không ném lỗi), mở khoá thì đảo lại được', async () => {
    const { payload, id } = await postedFromInstance();
    await lockBooks(today);
    try {
      const check = await app.instanceReversalCheck(tenantId, payload.instanceId);
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('Sổ đã khoá');

      expect(await receiveFinanceProcedureEvent(pool, tenantId, reversed(payload.instanceId))).toBe('conflict');
      const pending = await app.voucher(cashierA, id);
      expect(pending.status).toBe('APPROVED');
      expect(pending.source).toMatchObject({ status: 'REVERSAL_PENDING', reversalReason: expect.stringContaining('Nhập sai hồ sơ'), reversalError: expect.stringContaining('Sổ đã khoá') });
      expect(pending.permissions.sourced.canRetryReversal).toBe(true);
      expect((await app.voucher(viewer, id)).permissions.sourced.canRetryReversal).toBe(false);
      expect(Number((await pool.query(`SELECT count(*) FROM finance_schema.ledger_entries WHERE voucher_id=$1 AND is_reversal`, [id])).rows[0].count)).toBe(0);

      await rejects(app.retrySourceReversal(cashierA, id), 'FINANCE_SOURCE_REVERSAL'); // vẫn khoá
      await rejects(app.retrySourceReversal(viewer, id), 'FINANCE_FORBIDDEN');
    } finally {
      await lockBooks(null);
    }
    const done = await app.retrySourceReversal(cashierA, id);
    expect(done.status).toBe('CANCELLED');
    expect(done.source?.status).toBe('CLOSED');
    expect(done.decidedBy).toBe(cashierA.userId);
  });

  it('hồ sơ bị huỷ hoặc từ chối khi phiếu còn nháp: phiếu ĐÃ HUỶ không bút toán; hồ sơ hoàn tất bình thường thì bỏ qua', async () => {
    const cancelled = requested();
    const rejected = requested();
    for (const p of [cancelled, rejected]) await receiveFinanceProcedureEvent(pool, tenantId, event(p));
    const done = instanceEvent('procedure.instance.completed', { instanceId: cancelled.instanceId, status: 'completed' });
    expect(await receiveFinanceProcedureEvent(pool, tenantId, done)).toBe('ignored');

    const cancelEvent = instanceEvent('procedure.instance.completed', { instanceId: cancelled.instanceId, status: 'cancelled', actorId: manager.userId });
    expect(await receiveFinanceProcedureEvent(pool, tenantId, cancelEvent)).toBe('applied');
    expect(await receiveFinanceProcedureEvent(pool, tenantId, cancelEvent)).toBe('ignored');
    expect(await receiveFinanceProcedureEvent(pool, tenantId, instanceEvent('procedure.instance.completed', { instanceId: rejected.instanceId, status: 'rejected' }))).toBe(
      'applied',
    );
    for (const p of [cancelled, rejected]) {
      const voucher = await app.voucher(cashierA, await voucherIdOf(p.instanceId));
      expect(voucher.status).toBe('CANCELLED');
      expect(voucher.code).toMatch(/^NHAP_PC_/);
      expect(voucher.source?.status).toBe('CLOSED');
      expect(voucher.permissions.sourced.canPost).toBe(false);
    }
    expect((await app.voucher(cashierA, await voucherIdOf(rejected.instanceId))).events.some((e) => e.note?.includes('bị từ chối'))).toBe(true);
  });

  it('hồ sơ không có phiếu: bỏ qua, không ghi hộp thư; reversal-check cho phép (kể cả phiếu nháp)', async () => {
    const stranger = randomUUID();
    const before = Number((await pool.query(`SELECT count(*) FROM finance_schema.procedure_inbox`)).rows[0].count);
    expect(await receiveFinanceProcedureEvent(pool, tenantId, reversed(stranger))).toBe('ignored');
    expect(await receiveFinanceProcedureEvent(pool, tenantId, instanceEvent('procedure.instance.completed', { instanceId: stranger, status: 'cancelled' }))).toBe('ignored');
    expect(Number((await pool.query(`SELECT count(*) FROM finance_schema.procedure_inbox`)).rows[0].count)).toBe(before);
    expect(await app.instanceReversalCheck(tenantId, stranger)).toEqual({ allowed: true });
    expect(await app.instanceReversalCheck(tenantId, 'khong-phai-uuid')).toEqual({ allowed: true });

    const draft = requested();
    await receiveFinanceProcedureEvent(pool, tenantId, event(draft));
    expect(await app.instanceReversalCheck(tenantId, draft.instanceId)).toEqual({ allowed: true });
    expect(await receiveFinanceProcedureEvent(pool, tenantId, { ...reversed(draft.instanceId), source: 'hrm' })).toBe('ignored');
    expect(await receiveFinanceProcedureEvent(pool, tenantId, reversed(draft.instanceId))).toBe('applied');
    expect((await app.voucher(cashierA, await voucherIdOf(draft.instanceId))).status).toBe('CANCELLED');
  });

  it('payload hỏng bị từ chối; sự kiện không do Procedure phát bị bỏ qua', async () => {
    await expect(receiveFinanceProcedureEvent(pool, tenantId, event({ ...requested(), instanceId: 'x' }))).rejects.toThrow('instanceId');
    expect(await receiveFinanceProcedureEvent(pool, tenantId, event(requested(), { source: 'hrm' }))).toBe('ignored');
    expect(await receiveFinanceProcedureEvent(pool, tenantId, event(requested(), { tenantId: randomUUID() }))).toBe('ignored');
  });
});
