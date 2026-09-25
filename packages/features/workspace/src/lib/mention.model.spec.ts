import type { ProjectMember } from '@enterprise-platform/contracts-workspace';
import {
  applyMention,
  extractMentions,
  findMentionQuery,
  mentionHandles,
  suggestMembers,
} from './mention.model';

const member = (userId: string): ProjectMember => ({
  id: `m-${userId}`,
  projectId: 'p1',
  userId,
  role: 'member',
  joinedAt: '2026-09-01T00:00:00.000Z',
});

const MEMBERS = [member('an'), member('binh'), member('an-nguyen')];

describe('findMentionQuery', () => {
  it('bắt được lượt nhắc đang gõ dở', () => {
    expect(findMentionQuery('chào @bi', 8)).toEqual({ start: 5, term: 'bi' });
  });

  it('`@` ngay đầu dòng vẫn tính', () => {
    expect(findMentionQuery('@an', 3)).toEqual({ start: 0, term: 'an' });
  });

  it('`@` vừa gõ, chưa có chữ nào', () => {
    expect(findMentionQuery('chào @', 6)).toEqual({ start: 5, term: '' });
  });

  it('`@` dính vào từ khác không phải lượt nhắc', () => {
    // Địa chỉ thư không được biến thành gợi ý.
    expect(findMentionQuery('gui toi a@b', 11)).toBeUndefined();
  });

  it('có khoảng trắng sau `@` thì lượt nhắc đã kết thúc', () => {
    expect(findMentionQuery('chào @an ban', 12)).toBeUndefined();
  });

  it('không có `@` nào thì không gợi ý', () => {
    expect(findMentionQuery('chào bạn', 8)).toBeUndefined();
  });

  it('chỉ xét phần trước con trỏ', () => {
    // Con trỏ ở đầu dòng, `@` nằm sau nó — chưa gõ tới thì chưa gợi ý.
    expect(findMentionQuery('chào @an', 2)).toBeUndefined();
  });
});

describe('suggestMembers', () => {
  it('lọc theo phần đã gõ, không phân biệt hoa thường', () => {
    expect(suggestMembers(MEMBERS, 'AN').map((entry) => entry.userId)).toEqual([
      'an',
      'an-nguyen',
    ]);
  });

  it('từ khoá rỗng thì gợi ý toàn bộ thành viên', () => {
    expect(suggestMembers(MEMBERS, '')).toHaveLength(3);
  });

  it('cắt theo giới hạn', () => {
    expect(suggestMembers(MEMBERS, '', undefined, 2)).toHaveLength(2);
  });
});

describe('applyMention', () => {
  it('thay phần đang gõ bằng lượt nhắc đầy đủ kèm khoảng trắng', () => {
    const result = applyMention('chào @bi', { start: 5, term: 'bi' }, 8, 'binh');
    expect(result.text).toBe('chào @binh ');
    expect(result.caret).toBe(11);
  });

  it('giữ nguyên phần văn bản sau con trỏ', () => {
    const result = applyMention('chào @bi nhé', { start: 5, term: 'bi' }, 8, 'binh');
    expect(result.text).toBe('chào @binh  nhé');
  });
});

describe('extractMentions', () => {
  it('chỉ nhận id trùng với thành viên thật', () => {
    expect(extractMentions('@an và @khong-ton-tai', MEMBERS)).toEqual(['an']);
  });

  it('không nhận `@` dính vào từ khác', () => {
    expect(extractMentions('gui toi a@an', MEMBERS)).toEqual([]);
  });

  it('nhắc trùng một người chỉ tính một lần', () => {
    expect(extractMentions('@an @an', MEMBERS)).toEqual(['an']);
  });

  it('không có lượt nhắc nào thì trả mảng rỗng', () => {
    expect(extractMentions('chào cả nhà', MEMBERS)).toEqual([]);
  });
});

describe('nhắc bằng tên thật', () => {
  const people: Record<string, string> = {
    'u-mai': 'Nguyễn Thị Mai',
    'u-hung': 'Lê Văn Hùng',
    'u-mai2': 'Nguyễn Thị Mai',
  };
  const nameOf = (userId: string) => people[userId] ?? userId;
  const team = [member('u-mai'), member('u-hung')];

  it('tên gọn bỏ dấu, bỏ khoảng trắng, viết hoa đầu từ', () => {
    expect(mentionHandles(team, nameOf).get('u-hung')).toBe('LeVanHung');
  });

  it('trùng tên gọn thì thêm đuôi id, dài dần cho tới khi phân biệt được', () => {
    // Hai id chung 4 ký tự đầu: đuôi 4 ký tự vẫn trùng, phải lên 8.
    const handles = mentionHandles([member('u-mai'), member('u-mai2')], nameOf);
    expect(handles.get('u-mai')).toBe('NguyenThiMai-u-mai');
    expect(handles.get('u-mai2')).toBe('NguyenThiMai-u-mai2');
    expect(handles.get('u-mai')).not.toBe(handles.get('u-mai2'));
  });

  it('gợi ý khớp tên không dấu', () => {
    expect(suggestMembers(team, 'hung', nameOf).map((entry) => entry.userId)).toEqual(['u-hung']);
  });

  it('rút id từ tên gọn trong nội dung', () => {
    const handles = mentionHandles(team, nameOf);
    expect(extractMentions('Nhờ @LeVanHung xem giúp', team, handles)).toEqual(['u-hung']);
  });
});
