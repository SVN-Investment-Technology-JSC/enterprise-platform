import { groupCapabilities, isGlobalGroupAdmin, isPreviewOnly, mayPostToGroup, normalizeAdminUserIds, normalizeGroupDescription, normalizeGroupDescriptionHtml, normalizeGroupLimit, normalizeGroupName, normalizeGroupTopicName, normalizeMemberSources, normalizeReportReason, normalizeUserIds, truncatePlainText } from './social-group-rules.js';
import { SocialValidationError } from './social.error.js';

const ID_A = '11111111-1111-4111-8111-111111111111';

describe('social-group-rules', () => {
  it('tên nhóm: gọn khoảng trắng, không rỗng, tối đa 80 ký tự', () => {
    expect(normalizeGroupName('  Nhóm   A ')).toBe('Nhóm A');
    expect(() => normalizeGroupName('  ')).toThrow(SocialValidationError);
    expect(() => normalizeGroupName(42)).toThrow(SocialValidationError);
    expect(() => normalizeGroupName('x'.repeat(81))).toThrow(SocialValidationError);
    expect(normalizeGroupName('x'.repeat(80))).toHaveLength(80);
  });

  it('mô tả rỗng nghĩa là không có mô tả', () => {
    expect(normalizeGroupDescription('  ')).toBeUndefined();
    expect(normalizeGroupDescription(null)).toBeUndefined();
    expect(normalizeGroupDescription(' Mô tả ')).toBe('Mô tả');
    expect(() => normalizeGroupDescription('x'.repeat(501))).toThrow(SocialValidationError);
  });

  it('danh sách người dùng: viết thường, không trùng, đúng UUID', () => {
    expect(normalizeUserIds([ID_A.toUpperCase(), ID_A])).toEqual([ID_A]);
    expect(() => normalizeUserIds(['abc'])).toThrow(SocialValidationError);
    expect(() => normalizeUserIds('abc')).toThrow(SocialValidationError);
  });

  it('cỡ trang: mặc định 20, trần 50', () => {
    expect(normalizeGroupLimit(undefined)).toBe(20);
    expect(normalizeGroupLimit('7')).toBe(7);
    expect(normalizeGroupLimit(500)).toBe(50);
    expect(() => normalizeGroupLimit(0)).toThrow(SocialValidationError);
  });

  it('quản trị toàn hệ thống là quản trị tenant hoặc social.manage, không phải moderator', () => {
    const base = { userId: ID_A, isTenantAdmin: false, canRead: false, canWrite: false, canModerate: false, canManage: false };
    expect(isGlobalGroupAdmin(base)).toBe(false);
    expect(isGlobalGroupAdmin({ ...base, canModerate: true })).toBe(false);
    expect(isGlobalGroupAdmin({ ...base, canManage: true })).toBe(true);
    expect(isGlobalGroupAdmin({ ...base, isTenantAdmin: true })).toBe(true);
  });

  it('quyền thao tác trên nhóm theo vai trò', () => {
    const input = { privacy: 'public', globalAdmin: false, adminCount: 1, hasPendingRequest: false } as const;
    expect(groupCapabilities(input)).toEqual({
      canPost: false,
      canManage: false,
      canDelete: false,
      canJoin: true,
      canRequestJoin: false,
      canLeave: false,
      canSyncMembers: false,
      canReport: true,
      canPrioritize: false,
    });
    expect(groupCapabilities({ ...input, myRole: 'admin' })).toMatchObject({ canManage: true, canLeave: false, canPost: true });
    expect(groupCapabilities({ ...input, myRole: 'admin', adminCount: 2 }).canLeave).toBe(true);
    expect(groupCapabilities({ ...input, myRole: 'member' })).toMatchObject({ canManage: false, canLeave: true });
    expect(groupCapabilities({ ...input, privacy: 'private' })).toMatchObject({ canRequestJoin: true, canJoin: false });
    expect(groupCapabilities({ ...input, privacy: 'private', hasPendingRequest: true }).canRequestJoin).toBe(false);
    expect(groupCapabilities({ ...input, globalAdmin: true })).toMatchObject({ canManage: true, canDelete: true, canPost: false });
  });

  it('chỉ nhóm riêng tư với người ngoài thường mới là bản xem trước', () => {
    expect(isPreviewOnly({ privacy: 'private', isMember: false, globalAdmin: false })).toBe(true);
    expect(isPreviewOnly({ privacy: 'private', isMember: true, globalAdmin: false })).toBe(false);
    expect(isPreviewOnly({ privacy: 'private', isMember: false, globalAdmin: true })).toBe(false);
    expect(isPreviewOnly({ privacy: 'public', isMember: false, globalAdmin: false })).toBe(false);
  });
});

