export const MIN_POLICY_REASON_LENGTH = 10;
export const MAX_POLICY_REASON_LENGTH = 500;

export interface ApprovalPolicySettings {
  allowSelfApproval: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** Kiểm tra lý do thay đổi chính sách; trả về thông báo lỗi hoặc chuỗi rỗng nếu hợp lệ. */
export function validatePolicyReason(reason: string): string {
  const length = reason.trim().length;
  if (length < MIN_POLICY_REASON_LENGTH)
    return `Lý do cần tối thiểu ${MIN_POLICY_REASON_LENGTH} ký tự.`;
  if (length > MAX_POLICY_REASON_LENGTH)
    return `Lý do tối đa ${MAX_POLICY_REASON_LENGTH} ký tự.`;
  return '';
}

/** Trạng thái đích khi bấm công tắc, nhãn nút và cảnh báo rủi ro tương ứng. */
export function policyToggleCopy(current: boolean) {
  const target = !current;
  return {
    target,
    buttonLabel: target ? 'Bật cho phép tự duyệt' : 'Tắt cho phép tự duyệt',
    confirmTitle: target
      ? 'Bật ngoại lệ tự duyệt đơn?'
      : 'Tắt ngoại lệ tự duyệt đơn?',
    confirmDescription: target
      ? 'Rủi ro kiểm soát nội bộ: người duyệt có thể tự duyệt đơn của chính mình, mất nguyên tắc phân tách nhiệm vụ. Chỉ bật khi tổ chức không có người duyệt thay thế.'
      : 'Từ lúc này người duyệt không thể tự duyệt đơn của chính mình.',
    okText: target ? 'Bật ngoại lệ' : 'Tắt ngoại lệ',
    okType: target ? ('danger' as const) : ('primary' as const),
  };
}
