import { checkCompliance, DEFAULT_RULES } from './compliance';
import {
  colorAtOffset,
  defaultGradientFrom,
  formatGradient,
  gradientAxis,
  isGradientPaint,
  mixHex,
  normalizeGradientPaint,
  paintBrandKeys,
  paintColors,
  parseGradient,
} from './gradient';
import { createDocument, createShape } from './model';
import { DEFAULT_PALETTE } from './palette';
import { buildIconModel, defsNode, generateReactComponent, generateSprite, generateSvg } from './render';
import { normalizeDocument, normalizeShape } from './validate';

const GRADIENT = 'linear:45:#4cc3ff@0,#0493f9@0.55,#0263c9@1';

const rect = (fill: string, extra: Parameters<typeof createShape>[1] = {}) =>
  createShape({ type: 'rect', x: 2, y: 2, width: 20, height: 20, rx: 4 }, { fill, stroke: 'none', ...extra });

describe('paint gradient', () => {
  it('formatGradient và parseGradient đi hai chiều, chuẩn hoá màu và sắp điểm tăng dần', () => {
    expect(formatGradient(45, [{ color: '#4CC3FF', offset: 0 }, { color: '#0263C9', offset: 1 }])).toBe('linear:45:#4cc3ff@0,#0263c9@1');
    expect(parseGradient(GRADIENT)).toEqual({
      angle: 45,
      stops: [
        { color: '#4cc3ff', offset: 0 },
        { color: '#0493f9', offset: 0.55 },
        { color: '#0263c9', offset: 1 },
      ],
    });
    expect(formatGradient(0, [{ color: '#000', offset: 1 }, { color: 'brand:sapphire', offset: 0.2 }])).toBe('linear:0:brand:sapphire@0.2,#000000@1');
  });

  it('góc được đưa về 0..360; vị trí được kẹp 0..1', () => {
    expect(parseGradient('linear:-90:#ffffff@0,#000000@1')?.angle).toBe(270);
    expect(parseGradient('linear:450:#ffffff@0,#000000@1')?.angle).toBe(90);
    expect(parseGradient('linear:359.999:#ffffff@0,#000000@1')?.angle).toBe(0);
    expect(parseGradient('linear:0:#ffffff@-1,#000000@7')?.stops.map((stop) => stop.offset)).toEqual([0, 1]);
  });

  it('từ chối chuỗi sai: thiếu góc, dưới 2 hoặc trên 8 điểm, màu sai, vị trí không phải số', () => {
    const many = Array.from({ length: 9 }, (_, index) => `#ffffff@${index / 10}`).join(',');
    for (const bad of [
      'linear:#ffffff@0,#000000@1',
      'linear:abc:#ffffff@0,#000000@1',
      'linear:45:#ffffff@0',
      `linear:45:${many}`,
      'linear:45:red@0,#000000@1',
      'linear:45:#ffffff@x,#000000@1',
      'linear:45:#ffffff,#000000',
      'linear:45:currentColor@0,#000000@1',
      'linear:45:brand:BAD KEY@0,#000000@1',
      'linear:',
      '#ffffff',
    ]) {
      expect(parseGradient(bad)).toBeNull();
    }
    expect(formatGradient(45, [{ color: '#ffffff', offset: 0 }])).toBeNull();
    expect(formatGradient(45, [{ color: 'rác', offset: 0 }, { color: '#ffffff', offset: 1 }])).toBeNull();
  });

  it('isGradientPaint và normalizeGradientPaint', () => {
    expect(isGradientPaint(GRADIENT)).toBe(true);
    expect(isGradientPaint('#ffffff')).toBe(false);
    expect(isGradientPaint('brand:linear')).toBe(false);
    expect(normalizeGradientPaint('linear:45:#ABC@0,#DEF@1')).toBe('linear:45:#aabbcc@0,#ddeeff@1');
    expect(normalizeGradientPaint('linear:45:#ABC@0')).toBeNull();
  });

  it('gradientAxis: 45 độ đi đúng đường chéo của khung', () => {
    expect(gradientAxis(45, 24)).toEqual({ x1: 0, y1: 0, x2: 24, y2: 24 });
    expect(gradientAxis(0, 24)).toEqual({ x1: 0, y1: 12, x2: 24, y2: 12 });
    expect(gradientAxis(90, 48)).toEqual({ x1: 24, y1: 0, x2: 24, y2: 48 });
    expect(gradientAxis(225, 24)).toEqual({ x1: 24, y1: 24, x2: 0, y2: 0 });
  });

  it('paintColors và paintBrandKeys gom màu của cả điểm màu gradient', () => {
    const paint = 'linear:0:brand:sapphire@0,#112233@0.5,brand:navy@1';
    expect(paintColors(paint)).toEqual(['brand:sapphire', '#112233', 'brand:navy']);
    expect(paintBrandKeys(paint)).toEqual(['sapphire', 'navy']);
    expect(paintBrandKeys('brand:amber')).toEqual(['amber']);
    expect(paintColors('none')).toEqual([]);
    expect(paintColors('currentColor')).toEqual([]);
    expect(paintBrandKeys('#ffffff')).toEqual([]);
  });

  it('mixHex, colorAtOffset và defaultGradientFrom', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#102030', '#102030', 1)).toBe('#102030');
    const stops = [{ color: '#000000', offset: 0.2 }, { color: '#ffffff', offset: 0.6 }];
    expect(colorAtOffset(stops, 0)).toBe('#000000');
    expect(colorAtOffset(stops, 0.4)).toBe('#808080');
    expect(colorAtOffset(stops, 1)).toBe('#ffffff');
    expect(colorAtOffset([], 0.5)).toBe('#000000');
    const made = parseGradient(defaultGradientFrom('#2563eb'));
    expect(made?.angle).toBe(45);
    expect(made?.stops[0]).toEqual({ color: '#2563eb', offset: 0 });
    expect(made?.stops[1].color).not.toBe('#2563eb');
    expect(parseGradient(defaultGradientFrom('rác', '#ffffff'))?.stops.map((stop) => stop.color)).toEqual(['#2563eb', '#ffffff']);
  });
});

