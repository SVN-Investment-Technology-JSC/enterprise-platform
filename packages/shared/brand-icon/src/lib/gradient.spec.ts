import { checkCompliance, DEFAULT_RULES } from './compliance';
import {
  colorAtOffset,
  defaultGradientFrom,
  formatGradient,
  formatGradientObject,
  gradientAxis,
  isGradientPaint,
  MAX_GRADIENT_STOPS,
  mixHex,
  normalizeGradientPaint,
  paintBrandKeys,
  paintColors,
  parseGradient,
  radialGridMatrix,
  withStops,
  type LinearGradient,
  type RadialGradient,
} from './gradient';
import { createDocument, createShape } from './model';
import { DEFAULT_PALETTE } from './palette';
import { buildIconModel, defsNode, generateReactComponent, generateSprite, generateSvg } from './render';
import { normalizeDocument, normalizeShape } from './validate';

const GRADIENT = 'linear:45:#4cc3ff@0,#0493f9@0.55,#0263c9@1';
const RADIAL = 'radial:0.5,0.5,0.5,0.5,0.5,1,0,0,1,0,0:#ffffff@0,#000000@1';

const linear = (paint: string) => parseGradient(paint) as LinearGradient;
const radial = (paint: string) => parseGradient(paint) as RadialGradient;

const rect = (fill: string, extra: Parameters<typeof createShape>[1] = {}) =>
  createShape({ type: 'rect', x: 2, y: 2, width: 20, height: 20, rx: 4 }, { fill, stroke: 'none', ...extra });

describe('paint gradient', () => {
  it('formatGradient và parseGradient đi hai chiều, chuẩn hoá màu và sắp điểm tăng dần', () => {
    expect(formatGradient(45, [{ color: '#4CC3FF', offset: 0 }, { color: '#0263C9', offset: 1 }])).toBe('linear:45:#4cc3ff@0,#0263c9@1');
    expect(parseGradient(GRADIENT)).toEqual({
      kind: 'linear',
      angle: 45,
      t0: 0,
      t1: 1,
      spread: 'pad',
      stops: [
        { color: '#4cc3ff', offset: 0 },
        { color: '#0493f9', offset: 0.55 },
        { color: '#0263c9', offset: 1 },
      ],
    });
    expect(formatGradient(0, [{ color: '#000', offset: 1 }, { color: 'brand:sapphire', offset: 0.2 }])).toBe('linear:0:brand:sapphire@0.2,#000000@1');
  });

  it('góc được đưa về 0..360; vị trí được kẹp 0..1', () => {
    expect(linear('linear:-90:#ffffff@0,#000000@1').angle).toBe(270);
    expect(linear('linear:450:#ffffff@0,#000000@1').angle).toBe(90);
    expect(linear('linear:359.999:#ffffff@0,#000000@1').angle).toBe(0);
    expect(parseGradient('linear:0:#ffffff@-1,#000000@7')?.stops.map((stop) => stop.offset)).toEqual([0, 1]);
  });

  it('từ chối chuỗi sai: thiếu góc, dưới 2 hoặc quá số điểm tối đa, màu sai, vị trí không phải số', () => {
    const many = Array.from({ length: MAX_GRADIENT_STOPS + 1 }, (_, index) => `#ffffff@${index / 100}`).join(',');
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
      'linear:45,0,1,wobble:#ffffff@0,#000000@1',
      'linear:45,0:#ffffff@0,#000000@1',
      'linear:45:#ffffff@0~x,#000000@1',
      'radial:0.5,0.5,0:#ffffff@0,#000000@1',
      'radial:0.5,0.5,0.5,0.5,0.5,1,0,0,1,0:#ffffff@0,#000000@1',
      'radial:0.5,0.5,-1,0.5,0.5,1,0,0,1,0,0:#ffffff@0,#000000@1',
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
    expect((made as LinearGradient).angle).toBe(45);
    expect(made?.stops[0]).toEqual({ color: '#2563eb', offset: 0 });
    expect(made?.stops[1].color).not.toBe('#2563eb');
    expect(parseGradient(defaultGradientFrom('rác', '#ffffff'))?.stops.map((stop) => stop.color)).toEqual(['#2563eb', '#ffffff']);
  });
});

