import { canViewPostInScope, type PostVisibilityScope } from './post-visibility.port.js';

const scope = (patch: Partial<PostVisibilityScope> = {}): PostVisibilityScope => ({
  viewerId: 'viewer',
  seesAllGroups: false,
  canModerate: false,
  memberGroupIds: [],
  ...patch,
});

describe('canViewPostInScope', () => {
  it('bài đã xoá không ai thấy', () => {
    expect(canViewPostInScope(scope({ seesAllGroups: true, canModerate: true }), { authorId: 'viewer', status: 'deleted' })).toBe(false);
  });

  it('bài Tường công ty đã đăng ai cũng thấy', () => {
    expect(canViewPostInScope(scope(), { authorId: 'a', status: 'published' })).toBe(true);
  });

  it('bài nhóm công khai ai cũng thấy, nhóm đã xoá thì không', () => {
    const post = { authorId: 'a', status: 'published', groupId: 'g1', groupPrivacy: 'public' } as const;
    expect(canViewPostInScope(scope(), post)).toBe(true);
    expect(canViewPostInScope(scope(), { ...post, groupDeleted: true })).toBe(false);
  });

  it('bài nhóm riêng tư chỉ thành viên và quản trị toàn hệ thống thấy', () => {
    const post = { authorId: 'a', status: 'published', groupId: 'g1', groupPrivacy: 'private' } as const;
    expect(canViewPostInScope(scope(), post)).toBe(false);
    expect(canViewPostInScope(scope({ canModerate: true }), post)).toBe(false);
    expect(canViewPostInScope(scope({ memberGroupIds: ['g1'] }), post)).toBe(true);
    expect(canViewPostInScope(scope({ seesAllGroups: true }), post)).toBe(true);
  });

  it('bài pending/scheduled/rejected chỉ tác giả và moderator thấy', () => {
    for (const status of ['pending', 'scheduled', 'rejected'] as const) {
      const post = { authorId: 'a', status };
      expect(canViewPostInScope(scope(), post)).toBe(false);
      expect(canViewPostInScope(scope({ viewerId: 'a' }), post)).toBe(true);
      expect(canViewPostInScope(scope({ canModerate: true }), post)).toBe(true);
    }
  });

  it('tác giả đã rời nhóm riêng tư thì không còn thấy bài chưa đăng của mình trong nhóm đó', () => {
    const post = { authorId: 'viewer', status: 'scheduled', groupId: 'g1', groupPrivacy: 'private' } as const;
    expect(canViewPostInScope(scope(), post)).toBe(false);
  });
});

describe('canViewPostInScope: quyền xem bài đợt 2', () => {
  const wall = { authorId: 'a', status: 'published' } as const;

  it('mặc định và company: ai cũng thấy', () => {
    expect(canViewPostInScope(scope(), { ...wall, visibility: 'company' })).toBe(true);
  });

  it('unit: chỉ người có phòng ban của tác giả trong unitIds (gồm phòng cha của người xem)', () => {
    const post = { ...wall, visibility: 'unit', authorUnitId: 'u-sales' } as const;
    expect(canViewPostInScope(scope(), post)).toBe(false);
    expect(canViewPostInScope(scope({ unitIds: ['u-hr'] }), post)).toBe(false);
    expect(canViewPostInScope(scope({ unitIds: ['u-sales', 'u-root'] }), post)).toBe(true);
    // Bài unit mà thiếu phòng ban tác giả thì không ai ngoài tác giả thấy (DB chặn tình huống này).
    expect(canViewPostInScope(scope({ unitIds: ['u-sales'] }), { ...wall, visibility: 'unit' })).toBe(false);
  });

  it('custom: người được chọn hoặc người thuộc phòng ban được chọn', () => {
    const post = { ...wall, visibility: 'custom', audienceUserIds: ['x'], audienceUnitIds: ['u-it'] } as const;
    expect(canViewPostInScope(scope(), post)).toBe(false);
    expect(canViewPostInScope(scope({ viewerId: 'x' }), post)).toBe(true);
    expect(canViewPostInScope(scope({ unitIds: ['u-it'] }), post)).toBe(true);
    expect(canViewPostInScope(scope({ unitIds: ['u-other'] }), post)).toBe(false);
  });

  it('private: chỉ tác giả; moderator và quản trị không được ưu tiên', () => {
    const post = { ...wall, visibility: 'private' } as const;
    expect(canViewPostInScope(scope({ canModerate: true, seesAllGroups: true }), post)).toBe(false);
    expect(canViewPostInScope(scope({ viewerId: 'a' }), post)).toBe(true);
  });

  it('tác giả luôn thấy bài của mình ở mọi quyền xem', () => {
    for (const visibility of ['company', 'unit', 'custom', 'private'] as const) {
      expect(canViewPostInScope(scope({ viewerId: 'a' }), { ...wall, visibility })).toBe(true);
    }
  });

  it('bài chưa đăng có quyền xem giới hạn: moderator không thấy, bài công khai thì thấy', () => {
    const moderator = scope({ canModerate: true });
    expect(canViewPostInScope(moderator, { authorId: 'a', status: 'scheduled', visibility: 'private' })).toBe(false);
    expect(canViewPostInScope(moderator, { authorId: 'a', status: 'scheduled', visibility: 'custom' })).toBe(false);
    expect(canViewPostInScope(moderator, { authorId: 'a', status: 'pending', visibility: 'company' })).toBe(true);
  });

  it('bài nhóm bỏ qua quyền xem riêng', () => {
    const post = { authorId: 'a', status: 'published', groupId: 'g1', groupPrivacy: 'public', visibility: 'private' } as const;
    expect(canViewPostInScope(scope(), post)).toBe(true);
  });
});
