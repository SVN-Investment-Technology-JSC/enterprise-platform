import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import { financePeriodOf, type SaveFinanceVoucherRequest } from '@enterprise-platform/contracts-finance';
import type { Pool } from 'pg';
import { FinanceApplication } from './application/finance.application.js';
import type { FinanceActor } from './domain/finance.access.js';
import { todayVn } from './infrastructure/finance.database.js';
import { FakeFinanceStorage, TestFinanceDatabase, dropTestDatabase } from './finance-test-support.js';

const integration = process.env.FINANCE_TEST_ADMIN_URL ? describe : describe.skip;

const CREATE_ALL = ['finance.receipt.create', 'finance.payment.create', 'finance.transfer.create'];
const APPROVE_ALL = ['finance.receipt.approve', 'finance.payment.approve', 'finance.transfer.approve', 'finance.read', 'finance.report.read'];

integration('Tài chính: phiếu thu, chi, chuyển tiền và sổ cái (PostgreSQL)', () => {
  const databaseName = 'finance_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const today = todayVn();
  let admin: ReturnType<typeof createPostgresPool>;
  let pool: Pool;
  let app: FinanceApplication;
  const storage = new FakeFinanceStorage();

  const actor = (name: string, permissions: string[]): FinanceActor => ({ tenantId, userId: randomUUID(), displayName: name, permissions });
  /** Không có phiên Procedure: các test dùng duyệt trực tiếp nên không gọi sang Procedure. */
  const session = {};
  const accountant = actor('Kế toán viên', CREATE_ALL);
  const approver = actor('Kế toán trưởng', APPROVE_ALL);
  const admin2 = actor('Quản trị tài chính', ['finance.manage']);
  // Kế toán kiêm nhiệm vừa lập vừa có quyền duyệt: dùng để kiểm quy tắc không tự duyệt.
  const maker = actor('Kế toán kiêm nhiệm', [...CREATE_ALL, ...APPROVE_ALL]);
  const outsider = actor('Nhân viên khác', ['finance.receipt.create']);

  let accountA: string;
  let accountB: string;
  let cash: string;
  let receiptReason: string;
  let paymentReason: string;
  let group: string;

  const line = (description: string, quantity: number, unitAmount: number) => ({ description, quantity, unitAmount, total: 0 });
  const receipt = (over: Partial<SaveFinanceVoucherRequest> = {}): SaveFinanceVoucherRequest => ({
    kind: 'RECEIPT',
    voucherDate: today,
    postingDate: today,
    content: 'Thu tiền hàng',
    reasonId: receiptReason,
    accountId: accountA,
    counterpartyGroupId: group,
    lines: [line('Hàng A', 2, 150_000)],
    ...over,
  });
  const payment = (amount: number, over: Partial<SaveFinanceVoucherRequest> = {}): SaveFinanceVoucherRequest => ({
    kind: 'PAYMENT',
    voucherDate: today,
    postingDate: today,
    content: 'Chi văn phòng phẩm',
    reasonId: paymentReason,
    accountId: accountA,
    counterpartyGroupId: group,
    lines: [line('Giấy in', 1, amount)],
    ...over,
  });
  const transfer = (amount: number, from: string, to: string): SaveFinanceVoucherRequest => ({
    kind: 'TRANSFER',
    voucherDate: today,
    postingDate: today,
    content: 'Chuyển quỹ',
    accountId: from,
    destAccountId: to,
    amount,
  });
  /** Lập, gửi duyệt rồi duyệt một phiếu. */
  const post = async (input: SaveFinanceVoucherRequest) => {
    const created = await app.createVoucher(accountant, input);
    await app.submit(accountant, created.id);
    return app.approve(approver, created.id);
  };
  const balance = async (id: string) => (await app.account(approver, id)).balance;
  const rejects = async (promise: Promise<unknown>, code: string, message?: RegExp) => {
    const error = await promise.then(
      () => null,
      (e: { code?: string; message?: string }) => e,
    );
    expect(error).not.toBeNull();
    expect(error?.code).toBe(code);
    if (message) expect(error?.message).toMatch(message);
  };

  beforeAll(async () => {
    const url = new URL(process.env.FINANCE_TEST_ADMIN_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString()) as unknown as Pool;
    // Hạ tầng sự kiện (outbox) có sẵn ở mọi DB tenant trước các migration của module; thông báo của Tài chính ghi vào đó.
    await pool.query(await readFile(resolve(process.cwd(), '../../../migrations/tenant/0001-integration.sql'), 'utf8'));
    const directory = resolve(process.cwd(), '../../../migrations/tenant/finance');
    for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort())
      await pool.query(await readFile(resolve(directory, file), 'utf8'));
    app = new FinanceApplication(new TestFinanceDatabase(pool), storage);

    accountA = (
      await app.saveAccount(admin2, null, {
        code: 'VCB-01',
        name: 'Vietcombank chính',
        accountType: 'BANK',
        bankName: 'Vietcombank (VCB)',
        accountNumber: '0011000123456',
        openingBalance: 10_000_000,
        openingDate: '2026-01-01',
      })
    ).id;
    accountB = (
      await app.saveAccount(admin2, null, {
        code: 'TCB-01',
        name: 'Techcombank',
        accountType: 'BANK',
        bankName: 'Techcombank (TCB)',
        accountNumber: '19031234567890',
        openingDate: '2026-01-01',
      })
    ).id;
    cash = (await app.saveAccount(admin2, null, { code: 'QUY-TM', name: 'Quỹ tiền mặt', accountType: 'CASH', openingDate: '2026-01-01' })).id;
    receiptReason = (await app.saveReason(admin2, null, { kind: 'RECEIPT', code: 'THU_HANG', name: 'Thu tiền hàng' })).id;
    paymentReason = (await app.saveReason(admin2, null, { kind: 'PAYMENT', code: 'VPP', name: 'Văn phòng phẩm' })).id;
    const catalogs = await app.catalogs(admin2, false);
    group = catalogs.counterpartyGroups.find((g) => g.code === 'KHACH_HANG')!.id;
  }, 120_000);

  afterAll(async () => {
    if (admin) {
      await dropTestDatabase(admin, pool, databaseName);
      await admin.end();
    } else await pool?.end();
  }, 60_000);

  it('danh mục: nhóm đối tượng mặc định được nạp một lần; tài khoản ngân hàng bắt buộc có số tài khoản; trùng mã bị từ chối', async () => {
    const catalogs = await app.catalogs(admin2, false);
    expect(catalogs.counterpartyGroups.map((g) => g.code)).toEqual(expect.arrayContaining(['KHACH_HANG', 'NHA_CUNG_CAP', 'NHAN_VIEN']));
    const again = await app.catalogs(admin2, false);
    expect(again.counterpartyGroups).toHaveLength(catalogs.counterpartyGroups.length);
    await rejects(app.saveAccount(admin2, null, { code: 'X1', name: 'Thiếu số TK', accountType: 'BANK', bankName: 'ACB' }), 'FINANCE_INVALID', /số tài khoản/);
    await rejects(app.saveAccount(admin2, null, { code: 'VCB-01', name: 'Trùng mã', accountType: 'CASH' }), 'FINANCE_CODE_EXISTS');
    await rejects(app.saveAccount(accountant, null, { code: 'Z', name: 'Không quyền', accountType: 'CASH' }), 'FINANCE_FORBIDDEN');
  });

  it('phiếu thu: mã nháp lúc lập, mã chính thức lúc ghi sổ; chỉ ghi sổ khi được duyệt; người lập không tự duyệt', async () => {
    const period = financePeriodOf(today);
    const created = await app.createVoucher(accountant, receipt());
    expect(created.code).toBe(`NHAP_PT_${period}_0001`);
    expect(created).toMatchObject({ draftCode: `NHAP_PT_${period}_0001`, officialCode: null });
    expect(created).toMatchObject({ status: 'DRAFT', totalAmount: 300_000, kind: 'RECEIPT' });
    expect(created.lines[0].total).toBe(300_000);
    expect(await balance(accountA)).toBe(10_000_000);

    await app.submit(accountant, created.id);
    expect((await app.voucher(accountant, created.id)).status).toBe('PENDING');
    expect(await balance(accountA)).toBe(10_000_000);

    await rejects(app.approve(accountant, created.id), 'FINANCE_FORBIDDEN');
    await rejects(app.approve(outsider, created.id), 'FINANCE_NOT_FOUND');
    const own = await app.createVoucher(maker, receipt({ content: 'Phiếu do người kiêm nhiệm lập' }));
    await app.submit(maker, own.id);
    await rejects(app.approve(maker, own.id), 'FINANCE_FORBIDDEN', /tự duyệt/);
    expect((await app.voucher(maker, own.id)).permissions.canApprove).toBe(false);
    // Tenant bật ngoại lệ thì người lập được tự duyệt.
    await app.saveSettings(admin2, { allowSelfApproval: true });
    expect((await app.voucher(maker, own.id)).permissions.canApprove).toBe(true);
    await app.saveSettings(admin2, { allowSelfApproval: false });
    await app.cancel(maker, session, own.id, 'Chỉ dùng kiểm thử');
    const approved = await app.approve(approver, created.id, 'Đã đối chiếu sao kê');
    expect(approved).toMatchObject({ status: 'APPROVED', posted: true, decidedByName: 'Kế toán trưởng' });
    // Phiếu tự huỷ ở trên không ghi sổ nên không tiêu số chính thức.
    expect(approved).toMatchObject({ code: `PT-${period}-0001`, officialCode: `PT-${period}-0001`, draftCode: `NHAP_PT_${period}_0001` });
    expect(approved.events.map((e) => e.action)).toEqual(['CREATED', 'SUBMITTED', 'APPROVED']);
    expect(await balance(accountA)).toBe(10_300_000);

    // Duyệt lần hai không ghi sổ trùng.
    await rejects(app.approve(approver, created.id), 'FINANCE_VOUCHER_STATE');
    expect(await balance(accountA)).toBe(10_300_000);
  });

  it('gửi duyệt thiếu thông tin trả đủ danh sách lỗi và phiếu vẫn là nháp', async () => {
    const draft = await app.createVoucher(accountant, receipt({ reasonId: null, accountId: null, counterpartyGroupId: null, lines: [] }));
    const error = await app.submit(accountant, draft.id).then(
      () => null,
      (e: { code: string; details: string[] }) => e,
    );
    expect(error?.code).toBe('FINANCE_SUBMIT_INVALID');
    expect(error?.details).toEqual(expect.arrayContaining(['Chọn lý do thu.', 'Chọn đối tượng thu.', 'Chọn tài khoản thu.']));
    expect((await app.voucher(accountant, draft.id)).status).toBe('DRAFT');
    await app.deleteVoucher(accountant, draft.id);
    await rejects(app.voucher(accountant, draft.id), 'FINANCE_NOT_FOUND');
  });

  it('phiếu chi không được làm âm số dư tài khoản; vẫn chờ duyệt để xử lý sau', async () => {
    const big = await app.createVoucher(accountant, payment(50_000_000));
    await app.submit(accountant, big.id);
    await rejects(app.approve(approver, big.id), 'FINANCE_INSUFFICIENT_BALANCE', /không đủ/);
    expect((await app.voucher(approver, big.id)).status).toBe('PENDING');
    expect(await balance(accountA)).toBe(10_300_000);
    // Số tiền chờ duyệt hiện ở tài khoản để kế toán biết tiền sắp ra.
    expect((await app.account(approver, accountA)).pendingOut).toBe(50_000_000);
    await app.cancel(accountant, session, big.id, 'Nhập sai số tiền');
    expect((await app.account(approver, accountA)).pendingOut).toBe(0);

    const ok = await post(payment(1_300_000));
    expect(ok.status).toBe('APPROVED');
    expect(await balance(accountA)).toBe(9_000_000);
  });

  it('tài khoản cho phép âm (thấu chi) duyệt được phiếu chi vượt số dư', async () => {
    await app.saveAccount(admin2, accountB, {
      code: 'TCB-01',
      name: 'Techcombank',
      accountType: 'BANK',
      bankName: 'Techcombank (TCB)',
      accountNumber: '19031234567890',
      allowNegative: true,
    });
    await post(payment(2_000_000, { accountId: accountB }));
    expect(await balance(accountB)).toBe(-2_000_000);
    await app.saveAccount(admin2, accountB, {
      code: 'TCB-01',
      name: 'Techcombank',
      accountType: 'BANK',
      bankName: 'Techcombank (TCB)',
      accountNumber: '19031234567890',
      allowNegative: false,
    });
  });

  it('lệnh chuyển tiền: ghi hai bút toán đối ứng; nguồn phải khác đích; nguồn phải đủ số dư', async () => {
    const before = { a: await balance(accountA), c: await balance(cash) };
    const done = await post(transfer(1_000_000, accountA, cash));
    expect(done.status).toBe('APPROVED');
    expect(await balance(accountA)).toBe(before.a! - 1_000_000);
    expect(await balance(cash)).toBe(before.c! + 1_000_000);

    await rejects(app.createVoucher(accountant, transfer(100, accountA, accountA)), 'FINANCE_INVALID', /khác nhau/);
    const noDest = await app.createVoucher(accountant, { ...transfer(100, accountA, cash), destAccountId: null });
    await expect(app.submit(accountant, noDest.id)).rejects.toMatchObject({ code: 'FINANCE_SUBMIT_INVALID' });
    await app.deleteVoucher(accountant, noDest.id);

    const tooBig = await app.createVoucher(accountant, transfer(99_000_000, accountA, cash));
    await app.submit(accountant, tooBig.id);
    await rejects(app.approve(approver, tooBig.id), 'FINANCE_INSUFFICIENT_BALANCE');
    await app.cancel(approver, session, tooBig.id, 'Không đủ số dư');
    expect((await app.voucher(approver, tooBig.id)).status).toBe('CANCELLED');
  });

  it('từ chối cần lý do; sửa phiếu bị từ chối gửi duyệt lại ngay (không còn qua nháp)', async () => {
    const created = await app.createVoucher(accountant, receipt({ content: 'Thu lần 2' }));
    await app.submit(accountant, created.id);
    await rejects(app.reject(approver, created.id, ' '), 'FINANCE_INVALID', /lý do/);
    const rejected = await app.reject(approver, created.id, 'Thiếu chứng từ');
    expect(rejected).toMatchObject({ status: 'REJECTED', decisionNote: 'Thiếu chứng từ' });
    expect(rejected.permissions).toMatchObject({ canEdit: false, canApprove: false });
    expect((await app.voucher(accountant, created.id)).permissions).toMatchObject({ canEdit: true, canSubmit: true });

    const edited = await app.updateVoucher(accountant, created.id, receipt({ content: 'Thu lần 2 (đã bổ sung chứng từ)', revision: rejected.revision }));
    expect(edited).toMatchObject({ status: 'PENDING', revision: rejected.revision + 1, decisionNote: null });
    expect(edited.events.map((e) => e.action)).toEqual(['CREATED', 'SUBMITTED', 'REJECTED', 'UPDATED', 'SUBMITTED']);
    // Sửa với phiên bản cũ bị chặn.
    await rejects(app.updateVoucher(accountant, created.id, receipt({ revision: rejected.revision })), 'FINANCE_REVISION_CONFLICT');
    expect((await app.approve(approver, created.id)).status).toBe('APPROVED');
  });

  it('sửa phiếu đang chờ duyệt trực tiếp: vẫn chờ duyệt với dữ liệu mới; thiếu điều kiện gửi duyệt thì báo lỗi và giữ nguyên', async () => {
    const pending = await app.createVoucher(accountant, payment(200_000, { content: 'Chi tạm ứng' }));
    await app.submit(accountant, pending.id);
    expect((await app.voucher(accountant, pending.id)).permissions).toMatchObject({ canEdit: true, canDelete: true, canSubmit: false });

    const edited = await app.updateVoucher(accountant, pending.id, payment(250_000, { content: 'Chi tạm ứng (đã sửa số tiền)', revision: pending.revision }));
    expect(edited).toMatchObject({ status: 'PENDING', totalAmount: 250_000, content: 'Chi tạm ứng (đã sửa số tiền)' });
    expect(await app.approve(approver, edited.id)).toMatchObject({ status: 'APPROVED' });

    // Thiếu điều kiện gửi duyệt (xoá hết dòng chi tiết): báo lỗi đầy đủ, phiếu vẫn PENDING với dữ liệu cũ.
    const pending2 = await app.createVoucher(accountant, payment(300_000, { content: 'Chi khác' }));
    await app.submit(accountant, pending2.id);
    await rejects(
      app.updateVoucher(accountant, pending2.id, payment(300_000, { content: 'Chi khác', lines: [], revision: pending2.revision })),
      'FINANCE_SUBMIT_INVALID',
    );
    expect((await app.voucher(accountant, pending2.id)).status).toBe('PENDING');
    await app.cancel(accountant, session, pending2.id, 'dọn');
  });

  it('xoá phiếu đang chờ duyệt trực tiếp (chưa ghi sổ); không xoá được phiếu đã duyệt hay bị từ chối', async () => {
    const pending = await app.createVoucher(accountant, payment(100_000, { content: 'Chi để xoá' }));
    await app.submit(accountant, pending.id);
    await app.deleteVoucher(accountant, pending.id);
    await rejects(app.voucher(accountant, pending.id), 'FINANCE_NOT_FOUND');

    const rejected = await app.createVoucher(accountant, payment(100_000, { content: 'Chi bị từ chối' }));
    await app.submit(accountant, rejected.id);
    await app.reject(approver, rejected.id, 'Sai nội dung');
    await rejects(app.deleteVoucher(accountant, rejected.id), 'FINANCE_VOUCHER_LOCKED');
    await app.cancel(accountant, session, rejected.id, 'dọn');
  });

  it('quyền xem: người chỉ có quyền lập thấy phiếu của mình, không thấy phiếu người khác và không thấy số dư', async () => {
    const mine = await app.createVoucher(outsider, receipt({ content: 'Phiếu của người ngoài' }));
    const outsiderList = await app.listVouchers(outsider, { kind: 'RECEIPT' });
    expect(outsiderList.items.map((v) => v.id)).toEqual([mine.id]);
    const others = (await app.listVouchers(approver, { kind: 'RECEIPT', status: 'APPROVED' })).items[0];
    await rejects(app.voucher(outsider, others.id), 'FINANCE_NOT_FOUND');
    const accounts = await app.accounts(outsider, false);
    expect(accounts.every((a) => a.balance === null)).toBe(true);
    await rejects(app.accountLedger(outsider, accountA, {}), 'FINANCE_FORBIDDEN');
    await rejects(app.report(outsider, { from: today, to: today }), 'FINANCE_FORBIDDEN');
    // Không phải chủ phiếu thì không sửa/xoá được.
    await rejects(app.deleteVoucher(accountant, mine.id), 'FINANCE_NOT_FOUND');
    const approverList = await app.listVouchers(approver, { kind: 'RECEIPT' });
    expect(approverList.total).toBeGreaterThanOrEqual(3);
    expect(approverList.statusCounts.APPROVED).toBeGreaterThanOrEqual(2);
  });

  it('đảo phiếu đã ghi sổ: bút toán đảo giữ nguyên số liệu; đảo phiếu thu đã tiêu hết tiền bị chặn', async () => {
    const paid = await post(payment(500_000));
    const after = await balance(accountA);
    await rejects(app.cancel(accountant, session, paid.id, 'x'), 'FINANCE_VOUCHER_STATE');
    await rejects(app.reverse(approver, paid.id, undefined), 'FINANCE_INVALID', /lý do/);
    await rejects(app.reverse(accountant, paid.id, 'Nhầm'), 'FINANCE_FORBIDDEN');
    const reversed = await app.reverse(approver, paid.id, 'Chi nhầm đối tượng');
    expect(reversed.status).toBe('CANCELLED');
    expect(reversed.events.at(-1)?.action).toBe('REVERSED');
    expect(await balance(accountA)).toBe(after! + 500_000);
    await rejects(app.reverse(approver, paid.id, 'lần hai'), 'FINANCE_VOUCHER_STATE');

    // Thu vào quỹ rồi chi hết: đảo phiếu thu sẽ làm âm quỹ nên bị chặn.
    const incoming = await post(receipt({ accountId: cash, lines: [line('Thu mới', 1, 300_000)] }));
    const cashNow = (await balance(cash))!;
    await post(payment(cashNow, { accountId: cash }));
    expect(await balance(cash)).toBe(0);
    await rejects(app.reverse(approver, incoming.id, 'Đảo thử'), 'FINANCE_INSUFFICIENT_BALANCE');
  });

  it('sổ cái chỉ thêm: không sửa hay xoá được bút toán; sổ tài khoản có số dư sau từng dòng', async () => {
    await expect(pool.query(`UPDATE finance_schema.ledger_entries SET amount = amount + 1`)).rejects.toThrow(/chỉ được thêm/);
    await expect(pool.query(`DELETE FROM finance_schema.ledger_entries`)).rejects.toThrow(/chỉ được thêm/);
    const ledger = await app.accountLedger(approver, accountA, {});
    expect(ledger.openingBalance).toBe(10_000_000);
    const latest = ledger.items[0];
    expect(latest.balanceAfter).toBe(await balance(accountA));
    // Cộng dồn từ đầu kỳ qua mọi dòng ra đúng số dư hiện tại.
    const sum = ledger.items.reduce((total, item) => total + item.amount, ledger.openingBalance);
    expect(sum).toBe(await balance(accountA));
    expect(ledger.items.some((item) => item.isReversal)).toBe(true);
  });

  it('khoá sổ: không duyệt phiếu có ngày hạch toán trong kỳ đã khoá và không duyệt phiếu ngày tương lai', async () => {
    const old = await app.createVoucher(accountant, receipt({ voucherDate: '2026-03-10', postingDate: '2026-03-10', content: 'Thu bổ sung kỳ cũ' }));
    await app.submit(accountant, old.id);
    await app.saveSettings(admin2, { booksLockedUntil: '2026-03-31' });
    await rejects(app.approve(approver, old.id), 'FINANCE_INVALID', /khoá đến ngày 2026-03-31/);
    await rejects(app.saveSettings(accountant, { booksLockedUntil: null }), 'FINANCE_FORBIDDEN');
    await app.saveSettings(admin2, { booksLockedUntil: null });
    expect((await app.approve(approver, old.id)).status).toBe('APPROVED');

    const future = await app.createVoucher(accountant, receipt({ postingDate: '2099-01-01', voucherDate: '2099-01-01' }));
    await app.submit(accountant, future.id);
    await rejects(app.approve(approver, future.id), 'FINANCE_INVALID', /tương lai/);
    await app.cancel(accountant, session, future.id);

    // Khoá đến hôm nay: không đảo được phiếu vì bút toán đảo ghi vào hôm nay.
    await app.saveSettings(admin2, { booksLockedUntil: today });
    await rejects(app.reverse(approver, old.id, 'Đảo kỳ khoá'), 'FINANCE_INVALID', /khoá/);
    await app.saveSettings(admin2, { booksLockedUntil: null });
  });

  it('tài khoản đã có bút toán vẫn đổi được số dư đầu kỳ (đồng bộ tay từ MISA); không đổi được ngày bắt đầu sử dụng hay loại tài khoản; không ngừng dùng khi còn phiếu chờ duyệt', async () => {
    const before = await app.account(admin2, accountA);
    // Số dư đầu kỳ đổi được dù đã có bút toán: số dư hiện tại dịch chuyển đúng bằng phần chênh lệch.
    const changed = await app.saveAccount(admin2, accountA, {
      code: 'VCB-01',
      name: 'Vietcombank chính',
      accountType: 'BANK',
      bankName: 'Vietcombank (VCB)',
      accountNumber: '0011000123456',
      openingBalance: before.openingBalance + 500_000,
    });
    expect(changed.openingBalance).toBe(before.openingBalance + 500_000);
    expect(await balance(accountA)).toBe((before.balance as number) + 500_000);
    // Trả lại đúng số cũ để không ảnh hưởng các kiểm tra khác dùng accountA về sau.
    await app.saveAccount(admin2, accountA, { code: 'VCB-01', name: 'Vietcombank chính', accountType: 'BANK', bankName: 'Vietcombank (VCB)', accountNumber: '0011000123456', openingBalance: before.openingBalance });
    expect(await balance(accountA)).toBe(before.balance);

    await rejects(
      app.saveAccount(admin2, accountA, { code: 'VCB-01', name: 'Vietcombank chính', accountType: 'BANK', bankName: 'Vietcombank (VCB)', accountNumber: '0011000123456', openingDate: '2026-02-01' }),
      'FINANCE_ACCOUNT_HAS_LEDGER',
    );
    await rejects(
      app.saveAccount(admin2, accountA, { code: 'VCB-01', name: 'Vietcombank chính', accountType: 'CASH', accountNumber: '0011000123456' }),
      'FINANCE_ACCOUNT_HAS_LEDGER',
    );

    const pending = await app.createVoucher(accountant, receipt({ accountId: accountB }));
    await app.submit(accountant, pending.id);
    await rejects(
      app.saveAccount(admin2, accountB, { code: 'TCB-01', name: 'Techcombank', accountType: 'BANK', bankName: 'Techcombank (TCB)', accountNumber: '19031234567890', isActive: false }),
      'FINANCE_ACCOUNT_IN_USE',
    );
    await app.cancel(approver, session, pending.id, 'Dọn dẹp');
  });

  it('báo cáo tính từ sổ cái: thu chi trừ phần đã đảo, chuyển tiền nội bộ không tính, biến động tài khoản khớp số dư', async () => {
    const report = await app.report(approver, { from: '2026-01-01', to: today });
    const receipts = report.cashflow.reduce((s, p) => s + p.receipts, 0);
    const payments = report.cashflow.reduce((s, p) => s + p.payments, 0);
    expect(report.totals.receipts).toBe(receipts);
    expect(report.totals.payments).toBe(payments);
    expect(report.totals.net).toBe(report.totals.receipts - report.totals.payments);
    expect(report.paymentsByReason.reduce((s, r) => s + r.amount, 0)).toBe(report.totals.payments);
    expect(report.receiptsByReason.reduce((s, r) => s + r.amount, 0)).toBe(report.totals.receipts);
    expect(report.totals.transferCount).toBeGreaterThanOrEqual(1);
    // Mỗi tài khoản: số dư cuối trong báo cáo bằng số dư hiện tại (báo cáo đến hôm nay).
    for (const movement of report.accounts) expect(movement.closingBalance).toBe(await balance(movement.accountId));
    // Khoảng ngày trước mọi phát sinh: số dư đầu = số dư đầu kỳ, không có thu chi.
    const empty = await app.report(approver, { from: '2026-01-02', to: '2026-01-05' });
    expect(empty.totals).toMatchObject({ receipts: 0, payments: 0 });
    expect(empty.accounts.find((a) => a.accountId === accountA)).toMatchObject({ openingBalance: 10_000_000, closingBalance: 10_000_000 });
    await expect(app.report(approver, { from: today, to: '2000-01-01' })).rejects.toMatchObject({ code: 'FINANCE_INVALID' });
  });

  it('danh sách tài khoản khớp với phiếu: số phiếu theo loại, tiền thu, tiền chi và tổng tiền', async () => {
    const accounts = await app.accounts(approver, false);
    for (const account of accounts) {
      // Tổng tiền = số dư đầu kỳ + tiền thu - tiền chi, và là đúng số dư ghi sổ.
      expect(account.openingBalance + (account.totalReceipts ?? 0) - (account.totalPayments ?? 0)).toBe(account.balance);
      // Số phiếu theo loại bằng số phiếu đã duyệt của đúng tài khoản đó trong danh sách phiếu.
      for (const [kind, count] of [
        ['RECEIPT', account.receiptCount],
        ['PAYMENT', account.paymentCount],
        ['TRANSFER', account.transferCount],
      ] as const) {
        const listed = await app.listVouchers(approver, { kind, status: 'APPROVED', accountId: account.id });
        expect(count).toBe(listed.total);
      }
    }
    const a = accounts.find((account) => account.id === accountA)!;
    // 3 phiếu thu 300.000; phiếu chi 1.300.000 + 500.000 (đã đảo nên trừ khỏi Tiền chi); chuyển 1.000.000 ra quỹ.
    expect(a).toMatchObject({ receiptCount: 3, paymentCount: 1, transferCount: 1, totalReceipts: 900_000, totalPayments: 2_300_000, balance: 8_600_000 });
    // Chuyển tiền đến tính vào Tiền thu của tài khoản đích.
    const c = accounts.find((account) => account.id === cash)!;
    expect(c.transferCount).toBe(1);
    expect(c.totalReceipts).toBeGreaterThanOrEqual(1_000_000);
    // Người chỉ có quyền lập phiếu không thấy số liệu tài khoản.
    const limited = (await app.accounts(outsider, false))[0];
    expect(limited).toMatchObject({ receiptCount: null, totalReceipts: null, totalPayments: null });
  });

  it('đính kèm chứng từ: tải lên bằng URL ký sẵn, phải xác nhận mới hiện trên phiếu; sai định dạng/kích thước bị chặn', async () => {
    const voucher = await app.createVoucher(accountant, receipt({ content: 'Phiếu có chứng từ' }));
    const ok = { fileName: 'hoa-don-001.pdf', contentType: 'application/pdf', sizeBytes: 120_000 };

    await rejects(app.createAttachment(accountant, voucher.id, { fileName: 'virus.exe', contentType: 'application/pdf', sizeBytes: 10 }), 'FINANCE_INVALID');
    await rejects(app.createAttachment(accountant, voucher.id, { ...ok, contentType: 'image/png' }), 'FINANCE_INVALID'); // nội dung khai báo không khớp đuôi tệp
    await rejects(app.createAttachment(accountant, voucher.id, { ...ok, sizeBytes: 11 * 1024 * 1024 }), 'FINANCE_INVALID');
    await rejects(app.createAttachment(accountant, voucher.id, { ...ok, sizeBytes: 0 }), 'FINANCE_INVALID');
    await rejects(app.createAttachment(accountant, voucher.id, { ...ok, fileName: '   ' }), 'FINANCE_INVALID');

    const created = await app.createAttachment(accountant, voucher.id, ok);
    expect(created.uploadUrl).toContain(`tenants/${tenantId}/finance/${voucher.id}/${created.id}.pdf`);
    // Chưa xác nhận: chưa hiện trên phiếu và chưa tải xuống được.
    expect((await app.voucher(accountant, voucher.id)).attachments).toEqual([]);
    await rejects(app.downloadAttachment(accountant, voucher.id, created.id), 'FINANCE_NOT_FOUND');
    // Chưa tải lên kho thì không xác nhận được.
    await rejects(app.completeAttachment(accountant, voucher.id, created.id), 'FINANCE_ATTACHMENT_NOT_UPLOADED');
    // Tải lên sai kích thước.
    storage.upload(created.uploadUrl, 999, 'application/pdf');
    await rejects(app.completeAttachment(accountant, voucher.id, created.id), 'FINANCE_ATTACHMENT_MISMATCH');
    storage.upload(created.uploadUrl, 120_000, 'application/pdf');
    const done = await app.completeAttachment(accountant, voucher.id, created.id);
    expect(done).toMatchObject({ id: created.id, fileName: 'hoa-don-001.pdf', sizeBytes: 120_000, uploadedByName: 'Kế toán viên' });
    expect((await app.completeAttachment(accountant, voucher.id, created.id)).id).toBe(created.id); // xác nhận lặp không lỗi

    const withFile = await app.voucher(accountant, voucher.id);
    expect(withFile.attachments.map((a) => a.fileName)).toEqual(['hoa-don-001.pdf']);
    const download = await app.downloadAttachment(approver, voucher.id, created.id);
    expect(download.fileName).toBe('hoa-don-001.pdf');
    expect(download.url).toContain(created.id);
    // Người không xem được phiếu không tải được và không biết tệp có tồn tại.
    await rejects(app.downloadAttachment(outsider, voucher.id, created.id), 'FINANCE_NOT_FOUND');
  });

  it('chỉ người lập thêm/gỡ tệp và chỉ khi phiếu còn sửa được; gỡ là xoá mềm', async () => {
    const voucher = await app.createVoucher(accountant, receipt({ content: 'Phiếu gỡ tệp' }));
    const created = await app.createAttachment(accountant, voucher.id, { fileName: 'a.png', contentType: 'image/png', sizeBytes: 50 });
    storage.upload(created.uploadUrl, 50, 'image/png');
    await app.completeAttachment(accountant, voucher.id, created.id);

    await rejects(app.createAttachment(approver, voucher.id, { fileName: 'b.png', contentType: 'image/png', sizeBytes: 5 }), 'FINANCE_NOT_FOUND'); // không phải người lập
    await rejects(app.removeAttachment(approver, voucher.id, created.id), 'FINANCE_NOT_FOUND');

    await app.removeAttachment(accountant, voucher.id, created.id);
    expect((await app.voucher(accountant, voucher.id)).attachments).toEqual([]);
    await rejects(app.removeAttachment(accountant, voucher.id, created.id), 'FINANCE_NOT_FOUND');
    const kept = (await pool.query(`SELECT deleted_at, deleted_by FROM finance_schema.voucher_attachments WHERE id=$1`, [created.id])).rows[0];
    expect(kept.deleted_at).not.toBeNull();
    expect(kept.deleted_by).toBe(accountant.userId);

    // Đã gửi duyệt thì không thêm/gỡ tệp nữa.
    await app.submit(accountant, voucher.id);
    await rejects(app.createAttachment(accountant, voucher.id, { fileName: 'c.png', contentType: 'image/png', sizeBytes: 5 }), 'FINANCE_VOUCHER_LOCKED');
    await app.cancel(accountant, session, voucher.id, 'dọn');
  });

  it('mỗi phiếu đính kèm tối đa 20 tệp', async () => {
    const voucher = await app.createVoucher(accountant, receipt({ content: 'Phiếu nhiều tệp' }));
    for (let i = 0; i < 20; i += 1) await app.createAttachment(accountant, voucher.id, { fileName: `f${i}.pdf`, contentType: 'application/pdf', sizeBytes: 10 });
    await rejects(app.createAttachment(accountant, voucher.id, { fileName: 'f21.pdf', contentType: 'application/pdf', sizeBytes: 10 }), 'FINANCE_INVALID');
  });

  it('ảnh dán vào ghi chú: chỉ nhận ảnh, giới hạn riêng 10 ảnh, không tính vào trần đính kèm và không hiện trong danh sách đính kèm', async () => {
    const voucher = await app.createVoucher(accountant, receipt({ content: 'Phiếu có ảnh ghi chú' }));
    await rejects(
      app.createAttachment(accountant, voucher.id, { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 10, purpose: 'NOTE_IMAGE' }),
      'FINANCE_INVALID',
    );
    const created = await app.createAttachment(accountant, voucher.id, { fileName: 'a.png', contentType: 'image/png', sizeBytes: 50, purpose: 'NOTE_IMAGE' });
    storage.upload(created.uploadUrl, 50, 'image/png');
    await app.completeAttachment(accountant, voucher.id, created.id);
    expect((await app.voucher(accountant, voucher.id)).attachments).toEqual([]);
    // Vẫn còn đủ 20 suất cho đính kèm chứng từ thật vì đếm riêng theo purpose.
    for (let i = 0; i < 20; i += 1) await app.createAttachment(accountant, voucher.id, { fileName: `f${i}.pdf`, contentType: 'application/pdf', sizeBytes: 10 });
    await rejects(app.createAttachment(accountant, voucher.id, { fileName: 'f21.pdf', contentType: 'application/pdf', sizeBytes: 10 }), 'FINANCE_INVALID');
    for (let i = 0; i < 9; i += 1) await app.createAttachment(accountant, voucher.id, { fileName: `n${i}.png`, contentType: 'image/png', sizeBytes: 10, purpose: 'NOTE_IMAGE' });
    await rejects(
      app.createAttachment(accountant, voucher.id, { fileName: 'n-vuot.png', contentType: 'image/png', sizeBytes: 10, purpose: 'NOTE_IMAGE' }),
      'FINANCE_INVALID',
    );
  });

  it('thông báo: gửi duyệt trực tiếp báo người có quyền duyệt; kết quả báo người lập; huỷ phiếu của chính mình không tự báo mình', async () => {
    const outbox = async (code: string, type?: string) =>
      (
        await pool.query(
          `SELECT event_type, payload->'payload' AS p FROM integration_schema.outbox_events
            WHERE payload->'payload'->>'voucherCode' = $1 ${type ? 'AND event_type = $2' : ''} ORDER BY occurred_at, id`,
          type ? [code, type] : [code],
        )
      ).rows as { event_type: string; p: Record<string, unknown> }[];

    const draft = await app.createVoucher(accountant, payment(750_000, { content: 'Mua bàn ghế' }));
    expect(await outbox(draft.code)).toEqual([]); // lưu nháp chưa báo ai
    await app.submit(accountant, draft.id);

    const [requested] = await outbox(draft.code, 'finance.approval.requested');
    expect(requested.p).toMatchObject({
      voucherId: draft.id,
      voucherKind: 'PAYMENT',
      // Quyền duyệt đúng loại phiếu chi, kèm quyền quản trị Tài chính; không liệt kê người nhận cụ thể.
      approvalPermissions: ['finance.payment.approve', 'finance.manage'],
      actorUserId: accountant.userId,
      deepLink: `/modules/finance/payments/${draft.id}`,
    });
    expect(String(requested.p['summary'])).toContain(`Phiếu chi ${draft.code} (750.000 đ) do Kế toán viên lập`);
    expect(String(requested.p['summary'])).toContain('Mua bàn ghế');

    // Ghi sổ đổi mã hiển thị sang mã chính thức; thông báo kết quả mang mã chính thức.
    const posted = await app.approve(approver, draft.id, 'Đã đối chiếu');
    expect(posted.code).not.toBe(draft.code);
    const [approved] = await outbox(posted.code, 'finance.voucher.status-changed');
    expect(approved.p).toMatchObject({ status: 'APPROVED', requesterUserId: accountant.userId, actorUserId: approver.userId, title: 'Phiếu đã được duyệt' });
    expect(String(approved.p['summary'])).toContain('đã được duyệt và ghi sổ bởi Kế toán trưởng');
    expect(String(approved.p['summary'])).toContain('Ghi chú: Đã đối chiếu');

    await app.reverse(approver, draft.id, 'Chi nhầm');
    const reversed = (await outbox(posted.code, 'finance.voucher.status-changed')).at(-1);
    expect(reversed?.p).toMatchObject({ status: 'REVERSED', requesterUserId: accountant.userId });

    // Từ chối: người lập nhận kèm lý do.
    const second = await app.createVoucher(accountant, payment(1_000, { content: 'Chi lặt vặt' }));
    await app.submit(accountant, second.id);
    await app.reject(approver, second.id, 'Thiếu hoá đơn');
    const rejected = (await outbox(second.code, 'finance.voucher.status-changed')).at(-1);
    expect(rejected?.p).toMatchObject({ status: 'REJECTED', title: 'Phiếu bị từ chối', requesterUserId: accountant.userId });
    expect(String(rejected?.p['summary'])).toContain('Ghi chú: Thiếu hoá đơn');

    // Người lập tự huỷ phiếu của mình: sự kiện vẫn ghi nhưng actor trùng người nhận nên chính sách loại ra (xem catalog spec).
    const third = await app.createVoucher(accountant, payment(2_000));
    await app.submit(accountant, third.id);
    await app.cancel(accountant, session, third.id, 'Nhập nhầm');
    const cancelled = (await outbox(third.code, 'finance.voucher.status-changed')).at(-1);
    expect(cancelled?.p).toMatchObject({ status: 'CANCELLED', requesterUserId: accountant.userId, actorUserId: accountant.userId });
  });

  it('lệnh chuyển tiền gửi duyệt báo người có quyền duyệt chuyển tiền', async () => {
    const transferVoucher = await app.createVoucher(accountant, transfer(5_000, accountA, cash));
    await app.submit(accountant, transferVoucher.id);
    const rows = (
      await pool.query(`SELECT payload->'payload' AS p FROM integration_schema.outbox_events WHERE event_type='finance.approval.requested' AND payload->'payload'->>'voucherId'=$1`, [transferVoucher.id])
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].p.approvalPermissions).toEqual(['finance.transfer.approve', 'finance.manage']);
    await app.cancel(accountant, session, transferVoucher.id, 'dọn');
  });

  it('theo dõi theo tháng: lọc đúng biên đầu/cuối tháng, tổng số phiếu và tổng tiền theo trạng thái trong kỳ', async () => {
    // Phiếu thu ở các ngày biên của tháng 5/2026 và các tháng lân cận (đã ghi sổ hoặc còn chờ duyệt).
    const make = async (date: string, amount: number, approve: boolean) => {
      const created = await app.createVoucher(accountant, receipt({ voucherDate: date, postingDate: date, content: `Thu ${date}`, lines: [line('Hàng', 1, amount)] }));
      await app.submit(accountant, created.id);
      if (approve) await app.approve(approver, created.id);
      return created;
    };
    await make('2026-04-30', 1_000, true); // tháng trước, sát biên
    await make('2026-05-01', 2_000, true); // ngày đầu tháng
    await make('2026-05-15', 3_000, false); // giữa tháng, chờ duyệt
    await make('2026-05-31', 4_000, true); // ngày cuối tháng
    await make('2026-06-01', 5_000, true); // tháng sau, sát biên

    const may = await app.listVouchers(approver, { kind: 'RECEIPT', from: '2026-05-01', to: '2026-05-31', pageSize: 100 });
    expect(may.items.map((v) => v.voucherDate).sort()).toEqual(['2026-05-01', '2026-05-15', '2026-05-31']);
    expect(may.statusCounts).toMatchObject({ APPROVED: 2, PENDING: 1, DRAFT: 0 });
    expect(may.statusAmounts).toMatchObject({ APPROVED: 6_000, PENDING: 3_000 });
    expect(may.approvedTotal).toBe(6_000);
    expect(may.total).toBe(3);

    // Tab trạng thái trong tháng: chỉ phiếu chờ duyệt, số tiền không lẫn tháng khác.
    const pendingMay = await app.listVouchers(approver, { kind: 'RECEIPT', from: '2026-05-01', to: '2026-05-31', status: 'PENDING' });
    expect(pendingMay.items.map((v) => v.voucherDate)).toEqual(['2026-05-15']);
    expect(pendingMay.total).toBe(1);
    // Số đếm các tab vẫn theo cả tháng dù đang chọn một trạng thái.
    expect(pendingMay.statusCounts.APPROVED).toBe(2);

    // Tháng không có phiếu: rỗng, tổng bằng 0.
    const empty = await app.listVouchers(approver, { kind: 'RECEIPT', from: '2025-01-01', to: '2025-01-31' });
    expect(empty).toMatchObject({ total: 0, approvedTotal: 0, items: [] });
    expect(Object.values(empty.statusAmounts).every((amount) => amount === 0)).toBe(true);

    // Tất cả thời gian: gồm cả các tháng khác.
    const all = await app.listVouchers(approver, { kind: 'RECEIPT', pageSize: 100 });
    expect(all.items.filter((v) => v.content.startsWith('Thu 2026-')).length).toBeGreaterThanOrEqual(5);
    // Người chỉ lập phiếu chỉ thấy phiếu của mình trong kỳ.
    await expect(app.listVouchers(outsider, { kind: 'RECEIPT', from: '2026-05-01', to: '2026-05-31' })).resolves.toMatchObject({ total: 0 });
  });

  it('trang tổng quan: phiếu chờ duyệt chỉ tính loại mình duyệt và không tính phiếu của chính mình', async () => {
    // Người chỉ có quyền duyệt không lập được phiếu.
    await rejects(app.createVoucher(approver, receipt({ content: 'Phiếu do người duyệt lập' })), 'FINANCE_FORBIDDEN');
    const waiting = await app.createVoucher(accountant, payment(10_000, { content: 'Chờ duyệt' }));
    await app.submit(accountant, waiting.id);
    const dash = await app.dashboard(approver);
    expect(dash.pendingApprovalCount).toBeGreaterThanOrEqual(1);
    expect(dash.accounts.length).toBe(3);
    expect(dash.totalBalance).toBe(dash.accounts.reduce((s, a) => s + (a.balance ?? 0), 0));
    const accountantDash = await app.dashboard(accountant);
    expect(accountantDash.accounts).toEqual([]);
    expect(accountantDash.pendingApprovalCount).toBe(0);
    expect(accountantDash.myDraftCount).toBeGreaterThanOrEqual(0);
  });

  it('mã chính thức: cấp lúc ghi sổ theo kỳ của ngày hạch toán, liền mạch khi ghi sổ lỗi; mã nháp giữ nguyên khi đổi ngày', async () => {
    const fund = (
      await app.saveAccount(admin2, null, { code: 'QUY-MA', name: 'Quỹ kiểm thử mã', accountType: 'CASH', openingBalance: 100_000, openingDate: '2026-01-01' })
    ).id;
    const period = financePeriodOf(today);
    const sequence = (code: string) => Number(code.split('-')[2]);

    const first = await post(payment(1_000, { accountId: fund, content: 'Mã thứ nhất' }));
    expect(first.code).toMatch(new RegExp(`^PC-${period}-\\d{4}$`));
    expect(first.officialCode).toBe(first.code);
    expect(first.draftCode).toMatch(new RegExp(`^NHAP_PC_${period}_\\d{4}$`));

    // Ghi sổ lỗi (không đủ số dư) không tiêu số chính thức và phiếu vẫn mang mã nháp.
    const failing = await app.createVoucher(accountant, payment(5_000_000, { accountId: fund, content: 'Vượt số dư' }));
    await app.submit(accountant, failing.id);
    await rejects(app.approve(approver, failing.id), 'FINANCE_INSUFFICIENT_BALANCE');
    expect(await app.voucher(approver, failing.id)).toMatchObject({ code: failing.code, officialCode: null });
    await app.cancel(accountant, session, failing.id, 'Nhập sai');

    const second = await post(payment(1_000, { accountId: fund, content: 'Mã thứ hai' }));
    expect(sequence(second.code)).toBe(sequence(first.code) + 1);
    expect(await app.listVouchers(approver, { kind: 'PAYMENT', search: second.draftCode ?? '' })).toMatchObject({ items: [{ id: second.id }] });
    expect(await app.listVouchers(approver, { kind: 'PAYMENT', search: second.code })).toMatchObject({ items: [{ id: second.id }] });

    // Ngày hạch toán thuộc tháng trước: số lấy theo kỳ tháng trước. Mã nháp giữ nguyên khi sửa ngày.
    const [year, month] = today.split('-').map(Number);
    const lastMonth = new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10);
    const draft = await app.createVoucher(accountant, payment(1_000, { accountId: fund, content: 'Phiếu tháng trước' }));
    const moved = await app.updateVoucher(accountant, draft.id, payment(1_000, { accountId: fund, content: 'Phiếu tháng trước', postingDate: lastMonth, voucherDate: lastMonth }));
    expect(moved.code).toBe(draft.code);
    await app.submit(accountant, draft.id);
    const old = await app.approve(approver, draft.id);
    expect(old.code).toMatch(new RegExp(`^PC-${financePeriodOf(lastMonth)}-\\d{4}$`));
    expect(old.draftCode).toBe(draft.code);
  });
});
