import {
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUS_TRANSITIONS,
  CONTRACT_STATUSES,
  type ContractStatus,
} from '@enterprise-platform/contracts-crm';
import { CrmConflictError } from './crm.error.js';
import { roundVnd } from './pricing-engine.js';

/**
 * Máy trạng thái hợp đồng (mục 5.3 kế hoạch):
 *
 * - Nháp → Hiệu lực (xác nhận: đợt thanh toán hợp lệ, giữ đủ hàng) hoặc Đã huỷ;
 * - Hiệu lực → Hoàn thành (giao và thu đủ), Hết hạn (job theo ngày), Đã huỷ
 *   (chưa có đơn đã giao; nhả mọi phần giữ);
 * - Hoàn thành, Hết hạn → Đã thanh lý (pháp chế xác nhận);
 * - Đã thanh lý, Đã huỷ là trạng thái cuối.
 *
 * Chuyển không có trong bảng trả 409 với thông báo tiếng Việt.
 */
export function isContractStatus(value: unknown): value is ContractStatus {
  return typeof value === 'string' && (CONTRACT_STATUSES as readonly string[]).includes(value);
}

export function canContractTransition(from: ContractStatus, to: ContractStatus): boolean {
  return CONTRACT_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertContractTransition(from: ContractStatus, to: ContractStatus): void {
  if (canContractTransition(from, to)) return;
  throw new CrmConflictError(
    'INVALID_CONTRACT_TRANSITION',
    `Không thể chuyển hợp đồng từ "${CONTRACT_STATUS_LABELS[from]}" sang "${CONTRACT_STATUS_LABELS[to]}".`,
  );
}

/** Mã hợp đồng dạng `HD<yy><5 chữ số>` từ năm (giờ Việt Nam) và số thứ tự. */
export function formatContractCode(year: number, sequence: number): string {
  return `HD${String(year % 100).padStart(2, '0')}${String(sequence).padStart(5, '0')}`;
}

/** Ngày `today` nằm trong hiệu lực `[from, to]` của hợp đồng (cả hai mốc tính trọn ngày). */
export function contractInForce(contract: { validFrom: string; validTo: string | null }, today: string): boolean {
  return contract.validFrom <= today && (!contract.validTo || today <= contract.validTo);
}

/**
 * Hợp đồng dùng được để lập hoặc xác nhận đơn: phải Hiệu lực và hôm nay nằm
 * trong thời hạn. Hợp đồng hết hạn (kể cả khi job chưa kịp chuyển) trả 409
 * "Hợp đồng đã hết hiệu lực" (TC-CON-03).
 */
export function assertContractUsableForOrder(
  contract: { status: ContractStatus; validFrom: string; validTo: string | null; code: string },
  today: string,
): void {
  if (contract.status === 'EXPIRED' || (contract.validTo && contract.validTo < today && contract.status === 'ACTIVE')) {
    throw new CrmConflictError('CONTRACT_EXPIRED', 'Hợp đồng đã hết hiệu lực.');
  }
  if (contract.status === 'DRAFT') {
    throw new CrmConflictError(
      'CONTRACT_NOT_ACTIVE',
      `Hợp đồng ${contract.code} chưa có hiệu lực; vui lòng xác nhận hợp đồng trước.`,
    );
  }
  if (contract.status !== 'ACTIVE') {
    throw new CrmConflictError(
      'CONTRACT_CLOSED',
      `Hợp đồng ${contract.code} đang ở trạng thái "${CONTRACT_STATUS_LABELS[contract.status]}", không lập đơn được.`,
    );
  }
  if (contract.validFrom > today) {
    throw new CrmConflictError('CONTRACT_NOT_STARTED', `Hợp đồng ${contract.code} chưa đến ngày hiệu lực.`);
  }
}

/** Dòng hợp đồng cần giữ hàng khi xác nhận: hàng tồn kho có số lượng; dịch vụ bỏ qua (CON-05). */
export function reservableContractLines<T extends { materialKind: string; quantity: number | null }>(lines: readonly T[]): T[] {
  return lines.filter((line) => line.materialKind !== 'SERVICE' && line.quantity !== null && line.quantity > 0);
}

/** Thành tiền trước VAT của dòng có số lượng, làm tròn đến đồng. */
export function contractLineAmount(quantity: number | null, unitPrice: number): number | null {
  return quantity === null ? null : roundVnd(quantity * unitPrice);
}

/** Giá trị mặc định của hợp đồng: cộng thành tiền gồm VAT của các dòng có số lượng. */
export function contractDefaultValue(lines: readonly { lineAmount: number | null; vatRate: number }[]): number {
  return lines.reduce((sum, line) => {
    if (line.lineAmount === null) return sum;
    return sum + line.lineAmount + roundVnd((line.lineAmount * line.vatRate) / 100);
  }, 0);
}
