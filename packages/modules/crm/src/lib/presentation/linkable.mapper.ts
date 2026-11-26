import {
  CONTRACT_STATUS_LABELS,
  CONTRACT_TYPE_LABELS,
  LEAD_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
  RECEIPT_METHOD_LABELS,
  RECEIPT_STATUS_LABELS,
  SALES_ORDER_STATUS_LABELS,
  WARRANTY_CAUSE_LABELS,
  WARRANTY_STATUS_LABELS,
  type ContractSummary,
  type CustomerDetail,
  type CustomerSummary,
  type Lead,
  type OpportunitySummary,
  type QuoteSummary,
  type ReceiptDetail,
  type ReceiptSummary,
  type SalesOrderSummary,
  type WarrantyCaseDetail,
  type WarrantyCaseSummary,
} from '@enterprise-platform/contracts-crm';
import type {
  LinkableCandidate,
  LinkableField,
  LinkableKind,
  LinkableObject,
  LinkableRef,
} from '@enterprise-platform/contracts-integration';

/**
 * Bán hàng công bố hồ sơ của mình cho module khác gắn vào (hợp đồng `LinkableObject` ở `contracts-integration`).
 *
 * Chỉ chuyển dạng dữ liệu mà service sẵn có đã trả (đã lọc theo quyền và phạm vi của người xem); không đọc thêm gì.
 * `label` chỉ gồm mã và tên, không số tiền: bên gắn lưu nhãn này và ai trong dự án cũng thấy. Số tiền nằm ở `fields`, chỉ
 * đọc trực tiếp mỗi lần xem nên người không xem được hồ sơ ở Bán hàng thì không thấy.
 */
export const CRM_LINKABLE_KINDS = {
  customer: 'crm.customer',
  opportunity: 'crm.opportunity',
  quote: 'crm.quote',
  contract: 'crm.contract',
  order: 'crm.order',
  lead: 'crm.lead',
  warranty: 'crm.warranty',
  receipt: 'crm.receipt',
} as const;

export type CrmLinkableKind = (typeof CRM_LINKABLE_KINDS)[keyof typeof CRM_LINKABLE_KINDS];

const MODULE_LABEL = 'Bán hàng';

/**
 * Thứ tự theo chuỗi nghiệp vụ: cơ hội → báo giá → hợp đồng → đơn hàng; khách hàng; rồi các hồ sơ quanh khách (lead, bảo
 * hành, phiếu thu công nợ), không gợi ý điền sẵn form dự án.
 *
 * Bán hàng chỉ có hợp đồng bán (`CONTRACT_TYPES`: mua bán, khung, nguyên tắc — đều với khách hàng); không có hợp đồng
 * mua, đơn mua hay nhà cung cấp, nên không công bố. Người liên hệ là dòng con của khách hàng, tài liệu chỉ liệt kê được
 * theo từng hồ sơ cha, hoạt động chăm sóc không tìm theo chữ được: cả ba không công bố riêng.
 */
export const CRM_LINKABLE_KIND_LIST: readonly LinkableKind[] = [
  { key: CRM_LINKABLE_KINDS.opportunity, moduleLabel: MODULE_LABEL, label: 'Cơ hội', prefill: true },
  { key: CRM_LINKABLE_KINDS.quote, moduleLabel: MODULE_LABEL, label: 'Báo giá', prefill: true },
  { key: CRM_LINKABLE_KINDS.contract, moduleLabel: MODULE_LABEL, label: 'Hợp đồng bán', prefill: true },
  { key: CRM_LINKABLE_KINDS.order, moduleLabel: MODULE_LABEL, label: 'Đơn hàng bán', prefill: true },
  { key: CRM_LINKABLE_KINDS.customer, moduleLabel: MODULE_LABEL, label: 'Khách hàng', prefill: true },
  { key: CRM_LINKABLE_KINDS.lead, moduleLabel: MODULE_LABEL, label: 'Đầu mối (lead)', prefill: false },
  { key: CRM_LINKABLE_KINDS.warranty, moduleLabel: MODULE_LABEL, label: 'Yêu cầu bảo hành', prefill: false },
  { key: CRM_LINKABLE_KINDS.receipt, moduleLabel: MODULE_LABEL, label: 'Phiếu thu (công nợ)', prefill: false },
];

