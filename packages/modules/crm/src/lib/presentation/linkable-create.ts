import {
  CONTRACT_TYPE_LABELS,
  CONTRACT_TYPES,
  DEFAULT_CUSTOMER_KIND,
  type ContractQuotePreview,
  type ContractType,
  type CreateCustomerRequest,
  type CreateOpportunityRequest,
  type CrmCapabilities,
  type CrmPerson,
  type CustomerGroup,
  type CustomerKindOption,
  type Pipeline,
  type SaveContractRequest,
  type TaxCodeMatch,
} from '@enterprise-platform/contracts-crm';
import type {
  LinkableCreateForm,
  LinkableCreatePreview,
  LinkableFormField,
  LinkableFormOption,
  LinkableFormValues,
  LinkableKind,
} from '@enterprise-platform/contracts-integration';
import { CRM_LINKABLE_KINDS } from './linkable.mapper.js';

/**
 * Tạo nhanh hồ sơ Bán hàng từ module khác (Workspace): form mô tả bằng hợp đồng chung `LinkableCreateForm`, giá trị gửi
 * về được đổi thành đúng request mà màn Bán hàng gửi (`CreateCustomerRequest`, `SaveContractRequest`,
 * `CreateOpportunityRequest`) rồi đi qua đúng service sẵn có. Mọi kiểm tra dữ liệu, quyền, phạm vi, trùng mã số thuế vẫn
 * nằm ở service; ở đây chỉ chuyển dạng, không thêm quy tắc nào.
 *
 * Ô và nhãn theo đúng form của màn Bán hàng (`customer-form.tsx`, `ContractFormDialog`, `OpportunityFormDialog`). Phần
 * form gốc có mà tạo nhanh không có: dòng hàng, kho, đợt thanh toán của hợp đồng (nhập ở màn chi tiết, như form gốc
 * cũng ghi), bỏ qua giai đoạn của cơ hội (tuỳ chọn).
 */

export const CRM_CREATABLE_KINDS = [
  CRM_LINKABLE_KINDS.customer,
  CRM_LINKABLE_KINDS.contract,
  CRM_LINKABLE_KINDS.opportunity,
] as const;

export type CrmCreatableKind = (typeof CRM_CREATABLE_KINDS)[number];

export function isCrmCreatableKind(value: unknown): value is CrmCreatableKind {
  return (CRM_CREATABLE_KINDS as readonly unknown[]).includes(value);
}

/** Cờ quyền ghi mà service của từng loại đòi (`requireSalesWriter`, `requireContractWriter`). */
export function crmCanCreate(
  actor: Pick<CrmCapabilities, 'canWriteOpportunity' | 'canWriteContract'> | undefined,
  kind: string,
): boolean {
  if (!actor) return false;
  if (kind === CRM_LINKABLE_KINDS.contract) return actor.canWriteContract;
  if (kind === CRM_LINKABLE_KINDS.customer || kind === CRM_LINKABLE_KINDS.opportunity) return actor.canWriteOpportunity;
  return false;
}

/** Danh sách loại kèm cờ `create` theo quyền người hỏi; loại không tạo nhanh được giữ nguyên như cũ. */
export function withCreateFlags(
  kinds: readonly LinkableKind[],
  actor: Pick<CrmCapabilities, 'canWriteOpportunity' | 'canWriteContract'> | undefined,
): LinkableKind[] {
  return kinds.map((kind) => (isCrmCreatableKind(kind.key) && crmCanCreate(actor, kind.key) ? { ...kind, create: true } : kind));
}

/* ------------------------------------------------------------------ Form */

const peopleOptions = (people: readonly CrmPerson[]): LinkableFormOption[] =>
  people.map((person) => ({ value: person.userId, label: person.displayName }));

const ownerField = (people: readonly CrmPerson[], placeholder = 'Chọn người phụ trách'): LinkableFormField => ({
  key: 'ownerUserId',
  label: 'Người phụ trách',
  type: 'select',
  hint: 'Mặc định là bạn',
  placeholder,
  options: peopleOptions(people),
});

