import {
  CRM_NO_CAPABILITIES,
  DEFAULT_QUOTE_APPROVAL_SETTINGS,
  type ApprovalBinding,
  type QuoteDetail,
  type QuoteLine,
  type QuoteStatus,
  type QuoteVersion,
} from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './crm-actor.js';
import type { CrmDataScopeService } from './data-scope.js';
import type { CatalogMaterial, CatalogReader, PricingStore } from './pricing-store.port.js';
import type { ApprovalLinks, EditableQuote, QuoteSettingsStore, QuoteStore } from './quote-store.port.js';
import { QuoteService } from './quote.service.js';
import type { CustomerStore, OpportunityStore } from './sales-store.port.js';

const QUOTE_ID = '40000000-0000-4000-8000-000000000001';
const CAP = '11111111-1111-4111-8111-111111111111';
const BT = '22222222-2222-4222-8222-222222222222';
const NV1 = '00000000-0000-4000-8000-000000000001';
const TN = '00000000-0000-4000-8000-000000000002';

const seller: CrmActor = { ...CRM_NO_CAPABILITIES, tenantId: 't1', userId: NV1, displayName: 'NV1', canWriteQuote: true };
const lead: CrmActor = { ...seller, userId: TN, displayName: 'TN', canApproveQuote: true };

class FakeCatalog implements CatalogReader {
  calls = 0;
  constructor(private readonly known: CatalogMaterial[]) {}
  async materials(_tenant: string, ids: readonly string[]) {
    this.calls += 1;
    return new Map(this.known.filter((material) => ids.includes(material.id)).map((material) => [material.id, material]));
  }
  async search() {
    return this.known;
  }
}

const catalog = () =>
  new FakeCatalog([
    { id: CAP, code: 'QA-KHO-CAP', name: 'Cáp', unit: 'Cái', category: null, kind: 'STOCK', avgCost: 800_000, totalAvailable: 70 },
    { id: BT, code: 'QA-KHO-BT', name: 'Gói bảo trì', unit: 'Gói', category: null, kind: 'SERVICE', avgCost: null, totalAvailable: null },
  ]);

const pricing: PricingStore = {
  discountCapPercent: async () => 50,
  saveDiscountCapPercent: async () => undefined,
  priceListsForPricing: async () => [
    {
      id: 'pl',
      code: 'BG-CHUAN',
      isStandard: true,
      validFrom: '2026-01-01',
      validTo: null,
      status: 'ACTIVE',
      customerGroupIds: [],
      items: [
        { materialId: CAP, unit: 'Cái', price: 1_000_000, vatRate: 10 },
        { materialId: BT, unit: 'Gói', price: 500_000, vatRate: 10 },
      ],
    },
  ],
  policiesForPricing: async () => [],
};

function quoteLine(extra: Partial<QuoteLine>): QuoteLine {
  return {
    id: 'line-1',
    lineNo: 1,
    materialId: CAP,
    materialCode: 'QA-KHO-CAP',
    materialName: 'Cáp',
    unit: 'Cái',
    materialKind: 'STOCK',
    category: null,
    quantity: 10,
    listPrice: 1_000_000,
    priceSource: 'STANDARD_LIST',
    priceReferenceCode: 'BG-CHUAN',
    appliedPolicies: [],
    policyPercent: 0,
    discountPercent: 0,
    cappedAt: null,
    overridden: false,
    overrideUnitPrice: null,
    overrideDiscountPercent: null,
    unitPrice: 1_000_000,
    grossAmount: 10_000_000,
    discountAmount: 0,
    vatRate: 10,
    lineAmount: 10_000_000,
    vatAmount: 1_000_000,
    lineTotal: 11_000_000,
    estUnitCost: 800_000,
    estCost: 8_000_000,
    margin: 20,
    availableStock: null,
    ...extra,
  };
}