export function isCrmLinkableKind(value: unknown): value is CrmLinkableKind {
  return CRM_LINKABLE_KIND_LIST.some((kind) => kind.key === value);
}

/** Loại có màn chi tiết mở thẳng bằng hash `#<trang>/<id>`. */
type CrmDeepLinkKind = Exclude<CrmLinkableKind, 'crm.lead' | 'crm.receipt'>;

/**
 * Đường dẫn mở hồ sơ trong giao diện Bán hàng (điều hướng bằng hash `#<trang>/<id>`). Lead và phiếu thu không có màn chi
 * tiết riêng: xem `leadObject`, `receiptObject`.
 */
export function crmLaunchUrl(kind: CrmDeepLinkKind, id: string): string {
  const page: Record<CrmDeepLinkKind, string> = {
    'crm.customer': 'customers',
    'crm.opportunity': 'opportunities',
    'crm.quote': 'quotes',
    'crm.contract': 'contracts',
    'crm.order': 'orders',
    'crm.warranty': 'warranty',
  };
  return `/modules/crm#${page[kind]}/${encodeURIComponent(id)}`;
}

const joined = (...parts: readonly (string | null | undefined)[]) =>
  parts.filter((part): part is string => Boolean(part && part.trim())).join(' — ');
const day = (value: string | null | undefined) => (value ? value.slice(0, 10) : null);
const text = (key: string, label: string, value: string | number | null | undefined): LinkableField => ({
  key,
  label,
  type: 'text',
  value: value == null || value === '' ? null : String(value),
});
const date = (key: string, label: string, value: string | null | undefined): LinkableField => ({
  key,
  label,
  type: 'date',
  value: day(value),
});
const money = (key: string, label: string, value: number | null | undefined): LinkableField => ({
  key,
  label,
  type: 'money',
  value: value == null ? null : value,
});
const customerText = (row: { customerCode: string; customerName: string }) => joined(row.customerCode, row.customerName);

/* ------------------------------------------------------------------ Khách hàng */

export function customerCandidate(row: CustomerSummary): LinkableCandidate {
  return {
    kind: CRM_LINKABLE_KINDS.customer,
    id: row.id,
    code: row.code,
    label: joined(row.code, row.name),
    hint: joined(row.taxCode ? `MST ${row.taxCode}` : null, row.province),
  };
}

export function customerObject(row: CustomerDetail): LinkableObject {
  return {
    ...customerCandidate(row),
    launchUrl: crmLaunchUrl(CRM_LINKABLE_KINDS.customer, row.id),
    fields: [
      text('name', 'Tên khách hàng', row.name),
      text('taxCode', 'Mã số thuế', row.taxCode),
      text('kind', 'Loại khách', row.kindName),
      text('group', 'Nhóm', row.groupName),
      text('address', 'Địa chỉ', row.address),
      text('province', 'Tỉnh/thành', row.province),
      text('contact', 'Người liên hệ chính', row.primaryContactName),
    ],
    upstream: [],
    prefill: { crmCustomerId: row.id },
  };
}

/* ------------------------------------------------------------------ Cơ hội */

export function opportunityCandidate(row: OpportunitySummary): LinkableCandidate {
  return {
    kind: CRM_LINKABLE_KINDS.opportunity,
    id: row.id,
    label: row.name,
    status: row.stageInfo?.name ?? row.stage,
    hint: customerText(row),
  };
}

export function opportunityObject(row: OpportunitySummary): LinkableObject {
  return {
    ...opportunityCandidate(row),
    launchUrl: crmLaunchUrl(CRM_LINKABLE_KINDS.opportunity, row.id),
    fields: [
      text('customer', 'Khách hàng', customerText(row)),
      text('pipeline', 'Luồng bán hàng', row.pipeline?.name),
      text('stage', 'Giai đoạn', row.stageInfo?.name ?? row.stage),
      text('probability', 'Xác suất thắng', row.probability == null ? null : `${row.probability}%`),
      money('expectedValue', 'Giá trị dự kiến', row.expectedValue),
      date('expectedCloseDate', 'Dự kiến chốt', row.expectedCloseDate),
    ],
    upstream: [],
    prefill: { title: row.name, crmCustomerId: row.customerId },
  };
}

