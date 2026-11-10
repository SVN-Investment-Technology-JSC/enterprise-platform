import { createDocument, createShape } from './model';
import { generateSvg } from './render';

const tile = createShape({ type: 'rect', x: 0, y: 0, width: 24, height: 24, rx: 5 }, { fill: '#2563eb', stroke: 'none' });
const glyph = createShape({ type: 'path', subpaths: [{ closed: false, nodes: [{ x: 6, y: 12 }, { x: 18, y: 12 }] }] }, { fill: 'none', stroke: '#ffffff', strokeWidth: 2 });
const doc = (...shapes: ReturnType<typeof createShape>[]) => createDocument({ name: 'Thử', shapes });

describe('chế độ một màu: chi tiết trắng trên nền màu là phần khoét', () => {
  it('lớp toàn trắng nằm trên lớp có màu khoét lớp bên dưới thay vì vẽ cùng màu', () => {
    const svg = generateSvg(doc(tile, glyph), { colorMode: 'currentColor' });
    expect(svg).toContain('<mask');
    expect(svg).toMatch(/<rect[^>]*fill="currentColor"[^>]*mask="url\(#svndts-mask-/);
    // lớp trắng không được vẽ ra, chỉ còn là lỗ khoét đen trong mặt nạ
    expect(svg).toContain('stroke="#000000"');
    expect(svg.match(/<path /g)?.length).toBe(1);
  });

  it('chế độ brand vẫn vẽ chi tiết trắng như thường, không có mặt nạ khoét', () => {
    const svg = generateSvg(doc(tile, glyph), { colorMode: 'brand' });
    expect(svg).not.toContain('<mask');
    expect(svg).toContain('stroke="#ffffff"');
  });

  it('chỉ có lớp trắng (không có gì bên dưới để khoét) thì vẽ theo currentColor như cũ', () => {
    const svg = generateSvg(doc(glyph), { colorMode: 'currentColor' });
    expect(svg).not.toContain('<mask');
    expect(svg).toContain('currentColor');
  });

  it('lớp trắng nằm dưới lớp có màu không khoét gì', () => {
    const svg = generateSvg(doc(glyph, tile), { colorMode: 'currentColor' });
    expect(svg).not.toContain('<mask');
  });

  it('chi tiết trắng có mặt nạ riêng: lỗ khoét giữ mặt nạ đó; nền có mặt nạ riêng giữ các lớp của nó trước lỗ khoét', () => {
    const maskedGlyph = {
      ...createShape({ type: 'rect', x: 4, y: 4, width: 16, height: 16, rx: 0 }, { fill: '#ffffff', stroke: 'none' }),
      mask: { layers: [createShape({ type: 'rect', x: 4, y: 4, width: 8, height: 16, rx: 0 }, { fill: '#ffffff', stroke: 'none' })] },
    };
    const maskedTile = {
      ...tile,
      mask: { layers: [createShape({ type: 'rect', x: 0, y: 0, width: 24, height: 24, rx: 0 }, { fill: '#ffffff', stroke: 'none' })] },
    };
    const svg = generateSvg(doc(maskedTile, maskedGlyph), { colorMode: 'currentColor' });
    // hai mặt nạ: của lỗ khoét (mặt nạ riêng của chi tiết) và của nền (lớp riêng + lỗ khoét đen)
    expect(svg.match(/<mask /g)?.length).toBe(2);
    expect(svg).toMatch(/fill="#000000"[^>]*mask="url\(#svndts-mask-/);
  });

  it('nhiều lớp màu bên dưới đều bị khoét; lớp màu nằm trên lớp trắng thì không', () => {
    const above = createShape({ type: 'rect', x: 20, y: 20, width: 2, height: 2, rx: 0 }, { fill: '#ef4444', stroke: 'none' });
    const second = createShape({ type: 'rect', x: 1, y: 1, width: 4, height: 4, rx: 0 }, { fill: '#10b981', stroke: 'none' });
    const svg = generateSvg(doc(tile, second, glyph, above), { colorMode: 'currentColor' });
    expect(svg.match(/mask="url\(#/g)?.length).toBe(2);
  });
});
