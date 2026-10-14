import {
  buildFlowIndex,
  firstFlowStepId,
  type ProcedureAttributeDefinition,
  type ProcedureAttributeValue,
  type ProcedureDefinition,
} from '@enterprise-platform/contracts-procedure-engine';
import { FINANCE_VOUCHER_KIND_LABELS, type FinanceVoucherKind } from '@enterprise-platform/contracts-finance';

/** Nguồn hồ sơ trong Procedure: sourceId là id lần gửi (procedure_links.id), không phải id phiếu. */
export const FINANCE_SOURCE_TYPE = 'finance_voucher';

/** Người khởi tạo thay mặt hệ thống khi không có người dùng cụ thể (kết quả do quy trình áp vào phiếu). */
export const FINANCE_SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000008';

/** Dữ liệu phiếu mà quy trình có thể đọc, tách khỏi cấu trúc lưu trữ. */
export interface VoucherProcedureFacts {
  kind: FinanceVoucherKind;
  code: string;
  content: string;
  totalAmount: number;
  postingDate: string;
  voucherDate: string;
  reasonName: string | null;
  accountName: string | null;
  destAccountName: string | null;
  counterpartyGroupName: string | null;
  counterpartyName: string | null;
  costCenterName: string | null;
}

type Resolver = (facts: VoucherProcedureFacts) => string | number | null;

/**
 * Thuộc tính mà Tài chính tự điền vào hồ sơ quy trình, theo mã thuộc tính trong định nghĩa (không phân biệt hoa thường).
 * Quy trình dùng chúng để rẽ nhánh (ví dụ số tiền lớn thì thêm cấp duyệt) và hiển thị trên hồ sơ.
 */
export const FINANCE_PROCEDURE_ATTRIBUTES: readonly {
  readonly codes: readonly string[];
  readonly label: string;
  readonly types: readonly ProcedureAttributeDefinition['type'][];
  readonly resolve: Resolver;
}[] = [
  { codes: ['so_tien', 'amount', 'tong_tien'], label: 'Số tiền của phiếu', types: ['number', 'money'], resolve: (f) => f.totalAmount },
  { codes: ['noi_dung', 'content'], label: 'Nội dung phiếu', types: ['text'], resolve: (f) => f.content },
  { codes: ['ma_phieu', 'voucher_code'], label: 'Mã phiếu', types: ['text'], resolve: (f) => f.code },
  { codes: ['loai_phieu', 'voucher_kind'], label: 'Loại phiếu (Phiếu thu, Phiếu chi, Lệnh chuyển tiền)', types: ['text', 'select'], resolve: (f) => FINANCE_VOUCHER_KIND_LABELS[f.kind] },
  { codes: ['ly_do', 'reason'], label: 'Lý do thu/chi', types: ['text'], resolve: (f) => f.reasonName },
  { codes: ['tai_khoan', 'account'], label: 'Tài khoản thu/chi/nguồn', types: ['text'], resolve: (f) => f.accountName },
  { codes: ['tai_khoan_dich', 'dest_account'], label: 'Tài khoản đích (chuyển tiền)', types: ['text'], resolve: (f) => f.destAccountName },
  { codes: ['doi_tuong', 'counterparty_group'], label: 'Nhóm đối tượng', types: ['text'], resolve: (f) => f.counterpartyGroupName },
  { codes: ['nguoi_nop_nhan', 'counterparty'], label: 'Người nộp/nhận tiền', types: ['text'], resolve: (f) => f.counterpartyName },
  { codes: ['hach_toan_noi_bo', 'cost_center'], label: 'Đơn vị hạch toán', types: ['text'], resolve: (f) => f.costCenterName },
  { codes: ['ngay_hach_toan', 'posting_date'], label: 'Ngày hạch toán', types: ['date'], resolve: (f) => f.postingDate },
  { codes: ['ngay_lap', 'voucher_date'], label: 'Ngày lập phiếu', types: ['date'], resolve: (f) => f.voucherDate },
];

const byCode = new Map(FINANCE_PROCEDURE_ATTRIBUTES.flatMap((entry) => entry.codes.map((code) => [code, entry] as const)));

export interface InitialAttributeSpec extends ProcedureAttributeDefinition {
  readonly scope: 'process' | 'step';
  readonly valueKey: string;
  readonly stepName?: string;
}

