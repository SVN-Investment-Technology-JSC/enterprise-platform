import type { SocialGroupPrivacy, SocialPostStatus, SocialPostVisibility } from '@enterprise-platform/contracts-social';
import {
  canViewPostInScope,
  type PostVisibilityScope,
  type PostVisibilitySubject,
} from '../application/ports/post-visibility.port.js';
import { postVisibilitySql } from './post-visibility-sql.js';

describe('postVisibilitySql: tham số', () => {
  it('đánh số tham số từ firstParam và trả đúng ba tham số', () => {
    const result = postVisibilitySql(
      { viewerId: 'u1', seesAllGroups: false, canModerate: true, memberGroupIds: ['g1', 'g2'], unitIds: ['d1'] },
      { firstParam: 4 },
    );
    expect(result.sql).toContain('$4::uuid[]');
    expect(result.sql).toContain('$5::uuid');
    expect(result.sql).toContain('$6::uuid[]');
    expect(result.sql).toContain("p.status <> 'deleted'");
    expect(result.params).toEqual([['g1', 'g2'], 'u1', ['d1']]);
  });

  it('thiếu unitIds thì truyền mảng rỗng (không mở rộng quyền)', () => {
    const result = postVisibilitySql(
      { viewerId: 'u', seesAllGroups: false, canModerate: false, memberGroupIds: [] },
      { firstParam: 1 },
    );
    expect(result.params).toEqual([[], 'u', []]);
  });

  it('nhúng cờ quyền thành hằng boolean và dùng bí danh tuỳ chọn', () => {
    const all = postVisibilitySql(
      { viewerId: 'u', seesAllGroups: true, canModerate: false, memberGroupIds: [] },
      { firstParam: 1, postAlias: 'x', groupAlias: 'y' },
    );
    expect(all.sql).toContain("y.privacy = 'public' OR TRUE");
    expect(all.sql).toContain("x.visibility = 'company' AND FALSE");
    expect(all.sql).toContain('x.author_id = $2::uuid');
  });

  it('chỉ nhận mảng unitIds làm tham số: không nối bảng của Core', () => {
    const { sql } = postVisibilitySql(
      { viewerId: 'u', seesAllGroups: false, canModerate: false, memberGroupIds: [] },
      { firstParam: 1 },
    );
    expect(sql).not.toMatch(/core_schema|organization/i);
    expect(sql).toContain('social_schema.post_audience');
  });
});

/* ------------------------------------------------------------------------------------------------
 * Đối chiếu SQL với `canViewPostInScope`.
 *
 * Không có PostgreSQL trong bộ test mặc định, nên mệnh đề SQL được chạy bằng một bộ đánh giá nhỏ
 * chỉ hiểu đúng phần ngữ pháp mà `postVisibilitySql` dùng (AND, OR, =, <>, IS [NOT] NULL, ANY, EXISTS,
 * TRUE/FALSE, tham số `$n`). Cú pháp lạ làm bộ đánh giá ném lỗi, nên SQL không thể lệch luật một cách
 * âm thầm. Logic ba giá trị: NULL coi như sai; mệnh đề không dùng NOT nên tương đương với SQL thật.
 * ---------------------------------------------------------------------------------------------- */

type Value = string | boolean | null | readonly string[];

interface Tables {
  readonly p: Record<string, Value>;
  readonly g: Record<string, Value> | undefined;
  readonly audience: readonly { post_id: string; principal_type: string; principal_id: string }[];
}

type Token = { type: 'word' | 'str' | 'param' | 'punct'; value: string };

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < sql.length) {
    const char = sql[index];
    if (/\s/.test(char)) {
      index += 1;
    } else if (char === "'") {
      const end = sql.indexOf("'", index + 1);
      tokens.push({ type: 'str', value: sql.slice(index + 1, end) });
      index = end + 1;
    } else if (char === '$') {
      const match = /^\$(\d+)/.exec(sql.slice(index));
      if (!match) throw new Error('Tham số lạ trong SQL.');
      tokens.push({ type: 'param', value: match[1] });
      index += match[0].length;
      const cast = /^::uuid(\[\])?/.exec(sql.slice(index));
      if (cast) index += cast[0].length;
    } else if (char === '<' && sql[index + 1] === '>') {
      tokens.push({ type: 'punct', value: '<>' });
      index += 2;
    } else if ('()='.includes(char)) {
      tokens.push({ type: 'punct', value: char });
      index += 1;
    } else {
      const match = /^[A-Za-z_][A-Za-z0-9_.]*|^\d+/.exec(sql.slice(index));
      if (!match) throw new Error(`Ký tự lạ trong SQL: ${sql.slice(index, index + 20)}`);
      tokens.push({ type: 'word', value: match[0] });
      index += match[0].length;
    }
  }
  return tokens;
}