/** Cùng ô, cùng nhãn, cùng giới hạn độ dài với form "Thêm khách hàng" của Bán hàng. */
export function customerCreateForm(options: {
  readonly people: readonly CrmPerson[];
  readonly groups: readonly CustomerGroup[];
  readonly kinds: readonly CustomerKindOption[];
}): LinkableCreateForm {
  const kindOptions = options.kinds.map((kind) => ({ value: kind.code, label: kind.name }));
  return {
    kind: CRM_LINKABLE_KINDS.customer,
    title: 'Thêm khách hàng',
    subtitle: 'Để trống mã để hệ thống tự sinh theo quy tắc cấu hình.',
    fields: [
      { key: 'code', label: 'Mã khách hàng', type: 'text', maxLength: 50, hint: 'Tự sinh nếu để trống' },
      { key: 'name', label: 'Tên khách hàng', type: 'text', maxLength: 300, required: true },
      {
        key: 'taxCode',
        label: 'Mã số thuế',
        type: 'text',
        maxLength: 14,
        placeholder: '0101234567 hoặc 0101234567-001',
        hint: 'Gồm 10 số hoặc 10 số-3 số.',
      },
      {
        key: 'kind',
        label: 'Phân loại',
        type: 'select',
        required: true,
        placeholder: 'Chọn phân loại',
        options: kindOptions,
        // Phân loại mặc định chỉ đặt sẵn khi tenant còn dùng nó, để ô không hiện một giá trị không có trong danh sách.
        defaultValue: kindOptions.some((kind) => kind.value === DEFAULT_CUSTOMER_KIND) ? DEFAULT_CUSTOMER_KIND : undefined,
      },
      {
        key: 'groupId',
        label: 'Nhóm khách hàng',
        type: 'select',
        placeholder: 'Chọn nhóm',
        options: options.groups.map((group) => ({ value: group.id, label: group.name, hint: group.code })),
      },
      ownerField(options.people),
      { key: 'province', label: 'Tỉnh/thành', type: 'text', maxLength: 100 },
      { key: 'region', label: 'Khu vực', type: 'text', maxLength: 100 },
      { key: 'industry', label: 'Ngành', type: 'text', maxLength: 100 },
      { key: 'phone', label: 'Điện thoại', type: 'text', maxLength: 50 },
      { key: 'email', label: 'Email', type: 'text', maxLength: 200 },
      { key: 'creditLimit', label: 'Hạn mức tín dụng (đồng)', type: 'money', min: 0 },
      { key: 'paymentTermDays', label: 'Thời hạn thanh toán (ngày)', type: 'number', min: 0, max: 365 },
      { key: 'address', label: 'Địa chỉ', type: 'text', maxLength: 500, wide: true },
      { key: 'note', label: 'Ghi chú', type: 'textarea', maxLength: 2000, wide: true },
    ],
  };
}

/** Khoá ô "Báo giá" của form lập hợp đồng; cũng là `field` của `create-preview`. */
export const CONTRACT_QUOTE_FIELD = 'quoteId';

/**
 * Cùng ô với form "Lập hợp đồng" của Bán hàng, trừ kho mặc định (chỉ dùng cho dòng hàng, nhập ở màn chi tiết).
 *
 * `value` ở Bán hàng là tổng giá trị hợp đồng ĐÃ GỒM thuế GTGT (bỏ trống thì service cộng thành tiền gồm VAT của các
 * dòng; tạo nhanh không có dòng nên thành 0, trừ khi gắn báo giá: lấy tổng báo giá). Nhãn nói rõ "gồm VAT" để người
 * dùng không nhập nhầm số trước thuế.
 *
 * Ô "Báo giá" (không bắt buộc) như form gốc: tìm chỉ báo giá gắn được theo khách đang chọn (`filters`), chọn xong thì
 * xem trước dòng hàng sẽ nhận (`create-preview`, `contractQuotePreview`) và điền khách nếu còn trống.
 */
export function contractCreateForm(options: { readonly people: readonly CrmPerson[] }): LinkableCreateForm {
  return {
    kind: CRM_LINKABLE_KINDS.contract,
    title: 'Lập hợp đồng',
    subtitle:
      'Hợp đồng lập ở trạng thái Nháp. Gắn báo giá để lấy dòng hàng của báo giá; dòng giá khung và đợt thanh toán nhập ở màn chi tiết hợp đồng.',
    submitLabel: 'Lập hợp đồng',
    fields: [
      {
        key: 'type',
        label: 'Loại hợp đồng',
        type: 'select',
        required: true,
        defaultValue: 'SALE',
        options: CONTRACT_TYPES.map((type) => ({ value: type, label: CONTRACT_TYPE_LABELS[type] })),
      },
      {
        key: 'customerId',
        label: 'Khách hàng',
        type: 'reference',
        reference: CRM_LINKABLE_KINDS.customer,
        // Như form gốc: chọn báo giá mà chưa chọn khách thì service lấy khách của báo giá.
        requiredUnless: CONTRACT_QUOTE_FIELD,
        placeholder: 'Chọn khách hàng',
      },
      {
        key: CONTRACT_QUOTE_FIELD,
        label: 'Báo giá',
        type: 'reference',
        reference: CRM_LINKABLE_KINDS.quote,
        wide: true,
        hint: 'Không bắt buộc. Chọn báo giá khách đã chấp nhận để lấy dòng hàng của báo giá vào hợp đồng.',
        placeholder: 'Không gắn báo giá',
        // Cùng bộ lọc với ô "Báo giá" của form gốc: chỉ báo giá gắn được, theo khách đang chọn.
        filters: [
          { param: 'contractLinkable', value: 'true' },
          { param: 'customerId', fromField: 'customerId' },
        ],
        preview: true,
      },
      { key: 'title', label: 'Tên hợp đồng', type: 'text', maxLength: 300, required: true },
      { key: 'signedDate', label: 'Ngày ký', type: 'date' },
      { key: 'validFrom', label: 'Hiệu lực từ', type: 'date', required: true },
      { key: 'validTo', label: 'Hiệu lực đến', type: 'date' },
      {
        key: 'value',
        label: 'Giá trị hợp đồng (VND, gồm VAT)',
        type: 'money',
        min: 0,
        hint: 'Tổng giá trị ghi trên hợp đồng, đã gồm thuế GTGT.',
      },
      { key: 'warrantyMonths', label: 'Bảo hành (tháng)', type: 'number', min: 0, max: 600 },
      ownerField(options.people, 'Chính bạn'),
      { key: 'note', label: 'Ghi chú', type: 'textarea', maxLength: 4000, wide: true },
    ],
  };
}

