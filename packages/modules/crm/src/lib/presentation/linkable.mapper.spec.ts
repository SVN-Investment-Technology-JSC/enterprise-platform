import type {
  ContractSummary,
  Lead,
  QuoteSummary,
  ReceiptDetail,
  SalesOrderSummary,
  WarrantyCaseDetail,
} from '@enterprise-platform/contracts-crm';
import {
  CRM_LINKABLE_KIND_LIST,
  contractObject,
  crmLaunchUrl,
  isCrmLinkableKind,
  leadObject,
  orderObject,
  quoteObject,
  receiptCandidate,
  receiptMatches,
  receiptObject,
  warrantyObject,
} from './linkable.mapper.js';

const contract: ContractSummary = {
  id: 'c-1',
  code: 'HD-001',
  type: 'SALE',
  title: 'Cung cấp tủ điện nhà máy A',
  customerId: 'k-1',
  customerCode: 'KH01',
  customerName: 'Công ty A',
  status: 'ACTIVE' as ContractSummary['status'],
  validFrom: '2026-01-05',
  validTo: '2026-12-31',
  value: 1_200_000_000,
  ownerUserId: 'u-1',
  quoteId: 'q-1',
  quoteCode: 'BG-010',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('Bán hàng công bố đối tượng liên kết', () => {
  it('loại theo thứ tự chuỗi nghiệp vụ, đều thuộc module crm', () => {
    expect(CRM_LINKABLE_KIND_LIST.map((kind) => kind.key)).toEqual([
      'crm.opportunity',
      'crm.quote',
      'crm.contract',
      'crm.order',
      'crm.customer',
      'crm.lead',
      'crm.warranty',
      'crm.receipt',
    ]);
    // Loại mới không điền sẵn form dự án; khoá loại cũ giữ nguyên.
    expect(CRM_LINKABLE_KIND_LIST.filter((kind) => !kind.prefill).map((kind) => kind.key)).toEqual([
      'crm.lead',
      'crm.warranty',
      'crm.receipt',
    ]);
    expect(CRM_LINKABLE_KIND_LIST.find((kind) => kind.key === 'crm.receipt')?.label).toBe('Phiếu thu (công nợ)');
    expect(isCrmLinkableKind('crm.contract')).toBe(true);
    expect(isCrmLinkableKind('finance.receipt')).toBe(false);
  });

  it('đường dẫn mở hồ sơ là đường dẫn nội bộ theo hash của Bán hàng', () => {
    expect(crmLaunchUrl('crm.contract', 'c-1')).toBe('/modules/crm#contracts/c-1');
    expect(crmLaunchUrl('crm.quote', 'q 1')).toBe('/modules/crm#quotes/q%201');
  });

  it('hợp đồng: nhãn không chứa số tiền, số tiền chỉ ở fields, gợi ý chuỗi và điền sẵn', () => {
    const object = contractObject({ ...contract, signedDate: '2026-01-02', warrantyMonths: 12 }, {
      id: 'o-1',
      name: 'Dự án nhà máy A',
    });
    expect(object.label).toBe('HD-001 — Cung cấp tủ điện nhà máy A');
    expect(object.label).not.toMatch(/\d{3}\.\d{3}|1200000000/);
    expect(object.fields.find((field) => field.key === 'value')).toEqual({
      key: 'value',
      label: 'Giá trị hợp đồng',
      type: 'money',
      value: 1_200_000_000,
    });
    expect(object.upstream).toEqual([
      { kind: 'crm.quote', id: 'q-1', code: 'BG-010', label: 'BG-010' },
      { kind: 'crm.opportunity', id: 'o-1', label: 'Dự án nhà máy A' },
    ]);
    expect(object.prefill).toEqual({
      title: 'Cung cấp tủ điện nhà máy A',
      crmCustomerId: 'k-1',
      startDate: '2026-01-05',
      endDate: '2026-12-31',
      contractValue: 1_200_000_000,
    });
    expect(object.launchUrl).toBe('/modules/crm#contracts/c-1');
  });

  it('hợp đồng không đi từ báo giá thì không có chuỗi phía trước', () => {
    expect(contractObject({ ...contract, quoteId: null, quoteCode: null }, null).upstream).toEqual([]);
  });

  it('báo giá trỏ về cơ hội; đơn hàng trỏ về hợp đồng và báo giá', () => {
    const quote = quoteObject({
      id: 'q-1',
      code: 'BG-010',
      opportunityId: 'o-1',
      opportunityName: 'Dự án nhà máy A',
      customerId: 'k-1',
      customerCode: 'KH01',
      customerName: 'Công ty A',
      ownerUserId: 'u-1',
      status: 'ACCEPTED' as QuoteSummary['status'],
      currentVersion: 2,
      quoteName: null,
      validUntil: null,
      totalAmount: 900_000_000,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(quote.upstream).toEqual([{ kind: 'crm.opportunity', id: 'o-1', label: 'Dự án nhà máy A' }]);
    expect(quote.label).toBe('BG-010 — Dự án nhà máy A');

    const order = orderObject({
      id: 'so-1',
      code: 'DH-001',
      source: 'CONTRACT' as SalesOrderSummary['source'],
      customerId: 'k-1',
      customerCode: 'KH01',
      customerName: 'Công ty A',
      contractId: 'c-1',
      contractCode: 'HD-001',
      quoteId: 'q-1',
      quoteCode: 'BG-010',
      status: 'CONFIRMED' as SalesOrderSummary['status'],
      orderDate: '2026-02-01',
      expectedDeliveryDate: null,
      totalAmount: 300_000_000,
      ownerUserId: 'u-1',
      late: false,
      updatedAt: '2026-02-01T00:00:00.000Z',
    });
    expect(order.upstream.map((ref) => ref.kind)).toEqual(['crm.contract', 'crm.quote']);
    expect(order.label).toBe('DH-001 — Công ty A');
    expect(order.prefill?.endDate).toBeUndefined();
  });

  it('lead: không có màn chi tiết nên mở danh sách Lead; nhãn là tên', () => {
    const lead: Lead = {
      id: 'l-1',
      name: 'Nhà máy B',
      contactName: 'Anh Bình',
      taxCode: '0101',
      phone: '0900',
      email: null,
      source: 'Hội chợ',
      need: 'Tủ điện',
      note: null,
      ownerUserId: 'u-1',
      status: 'WORKING',
      convertedCustomerId: null,
      convertedOpportunityId: null,
      convertedAt: null,
      version: 1,
      createdAt: '2026-03-01T02:00:00.000Z',
      updatedAt: '2026-03-01T02:00:00.000Z',
    };
    const object = leadObject(lead);
    expect(object.label).toBe('Nhà máy B');
    expect(object.status).toBe('Đang chăm sóc');
    expect(object.launchUrl).toBe('/modules/crm#leads');
    expect(object.prefill).toBeUndefined();
    expect(object.fields.find((field) => field.key === 'createdAt')).toMatchObject({ type: 'date', value: '2026-03-01' });
  });

  it('bảo hành: mở thẳng yêu cầu, trỏ về đơn hàng và hợp đồng', () => {
    const detail = {
      id: 'w-1',
      code: 'BH-001',
      customerId: 'k-1',
      customerCode: 'KH01',
      customerName: 'Công ty A',
      orderId: 'so-1',
      orderCode: 'DH-001',
      contractId: 'c-1',
      cause: 'TECHNICAL_FAULT',
      status: 'INSPECTING',
      chargeable: false,
      lineCount: 2,
      serials: ['S1', 'S2'],
      ownerUserId: 'u-1',
      assigneeUserId: null,
      createdAt: '2026-04-02T03:00:00.000Z',
      updatedAt: '2026-04-02T03:00:00.000Z',
      description: 'Không lên nguồn',
      quarantineWarehouseCode: null,
      rejectReason: null,
      revision: 1,
      lines: [],
      documents: [],
      history: [],
    } as WarrantyCaseDetail;
    const object = warrantyObject(detail);
    expect(object.label).toBe('BH-001 — Công ty A');
    expect(object.status).toBe('Đang kiểm định');
    expect(object.launchUrl).toBe('/modules/crm#warranty/w-1');
    expect(object.upstream).toEqual([
      { kind: 'crm.order', id: 'so-1', code: 'DH-001', label: 'DH-001' },
      { kind: 'crm.contract', id: 'c-1', label: 'Hợp đồng' },
    ]);
    expect(object.fields.find((field) => field.key === 'serials')?.value).toBe('S1, S2');
  });

  it('phiếu thu: nhãn không chứa số tiền, mở sổ công nợ của khách, trỏ về đơn đã phân bổ', () => {
    const receipt = {
      id: 'r-1',
      code: 'PT-001',
      customerId: 'k-1',
      customerCode: 'KH01',
      customerName: 'Công ty Ánh Đạt',
      amount: 50_000_000,
      allocatedAmount: 30_000_000,
      method: 'BANK_TRANSFER',
      receiptDate: '2026-05-03',
      status: 'POSTED',
      financeVoucherId: 'v-1',
      financeVoucherCode: 'PT-TC-01',
      createdBy: 'u-1',
      createdAt: '2026-05-03T00:00:00.000Z',
      updatedAt: '2026-05-03T00:00:00.000Z',
      note: null,
      voucherError: null,
      returnReason: null,
      postedAt: null,
      reversedAt: null,
      revision: 1,
      allocations: [
        { id: 'a-1', entryId: 'e-1', orderId: 'so-1', orderCode: 'DH-001', entryDescription: null, dueDate: null, amount: 20_000_000, effective: true },
        { id: 'a-2', entryId: 'e-2', orderId: 'so-1', orderCode: 'DH-001', entryDescription: null, dueDate: null, amount: 10_000_000, effective: true },
      ],
      history: [],
    } as ReceiptDetail;
    const object = receiptObject(receipt);
    expect(object.label).toBe('PT-001 — Công ty Ánh Đạt');
    expect(`${object.label} ${object.hint}`).not.toMatch(/50000000|50\.000\.000/);
    expect(object.launchUrl).toBe('/modules/crm#receivables/k-1');
    expect(object.fields.find((field) => field.key === 'amount')).toEqual({
      key: 'amount',
      label: 'Số tiền thu',
      type: 'money',
      value: 50_000_000,
    });
    expect(object.upstream).toEqual([{ kind: 'crm.order', id: 'so-1', code: 'DH-001', label: 'DH-001' }]);
    expect(receiptCandidate(receipt).hint).toBe('2026-05-03 — Chuyển khoản');
    expect(receiptMatches(receipt, undefined)).toBe(true);
    expect(receiptMatches(receipt, 'anh dat')).toBe(true);
    expect(receiptMatches(receipt, 'pt-001')).toBe(true);
    expect(receiptMatches(receipt, 'KH02')).toBe(false);
  });
});
