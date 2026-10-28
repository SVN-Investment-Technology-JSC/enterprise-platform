import { ownerScopeSql } from './owner-scope-sql.js';

describe('ownerScopeSql', () => {
  it('toàn bộ thì TRUE và không thêm tham số', () => {
    expect(ownerScopeSql({ kind: 'all' }, 'c.owner_user_id', 3)).toEqual({ sql: 'TRUE', params: [] });
  });

  it('theo người thì lọc ANY với một tham số mảng uuid', () => {
    expect(ownerScopeSql({ kind: 'users', userIds: ['a', 'b'] }, 'c.owner_user_id', 3)).toEqual({
      sql: 'c.owner_user_id = ANY($3::uuid[])',
      params: [['a', 'b']],
    });
  });

  it('từ chối tên cột lạ để không ghép chuỗi vào SQL', () => {
    expect(() => ownerScopeSql({ kind: 'all' }, 'owner_user_id; DROP TABLE x', 1)).toThrow();
    expect(() => ownerScopeSql({ kind: 'all' }, 'owner_user_id', 0)).toThrow();
  });
});
