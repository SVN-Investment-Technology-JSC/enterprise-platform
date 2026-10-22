import type { SocialPost, SocialUnitRef, SocialUserRef } from '@enterprise-platform/contracts-social';
import {
  buildAudienceInput,
  buildPostMenu,
  describeVisibility,
  editVersionLabel,
  lockedToCompanyReason,
  sameIds,
  summarizeAudience,
  summarizeMentions,
  toggleById,
  validateVisibility,
  visibilityBadgeLabel,
} from './post-visibility.model';

const user = (id: string): SocialUserRef => ({ id, name: `Người ${id}` });
const unit = (id: string, kind: 'unit' | 'position' = 'unit'): SocialUnitRef => ({ id, name: id, kind });

const caps = (over: Partial<SocialPost['capabilities']> = {}): SocialPost['capabilities'] => ({
  canEdit: false,
  canDelete: false,
  canPin: false,
  canComment: true,
  ...over,
});

type MenuPost = Parameters<typeof buildPostMenu>[0];
const menuPost = (over: Partial<MenuPost> = {}): MenuPost => ({
  status: 'published',
  pinned: false,
  capabilities: caps(),
  ...over,
});

describe('visibilityBadgeLabel', () => {
  it('không hiện cho Công khai và bài nhóm', () => {
    expect(visibilityBadgeLabel({})).toBeUndefined();
    expect(visibilityBadgeLabel({ visibility: 'company' })).toBeUndefined();
    expect(
      visibilityBadgeLabel({ visibility: 'unit', group: { id: 'g', name: 'G', privacy: 'public', color: 'blue' } as never }),
    ).toBeUndefined();
  });
  it('hiện nhãn cho quyền hẹp', () => {
    expect(visibilityBadgeLabel({ visibility: 'unit' })).toBe('Phòng ban');
    expect(visibilityBadgeLabel({ visibility: 'custom' })).toBe('Tùy chỉnh');
    expect(visibilityBadgeLabel({ visibility: 'private' })).toBe('Chỉ mình tôi');
  });
});

describe('audience', () => {
  it('tóm tắt theo loại', () => {
    expect(summarizeAudience([], [])).toBe('');
    expect(summarizeAudience([user('a'), user('b')], [unit('x'), unit('y', 'position')])).toBe(
      '2 người, 1 phòng ban, 1 vị trí',
    );
  });
  it('mô tả quyền xem', () => {
    expect(describeVisibility('custom', [], [])).toMatch(/Chưa chọn/);
    expect(describeVisibility('custom', [user('a')], [])).toBe('Chỉ 1 người được chọn xem được');
    expect(describeVisibility('private', [], [])).toMatch(/mình tôi/);
  });
  it('kiểm hợp lệ', () => {
    expect(validateVisibility('company', [], [])).toBeUndefined();
    expect(validateVisibility('custom', [], [])).toMatch(/ít nhất/);
    expect(validateVisibility('custom', [user('a')], [])).toBeUndefined();
    expect(validateVisibility('custom', Array.from({ length: 201 }, (_, i) => user(String(i))), [])).toMatch(/tối đa/);
    expect(validateVisibility('custom', [], Array.from({ length: 51 }, (_, i) => unit(String(i))))).toMatch(/tối đa/);
  });
  it('dựng yêu cầu và so sánh', () => {
    expect(buildAudienceInput([user('a')], [unit('x')])).toEqual({ userIds: ['a'], unitIds: ['x'] });
    expect(sameIds([user('a'), user('b')], [user('b'), user('a')])).toBe(true);
    expect(sameIds([user('a')], [user('b')])).toBe(false);
    expect(toggleById([user('a')], user('a'))).toEqual([]);
    expect(toggleById([user('a')], user('b')).map((u) => u.id)).toEqual(['a', 'b']);
  });
});

