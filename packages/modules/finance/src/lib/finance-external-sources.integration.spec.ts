import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import type { CreateFinanceVoucherSourceRequest, FinanceStepVoucherRequestedPayload, SaveFinanceVoucherRequest } from '@enterprise-platform/contracts-finance';
import type { Pool } from 'pg';
import { FinanceApplication } from './application/finance.application.js';
import type { FinanceActor } from './domain/finance.access.js';
import { FakeFinanceStorage, TestFinanceDatabase, dropTestDatabase } from './finance-test-support.js';
import { todayVn } from './infrastructure/finance.database.js';
import { receiveFinanceProcedureEvent } from './infrastructure/procedure-events.js';

const integration = process.env.FINANCE_TEST_ADMIN_URL ? describe : describe.skip;

const PE = 'http://pe.test/api/procedure';
const WS = 'http://ws.test/api/workspace';

integration('Tài chính: phiếu thu có nguồn Bán hàng qua API nội bộ (PostgreSQL)', () => {
  const databaseName = 'finance_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const today = todayVn();
  let admin: ReturnType<typeof createPostgresPool>;
  let pool: Pool;
  let app: FinanceApplication;
  const originalFetch = global.fetch;

  const actor = (name: string, permissions: string[]): FinanceActor => ({ tenantId, userId: randomUUID(), displayName: name, permissions });
  const collector = actor('Kế toán công nợ', ['finance.receipt.approve']); // người ghi nhận lần thu bên Bán hàng
  const cashier = actor('Thủ quỹ', ['finance.receipt.approve']);
  const creatorOnly = actor('Người lập phiếu thu', ['finance.receipt.create']);
  const reader = actor('Người xem', ['finance.read']);
  const manager = actor('Quản trị tài chính', ['finance.manage']);

  const pe = { calls: 0, allowed: new Set<string>() };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fakeFetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(PE)) {
      pe.calls += 1;
      const body = init?.body ? (JSON.parse(String(init.body)) as { userId?: string }) : {};
      return json(pe.allowed.has(String(body.userId)) ? { allowed: true } : { allowed: false, reason: 'Không được giao.' });
    }
    if (url.startsWith(WS)) return json({}, 404);
    return originalFetch(input as string, init);
  });

  const request = (over: Partial<CreateFinanceVoucherSourceRequest> = {}): CreateFinanceVoucherSourceRequest => {
    const sourceRef = over.sourceRef ?? randomUUID();
    return {
      idempotencyKey: `crm:receipt:${sourceRef}`,
      sourceModule: 'crm',
      sourceRef,
      sourceCode: `PT-${sourceRef.slice(0, 4)}`,
      kind: 'RECEIPT',
      amount: 4_000_000,
      content: 'Thu tiền đơn hàng DH-0001',
      counterpartyName: 'Công ty ABC',
      voucherDate: today,
      initiatedBy: collector.userId,
      initiatedByName: collector.displayName,
      ...over,
    };
  };

  const outbox = async (voucherId: string) =>
    (
      await pool.query(
        `SELECT event_type, payload FROM integration_schema.outbox_events WHERE aggregate_id=$1 ORDER BY occurred_at, id`,
        [voucherId],
      )
    ).rows as { event_type: string; payload: { correlationId: string; payload: Record<string, unknown> } }[];
  const rejects = async (promise: Promise<unknown>, code: string) => {
    const error = await promise.then(() => null, (e: { code?: string }) => e);
    expect(error?.code).toBe(code);
  };
  const sourceCount = async (sourceRef: string) =>
    Number((await pool.query(`SELECT count(*) FROM finance_schema.voucher_sources WHERE source_ref=$1`, [sourceRef])).rows[0].count);

  let accountId: string;
  let reasonId: string;
  let groupId: string;
  const accountantInput = (over: Partial<SaveFinanceVoucherRequest> = {}): SaveFinanceVoucherRequest => ({
    kind: 'RECEIPT',
    voucherDate: '2026-01-02',
    postingDate: today,
    content: 'Client cố sửa nội dung',
    counterpartyName: 'Client cố sửa đối tượng',
    reasonId,
    accountId,
    counterpartyGroupId: groupId,
    lines: [{ description: 'Client cố sửa dòng', quantity: 1, unitAmount: 1, total: 1 }],
    ...over,
  });
  /** Tạo phiếu và nhập phần kế toán (tài khoản, lý do, nhóm đối tượng) để ghi sổ được. */
  const readyVoucher = async (over: Partial<CreateFinanceVoucherSourceRequest> = {}) => {
    const created = await app.createExternalVoucherSource(tenantId, request(over));
    await app.updateVoucher(cashier, created.voucherId, accountantInput());
    await app.takeOverSourced(cashier, created.voucherId);
    return created;
  };

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
    // Chạy lại migration mới nhất: phải idempotent.
    await pool.query(await readFile(resolve(directory, '0010-external-source.sql'), 'utf8'));
    app = new FinanceApplication(new TestFinanceDatabase(pool), new FakeFinanceStorage());

    accountId = (
      await app.saveAccount(manager, null, { code: 'TM', name: 'Tiền mặt', accountType: 'CASH', openingBalance: 0, openingDate: '2026-01-01' })
    ).id;
    reasonId = (await app.saveReason(manager, null, { kind: 'RECEIPT', code: 'TKH', name: 'Thu tiền khách hàng' })).id;
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
    pe.calls = 0;
    pe.allowed = new Set();
  });

  it('TC-INT-05: tạo phiếu thu nháp INHERITED, nguồn crm, khoá số tiền, nội dung, đối tượng, ngày; kế toán chỉ sửa phần kế toán', async () => {
    const input = request({ voucherDate: '2026-01-05', description: 'Phân bổ HĐ-01' });
    const state = await app.createExternalVoucherSource(tenantId, input);
    expect(state).toMatchObject({
      status: 'DRAFT',
      sourceStatus: 'OPEN',
      sourceModule: 'crm',
      sourceRef: input.sourceRef,
      amount: 4_000_000,
      postedAt: null,
      voucherCode: expect.stringMatching(/^NHAP_PT_/),
    });
    const row = (await pool.query(`SELECT * FROM finance_schema.voucher_sources WHERE voucher_id=$1`, [state.voucherId])).rows[0];
    expect(row).toMatchObject({ source_module: 'crm', source_ref: input.sourceRef, idempotency_key: input.idempotencyKey, instance_id: null, step_instance_id: null });

    const voucher = await app.voucher(cashier, state.voucherId);
    expect(voucher).toMatchObject({
      kind: 'RECEIPT',
      status: 'DRAFT',
      approvalMode: 'INHERITED',
      createdBy: collector.userId,
      content: input.content,
      counterpartyName: 'Công ty ABC',
      voucherDate: '2026-01-05',
      sourceCode: input.sourceCode,
    });
    expect(voucher.source).toMatchObject({
      sourceModule: 'crm',
      sourceRef: input.sourceRef,
      instanceId: null,
      canAct: true,
      lockedFields: ['amount', 'content', 'counterpartyName', 'voucherDate'],
    });
    expect(voucher.permissions.sourced).toMatchObject({ canEditSourced: true, canPost: true, canReturnSource: true });

    const saved = await app.updateVoucher(cashier, state.voucherId, accountantInput());
    expect(saved).toMatchObject({ content: input.content, counterpartyName: 'Công ty ABC', voucherDate: '2026-01-05', totalAmount: 4_000_000, accountId, reasonId });
    expect(saved.lines.map((line) => [line.description, line.total])).toEqual([['Phân bổ HĐ-01', 4_000_000]]);
    expect(pe.calls).toBe(0); // không hỏi Procedure với nguồn không phải Quy trình

    // Người chỉ có quyền lập phiếu thu: không thao tác được.
    await rejects(app.updateVoucher(creatorOnly, state.voucherId, accountantInput()), 'FINANCE_FORBIDDEN');
    await rejects(app.postSourced(creatorOnly, state.voucherId, {}), 'FINANCE_FORBIDDEN');

    expect(await app.externalVoucherSourceState(tenantId, 'crm', input.sourceRef)).toMatchObject({ voucherId: state.voucherId, status: 'DRAFT' });
    await rejects(app.externalVoucherSourceState(tenantId, 'crm', randomUUID()), 'FINANCE_NOT_FOUND');
    await rejects(app.externalVoucherSourceState(tenantId, undefined, input.sourceRef), 'FINANCE_INVALID');
  });

  it('khoá chống lặp: cùng khoá cùng nội dung trả phiếu cũ; khác nội dung 409; cùng lần thu khác khoá 409; dữ liệu sai 422', async () => {
    const input = request();
    const first = await app.createExternalVoucherSource(tenantId, input);
    const again = await app.createExternalVoucherSource(tenantId, { ...input, initiatedByName: 'Tên mới' });
    expect(again.voucherId).toBe(first.voucherId);
    await rejects(app.createExternalVoucherSource(tenantId, { ...input, amount: 5_000_000 }), 'FINANCE_IDEMPOTENCY_CONFLICT');
    await rejects(app.createExternalVoucherSource(tenantId, { ...input, idempotencyKey: `${input.idempotencyKey}:2` }), 'FINANCE_SOURCE_REF_CONFLICT');
    await rejects(app.createExternalVoucherSource(tenantId, { ...input, idempotencyKey: 'x', amount: -1 }), 'FINANCE_INVALID');
    expect(await sourceCount(input.sourceRef)).toBe(1);
  });

  it('TC-CONC-05: gọi song song cùng khoá chỉ tạo một phiếu thu và một dòng nguồn', async () => {
    const input = request();
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => app.createExternalVoucherSource(tenantId, input)));
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const ids = new Set(results.map((r) => (r as PromiseFulfilledResult<{ voucherId: string }>).value.voucherId));
    expect(ids.size).toBe(1);
    expect(await sourceCount(input.sourceRef)).toBe(1);
    const vouchers = await pool.query(`SELECT count(*) FROM finance_schema.vouchers WHERE content=$1 AND id = ANY($2::uuid[])`, [input.content, [...ids]]);
    expect(Number(vouchers.rows[0].count)).toBe(1);
  });

  it('TC-INT-06: người ghi nhận không tự ghi sổ được; người khác ghi sổ, phát posted và status-changed có sourceModule, sourceRef', async () => {
    const created = await readyVoucher();
    const own = await app.voucher(collector, created.voucherId);
    expect(own.permissions.sourced.canPost).toBe(false);
    expect(own.source).toMatchObject({ canAct: false, canActReason: 'Không được tự duyệt phiếu do mình lập.' });
    await app.takeOverSourced(collector, created.voucherId);
    await rejects(app.postSourced(collector, created.voucherId, {}), 'FINANCE_FORBIDDEN');

    await app.takeOverSourced(cashier, created.voucherId);
    const posted = await app.postSourced(cashier, created.voucherId, { note: 'Đã nhận tiền' });
    expect(posted).toMatchObject({ status: 'APPROVED', code: expect.stringMatching(/^PT-\d{4}-\d{4}$/), decidedBy: cashier.userId });
    expect(posted.source?.status).toBe('POSTED');
    expect(posted.permissions.canReverse).toBe(true);

    const events = await outbox(created.voucherId);
    const postedEvent = events.find((e) => e.event_type === 'finance.voucher.posted');
    expect(postedEvent?.payload.correlationId).toBe(created.sourceRef);
    expect(postedEvent?.payload.payload).toEqual({
      instanceId: null,
      stepInstanceId: null,
      activation: null,
      voucherId: created.voucherId,
      code: posted.code,
      voucherCode: posted.code,
      amount: 4_000_000,
      postedAt: expect.any(String),
      postedBy: cashier.userId,
      postedByName: cashier.displayName,
      sourceModule: 'crm',
      sourceRef: created.sourceRef,
    });
    const statusChanged = events.find((e) => e.event_type === 'finance.voucher.status-changed');
    expect(statusChanged?.payload.payload).toMatchObject({ status: 'APPROVED', sourceModule: 'crm', sourceRef: created.sourceRef });
    expect(await app.externalVoucherSourceState(tenantId, 'crm', created.sourceRef)).toMatchObject({
      status: 'APPROVED',
      sourceStatus: 'POSTED',
      voucherCode: posted.code,
      postedAt: expect.any(String),
    });
    expect(pe.calls).toBe(0);
  });

  it('cài đặt cho tự duyệt thì người ghi nhận tự ghi sổ được', async () => {
    await app.saveSettings(manager, { allowSelfApproval: true });
    try {
      const created = await app.createExternalVoucherSource(tenantId, request());
      await app.updateVoucher(collector, created.voucherId, accountantInput());
      expect((await app.postSourced(collector, created.voucherId, {})).status).toBe('APPROVED');
    } finally {
      await app.saveSettings(manager, { allowSelfApproval: false });
    }
  });

  it('TC-INT-07: trả lại phát returned có sourceModule; gửi lại bằng khoá mới mở lại đúng phiếu đó', async () => {
    const created = await readyVoucher();
    const returned = await app.returnSourced(cashier, created.voucherId, { reason: 'Sai tên khách' });
    expect(returned.source?.status).toBe('RETURNED');
    const event = (await outbox(created.voucherId)).find((e) => e.event_type === 'finance.voucher.returned');
    expect(event?.payload.payload).toMatchObject({
      instanceId: null,
      stepInstanceId: null,
      activation: null,
      voucherId: created.voucherId,
      reason: 'Sai tên khách',
      actorId: cashier.userId,
      sourceModule: 'crm',
      sourceRef: created.sourceRef,
    });
    await rejects(app.postSourced(cashier, created.voucherId, {}), 'FINANCE_SOURCE_STATE');

    const resent = await app.createExternalVoucherSource(
      tenantId,
      request({ sourceRef: created.sourceRef, idempotencyKey: `crm:receipt:${created.sourceRef}:2`, counterpartyName: 'Công ty ABC (đã sửa)' }),
    );
    expect(resent).toMatchObject({ voucherId: created.voucherId, sourceStatus: 'OPEN', status: 'DRAFT' });
    const reopened = await app.voucher(cashier, created.voucherId);
    expect(reopened).toMatchObject({ counterpartyName: 'Công ty ABC (đã sửa)', accountId });
    expect(reopened.source).toMatchObject({ status: 'OPEN', activation: 2 });
    expect(await sourceCount(created.sourceRef)).toBe(1);
  });

  it('TC-INT-07: người có quyền duyệt đảo thủ công phiếu nguồn crm đã ghi sổ, phát status-changed REVERSED kèm nguồn', async () => {
    const created = await readyVoucher();
    await app.postSourced(cashier, created.voucherId, {});
    await rejects(app.reverse(reader, created.voucherId, 'x'), 'FINANCE_FORBIDDEN');
    await rejects(app.reverse(cashier, created.voucherId, ' '), 'FINANCE_INVALID');

    const reversed = await app.reverse(cashier, created.voucherId, 'Khách huỷ thanh toán');
    expect(reversed.status).toBe('CANCELLED');
    expect(reversed.source?.status).toBe('REVERSED');
    expect(reversed.permissions.canReverse).toBe(false);
    const ledger = await pool.query(`SELECT amount, is_reversal FROM finance_schema.ledger_entries WHERE voucher_id=$1 ORDER BY is_reversal`, [created.voucherId]);
    expect(ledger.rows.map((r) => [Number(r.amount), r.is_reversal])).toEqual([
      [4_000_000, false],
      [-4_000_000, true],
    ]);
    const statusChanged = (await outbox(created.voucherId)).filter((e) => e.event_type === 'finance.voucher.status-changed').map((e) => e.payload.payload);
    expect(statusChanged.at(-1)).toMatchObject({ status: 'REVERSED', voucherId: created.voucherId, sourceModule: 'crm', sourceRef: created.sourceRef });
    expect(await app.externalVoucherSourceState(tenantId, 'crm', created.sourceRef)).toMatchObject({ status: 'CANCELLED', sourceStatus: 'REVERSED' });
    await rejects(app.reverse(cashier, created.voucherId, 'lần hai'), 'FINANCE_VOUCHER_STATE');
  });

  it('TC-REG-11: phiếu nguồn Quy trình vẫn hỏi Procedure, posted mang sourceModule procedure-engine, vẫn không đảo thủ công được', async () => {
    const instanceId = randomUUID();
    const payload: FinanceStepVoucherRequestedPayload = {
      instanceId,
      instanceCode: 'PR-9001',
      instanceTitle: 'Đề nghị thu',
      definitionId: randomUUID(),
      definitionName: 'Đề nghị thu',
      stepInstanceId: randomUUID(),
      stepName: 'Thu tiền',
      activation: 1,
      voucherKind: 'RECEIPT',
      values: { amount: 1_000_000, content: 'Thu tạm ứng', counterpartyName: 'Nhân viên A', counterpartyAccountNo: null, counterpartyBank: null, voucherDate: null },
      initiatedBy: collector.userId,
      assigneeIds: [cashier.userId],
      assigneeSubjects: [],
      requestedAt: new Date().toISOString(),
    };
    const envelope: IntegrationEventEnvelope = {
      id: randomUUID(),
      type: 'procedure.step.finance_voucher_requested',
      version: 1,
      occurredAt: new Date().toISOString(),
      tenantId,
      source: 'procedure-engine',
      correlationId: instanceId,
      payload,
    };
    expect(await receiveFinanceProcedureEvent(pool, tenantId, envelope)).toBe('created');
    const id = String((await pool.query(`SELECT voucher_id FROM finance_schema.voucher_sources WHERE instance_id=$1`, [instanceId])).rows[0].voucher_id);
    expect((await pool.query(`SELECT source_module, source_ref FROM finance_schema.voucher_sources WHERE voucher_id=$1`, [id])).rows[0]).toEqual({
      source_module: 'procedure-engine',
      source_ref: null,
    });

    pe.allowed = new Set([cashier.userId]);
    await app.updateVoucher(cashier, id, accountantInput());
    const posted = await app.postSourced(cashier, id, {});
    expect(posted.status).toBe('APPROVED');
    expect(posted.permissions.canReverse).toBe(false);
    expect(pe.calls).toBeGreaterThan(0);
    const events = await outbox(id);
    const postedEvent = events.find((e) => e.event_type === 'finance.voucher.posted');
    expect(postedEvent?.payload.correlationId).toBe(instanceId);
    expect(postedEvent?.payload.payload).toMatchObject({
      instanceId,
      stepInstanceId: payload.stepInstanceId,
      activation: 1,
      sourceModule: 'procedure-engine',
      sourceRef: null,
    });
    // Sự kiện thông báo của nguồn Quy trình không đổi (không thêm trường nguồn).
    expect(events.find((e) => e.event_type === 'finance.voucher.status-changed')?.payload.payload).not.toHaveProperty('sourceModule');
    await rejects(app.reverse(cashier, id, 'sai'), 'FINANCE_SOURCE_MANAGED');

    // Ràng buộc: dòng Quy trình phải có hồ sơ; dòng nguồn khác phải có source_ref; một hồ sơ = một phiếu.
    await expect(pool.query(`UPDATE finance_schema.voucher_sources SET instance_id=NULL WHERE voucher_id=$1`, [id])).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(`UPDATE finance_schema.voucher_sources SET source_module='crm', source_ref=NULL WHERE voucher_id=$1`, [id]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
