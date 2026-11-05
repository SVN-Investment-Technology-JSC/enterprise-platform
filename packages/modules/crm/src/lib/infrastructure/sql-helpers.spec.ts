import { SqlConditions, nameSearchCondition, prefixPattern, prefixTsQuery } from './sql-helpers.js';

describe('SQL tìm kiếm', () => {
  it('mẫu LIKE thoát ký tự đại diện người dùng gõ', () => {
    expect(prefixPattern('KH%_\\')).toBe('KH\\%\\_\\\\%');
  });

  it('truy vấn full-text chỉ giữ chữ và số, khớp đầu từ', () => {
    expect(prefixTsQuery('Minh  Anh')).toBe('minh:* & anh:*');
    expect(prefixTsQuery("' OR 1=1 --")).toBe('or:* & 1:* & 1:*');
    expect(prefixTsQuery('Đông Á & | ! :*')).toBe('đông:* & á:*');
    expect(prefixTsQuery('%%%')).toBeUndefined();
  });

  it('tìm theo tên: có chữ thì full-text, chỉ ký tự đặc biệt thì LIKE đã thoát (BUG-CRM-001)', () => {
    const words = new SqlConditions();
    expect(nameSearchCondition(words, 'o.name', 'máy phát')).toBe(
      "to_tsvector('simple'::regconfig, o.name) @@ to_tsquery('simple'::regconfig, $1)",
    );
    expect(words.params).toEqual(['máy:* & phát:*']);

    for (const [q, pattern] of [
      ['%', '\\%%'],
      ['_', '\\_%'],
    ]) {
      const where = new SqlConditions();
      expect(nameSearchCondition(where, 'o.name', q)).toBe('o.name ILIKE $1');
      expect(where.params).toEqual([pattern]);
    }
  });

  it('điều kiện phạm vi dùng một tham số cho nhiều cột, đánh số nối tiếp', () => {
    const where = new SqlConditions();
    where.add(`x = ${where.param('a')}`);
    where.scope({ kind: 'users', userIds: ['u1'] }, 'c.owner_user_id', 'o.owner_user_id');
    expect(where.where()).toBe('WHERE x = $1 AND (c.owner_user_id = ANY($2::uuid[]) OR o.owner_user_id = ANY($2::uuid[]))');
    expect(where.params).toEqual(['a', ['u1']]);
  });

  it('phạm vi toàn bộ không thêm điều kiện', () => {
    const where = new SqlConditions();
    where.scope({ kind: 'all' }, 'c.owner_user_id');
    expect(where.where()).toBe('');
  });
});
