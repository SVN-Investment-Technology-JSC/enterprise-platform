import { LEGACY_PRESETS } from './legacy-data.js';
import { createPresetDocuments } from './legacy.js';
import { createDocument, createShape, type IconDocument, type IconShape } from './model.js';
import { parsePathData } from './path-data.js';
import { LIMITS, normalizeDocument, normalizeLibrary, normalizeShape, parseLibraryJson } from './validate.js';

const rectShape = (overrides: Record<string, unknown> = {}) => ({
  id: 'shape-1',
  name: 'Hình 1',
  geometry: { type: 'rect', x: 2, y: 2, width: 8, height: 8, rx: 1 },
  fill: 'none',
  fillOpacity: 1,
  stroke: 'currentColor',
  strokeWidth: 1.75,
  opacity: 1,
  linecap: 'round',
  linejoin: 'round',
  fillRule: 'nonzero',
  hidden: false,
  locked: false,
  ...overrides,
});

const rawDoc = (overrides: Record<string, unknown> = {}) => ({
  schema: 1,
  id: 'icon-1',
  name: 'Icon thử',
  description: 'mô tả',
  category: 'custom',
  tags: ['a'],
  status: 'draft',
  size: 24,
  shapes: [rectShape()],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  ...overrides,
});

const pathShape = (subpaths: unknown) => rectShape({ geometry: { type: 'path', subpaths } });
const nodes = (count: number) => Array.from({ length: count }, (_, index) => ({ x: index % 100, y: Math.floor(index / 100) }));

describe('normalizeShape', () => {
  it('giữ nguyên lớp hợp lệ', () => {
    expect(normalizeShape(rectShape())).toEqual(rectShape());
  });

  it('từ chối giá trị không phải đối tượng hoặc hình học lạ', () => {
    for (const value of [null, undefined, 5, 'x', []]) expect(normalizeShape(value)).toBeNull();
    expect(normalizeShape(rectShape({ geometry: null }))).toBeNull();
    expect(normalizeShape(rectShape({ geometry: { type: 'polygon' } }))).toBeNull();
    expect(normalizeShape(rectShape({ geometry: 'M 0 0' }))).toBeNull();
  });

  it('điền mặc định khi thiếu trường', () => {
    const shape = normalizeShape({ geometry: { type: 'ellipse', cx: 12, cy: 12, rx: 4, ry: 4 } }) as IconShape;
    expect(shape).toMatchObject({
      name: 'Hình',
      fill: 'none',
      fillOpacity: 1,
      stroke: 'currentColor',
      strokeWidth: 1.75,
      opacity: 1,
      linecap: 'round',
      linejoin: 'round',
      fillRule: 'nonzero',
      hidden: false,
      locked: false,
    });
    expect(shape.id).toMatch(/^shape-/);
  });

  it('kẹp số về giới hạn và thay số lỗi bằng mặc định', () => {
    const clamped = normalizeShape(rectShape({ strokeWidth: 99, opacity: 5, fillOpacity: -2 })) as IconShape;
    expect(clamped).toMatchObject({ strokeWidth: 6, opacity: 1, fillOpacity: 0 });
    const small = normalizeShape(rectShape({ strokeWidth: 0 })) as IconShape;
    expect(small.strokeWidth).toBe(0.25);
    const broken = normalizeShape(rectShape({ strokeWidth: Number.NaN, opacity: 'đậm', fillOpacity: Infinity })) as IconShape;
    expect(broken).toMatchObject({ strokeWidth: 1.75, opacity: 1, fillOpacity: 1 });
  });

  it('chỉ nhận giá trị liệt kê cho linecap, linejoin, fillRule', () => {
    const shape = normalizeShape(rectShape({ linecap: 'huge', linejoin: 'zigzag', fillRule: 'maybe' })) as IconShape;
    expect(shape).toMatchObject({ linecap: 'round', linejoin: 'round', fillRule: 'nonzero' });
    expect(normalizeShape(rectShape({ linecap: 'square', linejoin: 'bevel', fillRule: 'evenodd' }))).toMatchObject({
      linecap: 'square',
      linejoin: 'bevel',
      fillRule: 'evenodd',
    });
  });

  it('chỉ true mới bật hidden và locked', () => {
    expect(normalizeShape(rectShape({ hidden: 'true', locked: 1 }))).toMatchObject({ hidden: false, locked: false });
    expect(normalizeShape(rectShape({ hidden: true, locked: true }))).toMatchObject({ hidden: true, locked: true });
  });

  it('tên: bỏ ký tự điều khiển, cắt 40 ký tự, rỗng thì dùng "Hình"', () => {
    const control = String.fromCharCode(0, 7, 27);
    expect(normalizeShape(rectShape({ name: `A${control}B\nC` }))).toMatchObject({ name: 'ABC' });
    expect(normalizeShape(rectShape({ name: 'x'.repeat(100) }))).toMatchObject({ name: 'x'.repeat(40) });
    expect(normalizeShape(rectShape({ name: '   ' }))).toMatchObject({ name: 'Hình' });
    expect(normalizeShape(rectShape({ name: 42 }))).toMatchObject({ name: 'Hình' });
  });

  it('mã lớp sai định dạng được thay bằng mã mới', () => {
    for (const id of ['"><script>', 'a b', '', '-bad', 'x'.repeat(65), 5]) {
      const shape = normalizeShape(rectShape({ id })) as IconShape;
      expect(shape.id).toMatch(/^shape-[a-z0-9]+$/);
    }
    expect(normalizeShape(rectShape({ id: 'ok_id-1' }))).toMatchObject({ id: 'ok_id-1' });
  });
});