describe('gradient trong validate', () => {
  it('normalizeShape giữ gradient hợp lệ (đã chuẩn hoá) cho tô và nét', () => {
    const shape = normalizeShape({ ...rect('linear:45:#ABC@0,#DEF@1'), stroke: GRADIENT });
    expect(shape?.fill).toBe('linear:45:#aabbcc@0,#ddeeff@1');
    expect(shape?.stroke).toBe(GRADIENT);
  });

  it('gradient hỏng quay về giá trị mặc định của trường', () => {
    const shape = normalizeShape({ ...rect('linear:45:#ffffff@0'), stroke: 'linear:zzz' });
    expect(shape?.fill).toBe('none');
    expect(shape?.stroke).toBe('currentColor');
  });

  it('normalizeDocument giữ gradient qua vòng lưu và nạp lại', () => {
    const doc = createDocument({ name: 'Nền', shapes: [rect(GRADIENT)] });
    const again = normalizeDocument(JSON.parse(JSON.stringify(doc)));
    expect(again?.shapes[0].fill).toBe(GRADIENT);
  });
});

describe('gradient trong compliance', () => {
  const doc = (fill: string) => createDocument({ name: 'Icon', shapes: [rect(fill)] });
  const paletteIssue = (fill: string) => checkCompliance(doc(fill), DEFAULT_PALETTE, DEFAULT_RULES).some((issue) => issue.code === 'PALETTE');

  it('gradient toàn màu trong bảng thì đạt; có một điểm màu ngoài bảng thì cảnh báo', () => {
    expect(paletteIssue('linear:45:brand:sapphire@0,#09192e@1')).toBe(false);
    expect(paletteIssue('linear:45:brand:sapphire@0,#123456@1')).toBe(true);
    expect(paletteIssue('linear:45:brand:khong-co@0,brand:navy@1')).toBe(true);
  });

  it('chuỗi gradient hỏng bị coi là ngoài bảng màu', () => {
    expect(paletteIssue('linear:hỏng')).toBe(true);
  });
});

