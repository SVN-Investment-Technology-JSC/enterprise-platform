/**
 * Dữ liệu đổ vào bố cục in của báo giá (phase 3, plan mục 5.3 và 9.1).
 *
 * `buildQuoteLayoutData` đổi báo giá đang xem thành giá trị biến (`Record<biến, chuỗi>`), dòng hàng và dòng tổng đã định
 * dạng sẵn. `QuoteLayoutView` và bộ xuất Word chỉ đọc kết quả này, không tự tính hay định dạng lại số.
 *
 * Không có giá trị nào lấy từ giá vốn, lợi nhuận (`estCost`, `estUnitCost`, `margin`, `profit`): mẫu in không được lộ các
 * số này (plan mục 11).
 */
import {
  QUOTE_LAYOUT_CUSTOM_VARIABLE_PREFIX,
  QUOTE_STATUS_LABELS,
  amountInWordsVi,
  formatQuoteDate,
  formatQuoteMoney,
  formatQuoteNumber,
  formatQuotePercent,
  type CustomFieldDefinition,
  type CustomFieldValue,
  type CustomerDetail,
  type QuoteDetail,
  type QuoteLayoutLineColumnKey,
  type QuoteLayoutTotalRowKey,
} from '@enterprise-platform/contracts-crm';

/** Một dòng hàng đã định dạng: mỗi cột của `lineTable` là một chuỗi. */
export interface QuoteLayoutLineRow {
  readonly id: string;
  /** Nhóm hàng (rỗng khi không có), dùng cho `showGroupByCategory`. */
  readonly category: string;
  readonly cells: Readonly<Record<QuoteLayoutLineColumnKey, string>>;
}

/** Toàn bộ dữ liệu một bản in cần. Mọi chuỗi là chữ thuần, đã chuẩn hoá NFC. */
export interface QuoteLayoutData {
  /** Giá trị theo tên biến (`quote.code`, `custom.<id>`...). Biến không có dữ liệu là chuỗi rỗng hoặc không có khoá. */
  readonly values: Readonly<Record<string, string>>;
  /** Dòng hàng theo thứ tự in; cột `index` đánh số liên tục từ 1. */
  readonly lines: readonly QuoteLayoutLineRow[];
  /** Giá trị đã định dạng của từng dòng tổng; dòng không áp dụng là `0`. */
  readonly totals: Readonly<Record<QuoteLayoutTotalRowKey, string>>;
  /** Tổng cộng bằng chữ ("Một triệu ... đồng"). */
  readonly amountInWords: string;
}

/** Người trong danh sách `people` của `useCrm`; email, điện thoại có thì dùng (danh sách hiện chỉ có tên). */
export interface QuoteLayoutPerson {
  readonly userId: string;
  readonly displayName: string;
  readonly email?: string | null;
  readonly phone?: string | null;
}

export interface BuildQuoteLayoutDataInput {
  readonly detail: QuoteDetail;
  /** Chi tiết khách (`getCustomer`); rỗng khi chưa tải hoặc không đọc được: dùng mã, tên khách trên báo giá. */
  readonly customer?: CustomerDetail | null;
  readonly people?: readonly QuoteLayoutPerson[];
  /** Mọi định nghĩa trường tuỳ biến, cả trường đang tắt; trường đã xoá không có ở đây thì biến của nó rỗng. */
  readonly customFields?: readonly CustomFieldDefinition[];
  /** Mã dự án: `QuoteDetail` chỉ có id và tên dự án, màn gọi truyền thêm nếu đã có. */
  readonly opportunityCode?: string | null;
  /** Ngày in (biến `today`); mặc định là lúc gọi, theo giờ máy người xem. */
  readonly now?: Date;
}

const nfc = (value: string | null | undefined): string => (value ? value.normalize('NFC') : '');

const pad2 = (value: number) => String(value).padStart(2, '0');

/** Ngày `dd/mm/yyyy` theo giờ máy người xem (không cắt chuỗi ISO UTC, để không lệch ngày). */
export function formatLocalDate(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** Ngày dạng `yyyy-mm-dd` giữ nguyên ngày; dấu thời gian ISO đầy đủ thì đổi theo giờ máy. */
function formatDateValue(value: string | null | undefined): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatQuoteDate(value);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? formatQuoteDate(value) : formatLocalDate(parsed);
}

