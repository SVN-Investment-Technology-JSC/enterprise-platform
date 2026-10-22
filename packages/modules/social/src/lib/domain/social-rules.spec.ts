import { SOCIAL_COMMENT_MAX, SOCIAL_POST_TITLE_MAX } from '@enterprise-platform/contracts-social';
import {
  mayCommentOnPost,
  mayEditContent,
  mayManage,
  mayModerate,
  mayPinPost,
  mayRead,
  mayWrite,
  type SocialPrincipal,
} from './social-principal.js';
import {
  assertReplyTarget,
  decodeCursor,
  encodeCursor,
  mentionIdsInBody,
  mergeMentions,
  normalizeAttachmentInput,
  normalizeBody,
  normalizeCommentBody,
  normalizeLimit,
  normalizeTitle,
  normalizeTopicName,
  requireContent,
  safeObjectName,
} from './social-rules.js';
import { SocialValidationError } from './social.error.js';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

function principal(overrides: Partial<SocialPrincipal> = {}): SocialPrincipal {
  return {
    userId: UUID_A,
    isTenantAdmin: false,
    canRead: false,
    canWrite: false,
    canModerate: false,
    canManage: false,
    ...overrides,
  };
}

describe('quyền', () => {
  it('chỉ đọc thì không viết, không kiểm duyệt', () => {
    const reader = principal({ canRead: true });
    expect(mayRead(reader)).toBe(true);
    expect(mayWrite(reader)).toBe(false);
    expect(mayCommentOnPost(reader)).toBe(false);
    expect(mayModerate(reader)).toBe(false);
    expect(mayManage(reader)).toBe(false);
  });

  it('tác giả sửa được nội dung của mình nếu có quyền viết, không sửa của người khác', () => {
    const writer = principal({ canRead: true, canWrite: true });
    expect(mayEditContent(writer, UUID_A)).toBe(true);
    expect(mayEditContent(writer, UUID_B)).toBe(false);
    expect(mayPinPost(writer)).toBe(false);
  });

  it('mất quyền viết thì không sửa được cả bài của mình', () => {
    expect(mayEditContent(principal({ canRead: true }), UUID_A)).toBe(false);
  });

  it('người kiểm duyệt sửa, xoá, ghim nội dung người khác', () => {
    const moderator = principal({ canRead: true, canModerate: true });
    expect(mayEditContent(moderator, UUID_B)).toBe(true);
    expect(mayPinPost(moderator)).toBe(true);
  });

  it('quản trị tenant có mọi quyền', () => {
    const admin = principal({ isTenantAdmin: true });
    expect(mayRead(admin) && mayWrite(admin) && mayModerate(admin) && mayManage(admin)).toBe(true);
  });
});

describe('nội dung bài viết', () => {
  it('làm sạch và báo có chữ', () => {
    const body = normalizeBody('<p>Xin chào</p><script>x()</script>');
    expect(body).toEqual({ html: '<p>Xin chào</p>', hasText: true });
  });

  it('bài rỗng chỉ được nếu có tệp đính kèm', () => {
    const empty = normalizeBody('<p><br></p>');
    expect(() => requireContent(empty, 0)).toThrow(SocialValidationError);
    expect(() => requireContent(empty, 1)).not.toThrow();
  });

  it('từ chối nội dung quá dài', () => {
    expect(() => normalizeBody(`<p>${'a'.repeat(50_001)}</p>`)).toThrow(SocialValidationError);
  });

  it('tiêu đề: cắt khoảng trắng, rỗng là không có, quá dài thì lỗi', () => {
    expect(normalizeTitle('  Tin  ')).toBe('Tin');
    expect(normalizeTitle('   ')).toBeUndefined();
    expect(normalizeTitle(null)).toBeUndefined();
    expect(() => normalizeTitle('a'.repeat(SOCIAL_POST_TITLE_MAX + 1))).toThrow(SocialValidationError);
  });
});