describe('lockedToCompanyReason', () => {
  const base = { kind: 'post', pinned: false, mentionsAll: false } as const;
  it('bài thường thì không khoá', () => {
    expect(lockedToCompanyReason(base)).toBeUndefined();
  });
  it('khoá khi có thuộc tính chỉ đi với Công khai', () => {
    expect(lockedToCompanyReason({ ...base, kind: 'announcement' })).toBeDefined();
    expect(lockedToCompanyReason({ ...base, pinned: true })).toBeDefined();
    expect(lockedToCompanyReason({ ...base, mentionsAll: true })).toBeDefined();
  });
});

describe('buildPostMenu', () => {
  it('chỉ có Xem chi tiết khi không có quyền gì', () => {
    expect(buildPostMenu(menuPost()).map((item) => item.action)).toEqual(['detail']);
  });
  it('đủ mục theo thứ tự', () => {
    const items = buildPostMenu(
      menuPost({
        editCount: 2,
        capabilities: caps({
          canPin: true,
          canViewHistory: true,
          canToggleComments: true,
          canEdit: true,
          canDelete: true,
        }),
      }),
    );
    expect(items.map((item) => item.action)).toEqual([
      'detail',
      'pin',
      'history',
      'toggleComments',
      'edit',
      'delete',
    ]);
    expect(items.at(-1)?.danger).toBe(true);
  });
  it('nhãn ghim và bình luận đổi theo trạng thái', () => {
    const items = buildPostMenu(
      menuPost({
        pinned: true,
        commentsDisabled: true,
        capabilities: caps({ canPin: true, canToggleComments: true }),
      }),
    );
    expect(items.map((item) => item.label)).toEqual([
      'Xem chi tiết',
      'Bỏ ghim bài viết',
      'Bật tính năng bình luận',
    ]);
  });
  it('bỏ lịch sử khi chưa sửa lần nào', () => {
    const items = buildPostMenu(menuPost({ capabilities: caps({ canViewHistory: true }) }));
    expect(items.some((item) => item.action === 'history')).toBe(false);
  });
  it('bài chưa đăng không có xem chi tiết, ghim, bình luận', () => {
    const items = buildPostMenu(
      menuPost({
        status: 'pending',
        capabilities: caps({ canPin: true, canToggleComments: true, canEdit: true, canDelete: true }),
      }),
    );
    expect(items.map((item) => item.action)).toEqual(['edit', 'delete']);
  });
  it('bài tự sinh không sửa được', () => {
    const items = buildPostMenu(
      menuPost({ activity: { type: 'avatar.updated' } as never, capabilities: caps({ canEdit: true }) }),
    );
    expect(items.some((item) => item.action === 'edit')).toBe(false);
  });
});

describe('editVersionLabel', () => {
  it('bản 1 là bản gốc', () => {
    expect(editVersionLabel(1)).toBe('Bản gốc');
    expect(editVersionLabel(3)).toBe('Bản 3');
  });
});

describe('summarizeMentions', () => {
  const u1 = { id: 'u1', name: 'Nguyễn Văn An' };
  const u2 = { id: 'u2', name: 'Trần Thị Bình' };
  const u3 = { id: 'u3', name: 'Lê Văn Cường' };

  it('trả undefined khi không có nhắc ai', () => {
    expect(summarizeMentions([])).toBeUndefined();
    expect(summarizeMentions(undefined, false)).toBeUndefined();
  });

  it('xử lý @Tất cả', () => {
    expect(summarizeMentions([], true)).toEqual({ summary: '@Tất cả', remaining: 0 });
  });

  it('tóm tắt 1 người', () => {
    expect(summarizeMentions([u1])).toEqual({ summary: 'Nguyễn Văn An', remaining: 0 });
  });

  it('tóm tắt 2 người', () => {
    expect(summarizeMentions([u1, u2])).toEqual({
      summary: 'Nguyễn Văn An và Trần Thị Bình',
      remaining: 0,
    });
  });

  it('tóm tắt > 2 người kèm số người còn lại', () => {
    expect(summarizeMentions([u1, u2, u3])).toEqual({
      summary: 'Nguyễn Văn An và 2 người khác',
      remaining: 2,
    });
  });
});