function customFieldText(definition: CustomFieldDefinition, value: CustomFieldValue | undefined): string {
  if (value === undefined || value === null || value === '') return '';
  if (definition.fieldType === 'NUMBER') return typeof value === 'number' ? formatQuoteNumber(value) : nfc(String(value));
  if (definition.fieldType === 'DATE') return typeof value === 'string' ? formatQuoteDate(value) || nfc(value) : '';
  return nfc(String(value));
}

/** Tên biến của một trường tuỳ biến. */
export function customFieldVariable(definitionId: string): string {
  return `${QUOTE_LAYOUT_CUSTOM_VARIABLE_PREFIX}${definitionId}`;
}

/**
 * Dữ liệu in của phiên bản đang xem. Thiếu khách, người phụ trách, dự án hay trường tuỳ biến thì biến đó rỗng, không ném
 * lỗi.
 *
 * Mẫu tính theo tổng đơn (`ORDER`):
 * - Chiết khấu: `orderDiscount` là chiết khấu tổng đơn; `lineDiscount` chỉ còn phần chiết khấu trên dòng.
 * - Thuế: cột VAT (%), tiền VAT của dòng để trống và cột tổng cộng của dòng bằng thành tiền, vì thuế chỉ tính trên tổng
 *   đơn; dòng tổng `vat` vẫn là tổng thuế của báo giá, `orderTax` là phần thuế tổng đơn trong đó.
 */
export function buildQuoteLayoutData(input: BuildQuoteLayoutDataInput): QuoteLayoutData {
  const { detail } = input;
  const version = detail.version;
  const form = version.form;
  const totals = version.totals;
  const customer = input.customer ?? null;
  const owner = (input.people ?? []).find((person) => person.userId === detail.ownerUserId) ?? null;
  const orderDiscountAmount = form.discountMode === 'ORDER' ? form.orderDiscount.amount : 0;
  const orderTaxAmount = form.taxMode === 'ORDER' ? form.orderTax.amount : 0;
  const lineTax = form.taxMode === 'LINE';

  const values: Record<string, string> = {
    'quote.code': nfc(detail.code),
    'quote.name': nfc(form.quoteName ?? detail.quoteName),
    'quote.date': form.quoteDate ? formatDateValue(form.quoteDate) : formatDateValue(version.createdAt || detail.createdAt),
    'quote.validUntil': formatDateValue(version.validUntil),
    'quote.priceDate': formatDateValue(version.priceDate),
    'quote.versionNo': String(version.versionNo),
    'quote.typeName': nfc(form.quoteTypeName),
    'quote.templateName': nfc(form.templateName),
    'quote.note': nfc(version.note),
    'quote.status': QUOTE_STATUS_LABELS[version.status] ?? '',
    'customer.code': nfc(customer?.code ?? detail.customerCode),
    'customer.name': nfc(customer?.name ?? detail.customerName),
    'customer.taxCode': nfc(customer?.taxCode),
    'customer.address': nfc(customer?.address),
    'customer.phone': nfc(customer?.phone),
    'customer.email': nfc(customer?.email),
    'opportunity.code': detail.opportunityId ? nfc(input.opportunityCode) : '',
    'opportunity.name': detail.opportunityId ? nfc(detail.opportunityName) : '',
    'owner.name': nfc(owner?.displayName),
    'owner.email': nfc(owner?.email),
    'owner.phone': nfc(owner?.phone),
    'totals.subtotal': formatQuoteMoney(totals.netAmount + orderDiscountAmount),
    'totals.discount': formatQuoteMoney(totals.discountAmount),
    'totals.fees': formatQuoteMoney(form.feesAmount),
    'totals.vat': formatQuoteMoney(totals.vatAmount),
    'totals.grandTotal': formatQuoteMoney(totals.totalAmount),
    'totals.amountInWords': amountInWordsVi(totals.totalAmount),
    today: formatLocalDate(input.now ?? new Date()),
  };

  const definitions = new Map((input.customFields ?? []).map((definition) => [definition.id, definition]));
  for (const [id, value] of Object.entries(form.customFields ?? {})) {
    const definition = definitions.get(id);
    // Trường đã xoá: không biết kiểu, không in. Trường đang tắt vẫn in giá trị đã lưu.
    if (!definition) continue;
    values[customFieldVariable(id)] = customFieldText(definition, value);
  }

  const lines: QuoteLayoutLineRow[] = version.lines.map((line, index) => ({
    id: line.id,
    category: nfc(line.category),
    cells: {
      index: String(index + 1),
      materialCode: nfc(line.materialCode),
      materialName: nfc(line.materialName),
      unit: nfc(line.unit),
      quantity: formatQuoteNumber(line.quantity),
      listPrice: formatQuoteMoney(line.listPrice),
      discountPercent: line.discountPercent ? formatQuotePercent(line.discountPercent) : '',
      unitPrice: formatQuoteMoney(line.unitPrice),
      lineAmount: formatQuoteMoney(line.lineAmount),
      vatRate: lineTax ? formatQuotePercent(line.vatRate) : '',
      vatAmount: lineTax ? formatQuoteMoney(line.vatAmount) : '',
      lineTotal: formatQuoteMoney(lineTax ? line.lineTotal : line.lineAmount),
      category: nfc(line.category),
    },
  }));

  return {
    values,
    lines,
    totals: {
      subtotal: formatQuoteMoney(totals.netAmount + orderDiscountAmount),
      lineDiscount: formatQuoteMoney(totals.discountAmount - orderDiscountAmount),
      orderDiscount: formatQuoteMoney(orderDiscountAmount),
      fees: formatQuoteMoney(form.feesAmount),
      shipping: formatQuoteMoney(totals.shippingAmount),
      vat: formatQuoteMoney(totals.vatAmount),
      orderTax: formatQuoteMoney(orderTaxAmount),
      grandTotal: formatQuoteMoney(totals.totalAmount),
    },
    amountInWords: amountInWordsVi(totals.totalAmount),
  };
}

