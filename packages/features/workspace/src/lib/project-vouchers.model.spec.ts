import {
  NO_VOUCHER_FILTER,
  buildWorkItemMoneyRows,
  classifyProjectVoucherResponse,
  filterProjectVouchers,
  normalizeProjectVoucherList,
  projectLevelMoneyRow,
  projectVoucherHref,
  projectVoucherNet,
  actualProfit,
  type ProjectVoucher,
  type ProjectVoucherList,
} from './project-vouchers.model';

const voucher = (over: Partial<ProjectVoucher>): ProjectVoucher => ({
  id: 'v1',
  kind: 'RECEIPT',
  code: 'PT_1_10_2026',
  voucherDate: '2026-10-14',
  content: 'Thu tiền đợt 1',
  reasonName: null,
  status: 'APPROVED',
  totalAmount: 1000,
  link: 'ALLOCATION',
  workItem: null,
  createdByName: 'An',
  ...over,
});

describe('thu chi trong tab Tài chính của dự án', () => {
  it('đường mở phiếu theo loại, id được mã hoá', () => {
    expect(projectVoucherHref({ kind: 'RECEIPT', id: 'abc' })).toBe('/modules/finance/receipts/abc');
    expect(projectVoucherHref({ kind: 'PAYMENT', id: 'a/b' })).toBe('/modules/finance/payments/a%2Fb');
  });

  it('lọc theo loại, quan hệ và trạng thái; bỏ lọc trả đủ', () => {
    const items = [
      voucher({ id: '1' }),
      voucher({ id: '2', kind: 'PAYMENT' }),
      voucher({ id: '3', link: 'RELATED', kind: 'PAYMENT' }),
      voucher({ id: '4', status: 'PENDING' }),
    ];
    expect(filterProjectVouchers(items, NO_VOUCHER_FILTER)).toHaveLength(4);
    expect(filterProjectVouchers(items, { ...NO_VOUCHER_FILTER, kind: 'PAYMENT' }).map((i) => i.id)).toEqual(['2', '3']);
    expect(filterProjectVouchers(items, { ...NO_VOUCHER_FILTER, link: 'RELATED' }).map((i) => i.id)).toEqual(['3']);
    expect(filterProjectVouchers(items, { kind: 'RECEIPT', link: 'ALLOCATION', status: 'PENDING' }).map((i) => i.id)).toEqual(['4']);
  });

  it('chênh lệch thu chi làm tròn, có thể âm', () => {
    expect(projectVoucherNet({ received: 10_000_000, paid: 3_500_000 })).toBe(6_500_000);
    expect(projectVoucherNet({ received: 100, paid: 250.5 })).toBe(-150.5);
    expect(projectVoucherNet({ received: 0.1 + 0.2, paid: 0 })).toBe(0.3);
  });

  it('phân loại phản hồi của Tài chính', async () => {
    const zero = { received: 0, paid: 0, pendingReceived: 0, pendingPaid: 0, receiptCount: 0, paymentCount: 0 };
    const list = { items: [], totals: zero, projectLevel: zero, workItems: [], truncated: false };
    await expect(classifyProjectVoucherResponse(new Response(JSON.stringify(list), { status: 200 }))).resolves.toEqual({ state: 'ok', data: list });
    // Bản Tài chính cũ chưa có phần chung/phần theo công việc: không làm vỡ màn hình.
    await expect(
      classifyProjectVoucherResponse(new Response(JSON.stringify({ items: [], totals: zero, truncated: true }), { status: 200 })),
    ).resolves.toEqual({ state: 'ok', data: { ...list, truncated: true } });
    await expect(classifyProjectVoucherResponse(new Response('<html>', { status: 200 }))).resolves.toMatchObject({ state: 'unavailable' });
    await expect(
      classifyProjectVoucherResponse(new Response(JSON.stringify({ code: 'FINANCE_FORBIDDEN', message: 'Bạn không có quyền xem thu chi của dự án này.' }), { status: 403 })),
    ).resolves.toEqual({ state: 'forbidden', message: 'Bạn không có quyền xem thu chi của dự án này.' });
    await expect(classifyProjectVoucherResponse(new Response('', { status: 403 }))).resolves.toMatchObject({ state: 'forbidden' });
    await expect(classifyProjectVoucherResponse(new Response(JSON.stringify({ code: 'FINANCE_NOT_FOUND' }), { status: 404 }))).resolves.toMatchObject({
      state: 'unavailable',
      message: expect.stringContaining('Không tìm thấy dự án'),
    });
    await expect(classifyProjectVoucherResponse(new Response('Not Found', { status: 404 }))).resolves.toMatchObject({
      state: 'unavailable',
      message: expect.stringContaining('chưa sẵn sàng'),
    });
    await expect(
      classifyProjectVoucherResponse(new Response(JSON.stringify({ code: 'FINANCE_WORKSPACE_UNAVAILABLE', message: 'Workspace đang không khả dụng.' }), { status: 409 })),
    ).resolves.toEqual({ state: 'unavailable', message: 'Workspace đang không khả dụng.' });
  });
});

