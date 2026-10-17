import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import type { SaveFinanceVoucherRequest } from '@enterprise-platform/contracts-finance';
import type { Pool } from 'pg';
import { FinanceApplication } from './application/finance.application.js';
import type { FinanceActor } from './domain/finance.access.js';
import { FakeFinanceStorage, TestFinanceDatabase, dropTestDatabase } from './finance-test-support.js';
import { todayVn } from './infrastructure/finance.database.js';
import { receiveFinanceProcedureEvent } from './infrastructure/procedure-events.js';
import { processFinanceProcedureSync } from './infrastructure/procedure-links.store.js';

const integration = process.env.FINANCE_TEST_ADMIN_URL ? describe : describe.skip;

const BASE = 'http://pe.test/api/procedure';

/** Hồ sơ giả lập trong "Procedure": đủ để Tài chính tạo, hỏi tiến độ và thao tác. */
interface FakeInstance {
  id: string;
  code: string;
  status: 'running' | 'completed' | 'rejected' | 'cancelled';
  body: Record<string, unknown>;
}

integration('Tài chính: duyệt phiếu qua quy trình (PostgreSQL, Procedure giả lập)', () => {
  const databaseName = 'finance_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const today = todayVn();
  let admin: ReturnType<typeof createPostgresPool>;
  let pool: Pool;
  let app: FinanceApplication;
  const originalFetch = global.fetch;

  const actor = (name: string, permissions: string[]): FinanceActor => ({ tenantId, userId: randomUUID(), displayName: name, permissions });
  const accountant = actor('Kế toán viên', ['finance.payment.create', 'finance.receipt.create']);
  const chief = actor('Kế toán trưởng', ['finance.payment.approve', 'finance.receipt.approve', 'finance.read', 'finance.report.read']);
  const manager = actor('Quản trị tài chính', ['finance.manage']);
  const session = { cookie: 'ep_access=abc', csrf: 'csrf' };

  // ---- Procedure giả lập ----
  const pe = {
    available: true,
    failStart: false,
    instances: new Map<string, FakeInstance>(),
    byKey: new Map<string, string>(),
    actions: [] as { instanceId: string; action: string; comment?: string; key: string }[],
    canAct: true,
    definition: undefined as unknown,
  };
  const DEF_ID = randomUUID();
  const attribute = (code: string, type: string, required: boolean) => ({ id: randomUUID(), code, name: code, type, required });
  const definitionWith = (attributes: unknown[], steps = 2) => ({
    id: DEF_ID,
    code: 'DUYET-CHI',
    name: 'Duyệt phiếu chi',
    attributes,
    gateways: [],
    steps: [
      { id: 'start', name: 'Lập phiếu', assignments: [{ role: 'S' }], attributes: [] },
      ...(steps > 1 ? [{ id: 'approve', name: 'Kế toán trưởng duyệt', assignments: [{ role: 'A' }], attributes: [] }] : []),
    ],
  });

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fakeFetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith(BASE)) return originalFetch(input as string, init);
    if (!pe.available) throw new Error('connect ECONNREFUSED');
    const path = url.slice(BASE.length);
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (path === '/v1/internal/status') return json({ ok: true });
    if (path.startsWith('/v1/internal/definitions/')) return pe.definition ? json(pe.definition) : json({}, 404);
    if (path === '/v1/workspace')
      return json({ tenantId, definitions: [{ id: DEF_ID, code: 'DUYET-CHI', name: 'Duyệt phiếu chi', status: 'published' }, { id: randomUUID(), code: 'NHAP', name: 'Nháp', status: 'draft' }] });
    if (path === '/v1/internal/instances' && method === 'POST') {
      if (pe.failStart) return json({ message: 'Hệ thống bận' }, 503);
      const key = `${body['sourceType']}:${body['idempotencyKey']}`;
      const existing = pe.byKey.get(key);
      if (existing) return json({ id: existing, code: pe.instances.get(existing)?.code }, 201);
      const id = randomUUID();
      const singleStep = ((pe.definition as { steps: unknown[] }).steps ?? []).length === 1;
      pe.instances.set(id, { id, code: `QT-${pe.instances.size + 1}`, status: singleStep ? 'completed' : 'running', body });
      pe.byKey.set(key, id);
      return json({ id, code: pe.instances.get(id)?.code, currentStepName: 'Kế toán trưởng duyệt' }, 201);
    }
    const progress = /^\/v1\/internal\/instances\/([^/]+)\/progress/.exec(path);
    if (progress) {
      const instance = pe.instances.get(progress[1]);
      if (!instance) return json({}, 404);
      return json({ instanceId: instance.id, instanceCode: instance.code, status: instance.status, currentStepName: 'Kế toán trưởng duyệt', currentAssigneeName: 'Kế toán trưởng', canAct: pe.canAct, steps: [], activity: [] });
    }
    const action = /^\/v1\/instances\/([^/]+)\/actions$/.exec(path);
    if (action && method === 'POST') {
      const instance = pe.instances.get(action[1]);
      if (!instance) return json({ message: 'Không tìm thấy hồ sơ' }, 404);
      if (!pe.canAct) return json({ message: 'Bạn không được giao bước này' }, 403);
      pe.actions.push({ instanceId: instance.id, action: String(body['action']), comment: body['comment'] as string | undefined, key: String(body['idempotencyKey']) });
      instance.status = body['action'] === 'approve' ? 'completed' : body['action'] === 'reject' ? 'rejected' : body['action'] === 'cancel' ? 'cancelled' : instance.status;
      return json({ ok: true });
    }
    return json({ message: `route lạ ${path}` }, 404);
  });

  const event = (type: string, payload: Record<string, unknown>, over: Partial<IntegrationEventEnvelope> = {}): IntegrationEventEnvelope => ({
    id: randomUUID(),
    type,
    version: 1,
    occurredAt: new Date().toISOString(),
    tenantId,
    source: 'procedure-engine',
    correlationId: String(payload['instanceId'] ?? randomUUID()),
    payload,
    ...over,
  });

  let accountId: string;
  let reasonId: string;
  let groupId: string;
  const payment = (amount: number, over: Partial<SaveFinanceVoucherRequest> = {}): SaveFinanceVoucherRequest => ({
    kind: 'PAYMENT',
    voucherDate: today,
    postingDate: today,
    content: 'Chi văn phòng phẩm',
    reasonId,
    accountId,
    counterpartyGroupId: groupId,
    lines: [{ description: 'Giấy in', quantity: 1, unitAmount: amount, total: amount }],
    ...over,
  });
  const balance = async () => (await app.account(chief, accountId)).balance;
  const linkOf = async (voucherId: string) =>
    (await pool.query(`SELECT * FROM finance_schema.procedure_links WHERE voucher_id=$1 ORDER BY revision DESC, created_at DESC LIMIT 1`, [voucherId])).rows[0] as Record<string, unknown>;
  const submitViaProcedure = async (amount: number, over: Partial<SaveFinanceVoucherRequest> = {}) => {
    const draft = await app.createVoucher(accountant, payment(amount, over));
    return app.submit(accountant, draft.id);
  };
  const completed = (link: Record<string, unknown>, status = 'completed', actorId?: string) =>
    event('procedure.instance.completed', { instanceId: link['instance_id'], instanceCode: link['instance_code'], sourceType: 'finance_voucher', sourceId: link['id'], status, actorId });
  const rejects = async (promise: Promise<unknown>, code: string) => {
    const error = await promise.then(() => null, (e: { code?: string }) => e);
    expect(error?.code).toBe(code);
  };

  beforeAll(async () => {
    process.env['PROCEDURE_API_URL'] = BASE;
    process.env['INTERNAL_SERVICE_TOKEN'] = 'test-token';
    global.fetch = fakeFetch as unknown as typeof fetch;
    const url = new URL(process.env['FINANCE_TEST_ADMIN_URL'] as string);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString()) as unknown as Pool;
    // Hạ tầng sự kiện (outbox) có sẵn ở mọi DB tenant trước các migration của module; thông báo của Tài chính ghi vào đó.
    await pool.query(await readFile(resolve(process.cwd(), '../../../migrations/tenant/0001-integration.sql'), 'utf8'));
    const directory = resolve(process.cwd(), '../../../migrations/tenant/finance');
    for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) await pool.query(await readFile(resolve(directory, file), 'utf8'));
    app = new FinanceApplication(new TestFinanceDatabase(pool), new FakeFinanceStorage());

    accountId = (await app.saveAccount(manager, null, { code: 'VCB', name: 'Vietcombank', accountType: 'BANK', bankName: 'Vietcombank (VCB)', accountNumber: '0011', openingBalance: 10_000_000, openingDate: '2026-01-01' })).id;
    reasonId = (await app.saveReason(manager, null, { kind: 'PAYMENT', code: 'VPP', name: 'Văn phòng phẩm' })).id;
    groupId = (await app.catalogs(manager, false)).counterpartyGroups[0].id;
    pe.definition = definitionWith([attribute('so_tien', 'money', true), attribute('noi_dung', 'text', false)]);
  }, 120_000);

  afterAll(async () => {
    global.fetch = originalFetch;
    if (admin) {
      await dropTestDatabase(admin, pool, databaseName);
      await admin.end();
    } else await pool?.end();
  }, 60_000);

  it('cấu hình: chỉ người có quyền cấu hình được gán; thuộc tính bắt buộc Tài chính không điền được thì từ chối; Procedure sập thì báo rõ', async () => {
    await rejects(app.saveApprovalBinding(accountant, 'PAYMENT', { mode: 'PROCEDURE', procedureDefinitionId: DEF_ID }), 'FINANCE_FORBIDDEN');

    pe.definition = definitionWith([attribute('so_hop_dong', 'text', true)]);
    await rejects(app.saveApprovalBinding(manager, 'PAYMENT', { mode: 'PROCEDURE', procedureDefinitionId: DEF_ID }), 'FINANCE_PROCEDURE_ATTRIBUTES');

    pe.available = false;
    pe.definition = definitionWith([attribute('so_tien', 'money', true), attribute('noi_dung', 'text', false)]);
    await rejects(app.saveApprovalBinding(manager, 'PAYMENT', { mode: 'PROCEDURE', procedureDefinitionId: DEF_ID }), 'FINANCE_PROCEDURE_UNAVAILABLE');
    pe.available = true;

    const saved = await app.saveApprovalBinding(manager, 'PAYMENT', { mode: 'PROCEDURE', procedureDefinitionId: DEF_ID });
    expect(saved.binding).toMatchObject({ kind: 'PAYMENT', mode: 'PROCEDURE', procedureDefinitionName: 'Duyệt phiếu chi' });
    expect(saved.warnings).toEqual([]);
    const bindings = await app.approvalBindings(manager);
    expect(bindings.find((b) => b.kind === 'RECEIPT')?.mode).toBe('DIRECT');
    expect(bindings.find((b) => b.kind === 'PAYMENT')?.mode).toBe('PROCEDURE');
    await rejects(app.saveApprovalBinding(manager, 'PAYMENT', { mode: 'PROCEDURE', procedureDefinitionId: null }), 'FINANCE_INVALID');
    expect((await app.procedureDefinitions(manager, session)).map((d) => d.code)).toEqual(['DUYET-CHI']);
  });

  it('gửi duyệt tạo hồ sơ quy trình với thuộc tính lấy từ phiếu; duyệt trực tiếp bị chặn; chưa ghi sổ cho tới khi quy trình duyệt', async () => {
    const before = (await balance())!;
    const voucher = await submitViaProcedure(1_000_000);
    expect(voucher).toMatchObject({ status: 'PENDING', approvalMode: 'PROCEDURE' });
    expect(voucher.procedure).toMatchObject({ syncStatus: 'RUNNING', instanceCode: expect.stringMatching(/^QT-/), currentAssigneeName: 'Kế toán trưởng' });

    const link = await linkOf(voucher.id);
    const instance = pe.instances.get(String(link['instance_id'])) as FakeInstance;
    expect(instance.body).toMatchObject({
      sourceType: 'finance_voucher',
      sourceId: link['id'],
      definitionId: DEF_ID,
      autoCompleteInitiatorStep: true,
      initiatedBy: accountant.userId,
      title: expect.stringContaining(voucher.code),
      attributeValues: { 'process:so_tien': { type: 'money', value: 1_000_000 }, 'process:noi_dung': { type: 'text', value: 'Chi văn phòng phẩm' } },
    });

    await rejects(app.approve(chief, voucher.id), 'FINANCE_PROCEDURE_MANAGED');
    await rejects(app.reject(chief, voucher.id, 'x'), 'FINANCE_PROCEDURE_MANAGED');
    expect(await balance()).toBe(before);
  });

  it('phiếu đang chờ duyệt theo quy trình: không tự sửa hay xoá được ở đây (phải Huỷ rồi lập lại)', async () => {
    const voucher = await submitViaProcedure(400_000);
    expect(voucher.permissions).toMatchObject({ canEdit: false, canDelete: false });
    await rejects(app.updateVoucher(accountant, voucher.id, payment(450_000, { revision: voucher.revision })), 'FINANCE_VOUCHER_LOCKED');
    await rejects(app.deleteVoucher(accountant, voucher.id), 'FINANCE_VOUCHER_LOCKED');
    await app.cancel(accountant, session, voucher.id, 'Đổi sang lập lại');
  });

  it('kết quả "đã duyệt" từ sự kiện ghi sổ đúng một lần, kể cả khi sự kiện bị giao lặp', async () => {
    const before = (await balance())!;
    const voucher = await submitViaProcedure(2_000_000);
    const link = await linkOf(voucher.id);
    const done = completed(link, 'completed', chief.userId);
    expect(await receiveFinanceProcedureEvent(pool, tenantId, done)).toBe('applied');
    expect(await receiveFinanceProcedureEvent(pool, tenantId, done)).toBe('ignored'); // cùng mã sự kiện
    expect(await receiveFinanceProcedureEvent(pool, tenantId, completed(link))).toBe('ignored'); // sự kiện khác mã nhưng lần gửi đã áp
    const after = await app.voucher(chief, voucher.id);
    expect(after).toMatchObject({ status: 'APPROVED', posted: true, decidedBy: chief.userId, decisionNote: expect.stringContaining('Theo quy trình') });
    expect(after.procedure?.syncStatus).toBe('APPLIED');
    expect(await balance()).toBe(before - 2_000_000);
    expect(after.events.map((e) => e.action)).toEqual(['CREATED', 'SUBMITTED', 'APPROVED']);
  });

  it('sự kiện sai tenant, sai nguồn hoặc sai người phát bị bỏ qua; sự kiện hỏng bị từ chối', async () => {
    const voucher = await submitViaProcedure(100_000);
    const link = await linkOf(voucher.id);
    expect(await receiveFinanceProcedureEvent(pool, tenantId, { ...completed(link), tenantId: randomUUID() })).toBe('ignored');
    expect(await receiveFinanceProcedureEvent(pool, tenantId, { ...completed(link), source: 'hrm' })).toBe('ignored');
    expect(await receiveFinanceProcedureEvent(pool, tenantId, event('procedure.instance.completed', { sourceType: 'hrm_request', sourceId: link['id'], status: 'completed' }))).toBe('ignored');
    await expect(receiveFinanceProcedureEvent(pool, tenantId, event('procedure.instance.completed', { sourceType: 'finance_voucher', sourceId: 'khong-phai-uuid', status: 'completed' }))).rejects.toThrow();
    expect((await app.voucher(chief, voucher.id)).status).toBe('PENDING');
    await receiveFinanceProcedureEvent(pool, tenantId, completed(link, 'cancelled'));
  });

  it('người được Procedure giao bước duyệt trong Tài chính: Procedure quyết định; kết thúc thì ghi sổ ngay với tên người duyệt', async () => {
    const before = (await balance())!;
    const voucher = await submitViaProcedure(500_000);
    expect(voucher.permissions).toMatchObject({ canApprove: true, canReject: true });
    pe.canAct = false;
    expect((await app.voucher(chief, voucher.id)).permissions).toMatchObject({ canApprove: false, canReject: false });
    await rejects(app.procedureAction(chief, session, voucher.id, { action: 'approve', idempotencyKey: 'k1' }), 'FINANCE_PROCEDURE_ACTION_FAILED');
    pe.canAct = true;
    await rejects(app.procedureAction(chief, session, voucher.id, { action: 'reject', idempotencyKey: 'k2' }), 'FINANCE_INVALID'); // thiếu lý do
    const approved = await app.procedureAction(chief, session, voucher.id, { action: 'approve', comment: 'OK', idempotencyKey: 'k3' });
    expect(approved).toMatchObject({ status: 'APPROVED', decidedByName: 'Kế toán trưởng' });
    expect(pe.actions.at(-1)).toMatchObject({ action: 'approve', comment: 'OK' });
    expect(await balance()).toBe(before - 500_000);
    // Sự kiện đến muộn sau khi đã áp trực tiếp: bỏ qua, không ghi sổ lần hai.
    const link = await linkOf(voucher.id);
    expect(await receiveFinanceProcedureEvent(pool, tenantId, completed(link))).toBe('ignored');
    expect(await balance()).toBe(before - 500_000);
  });

  it('quy trình từ chối thì phiếu về "Từ chối"; sửa phiếu gửi duyệt lại ngay, tạo hồ sơ mới, sự kiện muộn của lần cũ bị bỏ qua', async () => {
    const voucher = await submitViaProcedure(300_000);
    const first = await linkOf(voucher.id);
    await receiveFinanceProcedureEvent(pool, tenantId, completed(first, 'rejected'));
    const rejected = await app.voucher(accountant, voucher.id);
    expect(rejected).toMatchObject({ status: 'REJECTED', decisionNote: expect.stringContaining('bị từ chối') });
    expect(rejected.permissions.canEdit).toBe(true);

    // Sửa xong là gửi duyệt lại ngay (không còn bước Gửi duyệt riêng): phiếu về PENDING, hồ sơ quy trình mới được tạo.
    const resubmitted = await app.updateVoucher(accountant, voucher.id, payment(350_000, { revision: rejected.revision }));
    expect(resubmitted).toMatchObject({ status: 'PENDING', approvalMode: 'PROCEDURE', totalAmount: 350_000 });
    const second = await linkOf(voucher.id);
    expect(second['id']).not.toBe(first['id']);
    expect(Number(second['revision'])).toBeGreaterThan(Number(first['revision']));
    expect(resubmitted.procedure?.syncStatus).toBe('RUNNING');
    expect(pe.instances.get(String(second['instance_id']))?.body).toMatchObject({ attributeValues: { 'process:so_tien': { value: 350_000 } } });

    // Sự kiện "đã duyệt" muộn của lần gửi cũ không được ghi sổ phiếu đang chạy lần mới.
    expect(await receiveFinanceProcedureEvent(pool, tenantId, completed(first, 'completed'))).toBe('ignored');
    expect((await app.voucher(chief, voucher.id)).status).toBe('PENDING');
    await app.procedureAction(chief, session, voucher.id, { action: 'approve', idempotencyKey: 'again' });
  });

  it('quy trình đã duyệt nhưng không đủ số dư: phiếu giữ chờ duyệt kèm lý do, nạp tiền rồi áp lại được', async () => {
    const need = ((await balance()) as number) + 1_000_000;
    const voucher = await submitViaProcedure(need);
    const link = await linkOf(voucher.id);
    expect(await receiveFinanceProcedureEvent(pool, tenantId, completed(link, 'completed', chief.userId))).toBe('conflict');
    const stuck = await app.voucher(chief, voucher.id);
    expect(stuck).toMatchObject({ status: 'PENDING', posted: false });
    expect(stuck.procedure).toMatchObject({ syncStatus: 'CONFLICT', lastError: expect.stringContaining('không đủ') });
    expect(stuck.permissions.canRetryProcedure).toBe(true);
    // Số dư không đổi và không có dòng sổ cái dở dang.
    expect((await pool.query(`SELECT count(*)::int AS n FROM finance_schema.ledger_entries WHERE voucher_id=$1`, [voucher.id])).rows[0].n).toBe(0);
    // Người không phải chủ phiếu/người duyệt không bấm được.
    await rejects(app.retryProcedure(actor('Người ngoài', ['finance.read']), voucher.id), 'FINANCE_FORBIDDEN');

    // Chưa nạp tiền: áp lại vẫn kẹt.
    expect((await app.retryProcedure(chief, voucher.id)).procedure?.syncStatus).toBe('CONFLICT');
    // Thu tiền vào tài khoản rồi áp lại.
    const receipt = await app.createVoucher(accountant, { kind: 'RECEIPT', voucherDate: today, postingDate: today, content: 'Nạp quỹ', reasonId: (await app.saveReason(manager, null, { kind: 'RECEIPT', code: 'NAP', name: 'Nạp quỹ' })).id, accountId, counterpartyGroupId: groupId, lines: [{ description: 'Nạp', quantity: 1, unitAmount: 5_000_000, total: 5_000_000 }] });
    await app.submit(accountant, receipt.id);
    await app.approve(chief, receipt.id);
    const fixed = await app.retryProcedure(chief, voucher.id);
    expect(fixed).toMatchObject({ status: 'APPROVED', posted: true });
    expect(fixed.procedure?.syncStatus).toBe('APPLIED');
  });

  it('huỷ phiếu đang chạy quy trình: huỷ hồ sơ bên Procedure, đóng lần gửi; kết quả muộn không áp lại', async () => {
    const before = (await balance())!;
    const voucher = await submitViaProcedure(400_000);
    const link = await linkOf(voucher.id);
    const cancelled = await app.cancel(accountant, session, voucher.id, 'Nhập sai');
    expect(cancelled.status).toBe('CANCELLED');
    expect(pe.actions.at(-1)).toMatchObject({ instanceId: link['instance_id'], action: 'cancel' });
    expect((await linkOf(voucher.id))['sync_status']).toBe('CLOSED');
    expect(await receiveFinanceProcedureEvent(pool, tenantId, completed(link, 'completed'))).toBe('ignored');
    expect(await balance()).toBe(before);
  });

  it('Procedure lỗi lúc tạo hồ sơ: lần gửi vẫn được giữ, tiến trình nền thử lại và tạo đúng một hồ sơ', async () => {
    pe.failStart = true;
    const voucher = await submitViaProcedure(120_000);
    expect(voucher).toMatchObject({ status: 'PENDING' });
    expect(voucher.procedure).toMatchObject({ syncStatus: 'FAILED', instanceId: null, lastError: expect.stringContaining('Hệ thống bận') });
    expect(voucher.permissions.canRetryProcedure).toBe(true);
    const count = pe.instances.size;

    pe.failStart = false;
    const sync = await processFinanceProcedureSync(pool, tenantId);
    expect(sync.started).toBeGreaterThanOrEqual(1);
    const after = await app.voucher(accountant, voucher.id);
    expect(after.procedure).toMatchObject({ syncStatus: 'RUNNING', instanceId: expect.any(String) });
    expect(pe.instances.size).toBe(count + 1);
    // Chạy tiếp không tạo thêm hồ sơ.
    await processFinanceProcedureSync(pool, tenantId);
    expect(pe.instances.size).toBe(count + 1);
    await app.cancel(accountant, session, voucher.id, 'dọn');
  });

  it('sự kiện bị mất: tiến trình nền đối soát hồ sơ đang chạy và áp kết quả', async () => {
    const before = (await balance())!;
    const voucher = await submitViaProcedure(210_000);
    const link = await linkOf(voucher.id);
    (pe.instances.get(String(link['instance_id'])) as FakeInstance).status = 'completed';
    // Chưa đủ 2 phút: chưa đối soát.
    expect((await processFinanceProcedureSync(pool, tenantId)).reconciled).toBe(0);
    await pool.query(`UPDATE finance_schema.procedure_links SET updated_at = now() - interval '5 minutes' WHERE id=$1`, [link['id']]);
    expect((await processFinanceProcedureSync(pool, tenantId)).reconciled).toBe(1);
    expect((await app.voucher(chief, voucher.id)).status).toBe('APPROVED');
    expect(await balance()).toBe(before - 210_000);
  });

  it('quy trình chỉ có bước của người lập: hồ sơ tự hoàn thành ngay và phiếu được ghi sổ ngay khi gửi', async () => {
    pe.definition = definitionWith([attribute('so_tien', 'money', true), attribute('noi_dung', 'text', false)], 1);
    const before = (await balance())!;
    const voucher = await submitViaProcedure(90_000);
    expect(voucher).toMatchObject({ status: 'APPROVED', posted: true });
    expect(await balance()).toBe(before - 90_000);
    pe.definition = definitionWith([attribute('so_tien', 'money', true), attribute('noi_dung', 'text', false)]);
  });

  it('hồ sơ bị huỷ hiệu lực: phiếu đã ghi sổ thì chặn; phiếu chưa ghi sổ thì huỷ theo', async () => {
    const posted = await submitViaProcedure(60_000);
    const postedLink = await linkOf(posted.id);
    await receiveFinanceProcedureEvent(pool, tenantId, completed(postedLink, 'completed', chief.userId));
    const check = await app.procedureReversalCheck(tenantId, String(postedLink['id']));
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('Huỷ phiếu đã ghi sổ');
    // Sau khi đảo sổ bằng chức năng của Tài chính thì được phép huỷ hiệu lực hồ sơ.
    await app.reverse(chief, posted.id, 'Chi nhầm');
    expect((await app.procedureReversalCheck(tenantId, String(postedLink['id']))).allowed).toBe(true);

    // Phiếu kẹt (chưa ghi sổ): huỷ hiệu lực hồ sơ thì phiếu bị huỷ theo.
    const need = ((await balance()) as number) + 5_000_000;
    const stuck = await submitViaProcedure(need);
    const stuckLink = await linkOf(stuck.id);
    await receiveFinanceProcedureEvent(pool, tenantId, completed(stuckLink, 'completed', chief.userId));
    expect((await app.procedureReversalCheck(tenantId, String(stuckLink['id']))).allowed).toBe(true);
    await receiveFinanceProcedureEvent(pool, tenantId, event('procedure.instance.reversed', { instanceId: stuckLink['instance_id'], sourceType: 'finance_voucher', sourceId: stuckLink['id'], reason: 'Sai quy trình' }));
    const cancelled = await app.voucher(chief, stuck.id);
    expect(cancelled).toMatchObject({ status: 'CANCELLED', decisionNote: expect.stringContaining('huỷ hiệu lực') });
  });

  it('thông báo khi qua quy trình: gửi duyệt KHÔNG tự phát thông báo duyệt (Procedure báo người được giao); kẹt ghi sổ báo người lập và người duyệt đúng một lần', async () => {
    const events = async (voucherId: string) =>
      (
        await pool.query(`SELECT event_type, payload->'payload' AS p FROM integration_schema.outbox_events WHERE payload->'payload'->>'voucherId'=$1 ORDER BY occurred_at, id`, [voucherId])
      ).rows as { event_type: string; p: Record<string, unknown> }[];

    const need = ((await balance()) as number) + 9_000_000;
    const voucher = await submitViaProcedure(need);
    expect((await events(voucher.id)).map((e) => e.event_type)).toEqual([]); // không có finance.approval.requested

    const link = await linkOf(voucher.id);
    expect(await receiveFinanceProcedureEvent(pool, tenantId, completed(link, 'completed', chief.userId))).toBe('conflict');
    const names = async () => (await events(voucher.id)).map((e) => e.event_type).sort();
    const attention = await names();
    expect(attention).toEqual(['finance.voucher.needs-attention', 'finance.voucher.needs-attention-approvers']);
    const all = await events(voucher.id);
    const toRequester = all.find((e) => e.event_type === 'finance.voucher.needs-attention') as (typeof all)[number];
    const toApprovers = all.find((e) => e.event_type === 'finance.voucher.needs-attention-approvers') as (typeof all)[number];
    expect(toRequester.p).toMatchObject({ recipientUserIds: [accountant.userId], deepLink: `/modules/finance/payments/${voucher.id}` });
    expect(String(toRequester.p['summary'])).toContain('chưa ghi sổ được');
    expect(toApprovers.p['approvalPermissions']).toEqual(['finance.payment.approve', 'finance.manage']);

    // Áp lại vẫn kẹt: không báo lặp.
    await app.retryProcedure(chief, voucher.id);
    await app.retryProcedure(chief, voucher.id);
    expect(await names()).toEqual(attention);
    await app.cancel(accountant, session, voucher.id, 'dọn');
  });

  it('quy trình duyệt xong và ghi sổ: báo người lập kết quả (người duyệt được ghi nhận là người thao tác)', async () => {
    const voucher = await submitViaProcedure(11_000);
    const link = await linkOf(voucher.id);
    await receiveFinanceProcedureEvent(pool, tenantId, completed(link, 'completed', chief.userId));
    const rows = (
      await pool.query(`SELECT payload->'payload' AS p FROM integration_schema.outbox_events WHERE event_type='finance.voucher.status-changed' AND payload->'payload'->>'voucherId'=$1`, [voucher.id])
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].p).toMatchObject({ status: 'APPROVED', requesterUserId: accountant.userId, actorUserId: chief.userId });
    expect(String(rows[0].p.summary)).toContain('Theo quy trình');
  });

  it('từ hồ sơ quy trình tìm về phiếu; người không xem được phiếu nhận không tìm thấy', async () => {
    const voucher = await submitViaProcedure(33_000);
    const link = await linkOf(voucher.id);
    expect(await app.voucherOfProcedureLink(chief, String(link['id']))).toEqual({ id: voucher.id, kind: 'PAYMENT' });
    await rejects(app.voucherOfProcedureLink(actor('Người ngoài', ['finance.receipt.create']), String(link['id'])), 'FINANCE_NOT_FOUND');
    await rejects(app.voucherOfProcedureLink(chief, randomUUID()), 'FINANCE_NOT_FOUND');
    await app.cancel(accountant, session, voucher.id, 'dọn');
  });

  it('gửi duyệt khi Procedure sập: dừng và báo rõ, phiếu vẫn là nháp (không âm thầm duyệt trực tiếp)', async () => {
    const draft = await app.createVoucher(accountant, payment(15_000));
    pe.available = false;
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 0));
    // Bộ nhớ đệm tình trạng 10 giây: dùng ứng dụng mới để không đọc kết quả cũ.
    const fresh = new FinanceApplication(new TestFinanceDatabase(pool), new FakeFinanceStorage());
    await rejects(fresh.submit(accountant, draft.id), 'FINANCE_PROCEDURE_UNAVAILABLE');
    pe.available = true;
    expect((await app.voucher(accountant, draft.id)).status).toBe('DRAFT');
  });

  it('loại phiếu khác vẫn duyệt trực tiếp khi chỉ loại phiếu chi gán quy trình', async () => {
    const receipt = await app.createVoucher(accountant, {
      kind: 'RECEIPT',
      voucherDate: today,
      postingDate: today,
      content: 'Thu trực tiếp',
      reasonId: (await app.catalogs(manager, false)).reasons.find((r) => r.kind === 'RECEIPT')?.id,
      accountId,
      counterpartyGroupId: groupId,
      lines: [{ description: 'Thu', quantity: 1, unitAmount: 1000, total: 1000 }],
    });
    const submitted = await app.submit(accountant, receipt.id);
    expect(submitted).toMatchObject({ status: 'PENDING', approvalMode: 'DIRECT', procedure: null });
    expect((await app.approve(chief, receipt.id)).status).toBe('APPROVED');
  });
});
