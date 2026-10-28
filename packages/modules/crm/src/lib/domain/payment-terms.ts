import {
  PAYMENT_TERM_CONDITIONS,
  PAYMENT_TERMS_MAX,
  type PaymentTermCondition,
  type SavePaymentTermRequest,
} from '@enterprise-platform/contracts-crm';
import { CrmValidationError } from './crm.error.js';
import { optionalDate, optionalInteger, optionalText } from './fields.js';
import { roundVnd } from './pricing-engine.js';

/**
 * Đợt thanh toán của hợp đồng (CON-03, T4-03): hàm thuần.
 *
 * - Mỗi đợt nhập phần trăm hoặc số tiền, không cả hai.
 * - Điều kiện: theo ngày (bắt buộc hạn), khi ký, khi giao hàng, khi nghiệm thu
 *   (tuỳ chọn số ngày phải thu sau điều kiện).
 * - Tổng các đợt bằng 100% giá trị hợp đồng: toàn phần trăm thì cộng đúng 100;
 *   có đợt nhập số tiền thì cộng số tiền (đợt phần trăm quy ra tiền) đúng bằng
 *   giá trị. Đợt phần trăm cuối cùng nhận phần lẻ làm tròn để tổng khớp đến đồng.
 */

export interface PaymentTermDraft {
  readonly seq: number;
  readonly name: string;
  readonly percent: number | null;
  readonly amount: number;
  readonly condition: PaymentTermCondition;
  readonly dueDate: string | null;
  readonly dueDays: number | null;
  readonly note: string | null;
}

export const PAYMENT_TERMS_TOTAL_MESSAGE = 'Tổng các đợt phải bằng 100% giá trị hợp đồng.';

const totalError = () => new CrmValidationError('PAYMENT_TERMS_TOTAL', PAYMENT_TERMS_TOTAL_MESSAGE);

/** Phần trăm ở đơn vị 1/10.000 % để cộng không sai số. */
const percentUnits = (percent: number) => Math.round(percent * 10_000);

/**
 * Kiểm và chuẩn hoá danh sách đợt theo giá trị hợp đồng. `strict = false` bỏ
 * qua kiểm tổng (dùng khi tính lại số tiền sau khi đổi giá trị hợp đồng, việc
 * kiểm tổng để tới lúc xác nhận).
 */
export function normalizePaymentTerms(
  input: readonly SavePaymentTermRequest[] | unknown,
  contractValue: number,
  strict = true,
): PaymentTermDraft[] {
  if (!Array.isArray(input)) throw new CrmValidationError('INVALID_TERMS', 'Danh sách đợt thanh toán không hợp lệ.');
  if (input.length > PAYMENT_TERMS_MAX) {
    throw new CrmValidationError('TOO_MANY_TERMS', `Hợp đồng tối đa ${PAYMENT_TERMS_MAX} đợt thanh toán.`);
  }
  const drafts = (input as SavePaymentTermRequest[]).map((raw, index) => termDraft(raw ?? ({} as SavePaymentTermRequest), index, contractValue));
  if (!drafts.length) return drafts;

  const allPercent = drafts.every((term) => term.percent !== null);
  if (allPercent) {
    const total = drafts.reduce((sum, term) => sum + percentUnits(term.percent as number), 0);
    if (total !== 1_000_000) {
      if (strict) throw totalError();
      return drafts;
    }
    // Đợt cuối nhận phần lẻ làm tròn để tổng khớp giá trị đến đồng.
    const others = drafts.slice(0, -1).reduce((sum, term) => sum + term.amount, 0);
    const last = drafts[drafts.length - 1];
    return [...drafts.slice(0, -1), { ...last, amount: roundVnd(contractValue - others) }];
  }
  const total = drafts.reduce((sum, term) => sum + term.amount, 0);
  if (strict && total !== roundVnd(contractValue)) throw totalError();
  return drafts;
}

/** Kiểm lại đợt đã lưu lúc xác nhận hợp đồng: tổng phải khớp giá trị hiện tại. */
export function assertPaymentTermsBalanced(
  terms: readonly { percent: number | null; amount: number }[],
  contractValue: number,
): void {
  if (!terms.length) return;
  if (terms.every((term) => term.percent !== null)) {
    const total = terms.reduce((sum, term) => sum + percentUnits(term.percent as number), 0);
    if (total !== 1_000_000) throw totalError();
  }
  const amount = terms.reduce((sum, term) => sum + term.amount, 0);
  if (amount !== roundVnd(contractValue)) throw totalError();
}

function termDraft(raw: SavePaymentTermRequest, index: number, contractValue: number): PaymentTermDraft {
  const label = `Đợt ${index + 1}`;
  const fail = (code: string, message: string) => new CrmValidationError(code, `${label}: ${message}`, { term: index + 1 });
  const name = optionalText(raw.name, 200, 'tên đợt') ?? label;
  const hasPercent = raw.percent !== undefined && raw.percent !== null && (raw.percent as unknown) !== '';
  const hasAmount = raw.amount !== undefined && raw.amount !== null && (raw.amount as unknown) !== '';
  if (hasPercent === hasAmount) throw fail('TERM_VALUE_REQUIRED', 'nhập phần trăm hoặc số tiền (một trong hai).');
  let percent: number | null = null;
  let amount: number;
  if (hasPercent) {
    const value = Number(raw.percent);
    if (!Number.isFinite(value) || value <= 0 || value > 100) throw fail('INVALID_PERCENT', 'phần trăm phải lớn hơn 0 và không quá 100.');
    percent = Math.round(value * 10_000) / 10_000;
    amount = roundVnd((contractValue * percent) / 100);
  } else {
    const value = Number(raw.amount);
    if (!Number.isFinite(value) || value < 0 || value >= 1e16) throw fail('INVALID_AMOUNT', 'số tiền phải là số không âm.');
    amount = roundVnd(value);
  }
  const condition = raw.condition;
  if (!PAYMENT_TERM_CONDITIONS.includes(condition)) throw fail('INVALID_CONDITION', 'điều kiện thanh toán không hợp lệ.');
  let dueDate: string | null;
  let dueDays: number | null;
  try {
    dueDate = optionalDate(raw.dueDate, 'hạn thanh toán');
    dueDays = optionalInteger(raw.dueDays, 0, 3650, 'số ngày phải thu');
  } catch (error) {
    if (error instanceof CrmValidationError) throw fail(error.code, error.message.charAt(0).toLowerCase() + error.message.slice(1));
    throw error;
  }
  if (condition === 'DATE' && !dueDate) throw fail('DUE_DATE_REQUIRED', 'điều kiện "Theo ngày" phải có hạn thanh toán.');
  return {
    seq: index + 1,
    name,
    percent,
    amount,
    condition,
    dueDate,
    dueDays,
    note: optionalText(raw.note, 1000, 'ghi chú'),
  };
}