/* ------------------------------------------------------------------ Báo giá */

export function quoteCandidate(row: QuoteSummary): LinkableCandidate {
  return {
    kind: CRM_LINKABLE_KINDS.quote,
    id: row.id,
    code: row.code,
    label: joined(row.code, row.quoteName ?? row.opportunityName ?? row.customerName),
    status: QUOTE_STATUS_LABELS[row.status] ?? row.status,
    hint: customerText(row),
  };
}

export function quoteObject(row: QuoteSummary): LinkableObject {
  const upstream: LinkableRef[] = row.opportunityId
    ? [{ kind: CRM_LINKABLE_KINDS.opportunity, id: row.opportunityId, label: row.opportunityName ?? 'Cơ hội' }]
    : [];
  return {
    ...quoteCandidate(row),
    launchUrl: crmLaunchUrl(CRM_LINKABLE_KINDS.quote, row.id),
    fields: [
      text('customer', 'Khách hàng', customerText(row)),
      text('opportunity', 'Cơ hội', row.opportunityName),
      text('version', 'Phiên bản', row.currentVersion),
      date('validUntil', 'Hiệu lực đến', row.validUntil),
      money('totalAmount', 'Tổng giá trị', row.totalAmount),
    ],
    upstream,
    prefill: {
      title: row.quoteName ?? row.opportunityName ?? undefined,
      crmCustomerId: row.customerId,
      contractValue: row.totalAmount,
    },
  };
}

/* ------------------------------------------------------------------ Hợp đồng */

export function contractCandidate(row: ContractSummary): LinkableCandidate {
  return {
    kind: CRM_LINKABLE_KINDS.contract,
    id: row.id,
    code: row.code,
    label: joined(row.code, row.title),
    status: CONTRACT_STATUS_LABELS[row.status] ?? row.status,
    hint: customerText(row),
  };
}

/**
 * `opportunity`: cơ hội của báo giá gốc, nếu đọc được (cần đọc thêm báo giá); để gợi ý gắn cả chuỗi
 * hợp đồng → báo giá → cơ hội.
 */
export function contractObject(
  row: ContractSummary & { readonly signedDate?: string | null; readonly warrantyMonths?: number | null },
  opportunity?: { readonly id: string; readonly name: string | null } | null,
): LinkableObject {
  const upstream: LinkableRef[] = [];
  if (row.quoteId) {
    upstream.push({
      kind: CRM_LINKABLE_KINDS.quote,
      id: row.quoteId,
      code: row.quoteCode ?? undefined,
      label: row.quoteCode ?? 'Báo giá',
    });
  }
  if (opportunity) {
    upstream.push({ kind: CRM_LINKABLE_KINDS.opportunity, id: opportunity.id, label: opportunity.name ?? 'Cơ hội' });
  }
  return {
    ...contractCandidate(row),
    launchUrl: crmLaunchUrl(CRM_LINKABLE_KINDS.contract, row.id),
    fields: [
      text('type', 'Loại hợp đồng', CONTRACT_TYPE_LABELS[row.type] ?? row.type),
      text('customer', 'Khách hàng', customerText(row)),
      date('signedDate', 'Ngày ký', row.signedDate ?? null),
      date('validFrom', 'Hiệu lực từ', row.validFrom),
      date('validTo', 'Hiệu lực đến', row.validTo),
      money('value', 'Giá trị hợp đồng', row.value),
      text('quote', 'Báo giá', row.quoteCode),
      text('warranty', 'Bảo hành', row.warrantyMonths == null ? null : `${row.warrantyMonths} tháng`),
    ],
    upstream,
    prefill: {
      title: row.title,
      crmCustomerId: row.customerId,
      startDate: day(row.validFrom) ?? undefined,
      endDate: day(row.validTo) ?? undefined,
      contractValue: row.value,
    },
  };
}

/* ------------------------------------------------------------------ Đơn hàng bán */

