import sanitizeHtml from 'sanitize-html';

/**
 * Ghi chú lưu HTML do trình soạn thảo rich text (Tiptap) tạo ra, hiển thị lại cho người khác (người duyệt) nên phải
 * khử trùng phía server trước khi lưu — không tin nội dung HTML client gửi lên. Chỉ nhận đúng tập thẻ StarterKit +
 * Image tạo ra; ảnh dán vào chỉ được tham chiếu bằng marker `voucher-note-image://<id>` (xem `financeNoteImageMarker`
 * ở contracts-finance), không phải URL thật, nên hạn chế scheme của `src` đúng loại đó chặn luôn `javascript:`/`data:`.
 */
const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 's', 'strike', 'u', 'code', 'pre',
  'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'img',
];

export function sanitizeVoucherNote(value: string): string {
  return sanitizeHtml(value, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { img: ['src', 'alt'] },
    allowedSchemes: ['voucher-note-image'],
    allowedSchemesAppliedToAttributes: ['src'],
    disallowedTagsMode: 'discard',
  });
}