/** Dữ liệu rỗng: mọi biến rỗng, không dòng hàng (trình thiết kế khi tắt "Dữ liệu mẫu"). */
export function emptyQuoteLayoutData(): QuoteLayoutData {
  return {
    values: {},
    lines: [],
    totals: { subtotal: '', lineDiscount: '', orderDiscount: '', fees: '', shipping: '', vat: '', orderTax: '', grandTotal: '' },
    amountInWords: '',
  };
}

interface SampleLine {
  readonly code: string;
  readonly name: string;
  readonly unit: string;
  readonly category: string;
  readonly quantity: number;
  readonly listPrice: number;
  readonly discountPercent: number;
  readonly vatRate: number;
}

const SAMPLE_LINES: readonly SampleLine[] = [
  { code: 'VT-0001', name: 'Máy bơm ly tâm 7,5 kW', unit: 'Cái', category: 'Thiết bị', quantity: 2, listPrice: 18_500_000, discountPercent: 5, vatRate: 10 },
  { code: 'VT-0002', name: 'Tủ điều khiển bơm', unit: 'Bộ', category: 'Thiết bị', quantity: 1, listPrice: 12_000_000, discountPercent: 0, vatRate: 10 },
  { code: 'VT-0103', name: 'Ống thép mạ kẽm DN100', unit: 'Mét', category: 'Vật tư', quantity: 120, listPrice: 265_000, discountPercent: 3, vatRate: 8 },
  { code: 'DV-0010', name: 'Lắp đặt và chạy thử', unit: 'Gói', category: 'Dịch vụ', quantity: 1, listPrice: 8_000_000, discountPercent: 0, vatRate: 8 },
];

/**
 * Dữ liệu mẫu cho trình thiết kế (công tắc "Dữ liệu mẫu") và xuất thử. Trường tuỳ biến truyền vào được điền giá trị mẫu
 * theo kiểu của trường.
 */