export function orderCandidate(row: SalesOrderSummary): LinkableCandidate {
  return {
    kind: CRM_LINKABLE_KINDS.order,
    id: row.id,
    code: row.code,
    label: joined(row.code, row.customerName),
    status: SALES_ORDER_STATUS_LABELS[row.status] ?? row.status,
    hint: joined(row.contractCode ? `HĐ ${row.contractCode}` : null, day(row.orderDate)),
  };
}

export function orderObject(row: SalesOrderSummary): LinkableObject {
  const upstream: LinkableRef[] = [];
  if (row.contractId) {
    upstream.push({
      kind: CRM_LINKABLE_KINDS.contract,
      id: row.contractId,
      code: row.contractCode ?? undefined,
      label: row.contractCode ?? 'Hợp đồng',
    });
  }
  if (row.quoteId) {
    upstream.push({
      kind: CRM_LINKABLE_KINDS.quote,
      id: row.quoteId,
      code: row.quoteCode ?? undefined,
      label: row.quoteCode ?? 'Báo giá',
    });
  }
  return {
    ...orderCandidate(row),
    launchUrl: crmLaunchUrl(CRM_LINKABLE_KINDS.order, row.id),
    fields: [
      text('customer', 'Khách hàng', customerText(row)),
      date('orderDate', 'Ngày đặt', row.orderDate),
      date('expectedDeliveryDate', 'Giao dự kiến', row.expectedDeliveryDate),
      money('totalAmount', 'Tổng giá trị', row.totalAmount),
      text('contract', 'Hợp đồng', row.contractCode),
      text('quote', 'Báo giá', row.quoteCode),
      text('late', 'Giao trễ', row.late ? 'Có' : 'Không'),
    ],
    upstream,
    prefill: {
      title: joined(`Đơn hàng ${row.code}`, row.customerName),
      crmCustomerId: row.customerId,
      startDate: day(row.orderDate) ?? undefined,
      endDate: day(row.expectedDeliveryDate) ?? undefined,
      contractValue: row.totalAmount,
    },
  };
}

/* ------------------------------------------------------------------ Lead (đầu mối) */

export function leadCandidate(row: Lead): LinkableCandidate {
  return {
    kind: CRM_LINKABLE_KINDS.lead,
    id: row.id,
    label: row.name,
    status: LEAD_STATUS_LABELS[row.status] ?? row.status,
    hint: joined(row.contactName, row.taxCode ? `MST ${row.taxCode}` : null, row.source),
  };
}

/** Trang Lead chưa mở được từng lead theo hash, nên đường dẫn về danh sách Lead. */
export function leadObject(row: Lead): LinkableObject {
  return {
    ...leadCandidate(row),
    launchUrl: '/modules/crm#leads',
    fields: [
      text('name', 'Tên', row.name),
      text('contact', 'Người liên hệ', row.contactName),
      text('phone', 'Điện thoại', row.phone),
      text('email', 'Email', row.email),
      text('taxCode', 'Mã số thuế', row.taxCode),
      text('source', 'Nguồn', row.source),
      text('need', 'Nhu cầu', row.need),
      text('status', 'Trạng thái', LEAD_STATUS_LABELS[row.status] ?? row.status),
      date('createdAt', 'Ngày tạo', row.createdAt),
      date('convertedAt', 'Ngày chuyển đổi', row.convertedAt),
    ],
    upstream: [],
  };
}

/* ------------------------------------------------------------------ Yêu cầu bảo hành */

export function warrantyCandidate(row: WarrantyCaseSummary): LinkableCandidate {
  return {
    kind: CRM_LINKABLE_KINDS.warranty,
    id: row.id,
    code: row.code,
    label: joined(row.code, row.customerName),
    status: WARRANTY_STATUS_LABELS[row.status] ?? row.status,
    hint: joined(WARRANTY_CAUSE_LABELS[row.cause] ?? row.cause, row.orderCode ? `Đơn ${row.orderCode}` : null),
  };
}

const MAX_SERIALS_SHOWN = 10;