describe('thu chi theo công việc', () => {
  const zero = { received: 0, paid: 0, pendingReceived: 0, pendingPaid: 0, receiptCount: 0, paymentCount: 0 };
  const list: Pick<ProjectVoucherList, 'workItems' | 'projectLevel'> = {
    projectLevel: { ...zero, received: 20_000_000, paid: 2_000_000, pendingPaid: 500_000 },
    workItems: [
      { ...zero, workItemId: 'w1', code: 'CV001', title: 'Soạn thảo', paid: 5_000_000, received: 1_000_000 },
      { ...zero, workItemId: 'wx', code: 'CV009', title: 'Việc đã gỡ', paid: 700_000 },
    ],
  };
  const workItems = [
    { workItemId: 'w1', code: 'CV001', title: 'Soạn thảo', status: 'in_progress' as const },
    { workItemId: 'w2', code: 'CV002', title: 'Chưa có phiếu', status: 'todo' as const },
  ];

  it('mỗi công việc của Workspace có một dòng, kể cả việc chưa có phiếu; việc chỉ có ở Tài chính vẫn hiện', () => {
    const rows = buildWorkItemMoneyRows(workItems, list);
    expect(rows.map((r) => r.code)).toEqual(['CV001', 'CV002', 'CV009']);
    expect(rows[0]).toMatchObject({ workItemId: 'w1', status: 'in_progress', paid: 5_000_000, received: 1_000_000, balance: -4_000_000 });
    expect(rows[1]).toMatchObject({ paid: 0, received: 0, balance: 0, pendingPaid: 0 });
    expect(rows[2]).toMatchObject({ workItemId: 'wx', status: null, title: 'Việc đã gỡ', paid: 700_000 });
  });

  it('dòng chung của dự án; tổng các dòng khớp tổng hạch toán', () => {
    const project = projectLevelMoneyRow(list);
    expect(project).toMatchObject({ workItemId: null, received: 20_000_000, paid: 2_000_000, pendingPaid: 500_000, balance: 18_000_000 });
    const rows = [project, ...buildWorkItemMoneyRows(workItems, list)];
    expect(rows.reduce((sum, r) => sum + r.paid, 0)).toBe(2_000_000 + 5_000_000 + 700_000);
  });

  it('lợi nhuận thực tế = đã thu - đã chi, không phụ thuộc giá trị hợp đồng; biên tính trên đã thu', () => {
    // Dự án mẫu: thu 250 triệu (vượt hợp đồng 200 triệu), chi 1,3 triệu.
    expect(actualProfit(250_000_000, 1_300_000)).toEqual({ profit: 248_700_000, margin: 99.5 });
    expect(actualProfit(100, 150)).toEqual({ profit: -50, margin: -50 });
    expect(actualProfit(0, 5)).toEqual({ profit: -5, margin: null });
    expect(actualProfit(0, 0)).toEqual({ profit: 0, margin: null });
    expect(actualProfit(0.1 + 0.2, 0).profit).toBe(0.3);
  });

  it('chuẩn hoá phản hồi thiếu trường', () => {
    expect(normalizeProjectVoucherList({})).toEqual({ items: [], totals: zero, projectLevel: zero, workItems: [], truncated: false });
  });
});