/** Thuộc tính người khởi tạo phải điền lúc gửi: thuộc tính cấp quy trình và thuộc tính của bước đầu tiên. */
export function initialProcedureAttributes(definition: ProcedureDefinition): InitialAttributeSpec[] {
  const steps = definition.steps ?? [];
  const firstId = steps.length ? firstFlowStepId(buildFlowIndex(steps, definition.gateways)) : null;
  const first = steps.find((step) => step.id === firstId);
  return [
    ...(definition.attributes ?? []).map((attribute) => ({
      ...attribute,
      scope: 'process' as const,
      valueKey: `process:${attribute.code}`,
    })),
    ...(first?.attributes ?? []).map((attribute) => ({
      ...attribute,
      scope: 'step' as const,
      valueKey: `step:${first?.id}:${attribute.code}`,
      stepName: first?.name,
    })),
  ];
}

function selectOption(spec: ProcedureAttributeDefinition, wanted: string): string | null {
  const needle = wanted.trim().toLowerCase();
  const match = (spec.options ?? []).find((option) => option.code.toLowerCase() === needle || option.label.trim().toLowerCase() === needle);
  return match?.code ?? null;
}

/** Giá trị một thuộc tính của quy trình lấy từ phiếu; null nếu Tài chính không có hoặc kiểu không khớp. */
export function procedureValueFor(spec: ProcedureAttributeDefinition, facts: VoucherProcedureFacts): ProcedureAttributeValue | null {
  const entry = byCode.get(spec.code.trim().toLowerCase());
  if (!entry || !entry.types.includes(spec.type)) return null;
  const raw = entry.resolve(facts);
  if (raw === null || raw === '') return null;
  switch (spec.type) {
    case 'number':
    case 'money':
      return typeof raw === 'number' ? { type: spec.type, value: raw } : null;
    case 'date':
      return typeof raw === 'string' ? { type: 'date', value: raw } : null;
    case 'select': {
      const code = typeof raw === 'string' ? selectOption(spec, raw) : null;
      return code ? { type: 'select', value: code } : null;
    }
    case 'text':
      return { type: 'text', value: String(raw) };
    default:
      return null;
  }
}

export interface ProcedureAttributePlan {
  /** Giá trị gửi sang Procedure, theo `valueKey` của từng thuộc tính. */
  values: Record<string, ProcedureAttributeValue>;
  /** Thuộc tính bắt buộc mà phiếu không cung cấp được: quy trình không khởi tạo được nếu còn thiếu. */
  missingRequired: InitialAttributeSpec[];
}

export function planProcedureAttributes(definition: ProcedureDefinition, facts: VoucherProcedureFacts): ProcedureAttributePlan {
  const values: Record<string, ProcedureAttributeValue> = {};
  const missingRequired: InitialAttributeSpec[] = [];
  for (const spec of initialProcedureAttributes(definition)) {
    const value = procedureValueFor(spec, facts);
    if (value) values[spec.valueKey] = value;
    else if (spec.required) missingRequired.push(spec);
  }
  return { values, missingRequired };
}

/** Tiêu đề hồ sơ: "Phiếu chi PC_12_10_2026 - Chi văn phòng phẩm". */
export function procedureTitle(facts: Pick<VoucherProcedureFacts, 'kind' | 'code' | 'content'>): string {
  return `${FINANCE_VOUCHER_KIND_LABELS[facts.kind]} ${facts.code} - ${facts.content}`.slice(0, 255);
}

/** Mô tả cho người cấu hình: thuộc tính bắt buộc không hỗ trợ khiến quy trình không dùng được cho phiếu. */
export function unsupportedRequiredAttributes(definition: ProcedureDefinition): InitialAttributeSpec[] {
  return initialProcedureAttributes(definition).filter((spec) => {
    if (!spec.required) return false;
    const entry = byCode.get(spec.code.trim().toLowerCase());
    return !entry || !entry.types.includes(spec.type);
  });
}

/** Cảnh báo khi gán quy trình: Tài chính tự hoàn thành bước S của người lập, nên bước đầu nên chỉ có vai S. */
export function startStepWarnings(definition: ProcedureDefinition): string[] {
  const steps = definition.steps ?? [];
  const firstId = steps.length ? firstFlowStepId(buildFlowIndex(steps, definition.gateways)) : null;
  const first = steps.find((step) => step.id === firstId);
  if (!first) return ['Quy trình chưa có bước nào; phiếu sẽ không chạy được.'];
  const roles = new Set((first.assignments ?? []).map((assignment) => assignment.role));
  if (roles.size === 1 && roles.has('S')) return [];
  return [`Bước đầu “${first.name}” không chỉ có vai S của người lập, phiếu sẽ dừng chờ người lập mở quy trình xử lý.`];
}