describe('gradient trong render', () => {
  const doc = createDocument({ name: 'Báo cáo', shapes: [rect(GRADIENT)] });

  it('chế độ brand: tô bằng url tới linearGradient trải trên cả khung', () => {
    const model = buildIconModel(doc, { colorMode: 'brand' });
    expect(model.defs).toHaveLength(1);
    const gradient = model.defs[0];
    expect(gradient.tag).toBe('linearGradient');
    expect(gradient.attrs).toMatchObject({ gradientUnits: 'userSpaceOnUse', x1: '0', y1: '0', x2: '24', y2: '24' });
    expect(gradient.children?.map((stop) => stop.attrs)).toEqual([
      { offset: '0', 'stop-color': '#4cc3ff' },
      { offset: '0.55', 'stop-color': '#0493f9' },
      { offset: '1', 'stop-color': '#0263c9' },
    ]);
    expect(model.children[0].attrs.fill).toBe(`url(#${gradient.attrs.id})`);
    expect(defsNode(model)?.tag).toBe('defs');
  });

  it('chế độ currentColor: gradient thành currentColor, không sinh defs', () => {
    const model = buildIconModel(doc, { colorMode: 'currentColor' });
    expect(model.defs).toEqual([]);
    expect(defsNode(model)).toBeNull();
    expect(model.children[0].attrs.fill).toBe('currentColor');
  });

  it('điểm màu theo bảng màu thương hiệu được đổi ra hex; khoá lạ ra đen', () => {
    const branded = createDocument({ name: 'Nền', shapes: [rect('linear:0:brand:sapphire@0,brand:khong-co@1')] });
    const stops = buildIconModel(branded, { colorMode: 'brand', palette: DEFAULT_PALETTE }).defs[0].children?.map((stop) => stop.attrs['stop-color']);
    expect(stops).toEqual(['#2563eb', '#000000']);
  });

  it('hai lớp cùng gradient dùng chung một dải; khác gradient hoặc khác cỡ lưới thì mã khác', () => {
    const twin = createDocument({ name: 'Đôi', shapes: [rect(GRADIENT), rect(GRADIENT, { stroke: GRADIENT, strokeWidth: 1.5 })] });
    const shared = buildIconModel(twin, { colorMode: 'brand' });
    expect(shared.defs).toHaveLength(1);
    expect(shared.rootAttrs.stroke).toBe(`url(#${shared.defs[0].attrs.id})`);

    const other = buildIconModel(createDocument({ name: 'Khác', shapes: [rect('linear:0:#ffffff@0,#000000@1')] }), { colorMode: 'brand' });
    const bigger = buildIconModel(createDocument({ name: 'Lớn', size: 48, shapes: [rect(GRADIENT)] }), { colorMode: 'brand' });
    const ids = [shared.defs[0], other.defs[0], bigger.defs[0]].map((node) => node.attrs.id);
    expect(new Set(ids).size).toBe(3);
    expect(bigger.defs[0].attrs).toMatchObject({ x2: '48', y2: '48' });
  });

  it('gradient hỏng rơi về currentColor thay vì ra url mồ côi', () => {
    const broken = createDocument({ name: 'Hỏng', shapes: [rect('linear:hỏng')] });
    const model = buildIconModel(broken, { colorMode: 'brand' });
    expect(model.defs).toEqual([]);
    expect(model.children[0].attrs.fill).toBe('currentColor');
  });

  it('SVG xuất có <defs> đứng trước lớp hình và url trỏ đúng mã', () => {
    const svg = generateSvg(doc, { colorMode: 'brand' });
    const id = /<linearGradient id="([^"]+)"/.exec(svg)?.[1];
    expect(id).toBeTruthy();
    expect(svg.indexOf('<defs>')).toBeLessThan(svg.indexOf('<rect'));
    expect(svg).toContain(`fill="url(#${id})"`);
    expect(svg).toContain('<stop offset="0.55" stop-color="#0493f9" />');
    expect(generateSvg(doc)).not.toContain('<defs>');
  });

  it('component React dùng tên thuộc tính camelCase cho dải màu', () => {
    const tsx = generateReactComponent(doc, { colorMode: 'brand' });
    expect(tsx).toContain('gradientUnits="userSpaceOnUse"');
    expect(tsx).toContain('stopColor="#4cc3ff"');
    expect(tsx).not.toContain('stop-color');
  });

  it('sprite: mã dải màu của mỗi symbol mang tiền tố symbol nên không đụng nhau', () => {
    const second = createDocument({ name: 'Hai', shapes: [rect(GRADIENT)] });
    const sprite = generateSprite([doc, second], { colorMode: 'brand' });
    const ids = [...sprite.matchAll(/<linearGradient id="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0].startsWith('svndts-bao-cao-grad-')).toBe(true);
    expect(ids[1].startsWith('svndts-hai-grad-')).toBe(true);
  });
});