export function warrantyObject(row: WarrantyCaseDetail): LinkableObject {
  const upstream: LinkableRef[] = [];
  if (row.orderId) {
    upstream.push({
      kind: CRM_LINKABLE_KINDS.order,
      id: row.orderId,
      code: row.orderCode ?? undefined,
      label: row.orderCode ?? 'Đơn hàng',
    });
  }
  if (row.contractId) upstream.push({ kind: CRM_LINKABLE_KINDS.contract, id: row.contractId, label: 'Hợp đồng' });
  const serials = row.serials.slice(0, MAX_SERIALS_SHOWN).join(', ');
  const more = row.serials.length > MAX_SERIALS_SHOWN ? ` (+${row.serials.length - MAX_SERIALS_SHOWN})` : '';
  return {
    ...warrantyCandidate(row),
    launchUrl: crmLaunchUrl(CRM_LINKABLE_KINDS.warranty, row.id),
    fields: [
      text('customer', 'Khách hàng', customerText(row)),
      text('order', 'Đơn hàng', row.orderCode),
      text('cause', 'Nguyên nhân', WARRANTY_CAUSE_LABELS[row.cause] ?? row.cause),
      text('status', 'Trạng thái', WARRANTY_STATUS_LABELS[row.status] ?? row.status),
      text('chargeable', 'Loại', row.chargeable ? 'Có phí' : 'Trong bảo hành'),
      text('lines', 'Số dòng', row.lineCount),
      text('serials', 'Serial', serials ? `${serials}${more}` : null),
      date('createdAt', 'Ngày tiếp nhận', row.createdAt),
      text('description', 'Mô tả', row.description),
    ],
    upstream,
  };
}

/* ------------------------------------------------------------------ Phiếu thu công nợ */

export function receiptCandidate(row: ReceiptSummary): LinkableCandidate {
  return {
    kind: CRM_LINKABLE_KINDS.receipt,
    id: row.id,
    code: row.code,
    label: joined(row.code, row.customerName),
    status: RECEIPT_STATUS_LABELS[row.status] ?? row.status,
    hint: joined(day(row.receiptDate), RECEIPT_METHOD_LABELS[row.method] ?? row.method),
  };
}

/**
 * Phiếu thu chưa có màn chi tiết riêng: đường dẫn mở sổ công nợ của khách (`#receivables/<khách>`), nơi liệt kê phiếu.
 * Chuỗi phía trước là các đơn hàng mà phiếu đã phân bổ vào.
 */
export function receiptObject(row: ReceiptDetail): LinkableObject {
  const orders = new Map<string, string | null>();
  for (const allocation of row.allocations) {
    if (allocation.orderId && !orders.has(allocation.orderId)) orders.set(allocation.orderId, allocation.orderCode);
  }
  return {
    ...receiptCandidate(row),
    launchUrl: `/modules/crm#receivables/${encodeURIComponent(row.customerId)}`,
    fields: [
      text('customer', 'Khách hàng', customerText(row)),
      date('receiptDate', 'Ngày thu', row.receiptDate),
      text('method', 'Hình thức', RECEIPT_METHOD_LABELS[row.method] ?? row.method),
      money('amount', 'Số tiền thu', row.amount),
      money('allocatedAmount', 'Đã phân bổ', row.allocatedAmount),
      text('status', 'Trạng thái', RECEIPT_STATUS_LABELS[row.status] ?? row.status),
      text('financeVoucher', 'Phiếu thu Tài chính', row.financeVoucherCode),
      text('note', 'Ghi chú', row.note),
    ],
    upstream: [...orders].map(([id, code]) => ({
      kind: CRM_LINKABLE_KINDS.order,
      id,
      code: code ?? undefined,
      label: code ?? 'Đơn hàng',
    })),
  };
}

/**
 * Danh sách phiếu thu của Bán hàng không có ô tìm theo chữ: bên gọi lấy các phiếu mới nhất trong phạm vi rồi lọc tại đây
 * theo mã phiếu, mã hay tên khách (không phân biệt hoa thường, dấu).
 */
export function receiptMatches(row: ReceiptSummary, q: string | undefined): boolean {
  if (!q) return true;
  const needle = fold(q);
  return [row.code, row.customerCode, row.customerName].some((value) => fold(value).includes(needle));
}

const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
