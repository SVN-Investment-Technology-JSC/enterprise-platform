import type { ProcedureRaciRole } from '@enterprise-platform/contracts-procedure-engine';

/**
 * Nhãn và gợi ý của ô ý kiến theo vai người đang xử lý giữ ở bước. Giữ nhiều
 * vai thì lấy vai quyết định thao tác chính: A duyệt, R xem xét và
 * đề xuất cho người duyệt, E thực thi, C góp ý chuyên môn, S lập.
 */
const COMMENT_PROMPTS: readonly (readonly [ProcedureRaciRole, { label: string; placeholder: string }])[] = [
  ['A', { label: 'Ý kiến phê duyệt / lý do trả lại', placeholder: 'Nêu ý kiến phê duyệt, hoặc lý do trả lại và điểm cần điều chỉnh…' }],
  ['R', { label: 'Ý kiến xem xét', placeholder: 'Nêu nhận xét sau khi xem xét hồ sơ, tài liệu và đề xuất cho người duyệt…' }],
  ['E', { label: 'Báo cáo thực thi', placeholder: 'Mô tả phần việc đã thực thi, tiến độ và vướng mắc nếu có…' }],
  ['C', { label: 'Ý kiến chuyên môn / thẩm định', placeholder: 'Nêu ý kiến chuyên môn, điểm cần lưu ý hoặc đề xuất điều chỉnh…' }],
  ['S', { label: 'Nội dung đề nghị / ghi chú gửi kèm', placeholder: 'Ghi rõ nội dung đề nghị, căn cứ hoặc thông tin bổ sung cho người duyệt…' }],
];

const DEFAULT_COMMENT_PROMPT = {
  label: 'Ghi chú phản hồi / lý do từ chối',
  placeholder: 'Nhập nhận xét hoặc phương án điều chỉnh…',
};

export function commentPromptFor(roles: readonly ProcedureRaciRole[]): { label: string; placeholder: string } {
  return COMMENT_PROMPTS.find(([role]) => roles.includes(role))?.[1] ?? DEFAULT_COMMENT_PROMPT;
}

/**
 * Câu gợi ý cho người đang mở bước. Một bước có thể chạy lần lượt nhiều pha (R
 * xong mới tới A), nên người xử lý được pha hiện tại — giữ vai đó, hoặc quản trị
 * xử lý thay — thấy câu của pha đó. Còn lại theo vai mình giữ ở bước.
 */
export function stepCommentPrompt(
  stage: ProcedureRaciRole | null | undefined,
  myRoles: readonly ProcedureRaciRole[],
  isOverride: boolean,
): { label: string; placeholder: string } {
  if (stage && (isOverride || myRoles.includes(stage))) return commentPromptFor([stage]);
  return commentPromptFor(myRoles);
}