export function sampleQuoteLayoutData(customFields: readonly CustomFieldDefinition[] = [], now: Date = new Date()): QuoteLayoutData {
  let gross = 0;
  let net = 0;
  let vat = 0;
  const lines: QuoteLayoutLineRow[] = SAMPLE_LINES.map((line, index) => {
    const unitPrice = Math.round(line.listPrice * (1 - line.discountPercent / 100));
    const lineAmount = unitPrice * line.quantity;
    const vatAmount = Math.round((lineAmount * line.vatRate) / 100);
    gross += line.listPrice * line.quantity;
    net += lineAmount;
    vat += vatAmount;
    return {
      id: `sample-${index + 1}`,
      category: line.category,
      cells: {
        index: String(index + 1),
        materialCode: line.code,
        materialName: line.name,
        unit: line.unit,
        quantity: formatQuoteNumber(line.quantity),
        listPrice: formatQuoteMoney(line.listPrice),
        discountPercent: line.discountPercent ? formatQuotePercent(line.discountPercent) : '',
        unitPrice: formatQuoteMoney(unitPrice),
        lineAmount: formatQuoteMoney(lineAmount),
        vatRate: formatQuotePercent(line.vatRate),
        vatAmount: formatQuoteMoney(vatAmount),
        lineTotal: formatQuoteMoney(lineAmount + vatAmount),
        category: line.category,
      },
    };
  });
  const fees = 1_500_000;
  const total = net + vat + fees;
  const values: Record<string, string> = {
    'quote.code': 'BG2600123',
    'quote.name': 'Báo giá hệ thống bơm cấp nước',
    'quote.date': formatLocalDate(now),
    'quote.validUntil': formatLocalDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30)),
    'quote.priceDate': formatLocalDate(now),
    'quote.versionNo': '1',
    'quote.typeName': 'Báo giá thiết bị',
    'quote.templateName': 'Mẫu tiêu chuẩn',
    'quote.note': 'Giá đã bao gồm vận chuyển trong nội thành.',
    'quote.status': QUOTE_STATUS_LABELS.DRAFT,
    'customer.code': 'KH00045',
    'customer.name': 'Công ty TNHH Xây dựng Minh Phát',
    'customer.taxCode': '0101234567',
    'customer.address': 'Số 12 đường Láng, Đống Đa, Hà Nội',
    'customer.phone': '024 3765 4321',
    'customer.email': 'muahang@minhphat.vn',
    'opportunity.code': 'DA2600031',
    'opportunity.name': 'Trạm bơm khu công nghiệp Phú Nghĩa',
    'owner.name': 'Nguyễn Văn An',
    'owner.email': 'an.nguyen@congty.vn',
    'owner.phone': '0912 345 678',
    'totals.subtotal': formatQuoteMoney(net),
    'totals.discount': formatQuoteMoney(gross - net),
    'totals.fees': formatQuoteMoney(fees),
    'totals.vat': formatQuoteMoney(vat),
    'totals.grandTotal': formatQuoteMoney(total),
    'totals.amountInWords': amountInWordsVi(total),
    today: formatLocalDate(now),
  };
  for (const definition of customFields) {
    values[customFieldVariable(definition.id)] =
      definition.fieldType === 'NUMBER'
        ? formatQuoteNumber(100)
        : definition.fieldType === 'DATE'
          ? formatLocalDate(now)
          : definition.fieldType === 'SELECT' && definition.options.length
            ? definition.options[0]
            : `${definition.name} (mẫu)`;
  }
  return {
    values,
    lines,
    totals: {
      subtotal: formatQuoteMoney(net),
      lineDiscount: formatQuoteMoney(gross - net),
      orderDiscount: formatQuoteMoney(0),
      fees: formatQuoteMoney(fees),
      shipping: formatQuoteMoney(0),
      vat: formatQuoteMoney(vat),
      orderTax: formatQuoteMoney(0),
      grandTotal: formatQuoteMoney(total),
    },
    amountInWords: amountInWordsVi(total),
  };
}

/** Tên file xuất (plan 9.4): `<mã báo giá>_v<phiên bản>`; ký tự không hợp lệ trong tên file đổi thành `_`. */
export function quoteExportFileName(code: string, versionNo: number | string): string {
  // Ký tự không hợp lệ trong tên file (kể cả `/` của mẫu mã `{yyyymmdd}/BG//{seq}`) đổi thành `-` (TC-QW-32).
  const safe = (code || 'BaoGia').replace(/[\\/:*?"<>|\s]+/g, '-');
  return `${safe}_v${versionNo}`;
}