/** Cùng ô với form "Thêm dự án bán hàng" của Bán hàng (cơ hội), trừ phần bỏ qua giai đoạn (tuỳ chọn). */
export function opportunityCreateForm(options: {
  readonly people: readonly CrmPerson[];
  readonly pipelines: readonly Pipeline[];
}): LinkableCreateForm {
  const active = options.pipelines.filter((pipeline) => pipeline.active);
  const fallback = options.pipelines.find((pipeline) => pipeline.isDefault) ?? options.pipelines[0];
  // Như form gốc: chỉ hỏi luồng khi tenant có hơn một luồng đang bật; không chọn thì service dùng luồng mặc định.
  const pipelineField: LinkableFormField[] =
    active.length > 1
      ? [
          {
            key: 'pipelineId',
            label: 'Luồng bán hàng',
            type: 'select',
            hint: 'Cơ hội vào giai đoạn đầu của luồng',
            wide: true,
            options: active.map((pipeline) => ({ value: pipeline.id, label: pipeline.name })),
            defaultValue: fallback && active.some((pipeline) => pipeline.id === fallback.id) ? fallback.id : undefined,
          },
        ]
      : [];
  return {
    kind: CRM_LINKABLE_KINDS.opportunity,
    title: 'Thêm cơ hội bán hàng',
    fields: [
      {
        key: 'customerId',
        label: 'Khách hàng',
        type: 'reference',
        reference: CRM_LINKABLE_KINDS.customer,
        required: true,
        wide: true,
        placeholder: 'Tìm khách theo mã, tên, MST',
      },
      ...pipelineField,
      { key: 'name', label: 'Tên dự án bán hàng', type: 'text', maxLength: 300, required: true, wide: true },
      { key: 'probability', label: 'Xác suất thắng (%)', type: 'number', min: 0, max: 100, defaultValue: 10 },
      { key: 'expectedValue', label: 'Giá trị dự kiến (đồng)', type: 'money', min: 0 },
      { key: 'expectedCloseDate', label: 'Ngày chốt dự kiến', type: 'date' },
      { key: 'budget', label: 'Ngân sách khách (đồng)', type: 'money', min: 0 },
      ownerField(options.people),
      { key: 'need', label: 'Nhu cầu', type: 'textarea', maxLength: 4000, wide: true },
    ],
  };
}

/* ------------------------------------------------------------------ Giá trị → request của Bán hàng */

