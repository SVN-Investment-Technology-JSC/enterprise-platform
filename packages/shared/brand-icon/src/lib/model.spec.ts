import {
  CATEGORIES,
  CATEGORY_LABELS,
  DEFAULT_SHAPE_STYLE,
  DEFAULT_SIZE,
  DEFAULT_STROKE_WIDTH,
  ICON_SIZES,
  createDocument,
  createShape,
  defaultShapeName,
  findShape,
  isPaintNone,
  newId,
  roundTo,
  type Geometry,
} from './model';

describe('newId', () => {
  it('có tiền tố, ký tự hợp lệ, và không trùng trong 5000 lần gọi', () => {
    const generated = Array.from({ length: 5000 }, () => newId('shape'));
    expect(new Set(generated).size).toBe(5000);
    for (const id of generated.slice(0, 50)) expect(id).toMatch(/^shape-[a-z0-9]+$/);
    expect(newId()).toMatch(/^id-/);
    expect(newId('icon')).toMatch(/^icon-/);
  });

  it('khớp mẫu mã định danh mà bước chuẩn hoá chấp nhận (không bị đổi mã khi nạp lại)', () => {
    for (const prefix of ['shape', 'icon']) expect(newId(prefix)).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
  });
});

describe('createShape / defaultShapeName', () => {
  const rect: Geometry = { type: 'rect', x: 0, y: 0, width: 4, height: 4, rx: 0 };

  it('dùng kiểu mặc định: không tô, nét currentColor 1,75 tròn', () => {
    const shape = createShape(rect);
    expect(shape).toMatchObject({ ...DEFAULT_SHAPE_STYLE, geometry: rect, name: 'Chữ nhật' });
    expect(shape.id).toMatch(/^shape-/);
    expect(shape.strokeWidth).toBe(DEFAULT_STROKE_WIDTH);
  });

  it('ghi đè kiểu và tên', () => {
    const shape = createShape(rect, { fill: 'brand:sapphire', stroke: 'none', name: 'Tên riêng', id: 'co-dinh' });
    expect(shape).toMatchObject({ fill: 'brand:sapphire', stroke: 'none', name: 'Tên riêng', id: 'co-dinh' });
  });

  it('mỗi lần tạo có mã khác nhau', () => {
    expect(createShape(rect).id).not.toBe(createShape(rect).id);
  });

  it('tên mặc định theo loại hình', () => {
    expect(defaultShapeName(rect)).toBe('Chữ nhật');
    expect(defaultShapeName({ type: 'ellipse', cx: 0, cy: 0, rx: 3, ry: 3 })).toBe('Hình tròn');
    expect(defaultShapeName({ type: 'ellipse', cx: 0, cy: 0, rx: 3, ry: 2 })).toBe('Elip');
    expect(defaultShapeName({ type: 'path', subpaths: [] })).toBe('Đường');
  });
});

describe('createDocument', () => {
  it('giá trị mặc định', () => {
    const doc = createDocument();
    expect(doc).toMatchObject({
      schema: 1,
      name: 'Icon mới',
      description: '',
      category: 'custom',
      tags: [],
      status: 'draft',
      size: DEFAULT_SIZE,
      shapes: [],
    });
    expect(doc.id).toMatch(/^icon-/);
    expect(doc.createdAt).toBe(doc.updatedAt);
    expect(Number.isNaN(Date.parse(doc.createdAt))).toBe(false);
  });

  it('ghi đè được từng trường', () => {
    const doc = createDocument({ name: 'X', size: 32, id: 'abc', status: 'published' });
    expect(doc).toMatchObject({ name: 'X', size: 32, id: 'abc', status: 'published' });
  });

  it('hai tài liệu có mã khác nhau', () => {
    expect(createDocument().id).not.toBe(createDocument().id);
  });
});

describe('hằng số và tiện ích', () => {
  it('cỡ lưới, loại icon và nhãn tiếng Việt', () => {
    expect(DEFAULT_SIZE).toBe(24);
    expect(ICON_SIZES).toContain(DEFAULT_SIZE);
    expect([...ICON_SIZES]).toEqual([...ICON_SIZES].sort((a, b) => a - b));
    expect(CATEGORIES).toEqual(['brand', 'module', 'system', 'custom']);
    for (const category of CATEGORIES) expect(CATEGORY_LABELS[category].length).toBeGreaterThan(0);
  });

  it('roundTo mặc định 3 chữ số', () => {
    expect(roundTo(1.23456)).toBe(1.235);
    expect(roundTo(1.23456, 1)).toBe(1.2);
    expect(roundTo(-2.5, 0)).toBe(-2);
    expect(roundTo(5)).toBe(5);
  });

  it('isPaintNone', () => {
    expect(isPaintNone('none')).toBe(true);
    expect(isPaintNone('')).toBe(true);
    expect(isPaintNone('currentColor')).toBe(false);
    expect(isPaintNone('#000000')).toBe(false);
    expect(isPaintNone('brand:sapphire')).toBe(false);
  });

  it('findShape tìm theo mã', () => {
    const shape = createShape({ type: 'rect', x: 0, y: 0, width: 1, height: 1, rx: 0 }, { id: 'tim-thay' });
    const doc = createDocument({ shapes: [shape] });
    expect(findShape(doc, 'tim-thay')).toBe(shape);
    expect(findShape(doc, 'khong-co')).toBeUndefined();
  });
});
