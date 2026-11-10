/**
 * @jest-environment jsdom
 */
import { parseGradient } from './gradient';
import { createDocument, type IconShape } from './model';
import { generateSvg } from './render';
import { importSvg } from './svg-import';
import { normalizeShape } from './validate';

const svg = (inner: string, attrs = 'viewBox="0 0 24 24"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;
const withDefs = (defs: string, shape: string) => svg(`<defs>${defs}</defs>${shape}`);
const documentFromShapes = (shapes: IconShape[]) => createDocument({ name: 'Nhập', shapes });

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

  it('userSpaceOnUse chỉ phủ một nửa khung: điểm màu được co lại và thêm điểm đệm ở hai đầu', () => {
    const result = importSvg(
      withDefs(`<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="6" y1="12" x2="18" y2="12">${STOPS}</linearGradient>`, FULL_RECT),
    );
    expect(result.shapes[0].fill).toBe('linear:0:#ff0000@0,#ff0000@0.25,#0000ff@0.75,#0000ff@1');
  });

  it('dải màu dài hơn khung: cắt đúng màu tại hai mép khung', () => {
    const result = importSvg(
      withDefs(`<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="-24" y1="0" x2="48" y2="0">${STOPS}</linearGradient>`, FULL_RECT),
    );
    const parsed = parseGradient(result.shapes[0].fill);
    expect(parsed?.stops).toHaveLength(2);
    expect(parsed?.stops[0].color).toBe('#aa0055');
    expect(parsed?.stops[1].color).toBe('#5500aa');
  });

  it('transform của lớp và gradientTransform đều được tính vào hướng', () => {
    const rotated = importSvg(
      withDefs(
        `<linearGradient id="g" x1="0" y1="0" x2="1" y2="0">${STOPS}</linearGradient>`,
        '<rect width="24" height="24" fill="url(#g)" transform="rotate(90 12 12)"/>',
      ),
    );
    expect(parseGradient(rotated.shapes[0].fill)?.angle).toBe(90);
    const viaGradientTransform = importSvg(
      withDefs(`<linearGradient id="g" x1="0" y1="0" x2="1" y2="0" gradientTransform="rotate(90 .5 .5)">${STOPS}</linearGradient>`, FULL_RECT),
    );
    expect(parseGradient(viaGradientTransform.shapes[0].fill)?.angle).toBe(90);
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

  it('vòng href không treo; dải không có điểm màu thành một màu đơn kèm cảnh báo', () => {
    const loop = importSvg(
      withDefs('<linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"/>', '<rect width="24" height="24" fill="url(#a)"/>'),
    );
    expect(loop.shapes[0].fill).toBe('currentColor');
    expect(loop.warnings.length).toBeGreaterThan(0);
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

  it('objectBoundingBox trên nét thẳng (khung bao cao 0) không dựng được: thành một màu đơn kèm cảnh báo', () => {
    const result = importSvg(
      withDefs(`<linearGradient id="g">${STOPS}</linearGradient>`, '<path d="M2 12 H22" fill="none" stroke="url(#g)" stroke-width="2"/>'),
    );
    expect(result.shapes[0].stroke).toBe('#800080');
    expect(result.warnings).toHaveLength(1);
  });

  it('radialGradient thành một màu đơn (màu giữa dải) kèm cảnh báo', () => {
    const result = importSvg(withDefs(`<radialGradient id="g">${STOPS}</radialGradient>`, '<circle cx="12" cy="12" r="8" fill="url(#g)"/>'));
    expect(result.shapes[0].fill).toBe('#800080');
    expect(result.warnings).toHaveLength(1);
  });

  it('hai đầu dải trùng nhau: thành màu điểm cuối', () => {
    const result = importSvg(
      withDefs(`<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="5" y1="5" x2="5" y2="5">${STOPS}</linearGradient>`, FULL_RECT),
    );
    expect(result.shapes[0].fill).toBe('#0000ff');
  });

  it('điểm màu có độ trong suốt: giữ màu, báo bỏ độ trong suốt', () => {
    const result = importSvg(
      withDefs(
        '<linearGradient id="g"><stop offset="0" stop-color="#ff0000" stop-opacity="0.2"/><stop offset="1" stop-color="#0000ff"/></linearGradient>',
        FULL_RECT,
      ),
    );
    expect(result.shapes[0].fill).toBe('linear:0:#ff0000@0,#0000ff@1');
    expect(result.warnings.some((warning) => warning.includes('trong suốt'))).toBe(true);
  });

  it('nhiều điểm màu hơn 8 được thưa lại còn 8, giữ hai đầu', () => {
    const many = Array.from(
      { length: 12 },
      (_, index) => `<stop offset="${index / 11}" stop-color="#${(index * 20).toString(16).padStart(2, '0')}0000"/>`,
    ).join('');
    const result = importSvg(withDefs(`<linearGradient id="g">${many}</linearGradient>`, FULL_RECT));
    const parsed = parseGradient(result.shapes[0].fill);
    expect(parsed?.stops).toHaveLength(8);
    expect(parsed?.stops[0].offset).toBe(0);
    expect(parsed?.stops[7].offset).toBe(1);
  });

  it('tham chiếu có nháy và khoảng trắng đọc được; tham chiếu ngoài tệp thì cảnh báo, không làm hỏng bản nhập', () => {
    const quoted = importSvg(
      withDefs(`<linearGradient id="g">${STOPS}</linearGradient>`, `<rect width="24" height="24" fill="url( '#g' )"/>`),
    );
    expect(quoted.shapes[0].fill).toBe('linear:0:#ff0000@0,#0000ff@1');
    const external = importSvg(svg('<rect width="24" height="24" fill="url(other.svg#g)"/>'));
    expect(external.shapes[0].fill).toBe('currentColor');
    expect(external.warnings).toHaveLength(1);
  });

  it('kết quả luôn qua được bước chuẩn hoá của thư viện (lưu rồi nạp lại không mất)', () => {
    for (const shape of importSvg(BAO_CAO).shapes) {
      expect(normalizeShape(shape)).toMatchObject({ fill: shape.fill, stroke: shape.stroke });
    }
  });
});
