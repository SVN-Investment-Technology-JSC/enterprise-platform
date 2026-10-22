import type { SocialGroupDetail, SocialGroupSummary } from '@enterprise-platform/contracts-social';
import {
  addSource,
  appendUnique,
  buildCreateGroupRequest,
  buildUpdateGroupRequest,
  coverGradient,
  discoverable,
  emptyGroupForm,
  groupCover,
  groupFormFrom,
  isHtmlEmpty,
  joinState,
  memberSourcesChange,
  parseGroupSection,
  plainToHtml,
  reportReasonError,
  sectionSegment,
  validateGroupForm,
  type GroupFormState,
} from './groups.model';

const base: SocialGroupSummary = {
  id: 'g1',
  name: 'A',
  privacy: 'public',
  color: 'blue',
  icon: 'users',
  memberCount: 3,
  createdAt: '2026-01-01T00:00:00Z',
};

const user = (id: string) => ({ id, name: `U${id}` });
const form = (patch: Partial<GroupFormState>): GroupFormState => ({ ...emptyGroupForm(), name: 'Nhóm', ...patch });

describe('groups.model', () => {
  it('joinState theo thành viên, yêu cầu đang chờ và quyền riêng tư', () => {
    expect(joinState({ ...base, myMembership: { role: 'member', joinedAt: 'x' } })).toBe('member');
    expect(joinState({ ...base, privacy: 'private', myJoinRequestId: 'r' })).toBe('pending');
    expect(joinState(base)).toBe('join');
    expect(joinState({ ...base, privacy: 'private' })).toBe('request');
  });

  it('parseGroupSection nhận mục con, lạ thì về bảng tin', () => {
    expect(parseGroupSection('requests')).toBe('requests');
    expect(parseGroupSection('topics')).toBe('topics');
    expect(parseGroupSection(undefined)).toBe('feed');
    expect(parseGroupSection('abc')).toBe('feed');
    expect(sectionSegment('feed')).toBeUndefined();
    expect(sectionSegment('members')).toBe('members');
  });

  it('appendUnique bỏ trùng theo id và giữ bản đầu', () => {
    const merged = appendUnique([{ id: 'a', v: 1 }], [{ id: 'a', v: 2 }, { id: 'b', v: 3 }]);
    expect(merged).toEqual([{ id: 'a', v: 1 }, { id: 'b', v: 3 }]);
  });

  it('discoverable chỉ giữ nhóm chưa tham gia', () => {
    const mine = { ...base, id: 'm', myMembership: { role: 'member' as const, joinedAt: 'x' } };
    expect(discoverable([base, mine]).map((group) => group.id)).toEqual(['g1']);
  });

  it('groupCover ưu tiên ảnh bìa mặc định, thiếu thì theo màu', () => {
    expect(groupCover({ color: 'blue' })).toBe(coverGradient('blue'));
    expect(groupCover({ color: 'blue', coverPreset: 'ocean' })).toContain('#1d4ed8');
    expect(groupCover({ color: 'red', coverPreset: 'forest' })).not.toBe(coverGradient('red'));
  });
});