function version(status: QuoteStatus, versionNo = 1, lines: QuoteLine[] = [quoteLine({})], submittedBy: string | null = null): QuoteVersion {
  const net = lines.reduce((sum, line) => sum + line.lineAmount, 0);
  const gross = lines.reduce((sum, line) => sum + line.grossAmount, 0);
  const cost = lines.reduce((sum, line) => sum + line.estCost, 0);
  return {
    id: `v-${versionNo}`,
    versionNo,
    status,
    revision: 3,
    validUntil: '2099-12-31',
    priceDate: null,
    pricedOn: null,
    note: null,
    shipping: { amount: 0, vatRate: 10, cost: 0 },
    totals: {
      grossAmount: gross,
      discountAmount: gross - net,
      netAmount: net,
      shippingAmount: 0,
      vatAmount: net / 10,
      totalAmount: net * 1.1,
      estCost: cost,
      profit: net - cost,
      marginPercent: net ? Math.round(((net - cost) / net) * 10000) / 100 : null,
      discountPercent: gross ? Math.round(((gross - net) / gross) * 1000000) / 10000 : 0,
    },
    requiresApproval: false,
    approvalReasons: [],
    submittedAt: null,
    submittedBy,
    approvedAt: null,
    approvedBy: null,
    rejectedAt: null,
    rejectedBy: null,
    decisionReason: null,
    sentAt: null,
    respondedAt: null,
    supersededAt: null,
    createdAt: '',
    lines,
  };
}

function setup(current: QuoteVersion, options: { currentVersion?: number; binding?: Partial<ApprovalBinding>; procedure?: QuoteDetail['procedure'] } = {}) {
  const currentVersion = options.currentVersion ?? current.versionNo;
  const editable = (): EditableQuote => ({
    head: {
      id: QUOTE_ID,
      code: 'BG2600001',
      opportunityId: null,
      customerId: 'c1',
      customerName: 'Công ty A',
      customerGroupId: null,
      ownerUserId: NV1,
      status: current.status,
      currentVersion,
    },
    version: current,
  });
  const detail = (): QuoteDetail => ({
    id: QUOTE_ID,
    code: 'BG2600001',
    opportunityId: null,
    opportunityName: null,
    customerId: 'c1',
    customerCode: 'KH1',
    customerName: 'Công ty A',
    ownerUserId: NV1,
    status: current.status,
    currentVersion,
    validUntil: current.validUntil,
    totalAmount: current.totals.totalAmount,
    updatedAt: '',
    acceptedVersion: null,
    convertedAt: null,
    createdAt: '',
    versions: [],
    version: current,
    procedure: options.procedure ?? null,
    history: [],
    approvalCheck: null,
  });
  const quotes = {
    getQuote: jest.fn(async () => detail()),
    loadForEdit: jest.fn(async () => editable()),
    saveVersion: jest.fn(async () => 2),
    submit: jest.fn(async (_t: string, _q: string, _b: unknown, submission: { procedure: unknown }) => (submission.procedure ? 'link-1' : null)),
    transition: jest.fn(async () => undefined),
  } as unknown as jest.Mocked<QuoteStore>;
  const settings: QuoteSettingsStore = {
    approvalSettings: async () => DEFAULT_QUOTE_APPROVAL_SETTINGS,
    saveApprovalSettings: async () => undefined,
    bindings: async () => [],
    binding: async (_t, kind) => ({
      kind,
      mode: 'DIRECT',
      procedureDefinitionId: null,
      procedureDefinitionName: null,
      updatedAt: null,
      ...options.binding,
    }),
    saveBinding: async () => undefined,
  };
  const links = { start: jest.fn(async () => undefined) } as unknown as jest.Mocked<ApprovalLinks>;
  const scopes = { resolve: jest.fn(async () => ({ kind: 'all' as const })) } as unknown as CrmDataScopeService;
  const reportingLines = {
    snapshot: async () => ({
      positions: [
        { id: 'p-tn', reportsToPositionId: null },
        { id: 'p-nv1', reportsToPositionId: 'p-tn' },
      ],
      assignments: [
        { userId: TN, positionId: 'p-tn' },
        { userId: NV1, positionId: 'p-nv1' },
      ],
    }),
  };
  const fakeCatalog = catalog();
  const service = new QuoteService(
    quotes,
    settings,
    pricing,
    fakeCatalog,
    {} as CustomerStore,
    {} as OpportunityStore,
    scopes,
    links,
    reportingLines,
    () => new Date('2026-10-27T03:00:00Z'),
  );
  return { service, quotes, links, catalog: fakeCatalog };
}

