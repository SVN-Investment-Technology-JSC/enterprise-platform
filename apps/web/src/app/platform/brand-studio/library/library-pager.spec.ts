import { DEFAULT_VIEW } from './library-filters';
import {
  DEFAULT_PAGE_SIZE,
  EMPTY_MEMORY,
  MEMORY_KEY,
  MEMORY_LIMIT,
  PAGE_SIZE_OPTIONS,
  normalizePageSize,
  pageAfterSizeChange,
  pageKey,
  pageWindow,
  paginate,
  parseMemory,
  readMemory,
  rememberPage,
  writeMemory,
} from './library-pager';

const numbers = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

describe('normalizePageSize', () => {
  it('giữ cỡ trang hợp lệ, còn lại dùng mặc định', () => {
    for (const size of PAGE_SIZE_OPTIONS) expect(normalizePageSize(size)).toBe(size);
    for (const bad of [0, -1, 7, 1000, 24.5, '24', null, undefined, Number.NaN]) expect(normalizePageSize(bad)).toBe(DEFAULT_PAGE_SIZE);
  });
});

describe('paginate', () => {
  it('cắt đúng trang và báo khoảng đang xem', () => {
    const slice = paginate(numbers(62), 2, 24);
    expect(slice.items).toEqual(numbers(62).slice(24, 48));
    expect(slice).toMatchObject({ page: 2, pages: 3, pageSize: 24, total: 62, from: 25, to: 48 });
    expect(paginate(numbers(62), 3, 24)).toMatchObject({ from: 49, to: 62 });
    expect(paginate(numbers(62), 3, 24).items).toHaveLength(14);
  });

  it('danh sách rỗng: một trang trống, không có khoảng đang xem', () => {
    expect(paginate([], 1, 24)).toMatchObject({ items: [], page: 1, pages: 1, total: 0, from: 0, to: 0 });
  });

  it('vừa đủ một trang thì chỉ có một trang; thừa một icon thì sang trang hai', () => {
    expect(paginate(numbers(24), 1, 24).pages).toBe(1);
    expect(paginate(numbers(25), 1, 24).pages).toBe(2);
    expect(paginate(numbers(25), 2, 24).items).toEqual([25]);
  });

  it('trang ngoài khoảng, lẻ hoặc không phải số được kẹp lại', () => {
    expect(paginate(numbers(30), 99, 12).page).toBe(3);
    expect(paginate(numbers(30), 0, 12).page).toBe(1);
    expect(paginate(numbers(30), -5, 12).page).toBe(1);
    expect(paginate(numbers(30), 2.9, 12).page).toBe(2);
    expect(paginate(numbers(30), Number.NaN, 12).page).toBe(1);
  });

  it('cỡ trang lạ dùng mặc định; không đổi mảng gốc', () => {
    const source = numbers(100);
    expect(paginate(source, 1, 7).pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(source).toHaveLength(100);
  });
});

describe('pageAfterSizeChange', () => {
  it('giữ icon đầu trang đang xem trong trang mới', () => {
    expect(pageAfterSizeChange(3, 12, 24)).toBe(2); // icon 25 nằm ở trang 2 của cỡ 24
    expect(pageAfterSizeChange(2, 24, 12)).toBe(3); // icon 25 nằm ở trang 3 của cỡ 12
    expect(pageAfterSizeChange(1, 12, 96)).toBe(1);
    expect(pageAfterSizeChange(0, 12, 24)).toBe(1);
  });
});

describe('pageWindow', () => {
  it('ít trang thì liệt kê hết', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(3, 7)).toEqual(numbers(7));
  });

  it('nhiều trang: luôn có đầu và cuối, tối đa 7 ô, chỗ hở là dấu gạch', () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, 4, 5, 'gap-end', 20]);
    expect(pageWindow(4, 20)).toEqual([1, 2, 3, 4, 5, 'gap-end', 20]);
    expect(pageWindow(10, 20)).toEqual([1, 'gap-start', 9, 10, 11, 'gap-end', 20]);
    expect(pageWindow(17, 20)).toEqual([1, 'gap-start', 16, 17, 18, 19, 20]);
    expect(pageWindow(20, 20)).toEqual([1, 'gap-start', 16, 17, 18, 19, 20]);
    for (let page = 1; page <= 20; page += 1) expect(pageWindow(page, 20)).toHaveLength(7);
  });
});

