import { decodeCursor, encodeCursor, pageLimit } from './pagination.js';
import { normalizeSearch, optionalEmail, optionalInstant, optionalMoney } from './fields.js';

describe('phân trang keyset và trường nhập', () => {
  it('con trỏ mã hoá rồi giải mã giữ nguyên micro giây', () => {
    const cursor = { at: '2026-10-27T03:04:05.123456Z', id: '11111111-2222-4333-8444-555555555555' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(decodeCursor(undefined)).toBeUndefined();
  });

  it.each(['abc', 'W10', Buffer.from('["x","y"]').toString('base64url'), 'a'.repeat(300)])(
    'con trỏ hỏng trả 400: %s',
    (raw) => expect(() => decodeCursor(raw)).toThrow('Vị trí trang không hợp lệ'),
  );

  it('số dòng mặc định 30, tối đa 100', () => {
    expect(pageLimit(undefined)).toBe(30);
    expect(pageLimit('500')).toBe(100);
    expect(() => pageLimit('0')).toThrow();
    expect(() => pageLimit('x')).toThrow();
  });

  it('TC-SEC-06: chuỗi tìm kiếm quá dài trả 400, ký tự đặc biệt giữ nguyên để tham số hoá', () => {
    expect(normalizeSearch("  ' OR 1=1 --  ")).toBe("' OR 1=1 --");
    expect(normalizeSearch('   ')).toBeUndefined();
    expect(() => normalizeSearch('a'.repeat(10_000))).toThrow('Chuỗi tìm kiếm tối đa');
  });

  it('email, tiền, thời điểm', () => {
    expect(optionalEmail(' a@b.vn ')).toBe('a@b.vn');
    expect(() => optionalEmail('abc')).toThrow('Email không đúng định dạng.');
    expect(optionalMoney('1000.6', 'hạn mức')).toBe(1001);
    expect(() => optionalMoney(-1, 'hạn mức')).toThrow('Hạn mức phải là số không âm.');
    expect(optionalInstant('2026-10-27T10:00:00+07:00', 'hạn')).toBe('2026-10-27T03:00:00.000Z');
    expect(() => optionalInstant('ngày mai', 'hạn')).toThrow('Hạn không hợp lệ.');
  });
});
