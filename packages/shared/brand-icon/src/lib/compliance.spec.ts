import {
  DEFAULT_RULES,
  checkCompliance,
  normalizeRules,
  type BrandRules,
  type ComplianceIssue,
} from './compliance';
import { createPresetDocuments } from './legacy';
import { createDocument, createShape, type Geometry, type IconDocument, type IconShape } from './model';
import { DEFAULT_PALETTE } from './palette';
import { parsePathData } from './path-data';

const stroke = (geometry: Geometry, overrides: Partial<IconShape> = {}) =>
  createShape(geometry, { stroke: 'brand:sapphire', strokeWidth: 1.75, ...overrides });

/** Một đường ngang nằm trên lưới, nét 1,75, đúng bảng màu: không vi phạm gì. */
const cleanLine = (overrides: Partial<IconShape> = {}) => stroke(parsePathData('M 4 12 L 20 12'), overrides);
const doc = (shapes: IconShape[], overrides: Partial<IconDocument> = {}) => createDocument({ name: 'Icon kiểm tra', shapes, ...overrides });
const codes = (issues: ComplianceIssue[]) => issues.map((issue) => issue.code);
const check = (document: IconDocument, rules: BrandRules = DEFAULT_RULES) => checkCompliance(document, DEFAULT_PALETTE, rules);