describe('QuoteService', () => {
  it('TC-QUO-01/02/03: thêm dòng lấy mặt hàng, giá vốn từ danh mục Kho; dịch vụ không cần tồn', async () => {
    const { service, quotes } = setup(version('DRAFT', 1, []));
    await service.addLine(seller, QUOTE_ID, '1', { revision: 3, materialId: CAP, quantity: 10 });
    const write = quotes.saveVersion.mock.calls[0][4];
    expect(quotes.saveVersion.mock.calls[0][3]).toBe('IN_PLACE');
    expect(write.lines[0]).toMatchObject({ materialCode: 'QA-KHO-CAP', unit: 'Cái', estUnitCost: 800_000, estCost: 8_000_000, margin: 20 });

    await service.addLine(seller, QUOTE_ID, '1', { revision: 3, materialId: BT, quantity: 5 });
    const service5 = quotes.saveVersion.mock.calls[1][4].lines[0];
    expect(service5).toMatchObject({ materialKind: 'SERVICE', unit: 'Gói', estUnitCost: null, lineAmount: 2_500_000 });
  });

  it('mặt hàng không có trong danh mục Kho: 400', async () => {
    const { service } = setup(version('DRAFT', 1, []));
    await expect(
      service.addLine(seller, QUOTE_ID, '1', { revision: 3, materialId: '99999999-9999-4999-8999-999999999999', quantity: 1 }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'MATERIAL_NOT_FOUND' });
  });

  it('TC-QUO-05: sửa phiên bản Đã duyệt sinh phiên bản mới với dòng mới', async () => {
    const { service, quotes } = setup(version('APPROVED'));
    await service.updateLine(seller, QUOTE_ID, '1', 'line-1', { revision: 3, materialId: CAP, quantity: 12 });
    expect(quotes.saveVersion.mock.calls[0][3]).toBe('NEW_VERSION');
    const write = quotes.saveVersion.mock.calls[0][4];
    expect(write.lines[0].quantity).toBe(12);
    expect(write.lines[0].id).not.toBe('line-1');
  });

  it('TC-QUO-06: sửa phiên bản cũ trả 409, không ghi', async () => {
    const { service, quotes } = setup(version('SUPERSEDED', 1), { currentVersion: 2 });
    await expect(
      service.updateLine(seller, QUOTE_ID, '1', 'line-1', { revision: 3, materialId: CAP, quantity: 1 }),
    ).rejects.toMatchObject({ statusCode: 409, message: 'Phiên bản cũ chỉ đọc.' });
    expect(quotes.saveVersion).not.toHaveBeenCalled();
  });

  it('revision cũ: 409, không ghi', async () => {
    const { service, quotes } = setup(version('DRAFT'));
    await expect(service.recalculate(seller, QUOTE_ID, '1', { revision: 2 })).rejects.toMatchObject({ code: 'STALE_VERSION' });
    expect(quotes.saveVersion).not.toHaveBeenCalled();
  });

  it('không có crm.quote.write: 403', async () => {
    const { service } = setup(version('DRAFT'));
    await expect(service.recalculate({ ...seller, canWriteQuote: false }, QUOTE_ID, '1', { revision: 3 })).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('TC-QUO-08: không vượt ngưỡng thì duyệt thẳng, không tạo phiên Quy trình', async () => {
    const { service, quotes, links } = setup(version('DRAFT', 1, [quoteLine({ discountPercent: 3, lineAmount: 9_700_000, estCost: 8_000_000 })]));
    await service.submit(seller, QUOTE_ID, '1', { revision: 3 });
    expect(quotes.submit.mock.calls[0][3]).toMatchObject({ outcome: 'APPROVED', procedure: null, approvalRequested: null });
    expect(links.start).not.toHaveBeenCalled();
  });

  it('TC-INT-01: vượt ngưỡng, cấu hình Quy trình: Chờ duyệt, tạo liên kết và gọi tạo phiên', async () => {
    const { service, quotes, links } = setup(
      version('DRAFT', 1, [quoteLine({ discountPercent: 12, grossAmount: 10_000_000, lineAmount: 8_800_000, estCost: 7_000_000 })]),
      { binding: { mode: 'PROCEDURE', procedureDefinitionId: 'def-1' } },
    );
    await service.submit(seller, QUOTE_ID, '1', { revision: 3 });
    const submission = quotes.submit.mock.calls[0][3];
    expect(submission.outcome).toBe('PENDING');
    expect(submission.procedure).toEqual({ definitionId: 'def-1', title: 'Duyệt báo giá BG2600001 v1 - Công ty A' });
    expect(submission.approvalRequested?.recipientUserIds).toEqual([]);
    expect(submission.reasons.map((reason) => reason.code)).toEqual(['DISCOUNT_OVER_LIMIT']);
    expect(links.start).toHaveBeenCalledWith('t1', 'link-1');
  });

  it('vượt ngưỡng, duyệt trực tiếp: Chờ duyệt, báo cấp trên gần nhất', async () => {
    const { service, quotes, links } = setup(version('DRAFT', 1, [quoteLine({ overridden: true })]));
    await service.submit(seller, QUOTE_ID, '1', { revision: 3 });
    const submission = quotes.submit.mock.calls[0][3];
    expect(submission).toMatchObject({ outcome: 'PENDING', procedure: null });
    expect(submission.approvalRequested?.recipientUserIds).toEqual([TN]);
    expect(links.start).not.toHaveBeenCalled();
  });

  it('gửi duyệt báo giá trống hoặc đã gửi: lỗi', async () => {
    await expect(setup(version('DRAFT', 1, [])).service.submit(seller, QUOTE_ID, '1', { revision: 3 })).rejects.toMatchObject({
      code: 'QUOTE_EMPTY',
    });
    await expect(setup(version('PENDING')).service.submit(seller, QUOTE_ID, '1', { revision: 3 })).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('TC-PERM-06: không có crm.quote.approve thì không duyệt được', async () => {
    const { service, quotes } = setup(version('PENDING', 1, undefined, NV1));
    await expect(service.approve(seller, QUOTE_ID, '1', { revision: 3 })).rejects.toMatchObject({ statusCode: 403 });
    expect(quotes.transition).not.toHaveBeenCalled();
  });

  it('không tự duyệt báo giá mình gửi; từ chối phải có lý do', async () => {
    const { service } = setup(version('PENDING', 1, undefined, TN));
    await expect(service.approve(lead, QUOTE_ID, '1', { revision: 3 })).rejects.toMatchObject({ statusCode: 403 });
    const other = setup(version('PENDING', 1, undefined, NV1));
    await expect(other.service.reject(lead, QUOTE_ID, '1', { revision: 3 })).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    await other.service.approve(lead, QUOTE_ID, '1', { revision: 3 });
    expect(other.quotes.transition.mock.calls[0][3]).toMatchObject({ from: 'PENDING', to: 'APPROVED', action: 'approve' });
  });

  it('đang duyệt qua Quy trình: không duyệt tay; Quy trình không tạo được phiên thì được duyệt tay', async () => {
    const running = setup(version('PENDING', 1, undefined, NV1), {
      procedure: { id: 'l', status: 'RUNNING', instanceId: 'i', instanceCode: 'HS1', result: null, lastError: null, attempts: 1 },
    });
    await expect(running.service.approve(lead, QUOTE_ID, '1', { revision: 3 })).rejects.toMatchObject({ code: 'QUOTE_IN_PROCEDURE' });
    const failed = setup(version('PENDING', 1, undefined, NV1), {
      procedure: { id: 'l', status: 'FAILED', instanceId: null, instanceCode: null, result: null, lastError: 'x', attempts: 30 },
    });
    await failed.service.approve(lead, QUOTE_ID, '1', { revision: 3 });
    expect(failed.quotes.transition).toHaveBeenCalled();
  });

  it('TC-SM-04: gửi khách khi chưa duyệt, khách chấp nhận khi chưa gửi: 409', async () => {
    await expect(setup(version('DRAFT')).service.send(seller, QUOTE_ID, '1', { revision: 3 })).rejects.toMatchObject({ statusCode: 409 });
    await expect(setup(version('PENDING')).service.accept(seller, QUOTE_ID, '1', { revision: 3 })).rejects.toMatchObject({
      statusCode: 409,
    });
    await expect(
      setup(version('SENT')).service.decline(seller, QUOTE_ID, '1', { revision: 3 }),
    ).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  });

  it('chi tiết hiện tồn khả dụng hiện tại; Kho lỗi thì vẫn xem được', async () => {
    const { service } = setup(version('DRAFT'));
    const detail = await service.get(seller, QUOTE_ID);
    expect(detail.version.lines[0].availableStock).toBe(70);
    expect(detail.approvalCheck).toEqual([]);

    const broken = setup(version('DRAFT'));
    broken.catalog.materials = async () => {
      throw new Error('down');
    };
    await expect(broken.service.get(seller, QUOTE_ID)).resolves.toMatchObject({ version: { lines: [{ availableStock: null }] } });
  });
});