/** Chuỗi hoặc `null`; số thì đổi thành chuỗi. */
function textOf(values: LinkableFormValues, key: string): string | null {
  const value = values[key];
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

/**
 * Số hoặc `null`. Chuỗi được đọc thành số; đọc không được thì để `NaN` cho validator của service báo đúng câu của nó
 * (không âm thầm bỏ ô sai).
 */
function numberOf(values: LinkableFormValues, key: string): number | null {
  const value = values[key];
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  const text = value.trim();
  return text ? Number(text) : null;
}

export function customerRequest(values: LinkableFormValues, confirm: boolean): CreateCustomerRequest {
  return {
    code: textOf(values, 'code'),
    // Chuỗi rỗng để service báo "Vui lòng nhập tên khách hàng" như form gốc.
    name: textOf(values, 'name') ?? '',
    taxCode: textOf(values, 'taxCode'),
    address: textOf(values, 'address'),
    province: textOf(values, 'province'),
    region: textOf(values, 'region'),
    industry: textOf(values, 'industry'),
    phone: textOf(values, 'phone'),
    email: textOf(values, 'email'),
    groupId: textOf(values, 'groupId'),
    kind: textOf(values, 'kind') ?? DEFAULT_CUSTOMER_KIND,
    creditLimit: numberOf(values, 'creditLimit'),
    paymentTermDays: numberOf(values, 'paymentTermDays'),
    note: textOf(values, 'note'),
    ownerUserId: textOf(values, 'ownerUserId'),
    confirmDuplicateTaxCode: confirm,
  };
}

/**
 * Gắn báo giá (`quoteId`) thì `ContractService.create` lấy dòng từ phiên bản khách chấp nhận, kiểm điều kiện gắn trong
 * cùng transaction, và lấy khách của báo giá khi `customerId` trống.
 */
export function contractRequest(values: LinkableFormValues): SaveContractRequest {
  return {
    type: (textOf(values, 'type') ?? 'SALE') as ContractType,
    customerId: textOf(values, 'customerId') ?? '',
    quoteId: textOf(values, CONTRACT_QUOTE_FIELD),
    title: textOf(values, 'title') ?? '',
    signedDate: textOf(values, 'signedDate'),
    validFrom: textOf(values, 'validFrom') ?? '',
    validTo: textOf(values, 'validTo'),
    value: numberOf(values, 'value'),
    warrantyMonths: numberOf(values, 'warrantyMonths'),
    ownerUserId: textOf(values, 'ownerUserId'),
    note: textOf(values, 'note'),
    lines: [],
  };
}

const MONEY_TEXT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const PERCENT_TEXT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

/**
 * Bản xem trước của ô "Báo giá" (form lập hợp đồng): đúng dòng, tổng mà `ContractService.create` sẽ lấy (cùng bộ dựng
 * `quoteContractPreview` với màn Bán hàng). Điền khách của báo giá và tên hợp đồng nếu người dùng chưa nhập.
 */
export function contractQuotePreview(preview: ContractQuotePreview): LinkableCreatePreview {
  const total = `${MONEY_TEXT.format(preview.totalAmount)} ₫`;
  return {
    field: CONTRACT_QUOTE_FIELD,
    value: preview.quoteId,
    title: `Dòng hàng từ báo giá ${preview.quoteCode}`,
    note:
      `Hợp đồng nhận ${preview.lines.length} dòng của phiên bản ${preview.versionNo} khách đã chấp nhận (dòng trùng mặt ` +
      `hàng được gộp), tổng báo giá ${total}. Bỏ trống giá trị hợp đồng thì lấy tổng báo giá. Bỏ chọn báo giá để lập ` +
      `hợp đồng không gắn báo giá.`,
    columns: [
      { key: 'lineNo', label: '#', type: 'number' },
      { key: 'material', label: 'Mặt hàng', type: 'text' },
      { key: 'quantity', label: 'SL', type: 'number' },
      { key: 'unit', label: 'ĐVT', type: 'text' },
      { key: 'unitPrice', label: 'Đơn giá', type: 'money' },
      { key: 'vat', label: 'VAT', type: 'text' },
      { key: 'lineAmount', label: 'Thành tiền', type: 'money' },
    ],
    rows: preview.lines.map((line) => ({
      lineNo: line.lineNo,
      material: `${line.materialCode} ${line.materialName}`,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice,
      vat: `${PERCENT_TEXT.format(line.vatRate)}%`,
      lineAmount: line.lineAmount,
    })),
    fill: {
      customerId: { value: preview.customerId, label: `${preview.customerCode} — ${preview.customerName}` },
      title: { value: `Hợp đồng theo báo giá ${preview.quoteCode}` },
    },
  };
}

export function opportunityRequest(values: LinkableFormValues): CreateOpportunityRequest {
  const probability = numberOf(values, 'probability');
  return {
    customerId: textOf(values, 'customerId') ?? '',
    pipelineId: textOf(values, 'pipelineId'),
    name: textOf(values, 'name') ?? '',
    // Trống thì để service dùng mặc định của nó.
    ...(probability === null ? {} : { probability }),
    expectedValue: numberOf(values, 'expectedValue'),
    expectedCloseDate: textOf(values, 'expectedCloseDate'),
    budget: numberOf(values, 'budget'),
    need: textOf(values, 'need'),
    ownerUserId: textOf(values, 'ownerUserId'),
  };
}

/** Cảnh báo trùng mã số thuế thành các dòng cho bên gọi hiện kèm nút "Vẫn lưu". */
export function duplicateTaxCodeWarnings(matches: unknown): string[] {
  if (!Array.isArray(matches)) return [];
  return (matches as TaxCodeMatch[])
    .filter((match) => match && typeof match.code === 'string')
    .map((match) => `${match.code} - ${match.name}`);
}
