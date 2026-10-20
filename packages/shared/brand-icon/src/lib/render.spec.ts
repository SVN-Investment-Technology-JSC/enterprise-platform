import ts from 'typescript';
import { createPresetDocuments } from './legacy.js';
import { createDocument, createShape, type IconDocument, type IconShape } from './model.js';
import { DEFAULT_PALETTE, brandPaint, type BrandPalette } from './palette.js';
import { parsePathData } from './path-data.js';
import {
  buildIconModel,
  generateIconIndex,
  generateReactComponent,
  generateSprite,
  generateSvg,
  slugify,
  toCamelAttr,
  toComponentName,
  type IconSvgModel,
  type SvgNode,
} from './render.js';

const HEX = /#[0-9a-fA-F]{3,8}\b/;

const line = (stroke = 'currentColor', extra: Partial<IconShape> = {}) =>
  createShape(parsePathData('M 4 12 L 20 12'), { stroke, ...extra });

const doc = (shapes: IconShape[], overrides: Partial<IconDocument> = {}) => createDocument({ name: 'Mẫu thử', shapes, ...overrides });

function syntaxErrors(tsx: string): string[] {
  const result = ts.transpileModule(tsx, {
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2020 },
  });
  return (result.diagnostics ?? []).map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n'));
}

/** Giá trị thuộc tính mà trình duyệt sẽ áp cho một phần tử, tính cả kế thừa từ thẻ gốc. */
const effective = (model: IconSvgModel, node: SvgNode, name: string): string | undefined => node.attrs[name] ?? model.rootAttrs[name];

