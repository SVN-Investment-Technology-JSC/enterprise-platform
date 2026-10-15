import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import { TENANT_CORE_MIGRATIONS, tenantModuleMigrations } from '@enterprise-platform/platform-entitlement';
import type {
  CreateProcedureDefinitionRequest,
  CreateProcedureStepInput,
  ProcedureDefinition,
  ProcedureInstance,
} from '@enterprise-platform/contracts-procedure-engine';
import {
  FinanceApplication,
  isFinanceProcedureEvent,
  receiveFinanceProcedureEvent,
  type FinanceActor,
} from '@enterprise-platform/module-finance';
import {
  PostgresProcedureStore,
  ProcedureEngineApplication,
  ProcedureFinanceEvents,
  type InitiatorActorResolver,
  type ProcedureActor,
} from '@enterprise-platform/module-procedure-engine';
import type { Pool, PoolClient } from 'pg';

/**
 * Tài chính + Quy trình chạy thật trên CÙNG một DB tenant tạm (như production: mỗi module một schema), nối với nhau
 * đúng như worker: đọc outbox của tenant rồi giao từng sự kiện cho consumer của module kia. Chỉ phần HTTP nội bộ
 * (can-act, reversal-check, capabilities, Workspace) được nối thẳng vào application của bên kia thay vì qua mạng.
 */
const integration = process.env.FINANCE_TEST_ADMIN_URL ? describe : describe.skip;

const PE = 'http://pe.test/api/procedure';
const WS = 'http://ws.test/api/workspace';
const ROOT = resolve(__dirname, '../../..');

type VoucherInput = Parameters<FinanceApplication['updateVoucher']>[2];