describe('gradient mở rộng: hướng tâm, trải, độ đặc, trục lệch', () => {
  it('hướng tâm đi hai chiều và giữ ma trận, tiêu điểm, kiểu trải', () => {
    expect(radial(RADIAL)).toMatchObject({ kind: 'radial', cx: 0.5, cy: 0.5, r: 0.5, fx: 0.5, fy: 0.5, matrix: [1, 0, 0, 1, 0, 0], spread: 'pad' });
    const skewed = 'radial:0.3,0.4,0.25,0.35,0.45,0.0416667,0.001,-0.002,0.0416667,0.1,0.2,reflect:#ff0000@0,#0000ff@1';
    expect(normalizeGradientPaint(skewed)).toBe(skewed);
    expect(radial(skewed)).toMatchObject({ fx: 0.35, fy: 0.45, spread: 'reflect' });
    expect(radial(skewed).matrix[0]).toBeCloseTo(0.0416667, 7);
  });

  it('tuyến tính giữ t0, t1 và kiểu trải; mặc định (0, 1, pad) được lược khỏi chuỗi', () => {
    expect(formatGradientObject({ ...linear(GRADIENT), t0: 0.25, t1: 0.75, spread: 'repeat' })).toBe(
      'linear:45,0.25,0.75,repeat:#4cc3ff@0,#0493f9@0.55,#0263c9@1',
    );
    expect(linear('linear:45,0.25,0.75,repeat:#4cc3ff@0,#0263c9@1')).toMatchObject({ t0: 0.25, t1: 0.75, spread: 'repeat' });
    expect(normalizeGradientPaint('linear:45,0,1:#4cc3ff@0,#0263c9@1')).toBe('linear:45:#4cc3ff@0,#0263c9@1');
    expect(linear('linear:45,-2,3:#4cc3ff@0,#0263c9@1')).toMatchObject({ t0: -2, t1: 3 });
  });

  it('điểm màu giữ độ đặc (~), bỏ khi bằng 1, kẹp 0..1', () => {
    const paint = 'linear:0:#ffffff@0~0.5,#000000@1~1,#ff0000@1~2';
    expect(linear(paint).stops).toEqual([{ color: '#ffffff', offset: 0, opacity: 0.5 }, { color: '#000000', offset: 1 }, { color: '#ff0000', offset: 1 }]);
    expect(normalizeGradientPaint(paint)).toBe('linear:0:#ffffff@0~0.5,#000000@1,#ff0000@1');
  });

  it('nhận tối đa MAX_GRADIENT_STOPS điểm màu', () => {
    const stops = Array.from({ length: MAX_GRADIENT_STOPS }, (_, index) => ({ color: '#ffffff', offset: index / MAX_GRADIENT_STOPS }));
    expect(formatGradient(45, stops)).not.toBeNull();
    expect(formatGradient(45, [...stops, { color: '#000000', offset: 1 }])).toBeNull();
  });

  it('gradientAxis nhận t0, t1: đặt điểm màu đầu và cuối trên trục chuẩn', () => {
    expect(gradientAxis(0, 24, 0.25, 0.75)).toEqual({ x1: 6, y1: 12, x2: 18, y2: 12 });
    expect(gradientAxis(0, 24, -1, 2)).toEqual({ x1: -24, y1: 12, x2: 48, y2: 12 });
  });

  it('radialGridMatrix nhân ma trận tỷ lệ với cạnh lưới', () => {
    expect(radialGridMatrix([0.5, 0, 0, 0.25, 0.1, 0.2], 24)).toEqual([12, 0, 0, 6, 2.4, 4.8]);
  });

  it('withStops thay điểm màu và giữ nguyên phần còn lại', () => {
    const next = withStops(radial(RADIAL), [{ color: '#ff0000', offset: 0 }, { color: '#00ff00', offset: 1 }]);
    expect(next).toMatchObject({ kind: 'radial', r: 0.5 });
    expect(formatGradientObject(next)).toBe('radial:0.5,0.5,0.5,0.5,0.5,1,0,0,1,0,0:#ff0000@0,#00ff00@1');
  });

  it('paintColors và paintBrandKeys hiểu cả gradient hướng tâm', () => {
    expect(paintColors('radial:0.5,0.5,0.5,0.5,0.5,1,0,0,1,0,0:brand:sapphire@0,#000000@1')).toEqual(['brand:sapphire', '#000000']);
    expect(isGradientPaint(RADIAL)).toBe(true);
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