describe('social-group-rules đợt 2', () => {
  it('quyền đăng bài: admin luôn được, selected cần nằm trong danh sách, người ngoài nhóm không bao giờ', () => {
    expect(mayPostToGroup({ myRole: 'member' })).toBe(true);
    expect(mayPostToGroup({ myRole: 'member', postPermission: 'admins' })).toBe(false);
    expect(mayPostToGroup({ myRole: 'admin', postPermission: 'admins' })).toBe(true);
    expect(mayPostToGroup({ myRole: 'member', postPermission: 'selected', permitted: false })).toBe(false);
    expect(mayPostToGroup({ myRole: 'member', postPermission: 'selected', permitted: true })).toBe(true);
    expect(mayPostToGroup({ postPermission: 'all' })).toBe(false);
  });

  it('khả năng của nhóm đợt 2: đồng bộ, báo cáo, ưu tiên', () => {
    const input = { privacy: 'public', globalAdmin: false, adminCount: 1, hasPendingRequest: false } as const;
    expect(groupCapabilities({ ...input, myRole: 'admin', hasMemberSources: true })).toMatchObject({
      canSyncMembers: true,
      canReport: false,
      canPrioritize: true,
    });
    expect(groupCapabilities({ ...input, myRole: 'admin' }).canSyncMembers).toBe(false);
    expect(groupCapabilities({ ...input, myRole: 'member', hasMemberSources: true })).toMatchObject({
      canSyncMembers: false,
      canReport: true,
      canPrioritize: true,
    });
    expect(groupCapabilities({ ...input }).canPrioritize).toBe(false);
  });

  it('mô tả HTML: làm sạch, bỏ khi không còn chữ, cắt bản chữ thuần', () => {
    expect(normalizeGroupDescriptionHtml('<p>Xin <b>chào</b></p><script>x()</script>')?.text).toBe('Xin chào');
    expect(normalizeGroupDescriptionHtml('<p> </p>')).toBeUndefined();
    expect(normalizeGroupDescriptionHtml(undefined)).toBeUndefined();
    expect(() => normalizeGroupDescriptionHtml(5)).toThrow(SocialValidationError);
    expect(() => normalizeGroupDescriptionHtml(`<p>${'a'.repeat(5_001)}</p>`)).toThrow(SocialValidationError);
    expect(truncatePlainText('abcdef', 4)).toBe('abc…');
    expect(truncatePlainText('abc', 4)).toBe('abc');
  });

  it('quản lý: bỏ người tạo, không trùng, tổng tối đa 20', () => {
    expect(normalizeAdminUserIds([ID_A, ID_A.toUpperCase()], ID_A)).toEqual([]);
    const others = Array.from({ length: 20 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
    expect(() => normalizeAdminUserIds(others, ID_A)).toThrow(SocialValidationError);
    expect(normalizeAdminUserIds(others.slice(0, 19), ID_A)).toHaveLength(19);
  });

  it('nguồn thành viên: mặc định gồm nút con, bỏ trùng, kiểm loại và id', () => {
    expect(normalizeMemberSources([{ type: 'unit', id: ID_A.toUpperCase() }, { type: 'unit', id: ID_A, includeDescendants: false }])).toEqual([
      { type: 'unit', id: ID_A, includeDescendants: false },
    ]);
    expect(normalizeMemberSources([{ type: 'position', id: ID_A }])[0]?.includeDescendants).toBe(true);
    expect(() => normalizeMemberSources([{ type: 'team' as 'unit', id: ID_A }])).toThrow(SocialValidationError);
    expect(() => normalizeMemberSources([{ type: 'unit', id: 'abc' }])).toThrow(SocialValidationError);
    expect(() => normalizeMemberSources('abc')).toThrow(SocialValidationError);
  });

  it('chủ đề và lý do báo cáo: gọn khoảng trắng và kiểm độ dài', () => {
    expect(normalizeGroupTopicName('  Thông  báo ')).toBe('Thông báo');
    expect(() => normalizeGroupTopicName('')).toThrow(SocialValidationError);
    expect(() => normalizeGroupTopicName('x'.repeat(61))).toThrow(SocialValidationError);
    expect(normalizeReportReason('  Spam   rồi ')).toBe('Spam rồi');
    expect(() => normalizeReportReason('ngắn')).toThrow(SocialValidationError);
    expect(() => normalizeReportReason('x'.repeat(501))).toThrow(SocialValidationError);
  });
});
