import {
  applyMention,
  extractMentionIds,
  findMentionQuery,
  fold,
  nextActiveIndex,
  scanMentions,
  splitByMentions,
  suggestPeople,
} from './chat-mentions';
import type { ChatPerson } from './chat-people';

const PEOPLE: ChatPerson[] = [
  { id: 'u-thinh', name: 'Nguyễn Tấn Thịnh' },
  { id: 'u-quynh', name: 'Nguyễn Trần Như Quỳnh' },
  { id: 'u-quyen', name: 'Bùi Công Quyền' },
  { id: 'u-van', name: 'Nguyễn Văn' },
  { id: 'u-vana', name: 'Nguyễn Văn A' },
];

describe('findMentionQuery', () => {
  it('bắt lượt nhắc đang gõ dở, kể cả khi tên có dấu cách', () => {
    expect(findMentionQuery('Nhờ @Nguyễn Tấn', 15)).toEqual({ start: 4, term: 'Nguyễn Tấn' });
  });

  it('`@` ngay đầu dòng, hoặc vừa gõ chưa có chữ nào', () => {
    expect(findMentionQuery('@', 1)).toEqual({ start: 0, term: '' });
    expect(findMentionQuery('a\n@Bùi', 6)).toEqual({ start: 2, term: 'Bùi' });
  });

  it('`@` dính vào từ khác (địa chỉ thư) không phải lượt nhắc', () => {
    expect(findMentionQuery('gui a@b', 7)).toBeUndefined();
  });

  it('xuống dòng sau `@` hoặc quá dài thì không còn là lượt nhắc', () => {
    expect(findMentionQuery('@Bùi\nCông', 9)).toBeUndefined();
    expect(findMentionQuery(`@${'a'.repeat(80)}`, 81)).toBeUndefined();
  });

  it('chỉ xét phần trước con trỏ', () => {
    expect(findMentionQuery('chào @Bùi', 2)).toBeUndefined();
  });
});

describe('suggestPeople', () => {
  it('lọc theo phần gõ, không phân biệt dấu và hoa thường', () => {
    expect(suggestPeople(PEOPLE, 'quyen').map((p) => p.id)).toEqual(['u-quyen']);
    expect(suggestPeople(PEOPLE, 'THINH').map((p) => p.id)).toEqual(['u-thinh']);
  });

  it('khớp đầu tên lên trước khớp giữa tên', () => {
    const ids = suggestPeople(PEOPLE, 'nguyen van').map((p) => p.id);
    expect(ids.slice(0, 2)).toEqual(['u-van', 'u-vana']);
  });

  it('từ khoá rỗng thì gợi ý tất cả (tới giới hạn)', () => {
    expect(suggestPeople(PEOPLE, '')).toHaveLength(5);
    expect(suggestPeople(PEOPLE, '', 2)).toHaveLength(2);
  });

  it('gõ xong đúng một tên đầy đủ rồi thêm dấu cách thì không gợi ý lại', () => {
    expect(suggestPeople(PEOPLE, 'Nguyễn Tấn Thịnh ')).toEqual([]);
    expect(suggestPeople(PEOPLE, 'Nguyễn Tấn Thịnh').map((p) => p.id)).toEqual(['u-thinh']);
  });

  it('không khớp ai thì rỗng', () => {
    expect(suggestPeople(PEOPLE, 'zzz')).toEqual([]);
  });
});

describe('applyMention', () => {
  it('thay phần đang gõ bằng tên đầy đủ kèm dấu cách, giữ phần sau con trỏ', () => {
    const query = { start: 4, term: 'Ngu' };
    expect(applyMention('Nhờ @Ngu xem', query, 8, 'Nguyễn Tấn Thịnh')).toEqual({
      text: 'Nhờ @Nguyễn Tấn Thịnh  xem',
      caret: 4 + '@Nguyễn Tấn Thịnh '.length,
    });
  });
});

describe('scanMentions / extractMentionIds', () => {
  it('chỉ nhận tên của người thật, kèm vị trí gồm cả dấu @', () => {
    const text = 'Nhờ @Nguyễn Tấn Thịnh và @Ai Đó xem';
    expect(scanMentions(text, PEOPLE)).toEqual([{ start: 4, end: 4 + '@Nguyễn Tấn Thịnh'.length, userId: 'u-thinh' }]);
  });

  it('khớp tên DÀI nhất trước: "Nguyễn Văn A" không bị coi là "Nguyễn Văn"', () => {
    expect(extractMentionIds('@Nguyễn Văn A xem giúp', PEOPLE)).toEqual(['u-vana']);
    expect(extractMentionIds('@Nguyễn Văn xem giúp', PEOPLE)).toEqual(['u-van']);
  });

  it('dấu câu liền sau tên vẫn tính, chữ liền sau thì không', () => {
    expect(extractMentionIds('@Bùi Công Quyền, cảm ơn', PEOPLE)).toEqual(['u-quyen']);
    expect(extractMentionIds('@Bùi Công Quyềnxyz', PEOPLE)).toEqual([]);
  });

  it('`@` dính vào từ khác không tính', () => {
    expect(extractMentionIds('mail a@Bùi Công Quyền', PEOPLE)).toEqual([]);
  });

  it('nhắc trùng một người chỉ tính một lần, giữ thứ tự xuất hiện', () => {
    expect(extractMentionIds('@Bùi Công Quyền @Nguyễn Tấn Thịnh @Bùi Công Quyền', PEOPLE)).toEqual(['u-quyen', 'u-thinh']);
  });

  it('không có `@` hoặc không có người nào thì rỗng', () => {
    expect(scanMentions('xin chào', PEOPLE)).toEqual([]);
    expect(scanMentions('@Bùi Công Quyền', [])).toEqual([]);
  });

  it('chỉ nhận ID NGƯỜI: tên chức danh ghép nhiều người không còn là một lượt nhắc', () => {
    // Trước đây chip "@Nguyễn Trần Như Quỳnh, Bùi Công Quyền" là một chức danh; giờ chỉ từng người được nhận.
    const ids = extractMentionIds('@Nguyễn Trần Như Quỳnh, Bùi Công Quyền', PEOPLE);
    expect(ids).toEqual(['u-quynh']);
  });
});

describe('splitByMentions', () => {
  it('xen kẽ đoạn thường và đoạn nhắc, ghép lại đúng nguyên văn', () => {
    const text = 'Nhờ @Nguyễn Tấn Thịnh và @Bùi Công Quyền xem';
    const parts = splitByMentions(text, scanMentions(text, PEOPLE));
    expect(parts.filter((p) => p.mention).map((p) => p.text)).toEqual(['@Nguyễn Tấn Thịnh', '@Bùi Công Quyền']);
    expect(parts.map((p) => p.text).join('')).toBe(text);
  });

  it('không có lượt nhắc: một đoạn thường; rỗng: không có đoạn', () => {
    expect(splitByMentions('xin chào', [])).toEqual([{ text: 'xin chào', mention: false }]);
    expect(splitByMentions('', [])).toEqual([]);
  });
});

describe('nextActiveIndex / fold', () => {
  it('đi vòng ở hai đầu và danh sách rỗng thì giữ 0', () => {
    expect(nextActiveIndex(2, 'ArrowDown', 3)).toBe(0);
    expect(nextActiveIndex(0, 'ArrowUp', 3)).toBe(2);
    expect(nextActiveIndex(0, 'ArrowDown', 0)).toBe(0);
  });

  it('fold bỏ dấu tiếng Việt kể cả đ/Đ', () => {
    expect(fold('Đậu Bá Kiên')).toBe('dau ba kien');
  });
});
