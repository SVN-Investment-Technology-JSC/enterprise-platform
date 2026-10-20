import {
  buildListSearch,
  DEFAULT_LIST_STATE,
  filterUsers,
  paginateGroups,
  parseListParams,
  roleOptionsOf,
} from './users-list-model';
import type { TenantCoreUser } from './user-types';

function user(over: Partial<TenantCoreUser> & { id: string }): TenantCoreUser {
  return {
    username: null,
    fullName: `Người ${over.id}`,
    email: `${over.id}@acme.com`,
    systemRole: 'tenant-user',
    status: 'active',
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

const users = [
  user({ id: 'a', fullName: 'Nguyễn Văn Đạt', roleIds: ['r1'], roles: [{ id: 'r1', name: 'Kế toán' }] }),
  user({ id: 'b', fullName: 'Trần Thị Bình', status: 'disabled', isActive: false, roleIds: ['r2'], roles: [{ id: 'r2', name: 'Kho' }] }),
  user({ id: 'c', fullName: 'Lê Hoàng', roleIds: ['r1', 'r2'], roles: [{ id: 'r1', name: 'Kế toán' }, { id: 'r2', name: 'Kho' }] }),
];

describe('filterUsers', () => {
  it('tìm theo từ khóa có dấu và không dấu, cả đ/Đ', () => {
    const f = (q: string) => filterUsers(users, { ...DEFAULT_LIST_STATE, q }).map((u) => u.id);
    expect(f('dat')).toEqual(['a']);
    expect(f('Đạt')).toEqual(['a']);
    expect(f('BINH')).toEqual(['b']);
    expect(f('c@acme')).toEqual(['c']);
    expect(f('  ')).toEqual(['a', 'b', 'c']);
  });
  it('lọc theo trạng thái và vai trò', () => {
    expect(filterUsers(users, { q: '', status: 'disabled', role: 'all' }).map((u) => u.id)).toEqual(['b']);
    expect(filterUsers(users, { q: '', status: 'all', role: 'r1' }).map((u) => u.id)).toEqual(['a', 'c']);
    expect(filterUsers(users, { q: '', status: 'active', role: 'r2' }).map((u) => u.id)).toEqual(['c']);
  });
});

describe('paginateGroups', () => {
  const many = Array.from({ length: 20 }, (_, i) =>
    user({ id: `u${i}`, status: i % 2 ? 'disabled' : 'active' }),
  );
  it('xếp hoạt động trước và chia nhóm theo trang', () => {
    const p1 = paginateGroups(many, 1, 15);
    expect(p1.pages).toBe(2);
    expect(p1.total).toBe(20);
    expect(p1.groups.map((g) => [g.id, g.rows.length, g.total])).toEqual([
      ['active', 10, 10],
      ['disabled', 5, 10],
    ]);
    const p2 = paginateGroups(many, 2, 15);
    expect(p2.groups.map((g) => [g.id, g.rows.length])).toEqual([['disabled', 5]]);
  });
  it('kẹp trang ngoài giới hạn và xử lý danh sách rỗng', () => {
    expect(paginateGroups(many, 99, 15).page).toBe(2);
    expect(paginateGroups(many, 0, 15).page).toBe(1);
    expect(paginateGroups([], 3)).toMatchObject({ page: 1, pages: 1, total: 0, groups: [] });
  });
});

describe('URL params', () => {
  it('đọc giá trị hợp lệ và đưa giá trị sai về mặc định', () => {
    expect(parseListParams(new URLSearchParams('q=an&status=active&role=r1&page=3'))).toEqual({
      q: 'an',
      status: 'active',
      role: 'r1',
      page: 3,
    });
    expect(parseListParams(new URLSearchParams('status=x&page=-2'))).toEqual(DEFAULT_LIST_STATE);
    expect(parseListParams(new URLSearchParams(''))).toEqual(DEFAULT_LIST_STATE);
  });
  it('ghi bỏ giá trị mặc định và khứ hồi đúng', () => {
    expect(buildListSearch(DEFAULT_LIST_STATE)).toBe('');
    const state = { q: 'Đạt', status: 'disabled' as const, role: 'r2', page: 2 };
    expect(parseListParams(new URLSearchParams(buildListSearch(state)))).toEqual(state);
    expect(buildListSearch({ ...DEFAULT_LIST_STATE, q: '  ' })).toBe('');
  });
});

describe('roleOptionsOf', () => {
  it('gộp vai trò trùng', () => {
    expect(roleOptionsOf(users)).toEqual([
      { value: 'r1', label: 'Kế toán' },
      { value: 'r2', label: 'Kho' },
    ]);
  });
});
