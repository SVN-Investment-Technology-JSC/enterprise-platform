import type { FinanceVoucherSummary } from '@enterprise-platform/contracts-finance';
import type { FinanceApplication } from '../application/finance.application.js';
import type { FinanceActor } from '../domain/finance.access.js';
import { FinanceError, notFound } from '../domain/finance.error.js';
import { LinkableController } from './linkable.controller.js';
import {
  FINANCE_LINKABLE_KIND_LIST,
  financeLaunchUrl,
  financeLinkableKinds,
  isFinanceLinkableKind,
  voucherCandidate,
  voucherObject,
} from './linkable.mapper.js';

const receipt: FinanceVoucherSummary = {
  id: 'v-1',
  kind: 'RECEIPT',
  code: 'PT-2611-0012',
  voucherDate: '2026-11-20',
  postingDate: '2026-11-21',
  content: 'Thu tiền tạm ứng hợp đồng tủ điện nhà máy A',
  reasonId: 'r-1',
  reasonName: 'Thu tiền khách hàng',
  accountId: 'a-1',
  accountName: 'Vietcombank 0011',
  destAccountId: null,
  destAccountName: null,
  counterpartyGroupName: 'Khách hàng',
  counterpartyName: 'Công ty A',
  totalAmount: 150_000_000,
  status: 'APPROVED',
  createdBy: 'u-1',
  createdByName: 'Nguyễn Văn B',
  createdAt: '2026-11-20T02:00:00.000Z',
  updatedAt: '2026-11-21T02:00:00.000Z',
  submittedAt: null,
  decidedAt: null,
  approvalMode: 'DIRECT' as FinanceVoucherSummary['approvalMode'],
  allocation: {
    type: 'PROJECT',
    projectId: 'p-1',
    projectCode: 'DA001',
    projectName: 'Nhà máy A',
    workItemId: null,
    workItemCode: null,
    workItemTitle: null,
  },
  draftCode: 'NHAP_PT_2611_0012',
  officialCode: 'PT-2611-0012',
  sourceCode: null,
};

const transfer: FinanceVoucherSummary = {
  ...receipt,
  id: 't-1',
  kind: 'TRANSFER',
  code: 'CT-2611-0003',
  content: 'Chuyển quỹ về ngân hàng',
  reasonId: null,
  reasonName: null,
  accountName: 'Quỹ tiền mặt',
  destAccountId: 'a-1',
  destAccountName: 'Vietcombank 0011',
  counterpartyGroupName: null,
  counterpartyName: null,
  allocation: null,
  status: 'PENDING',
};

const actor = (permissions: string[]): FinanceActor => ({ tenantId: 't', userId: 'u-1', displayName: 'B', permissions });

