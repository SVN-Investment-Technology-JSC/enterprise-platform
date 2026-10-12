/**
 * Kiểm tra khả dụng khi nộp đơn nghỉ trừ quỹ phép (thuần).
 * Ứng phép bật: hạn mức vượt = phần còn có thể ứng (đúng bằng quỹ cả năm), ưu tiên hơn negative_limit.
 * Ứng phép tắt: dùng negative_limit như cũ.
 */
export function leaveAvailability(input: {
  remaining: number;
  pending: number;
  amount: number;
  allowAdvance: boolean;
  advanceHeadroom: number;
  negativeLimit: number;
}) {
  const allowance = input.allowAdvance
    ? Math.max(0, input.advanceHeadroom)
    : input.negativeLimit;
  const available = input.remaining - input.pending;
  return {
    allowance,
    allowed: available - input.amount >= -allowance - 0.005,
    /** Vượt phần đã tích luỹ (phải dựa vào ứng phép / hạn mức âm). */
    isNegative: input.amount > available + 0.005,
  };
}