function evaluate(sql: string, params: readonly unknown[], firstParam: number, tables: Tables): boolean {
  const tokens = tokenize(sql);
  let position = 0;
  const peek = (offset = 0) => tokens[position + offset];
  const upper = (token?: Token) => (token?.type === 'word' ? token.value.toUpperCase() : undefined);
  const take = (): Token => {
    const token = tokens[position];
    if (!token) throw new Error('SQL kết thúc sớm.');
    position += 1;
    return token;
  };
  const eat = (value: string) => {
    const token = take();
    if (token.value.toUpperCase() !== value) throw new Error(`Cần ${value}, gặp ${token.value}.`);
  };

  const rows: Record<string, Record<string, Value> | undefined> = { p: tables.p, g: tables.g };

  function operand(context: Record<string, Record<string, Value> | undefined>): Value {
    const token = take();
    if (token.type === 'str') return token.value;
    if (token.type === 'param') return params[Number(token.value) - firstParam] as Value;
    if (upper(token) === 'ANY') {
      eat('(');
      const inner = operand(context);
      eat(')');
      return inner;
    }
    if (token.type === 'word') {
      const [alias, column] = token.value.split('.');
      if (column === undefined) throw new Error(`Từ lạ: ${token.value}`);
      const row = context[alias];
      if (!(alias in context)) throw new Error(`Bí danh lạ: ${alias}`);
      return row ? (row[column] ?? null) : null;
    }
    throw new Error(`Toán hạng lạ: ${token.value}`);
  }

  function equals(left: Value, right: Value): boolean {
    if (left === null || right === null) return false;
    if (Array.isArray(right)) return (right as readonly string[]).includes(left as string);
    if (Array.isArray(left)) return (left as readonly string[]).includes(right as string);
    return left === right;
  }

  function primary(context: Record<string, Record<string, Value> | undefined>): boolean {
    const next = peek();
    if (next?.value === '(' && next.type === 'punct') {
      take();
      const value = orExpr(context);
      eat(')');
      return value;
    }
    if (upper(next) === 'TRUE') {
      take();
      return true;
    }
    if (upper(next) === 'FALSE') {
      take();
      return false;
    }
    if (upper(next) === 'EXISTS') {
      take();
      eat('(');
      eat('SELECT');
      take(); // 1
      eat('FROM');
      eat('SOCIAL_SCHEMA.POST_AUDIENCE');
      const alias = take().value;
      eat('WHERE');
      const start = position;
      let found = false;
      let end = start;
      for (const row of tables.audience) {
        position = start;
        if (orExpr({ ...context, [alias]: row })) found = true;
        end = position;
      }
      if (tables.audience.length === 0) {
        // Đọc qua mệnh đề WHERE để đưa con trỏ tới dấu ngoặc đóng của EXISTS.
        position = start;
        orExpr({ ...context, [alias]: { post_id: '', principal_type: '', principal_id: '' } });
        end = position;
      }
      position = end;
      eat(')');
      return found;
    }
    const left = operand(context);
    const operator = peek();
    if (upper(operator) === 'IS') {
      take();
      let negate = false;
      if (upper(peek()) === 'NOT') {
        take();
        negate = true;
      }
      eat('NULL');
      return negate ? left !== null : left === null;
    }
    if (operator?.type === 'punct' && (operator.value === '=' || operator.value === '<>')) {
      take();
      const right = operand(context);
      if (left === null || right === null) return false;
      return operator.value === '=' ? equals(left, right) : left !== right;
    }
    throw new Error(`Biểu thức lạ gần ${operator?.value ?? 'cuối chuỗi'}.`);
  }

  function andExpr(context: Record<string, Record<string, Value> | undefined>): boolean {
    let value = primary(context);
    while (upper(peek()) === 'AND') {
      take();
      const right = primary(context);
      value = value && right;
    }
    return value;
  }

  function orExpr(context: Record<string, Record<string, Value> | undefined>): boolean {
    let value = andExpr(context);
    while (upper(peek()) === 'OR') {
      take();
      const right = andExpr(context);
      value = value || right;
    }
    return value;
  }

  const result = orExpr(rows);
  if (position !== tokens.length) throw new Error('Còn thừa token sau biểu thức.');
  return result;
}

