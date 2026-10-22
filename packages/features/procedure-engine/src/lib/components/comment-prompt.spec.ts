import { commentPromptFor, stepCommentPrompt } from './comment-prompt';

describe('commentPromptFor', () => {
  it('changes the prompt by role and prefers the approver', () => {
    expect(commentPromptFor(['S']).label).toBe('Nội dung đề nghị / ghi chú gửi kèm');
    expect(commentPromptFor(['R']).label).toBe('Ý kiến xem xét');
    expect(commentPromptFor(['C']).label).toBe('Ý kiến chuyên môn / thẩm định');
    expect(commentPromptFor(['R', 'A']).label).toBe('Ý kiến phê duyệt / lý do trả lại');
    expect(commentPromptFor([]).label).toBe('Ghi chú phản hồi / lý do từ chối');
    expect(new Set(['S', 'R', 'E', 'C', 'A'].map((role) => commentPromptFor([role as never]).placeholder)).size).toBe(5);
  });

  it('follows the stage the step is in for whoever handles it', () => {
    expect(stepCommentPrompt('R', ['R', 'A'], false).label).toBe('Ý kiến xem xét');
    expect(stepCommentPrompt('A', ['R', 'A'], false).label).toBe('Ý kiến phê duyệt / lý do trả lại');
    expect(stepCommentPrompt('R', [], true).label).toBe('Ý kiến xem xét');
    expect(stepCommentPrompt('R', ['C'], false).label).toBe('Ý kiến chuyên môn / thẩm định');
  });
});