describe('biểu mẫu nhóm', () => {
  it('plainToHtml thoát ký tự và tách đoạn; isHtmlEmpty bỏ qua thẻ rỗng', () => {
    expect(plainToHtml('a<b\nc')).toBe('<p>a&lt;b</p><p>c</p>');
    expect(plainToHtml('  ')).toBe('');
    expect(isHtmlEmpty('<p><br></p>')).toBe(true);
    expect(isHtmlEmpty('<p>&nbsp;</p>')).toBe(true);
    expect(isHtmlEmpty('<p>x</p>')).toBe(false);
    expect(isHtmlEmpty('<p><img src="a"></p>')).toBe(false);
  });

  it('validateGroupForm kiểm tên, nguồn phòng ban và người được đăng', () => {
    expect(validateGroupForm(form({ name: '  ' }), false)).toMatch(/tên nhóm/);
    expect(validateGroupForm(form({}), false)).toBeUndefined();
    expect(validateGroupForm(form({ mode: 'org' }), false)).toMatch(/phòng ban/);
    expect(validateGroupForm(form({ postPermission: 'selected' }), false)).toMatch(/được phép đăng/);
    expect(
      validateGroupForm(form({ postPermission: 'selected', permitted: [user('1')] }), false),
    ).toBeUndefined();
    const manyAdmins = Array.from({ length: 20 }, (_, index) => user(String(index)));
    expect(validateGroupForm(form({ admins: manyAdmins }), false)).toMatch(/quản lý/);
    expect(validateGroupForm(form({ admins: manyAdmins }), true)).toBeUndefined();
  });

  it('buildCreateGroupRequest: công khai, quản lý, thành viên và quyền đăng', () => {
    const request = buildCreateGroupRequest(
      form({
        isPublic: true,
        admins: [user('a')],
        members: [user('m1'), user('m2')],
        descriptionHtml: '<p>Mô tả</p>',
        postPermission: 'selected',
        permitted: [user('p')],
      }),
    );
    expect(request).toMatchObject({
      name: 'Nhóm',
      privacy: 'public',
      descriptionHtml: '<p>Mô tả</p>',
      adminUserIds: ['a'],
      membership: { mode: 'manual', userIds: ['m1', 'm2'] },
      postPermission: 'selected',
      postPermittedUserIds: ['p'],
    });
  });

  it('buildCreateGroupRequest theo phòng ban/vị trí và bỏ mô tả rỗng', () => {
    const request = buildCreateGroupRequest(
      form({
        mode: 'org',
        sources: [{ id: 'u1', type: 'unit', name: 'KD', includeDescendants: false }],
        descriptionHtml: '<p><br></p>',
      }),
    );
    expect(request.membership).toEqual({
      mode: 'org',
      sources: [{ type: 'unit', id: 'u1', includeDescendants: false }],
    });
    expect(request.descriptionHtml).toBeUndefined();
    expect(request.privacy).toBe('private');
    expect(request.postPermittedUserIds).toBeUndefined();
  });

  it('buildUpdateGroupRequest gửi null khi xoá mô tả', () => {
    expect(buildUpdateGroupRequest(form({ descriptionHtml: '' })).descriptionHtml).toBeNull();
  });

  it('groupFormFrom nạp từ chi tiết nhóm, thiếu descriptionHtml thì dựng từ mô tả chữ thuần', () => {
    const detail = {
      ...base,
      description: 'Dòng 1',
      access: 'full',
      memberPreview: [],
      adminCount: 1,
      capabilities: {},
      membershipMode: 'org',
      memberSources: [{ id: 's', type: 'unit', sourceId: 'u9', name: 'Kho', includeDescendants: true }],
    } as unknown as SocialGroupDetail;
    const state = groupFormFrom(detail);
    expect(state.descriptionHtml).toBe('<p>Dòng 1</p>');
    expect(state.isPublic).toBe(true);
    expect(state.sources).toEqual([{ id: 'u9', type: 'unit', name: 'Kho', includeDescendants: true }]);
  });

  it('memberSourcesChange: không đổi thì undefined, đổi hoặc về thủ công thì có mảng', () => {
    const current = [{ id: 's', type: 'unit' as const, sourceId: 'u1', name: 'KD', includeDescendants: true }];
    const same = form({ mode: 'org', sources: [{ id: 'u1', type: 'unit', name: 'KD', includeDescendants: true }] });
    expect(memberSourcesChange(same, current, 'org')).toBeUndefined();
    expect(memberSourcesChange({ ...same, sources: [{ ...same.sources[0], includeDescendants: false }] }, current, 'org'))
      .toEqual([{ type: 'unit', id: 'u1', includeDescendants: false }]);
    expect(memberSourcesChange(form({ mode: 'manual' }), current, 'org')).toEqual([]);
    expect(memberSourcesChange(form({ mode: 'manual' }), undefined, 'manual')).toBeUndefined();
    expect(memberSourcesChange(same, undefined, 'manual')).toHaveLength(1);
  });

  it('addSource bỏ trùng cùng loại và id', () => {
    const once = addSource([], { id: 'u1', type: 'unit', name: 'KD' });
    expect(addSource(once, { id: 'u1', type: 'unit', name: 'KD' })).toHaveLength(1);
    expect(addSource(once, { id: 'u1', type: 'position', name: 'TP' })).toHaveLength(2);
  });

  it('reportReasonError kiểm độ dài', () => {
    expect(reportReasonError('abc')).toMatch(/ít nhất/);
    expect(reportReasonError('Nội dung không phù hợp')).toBeUndefined();
    expect(reportReasonError('x'.repeat(600))).toMatch(/tối đa/);
  });
});
