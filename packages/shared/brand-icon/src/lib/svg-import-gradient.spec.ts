/**
 * @jest-environment jsdom
 */
import { MAX_GRADIENT_STOPS, parseGradient, type LinearGradient, type RadialGradient } from './gradient';
import { createDocument, type IconShape } from './model';
import { generateSvg } from './render';
import { importSvg } from './svg-import';
import { normalizeShape } from './validate';

const svg = (inner: string, attrs = 'viewBox="0 0 24 24"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;
const withDefs = (defs: string, shape: string) => svg(`<defs>${defs}</defs>${shape}`);
const documentFromShapes = (shapes: IconShape[]) => createDocument({ name: 'Nhập', shapes });
const linear = (paint: string) => parseGradient(paint) as LinearGradient;
const radial = (paint: string) => parseGradient(paint) as RadialGradient;

const STOPS = '<stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/>';
const FULL_RECT = '<rect width="24" height="24" fill="url(#g)"/>';

const BAO_CAO = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
<defs><linearGradient id="g-bao-cao" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4CC3FF"/><stop offset="0.55" stop-color="#0493F9"/><stop offset="1" stop-color="#0263C9"/></linearGradient></defs>
<rect width="48" height="48" rx="10" fill="url(#g-bao-cao)"/>
<g transform="translate(13 13) scale(0.9167)" fill="none" stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><path d="M14 3v6h6"></path><path d="M9 17v-3M12 17v-6M15 17v-2"></path></g>
</svg>`;

describe('importSvg: màu chuyển sắc', () => {
  it('mẫu bao-cao.svg: nền giữ nguyên dải màu chéo, glyph trắng vẫn là nét trắng', () => {
    const result = importSvg(BAO_CAO);
    const [background, ...glyph] = result.shapes;
    expect(background.fill).toBe('linear:45:#4cc3ff@0,#0493f9@0.55,#0263c9@1');
    expect(background.geometry).toMatchObject({ type: 'rect', width: 24, height: 24, rx: 5 });
    expect(glyph.length).toBeGreaterThan(0);
    for (const shape of glyph) expect(shape).toMatchObject({ stroke: '#ffffff', fill: 'none' });
    expect(result.warnings.some((warning) => warning.includes('chuyển sắc'))).toBe(false);
  });

  it('nhập rồi xuất SVG ở chế độ brand ra nền gradient, không còn một màu đơn', () => {
    const out = generateSvg(documentFromShapes(importSvg(BAO_CAO).shapes), { colorMode: 'brand' });
    expect(out).toContain('<linearGradient');
    expect(out).toContain('stop-color="#4cc3ff"');
    expect(out).toContain('stop-color="#0263c9"');
  });

  it('objectBoundingBox (mặc định): trải theo khung bao của lớp, hướng theo x1 y1 x2 y2', () => {
    const result = importSvg(withDefs(`<linearGradient id="g" x1="0" y1="0" x2="1" y2="0">${STOPS}</linearGradient>`, FULL_RECT));
    expect(result.shapes[0].fill).toBe('linear:0:#ff0000@0,#0000ff@1');
  });

  it('phần trăm và mặc định (x2 là 100%) cho dải ngang; dọc khi y2 là 100%', () => {
    const horizontal = importSvg(withDefs(`<linearGradient id="g">${STOPS}</linearGradient>`, FULL_RECT));
    expect(horizontal.shapes[0].fill).toBe('linear:0:#ff0000@0,#0000ff@1');
    const vertical = importSvg(
      withDefs(`<linearGradient id="g" x1="0%" y1="0%" x2="0%" y2="100%">${STOPS}</linearGradient>`, FULL_RECT),
    );
    expect(vertical.shapes[0].fill).toBe('linear:90:#ff0000@0,#0000ff@1');
  });

  it('userSpaceOnUse chỉ phủ một nửa khung: giữ nguyên điểm màu, đặt t0 và t1 trên trục chuẩn', () => {
    const result = importSvg(
      withDefs(`<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="6" y1="12" x2="18" y2="12">${STOPS}</linearGradient>`, FULL_RECT),
    );
    expect(result.shapes[0].fill).toBe('linear:0,0.25,0.75:#ff0000@0,#0000ff@1');
  });

  it('dải màu dài hơn khung: t0 và t1 nằm ngoài 0..1, không cần cắt điểm màu', () => {
    const result = importSvg(
      withDefs(`<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="-24" y1="0" x2="48" y2="0">${STOPS}</linearGradient>`, FULL_RECT),
    );
    expect(result.shapes[0].fill).toBe('linear:0,-1,2:#ff0000@0,#0000ff@1');
  });

  it('transform của lớp và gradientTransform đều được tính vào hướng', () => {
    const rotated = importSvg(
      withDefs(
        `<linearGradient id="g" x1="0" y1="0" x2="1" y2="0">${STOPS}</linearGradient>`,
        '<rect width="24" height="24" fill="url(#g)" transform="rotate(90 12 12)"/>',
      ),
    );
    expect(linear(rotated.shapes[0].fill).angle).toBe(90);
    const viaGradientTransform = importSvg(
      withDefs(`<linearGradient id="g" x1="0" y1="0" x2="1" y2="0" gradientTransform="rotate(90 .5 .5)">${STOPS}</linearGradient>`, FULL_RECT),
    );
    expect(linear(viaGradientTransform.shapes[0].fill).angle).toBe(90);
  });

  it('khung bao không vuông làm dải nghiêng: góc theo tỷ lệ cạnh, điểm đầu ở góc (0,0), điểm cuối ở góc (24,12)', () => {
    const result = importSvg(
      withDefs(
        `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">${STOPS}</linearGradient>`,
        '<rect width="24" height="12" fill="url(#g)"/>',
      ),
    );
    const gradient = linear(result.shapes[0].fill);
    expect(gradient.angle).toBeCloseTo(63.43, 1);
    expect(gradient.t0).toBeCloseTo(0, 3);
    expect(gradient.t1).toBeCloseTo(0.667, 2);
  });

  it('spreadMethod reflect và repeat được giữ', () => {
    const reflect = importSvg(
      withDefs(`<linearGradient id="g" x1="0.25" x2="0.75" spreadMethod="reflect">${STOPS}</linearGradient>`, FULL_RECT),
    );
    expect(linear(reflect.shapes[0].fill)).toMatchObject({ spread: 'reflect', t0: 0.25, t1: 0.75 });
    const repeat = importSvg(withDefs(`<radialGradient id="g" spreadMethod="repeat" r="0.25">${STOPS}</radialGradient>`, FULL_RECT));
    expect(radial(repeat.shapes[0].fill)).toMatchObject({ spread: 'repeat', r: 0.25 });
  });

  it('kế thừa điểm màu và thuộc tính qua xlink:href; stop-color đặt trong style', () => {
    const result = importSvg(
      withDefs(
        `<linearGradient id="base"><stop offset="0%" style="stop-color:#00ff00"/><stop offset="100%" stop-color="#000000"/></linearGradient>
         <linearGradient id="g" xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="#base" x1="0" y1="0" x2="0" y2="1"/>`,
        FULL_RECT,
      ),
    );
    expect(result.shapes[0].fill).toBe('linear:90:#00ff00@0,#000000@1');
  });

  it('vòng href không treo; dải không có điểm màu thì không tô gì', () => {
    const loop = importSvg(
      withDefs('<linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"/>', '<rect width="24" height="24" fill="url(#a)"/><rect width="4" height="4"/>'),
    );
    expect(loop.shapes).toHaveLength(1);
  });

  it('dải màu chỉ có một điểm màu: thành màu đơn (kèm độ đặc của điểm màu)', () => {
    const result = importSvg(
      withDefs('<linearGradient id="g"><stop offset="0.5" stop-color="#336699" stop-opacity="0.5"/></linearGradient>', FULL_RECT),
    );
    expect(result.shapes[0]).toMatchObject({ fill: '#336699', fillOpacity: 0.5 });
  });

  it('dải màu dùng cho nét của đường thẳng (khung bao cao 0) khi tính theo userSpaceOnUse', () => {
    const result = importSvg(
      withDefs(
        `<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="24" y2="0">${STOPS}</linearGradient>`,
        '<path d="M2 12 H22" fill="none" stroke="url(#g)" stroke-width="2"/>',
      ),
    );
    expect(result.shapes[0].stroke).toBe('linear:0:#ff0000@0,#0000ff@1');
  });

  it('objectBoundingBox trên nét thẳng (khung bao cao 0): theo chuẩn SVG không vẽ nét đó', () => {
    const result = importSvg(
      withDefs(
        `<linearGradient id="g">${STOPS}</linearGradient>`,
        '<path d="M2 12 H22" fill="none" stroke="url(#g)" stroke-width="2"/><rect width="4" height="4"/>',
      ),
    );
    expect(result.shapes).toHaveLength(1);
    expect(result.shapes[0].geometry.type).toBe('rect');
  });

  it('radialGradient giữ nguyên: tâm, bán kính, tiêu điểm và ma trận đưa về toạ độ lưới', () => {
    const result = importSvg(withDefs(`<radialGradient id="g">${STOPS}</radialGradient>`, '<circle cx="12" cy="12" r="8" fill="url(#g)"/>'));
    const gradient = radial(result.shapes[0].fill);
    expect(gradient).toMatchObject({ kind: 'radial', cx: 0.5, cy: 0.5, r: 0.5, fx: 0.5, fy: 0.5 });
    // khung bao 16x16 đặt tại (4, 4) trên lưới 24: ma trận tính theo tỷ lệ cạnh lưới
    expect(gradient.matrix[0]).toBeCloseTo(16 / 24, 6);
    expect(gradient.matrix[3]).toBeCloseTo(16 / 24, 6);
    expect(gradient.matrix[4]).toBeCloseTo(4 / 24, 6);
    expect(result.warnings).toEqual([]);
  });

  it('radialGradient theo userSpaceOnUse có tiêu điểm riêng và gradientTransform', () => {
    const result = importSvg(
      withDefs(
        `<radialGradient id="g" gradientUnits="userSpaceOnUse" cx="12" cy="12" r="10" fx="9" fy="8" gradientTransform="translate(1 2)">${STOPS}</radialGradient>`,
        FULL_RECT,
      ),
    );
    const gradient = radial(result.shapes[0].fill);
    expect(gradient).toMatchObject({ cx: 12, cy: 12, r: 10, fx: 9, fy: 8 });
    expect(gradient.matrix[4]).toBeCloseTo(1 / 24, 6);
    expect(gradient.matrix[5]).toBeCloseTo(2 / 24, 6);
  });

  it('hai đầu dải trùng nhau: thành màu điểm cuối', () => {
    const result = importSvg(
      withDefs(`<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="5" y1="5" x2="5" y2="5">${STOPS}</linearGradient>`, FULL_RECT),
    );
    expect(result.shapes[0].fill).toBe('#0000ff');
  });

  it('điểm màu có độ trong suốt (stop-opacity hoặc rgba): được giữ nguyên trong dải', () => {
    const result = importSvg(
      withDefs(
        '<linearGradient id="g"><stop offset="0" stop-color="#ff0000" stop-opacity="0.2"/><stop offset="1" stop-color="#0000ff"/></linearGradient>',
        FULL_RECT,
      ),
    );
    expect(result.shapes[0].fill).toBe('linear:0:#ff0000@0~0.2,#0000ff@1');
    expect(result.warnings).toEqual([]);
    const rgba = importSvg(
      withDefs('<linearGradient id="g"><stop offset="0" stop-color="rgba(255,0,0,0.5)"/><stop offset="1" stop-color="#0000ff" stop-opacity="0.5"/></linearGradient>', FULL_RECT),
    );
    expect(rgba.shapes[0].fill).toBe('linear:0:#ff0000@0~0.5,#0000ff@1~0.5');
  });

  it('nhiều điểm màu nhưng chưa quá giới hạn thì giữ hết; quá giới hạn thì lấy mẫu lại, giữ hai đầu và báo', () => {
    const many = Array.from(
      { length: 12 },
      (_, index) => `<stop offset="${index / 11}" stop-color="#${(index * 20).toString(16).padStart(2, '0')}0000"/>`,
    ).join('');
    const result = importSvg(withDefs(`<linearGradient id="g">${many}</linearGradient>`, FULL_RECT));
    expect(parseGradient(result.shapes[0].fill)?.stops).toHaveLength(12);
    const huge = Array.from({ length: MAX_GRADIENT_STOPS + 10 }, (_, index) => `<stop offset="${index / (MAX_GRADIENT_STOPS + 9)}" stop-color="#000000"/>`).join('');
    const trimmed = importSvg(withDefs(`<linearGradient id="g">${huge}</linearGradient>`, FULL_RECT));
    const parsed = parseGradient(trimmed.shapes[0].fill);
    expect(parsed?.stops).toHaveLength(MAX_GRADIENT_STOPS);
    expect(parsed?.stops[0].offset).toBe(0);
    expect(parsed?.stops[MAX_GRADIENT_STOPS - 1].offset).toBe(1);
    expect(trimmed.warnings.some((warning) => warning.includes('lấy mẫu lại'))).toBe(true);
  });

  it('tham chiếu có nháy và khoảng trắng đọc được; tham chiếu ngoài tệp thì cảnh báo, không làm hỏng bản nhập', () => {
    const quoted = importSvg(
      withDefs(`<linearGradient id="g">${STOPS}</linearGradient>`, `<rect width="24" height="24" fill="url( '#g' )"/>`),
    );
    expect(quoted.shapes[0].fill).toBe('linear:0:#ff0000@0,#0000ff@1');
    const external = importSvg(svg('<rect width="24" height="24" fill="url(other.svg#g) #00ff00"/><rect width="4" height="4" fill="url(other.svg#g)"/>'));
    expect(external.shapes).toHaveLength(1);
    expect(external.shapes[0].fill).toBe('#00ff00');
    expect(external.warnings).toHaveLength(1);
  });

  it('kết quả luôn qua được bước chuẩn hoá của thư viện (lưu rồi nạp lại không mất)', () => {
    for (const shape of importSvg(BAO_CAO).shapes) {
      expect(normalizeShape(shape)).toMatchObject({ fill: shape.fill, stroke: shape.stroke });
    }
  });
});