describe('chặn chèn thuộc tính qua màu', () => {
  const paint = (value: unknown, key: 'fill' | 'stroke' = 'fill') => (normalizeShape(rectShape({ [key]: value })) as IconShape)[key];

  it('nhận none, currentColor, brand:<khoá> và hex hợp lệ (chuẩn hoá về 6 chữ số thường)', () => {
    expect(paint('none')).toBe('none');
    expect(paint('currentColor')).toBe('currentColor');
    expect(paint('brand:sapphire')).toBe('brand:sapphire');
    expect(paint('brand:a-1')).toBe('brand:a-1');
    expect(paint('#FF8800')).toBe('#ff8800');
    expect(paint('#abc')).toBe('#aabbcc');
  });

  it('chuỗi có chứa dấu nháy, thẻ, script hay url(...) bị thay bằng giá trị an toàn mặc định', () => {
    const attacks = [
      'red" onload="alert(1)',
      '#fff" onload="x',
      'url(javascript:alert(1))',
      'url(#a)',
      '<script>',
      'brand:ok" x="y',
      'brand:Bad Key',
      'brand:',
      '#12',
      '#ggg',
      '#1234567',
      'rgb(0,0,0)',
      'CURRENTCOLOR',
      ' none',
      'red',
    ];
    for (const attack of attacks) {
      expect(paint(attack, 'fill')).toBe('none');
      expect(paint(attack, 'stroke')).toBe('currentColor');
    }
    expect(paint(5)).toBe('none');
    expect(paint(null, 'stroke')).toBe('currentColor');
  });

  it('khoá màu quá dài hoặc có ký tự hoa không hợp lệ', () => {
    expect(paint(`brand:${'a'.repeat(33)}`)).toBe('none');
    expect(paint('brand:Sapphire')).toBe('none');
  });
});