const AUTHOR = 'author';
const OUTSIDER = 'outsider';
const PARENT_UNIT = 'unit-parent';
const CHILD_UNIT = 'unit-child';
const OTHER_UNIT = 'unit-other';

const viewers: readonly { readonly name: string; readonly scope: PostVisibilityScope }[] = [
  { name: 'tác giả', scope: { viewerId: AUTHOR, seesAllGroups: false, canModerate: false, memberGroupIds: [], unitIds: [PARENT_UNIT] } },
  { name: 'người ngoài', scope: { viewerId: OUTSIDER, seesAllGroups: false, canModerate: false, memberGroupIds: [], unitIds: [OTHER_UNIT] } },
  { name: 'người không có phòng ban', scope: { viewerId: OUTSIDER, seesAllGroups: false, canModerate: false, memberGroupIds: [] } },
  { name: 'cùng phòng cha', scope: { viewerId: 'same', seesAllGroups: false, canModerate: false, memberGroupIds: [], unitIds: [PARENT_UNIT] } },
  { name: 'ở phòng con của phòng cha', scope: { viewerId: 'child', seesAllGroups: false, canModerate: false, memberGroupIds: [], unitIds: [CHILD_UNIT, PARENT_UNIT] } },
  { name: 'moderator', scope: { viewerId: 'mod', seesAllGroups: false, canModerate: true, memberGroupIds: [], unitIds: [PARENT_UNIT, CHILD_UNIT] } },
  { name: 'quản trị tenant', scope: { viewerId: 'admin', seesAllGroups: true, canModerate: true, memberGroupIds: [], unitIds: [PARENT_UNIT] } },
  { name: 'thành viên nhóm', scope: { viewerId: 'member', seesAllGroups: false, canModerate: false, memberGroupIds: ['grp'], unitIds: [] } },
  { name: 'được chia sẻ theo người', scope: { viewerId: 'picked', seesAllGroups: false, canModerate: false, memberGroupIds: [], unitIds: [OTHER_UNIT] } },
  { name: 'được chia sẻ theo phòng ban', scope: { viewerId: 'unit-picked', seesAllGroups: false, canModerate: false, memberGroupIds: [], unitIds: [OTHER_UNIT, CHILD_UNIT] } },
];

const STATUSES: readonly SocialPostStatus[] = ['published', 'pending', 'scheduled', 'rejected', 'deleted'];
const VISIBILITIES: readonly SocialPostVisibility[] = ['company', 'unit', 'custom', 'private'];
const GROUPS: readonly { readonly name: string; readonly privacy?: SocialGroupPrivacy; readonly deleted?: boolean }[] = [
  { name: 'Tường công ty' },
  { name: 'nhóm công khai', privacy: 'public' },
  { name: 'nhóm riêng tư', privacy: 'private' },
  { name: 'nhóm đã xoá', privacy: 'public', deleted: true },
];

