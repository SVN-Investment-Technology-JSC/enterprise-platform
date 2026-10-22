import { DEFAULT_RULES, type BrandRules } from '@enterprise-platform/shared-brand-icon';
import {
  MAX_STROKE_WIDTHS,
  NUMERIC_RULES,
  addStrokeWidth,
  formatDecimal,
  parseDecimal,
  removeStrokeWidth,
  setNumericRule,
  setRequirePalette,
  type RulesEdit,
} from './rules-model';

function ok(edit: RulesEdit): BrandRules {
  if (!edit.ok) throw new Error(`mong đợi thành công, nhận lỗi: ${edit.error}`);
  return edit.rules;
}

describe('parseDecimal', () => {
  it('nhận dấu phẩy và dấu chấm', () => {
    expect(parseDecimal('1,75')).toBe(1.75);
    expect(parseDecimal('1.75')).toBe(1.75);
    expect(parseDecimal(' 2 ')).toBe(2);
    expect(parseDecimal('.5')).toBe(0.5);
  });

  it('từ chối chuỗi không phải số không âm', () => {
    for (const text of ['', ' ', 'abc', '1,2,3', '1.2.3', '-1', '1e3', '--']) expect(parseDecimal(text)).toBeNull();
  });
});

describe('formatDecimal', () => {
  it('dùng dấu phẩy và tối đa 3 chữ số thập phân', () => {
    expect(formatDecimal(1.75)).toBe('1,75');
    expect(formatDecimal(2)).toBe('2');
    expect(formatDecimal(0.1 + 0.2)).toBe('0,3');
    expect(formatDecimal(0.12345)).toBe('0,123');
  });

  it('đọc lại được bằng parseDecimal', () => {
    for (const value of [0.25, 1.5, 1.75, 2, 6]) expect(parseDecimal(formatDecimal(value))).toBe(value);
  });
});

describe('addStrokeWidth', () => {
  it('thêm độ dày và giữ danh sách tăng dần', () => {
    const next = ok(addStrokeWidth(DEFAULT_RULES, 1));
    expect(next.allowedStrokeWidths).toEqual([1, 1.5, 1.75, 2]);
  });

  it('làm tròn tới hai chữ số thập phân', () => {
    expect(ok(addStrokeWidth(DEFAULT_RULES, 1.234)).allowedStrokeWidths).toContain(1.23);
  });

  it('từ chối giá trị ngoài khoảng, trùng, hoặc khi đã đủ số độ dày', () => {
    expect(addStrokeWidth(DEFAULT_RULES, 0.1)).toEqual({ ok: false, error: expect.stringContaining('từ 0,25 đến 6') });
    expect(addStrokeWidth(DEFAULT_RULES, 7)).toEqual({ ok: false, error: expect.stringContaining('từ 0,25 đến 6') });
    expect(addStrokeWidth(DEFAULT_RULES, Number.NaN).ok).toBe(false);
    expect(addStrokeWidth(DEFAULT_RULES, 1.75)).toEqual({ ok: false, error: expect.stringContaining('đã có') });
    const full: BrandRules = { ...DEFAULT_RULES, allowedStrokeWidths: Array.from({ length: MAX_STROKE_WIDTHS }, (_, index) => 0.5 + index * 0.25) };
    expect(addStrokeWidth(full, 5)).toEqual({ ok: false, error: expect.stringContaining('Tối đa') });
  });
});

describe('removeStrokeWidth', () => {
  it('bỏ một độ dày', () => {
    expect(ok(removeStrokeWidth(DEFAULT_RULES, 1.5)).allowedStrokeWidths).toEqual([1.75, 2]);
  });

  it('không cho bỏ độ dày cuối cùng', () => {
    const single: BrandRules = { ...DEFAULT_RULES, allowedStrokeWidths: [2] };
    expect(removeStrokeWidth(single, 2)).toEqual({ ok: false, error: expect.stringContaining('ít nhất') });
  });
});

describe('setNumericRule', () => {
  it('đặt giá trị trong khoảng', () => {
    expect(setNumericRule(DEFAULT_RULES, 'snapStep', 1).snapStep).toBe(1);
    expect(setNumericRule(DEFAULT_RULES, 'safePadding', 0).safePadding).toBe(0);
  });

  it('kẹp giá trị vào khoảng cho phép của từng quy chuẩn', () => {
    for (const field of NUMERIC_RULES) {
      expect(setNumericRule(DEFAULT_RULES, field.key, field.max + 100)[field.key]).toBe(field.max);
      expect(setNumericRule(DEFAULT_RULES, field.key, field.min - 100)[field.key]).toBe(field.min);
    }
  });

  it('số lớp tối đa luôn là số nguyên', () => {
    expect(setNumericRule(DEFAULT_RULES, 'maxShapes', 7.6).maxShapes).toBe(8);
  });

  it('không làm đổi các quy chuẩn khác', () => {
    const next = setNumericRule(DEFAULT_RULES, 'minFeature', 1.5);
    expect(next).toEqual({ ...DEFAULT_RULES, minFeature: 1.5 });
  });
});

describe('setRequirePalette', () => {
  it('bật và tắt bắt buộc dùng màu trong bảng', () => {
    expect(setRequirePalette(DEFAULT_RULES, false).requirePaletteColors).toBe(false);
    expect(setRequirePalette({ ...DEFAULT_RULES, requirePaletteColors: false }, true).requirePaletteColors).toBe(true);
  });
});

describe('NUMERIC_RULES', () => {
  it('khai báo đủ bốn quy chuẩn dạng số với khoảng hợp lệ', () => {
    expect(NUMERIC_RULES.map((field) => field.key)).toEqual(['safePadding', 'snapStep', 'minFeature', 'maxShapes']);
    for (const field of NUMERIC_RULES) expect(field.min).toBeLessThan(field.max);
  });
});