describe('giới hạn hình học', () => {
  const doc = (shape: unknown) => normalizeDocument(rawDoc({ shapes: [shape] }));

  it('toạ độ ngoài ±1000, NaN hoặc Infinity làm cả icon bị từ chối', () => {
    expect(doc(rectShape({ geometry: { type: 'rect', x: 1001, y: 0, width: 4, height: 4, rx: 0 } }))).toBeNull();
    expect(doc(rectShape({ geometry: { type: 'rect', x: 0, y: -1001, width: 4, height: 4, rx: 0 } }))).toBeNull();
    expect(doc(rectShape({ geometry: { type: 'rect', x: Number.NaN, y: 0, width: 4, height: 4, rx: 0 } }))).toBeNull();
    expect(doc(rectShape({ geometry: { type: 'rect', x: 0, y: 0, width: Infinity, height: 4, rx: 0 } }))).toBeNull();
    expect(doc(rectShape({ geometry: { type: 'rect', x: '3', y: 0, width: 4, height: 4, rx: 0 } }))).toBeNull();
    expect(doc(rectShape({ geometry: { type: 'rect', x: 1000, y: -1000, width: 4, height: 4, rx: 0 } }))).not.toBeNull();
  });

  it('chiều rộng/cao âm hoặc bán kính elip âm bị từ chối; bằng 0 thì chấp nhận', () => {
    expect(doc(rectShape({ geometry: { type: 'rect', x: 0, y: 0, width: -1, height: 4, rx: 0 } }))).toBeNull();
    expect(doc(rectShape({ geometry: { type: 'ellipse', cx: 0, cy: 0, rx: -1, ry: 1 } }))).toBeNull();
    expect(doc(rectShape({ geometry: { type: 'rect', x: 0, y: 0, width: 0, height: 4, rx: 0 } }))).not.toBeNull();
  });

  it('rx của rect được kẹp theo nửa cạnh ngắn, giá trị lỗi thành 0', () => {
    const clamp = normalizeShape(rectShape({ geometry: { type: 'rect', x: 0, y: 0, width: 10, height: 4, rx: 99 } })) as IconShape;
    expect(clamp.geometry).toMatchObject({ rx: 2 });
    const negative = normalizeShape(rectShape({ geometry: { type: 'rect', x: 0, y: 0, width: 10, height: 4, rx: -3 } })) as IconShape;
    expect(negative.geometry).toMatchObject({ rx: 0 });
    const broken = normalizeShape(rectShape({ geometry: { type: 'rect', x: 0, y: 0, width: 10, height: 4 } })) as IconShape;
    expect(broken.geometry).toMatchObject({ rx: 0 });
  });

  it('số đường con tối đa 64', () => {
    const subpath = { closed: false, nodes: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };
    expect(LIMITS.maxSubpaths).toBe(64);
    expect(doc(pathShape(Array.from({ length: 64 }, () => subpath)))).not.toBeNull();
    expect(doc(pathShape(Array.from({ length: 65 }, () => subpath)))).toBeNull();
  });

  it('tổng số điểm neo của một lớp tối đa 2000', () => {
    expect(LIMITS.maxNodes).toBe(2000);
    expect(doc(pathShape([{ closed: false, nodes: nodes(2000) }]))).not.toBeNull();
    expect(doc(pathShape([{ closed: false, nodes: nodes(2001) }]))).toBeNull();
    // đếm gộp qua các đường con
    expect(doc(pathShape([{ closed: false, nodes: nodes(1000) }, { closed: false, nodes: nodes(1001) }]))).toBeNull();
  });

  it('đường con hoặc điểm neo sai kiểu bị từ chối', () => {
    expect(doc(pathShape('M 0 0'))).toBeNull();
    expect(doc(pathShape([null]))).toBeNull();
    expect(doc(pathShape([{ closed: false }]))).toBeNull();
    expect(doc(pathShape([{ closed: false, nodes: [{ x: 0 }] }]))).toBeNull();
    expect(doc(pathShape([{ closed: false, nodes: [null] }]))).toBeNull();
  });

  it('tay cầm Bezier: cho phép vắng mặt, từ chối sai kiểu hoặc ngoài giới hạn', () => {
    const good = pathShape([{ closed: false, nodes: [{ x: 0, y: 0, hout: { x: 1, y: 1 } }, { x: 5, y: 5, hin: { x: 4, y: 4 }, hout: null }] }]);
    expect(doc(good)).not.toBeNull();
    expect(doc(pathShape([{ closed: false, nodes: [{ x: 0, y: 0, hout: 5 }] }]))).toBeNull();
    expect(doc(pathShape([{ closed: false, nodes: [{ x: 0, y: 0, hin: { x: 1 } }] }]))).toBeNull();
    expect(doc(pathShape([{ closed: false, nodes: [{ x: 0, y: 0, hout: { x: 5000, y: 0 } }] }]))).toBeNull();
  });

  it('chỉ true mới là đường đóng', () => {
    const shape = normalizeShape(pathShape([{ closed: 'true', nodes: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, { closed: true, nodes: [{ x: 0, y: 0 }] }])) as IconShape;
    expect(shape.geometry).toMatchObject({ subpaths: [{ closed: false }, { closed: true }] });
  });
});

describe('normalizeDocument', () => {
  it('giữ nguyên tài liệu hợp lệ', () => {
    expect(normalizeDocument(rawDoc())).toEqual(rawDoc());
  });

  it('từ chối đầu vào không phải đối tượng, thiếu mã, thiếu tên hay shapes không phải mảng', () => {
    for (const value of [null, undefined, 3, 'x', []]) expect(normalizeDocument(value)).toBeNull();
    expect(normalizeDocument(rawDoc({ id: undefined }))).toBeNull();
    expect(normalizeDocument(rawDoc({ name: '   ' }))).toBeNull();
    expect(normalizeDocument(rawDoc({ name: undefined }))).toBeNull();
    expect(normalizeDocument(rawDoc({ shapes: undefined }))).toBeNull();
    expect(normalizeDocument(rawDoc({ shapes: {} }))).toBeNull();
  });

  it('mã icon không hợp lệ bị từ chối (chống chèn vào tên file, id symbol, URL)', () => {
    for (const id of ['', 'a b', '../x', 'a/b', '-x', '_x', 'a"b', '<x>', 'x'.repeat(65), 5, null]) {
      expect(normalizeDocument(rawDoc({ id }))).toBeNull();
    }
    for (const id of ['a', 'Icon_1-b', 'x'.repeat(64), '9abc']) expect(normalizeDocument(rawDoc({ id }))).not.toBeNull();
  });

  it('tối đa 200 lớp mỗi icon', () => {
    const shapes = (count: number) => Array.from({ length: count }, (_, index) => rectShape({ id: `s${index}` }));
    expect(LIMITS.maxShapes).toBe(200);
    expect(normalizeDocument(rawDoc({ shapes: shapes(200) }))).not.toBeNull();
    expect(normalizeDocument(rawDoc({ shapes: shapes(201) }))).toBeNull();
  });

  it('một lớp hỏng làm cả icon bị từ chối thay vì lặng lẽ bỏ mất lớp', () => {
    expect(normalizeDocument(rawDoc({ shapes: [rectShape(), { geometry: { type: 'x' } }] }))).toBeNull();
  });

  it('mã lớp trùng được cấp lại để không đụng nhau', () => {
    const result = normalizeDocument(rawDoc({ shapes: [rectShape({ id: 'dup' }), rectShape({ id: 'dup' }), rectShape({ id: 'dup' })] })) as IconDocument;
    const ids = result.shapes.map((shape) => shape.id);
    expect(ids[0]).toBe('dup');
    expect(new Set(ids).size).toBe(3);
  });

  it('kích thước lưới: làm tròn và kẹp trong 8..128', () => {
    expect(normalizeDocument(rawDoc({ size: 1000 }))?.size).toBe(128);
    expect(normalizeDocument(rawDoc({ size: 3 }))?.size).toBe(8);
    expect(normalizeDocument(rawDoc({ size: 24.6 }))?.size).toBe(25);
    expect(normalizeDocument(rawDoc({ size: 'lớn' }))?.size).toBe(24);
    expect(normalizeDocument(rawDoc({ size: Number.NaN }))?.size).toBe(24);
  });

  it('tên 80 ký tự, mô tả 300 ký tự, bỏ ký tự điều khiển', () => {
    const doc = normalizeDocument(rawDoc({ name: 'n'.repeat(120), description: `${'d'.repeat(400)}` })) as IconDocument;
    expect(doc.name).toHaveLength(80);
    expect(doc.description).toHaveLength(300);
    const control = String.fromCharCode(0, 9, 10, 13, 127);
    expect(normalizeDocument(rawDoc({ name: `A${control}B` }))?.name).toBe('AB');
    expect(normalizeDocument(rawDoc({ description: 5 }))?.description).toBe('');
  });

  it('thẻ: bỏ trùng, bỏ rỗng, cắt 24 ký tự, tối đa 12 thẻ, bỏ giá trị không phải chuỗi', () => {
    const tags = ['a', 'a', ' b ', '', 5, null, 'x'.repeat(40), ...Array.from({ length: 20 }, (_, index) => `t${index}`)];
    const doc = normalizeDocument(rawDoc({ tags })) as IconDocument;
    expect(doc.tags).toHaveLength(LIMITS.maxTags);
    expect(doc.tags.slice(0, 3)).toEqual(['a', 'b', 'x'.repeat(24)]);
    expect(normalizeDocument(rawDoc({ tags: 'a,b' }))?.tags).toEqual([]);
  });

  it('loại và trạng thái lạ về mặc định', () => {
    expect(normalizeDocument(rawDoc({ category: 'khac', status: 'archived' }))).toMatchObject({ category: 'custom', status: 'draft' });
    expect(normalizeDocument(rawDoc({ category: 'brand', status: 'published' }))).toMatchObject({ category: 'brand', status: 'published' });
  });

  it('ngày không hợp lệ được thay bằng thời điểm hiện tại', () => {
    const doc = normalizeDocument(rawDoc({ createdAt: 'hôm qua', updatedAt: 5 })) as IconDocument;
    expect(Number.isNaN(Date.parse(doc.createdAt))).toBe(false);
    expect(Number.isNaN(Date.parse(doc.updatedAt))).toBe(false);
    expect(doc.createdAt).not.toBe('hôm qua');
  });

  it('không để dữ liệu thừa hay nguyên mẫu độc hại lọt vào kết quả', () => {
    const polluted = JSON.parse(
      '{"__proto__":{"polluted":true},"schema":1,"id":"icon-1","name":"x","shapes":[{"__proto__":{"polluted":true},"geometry":{"type":"ellipse","cx":1,"cy":1,"rx":1,"ry":1},"evil":"<script>"}],"extra":"gì đó"}',
    );
    const doc = normalizeDocument(polluted) as IconDocument;
    expect(doc).not.toBeNull();
    expect('extra' in doc).toBe(false);
    expect('evil' in doc.shapes[0]).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('không sửa đối tượng đầu vào', () => {
    const input = rawDoc({ tags: ['a', 'a'], shapes: [rectShape({ strokeWidth: 99 })] });
    const snapshot = JSON.stringify(input);
    normalizeDocument(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('tài liệu do chính thư viện tạo luôn qua chuẩn hoá nguyên vẹn', () => {
    const made = createDocument({
      name: 'Tự tạo',
      shapes: [createShape(parsePathData('M 2 2 C 4 2 6 4 8 8 L 3 9 Z'), { fill: 'brand:emerald', fillOpacity: 0.4 })],
    });
    expect(normalizeDocument(JSON.parse(JSON.stringify(made)))).toEqual(made);
  });

  it('toàn bộ icon mẫu qua chuẩn hoá không bị đổi', () => {
    for (const preset of createPresetDocuments()) expect(normalizeDocument(JSON.parse(JSON.stringify(preset)))).toEqual(preset);
  });
});

describe('icon kiểu cũ', () => {
  it('8 icon mẫu kiểu cũ đều được chuyển sang mô hình nhiều lớp', () => {
    expect(LEGACY_PRESETS).toHaveLength(8);
    for (const spec of LEGACY_PRESETS) {
      const doc = normalizeDocument(JSON.parse(JSON.stringify(spec))) as IconDocument;
      expect(doc).not.toBeNull();
      expect(doc.schema).toBe(1);
      expect(doc.id).toBe(spec.id);
      expect(doc.name).toBe(spec.name);
      expect(doc.category).toBe(spec.category);
      expect(doc.shapes.length).toBeGreaterThanOrEqual(2);
      expect(doc.status).toBe('published');
    }
  });

  it('icon tự tạo kiểu cũ thành bản nháp', () => {
    const doc = normalizeDocument({ ...LEGACY_PRESETS[0], id: 'tu-tao', isCustom: true }) as IconDocument;
    expect(doc.status).toBe('draft');
  });

  it('khung hình lạ hay thiếu trường bắt buộc thì bị từ chối, không ném lỗi', () => {
    expect(normalizeDocument({ ...LEGACY_PRESETS[0], containerShape: 'tam-giac' })).toBeNull();
    expect(normalizeDocument({ ...LEGACY_PRESETS[0], name: undefined })).toBeNull();
    expect(normalizeDocument({ ...LEGACY_PRESETS[0], id: undefined })).toBeNull();
  });

  it('mã icon kiểu cũ sai định dạng được cấp mã mới (không dùng lại mã độc hại)', () => {
    const doc = normalizeDocument({ ...LEGACY_PRESETS[0], id: '../x"y' }) as IconDocument;
    expect(doc.id).toMatch(/^icon-[a-z0-9]+$/);
  });

  it('nét vẽ chứa mã chèn bị bỏ, phần còn lại của icon vẫn dùng được', () => {
    const doc = normalizeDocument({ ...LEGACY_PRESETS[0], glyphPath: 'M 1 1" onload="alert(1)', secondaryPath: 'M 0 0 <script>' }) as IconDocument;
    expect(doc).not.toBeNull();
    expect(JSON.stringify(doc)).not.toContain('onload');
    expect(JSON.stringify(doc)).not.toContain('<script>');
  });

  it('màu nhận diện lạ rơi về currentColor thay vì làm hỏng thuộc tính', () => {
    const doc = normalizeDocument({ ...LEGACY_PRESETS[0], colorTone: 'x" onload="y' }) as IconDocument;
    expect(doc).not.toBeNull();
    for (const shape of doc.shapes) {
      expect(shape.stroke === 'currentColor' || shape.stroke === 'none').toBe(true);
      expect(shape.fill === 'currentColor' || shape.fill === 'none').toBe(true);
    }
  });

  it('chấp nhận icon kiểu cũ thiếu mô tả', () => {
    const { description: _description, ...rest } = LEGACY_PRESETS[0];
    void _description;
    expect(normalizeDocument(rest)?.description).toBe('');
  });

  it('chỉ nhận ra kiểu cũ khi không có mảng shapes', () => {
    const modern = normalizeDocument({ ...LEGACY_PRESETS[0], shapes: [rectShape()], schema: 1 }) as IconDocument;
    expect(modern.shapes).toHaveLength(1);
  });
});

describe('normalizeLibrary / parseLibraryJson', () => {
  it('nhận mảng thô hoặc đối tượng có khoá icons', () => {
    const docs = [rawDoc({ id: 'a' }), rawDoc({ id: 'b' })];
    expect(normalizeLibrary(docs).docs.map((doc) => doc.id)).toEqual(['a', 'b']);
    expect(normalizeLibrary({ icons: docs }).docs).toHaveLength(2);
  });

  it('ném lỗi khi không phải mảng', () => {
    for (const value of [null, undefined, 5, 'x', {}, { icons: 'x' }]) expect(() => normalizeLibrary(value)).toThrow(/mảng/);
  });

  it('bỏ mục sai định dạng và mục trùng mã (giữ mục đầu), đếm số mục bị bỏ', () => {
    const result = normalizeLibrary([rawDoc({ id: 'a', name: 'Đầu tiên' }), null, rawDoc({ id: 'a', name: 'Trùng' }), { id: 'x' }, rawDoc({ id: 'b' })]);
    expect(result.docs.map((doc) => doc.name)).toEqual(['Đầu tiên', 'Icon thử']);
    expect(result.skipped).toBe(3);
  });

  it('trộn icon kiểu cũ và kiểu mới', () => {
    const result = normalizeLibrary([LEGACY_PRESETS[0], rawDoc({ id: 'moi' })]);
    expect(result.docs.map((doc) => doc.id)).toEqual([LEGACY_PRESETS[0].id, 'moi']);
    expect(result.skipped).toBe(0);
  });

  it('chỉ đọc tối đa 500 icon, phần vượt được tính là bị bỏ', () => {
    const list = Array.from({ length: LIMITS.maxIcons + 7 }, (_, index) => rawDoc({ id: `i${index}` }));
    const result = normalizeLibrary(list);
    expect(result.docs).toHaveLength(LIMITS.maxIcons);
    expect(result.skipped).toBe(7);
  });

  it('parseLibraryJson: JSON hỏng thì ném lỗi tiếng Việt, JSON đúng thì chuẩn hoá', () => {
    expect(() => parseLibraryJson('{không phải json')).toThrow('File không phải JSON hợp lệ.');
    expect(() => parseLibraryJson('42')).toThrow(/mảng/);
    expect(parseLibraryJson(JSON.stringify([rawDoc({ id: 'a' })])).docs).toHaveLength(1);
    expect(parseLibraryJson(JSON.stringify({ icons: [rawDoc({ id: 'a' })] })).docs).toHaveLength(1);
  });

  it('khứ hồi: xuất thư viện rồi nạp lại cho đúng các icon ban đầu', () => {
    const presets = createPresetDocuments();
    const loaded = parseLibraryJson(JSON.stringify(presets));
    expect(loaded.skipped).toBe(0);
    expect(loaded.docs).toEqual(presets);
  });
});
