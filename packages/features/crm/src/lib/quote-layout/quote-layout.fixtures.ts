/**
 * Dữ liệu báo giá dựng sẵn cho spec của thư mục `quote-layout` (không dùng trong code chạy thật).
 */
import {
  defaultQuoteLayout,
  type CustomerDetail,
  type QuoteDetail,
  type QuoteLayout,
  type QuoteLine,
  type QuoteSeller,
  type QuoteVersion,
} from '@enterprise-platform/contracts-crm';

/** Ảnh PNG thật 4×2 điểm ảnh (tỉ lệ 2:1). */
export const FIXTURE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAEElEQVR4nGOQkzsBRwzIHABkaggh4UPC6AAAAABJRU5ErkJggg==';

/** Thông tin tổ chức báo giá trên phiên bản (biến `company.*`). */
export function fixtureSeller(patch: Partial<QuoteSeller> = {}): QuoteSeller {
  return {
    name: 'Công ty TNHH Thiết bị An Phát',
    shortName: 'An Phát',
    address: '25 Trần Duy Hưng, Cầu Giấy, Hà Nội',
    taxCode: '0101111111',
    phone: '024 3333 1111',
    email: 'baogia@anphat.vn',
    website: null,
    bankAccount: null,
    bankName: null,
    representative: null,
    representativeTitle: null,
    ...patch,
  };
}

/** Phiên bản có tổ chức báo giá (biến `company.*`) và logo tổ chức (`sellerLogo`). */
export function fixtureSellerVersion(seller: QuoteSeller = fixtureSeller(), sellerLogo: string | null = null, patch: Partial<QuoteVersion> = {}): QuoteVersion {
  const base = fixtureVersion(patch);
  return { ...base, sellerLogo, form: { ...base.form, organizationId: 'org-a', organizationName: seller.name, seller } };
}

/** Chuỗi thử chống XSS và thoát ký tự (Q-XSS). */
export const FIXTURE_XSS = '<script>alert(1)</script> & "Bơm" > <b>đậm</b>';

/** Bố cục mặc định thêm ảnh, khoảng trắng và đoạn chữ có ký tự đặc biệt: đủ 11 loại khối. */
export function fixtureFullLayout(patch: Partial<QuoteLayout> = {}): QuoteLayout {
  const base = defaultQuoteLayout();
  return {
    ...base,
    blocks: [
      { id: 'logo', type: 'image', src: FIXTURE_PNG, heightMm: 20, align: 'center' },
      ...base.blocks,
      { id: 'gap', type: 'spacer', heightMm: 10 },
      { id: 'xss', type: 'text', align: 'left', runs: [{ text: FIXTURE_XSS, bold: true }, { text: ' {{customer.name}}' }] },
    ],
    ...patch,
  };
}

export function fixtureLine(patch: Partial<QuoteLine> = {}): QuoteLine {
  return {
    id: 'l1',
    lineNo: 1,
    materialId: 'm1',
    materialCode: 'VT-01',
    materialName: 'Máy bơm',
    unit: 'Cái',
    materialKind: 'STOCK',
    category: 'Thiết bị',
    quantity: 2,
    listPrice: 1_000_000,
    priceSource: 'STANDARD_LIST',
    priceReferenceCode: null,
    appliedPolicies: [],
    policyPercent: 0,
    discountPercent: 10,
    cappedAt: null,
    overridden: false,
    overrideUnitPrice: null,
    overrideDiscountPercent: null,
    unitPrice: 900_000,
    grossAmount: 2_000_000,
    discountAmount: 200_000,
    vatRate: 10,
    lineAmount: 1_800_000,
    vatAmount: 180_000,
    lineTotal: 1_980_000,
    estUnitCost: 700_000,
    estCost: 1_400_000,
    margin: 22.2,
    availableStock: 5,
    ...patch,
  };
}

export function fixtureVersion(patch: Partial<QuoteVersion> = {}): QuoteVersion {
  return {
    id: 'v1',
    versionNo: 1,
    status: 'DRAFT',
    revision: 3,
    validUntil: '2026-12-01',
    priceDate: '2026-11-01',
    pricedOn: '2026-11-01',
    note: 'Giao trong 7 ngày',
    shipping: { amount: 0, vatRate: 0, cost: 0 },
    totals: {
      grossAmount: 2_000_000,
      discountAmount: 200_000,
      netAmount: 1_800_000,
      shippingAmount: 0,
      vatAmount: 180_000,
      totalAmount: 1_980_000,
      estCost: 1_400_000,
      profit: 400_000,
      marginPercent: 22.2,
      discountPercent: 10,
    },
    form: {
      quoteName: 'Báo giá bơm',
      quoteDate: '2026-11-01',
      templateId: 't1',
      templateName: 'Mẫu thiết bị',
      quoteTypeId: 'qt1',
      quoteTypeName: 'Thiết bị',
      discountMode: 'LINE',
      taxMode: 'LINE',
      orderDiscount: { percent: 0, amount: 0, inputKind: null },
      orderTax: { percent: 0, amount: 0, inputKind: null },
      fees: [],
      feesAmount: 0,
      customFields: {},
      organizationId: null,
      organizationName: null,
      seller: null,
    },
    promotions: [],
    requiresApproval: false,
    approvalReasons: [],
    submittedAt: null,
    submittedBy: null,
    approvedAt: null,
    approvedBy: null,
    rejectedAt: null,
    rejectedBy: null,
    decisionReason: null,
    sentAt: null,
    respondedAt: null,
    supersededAt: null,
    createdAt: '2026-11-01T02:00:00.000Z',
    layoutSnapshot: null,
    sellerLogo: null,
    lines: [fixtureLine()],
    ...patch,
  };
}

export function fixtureDetail(version: QuoteVersion = fixtureVersion(), patch: Partial<QuoteDetail> = {}): QuoteDetail {
  return {
    id: 'q1',
    code: 'BG2600001',
    opportunityId: 'o1',
    opportunityName: 'Dự án trạm bơm',
    customerId: 'c1',
    customerCode: 'KH01',
    customerName: 'Công ty A',
    ownerUserId: 'u1',
    status: version.status,
    currentVersion: version.versionNo,
    quoteName: 'Báo giá bơm',
    validUntil: version.validUntil,
    totalAmount: version.totals.totalAmount,
    updatedAt: '2026-11-01T02:00:00.000Z',
    acceptedVersion: null,
    convertedAt: null,
    createdAt: '2026-11-01T02:00:00.000Z',
    versions: [],
    version,
    procedure: null,
    history: [],
    approvalCheck: null,
    ...patch,
  };
}

export function fixtureCustomer(patch: Partial<CustomerDetail> = {}): CustomerDetail {
  return {
    id: 'c1',
    code: 'KH01',
    name: 'Công ty A',
    taxCode: '0101234567',
    province: null,
    region: null,
    kind: 'CUSTOMER',
    kindName: 'Doanh nghiệp',
    groupId: null,
    groupName: null,
    ownerUserId: 'u1',
    primaryContactName: null,
    updatedAt: '2026-11-01T02:00:00.000Z',
    address: '12 Láng, Hà Nội',
    industry: null,
    phone: '0241234567',
    email: 'a@example.com',
    creditLimit: null,
    paymentTermDays: null,
    note: null,
    profileNote: null,
    version: 1,
    createdAt: '2026-11-01T02:00:00.000Z',
    contacts: [],
    ...patch,
  };
}
