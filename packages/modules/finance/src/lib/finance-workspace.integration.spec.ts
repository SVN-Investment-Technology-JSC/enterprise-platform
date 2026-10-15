import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import type { SaveFinanceVoucherRequest } from '@enterprise-platform/contracts-finance';
import type { Pool } from 'pg';
import { FinanceApplication } from './application/finance.application.js';
import type { FinanceActor } from './domain/finance.access.js';
import { FakeFinanceStorage, TestFinanceDatabase, dropTestDatabase } from './finance-test-support.js';
import { todayVn } from './infrastructure/finance.database.js';

const integration = process.env.FINANCE_TEST_ADMIN_URL ? describe : describe.skip;

const BASE = 'http://ws.test/api/workspace';

integration('Tài chính: hạch toán cho dự án/công việc và dự án liên quan (PostgreSQL, Workspace giả lập)', () => {
  const databaseName = 'finance_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const today = todayVn();
  let admin: ReturnType<typeof createPostgresPool>;
  let pool: Pool;
  let app: FinanceApplication;
  const originalFetch = global.fetch;

  const actor = (name: string, permissions: string[]): FinanceActor => ({ tenantId, userId: randomUUID(), displayName: name, permissions });
  const accountant = actor('Kế toán viên', ['finance.receipt.create', 'finance.payment.create', 'finance.transfer.create']);
  const chief = actor('Kế toán trưởng', ['finance.receipt.approve', 'finance.payment.approve', 'finance.read', 'finance.report.read']);
  const manager = actor('Quản trị tài chính', ['finance.manage']);
  const stranger = actor('Nhân viên lập phiếu', ['finance.payment.create']);
  const session = { cookie: 'ep_access=abc' };

  // ---- Workspace giả lập ----
  const P1 = { id: randomUUID(), code: 'DA001', name: 'Trạm biến áp Đà Nẵng', status: 'active' };
  const P2 = { id: randomUUID(), code: 'DA002', name: 'Đường dây 110kV', status: 'planning' };
  const P3 = { id: randomUUID(), code: 'DA003', name: 'Cải tạo lưới điện', status: 'active' };
  const PX = { id: randomUUID(), code: 'DA999', name: 'Dự án đã huỷ', status: 'cancelled' };
  const W1 = { id: randomUUID(), code: 'CV-1', title: 'Lắp đặt tủ điện', status: 'in_progress', project: { id: P1.id } };
  const W2 = { id: randomUUID(), code: 'CV-2', title: 'Việc của dự án 2', status: 'todo', project: { id: P2.id } };
  const WX = { id: randomUUID(), code: 'CV-3', title: 'Việc đã huỷ', status: 'cancelled', project: { id: P1.id } };
  const ws = {
    available: true,
    /** Người xem được tài chính dự án (theo quy tắc của Workspace). */
    financeAllowed: new Set<string>(),
    calls: [] as string[],
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fakeFetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith(BASE)) return originalFetch(input as string, init);
    if (!ws.available) throw new Error('connect ECONNREFUSED');
    const path = url.slice(BASE.length);
    ws.calls.push(path);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const projects = [P1, P2, P3, PX];
    if (path.startsWith('/v1/internal/') && headers['x-service-token'] !== 'test-token') return json({}, 401);
    if (path.startsWith('/v1/internal/projects?') || path === '/v1/internal/projects') {
      const search = new URL(url).searchParams.get('search')?.toLowerCase() ?? '';
      const items = projects.filter((p) => p.status !== 'cancelled' && `${p.code} ${p.name}`.toLowerCase().includes(search));
      return json({ items, truncated: false });
    }
    const itemsOf = /^\/v1\/internal\/projects\/([^/]+)\/work-items$/.exec(path);
    if (itemsOf) {
      const project = projects.find((p) => p.id === itemsOf[1]);
      if (!project) return json({}, 404);
      return json({ items: [W1, W2, WX].filter((w) => w.project.id === project.id && w.status !== 'cancelled').map((w) => ({ id: w.id, code: w.code, title: w.title, status: w.status, depth: 0 })) });
    }
    const projectOf = /^\/v1\/internal\/projects\/([^/]+)$/.exec(path);
    if (projectOf) {
      const project = projects.find((p) => p.id === projectOf[1]);
      return project ? json(project) : json({}, 404);
    }
    const itemOf = /^\/v1\/internal\/work-items\/([^/]+)$/.exec(path);
    if (itemOf) {
      const item = [W1, W2, WX].find((w) => w.id === itemOf[1]);
      return item ? json(item) : json({}, 404);
    }
    const detail = /^\/v1\/projects\/([^/]+)$/.exec(path);
    if (detail) {
      const project = projects.find((p) => p.id === detail[1]);
      if (!project) return json({}, 404);
      return ws.financeAllowed.has(project.id) ? json({ ...project, finance: { budget: 1 } }) : json({ code: 'FINANCE_FORBIDDEN' }, 403);
    }
    return json({ message: `route lạ ${path}` }, 404);
  });

  let accountId: string;
  let receiptReason: string;
  let paymentReason: string;
  let groupId: string;
  const receipt = (amount: number, over: Partial<SaveFinanceVoucherRequest> = {}): SaveFinanceVoucherRequest => ({
    kind: 'RECEIPT',
    voucherDate: today,
    postingDate: today,
    content: 'Thu tiền dự án',
    reasonId: receiptReason,
    accountId,
    counterpartyGroupId: groupId,
    lines: [{ description: 'Thu đợt 1', quantity: 1, unitAmount: amount, total: 0 }],
    ...over,
  });
  const payment = (amount: number, over: Partial<SaveFinanceVoucherRequest> = {}): SaveFinanceVoucherRequest => ({
    kind: 'PAYMENT',
    voucherDate: today,
    postingDate: today,
    content: 'Chi vật tư',
    reasonId: paymentReason,
    accountId,
    counterpartyGroupId: groupId,
    lines: [{ description: 'Vật tư', quantity: 1, unitAmount: amount, total: 0 }],
    ...over,
  });
  const rejects = async (promise: Promise<unknown>, code: string, message?: RegExp) => {
    const error = await promise.then(() => null, (e: { code?: string; message?: string }) => e);
    expect(error?.code).toBe(code);
    if (message) expect(error?.message).toMatch(message);
  };
  const post = async (input: SaveFinanceVoucherRequest) => {
    const created = await app.createVoucher(accountant, input);
    await app.submit(accountant, created.id);
    return app.approve(chief, created.id);
  };

  beforeAll(async () => {
    process.env['WORKSPACE_API_URL'] = BASE;
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

    accountId = (await app.saveAccount(manager, null, { code: 'VCB', name: 'Vietcombank', accountType: 'BANK', bankName: 'Vietcombank (VCB)', accountNumber: '0011', openingBalance: 100_000_000, openingDate: '2026-01-01' })).id;
    receiptReason = (await app.saveReason(manager, null, { kind: 'RECEIPT', code: 'THU', name: 'Thu tiền dự án' })).id;
    paymentReason = (await app.saveReason(manager, null, { kind: 'PAYMENT', code: 'VT', name: 'Vật tư' })).id;
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
    ws.available = true;
    ws.calls.length = 0;
    ws.financeAllowed = new Set();
  });

  it('danh mục cũ không còn đơn vị hạch toán', async () => {
    const catalogs = await app.catalogs(manager, true);
    expect(Object.keys(catalogs).sort()).toEqual(['counterpartyGroups', 'reasons']);
    const tables = (await pool.query(`SELECT to_regclass('finance_schema.cost_centers') AS t`)).rows[0] as { t: string | null };
    expect(tables.t).toBeNull();
  });

  it('chọn dự án và công việc: lấy từ Workspace theo cả tenant, dự án huỷ không được chào mời', async () => {
    const all = await app.workspaceProjects(accountant, undefined);
    expect(all.items.map((p) => p.code)).toEqual(['DA001', 'DA002', 'DA003']);
    expect((await app.workspaceProjects(accountant, 'đường dây')).items.map((p) => p.code)).toEqual(['DA002']);
    expect((await app.workspaceWorkItems(accountant, P1.id)).items.map((w) => w.code)).toEqual(['CV-1']);
    await rejects(app.workspaceWorkItems(accountant, randomUUID()), 'FINANCE_NOT_FOUND');
    await rejects(app.workspaceWorkItems(accountant, 'khong-phai-uuid'), 'FINANCE_INVALID');
    // Người không có quyền Tài chính nào không dùng được danh sách này.
    await rejects(app.workspaceProjects(actor('Người ngoài', []), undefined), 'FINANCE_FORBIDDEN');
  });

  it('hạch toán cho dự án: mã và tên do Workspace xác nhận, không nhận từ client', async () => {
    const created = await app.createVoucher(accountant, receipt(2_000_000, { allocation: { type: 'PROJECT', projectId: P1.id, ...({ projectName: 'Tên giả' } as object) } }));
    expect(created.allocation).toEqual({
      type: 'PROJECT',
      projectId: P1.id,
      projectCode: 'DA001',
      projectName: 'Trạm biến áp Đà Nẵng',
      workItemId: null,
      workItemCode: null,
      workItemTitle: null,
    });
    expect(created.relatedProjects).toEqual([]);
    const list = await app.listVouchers(chief, { kind: 'RECEIPT', projectId: P1.id });
    expect(list.items.map((v) => v.id)).toContain(created.id);
    expect(list.items.find((v) => v.id === created.id)?.allocation?.projectCode).toBe('DA001');
  });

  it('hạch toán cho công việc: công việc phải tồn tại, còn hiệu lực và thuộc đúng dự án', async () => {
    const ok = await app.createVoucher(accountant, payment(500_000, { allocation: { type: 'WORK_ITEM', projectId: P1.id, workItemId: W1.id } }));
    expect(ok.allocation).toMatchObject({ type: 'WORK_ITEM', projectCode: 'DA001', workItemId: W1.id, workItemCode: 'CV-1', workItemTitle: 'Lắp đặt tủ điện' });
    await rejects(app.createVoucher(accountant, payment(1, { allocation: { type: 'WORK_ITEM', projectId: P1.id, workItemId: W2.id } })), 'FINANCE_INVALID', /không thuộc dự án/);
    await rejects(app.createVoucher(accountant, payment(1, { allocation: { type: 'WORK_ITEM', projectId: P1.id, workItemId: WX.id } })), 'FINANCE_INVALID', /đã huỷ/);
    await rejects(app.createVoucher(accountant, payment(1, { allocation: { type: 'WORK_ITEM', projectId: P1.id, workItemId: randomUUID() } })), 'FINANCE_INVALID', /Công việc không tồn tại/);
    await rejects(app.createVoucher(accountant, payment(1, { allocation: { type: 'PROJECT', projectId: PX.id } })), 'FINANCE_INVALID', /đã huỷ/);
    await rejects(app.createVoucher(accountant, payment(1, { allocation: { type: 'PROJECT', projectId: randomUUID() } })), 'FINANCE_INVALID', /Dự án không tồn tại/);
  });

  it('dự án liên quan: lưu mã/tên, thay thế khi sửa, kiểm tra tồn tại; lệnh chuyển tiền không hạch toán được', async () => {
    const created = await app.createVoucher(accountant, receipt(1_000_000, { relatedProjectIds: [P2.id, P1.id] }));
    expect(created.relatedProjects.map((p) => p.projectCode)).toEqual(['DA001', 'DA002']);
    const edited = await app.updateVoucher(accountant, created.id, receipt(1_000_000, { relatedProjectIds: [P2.id], revision: created.revision }));
    expect(edited.relatedProjects.map((p) => p.projectCode)).toEqual(['DA002']);
    const cleared = await app.updateVoucher(accountant, created.id, receipt(1_000_000, { revision: edited.revision }));
    expect(cleared.relatedProjects).toEqual([]);
    await rejects(app.createVoucher(accountant, receipt(1, { relatedProjectIds: [randomUUID()] })), 'FINANCE_INVALID', /Dự án không tồn tại/);

    const transfer: SaveFinanceVoucherRequest = { kind: 'TRANSFER', voucherDate: today, postingDate: today, content: 'Chuyển quỹ', accountId, destAccountId: accountId, amount: 1, allocation: { type: 'PROJECT', projectId: P1.id } };
    await rejects(app.createVoucher(accountant, transfer), 'FINANCE_INVALID', /Lệnh chuyển tiền không hạch toán/);
  });

  it('sửa phiếu không đổi hạch toán thì không hỏi Workspace; Workspace sập vẫn lưu được, đổi hạch toán thì báo rõ', async () => {
    const created = await app.createVoucher(accountant, receipt(3_000_000, { allocation: { type: 'WORK_ITEM', projectId: P1.id, workItemId: W1.id }, relatedProjectIds: [P2.id] }));
    ws.calls.length = 0;
    ws.available = false;
    const same = await app.updateVoucher(
      accountant,
      created.id,
      receipt(3_500_000, { content: 'Sửa nội dung', allocation: { type: 'WORK_ITEM', projectId: P1.id, workItemId: W1.id }, relatedProjectIds: [P2.id], revision: created.revision }),
    );
    expect(same.totalAmount).toBe(3_500_000);
    expect(same.allocation?.workItemCode).toBe('CV-1');
    expect(same.relatedProjects.map((p) => p.projectCode)).toEqual(['DA002']);
    expect(ws.calls).toEqual([]);

    await rejects(
      app.updateVoucher(accountant, created.id, receipt(3_500_000, { allocation: { type: 'PROJECT', projectId: P3.id }, revision: same.revision })),
      'FINANCE_WORKSPACE_UNAVAILABLE',
    );
    await rejects(app.createVoucher(accountant, receipt(1, { allocation: { type: 'PROJECT', projectId: P1.id } })), 'FINANCE_WORKSPACE_UNAVAILABLE');
    // Phiếu chưa hạch toán không phụ thuộc Workspace.
    await expect(app.createVoucher(accountant, receipt(1_000))).resolves.toMatchObject({ allocation: null });
  });

  it('trang dự án: tổng thu chi chỉ tính phiếu HẠCH TOÁN cho dự án và đã duyệt; phiếu liên quan chỉ để tra cứu', async () => {
    const projectId = P2.id;
    const before = await app.projectVouchers(manager, session, projectId).catch((e: { code?: string }) => e.code);
    expect(before).toBe('FINANCE_FORBIDDEN'); // Workspace chưa cho người này xem tài chính dự án

    ws.financeAllowed = new Set([projectId]);
    const empty = await app.projectVouchers(manager, session, projectId);
    const zero = { received: 0, paid: 0, pendingReceived: 0, pendingPaid: 0, receiptCount: 0, paymentCount: 0 };
    expect(empty.totals).toEqual(zero);
    expect(empty.projectLevel).toEqual(zero);
    expect(empty.workItems).toEqual([]);

    await post(receipt(10_000_000, { allocation: { type: 'PROJECT', projectId } })); // thu đã ghi sổ
    await post(payment(2_500_000, { allocation: { type: 'PROJECT', projectId } })); // chi đã ghi sổ
    await post(payment(1_000_000, { allocation: { type: 'WORK_ITEM', projectId, workItemId: W2.id } })); // chi cho công việc của dự án
    await post(payment(7_000_000, { relatedProjectIds: [projectId] })); // chỉ liên quan: không cộng
    const pending = await app.createVoucher(accountant, payment(400_000, { allocation: { type: 'PROJECT', projectId } }));
    await app.submit(accountant, pending.id); // chờ duyệt
    await app.createVoucher(accountant, payment(999_000, { allocation: { type: 'PROJECT', projectId } })); // nháp: không hiển thị
    const rejected = await app.createVoucher(accountant, payment(888_000, { allocation: { type: 'PROJECT', projectId } }));
    await app.submit(accountant, rejected.id);
    await app.reject(chief, rejected.id, 'Thiếu chứng từ'); // bị từ chối: không hiển thị
    const reversed = await post(payment(3_000_000, { allocation: { type: 'PROJECT', projectId } }));
    await app.reverse(chief, reversed.id, 'Nhập nhầm'); // đã đảo: không tính

    const result = await app.projectVouchers(manager, session, projectId);
    expect(result.totals).toEqual({ received: 10_000_000, paid: 3_500_000, pendingReceived: 0, pendingPaid: 400_000, receiptCount: 1, paymentCount: 3 });
    expect(result.truncated).toBe(false);
    // Tách phần chung của dự án và phần của từng công việc; tổng = phần chung + các công việc.
    expect(result.projectLevel).toEqual({ received: 10_000_000, paid: 2_500_000, pendingReceived: 0, pendingPaid: 400_000, receiptCount: 1, paymentCount: 2 });
    expect(result.workItems).toEqual([
      { workItemId: W2.id, code: 'CV-2', title: 'Việc của dự án 2', received: 0, paid: 1_000_000, pendingReceived: 0, pendingPaid: 0, receiptCount: 0, paymentCount: 1 },
    ]);
    const byLink = (link: string) => result.items.filter((i) => i.link === link);
    expect(byLink('ALLOCATION')).toHaveLength(4);
    expect(byLink('RELATED').map((i) => i.totalAmount)).toEqual([7_000_000]);
    const work = result.items.find((i) => i.workItem);
    expect(work?.workItem).toMatchObject({ code: 'CV-2', title: 'Việc của dự án 2' });
    expect(result.items.every((i) => ['PENDING', 'APPROVED'].includes(i.status))).toBe(true);
    // Chỉ dữ kiện cần thiết: không lộ tài khoản ngân hàng hay người nộp/nhận.
    expect(Object.keys(result.items[0]).sort()).toEqual(['code', 'content', 'createdByName', 'id', 'kind', 'link', 'reasonName', 'status', 'totalAmount', 'voucherDate', 'workItem']);

    // Dự án khác không lẫn số của dự án này.
    ws.financeAllowed.add(P1.id);
    const other = await app.projectVouchers(manager, session, P1.id);
    expect(other.items.some((i) => result.items.some((x) => x.id === i.id))).toBe(false);
  });

  it('trang dự án: hai lớp quyền — Workspace cho xem dự án và Tài chính cho xem phiếu (finance.read); không trả số liệu một phần', async () => {
    const projectId = P1.id;
    ws.financeAllowed = new Set([projectId]);
    await post(receipt(777, { allocation: { type: 'PROJECT', projectId } })); // phiếu của kế toán viên, đã ghi sổ
    const mine = await app.createVoucher(stranger, payment(123_000, { allocation: { type: 'PROJECT', projectId }, content: 'Phiếu của stranger' }));
    await app.submit(stranger, mine.id);
    // Người chỉ lập phiếu (không có finance.read) dù được Workspace cho xem dự án vẫn không nhận số liệu.
    await rejects(app.projectVouchers(stranger, session, projectId), 'FINANCE_FORBIDDEN', /finance|Tài chính/i);
    // Kế toán trưởng (đọc toàn bộ) thấy cả phiếu của người khác, đủ số.
    const seenByChief = await app.projectVouchers(chief, session, projectId);
    expect(seenByChief.items.map((i) => i.id)).toContain(mine.id);
    expect(seenByChief.items.length).toBeGreaterThan(1);
    expect(seenByChief.totals.pendingPaid).toBeGreaterThanOrEqual(123_000);

    ws.financeAllowed = new Set();
    await rejects(app.projectVouchers(chief, session, projectId), 'FINANCE_FORBIDDEN');
    await rejects(app.projectVouchers(chief, session, randomUUID()), 'FINANCE_NOT_FOUND');
    await rejects(app.projectVouchers(chief, session, 'abc'), 'FINANCE_INVALID');
    await rejects(app.projectVouchers(actor('Người ngoài', []), session, projectId), 'FINANCE_FORBIDDEN');
    ws.available = false;
    await rejects(app.projectVouchers(chief, session, projectId), 'FINANCE_WORKSPACE_UNAVAILABLE');
  });

  it('báo cáo theo dự án và lọc theo dự án, tính từ sổ cái', async () => {
    const day = { from: '2026-01-01', to: today };
    const report = await app.report(chief, day);
    const names = report.paymentsByProject.map((r) => r.name);
    expect(names).toContain('DA002 - Đường dây 110kV');
    expect(names).toContain('Chưa hạch toán');
    const p2 = report.paymentsByProject.find((r) => r.id === P2.id);
    // 2.500.000 + 1.000.000 đã ghi sổ; 3.000.000 đã đảo nên bút toán chi và đảo triệt tiêu nhau.
    expect(p2?.amount).toBe(3_500_000);
    expect(report.receiptsByProject.find((r) => r.id === P2.id)?.amount).toBe(10_000_000);

    const filtered = await app.report(chief, { ...day, projectId: P2.id });
    expect(filtered.totals.receipts).toBe(10_000_000);
    expect(filtered.totals.payments).toBe(3_500_000);
    expect(filtered.paymentsByProject.map((r) => r.id)).toEqual([P2.id]);
  });

  it('ràng buộc cơ sở dữ liệu: hạch toán nhất quán, lệnh chuyển tiền không hạch toán, mỗi dự án liên quan một lần', async () => {
    const created = await app.createVoucher(accountant, receipt(5_000, { allocation: { type: 'PROJECT', projectId: P1.id }, relatedProjectIds: [P2.id] }));
    const fails = async (sql: string, params: unknown[]) => expect(pool.query(sql, params)).rejects.toThrow();
    // Hạch toán cho công việc mà thiếu công việc.
    await fails(`UPDATE finance_schema.vouchers SET alloc_type='WORK_ITEM', alloc_work_item_id=NULL WHERE id=$1`, [created.id]);
    // Hạch toán cho dự án mà kèm công việc.
    await fails(`UPDATE finance_schema.vouchers SET alloc_work_item_id=$2 WHERE id=$1`, [created.id, W1.id]);
    // Có dự án mà không có hình thức.
    await fails(`UPDATE finance_schema.vouchers SET alloc_type=NULL WHERE id=$1`, [created.id]);
    // Dự án liên quan trùng.
    await fails(`INSERT INTO finance_schema.voucher_related (tenant_id, voucher_id, kind, project_id, label) VALUES ($1,$2,'PROJECT',$3,'x')`, [tenantId, created.id, P2.id]);
    // Loại PROJECT mà thiếu id dự án.
    await fails(`INSERT INTO finance_schema.voucher_related (tenant_id, voucher_id, kind, label) VALUES ($1,$2,'PROJECT','x')`, [tenantId, created.id]);
  });
});
