/**
 * @jest-environment jsdom
 */
import { geometryBounds } from './geometry';
import { LIMITS } from './validate';
import { createDocument } from './model';
import { generateSvg } from './render';
import { importSvg } from './svg-import';

const svg = (inner: string, attrs = 'viewBox="0 0 24 24"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;
const box = (geometry: Parameters<typeof geometryBounds>[0]) => {
  const { x, y, width, height } = geometryBounds(geometry);
  return [x, y, width, height].map((value) => Math.round(value * 1000) / 1000);
};

/** Mẫu thật của bộ icon "dac": glyph trắng đặc, khoét bằng mask; nền gradient. */
const BAO_CAO = `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56"><defs><linearGradient id="g-bao-cao" x1="0" y1="0" x2="56" y2="56" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4CC3FF"/><stop offset="0.55" stop-color="#0493F9"/><stop offset="1" stop-color="#0263C9"/></linearGradient></defs><rect width="56" height="56" rx="12" fill="url(#g-bao-cao)"/><g transform="translate(12 12) scale(1.3333)"><mask id="m-bao-cao"><rect width="24" height="24" fill="#000"/><g stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" fill="#fff" stroke="#fff"></path><path d="M14 3v6h6" fill="none" stroke="#000"></path><path d="M9 17v-3M12 17v-6M15 17v-2" fill="none" stroke="#000"></path></g></mask><rect width="24" height="24" fill="#FFFFFF" mask="url(#m-bao-cao)"/></g></svg>`;

const CAI_DAT = `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56"><g transform="translate(12 12) scale(1.3333)"><mask id="m-cai-dat"><rect width="24" height="24" fill="#000"/><g stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" fill="none" stroke="#fff"></path><circle cx="15" cy="6" r="2" fill="#000" stroke="#000" stroke-width="4.75"></circle><circle cx="15" cy="6" r="2" fill="#fff" stroke="#fff"></circle><circle cx="9" cy="12" r="2" fill="#000" stroke="#000" stroke-width="4.75"></circle><circle cx="9" cy="12" r="2" fill="#fff" stroke="#fff"></circle></g></mask><rect width="24" height="24" fill="#FFFFFF" mask="url(#m-cai-dat)"/></g></svg>`;

describe('importSvg: mặt nạ', () => {
  it('mẫu bao-cao (dac): lớp glyph giữ mặt nạ, không còn ô vuông trắng trơn', () => {
    const result = importSvg(BAO_CAO);
    const [background, glyph] = result.shapes;
    expect(result.shapes).toHaveLength(2);
    expect(background.fill).toMatch(/^linear:45:/);
    expect(glyph.fill).toBe('#ffffff');
    // hình chữ nhật 24x24 ở toạ độ 12..44 của lưới 56, co về lưới 24: 5.143..18.857
    expect(box(glyph.geometry)).toEqual([5.143, 5.143, 13.714, 13.714]);
    expect(glyph.mask?.layers).toHaveLength(3);
    expect(result.warnings).toEqual(['Đã co SVG gốc 56x56 về lưới 24x24.']);
  });

  it('nền đen đặc dưới cùng của mặt nạ được bỏ; trắng hiện, đen khoét, giữ nguyên thứ tự vẽ', () => {
    const layers = importSvg(BAO_CAO).shapes[1].mask?.layers ?? [];
    expect(layers.map((layer) => [layer.fill, layer.stroke])).toEqual([
      ['#ffffff', '#ffffff'],
      ['none', '#000000'],
      ['none', '#000000'],
    ]);
  });

  it('hình trong mặt nạ nằm đúng toạ độ lưới và nét co theo tỷ lệ', () => {
    const layers = importSvg(BAO_CAO).shapes[1].mask?.layers ?? [];
    // nét 2.25 * 1.3333 * (24/56) = 1.286
    expect(layers.map((layer) => layer.strokeWidth)).toEqual([1.2857, 1.2857, 1.2857]);
    const silhouette = box(layers[0].geometry);
    expect(silhouette[0]).toBeCloseTo(7.429, 2);
    expect(silhouette[1]).toBeCloseTo(6.857, 2);
  });

  it('mặt nạ có hình đen đè lên hình trắng rồi trắng đè lại (cai-dat): giữ cả sáu hình theo thứ tự', () => {
    const layers = importSvg(CAI_DAT).shapes[0].mask?.layers ?? [];
    expect(layers.map((layer) => layer.fill)).toEqual(['none', '#000000', '#ffffff', '#000000', '#ffffff']);
    expect(layers[1].strokeWidth).toBeCloseTo(2.714, 2);
  });

  it('nhập rồi xuất SVG ra đúng thẻ mask với các hình của nó', () => {
    const doc = createDocument({ name: 'Báo cáo', shapes: importSvg(BAO_CAO).shapes });
    const out = generateSvg(doc, { colorMode: 'brand' });
    expect(out).toMatch(/<mask id="svndts-mask-[a-z0-9]+" maskUnits="userSpaceOnUse"/);
    expect(out).toContain('stroke="#000000"');
    expect(out).toMatch(/<rect x="5.143" y="5.143" width="13.714" height="13.714" fill="#ffffff" mask="url\(#svndts-mask-/);
  });

  it('mặt nạ đặt trên nhóm che mọi hình con, với toạ độ của nhóm', () => {
    const result = importSvg(
      svg(
        '<defs><mask id="m"><rect width="24" height="24" fill="#fff"/><circle cx="12" cy="12" r="4" fill="#000"/></mask></defs><g transform="translate(2 2)" mask="url(#m)"><rect width="10" height="10" fill="#f00"/><rect x="10" y="10" width="10" height="10" fill="#00f"/></g>',
      ),
    );
    expect(result.shapes).toHaveLength(2);
    for (const shape of result.shapes) {
      expect(shape.mask?.layers).toHaveLength(2);
      expect(box(shape.mask?.layers[0].geometry ?? shape.geometry)).toEqual([2, 2, 24, 24]);
    }
    expect(result.shapes[0].mask).toEqual(result.shapes[1].mask);
    const hole = result.shapes[0].mask?.layers[1].geometry;
    expect(hole).toMatchObject({ type: 'ellipse', cx: 14, cy: 14, rx: 4, ry: 4 });
  });

  it('mặt nạ riêng của hình con thay mặt nạ của nhóm và báo mặt nạ lồng', () => {
    const result = importSvg(
      svg(
        '<defs><mask id="a"><rect width="24" height="24" fill="#fff"/></mask><mask id="b"><rect width="12" height="24" fill="#fff"/></mask></defs><g mask="url(#a)"><rect width="24" height="24" fill="#f00" mask="url(#b)"/></g>',
      ),
    );
    expect(result.shapes[0].mask?.layers[0].geometry).toMatchObject({ width: 12 });
    expect(result.warnings.some((warning) => warning.includes('chồng nhau'))).toBe(true);
  });

  it('mask trong style nội tuyến cũng được đọc', () => {
    const result = importSvg(svg('<defs><mask id="m"><rect width="24" height="24" fill="#fff"/></mask></defs><rect width="24" height="24" fill="#f00" style="mask:url(#m)"/>'));
    expect(result.shapes[0].mask?.layers).toHaveLength(1);
  });

  it('mặt nạ alpha: mọi màu thành trắng (hình có vẽ thì hiện), giữ độ mờ', () => {
    const result = importSvg(
      svg('<defs><mask id="m" mask-type="alpha"><rect width="12" height="24" fill="#123456"/><circle cx="18" cy="12" r="4" fill="#000" fill-opacity="0.5"/></mask></defs><rect width="24" height="24" fill="#f00" mask="url(#m)"/>'),
    );
    const layers = result.shapes[0].mask?.layers ?? [];
    expect(layers.map((layer) => layer.fill)).toEqual(['#ffffff', '#ffffff']);
    expect(layers[1].fillOpacity).toBe(0.5);
  });

  it('mặt nạ che hết (toàn đen): phần tử không hiện gì nên không thành lớp', () => {
    const result = importSvg(
      svg('<defs><mask id="m"><rect width="24" height="24" fill="#000"/></mask></defs><rect width="24" height="24" fill="#f00" mask="url(#m)"/><circle cx="12" cy="12" r="3" fill="#0f0"/>'),
    );
    expect(result.shapes).toHaveLength(1);
    expect(result.shapes[0].geometry.type).toBe('ellipse');
  });

  it('mặt nạ tính theo khung bao (maskContentUnits=objectBoundingBox): nội dung co theo khung bao của phần tử', () => {
    const result = importSvg(
      svg(
        '<defs><mask id="m" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="#fff"/></mask></defs><rect width="24" height="24" fill="#f00" mask="url(#m)"/><circle cx="12" cy="12" r="3" fill="#0f0"/>',
      ),
    );
    expect(result.shapes).toHaveLength(2);
    expect(result.shapes[0].mask?.layers[0].geometry).toMatchObject({ x: 0, y: 0, width: 24, height: 24 });
    expect(result.warnings).toEqual([]);
    const offset = importSvg(
      svg(
        '<defs><mask id="m" maskContentUnits="objectBoundingBox"><rect width="0.5" height="1" fill="#fff"/></mask></defs><rect x="4" y="2" width="10" height="8" fill="#f00" mask="url(#m)"/>',
      ),
    );
    expect(offset.shapes[0].mask?.layers[0].geometry).toMatchObject({ x: 4, y: 2, width: 5, height: 8 });
  });

  it('vùng của mặt nạ cắt bớt hình lòi ra ngoài: thêm lớp đen phủ phần ngoài vùng (giao chính xác, không cần báo)', () => {
    const region = importSvg(
      svg(
        '<defs><mask id="m" maskUnits="userSpaceOnUse" x="8" y="8" width="8" height="8"><rect width="24" height="24" fill="#fff"/></mask></defs><circle cx="12" cy="12" r="8" fill="#f00" mask="url(#m)"/>',
      ),
    );
    const layers = region.shapes[0].mask?.layers ?? [];
    expect(layers).toHaveLength(2);
    expect(layers[1]).toMatchObject({ fill: '#000000', fillRule: 'evenodd', stroke: 'none' });
    expect(region.warnings).toEqual([]);
  });

  it('mặt nạ trên đường thẳng (khung bao cao 0) với vùng theo khung bao: phần tử không hiện', () => {
    const result = importSvg(
      svg(
        '<defs><mask id="m"><rect width="24" height="24" fill="#fff"/></mask></defs><path d="M2 12 H22" fill="none" stroke="#f00" stroke-width="4" mask="url(#m)"/><rect width="4" height="4"/>',
      ),
    );
    // khung bao của đường thẳng cao 0: theo chuẩn SVG phần tử không hiện
    expect(result.shapes).toHaveLength(1);
  });

  it('tham chiếu tới mặt nạ không có trong tệp: vẽ như không có mặt nạ và báo; tham chiếu sai cú pháp thì bỏ qua giá trị đó và báo', () => {
    const missing = importSvg(svg('<rect width="24" height="24" fill="#f00" mask="url(#khong-co)"/>'));
    expect(missing.shapes).toHaveLength(1);
    expect(missing.shapes[0].mask).toBeUndefined();
    expect(missing.warnings.some((warning) => warning.includes('mặt nạ'))).toBe(true);

    const invalid = importSvg(svg('<rect width="24" height="24" fill="#f00" mask="abc"/><circle cx="12" cy="12" r="3" fill="#0f0"/>'));
    expect(invalid.shapes).toHaveLength(2);
    expect(invalid.warnings.some((warning) => warning.includes('mặt nạ'))).toBe(true);
  });

  it('mask="none" là không có mặt nạ', () => {
    const result = importSvg(svg('<rect width="24" height="24" fill="#f00" mask="none"/>'));
    expect(result.shapes[0].mask).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it('dải màu trong mặt nạ được giữ nguyên (mặt nạ mờ dần); màu lạ và currentColor thành đen', () => {
    const result = importSvg(
      svg(
        '<defs><linearGradient id="g"><stop offset="0" stop-color="#000000"/><stop offset="1" stop-color="#ffffff"/></linearGradient><mask id="m"><rect width="24" height="24" fill="url(#g)"/><circle cx="6" cy="6" r="2" fill="currentColor"/><circle cx="18" cy="6" r="2" fill="mausieula"/></mask></defs><rect width="24" height="24" fill="#f00" mask="url(#m)"/>',
      ),
    );
    const layers = result.shapes[0].mask?.layers ?? [];
    expect(layers.map((layer) => layer.fill)).toEqual(['linear:0:#000000@0,#ffffff@1', '#000000', '#000000']);
  });

  it('mặt nạ quá nhiều hình bị cắt và báo', () => {
    const circles = Array.from({ length: LIMITS.maxMaskLayers + 5 }, (_, index) => `<circle cx="${(index % 20) + 2}" cy="12" r="1" fill="#fff"/>`).join('');
    const result = importSvg(svg(`<defs><mask id="m">${circles}</mask></defs><rect width="24" height="24" fill="#f00" mask="url(#m)"/>`));
    expect(result.shapes[0].mask?.layers).toHaveLength(LIMITS.maxMaskLayers);
    expect(result.warnings.some((warning) => warning.includes(String(LIMITS.maxMaskLayers)))).toBe(true);
  });

  it('chữ hoặc ảnh trong mặt nạ không được nhập và báo như nơi khác', () => {
    const result = importSvg(
      svg('<defs><mask id="m"><rect width="24" height="24" fill="#fff"/><text x="2" y="2">A</text></mask></defs><rect width="24" height="24" fill="#f00" mask="url(#m)"/>'),
    );
    expect(result.shapes[0].mask?.layers).toHaveLength(1);
    expect(result.warnings.some((warning) => warning.includes('chữ'))).toBe(true);
  });

  it('SVG không có mặt nạ không bị ảnh hưởng: đen vẫn là màu theo chữ ở hình thường', () => {
    const result = importSvg(svg('<rect width="24" height="24" fill="#000"/>'));
    expect(result.shapes[0].fill).toBe('currentColor');
    expect(result.shapes[0].mask).toBeUndefined();
  });
});