describe('postVisibilitySql đối chiếu canViewPostInScope', () => {
  const FIRST_PARAM = 3;

  it('khớp trên toàn bộ ma trận trạng thái x quyền xem x nhóm x người xem', () => {
    let compared = 0;
    for (const viewer of viewers) {
      for (const status of STATUSES) {
        for (const group of GROUPS) {
          for (const visibility of VISIBILITIES) {
            // Bài nhóm luôn `company` (CHECK ở DB).
            if (group.privacy && visibility !== 'company') continue;
            const subject: PostVisibilitySubject = {
              authorId: AUTHOR,
              status,
              ...(group.privacy
                ? { groupId: 'grp', groupPrivacy: group.privacy, groupDeleted: group.deleted === true }
                : {}),
              visibility,
              ...(visibility === 'unit' ? { authorUnitId: PARENT_UNIT } : {}),
              ...(visibility === 'custom' ? { audienceUserIds: ['picked'], audienceUnitIds: [CHILD_UNIT] } : {}),
            };
            const clause = postVisibilitySql(viewer.scope, { firstParam: FIRST_PARAM });
            const sqlResult = evaluate(clause.sql, clause.params, FIRST_PARAM, {
              p: {
                id: 'post',
                status,
                author_id: AUTHOR,
                group_id: group.privacy ? 'grp' : null,
                visibility,
                author_unit_id: visibility === 'unit' ? PARENT_UNIT : null,
              },
              g: group.privacy
                ? { privacy: group.privacy, deleted_at: group.deleted ? 'đã xoá' : null }
                : undefined,
              audience:
                visibility === 'custom'
                  ? [
                      { post_id: 'post', principal_type: 'user', principal_id: 'picked' },
                      { post_id: 'post', principal_type: 'unit', principal_id: CHILD_UNIT },
                    ]
                  : [],
            });
            const label = `${viewer.name} | ${status} | ${group.name} | ${visibility}`;
            expect([label, sqlResult]).toEqual([label, canViewPostInScope(viewer.scope, subject)]);
            compared += 1;
          }
        }
      }
    }
    expect(compared).toBe(viewers.length * STATUSES.length * (VISIBILITIES.length + 3));
  });

  describe('ca nghiệp vụ của đợt 2 (đối chiếu hàm thuần)', () => {
    const wall = (visibility: SocialPostVisibility, extra: Partial<PostVisibilitySubject> = {}): PostVisibilitySubject => ({
      authorId: AUTHOR,
      status: 'published',
      visibility,
      ...extra,
    });
    const scopeOf = (name: string): PostVisibilityScope => {
      const viewer = viewers.find((entry) => entry.name === name);
      if (!viewer) throw new Error(`Không có người xem "${name}".`);
      return viewer.scope;
    };

    it('unit: người ở phòng con thấy bài của phòng cha, người ở phòng cha không thấy bài của phòng con', () => {
      expect(canViewPostInScope(scopeOf('ở phòng con của phòng cha'), wall('unit', { authorUnitId: PARENT_UNIT }))).toBe(true);
      expect(canViewPostInScope(scopeOf('cùng phòng cha'), wall('unit', { authorUnitId: CHILD_UNIT }))).toBe(false);
      expect(canViewPostInScope(scopeOf('người ngoài'), wall('unit', { authorUnitId: PARENT_UNIT }))).toBe(false);
      expect(canViewPostInScope(scopeOf('người không có phòng ban'), wall('unit', { authorUnitId: PARENT_UNIT }))).toBe(false);
    });

    it('custom: theo người hoặc theo nút (gồm phòng con); người khác không thấy', () => {
      const subject = wall('custom', { audienceUserIds: ['picked'], audienceUnitIds: [CHILD_UNIT] });
      expect(canViewPostInScope(scopeOf('được chia sẻ theo người'), subject)).toBe(true);
      expect(canViewPostInScope(scopeOf('được chia sẻ theo phòng ban'), subject)).toBe(true);
      expect(canViewPostInScope(scopeOf('người ngoài'), subject)).toBe(false);
    });

    it('private và các quyền hẹp: moderator và quản trị tenant cũng không thấy', () => {
      for (const visibility of ['private', 'unit', 'custom'] as const) {
        const subject = wall(visibility, { authorUnitId: 'khong-ai-thuoc', audienceUserIds: [], audienceUnitIds: [] });
        expect(canViewPostInScope(scopeOf('moderator'), subject)).toBe(false);
        expect(canViewPostInScope(scopeOf('quản trị tenant'), subject)).toBe(false);
        expect(canViewPostInScope(scopeOf('tác giả'), subject)).toBe(true);
      }
    });

    it('bài hẹn giờ quyền hẹp: chỉ tác giả thấy, moderator thì không', () => {
      const subject: PostVisibilitySubject = { authorId: AUTHOR, status: 'scheduled', visibility: 'private' };
      expect(canViewPostInScope(scopeOf('moderator'), subject)).toBe(false);
      expect(canViewPostInScope(scopeOf('tác giả'), subject)).toBe(true);
      expect(canViewPostInScope(scopeOf('moderator'), { ...subject, visibility: 'company' })).toBe(true);
    });
  });
});
