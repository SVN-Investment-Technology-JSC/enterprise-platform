import {
  NO_VOUCHER_FILTER,
  classifyProjectVoucherResponse,
  filterProjectVouchers,
  projectVoucherHref,
  projectVoucherNet,
  type ProjectVoucher,
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

describe('tab Thu chi của dự án', () => {
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
    const list = { items: [], totals: { received: 0, paid: 0, pendingReceived: 0, pendingPaid: 0, receiptCount: 0, paymentCount: 0 }, truncated: false };
    await expect(classifyProjectVoucherResponse(new Response(JSON.stringify(list), { status: 200 }))).resolves.toEqual({ state: 'ok', data: list });
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
