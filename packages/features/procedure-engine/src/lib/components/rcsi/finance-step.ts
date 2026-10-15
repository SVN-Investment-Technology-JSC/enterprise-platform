import type {
  FinanceVoucherSourceField,
  ProcedureAttributeDefinition,
  ProcedureDefinition,
  ProcedureStepFinanceVoucher,
  ProcedureStepIntegration,
} from '@enterprise-platform/contracts-procedure-engine';
import {
  buildFlowIndex,
  dominatorStepIds,
  FINANCE_VOUCHER_SOURCE_ATTRIBUTE_CODES,
  FINANCE_VOUCHER_SOURCE_FIELD_TYPES,
} from '@enterprise-platform/contracts-procedure-engine';

/**
 * Thuộc tính mà bước Tài chính đọc được: của quy trình, hoặc của bước chắc chắn
 * đã đi qua trước nó. Cùng luật với kiểm tra công bố phía server, để danh sách
 * chọn không chào mời thứ mà lúc công bố sẽ bị chặn.
 */
export interface FinanceAttributeCandidate {
  readonly key: string;
  readonly attribute: ProcedureAttributeDefinition;
  /** "Cấp quy trình" hoặc tên bước chứa thuộc tính. */
  readonly scopeLabel: string;
}

function stepsBefore(definition: ProcedureDefinition, stepId: string): Set<string> {
  const before = dominatorStepIds(buildFlowIndex(definition.steps, definition.gateways), stepId);
  before.delete(stepId);
  return before;
}

export function financeAttributeCandidates(definition: ProcedureDefinition, stepId: string): FinanceAttributeCandidate[] {
  const before = stepsBefore(definition, stepId);
  const candidates: FinanceAttributeCandidate[] = (definition.attributes ?? []).map((attribute) => ({
    key: `process:${attribute.code}`,
    attribute,
    scopeLabel: 'Cấp quy trình',
  }));
  for (const step of [...definition.steps].sort((left, right) => left.order - right.order)) {
    if (!before.has(step.id)) continue;
    for (const attribute of step.attributes ?? []) {
      candidates.push({ key: `step:${step.id}:${attribute.code}`, attribute, scopeLabel: `Bước “${step.name}”` });
    }
  }
  return candidates;
}

/** Thuộc tính được dùng khi trường không khai ánh xạ, theo đúng thứ tự ưu tiên mã của server. */
export function autoMatchedCandidate(
  field: FinanceVoucherSourceField,
  candidates: readonly FinanceAttributeCandidate[],
): FinanceAttributeCandidate | undefined {
  for (const code of FINANCE_VOUCHER_SOURCE_ATTRIBUTE_CODES[field]) {
    const match = candidates.find(
      (candidate) =>
        candidate.attribute.code.toLowerCase() === code &&
        FINANCE_VOUCHER_SOURCE_FIELD_TYPES[field].includes(candidate.attribute.type),
    );
    if (match) return match;
  }
  return undefined;
}

/** Thuộc tính đúng kiểu cho một trường phiếu. */
export function candidatesForField(
  field: FinanceVoucherSourceField,
  candidates: readonly FinanceAttributeCandidate[],
): FinanceAttributeCandidate[] {
  return candidates.filter((candidate) => FINANCE_VOUCHER_SOURCE_FIELD_TYPES[field].includes(candidate.attribute.type));
}

/** Bước có thể nhận hồ sơ khi kế toán trả về: các bước chắc chắn đã đi qua trước bước Tài chính. */
export function financeReturnTargets(definition: ProcedureDefinition, stepId: string) {
  const before = stepsBefore(definition, stepId);
  return [...definition.steps]
    .sort((left, right) => left.order - right.order)
    .filter((step) => before.has(step.id));
}

/** Bỏ các ánh xạ trống để không gửi `mapping: {}` hay khoá rỗng lên server. */
export function cleanIntegration(integration: ProcedureStepIntegration): ProcedureStepIntegration {
  const mapping = Object.fromEntries(
    Object.entries(integration.mapping ?? {}).filter(([, value]) => typeof value === 'string' && value.trim()),
  ) as Partial<Record<FinanceVoucherSourceField, string>>;
  return {
    module: 'finance',
    action: 'voucher',
    voucherKind: integration.voucherKind,
    ...(Object.keys(mapping).length ? { mapping } : {}),
    ...(integration.returnToStepId ? { returnToStepId: integration.returnToStepId } : {}),
  };
}

const money = (value: number | undefined) =>
  typeof value === 'number' ? `${value.toLocaleString('vi-VN')} đ` : undefined;

export type FinanceVoucherTone = 'waiting' | 'info' | 'success' | 'warning';

/** Nội dung thẻ phiếu trên bước Tài chính của hồ sơ, theo tiến trình phiếu. */
export function financeVoucherCard(voucher: ProcedureStepFinanceVoucher): {
  readonly title: string;
  readonly detail?: string;
  readonly tone: FinanceVoucherTone;
} {
  switch (voucher.state) {
    case 'requested':
      // Hồ sơ quay lại bước sau khi bị trả: phiếu nháp cũ được cập nhật, không tạo phiếu mới.
      return voucher.code
        ? { title: `${voucher.code} · Chờ Tài chính cập nhật phiếu`, tone: 'waiting' }
        : { title: 'Chờ Tài chính tạo phiếu', tone: 'waiting' };
    case 'linked':
      return {
        title: [voucher.code, 'Chờ ghi sổ', money(voucher.amount)].filter(Boolean).join(' · '),
        tone: 'info',
      };
    case 'posted':
      return {
        title: [
          voucher.code,
          voucher.postedByName ? `Đã ghi sổ bởi ${voucher.postedByName}` : 'Đã ghi sổ',
          money(voucher.amount),
        ]
          .filter(Boolean)
          .join(' · '),
        tone: 'success',
      };
    case 'returned':
      return {
        title: 'Kế toán đã trả hồ sơ',
        detail: voucher.returnedReason ? `Lý do: ${voucher.returnedReason}` : undefined,
        tone: 'warning',
      };
  }
}

/**
 * Đường dẫn mở phiếu ở app Tài chính (cùng gateway, basePath `/modules/finance`),
 * theo khuôn trang dự án đang dùng (`projectVoucherHref` bên Workspace).
 */
export function financeVoucherHref(kind: ProcedureStepIntegration['voucherKind'], voucherId: string): string {
  return `/modules/finance/${kind === 'RECEIPT' ? 'receipts' : 'payments'}/${encodeURIComponent(voucherId)}`;
}