integration('Tài chính ↔ Quy trình: bước Tài chính chạy xuyên module (PostgreSQL)', () => {
  const databaseName = 'finance_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const ACCOUNTANT_POSITION = randomUUID();
  const PROJECT = { id: randomUUID(), code: 'DA001', name: 'Dự án A', status: 'active' };
  const originalFetch = global.fetch;
  let admin: Pool;
  let pool: Pool;
  let finance: FinanceApplication;
  let procedure: ProcedureEngineApplication;
  let financeEvents: ProcedureFinanceEvents;
  let accountId: string;
  let reasonId: string;
  let groupId: string;

  // ---- Người dùng: cùng một userId ở cả hai module ----
  const people = new Map<string, ProcedureActor>();
  const person = (name: string, extra: Partial<ProcedureActor> = {}): ProcedureActor => {
    const userId = randomUUID();
    const actor: ProcedureActor = {
      tenantId,
      userId,
      membershipId: userId,
      displayName: name,
      canDesign: false,
      canPublish: false,
      canCreateInstances: true,
      isOverride: false,
      organizationUnitIds: [],
      positionIds: [],
      ...extra,
    };
    people.set(userId, actor);
    return actor;
  };
  const designer = person('Quản trị quy trình', { canDesign: true, canPublish: true, isOverride: true });
  const requester = person('Người đề nghị');
  const manager = person('Trưởng phòng');
  const accountantA = person('Kế toán A', { positionIds: [ACCOUNTANT_POSITION] });
  const accountantB = person('Kế toán B', { positionIds: [ACCOUNTANT_POSITION] });
  const outsider = person('Kế toán ngoài bước');

  const financeActor = (actor: ProcedureActor, permissions: string[]): FinanceActor => ({
    tenantId,
    userId: actor.userId,
    displayName: actor.displayName,
    permissions,
  });
  const financeManager = financeActor(designer, ['finance.manage']);
  const cashierA = financeActor(accountantA, ['finance.payment.approve']);
  const cashierB = financeActor(accountantB, ['finance.payment.approve']);
  const cashierOutside = financeActor(outsider, ['finance.payment.approve']);

  /** Sơ đồ tổ chức giả: Quy trình đọc chức danh hiện tại của người được hỏi. */
  const organization: InitiatorActorResolver = { resolve: async (_tenant, userId) => people.get(userId) ?? null };

  // ---- HTTP nội bộ: Tài chính hỏi Quy trình (can-act) và Workspace (dự án) ----
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fakeFetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(PE)) {
      const canAct = /^\/v1\/internal\/instances\/([^/]+)\/steps\/([^/]+)\/can-act$/.exec(url.slice(PE.length));
      if (canAct && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { userId: string; activation: number };
        return json(await procedure.canActOnFinanceStepForService(tenantId, canAct[1], canAct[2], body));
      }
      return json({}, 404);
    }
    if (url.startsWith(WS)) {
      if (url.slice(WS.length) === `/v1/internal/projects/${PROJECT.id}`) return json(PROJECT);
      return json({}, 404);
    }
    return originalFetch(input as string, init);
  });

  // ---- Relay outbox → consumer, như worker ----
  async function relay(): Promise<void> {
    for (let round = 0; round < 20; round += 1) {
      const rows = (
        await pool.query(
          `UPDATE integration_schema.outbox_events SET published_at = now() WHERE published_at IS NULL RETURNING payload, occurred_at`,
        )
      ).rows as { payload: IntegrationEventEnvelope; occurred_at: Date }[];
      if (!rows.length) return;
      rows.sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
      for (const { payload: envelope } of rows) {
        if (isFinanceProcedureEvent(envelope)) await receiveFinanceProcedureEvent(pool, tenantId, envelope);
        else if (envelope.type.startsWith('finance.voucher.')) await financeEvents.handle(tenantId, envelope.type, envelope.payload);
      }
    }
    throw new Error('Outbox không dừng sau 20 lượt relay.');
  }

  // ---- Định nghĩa: Lập đề nghị → Trưởng phòng duyệt → Chi tiền (bước Tài chính, giao cho chức danh Kế toán) ----
  const step = (key: string, order: number, name: string, assignments: CreateProcedureStepInput['assignments'], extra: Partial<CreateProcedureStepInput> = {}) =>
    ({ key, order, name, assignments, ...extra }) as CreateProcedureStepInput;
  const definitionInput = (): CreateProcedureDefinitionRequest => ({
    code: 'DE-NGHI-TT',
    name: 'Đề nghị thanh toán',
    kind: 'process',
    category: 'finance',
    attributes: [{ id: '', code: 'so_tien', name: 'Số tiền đề nghị', type: 'money', required: true }],
    steps: [
      step('DE_NGHI', 1, 'Lập đề nghị', [{ role: 'S', subjectType: 'user', subjectId: requester.userId, subjectLabel: requester.displayName }], {
        attributes: [
          { id: '', code: 'nguoi_nop_nhan', name: 'Người nhận', type: 'text', required: false },
          { id: '', code: 'noi_dung', name: 'Nội dung', type: 'text', required: false },
        ],
      }),
      step('DUYET', 2, 'Trưởng phòng duyệt', [{ role: 'A', subjectType: 'user', subjectId: manager.userId, subjectLabel: manager.displayName }]),
      step('CHI_TIEN', 3, 'Chi tiền', [{ role: 'R', subjectType: 'position', subjectId: ACCOUNTANT_POSITION, subjectLabel: 'Kế toán thanh toán' }], {
        integration: { module: 'finance', action: 'voucher', voucherKind: 'PAYMENT', returnToStepId: 'DE_NGHI' },
      }),
    ],
  });
  let definition: ProcedureDefinition;
  const stepId = (key: string) => definition.steps.find((item) => item.key === key)?.id ?? '';
  const current = (instance: ProcedureInstance) => instance.steps.find((item) => item.id === instance.currentStepId);

  /** Mở hồ sơ, nhập số tiền, trưởng phòng duyệt, relay → Tài chính đã tạo phiếu. */
  async function requestPayment(amount: number, options: { project?: boolean } = {}) {
    const started = await procedure.startInstance(requester, {
      definitionId: definition.id,
      title: 'Thanh toán tiền điện tháng 10',
      idempotencyKey: randomUUID(),
      ...(options.project ? { workspaceLink: { projectId: PROJECT.id, projectCode: PROJECT.code } } : {}),
    });
    await procedure.applyAction(requester, started.id, {
      action: 'complete',
      idempotencyKey: randomUUID(),
      attributeValues: {
        'process:so_tien': { type: 'money', value: amount },
        [`step:${stepId('DE_NGHI')}:nguoi_nop_nhan`]: { type: 'text', value: 'Công ty Điện lực' },
        [`step:${stepId('DE_NGHI')}:noi_dung`]: { type: 'text', value: 'Tiền điện tháng 10' },
      },
    });
    await procedure.applyAction(manager, started.id, { action: 'approve', idempotencyKey: randomUUID() });
    await relay();
    const voucherId = String(
      (await pool.query(`SELECT voucher_id FROM finance_schema.voucher_sources WHERE instance_id=$1`, [started.id])).rows[0]?.voucher_id ?? '',
    );
    return { instanceId: started.id, voucherId };
  }

  const instance = (id: string) => procedure.getInstance(designer, id);
  const today = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  const accountantInput = (over: Partial<VoucherInput> = {}): VoucherInput =>
    ({
      kind: 'PAYMENT',
      voucherDate: today(),
      postingDate: today(),
      content: 'Client cố sửa nội dung',
      reasonId,
      accountId,
      counterpartyGroupId: groupId,
      lines: [{ description: 'Client cố sửa dòng', quantity: 1, unitAmount: 1, total: 1 }],
      ...over,
    }) as VoucherInput;
  const balance = async () => Number((await finance.account(financeManager, accountId)).balance);
  const errorCode = (promise: Promise<unknown>) => promise.then(() => 'ok', (error: { code?: string }) => error.code ?? String(error));

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
    pool = createPostgresPool(url.toString());
    // Đúng thứ tự như migrator: integration, core (Quy trình đọc sơ đồ tổ chức của core), rồi từng module.
    await pool.query(await readFile(resolve(ROOT, 'migrations/tenant/0001-integration.sql'), 'utf8'));
    for (const migration of [...TENANT_CORE_MIGRATIONS, ...tenantModuleMigrations('procedure-engine'), ...tenantModuleMigrations('finance')])
      await pool.query(await readFile(resolve(ROOT, 'migrations', migration.path), 'utf8'));

    const database = {
      pool: async () => pool,
      transaction: async <T>(_tenant: string, work: (client: PoolClient) => Promise<T>): Promise<T> => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await work(client);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
    };
    const storage = {
      createUploadUrl: async () => 'https://storage.test/upload',
      createDownloadUrl: async () => 'https://storage.test/download',
      objectMetadata: async () => ({ sizeBytes: 1, contentType: 'application/pdf' }),
    };
    finance = new FinanceApplication(database as never, storage);

    const store = new PostgresProcedureStore({ require: () => ({ tenantId }) } as never, { forTenant: async () => pool } as never);
    procedure = new ProcedureEngineApplication(
      store,
      { now: () => new Date() },
      { next: () => randomUUID() },
      undefined,
      undefined,
      undefined,
      organization,
      {
        check: async () => ({ allowed: false, reason: 'Không có nguồn khác trong test.' }),
        checkFinanceStep: (tenant, instanceId) => finance.instanceReversalCheck(tenant, instanceId),
      },
      { capabilities: async () => finance.integrationCapabilities() },
    );
    financeEvents = new ProcedureFinanceEvents(procedure);

    accountId = (
      await finance.saveAccount(financeManager, null, {
        code: 'VCB',
        name: 'Vietcombank',
        accountType: 'BANK',
        bankName: 'VCB',
        accountNumber: '0011',
        openingBalance: 100_000_000,
        openingDate: '2026-01-01',
      })
    ).id;
    reasonId = (await finance.saveReason(financeManager, null, { kind: 'PAYMENT', code: 'TT', name: 'Thanh toán nhà cung cấp' })).id;
    groupId = (await finance.catalogs(financeManager, false)).counterpartyGroups[0].id;

    const draft = await procedure.createDefinition(designer, definitionInput());
    definition = await procedure.publishDefinition(designer, draft.id);
  }, 120_000);

  afterAll(async () => {
    global.fetch = originalFetch;
    if (!/^finance_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Invalid test database');
    // pool.end() resolve trước khi socket đóng hẳn: chờ đủ 'remove' rồi mới DROP ... FORCE (xem dropTestDatabase của module-finance).
    if (pool) {
      pool.on('error', () => undefined);
      let pending = pool.totalCount;
      const closed = new Promise<void>((done) => (pending ? pool.on('remove', () => (pending -= 1) <= 0 && done()) : done()));
      await pool.end();
      await Promise.race([closed, new Promise((done) => setTimeout(done, 5_000).unref())]);
    }
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await admin.end();
    }
  }, 60_000);

  it('a) đề nghị gắn dự án: phiếu nháp khoá số tiền, hạch toán dự án; kế toán đúng chức danh ghi sổ; hồ sơ hoàn tất', async () => {
    const { instanceId, voucherId } = await requestPayment(12_500_000, { project: true });
    expect(voucherId).not.toBe('');
    expect(current(await instance(instanceId))?.financeVoucher).toMatchObject({ state: 'linked', voucherId, amount: 12_500_000 });

    const draft = await finance.voucher(cashierA, voucherId);
    expect(draft).toMatchObject({ status: 'DRAFT', approvalMode: 'INHERITED', totalAmount: 12_500_000, code: expect.stringMatching(/^NHAP_PC_\d{4}_\d{4}$/) });
    expect(draft.allocation).toMatchObject({ type: 'PROJECT', projectId: PROJECT.id, projectCode: 'DA001' });
    expect(draft.source?.lockedFields).toEqual(expect.arrayContaining(['amount', 'allocation']));

    // Client cố sửa số tiền / dòng chi tiết: server giữ nguyên số liệu từ hồ sơ.
    const saved = await finance.updateVoucher(cashierA, voucherId, accountantInput());
    expect(saved.totalAmount).toBe(12_500_000);
    expect(saved.allocation?.projectId).toBe(PROJECT.id);

    const before = await balance();
    const posted = await finance.postSourced(cashierA, voucherId, {});
    expect(posted).toMatchObject({ status: 'APPROVED', code: expect.stringMatching(/^PC-\d{4}-\d{4}$/) });
    expect(await balance()).toBe(before - 12_500_000);

    await relay();
    const done = await instance(instanceId);
    expect(done.status).toBe('completed');
    expect(done.steps.find((item) => item.key === 'CHI_TIEN')?.financeVoucher).toMatchObject({ state: 'posted', code: posted.code, postedBy: accountantA.userId });
    expect(done.activity.find((item) => item.summary.includes(`Đã ghi sổ ${posted.code}`))).toMatchObject({ actorId: accountantA.userId });
    expect(done.activity.some((item) => item.summary.startsWith('Cảnh báo'))).toBe(false);
  });

  it('b) đề nghị không gắn dự án: phiếu không hạch toán, kế toán tự chọn dự án', async () => {
    const { voucherId } = await requestPayment(3_000_000);
    const draft = await finance.voucher(cashierA, voucherId);
    expect(draft.allocation).toBeNull();
    expect(draft.source?.lockedFields).not.toContain('allocation');

    const saved = await finance.updateVoucher(cashierA, voucherId, accountantInput({ allocation: { type: 'PROJECT', projectId: PROJECT.id } } as Partial<VoucherInput>));
    expect(saved.allocation).toMatchObject({ type: 'PROJECT', projectId: PROJECT.id });
    expect((await finance.postSourced(cashierA, voucherId, {})).status).toBe('APPROVED');
  });

  it('c) kế toán trả hồ sơ → người lập sửa số tiền → quay lại bước Tài chính → cùng phiếu được cập nhật → ghi sổ', async () => {
    const { instanceId, voucherId } = await requestPayment(8_000_000);
    const first = await finance.voucher(cashierA, voucherId);

    await finance.returnSourced(cashierA, voucherId, { reason: 'Thiếu hoá đơn' });
    await relay();
    const returned = await instance(instanceId);
    expect(current(returned)?.key).toBe('DE_NGHI');
    expect(returned.activity.find((item) => item.action === 'return' && item.actorId === accountantA.userId)?.comment).toBe('Thiếu hoá đơn');
    expect(await errorCode(finance.postSourced(cashierA, voucherId, {}))).not.toBe('ok');

    await procedure.applyAction(requester, instanceId, {
      action: 'complete',
      idempotencyKey: randomUUID(),
      attributeValues: { 'process:so_tien': { type: 'money', value: 7_500_000 } },
    });
    await procedure.applyAction(manager, instanceId, { action: 'approve', idempotencyKey: randomUUID() });
    await relay();

    const again = await finance.voucher(cashierA, voucherId);
    expect(again.id).toBe(first.id);
    expect(again.totalAmount).toBe(7_500_000);
    expect(again.revision).toBeGreaterThan(first.revision);
    expect(Number((await pool.query(`SELECT count(*) FROM finance_schema.voucher_sources WHERE instance_id=$1`, [instanceId])).rows[0].count)).toBe(1);
    expect(current(await instance(instanceId))?.financeVoucher).toMatchObject({ activation: 2, state: 'linked', voucherId });

    await finance.updateVoucher(cashierA, voucherId, accountantInput({ revision: again.revision } as Partial<VoucherInput>));
    expect((await finance.postSourced(cashierA, voucherId, {})).status).toBe('APPROVED');
    await relay();
    expect((await instance(instanceId)).status).toBe('completed');
  });

  it('d) hai kế toán cùng chức danh: chỉ một lần ghi sổ; người có quyền nhưng ngoài chức danh bị từ chối', async () => {
    const { instanceId, voucherId } = await requestPayment(1_000_000);
    expect(await errorCode(finance.updateVoucher(cashierOutside, voucherId, accountantInput()))).toBe('FINANCE_FORBIDDEN');
    expect(await errorCode(finance.postSourced(cashierOutside, voucherId, {}))).toBe('FINANCE_FORBIDDEN');

    await finance.updateVoucher(cashierA, voucherId, accountantInput());
    // B đang bị A giữ khoá mềm: phải nhận xử lý thay mới thao tác được.
    expect(await errorCode(finance.postSourced(cashierB, voucherId, {}))).toBe('FINANCE_SOURCE_HANDLED');
    await finance.takeOverSourced(cashierB, voucherId);

    const results = await Promise.allSettled([finance.postSourced(cashierA, voucherId, {}), finance.postSourced(cashierB, voucherId, {})]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const entries = await pool.query(`SELECT count(*) FROM finance_schema.ledger_entries WHERE voucher_id=$1 AND NOT is_reversal`, [voucherId]);
    expect(Number(entries.rows[0].count)).toBe(1);

    await relay();
    const done = await instance(instanceId);
    expect(done.status).toBe('completed');
    expect(done.activity.filter((item) => item.summary.includes('Đã ghi sổ'))).toHaveLength(1);
  });

  it('e) huỷ hiệu lực hồ sơ đã ghi sổ: kỳ khoá sổ thì bị chặn; mở khoá thì phiếu được đảo và ĐÃ HUỶ', async () => {
    const { instanceId, voucherId } = await requestPayment(2_000_000);
    await finance.updateVoucher(cashierA, voucherId, accountantInput());
    await finance.postSourced(cashierA, voucherId, {});
    await relay();
    expect((await instance(instanceId)).status).toBe('completed');

    // Tài chính không đảo trực tiếp phiếu có nguồn.
    expect(await errorCode(finance.reverse(cashierA, voucherId, 'Thử đảo tay'))).not.toBe('ok');

    const lockBooks = (until: string | null) =>
      pool.query(
        `INSERT INTO finance_schema.settings (tenant_id, books_locked_until) VALUES ($1,$2)
         ON CONFLICT (tenant_id) DO UPDATE SET books_locked_until=EXCLUDED.books_locked_until`,
        [tenantId, until],
      );
    await lockBooks(today());
    try {
      await expect(procedure.reverseInstance(designer, instanceId, { reason: 'Nhập sai', createAdjustment: false })).rejects.toThrow(/khoá/);
      expect((await instance(instanceId)).status).toBe('completed');
    } finally {
      await lockBooks(null);
    }

    const before = await balance();
    await procedure.reverseInstance(designer, instanceId, { reason: 'Nhập sai', createAdjustment: false });
    await relay();
    expect((await instance(instanceId)).status).toBe('reversed');
    const voucher = await finance.voucher(cashierA, voucherId);
    expect(voucher.status).toBe('CANCELLED');
    expect(voucher.source?.status).toBe('CLOSED');
    expect(await balance()).toBe(before + 2_000_000);
  });
});