describe('pageKey', () => {
  it('khác bộ lọc, sắp xếp, cỡ trang hoặc từ khoá thì khác khoá; hoa thường và khoảng trắng đầu cuối không tính', () => {
    const base = pageKey(DEFAULT_VIEW, 24);
    expect(pageKey({ ...DEFAULT_VIEW, category: 'module' }, 24)).not.toBe(base);
    expect(pageKey({ ...DEFAULT_VIEW, status: 'draft' }, 24)).not.toBe(base);
    expect(pageKey({ ...DEFAULT_VIEW, sort: 'name' }, 24)).not.toBe(base);
    expect(pageKey(DEFAULT_VIEW, 48)).not.toBe(base);
    expect(pageKey({ ...DEFAULT_VIEW, query: 'kho' }, 24)).not.toBe(base);
    expect(pageKey({ ...DEFAULT_VIEW, query: '  KHO ' }, 24)).toBe(pageKey({ ...DEFAULT_VIEW, query: 'kho' }, 24));
  });
});

describe('rememberPage', () => {
  it('nhớ trang lớn hơn 1, trang 1 thì bỏ khỏi bộ nhớ (đó là mặc định)', () => {
    expect(rememberPage({}, 'a', 3)).toEqual({ a: 3 });
    expect(rememberPage({ a: 3 }, 'a', 1)).toEqual({});
    expect(rememberPage({ a: 3, b: 2 }, 'a', 4)).toEqual({ b: 2, a: 4 });
  });

  it('không đổi đối tượng cũ; vượt giới hạn thì bỏ tổ hợp cũ nhất', () => {
    const before = { a: 2 };
    rememberPage(before, 'b', 3);
    expect(before).toEqual({ a: 2 });

    let pages: Record<string, number> = {};
    for (let index = 0; index < MEMORY_LIMIT + 5; index += 1) pages = rememberPage(pages, `k${index}`, 2);
    const keys = Object.keys(pages);
    expect(keys).toHaveLength(MEMORY_LIMIT);
    expect(keys[0]).toBe('k5');
    expect(keys[keys.length - 1]).toBe(`k${MEMORY_LIMIT + 4}`);
  });
});

describe('parseMemory', () => {
  it('dữ liệu rỗng hoặc sai kiểu thì trả về bộ nhớ trống', () => {
    for (const bad of [null, undefined, 'x', 5, []]) expect(parseMemory(bad)).toEqual(EMPTY_MEMORY);
  });

  it('giữ trường hợp lệ, thay trường sai bằng mặc định', () => {
    const memory = parseMemory({
      filters: { query: 'kho', category: 'module', status: 'bậy' },
      pages: { a: 3, b: 1, c: 'x', d: 2.5, e: -4 },
      scrollTop: 120,
    });
    expect(memory.filters).toEqual({ query: 'kho', category: 'module', status: 'all' });
    expect(memory.pages).toEqual({ a: 3 });
    expect(memory.scrollTop).toBe(120);
    expect(parseMemory({ scrollTop: -5 }).scrollTop).toBe(0);
    expect(parseMemory({ scrollTop: Number.POSITIVE_INFINITY }).scrollTop).toBe(0);
    expect(parseMemory({ filters: { category: 'khong-co' } }).filters.category).toBe('all');
  });

  it('từ khoá quá dài bị cắt', () => {
    expect(parseMemory({ filters: { query: 'a'.repeat(500) } }).filters.query).toHaveLength(200);
  });
});

describe('readMemory và writeMemory', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('ghi rồi đọc lại đúng', () => {
    const memory = { filters: { query: 'rơ le', category: 'system' as const, status: 'draft' as const }, pages: { k: 3 }, scrollTop: 42 };
    writeMemory(memory);
    expect(readMemory()).toEqual(memory);
  });

  it('chưa có gì hoặc JSON hỏng thì trả về bộ nhớ trống', () => {
    expect(readMemory()).toEqual(EMPTY_MEMORY);
    window.sessionStorage.setItem(MEMORY_KEY, '{không phải json');
    expect(readMemory()).toEqual(EMPTY_MEMORY);
  });

  it('trình duyệt chặn sessionStorage thì không ném lỗi', () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readMemory()).toEqual(EMPTY_MEMORY);
    expect(() => writeMemory(EMPTY_MEMORY)).not.toThrow();
    getItem.mockRestore();
    setItem.mockRestore();
  });
});