describe('checkCompliance', () => {
  it('icon đạt chuẩn thì không có vấn đề nào', () => {
    expect(check(doc([cleanLine()]))).toEqual([]);
  });

  it('icon rỗng hoặc chỉ có lớp ẩn là lỗi EMPTY', () => {
    const issues = check(doc([]));
    expect(issues).toEqual([expect.objectContaining({ code: 'EMPTY', severity: 'error' })]);
    expect(codes(check(doc([cleanLine({ hidden: true })])))).toEqual(['EMPTY']);
  });

  it('tên trống là lỗi NAME', () => {
    const issues = check(doc([cleanLine()], { name: '   ' }));
    expect(issues).toEqual([expect.objectContaining({ code: 'NAME', severity: 'error' })]);
  });

  it('lớp ẩn không bị kiểm tra', () => {
    const bad = cleanLine({ hidden: true, strokeWidth: 5, stroke: '#123456' });
    expect(codes(check(doc([cleanLine(), bad])))).toEqual([]);
  });

  it('quá nhiều lớp là cảnh báo kèm số lớp thật', () => {
    const shapes = Array.from({ length: 13 }, (_, index) => stroke(parsePathData(`M 4 ${4 + index} L 20 ${4 + index}`)));
    const issue = check(doc(shapes)).find((item) => item.code === 'TOO_MANY_SHAPES');
    expect(issue?.severity).toBe('warning');
    expect(issue?.message).toContain('13');
    expect(codes(check(doc(shapes.slice(0, 12))))).not.toContain('TOO_MANY_SHAPES');
  });

  it('nhiều độ dày nét khác nhau là gợi ý MIXED_STROKE; chỉ tính lớp có nét', () => {
    const mixed = check(doc([cleanLine(), cleanLine({ strokeWidth: 2 })]));
    expect(mixed.find((item) => item.code === 'MIXED_STROKE')).toMatchObject({ severity: 'info' });
    const fillOnly = createShape({ type: 'ellipse', cx: 12, cy: 12, rx: 2, ry: 2 }, { stroke: 'none', fill: 'brand:sapphire', strokeWidth: 4 });
    expect(codes(check(doc([cleanLine(), fillOnly])))).not.toContain('MIXED_STROKE');
  });

  it('độ dày nét ngoài bộ cho phép là cảnh báo STROKE_WIDTH gắn đúng lớp; sai số nhỏ vẫn chấp nhận', () => {
    const bad = cleanLine({ strokeWidth: 1.6, name: 'Nét lệch' });
    const issue = check(doc([bad])).find((item) => item.code === 'STROKE_WIDTH');
    expect(issue).toMatchObject({ severity: 'warning', shapeId: bad.id });
    expect(issue?.message).toContain('Nét lệch');
    for (const width of [1.5, 1.75, 2, 1.755, 1.745]) expect(codes(check(doc([cleanLine({ strokeWidth: width })])))).not.toContain('STROKE_WIDTH');
  });

  it('lớp không có nét không bị kiểm tra độ dày nét', () => {
    const filled = createShape({ type: 'rect', x: 4, y: 4, width: 8, height: 8, rx: 0 }, { stroke: 'none', fill: 'brand:sapphire', strokeWidth: 5 });
    expect(codes(check(doc([filled])))).toEqual([]);
  });

  it('chạm hoặc vượt vùng an toàn là cảnh báo SAFE_AREA (tính cả nửa độ dày nét)', () => {
    // rect x = 1,125 + nửa nét 0,875 => mép ngoài đúng 0,25 = mức chừa: đạt
    const edge = stroke({ type: 'rect', x: 1.125, y: 1.125, width: 21.75, height: 21.75, rx: 0 });
    expect(codes(check(doc([edge])))).not.toContain('SAFE_AREA');
    const outside = stroke({ type: 'rect', x: 1, y: 1, width: 22, height: 22, rx: 0 });
    expect(codes(check(doc([outside])))).toContain('SAFE_AREA');
    for (const line of ['M 0 12 L 10 12', 'M 12 0 L 12 10', 'M 14 12 L 24 12', 'M 12 14 L 12 24']) {
      expect(codes(check(doc([stroke(parsePathData(line))])))).toContain('SAFE_AREA');
    }
  });

  it('vùng an toàn theo cạnh lưới của icon', () => {
    const wide = stroke(parsePathData('M 30 12 L 40 12'));
    expect(codes(check(doc([wide], { size: 48 })))).not.toContain('SAFE_AREA');
    expect(codes(check(doc([wide], { size: 24 })))).toContain('SAFE_AREA');
  });

  it('chi tiết quá nhỏ ở cả hai chiều là cảnh báo MIN_FEATURE; đường dài mảnh thì không', () => {
    const tiny = createShape({ type: 'ellipse', cx: 12, cy: 12, rx: 0.25, ry: 0.25 }, { stroke: 'none', fill: 'brand:sapphire' });
    expect(codes(check(doc([tiny])))).toContain('MIN_FEATURE');
    const thin = stroke(parsePathData('M 12 4 L 12 20'));
    expect(codes(check(doc([thin])))).not.toContain('MIN_FEATURE');
    const dot = createShape({ type: 'ellipse', cx: 12, cy: 12, rx: 0.5, ry: 0.5 }, { stroke: 'none', fill: 'brand:sapphire' });
    expect(codes(check(doc([dot])))).not.toContain('MIN_FEATURE');
  });

  it('toạ độ lệch lưới là gợi ý OFF_GRID kèm số lượng; toạ độ trên lưới thì không', () => {
    const off = stroke(parsePathData('M 4.3 12 L 20 12.2'));
    const issue = check(doc([off])).find((item) => item.code === 'OFF_GRID');
    expect(issue).toMatchObject({ severity: 'info', shapeId: off.id });
    expect(issue?.message).toContain('2');
    expect(issue?.message).toContain('0,5');
    expect(codes(check(doc([stroke(parsePathData('M 4.5 12 L 20 12.5'))])))).not.toContain('OFF_GRID');
  });

  it('OFF_GRID tính cả thông số của rect và elip', () => {
    const rect = stroke({ type: 'rect', x: 4, y: 4, width: 8.3, height: 8, rx: 0 });
    expect(codes(check(doc([rect])))).toContain('OFF_GRID');
    const circle = stroke({ type: 'ellipse', cx: 12, cy: 12, rx: 3.25, ry: 3.25 });
    expect(codes(check(doc([circle])))).toContain('OFF_GRID');
  });

  it('bước lưới tuỳ chỉnh', () => {
    const rules = { ...DEFAULT_RULES, snapStep: 0.25 };
    const shape = stroke(parsePathData('M 4.25 12 L 20 12'));
    expect(codes(check(doc([shape]), rules))).not.toContain('OFF_GRID');
    expect(codes(check(doc([shape])))).toContain('OFF_GRID');
  });

  it('màu ngoài bảng màu là cảnh báo PALETTE; none, currentColor, khoá có trong bảng và hex trùng bảng thì đạt', () => {
    expect(codes(check(doc([cleanLine({ stroke: '#123456' })])))).toContain('PALETTE');
    expect(codes(check(doc([cleanLine({ stroke: 'brand:khong-co' })])))).toContain('PALETTE');
    expect(codes(check(doc([cleanLine({ fill: '#123456' })])))).toContain('PALETTE');
    expect(codes(check(doc([cleanLine({ stroke: 'currentColor' })])))).not.toContain('PALETTE');
    expect(codes(check(doc([cleanLine({ stroke: 'brand:emerald', fill: 'none' })])))).not.toContain('PALETTE');
    expect(codes(check(doc([cleanLine({ stroke: '#2563EB' })])))).not.toContain('PALETTE');
    expect(codes(check(doc([cleanLine({ stroke: '#2563eb', fill: '#10b981' })])))).not.toContain('PALETTE');
  });

  it('tắt requirePaletteColors thì không kiểm tra màu', () => {
    const rules = { ...DEFAULT_RULES, requirePaletteColors: false };
    expect(codes(check(doc([cleanLine({ stroke: '#123456' })]), rules))).toEqual([]);
  });

  it('kết quả xếp theo mức độ: lỗi, cảnh báo, rồi gợi ý', () => {
    const messy = doc(
      [cleanLine({ strokeWidth: 1.6 }), cleanLine({ strokeWidth: 2, stroke: '#123456' }), stroke(parsePathData('M 4.3 12 L 20 12'))],
      { name: ' ' },
    );
    const issues = check(messy);
    const rank = { error: 0, warning: 1, info: 2 } as const;
    const ranks = issues.map((item) => rank[item.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(issues[0].severity).toBe('error');
    expect(issues[issues.length - 1].severity).toBe('info');
  });

  it('quy chuẩn tuỳ chỉnh về độ dày nét và số lớp', () => {
    const rules: BrandRules = { ...DEFAULT_RULES, allowedStrokeWidths: [3], maxShapes: 1 };
    const shapes = [cleanLine({ strokeWidth: 3 }), stroke(parsePathData('M 4 8 L 20 8'), { strokeWidth: 3 })];
    expect(codes(check(doc(shapes), rules))).toEqual(['TOO_MANY_SHAPES']);
    expect(codes(check(doc([cleanLine()]), rules))).toContain('STROKE_WIDTH');
  });

  it('toàn bộ icon mẫu không có lỗi cấp error và không vượt vùng an toàn', () => {
    for (const preset of createPresetDocuments()) {
      const issues = check(preset);
      expect([preset.id, issues.filter((item) => item.severity === 'error')]).toEqual([preset.id, []]);
      expect([preset.id, codes(issues).includes('SAFE_AREA')]).toEqual([preset.id, false]);
    }
  });

  it('không sửa tài liệu đầu vào', () => {
    const input = doc([cleanLine({ strokeWidth: 1.6 })]);
    const snapshot = JSON.stringify(input);
    check(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('normalizeRules', () => {
  it('đầu vào lạ trả về quy chuẩn mặc định', () => {
    for (const value of [null, undefined, 5, 'x']) expect(normalizeRules(value)).toBe(DEFAULT_RULES);
    expect(normalizeRules({})).toEqual(DEFAULT_RULES);
  });

  it('độ dày nét cho phép: lọc số hợp lệ 0,25..6, bỏ trùng, sắp tăng dần, tối đa 10', () => {
    expect(normalizeRules({ allowedStrokeWidths: [2, 1.5, 2, 'x', 0.1, 7, Number.NaN, Infinity, 3] }).allowedStrokeWidths).toEqual([1.5, 2, 3]);
    expect(normalizeRules({ allowedStrokeWidths: Array.from({ length: 20 }, (_, index) => 0.25 + index * 0.25) }).allowedStrokeWidths).toHaveLength(10);
    expect(normalizeRules({ allowedStrokeWidths: [] }).allowedStrokeWidths).toEqual(DEFAULT_RULES.allowedStrokeWidths);
    expect(normalizeRules({ allowedStrokeWidths: [100] }).allowedStrokeWidths).toEqual(DEFAULT_RULES.allowedStrokeWidths);
    expect(normalizeRules({ allowedStrokeWidths: 'x' }).allowedStrokeWidths).toEqual(DEFAULT_RULES.allowedStrokeWidths);
  });

  it('kẹp các số vào khoảng cho phép và thay số lỗi bằng mặc định', () => {
    expect(normalizeRules({ safePadding: 99 }).safePadding).toBe(6);
    expect(normalizeRules({ safePadding: -1 }).safePadding).toBe(0);
    expect(normalizeRules({ snapStep: 0 }).snapStep).toBe(0.05);
    expect(normalizeRules({ snapStep: 100 }).snapStep).toBe(4);
    expect(normalizeRules({ minFeature: 'x' }).minFeature).toBe(DEFAULT_RULES.minFeature);
    expect(normalizeRules({ safePadding: Number.NaN }).safePadding).toBe(DEFAULT_RULES.safePadding);
    expect(normalizeRules({ maxShapes: 0 }).maxShapes).toBe(1);
    expect(normalizeRules({ maxShapes: 999 }).maxShapes).toBe(100);
    expect(normalizeRules({ maxShapes: 7.6 }).maxShapes).toBe(8);
  });

  it('requirePaletteColors chỉ tắt khi đúng là false', () => {
    expect(normalizeRules({ requirePaletteColors: false }).requirePaletteColors).toBe(false);
    expect(normalizeRules({ requirePaletteColors: 0 }).requirePaletteColors).toBe(true);
    expect(normalizeRules({ requirePaletteColors: 'false' }).requirePaletteColors).toBe(true);
    expect(normalizeRules({}).requirePaletteColors).toBe(true);
  });

  it('quy chuẩn đã chuẩn hoá chuẩn hoá lần nữa không đổi', () => {
    const once = normalizeRules({ allowedStrokeWidths: [2, 1], safePadding: 1, snapStep: 0.25, minFeature: 1, maxShapes: 5, requirePaletteColors: false });
    expect(normalizeRules(once)).toEqual(once);
  });
});