describe('Tài chính công bố đối tượng liên kết', () => {
  it('ba loại phiếu theo thứ tự, đều thuộc module finance, không điền sẵn', () => {
    expect(FINANCE_LINKABLE_KIND_LIST.map((kind) => [kind.key, kind.label])).toEqual([
      ['finance.receipt', 'Phiếu thu'],
      ['finance.payment', 'Phiếu chi'],
      ['finance.transfer', 'Lệnh chuyển tiền'],
    ]);
    expect(FINANCE_LINKABLE_KIND_LIST.every((kind) => kind.moduleLabel === 'Tài chính' && kind.prefill === false)).toBe(true);
    expect(FINANCE_LINKABLE_KIND_LIST.every((kind) => /^finance\.[a-z][a-z0-9-]*$/.test(kind.key))).toBe(true);
    expect(isFinanceLinkableKind('finance.payment')).toBe(true);
    expect(isFinanceLinkableKind('crm.contract')).toBe(false);
  });

  it('chỉ công bố loại người dùng vào được danh sách', () => {
    expect(financeLinkableKinds(actor(['finance.payment.create'])).map((kind) => kind.key)).toEqual(['finance.payment']);
    expect(financeLinkableKinds(actor(['finance.receipt.approve', 'finance.transfer.create'])).map((kind) => kind.key)).toEqual([
      'finance.receipt',
      'finance.transfer',
    ]);
    expect(financeLinkableKinds(actor(['finance.read']))).toHaveLength(3);
    expect(financeLinkableKinds(actor(['tenant.manage']))).toHaveLength(3);
    expect(financeLinkableKinds(actor(['finance.report.read']))).toEqual([]);
  });

  it('đường dẫn mở phiếu là trang chi tiết của Tài chính, chỉ gồm ký tự hợp đồng cho phép', () => {
    expect(financeLaunchUrl('finance.receipt', 'v-1')).toBe('/modules/finance/receipts/v-1');
    expect(financeLaunchUrl('finance.transfer', 't-1')).toBe('/modules/finance/transfers/t-1');
    const odd = financeLaunchUrl('finance.payment', "a b(!)'*");
    expect(odd).toBe('/modules/finance/payments/a%20b%28%21%29%27%2A');
    expect(odd).toMatch(/^\/modules\/[A-Za-z0-9._~\-/#?=&%]*$/);
  });

  it('phiếu thu: nhãn không chứa số tiền, số tiền chỉ ở fields, trạng thái đã dịch', () => {
    const candidate = voucherCandidate(receipt);
    expect(candidate).toEqual({
      kind: 'finance.receipt',
      id: 'v-1',
      code: 'PT-2611-0012',
      label: 'PT-2611-0012 — Thu tiền tạm ứng hợp đồng tủ điện nhà máy A',
      status: 'Đã duyệt',
      hint: 'Công ty A — 2026-11-20',
    });
    const object = voucherObject(receipt);
    expect(object.label).not.toMatch(/150|000/);
    expect(object.launchUrl).toBe('/modules/finance/receipts/v-1');
    expect(object.upstream).toEqual([]);
    expect(object.prefill).toBeUndefined();
    const byKey = Object.fromEntries(object.fields.map((field) => [field.key, field]));
    expect(byKey['totalAmount']).toEqual({ key: 'totalAmount', label: 'Tổng tiền', type: 'money', value: 150_000_000 });
    expect(byKey['postingDate']).toEqual({ key: 'postingDate', label: 'Ngày hạch toán', type: 'date', value: '2026-11-21' });
    expect(byKey['reason']?.label).toBe('Lý do thu');
    expect(byKey['counterparty']).toMatchObject({ label: 'Người nộp tiền', value: 'Công ty A' });
    expect(byKey['allocation']?.value).toBe('DA001 - Nhà máy A');
    expect(byKey['createdBy']?.value).toBe('Nguyễn Văn B');
    expect(byKey['source']?.value).toBeNull();
    expect(byKey['destAccount']).toBeUndefined();
  });

  it('nội dung dài bị cắt ngắn trong nhãn', () => {
    const label = voucherCandidate({ ...receipt, content: 'x'.repeat(200) }).label;
    expect(label.length).toBeLessThanOrEqual('PT-2611-0012 — '.length + 80);
    expect(label.endsWith('…')).toBe(true);
  });

  it('lệnh chuyển tiền: hai tài khoản, không có lý do hay đối tượng', () => {
    expect(voucherCandidate(transfer).hint).toBe('Quỹ tiền mặt → Vietcombank 0011 — 2026-11-20');
    const object = voucherObject(transfer);
    expect(object.status).toBe('Nháp'); // chỉ hai trạng thái hiển thị: chờ duyệt vẫn là "Nháp"
    const keys = object.fields.map((field) => field.key);
    expect(keys).toContain('destAccount');
    expect(keys).not.toContain('reason');
    expect(keys).not.toContain('counterparty');
    expect(object.fields.find((field) => field.key === 'account')?.label).toBe('Tài khoản nguồn');
  });

  it('phiếu từ hồ sơ quy trình hiện nguồn quy trình', () => {
    const object = voucherObject({
      ...receipt,
      kind: 'PAYMENT',
      sourceCode: 'HS-0042',
      source: { sourceModule: 'procedure-engine', instanceCode: 'HS-0042', instanceTitle: 'Tạm ứng', definitionName: 'Đề nghị tạm ứng' },
    });
    expect(object.kind).toBe('finance.payment');
    expect(object.fields.find((field) => field.key === 'source')).toEqual({
      key: 'source',
      label: 'Nguồn quy trình',
      type: 'text',
      value: 'HS-0042 — Đề nghị tạm ứng',
    });
  });
});

describe('LinkableController của Tài chính', () => {
  const request = { financeActor: actor(['finance.read']) };

  it('tìm theo đúng loại phiếu, q rỗng thì lấy mới nhất, cắt theo limit', async () => {
    const listVouchers = jest.fn().mockResolvedValue({ items: Array.from({ length: 50 }, (_, i) => ({ ...receipt, id: `v-${i}` })) });
    const controller = new LinkableController({ listVouchers } as unknown as FinanceApplication);
    const result = await controller.search(request, 'finance.receipt', '  ', '25');
    expect(listVouchers).toHaveBeenCalledWith(request.financeActor, { kind: 'RECEIPT', search: undefined, page: 1, pageSize: 50 });
    expect(result.items).toHaveLength(25);
    await controller.search(request, 'finance.payment', 'PC-01', undefined);
    expect(listVouchers).toHaveBeenLastCalledWith(request.financeActor, { kind: 'PAYMENT', search: 'PC-01', page: 1, pageSize: 20 });
  });

  it('loại lạ bị từ chối 400; lỗi quyền của service thành HTTP như controller Tài chính', async () => {
    const listVouchers = jest.fn().mockRejectedValue(new FinanceError('FINANCE_FORBIDDEN', 'Không có quyền.', 403));
    const controller = new LinkableController({ listVouchers } as unknown as FinanceApplication);
    await expect(controller.search(request, 'crm.contract')).rejects.toMatchObject({ status: 400 });
    await expect(controller.search(request, 'finance.receipt')).rejects.toMatchObject({ status: 403 });
  });

  it('resolve bỏ qua phiếu không thấy, sai loại, id sai định dạng; lỗi khác ném tiếp', async () => {
    const voucher = jest.fn(async (_actor: FinanceActor, id: string) => {
      if (id === 'v-1') return receipt;
      if (id === 't-1') return transfer;
      if (id === 'bad') throw Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' });
      throw notFound('phiếu');
    });
    const controller = new LinkableController({ voucher } as unknown as FinanceApplication);
    const result = await controller.resolve(request, 'finance.receipt', 'v-1,t-1,bad,missing,v-1');
    expect(result.items.map((item) => item.id)).toEqual(['v-1']);
    expect(voucher).toHaveBeenCalledTimes(4);

    voucher.mockRejectedValueOnce(new Error('boom'));
    await expect(controller.resolve(request, 'finance.receipt', 'x')).rejects.toThrow('boom');
  });

  it('kinds theo quyền của người gọi; thiếu danh tính thì 401', async () => {
    const controller = new LinkableController({} as FinanceApplication);
    expect((await controller.kinds({ financeActor: actor(['finance.transfer.approve']) })).kinds.map((kind) => kind.key)).toEqual([
      'finance.transfer',
    ]);
    await expect(controller.kinds({})).rejects.toMatchObject({ status: 401 });
  });
});
