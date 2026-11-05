import {
  formatQuoteCodePattern,
  normalizeManualQuoteCode,
  normalizeQuoteCodePattern,
  parseQuoteCodePattern,
} from './quote-code.js';
import { formatQuoteCode } from './quote.js';

describe('mã báo giá theo mẫu (P2I-05)', () => {
  const date = { year: 2026, month: 11, day: 2 };

  it('TC-QF-02: mẫu {yyyymmdd}/BG//{seq} cho 20261102/BG//383', () => {
    expect(formatQuoteCodePattern('{yyyymmdd}/BG//{seq}', date, 383)).toBe('20261102/BG//383');
    expect(formatQuoteCodePattern('{yyyymmdd}/BG//{seq}', date, 384)).toBe('20261102/BG//384');
  });

  it('đệm số 0, các mốc ngày, số vượt độ đệm giữ đủ chữ số', () => {
    expect(formatQuoteCodePattern('BG{yy}{mm}-{seq:5}', date, 7)).toBe('BG2611-00007');
    expect(formatQuoteCodePattern('{yyyy}.{dd}/{seq:3}', date, 12345)).toBe('2026.02/12345');
  });

  it('chuẩn hoá mẫu: rỗng là bỏ; bắt buộc đúng một {seq}; ký tự lạ bị từ chối; mã tối đa 30 ký tự', () => {
    expect(normalizeQuoteCodePattern('  ')).toBeNull();
    expect(normalizeQuoteCodePattern(undefined)).toBeNull();
    expect(normalizeQuoteCodePattern(' {yyyymmdd}/BG//{seq} ')).toBe('{yyyymmdd}/BG//{seq}');
    expect(() => normalizeQuoteCodePattern('BG{yy}')).toThrow(expect.objectContaining({ code: 'INVALID_QUOTE_CODE_PATTERN' }));
    expect(() => normalizeQuoteCodePattern('{seq}{seq}')).toThrow(expect.objectContaining({ code: 'INVALID_QUOTE_CODE_PATTERN' }));
    expect(() => normalizeQuoteCodePattern('BG {seq}')).toThrow(expect.objectContaining({ code: 'INVALID_QUOTE_CODE_PATTERN' }));
    expect(() => normalizeQuoteCodePattern('{yyyymmdd}/{xyz}/{seq}')).toThrow(expect.objectContaining({ code: 'INVALID_QUOTE_CODE_PATTERN' }));
    expect(() => normalizeQuoteCodePattern(`${'A'.repeat(25)}{seq}`)).toThrow(expect.objectContaining({ code: 'INVALID_QUOTE_CODE_PATTERN' }));
  });

  it('mẫu lưu hỏng thì coi như chưa cấu hình; mã cũ BG<yy><5 chữ số> vẫn sinh như phase 1', () => {
    expect(parseQuoteCodePattern({ pattern: '{yyyymmdd}/BG//{seq}' })).toBe('{yyyymmdd}/BG//{seq}');
    expect(parseQuoteCodePattern({ pattern: 'hỏng' })).toBeNull();
    expect(parseQuoteCodePattern(null)).toBeNull();
    expect(formatQuoteCode(2026, 383)).toBe('BG2600383');
  });

  it('mã nhập tay: bỏ khoảng trắng, rỗng là sinh tự động, ký tự lạ bị từ chối', () => {
    expect(normalizeManualQuoteCode(' 20261102/BG//383 ')).toBe('20261102/BG//383');
    expect(normalizeManualQuoteCode('BG2600001')).toBe('BG2600001');
    expect(normalizeManualQuoteCode('')).toBeNull();
    expect(normalizeManualQuoteCode(null)).toBeNull();
    expect(() => normalizeManualQuoteCode('mã có dấu')).toThrow(expect.objectContaining({ code: 'INVALID_QUOTE_CODE' }));
    expect(() => normalizeManualQuoteCode('A'.repeat(31))).toThrow(expect.objectContaining({ code: 'INVALID_QUOTE_CODE' }));
  });
});