describe('bình luận hai cấp', () => {
  it('trả lời được gắn vào bình luận gốc', () => {
    expect(() => assertReplyTarget({ parentId: undefined })).not.toThrow();
    expect(() => assertReplyTarget({ parentId: null })).not.toThrow();
  });

  it('không trả lời được một trả lời', () => {
    expect(() => assertReplyTarget({ parentId: UUID_A })).toThrow(SocialValidationError);
  });

  it('nội dung bình luận: rỗng và quá dài đều lỗi', () => {
    expect(normalizeCommentBody('  chào  ')).toBe('chào');
    expect(() => normalizeCommentBody('   ')).toThrow(SocialValidationError);
    expect(() => normalizeCommentBody('a'.repeat(SOCIAL_COMMENT_MAX + 1))).toThrow(SocialValidationError);
  });

  it('đọc token @[userId] và gộp với danh sách khai báo, không trùng', () => {
    expect(mentionIdsInBody(`Chào @[${UUID_A}] và @[${UUID_A}] @[khong-phai-uuid]`)).toEqual([UUID_A]);
    expect(mergeMentions([UUID_B], [UUID_A, UUID_B])).toEqual([UUID_B, UUID_A]);
  });
});

describe('tệp đính kèm', () => {
  it('nhận kiểu trong danh sách trắng', () => {
    expect(normalizeAttachmentInput({ fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 10 })).toEqual({
      fileName: 'a.pdf',
      contentType: 'application/pdf',
      sizeBytes: 10,
    });
  });

  it('từ chối kiểu lạ, quá cỡ, cỡ 0, tên có gạch chéo', () => {
    const base = { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 10 };
    expect(() => normalizeAttachmentInput({ ...base, contentType: 'text/html' })).toThrow(SocialValidationError);
    expect(() => normalizeAttachmentInput({ ...base, contentType: 'application/x-msdownload' })).toThrow(
      SocialValidationError,
    );
    expect(() => normalizeAttachmentInput({ ...base, sizeBytes: 51 * 1024 * 1024 })).toThrow(SocialValidationError);
    expect(() => normalizeAttachmentInput({ ...base, sizeBytes: 0 })).toThrow(SocialValidationError);
    expect(() => normalizeAttachmentInput({ ...base, fileName: '../a.pdf' })).toThrow(SocialValidationError);
  });

  it('tên object bỏ dấu tiếng Việt', () => {
    expect(safeObjectName('Báo cáo Đầu tư.pdf')).toBe('Bao-cao-Dau-tu.pdf');
  });
});

describe('chuyên mục, con trỏ, cỡ trang', () => {
  it('tên chuyên mục gộp khoảng trắng', () => {
    expect(normalizeTopicName('  Tin   nội bộ ')).toBe('Tin nội bộ');
    expect(() => normalizeTopicName('')).toThrow(SocialValidationError);
  });

  it('con trỏ mã hoá rồi giải mã giữ nguyên micro giây', () => {
    const position = { at: '2026-03-04T05:06:07.123456Z', id: UUID_A };
    expect(decodeCursor(encodeCursor(position))).toEqual(position);
    expect(decodeCursor(undefined)).toBeUndefined();
  });

  it('con trỏ hỏng thì lỗi xác thực', () => {
    expect(() => decodeCursor('khong-phai-con-tro')).toThrow(SocialValidationError);
    const forged = Buffer.from(JSON.stringify(["2026'; DROP TABLE x;--", UUID_A])).toString('base64url');
    expect(() => decodeCursor(forged)).toThrow(SocialValidationError);
  });

  it('cỡ trang có mặc định và trần', () => {
    expect(normalizeLimit(undefined)).toBe(20);
    expect(normalizeLimit('500')).toBe(50);
    expect(() => normalizeLimit('0')).toThrow(SocialValidationError);
    expect(() => normalizeLimit('abc')).toThrow(SocialValidationError);
  });
});