describe('buildIconModel', () => {
  it('đặt viewBox theo kích thước lưới và thuộc tính chung lên thẻ gốc', () => {
    const model = buildIconModel(doc([line()]));
    expect(model.viewBox).toBe('0 0 24 24');
    expect(model.rootAttrs).toEqual({
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.75',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    });
    // lớp hình kế thừa hết nên không lặp thuộc tính
    expect(model.children).toHaveLength(1);
    expect(model.children[0].attrs).toEqual({ d: 'M 4 12 L 20 12' });
  });

  it('theo kích thước lưới khác, kích thước không hợp lệ quay về 24', () => {
    expect(buildIconModel(doc([line()], { size: 32 })).viewBox).toBe('0 0 32 32');
    expect(buildIconModel(doc([line()], { size: 0 })).viewBox).toBe('0 0 24 24');
    expect(buildIconModel(doc([line()], { size: Number.NaN })).viewBox).toBe('0 0 24 24');
    expect(buildIconModel(doc([line()], { size: -8 })).viewBox).toBe('0 0 24 24');
  });

  it('bỏ qua lớp ẩn; chỉ còn lớp ẩn thì thẻ gốc không có thuộc tính nét', () => {
    const hidden = line('currentColor', { hidden: true });
    expect(buildIconModel(doc([hidden, line()])).children).toHaveLength(1);
    const model = buildIconModel(doc([hidden]));
    expect(model.children).toHaveLength(0);
    expect(model.rootAttrs).toEqual({ fill: 'none' });
  });

  it('không có lớp nào có nét thì không đặt thuộc tính nét, lớp tô không bị thêm stroke="none"', () => {
    const model = buildIconModel(doc([createShape({ type: 'ellipse', cx: 12, cy: 12, rx: 6, ry: 6 }, { stroke: 'none', fill: 'currentColor' })]));
    expect(model.rootAttrs).toEqual({ fill: 'none' });
    expect(model.children[0].attrs.stroke).toBeUndefined();
    expect(model.children[0].attrs.fill).toBe('currentColor');
  });

  it('có lớp có nét thì lớp chỉ tô phải ghi stroke="none" để không kế thừa nét', () => {
    const fillOnly = createShape({ type: 'ellipse', cx: 20, cy: 4, rx: 1.5, ry: 1.5 }, { stroke: 'none', fill: 'currentColor' });
    const model = buildIconModel(doc([line(), fillOnly]));
    expect(model.children[1].attrs.stroke).toBe('none');
    expect(model.children[1].attrs.fill).toBe('currentColor');
  });

  it('thuộc tính nét lệch so với số đông được ghi riêng trên lớp đó', () => {
    const thick = line('currentColor', { strokeWidth: 3, linecap: 'square', linejoin: 'bevel' });
    const model = buildIconModel(doc([line(), line(), thick]));
    expect(model.rootAttrs['stroke-width']).toBe('1.75');
    expect(model.children[0].attrs['stroke-width']).toBeUndefined();
    expect(model.children[2].attrs).toMatchObject({ 'stroke-width': '3', 'stroke-linecap': 'square', 'stroke-linejoin': 'bevel' });
  });

  it('thuộc tính hiệu lực của từng lớp luôn đúng với dữ liệu gốc sau khi gom lên thẻ gốc (chế độ brand)', () => {
    const shapes: IconShape[] = [
      line(brandPaint('sapphire'), { strokeWidth: 2 }),
      line(brandPaint('sapphire'), { strokeWidth: 2 }),
      line(brandPaint('emerald'), { strokeWidth: 1.5, linecap: 'butt', linejoin: 'miter' }),
      createShape({ type: 'rect', x: 4, y: 4, width: 8, height: 8, rx: 1 }, { stroke: 'none', fill: '#ff8800', fillOpacity: 0.4, fillRule: 'evenodd' }),
      line('#112233', { linecap: 'square' }),
    ];
    const model = buildIconModel(doc(shapes), { colorMode: 'brand' });
    const hex: Record<string, string> = { sapphire: '#2563eb', emerald: '#10b981' };
    shapes.forEach((shape, index) => {
      const node = model.children[index];
      if (shape.stroke === 'none') {
        expect(effective(model, node, 'stroke')).toBe('none');
        return;
      }
      const key = shape.stroke.startsWith('brand:') ? shape.stroke.slice(6) : null;
      expect(effective(model, node, 'stroke')).toBe(key ? hex[key] : shape.stroke);
      expect(effective(model, node, 'stroke-width')).toBe(String(shape.strokeWidth));
      expect(effective(model, node, 'stroke-linecap')).toBe(shape.linecap);
      expect(effective(model, node, 'stroke-linejoin')).toBe(shape.linejoin);
    });
    expect(model.children[3].attrs).toMatchObject({ fill: '#ff8800', 'fill-opacity': '0.4', 'fill-rule': 'evenodd', stroke: 'none' });
    // lớp không tô thì không có thuộc tính fill riêng
    expect(model.children[0].attrs.fill).toBeUndefined();
  });

  it('chỉ ghi fill-opacity và fill-rule khi lớp có tô', () => {
    const noFill = line('currentColor', { fillOpacity: 0.3, fillRule: 'evenodd' });
    const model = buildIconModel(doc([noFill]));
    expect(model.children[0].attrs['fill-opacity']).toBeUndefined();
    expect(model.children[0].attrs['fill-rule']).toBeUndefined();
  });

  it('độ mờ của lớp ghi thành opacity khi nhỏ hơn 1', () => {
    const model = buildIconModel(doc([line('currentColor', { opacity: 0.6 }), line()]));
    expect(model.children[0].attrs.opacity).toBe('0.6');
    expect(model.children[1].attrs.opacity).toBeUndefined();
  });

  it('hình học: hình tròn, elip, chữ nhật (có và không bo góc) và đường', () => {
    const model = buildIconModel(
      doc([
        createShape({ type: 'ellipse', cx: 12, cy: 12, rx: 5, ry: 5 }),
        createShape({ type: 'ellipse', cx: 12, cy: 12, rx: 6, ry: 3 }),
        createShape({ type: 'rect', x: 2, y: 3, width: 10, height: 6, rx: 0 }),
        createShape({ type: 'rect', x: 2, y: 3, width: 10, height: 6, rx: 1.5 }),
        createShape(parsePathData('M 1 1 L 5 5 Z')),
      ]),
    );
    expect(model.children.map((node) => node.tag)).toEqual(['circle', 'ellipse', 'rect', 'rect', 'path']);
    expect(model.children[0].attrs).toEqual({ cx: '12', cy: '12', r: '5' });
    expect(model.children[1].attrs).toEqual({ cx: '12', cy: '12', rx: '6', ry: '3' });
    expect(model.children[2].attrs).toEqual({ x: '2', y: '3', width: '10', height: '6' });
    expect(model.children[3].attrs.rx).toBe('1.5');
    expect(model.children[4].attrs.d).toBe('M 1 1 L 5 5 Z');
  });
});

describe('chế độ màu', () => {
  const mixed = doc([
    line(brandPaint('sapphire')),
    createShape({ type: 'ellipse', cx: 12, cy: 12, rx: 3, ry: 3 }, { stroke: 'none', fill: '#ff0000' }),
    line('#abcdef', { fillOpacity: 0.5 }),
  ]);

  it('currentColor: không còn mã màu hex nào trong SVG, TSX và sprite', () => {
    expect(generateSvg(mixed)).not.toMatch(HEX);
    expect(generateReactComponent(mixed)).not.toMatch(HEX);
    expect(generateSprite([mixed])).not.toMatch(HEX);
    expect(generateSvg(mixed)).toContain('currentColor');
  });

  it('currentColor là chế độ mặc định', () => {
    expect(generateSvg(mixed)).toBe(generateSvg(mixed, { colorMode: 'currentColor' }));
  });

  it('brand: ghi cứng mã hex lấy từ bảng màu', () => {
    const svg = generateSvg(mixed, { colorMode: 'brand' });
    expect(svg).toContain('stroke="#2563eb"');
    expect(svg).toContain('fill="#ff0000"');
    expect(svg).toContain('#abcdef');
    expect(svg).not.toContain('brand:');
  });

  it('brand: dùng bảng màu tuỳ chỉnh và chuẩn hoá hex ngắn/chữ hoa', () => {
    const palette: BrandPalette = { tokens: [{ key: 'sapphire', label: 'Xanh', hex: '#123456' }] };
    const svg = generateSvg(doc([line(brandPaint('sapphire')), line('#ABC')]), { colorMode: 'brand', palette });
    expect(svg).toContain('#123456');
    expect(svg).toContain('#aabbcc');
    expect(svg).not.toContain('#2563eb');
  });

  it('brand: khoá màu không còn trong bảng màu rơi về đen thay vì làm vỡ SVG', () => {
    const svg = generateSvg(doc([line('brand:khong-co')]), { colorMode: 'brand' });
    expect(svg).toContain('stroke="#000000"');
  });

  it('brand: giữ nguyên currentColor và bỏ qua giá trị màu rác', () => {
    const svg = generateSvg(doc([line('currentColor'), line('khong-phai-mau')]), { colorMode: 'brand' });
    expect(svg).not.toMatch(HEX);
    expect(svg).not.toContain('khong-phai-mau');
  });

  it('không cho mã hex trong bảng màu thoát khỏi thuộc tính', () => {
    const palette: BrandPalette = { tokens: [{ key: 'sapphire', label: 'x', hex: '#fff" onload="alert(1)' }] };
    const svg = generateSvg(doc([line(brandPaint('sapphire'))]), { colorMode: 'brand', palette });
    expect(svg).not.toContain('" onload="');
    expect(svg).toContain('&quot;');
  });

  it('brand dùng đúng bảng màu mặc định', () => {
    const svg = generateSvg(doc([line(brandPaint('amber'))]), { colorMode: 'brand', palette: DEFAULT_PALETTE });
    expect(svg).toContain('#f59e0b');
  });
});

describe('generateSvg', () => {
  it('SVG gọn: khai báo xmlns, viewBox, một dòng chú thích và đóng thẻ', () => {
    const svg = generateSvg(doc([line()], { name: 'Chuông' }));
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('<!-- SVNDTS - Chuông -->');
    expect(svg).toContain('<path d="M 4 12 L 20 12" />');
    expect(svg).not.toMatch(/inkscape|sodipodi|adobe/i);
  });

  it('tên có ký tự đặc biệt không đóng sớm được chú thích', () => {
    const svg = generateSvg(doc([line()], { name: 'A --> <b> B -- C' }));
    expect(svg.match(/<!--/g)).toHaveLength(1);
    expect(svg.match(/-->/g)).toHaveLength(1);
    expect(svg).not.toContain('<b>');
    expect(svg).not.toMatch(/<!--[^>]*--[^>]/);
  });

  it('icon rỗng vẫn cho SVG hợp lệ', () => {
    const svg = generateSvg(doc([]));
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('toàn bộ icon mẫu xuất ra đủ số hình hiển thị', () => {
    for (const preset of createPresetDocuments()) {
      const svg = generateSvg(preset);
      const count = (svg.match(/<(path|circle|ellipse|rect) /g) ?? []).length;
      expect(count).toBe(preset.shapes.filter((shape) => !shape.hidden).length);
    }
  });
});

describe('generateReactComponent', () => {
  it('TSX hợp lệ cú pháp cho mọi icon mẫu ở cả hai chế độ màu', () => {
    for (const preset of createPresetDocuments()) {
      for (const colorMode of ['currentColor', 'brand'] as const) {
        expect(syntaxErrors(generateReactComponent(preset, { colorMode }))).toEqual([]);
      }
    }
  });

  it('dùng tên thuộc tính của React, nhận className và các thuộc tính còn lại', () => {
    const tsx = generateReactComponent(
      doc([line('currentColor', { fillOpacity: 0.5, fill: 'currentColor', fillRule: 'evenodd', strokeWidth: 3 }), line()], { name: 'Hộp thư' }),
    );
    expect(tsx).not.toContain('<!--');
    expect(tsx).not.toMatch(/stroke-width|stroke-linecap|stroke-linejoin|fill-opacity|fill-rule/);
    expect(tsx).toContain('strokeWidth=');
    expect(tsx).toContain('fillOpacity=');
    expect(tsx).toContain('fillRule="evenodd"');
    expect(tsx).toContain('className={className}');
    expect(tsx).toContain('{...rest}');
    expect(tsx).toContain('aria-hidden="true"');
    expect(tsx).toContain("import type { SVGProps } from 'react';");
    expect(tsx).toContain('export function HopThuIcon(props: SVGProps<SVGSVGElement>)');
  });

  it('tên và mô tả độc hại không phá được chú thích hay mã', () => {
    const tsx = generateReactComponent(
      doc([line()], {
        name: '*/ evil(); /*',
        description: '*/ import "x"; <script> -->\nlệnh khác',
      }),
    );
    expect(syntaxErrors(tsx)).toEqual([]);
    expect(tsx).not.toContain('<script>');
    // chỉ còn đúng một khối chú thích JSDoc ở đầu hàm, và ngoài khối đó không có mã lạ
    expect(tsx.match(/\/\*\*/g)).toHaveLength(1);
    const withoutComment = tsx.replace(/\/\*\*[\s\S]*?\*\//, '');
    expect(withoutComment).not.toContain('evil');
    expect(withoutComment).not.toContain('import "x"');
  });

  it('icon không có lớp nào vẫn là TSX hợp lệ', () => {
    expect(syntaxErrors(generateReactComponent(doc([])))).toEqual([]);
  });

  it('chế độ currentColor: TSX không chứa mã hex', () => {
    for (const preset of createPresetDocuments()) expect(generateReactComponent(preset)).not.toMatch(HEX);
  });

  it('chế độ brand: TSX chứa hex lấy từ bảng màu', () => {
    const master = createPresetDocuments()[0];
    expect(generateReactComponent(master, { colorMode: 'brand' })).toContain('#2563eb');
  });
});

describe('generateSprite', () => {
  it('mỗi icon một symbol có id và viewBox riêng, gói trong defs ẩn', () => {
    const sprite = generateSprite([doc([line()], { name: 'Chuông' }), doc([line()], { name: 'Hộp thư', size: 32 })]);
    expect(sprite).toContain('style="display:none"');
    expect(sprite).toContain('<defs>');
    expect(sprite).toContain('<symbol id="svndts-chuong" viewBox="0 0 24 24"');
    expect(sprite).toContain('<symbol id="svndts-hop-thu" viewBox="0 0 32 32"');
    expect(sprite.match(/<\/symbol>/g)).toHaveLength(2);
  });

  it('id không bao giờ trùng, kể cả khi tên trùng hoặc đụng độ hậu tố', () => {
    const sprite = generateSprite([
      doc([line()], { name: 'Bell' }),
      doc([line()], { name: 'bell' }),
      doc([line()], { name: 'Bell 2' }),
      doc([line()], { name: 'BELL' }),
    ]);
    const ids = [...sprite.matchAll(/<symbol id="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(ids[0]).toBe('svndts-bell');
  });

  it('không chứa mã hex ở chế độ currentColor', () => {
    expect(generateSprite(createPresetDocuments())).not.toMatch(HEX);
  });

  it('danh sách rỗng vẫn cho SVG hợp lệ', () => {
    expect(generateSprite([])).toContain('<defs>');
  });
});

describe('tên và mã định danh', () => {
  it('toComponentName bỏ dấu tiếng Việt thay vì làm rơi chữ', () => {
    expect(toComponentName('Quản trị Nhân sự (HRM)')).toBe('QuanTriNhanSuHRMIcon');
    expect(toComponentName('Đơn hàng')).toBe('DonHangIcon');
    expect(toComponentName('đường đi')).toBe('DuongDiIcon');
    expect(toComponentName('SVNDTS Master Logo')).toBe('SVNDTSMasterLogoIcon');
  });

  it('toComponentName không thêm Icon lần hai và luôn là định danh hợp lệ', () => {
    expect(toComponentName('Bell Icon')).toBe('BellIcon');
    expect(toComponentName('3D kho')).toBe('Icon3DKhoIcon');
    expect(toComponentName('???')).toBe('BrandIcon');
    expect(toComponentName('')).toBe('BrandIcon');
    expect(toComponentName('你好')).toBe('BrandIcon');
    for (const name of ['a-b_c', '  x  ', 'class', '9', 'icon', 'Đ', 'a'.repeat(200)]) {
      expect(toComponentName(name)).toMatch(/^[A-Za-z][A-Za-z0-9]*$/);
    }
  });

  it('slugify: chữ thường, nối gạch, bỏ dấu', () => {
    expect(slugify('Quản trị Nhân sự (HRM)')).toBe('quan-tri-nhan-su-hrm');
    expect(slugify('Đơn hàng')).toBe('don-hang');
    expect(slugify('  --Bell--  ')).toBe('bell');
    expect(slugify('A/B\\C')).toBe('a-b-c');
  });

  it('slugify: rỗng hoặc toàn ký tự lạ thì thành "icon"', () => {
    expect(slugify('')).toBe('icon');
    expect(slugify('!!!')).toBe('icon');
    expect(slugify('你好')).toBe('icon');
  });

  it('slugify: cắt tối đa 64 ký tự và không kết thúc bằng dấu gạch', () => {
    const name = `${'a'.repeat(63)} ${'b'.repeat(10)}`;
    const slug = slugify(name);
    expect(slug.length).toBeLessThanOrEqual(64);
    expect(slug.endsWith('-')).toBe(false);
    expect(slug).toBe('a'.repeat(63));
    expect(slugify('x'.repeat(100))).toHaveLength(64);
  });

  it('generateIconIndex: mỗi icon một dòng export trỏ đúng file', () => {
    const index = generateIconIndex([doc([], { name: 'Chuông báo' }), doc([], { name: 'Hộp thư' })]);
    expect(index).toBe("export { ChuongBaoIcon } from './chuong-bao.js';\nexport { HopThuIcon } from './hop-thu.js';\n");
    expect(generateIconIndex([])).toBe('\n');
  });

  it('toCamelAttr đổi tên thuộc tính SVG sang kiểu React', () => {
    expect(toCamelAttr('stroke-width')).toBe('strokeWidth');
    expect(toCamelAttr('stroke-linecap')).toBe('strokeLinecap');
    expect(toCamelAttr('fill-opacity')).toBe('fillOpacity');
    expect(toCamelAttr('d')).toBe('d');
    expect(toCamelAttr('viewBox')).toBe('viewBox');
  });
});
