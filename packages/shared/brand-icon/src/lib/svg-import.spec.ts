/**
 * @jest-environment jsdom
 */
import { applyMatrix, geometryBounds } from './geometry';
import { createPresetDocuments } from './legacy';
import type { EllipseGeometry, PathGeometry, RectGeometry } from './model';
import { pathToData } from './path-data';
import { generateSvg } from './render';
import { importSvg, looksLikeSvgMarkup, parseTransform } from './svg-import';
import { normalizeShape } from './validate';

const close = (actual: number, expected: number, digits = 6) => expect(actual).toBeCloseTo(expected, digits);

const lucide = (inner: string, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${extra}>${inner}</svg>`;

const PACKAGE = lucide(
  '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><polyline points="3.29 7 12 12 20.71 7"/><path d="m7.5 4.27 9 5.15"/>',
);
const WORKFLOW = lucide('<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>');
const BELL = lucide('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>');
const SHIELD = lucide(
  '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
);

const svg = (inner: string, attrs = 'viewBox="0 0 24 24"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;

describe('parseTransform', () => {
  it('rỗng hoặc không hợp lệ thì là ma trận đơn vị', () => {
    expect(parseTransform(undefined)).toEqual([1, 0, 0, 1, 0, 0]);
    expect(parseTransform(null)).toEqual([1, 0, 0, 1, 0, 0]);
    expect(parseTransform('')).toEqual([1, 0, 0, 1, 0, 0]);
    expect(parseTransform('lung tung')).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('translate với một hoặc hai tham số', () => {
    expect(applyMatrix(parseTransform('translate(3 4)'), { x: 1, y: 1 })).toEqual({ x: 4, y: 5 });
    expect(applyMatrix(parseTransform('translate(3)'), { x: 1, y: 1 })).toEqual({ x: 4, y: 1 });
    expect(applyMatrix(parseTransform('translate(3,4)'), { x: 0, y: 0 })).toEqual({ x: 3, y: 4 });
  });

  it('scale đều và không đều', () => {
    expect(applyMatrix(parseTransform('scale(2)'), { x: 3, y: 4 })).toEqual({ x: 6, y: 8 });
    expect(applyMatrix(parseTransform('scale(2 -1)'), { x: 3, y: 4 })).toEqual({ x: 6, y: -4 });
  });

  it('rotate quanh gốc và quanh một tâm', () => {
    const origin = applyMatrix(parseTransform('rotate(90)'), { x: 1, y: 0 });
    close(origin.x, 0);
    close(origin.y, 1);
    const around = applyMatrix(parseTransform('rotate(90 12 12)'), { x: 20, y: 12 });
    close(around.x, 12);
    close(around.y, 20);
  });

  it('skewX và skewY', () => {
    const sx = applyMatrix(parseTransform('skewX(45)'), { x: 0, y: 2 });
    close(sx.x, 2);
    close(sx.y, 2);
    const sy = applyMatrix(parseTransform('skewY(45)'), { x: 2, y: 0 });
    close(sy.x, 2);
    close(sy.y, 2);
  });

  it('matrix(a b c d e f)', () => {
    expect(applyMatrix(parseTransform('matrix(1 0 0 1 5 6)'), { x: 1, y: 1 })).toEqual({ x: 6, y: 7 });
    expect(applyMatrix(parseTransform('matrix(2 0 0 3 0 0)'), { x: 1, y: 1 })).toEqual({ x: 2, y: 3 });
    // thiếu tham số thì bỏ qua
    expect(parseTransform('matrix(1 2 3)')).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('danh sách phép biến đổi: phép viết sau áp trước (theo chuẩn SVG)', () => {
    // translate(10 0) scale(2): điểm (1,1) -> scale -> (2,2) -> translate -> (12,2)
    expect(applyMatrix(parseTransform('translate(10 0) scale(2)'), { x: 1, y: 1 })).toEqual({ x: 12, y: 2 });
    expect(applyMatrix(parseTransform('scale(2) translate(10 0)'), { x: 1, y: 1 })).toEqual({ x: 22, y: 2 });
  });

  it('đọc số có dấu, số mũ và số thập phân bắt đầu bằng dấu chấm', () => {
    expect(applyMatrix(parseTransform('translate(-.5,+1e1)'), { x: 0, y: 0 })).toEqual({ x: -0.5, y: 10 });
  });
});

describe('importSvg: icon kiểu Lucide thật', () => {
  it('package: 3 đường + 1 polyline, nét 2, tròn, không tô', () => {
    const result = importSvg(PACKAGE);
    expect(result.shapes).toHaveLength(4);
    expect(result.warnings).toEqual([]);
    expect(result.dominantStrokeWidth).toBe(2);
    for (const shape of result.shapes) {
      expect(shape.fill).toBe('none');
      expect(shape.stroke).toBe('currentColor');
      expect(shape.strokeWidth).toBe(2);
      expect(shape.linecap).toBe('round');
      expect(shape.linejoin).toBe('round');
      expect(shape.geometry.type).toBe('path');
    }
    const outline = result.shapes[0].geometry as PathGeometry;
    expect(outline.subpaths).toHaveLength(1);
    expect(outline.subpaths[0].closed).toBe(true);
    const polyline = result.shapes[2].geometry as PathGeometry;
    expect(polyline.subpaths[0]).toEqual({ closed: false, nodes: [{ x: 3.29, y: 7 }, { x: 12, y: 12 }, { x: 20.71, y: 7 }] });
    // đường dọc M12 22V12
    expect((result.shapes[1].geometry as PathGeometry).subpaths[0].nodes).toEqual([{ x: 12, y: 22 }, { x: 12, y: 12 }]);
  });

  it('workflow: hai hình chữ nhật bo góc giữ nguyên là rect và một đường', () => {
    const result = importSvg(WORKFLOW);
    expect(result.shapes.map((shape) => shape.geometry.type)).toEqual(['rect', 'path', 'rect']);
    expect(result.shapes[0].geometry).toEqual({ type: 'rect', x: 3, y: 3, width: 8, height: 8, rx: 2 });
    expect(result.shapes[2].geometry).toEqual({ type: 'rect', x: 13, y: 13, width: 8, height: 8, rx: 2 });
    const bounds = geometryBounds(result.shapes[1].geometry);
    expect(bounds).toMatchObject({ x: 7, y: 11, width: 6, height: 6 });
  });

  it('bell: hai đường, cung và lệnh s/c/H đọc đúng', () => {
    const result = importSvg(BELL);
    expect(result.shapes).toHaveLength(2);
    const body = result.shapes[0].geometry as PathGeometry;
    const bounds = geometryBounds(body);
    // thân chuông: từ x = 3 đến 21, đỉnh vòm ở y = 2 (bán kính cung 6 quanh tâm y = 8), đáy ở y = 17
    close(bounds.x, 3, 2);
    close(bounds.width, 18, 2);
    close(bounds.y, 2, 2);
    close(bounds.y + bounds.height, 17, 2);
    // cái lưỡi gà: nửa cung bán kính 1,94 nối (10,3 21) với (13,7 21), võng xuống dưới đường nối tới y = 22,005
    const clapper = geometryBounds(result.shapes[1].geometry);
    close(clapper.x, 10.3, 3);
    close(clapper.x + clapper.width, 13.7, 3);
    close(clapper.y, 21, 3);
    close(clapper.y + clapper.height, 22.005, 2);
  });

  it('shield: một đường kín nằm trong lưới 24', () => {
    const result = importSvg(SHIELD);
    expect(result.shapes).toHaveLength(1);
    const shape = result.shapes[0].geometry as PathGeometry;
    expect(shape.subpaths[0].closed).toBe(true);
    const bounds = geometryBounds(shape);
    expect(bounds.x).toBeGreaterThanOrEqual(3.99);
    expect(bounds.y).toBeGreaterThanOrEqual(1.99);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(20.01);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(22.01);
  });

  it('nhập rồi xuất lại SVG rồi nhập lần nữa cho cùng hình dạng', () => {
    for (const markup of [PACKAGE, WORKFLOW, BELL, SHIELD]) {
      const first = importSvg(markup);
      const doc = {
        ...createPresetDocuments()[0],
        shapes: first.shapes,
      };
      const second = importSvg(generateSvg(doc));
      expect(second.shapes).toHaveLength(first.shapes.length);
      second.shapes.forEach((shape, index) => {
        const original = first.shapes[index];
        expect(shape.geometry.type === 'ellipse' ? 'ellipse' : shape.geometry.type).toBe(original.geometry.type);
        if (shape.geometry.type === 'path' && original.geometry.type === 'path') {
          expect(pathToData(shape.geometry)).toBe(pathToData(original.geometry));
        }
        expect(shape.strokeWidth).toBe(original.strokeWidth);
      });
    }
  });
});

describe('importSvg: viewBox và kích thước', () => {
  it('viewBox 512 co về lưới 24, nét co theo và có cảnh báo', () => {
    const result = importSvg(
      svg('<path d="M64 256 L448 256" stroke="currentColor" stroke-width="32" fill="none"/>', 'viewBox="0 0 512 512"'),
    );
    const [shape] = result.shapes;
    const nodes = (shape.geometry as PathGeometry).subpaths[0].nodes;
    close(nodes[0].x, 3);
    close(nodes[0].y, 12);
    close(nodes[1].x, 21);
    expect(shape.strokeWidth).toBe(1.5);
    expect(result.dominantStrokeWidth).toBe(1.5);
    expect(result.warnings.some((warning) => warning.includes('512x512'))).toBe(true);
  });

  it('viewBox không bắt đầu từ gốc và không vuông: co đều rồi căn giữa', () => {
    const result = importSvg(svg('<rect x="10" y="10" width="100" height="50" fill="currentColor"/>', 'viewBox="10 10 100 50"'));
    const rect = result.shapes[0].geometry as RectGeometry;
    close(rect.x, 0);
    close(rect.y, 6);
    close(rect.width, 24);
    close(rect.height, 12);
  });

  it('viewBox có dấu phẩy ngăn cách', () => {
    const result = importSvg(svg('<rect width="12" height="12" fill="currentColor"/>', 'viewBox="0,0,48,48"'));
    const rect = result.shapes[0].geometry as RectGeometry;
    close(rect.width, 6);
  });

  it('không có viewBox: lấy width/height làm cỡ gốc', () => {
    const result = importSvg(svg('<rect width="24" height="24" fill="currentColor"/>', 'width="48" height="48"'));
    close((result.shapes[0].geometry as RectGeometry).width, 12);
  });

  it('width/height kiểu phần trăm bị bỏ qua thay vì co hình về gần 0', () => {
    const result = importSvg(svg('<rect width="10" height="10" fill="currentColor"/>', 'width="100%" height="100%"'));
    close((result.shapes[0].geometry as RectGeometry).width, 10);
    expect(result.warnings).toEqual([]);
  });

  it('không viewBox, không width/height: giữ nguyên toạ độ', () => {
    const result = importSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="currentColor"/></svg>');
    close((result.shapes[0].geometry as RectGeometry).width, 10);
  });

  it('tuỳ chọn size đổi lưới đích', () => {
    const result = importSvg(svg('<rect width="24" height="24" fill="currentColor"/>'), { size: 48 });
    close((result.shapes[0].geometry as RectGeometry).width, 48);
  });

  it('tuỳ chọn strokeWidth ép mọi lớp có nét về một độ dày, lớp chỉ tô không bị ảnh hưởng', () => {
    const result = importSvg(
      lucide('<path d="M1 1 L5 5" stroke-width="3"/><path d="M2 2 L6 6"/><circle cx="12" cy="12" r="2" stroke="none" fill="currentColor"/>'),
      { strokeWidth: 1.75 },
    );
    expect(result.shapes.map((shape) => shape.strokeWidth)).toEqual([1.75, 1.75, 1.75]);
    expect(result.dominantStrokeWidth).toBe(1.75);
    expect(result.shapes[2].stroke).toBe('none');
  });
});

describe('importSvg: transform', () => {
  it('translate trên nhóm dịch mọi hình con', () => {
    const result = importSvg(svg('<g transform="translate(2 3)"><rect x="1" y="1" width="4" height="4" fill="currentColor"/></g>'));
    expect(result.shapes[0].geometry).toMatchObject({ type: 'rect', x: 3, y: 4, width: 4, height: 4 });
  });

  it('transform lồng nhau nhân dồn từ ngoài vào trong', () => {
    const result = importSvg(
      svg('<g transform="translate(10 0)"><g transform="scale(2)"><rect x="1" y="1" width="2" height="2" fill="currentColor"/></g></g>'),
    );
    // (1,1) -> scale -> (2,2) -> translate -> (12,2)
    expect(result.shapes[0].geometry).toMatchObject({ type: 'rect', x: 12, y: 2, width: 4, height: 4 });
  });

  it('transform trên chính phần tử cũng được áp', () => {
    const result = importSvg(svg('<circle cx="4" cy="4" r="2" transform="translate(8 8)" fill="currentColor"/>'));
    expect(result.shapes[0].geometry).toMatchObject({ type: 'ellipse', cx: 12, cy: 12, rx: 2, ry: 2 });
  });

  it('xoay 45 độ biến rect thành path có đúng 4 đỉnh cách tâm xoay đều nhau', () => {
    const result = importSvg(svg('<rect x="4" y="4" width="8" height="8" transform="rotate(45 8 8)" fill="currentColor"/>'));
    const geometry = result.shapes[0].geometry as PathGeometry;
    expect(geometry.type).toBe('path');
    expect(geometry.subpaths[0].nodes).toHaveLength(4);
    for (const node of geometry.subpaths[0].nodes) close(Math.hypot(node.x - 8, node.y - 8), 4 * Math.SQRT2, 5);
  });

  it('xoay bội 90 độ giữ rect là rect', () => {
    const result = importSvg(svg('<rect x="2" y="4" width="4" height="10" transform="rotate(90 12 12)" fill="currentColor"/>'));
    const rect = result.shapes[0].geometry as RectGeometry;
    expect(rect.type).toBe('rect');
    close(rect.width, 10);
    close(rect.height, 4);
  });

  it('độ dày nét nhân theo tỉ lệ của phép biến đổi', () => {
    const result = importSvg(lucide('<g transform="scale(2)"><path d="M1 1 L4 4"/></g>'));
    expect(result.shapes[0].strokeWidth).toBe(4);
  });

  it('matrix có xoay và lật vẫn cho kết quả đúng với từng điểm', () => {
    const result = importSvg(svg('<path d="M0 0 L2 0 L2 2" stroke="currentColor" fill="none" transform="matrix(0 1 -1 0 10 0)"/>'));
    const nodes = (result.shapes[0].geometry as PathGeometry).subpaths[0].nodes;
    // (x,y) -> (-y + 10, x)
    expect(nodes.map((node) => [node.x, node.y])).toEqual([
      [10, 0],
      [10, 2],
      [8, 2],
    ]);
  });
});

describe('importSvg: màu, nét, độ mờ', () => {
  it('thuộc tính fill và stroke dạng hex, none, màu có tên', () => {
    const result = importSvg(
      svg(
        '<path d="M1 1 L5 5" fill="none" stroke="#FF0000"/><path d="M1 1 L5 5Z" fill="#0f0" stroke="none"/><rect width="4" height="4" fill="blue" stroke="none"/>',
      ),
    );
    expect(result.shapes[0]).toMatchObject({ fill: 'none', stroke: '#ff0000' });
    expect(result.shapes[1]).toMatchObject({ fill: '#00ff00', stroke: 'none' });
    expect(result.shapes[2]).toMatchObject({ fill: '#0000ff', stroke: 'none' });
  });

  it('màu đen và currentColor đều thành currentColor để theo ngữ cảnh', () => {
    const result = importSvg(
      svg('<rect width="4" height="4" fill="black"/><rect width="4" height="4" fill="#000"/><rect width="4" height="4" fill="rgb(0,0,0)"/><rect width="4" height="4" fill="currentColor"/>'),
    );
    for (const shape of result.shapes) expect(shape.fill).toBe('currentColor');
  });

  it('rgb() dạng số, dạng phần trăm và rgba()', () => {
    const result = importSvg(
      svg(
        '<rect width="4" height="4" fill="rgb(255, 128, 0)"/><rect width="4" height="4" fill="rgb(100% 0% 50%)"/><rect width="4" height="4" fill="rgba(10,20,30,0.5)"/>',
      ),
    );
    expect(result.shapes.map((shape) => shape.fill)).toEqual(['#ff8000', '#ff0080', '#0a141e']);
  });

  it('hex có kênh trong suốt: giữ màu, bỏ độ trong suốt', () => {
    const result = importSvg(svg('<rect width="4" height="4" fill="#ff000080"/><rect width="4" height="4" fill="#0f08"/>'));
    expect(result.shapes.map((shape) => shape.fill)).toEqual(['#ff0000', '#00ff00']);
    expect(result.warnings).toEqual([]);
  });

  it('transparent là none', () => {
    const result = importSvg(svg('<rect width="4" height="4" fill="transparent" stroke="#123456"/>'));
    expect(result.shapes[0].fill).toBe('none');
  });

  it('màu chuyển sắc hoặc không nhận ra: dùng currentColor và cảnh báo', () => {
    const gradient = importSvg(svg('<rect width="4" height="4" fill="url(#g)"/>'));
    expect(gradient.shapes[0].fill).toBe('currentColor');
    expect(gradient.warnings).toHaveLength(1);
    const unknown = importSvg(svg('<rect width="4" height="4" fill="mausieula"/>'));
    expect(unknown.shapes[0].fill).toBe('currentColor');
    expect(unknown.warnings[0]).toContain('mausieula');
  });

  it('style nội tuyến ghi đè thuộc tính trình bày', () => {
    const result = importSvg(
      svg('<path d="M1 1 L5 5" fill="none" stroke="red" stroke-width="1" style="stroke:#00ff00; stroke-width: 3px ;stroke-linecap:square;fill-opacity:.4"/>'),
    );
    expect(result.shapes[0]).toMatchObject({ stroke: '#00ff00', strokeWidth: 3, linecap: 'square', fill: 'none' });
    expect(result.shapes[0].fillOpacity).toBe(0.4);
  });

  it('style nội tuyến chứa url(...) có dấu hai chấm không làm hỏng việc đọc', () => {
    const result = importSvg(svg('<rect width="4" height="4" style="fill:url(#a);stroke:none"/>'));
    expect(result.shapes[0].fill).toBe('currentColor');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('mặc định theo SVG: tô currentColor, không nét, nét dày 1 nếu có nét mà không khai báo', () => {
    const filled = importSvg(svg('<rect width="4" height="4"/>'));
    expect(filled.shapes[0]).toMatchObject({ fill: 'currentColor', stroke: 'none' });
    expect(filled.dominantStrokeWidth).toBeNull();
    const stroked = importSvg(svg('<path d="M1 1 L5 5" fill="none" stroke="#123456"/>'));
    expect(stroked.shapes[0].strokeWidth).toBe(1);
    expect(stroked.shapes[0].linecap).toBe('butt');
    expect(stroked.shapes[0].linejoin).toBe('miter');
  });

  it('fill và stroke kế thừa từ nhóm, phần tử con ghi đè được; inherit giữ màu của cha', () => {
    const result = importSvg(
      svg(
        '<g fill="#ff0000" stroke="#0000ff" stroke-width="2"><rect width="4" height="4"/><rect width="4" height="4" fill="none"/><rect width="4" height="4" fill="inherit" stroke="inherit"/></g>',
      ),
    );
    expect(result.shapes[0]).toMatchObject({ fill: '#ff0000', stroke: '#0000ff', strokeWidth: 2 });
    expect(result.shapes[1]).toMatchObject({ fill: 'none', stroke: '#0000ff' });
    expect(result.shapes[2]).toMatchObject({ fill: '#ff0000', stroke: '#0000ff' });
  });

  it('opacity nhân dồn qua các nhóm, fill-opacity kế thừa', () => {
    const result = importSvg(
      svg('<g opacity="0.5" fill-opacity="0.8"><g opacity="0.5"><rect width="4" height="4" fill="#ff0000" opacity="0.5"/></g></g>'),
    );
    expect(result.shapes[0].opacity).toBe(0.125);
    expect(result.shapes[0].fillOpacity).toBe(0.8);
  });

  it('stroke-opacity của hình chỉ có nét được gộp vào opacity', () => {
    const result = importSvg(svg('<path d="M1 1 L5 5" fill="none" stroke="#000" stroke-opacity="0.4" opacity="0.5"/>'));
    expect(result.shapes[0].opacity).toBe(0.2);
  });

  it('opacity ngoài khoảng 0-1 được kẹp lại', () => {
    const result = importSvg(svg('<rect width="4" height="4" fill="#ff0000" opacity="5" fill-opacity="-1"/>'));
    expect(result.shapes[0].opacity).toBe(1);
    expect(result.shapes[0].fillOpacity).toBe(0);
  });

  it('fill-rule evenodd và linejoin/linecap hợp lệ được giữ, giá trị lạ bị bỏ', () => {
    const result = importSvg(
      svg(
        '<path d="M0 0 H10 V10 H0Z M3 3 H7 V7 H3Z" fill="#000" fill-rule="evenodd" stroke="#000" stroke-linejoin="bevel" stroke-linecap="lung"/>',
      ),
    );
    expect(result.shapes[0]).toMatchObject({ fillRule: 'evenodd', linejoin: 'bevel', linecap: 'butt' });
  });

  it('nét dày 0 coi như không có nét (không bị nâng lên độ dày tối thiểu)', () => {
    const result = importSvg(svg('<rect width="4" height="4" fill="#ff0000" stroke="#000000" stroke-width="0"/>'));
    expect(result.shapes[0].stroke).toBe('none');
    expect(result.dominantStrokeWidth).toBeNull();
    // chỉ có nét dày 0 và không tô thì không còn gì để nhập
    expect(() => importSvg(svg('<path d="M1 1 L5 5" fill="none" stroke="#000" stroke-width="0"/>'))).toThrow();
  });

  it('id của phần tử làm tên lớp (cắt tối đa 40 ký tự)', () => {
    const result = importSvg(svg(`<rect id="nut-bam" width="4" height="4"/><rect id="${'x'.repeat(60)}" width="4" height="4"/>`));
    expect(result.shapes[0].name).toBe('nut-bam');
    expect(result.shapes[1].name).toHaveLength(40);
  });

  it('hình chỉ có tô thì nét giữ giá trị mặc định của mô hình', () => {
    const result = importSvg(svg('<rect width="4" height="4" fill="#ff0000" stroke="none" stroke-width="9"/>'));
    expect(result.shapes[0].stroke).toBe('none');
    expect(result.shapes[0].strokeWidth).toBe(1.75);
  });
});

describe('importSvg: các loại phần tử', () => {
  it('rect: rx hoặc ry riêng lẻ, rx bị kẹp theo nửa cạnh ngắn, kích thước 0 bị bỏ', () => {
    const result = importSvg(
      svg(
        '<rect width="10" height="10" rx="2" fill="#000"/><rect width="10" height="10" ry="3" fill="#000"/><rect width="10" height="4" rx="99" fill="#000"/><rect width="0" height="4" fill="#000"/><rect width="4" fill="#000"/>',
      ),
    );
    expect(result.shapes).toHaveLength(3);
    expect((result.shapes[0].geometry as RectGeometry).rx).toBe(2);
    expect((result.shapes[1].geometry as RectGeometry).rx).toBe(3);
    expect((result.shapes[2].geometry as RectGeometry).rx).toBe(2);
  });

  it('circle, ellipse, line, polyline, polygon', () => {
    const result = importSvg(
      lucide(
        '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="6" ry="2"/><line x1="1" y1="2" x2="3" y2="4"/><polyline points="1,1 5,1 5,5"/><polygon points="1 1 5 1 5 5"/>',
      ),
    );
    expect(result.shapes.map((shape) => shape.geometry.type)).toEqual(['ellipse', 'ellipse', 'path', 'path', 'path']);
    expect(result.shapes[0].geometry).toMatchObject({ rx: 3, ry: 3 });
    const polyline = result.shapes[3].geometry as PathGeometry;
    const polygon = result.shapes[4].geometry as PathGeometry;
    expect(polyline.subpaths[0].closed).toBe(false);
    expect(polygon.subpaths[0].closed).toBe(true);
    expect(polygon.subpaths[0].nodes).toHaveLength(3);
    expect((result.shapes[2].geometry as PathGeometry).subpaths[0].nodes).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
  });

  it('bán kính 0 hoặc thiếu thì bỏ qua; polyline thiếu điểm bị bỏ', () => {
    const result = importSvg(
      lucide('<circle cx="1" cy="1" r="0"/><ellipse cx="1" cy="1" rx="2"/><polyline points="1 1"/><path d="M1 1 L4 4"/>'),
    );
    expect(result.shapes).toHaveLength(1);
  });

  it('bỏ qua defs, clipPath, mask, symbol, title và các phần tử không vẽ', () => {
    const result = importSvg(
      svg(
        '<title>Tên</title><defs><rect id="a" width="4" height="4"/></defs><clipPath id="c"><rect width="4" height="4"/></clipPath><mask><rect width="4" height="4"/></mask><symbol><rect width="4" height="4"/></symbol><rect width="6" height="6" fill="#000"/>',
      ),
    );
    expect(result.shapes).toHaveLength(1);
    expect((result.shapes[0].geometry as RectGeometry).width).toBe(6);
  });

  it('text, image, use: bỏ qua và cảnh báo', () => {
    const result = importSvg(svg('<text x="1" y="5">A</text><use href="#a"/><rect width="4" height="4"/>'));
    expect(result.shapes).toHaveLength(1);
    expect(result.warnings.some((warning) => warning.includes('chữ'))).toBe(true);
  });

  it('phần tử có display:none (thuộc tính hoặc style) và toàn bộ nhóm bị ẩn không được nhập', () => {
    const result = importSvg(
      svg(
        '<rect width="4" height="4" display="none"/><rect width="5" height="5" style="fill:red; display:none"/><g display="none"><rect width="6" height="6"/></g><rect width="7" height="7"/>',
      ),
    );
    expect(result.shapes).toHaveLength(1);
    expect((result.shapes[0].geometry as RectGeometry).width).toBe(7);
  });

  it('thẻ a và nhóm lồng nhau được duyệt', () => {
    const result = importSvg(svg('<a href="#"><g><g><rect width="4" height="4"/></g></g></a>'));
    expect(result.shapes).toHaveLength(1);
  });

  it('đường dữ liệu sai bị bỏ qua và cảnh báo, hình khác vẫn nhập', () => {
    const result = importSvg(svg('<path d="M 1 1 X 2" fill="#000"/><rect width="4" height="4"/>'));
    expect(result.shapes).toHaveLength(1);
    expect(result.warnings.some((warning) => warning.includes('không hợp lệ'))).toBe(true);
  });

  it('đường dữ liệu quá dài bị bỏ qua và cảnh báo', () => {
    const long = `M 0 0${' L 1 1'.repeat(4000)}`;
    const result = importSvg(svg(`<path d="${long}" fill="#000"/><rect width="4" height="4"/>`));
    expect(result.shapes).toHaveLength(1);
    expect(result.warnings.some((warning) => warning.includes('quá dài'))).toBe(true);
  });

  it('chỉ nhập tối đa 200 hình đầu tiên và báo cho người dùng', () => {
    const many = Array.from({ length: 250 }, (_, index) => `<rect x="${index % 20}" y="0" width="1" height="1"/>`).join('');
    const result = importSvg(svg(many));
    expect(result.shapes).toHaveLength(200);
    expect(result.warnings.some((warning) => warning.includes('200'))).toBe(true);
  });

  it('đúng 200 hình thì không báo cắt bớt', () => {
    const exact = Array.from({ length: 200 }, (_, index) => `<rect x="${index % 20}" y="0" width="1" height="1"/>`).join('');
    const result = importSvg(svg(exact));
    expect(result.shapes).toHaveLength(200);
    expect(result.warnings).toEqual([]);
  });

  it('hình vượt giới hạn của thư viện bị bỏ và báo, hình khác vẫn nhập (nếu giữ lại, cả icon sẽ bị từ chối khi nạp lại)', () => {
    const manyNodes = `M 0 0${' L 1 1'.repeat(2100)}`;
    const manySubpaths = ' M 1 1 L 2 2'.repeat(70);
    const result = importSvg(
      svg(
        `<rect x="5000" y="0" width="10" height="10" fill="#000"/><path d="${manyNodes}" stroke="#000" fill="none"/><path d="${manySubpaths}" stroke="#000" fill="none"/><rect width="4" height="4" fill="#000"/>`,
      ),
    );
    expect(result.shapes).toHaveLength(1);
    expect((result.shapes[0].geometry as RectGeometry).width).toBe(4);
    expect(result.warnings.some((warning) => warning.includes('quá lớn hoặc quá phức tạp'))).toBe(true);
  });

  it('chỉ có hình vượt giới hạn thì báo lỗi không có hình nào', () => {
    expect(() => importSvg(svg('<rect x="5000" y="0" width="10" height="10" fill="#000"/>'))).toThrow(/Không tìm thấy hình/);
  });

  it('mọi hình nhập vào đều qua chuẩn hoá nguyên vẹn (nạp lại không đổi gì)', () => {
    for (const markup of [PACKAGE, WORKFLOW, BELL, SHIELD]) {
      for (const shape of importSvg(markup).shapes) expect(normalizeShape(shape)).toEqual(shape);
    }
  });

  it('nét quá dày được kẹp về giới hạn của thư viện', () => {
    const result = importSvg(lucide('<path d="M1 1 L5 5" stroke-width="40"/>'));
    expect(result.shapes[0].strokeWidth).toBe(6);
    expect(result.dominantStrokeWidth).toBe(6);
  });

  it('cảnh báo trùng lặp được gộp', () => {
    const result = importSvg(svg('<rect width="4" height="4" fill="url(#a)"/><rect width="4" height="4" fill="url(#b)"/>'));
    expect(result.warnings).toHaveLength(1);
  });
});

describe('importSvg: đầu vào không phải SVG đầy đủ hoặc lỗi', () => {
  it('nhận cả vài phần tử rời không có thẻ svg', () => {
    const result = importSvg('<path d="M1 1 L5 5" stroke="#000" fill="none"/><circle cx="12" cy="12" r="2"/>');
    expect(result.shapes).toHaveLength(2);
  });

  it('SVG không khai báo xmlns vẫn đọc được', () => {
    const result = importSvg('<svg viewBox="0 0 24 24"><rect width="4" height="4"/></svg>');
    expect(result.shapes).toHaveLength(1);
  });

  it('ném lỗi khi mã SVG sai cú pháp', () => {
    expect(() => importSvg('<svg viewBox="0 0 24 24"><path d="M1 1"></svg>')).toThrow(/không hợp lệ/);
    expect(() => importSvg('<svg><rect></svg>')).toThrow();
  });

  it('ném lỗi khi không có hình nào để nhập', () => {
    expect(() => importSvg(svg(''))).toThrow(/Không tìm thấy hình/);
    expect(() => importSvg(svg('<g></g><defs><rect width="4" height="4"/></defs>'))).toThrow();
    expect(() => importSvg(svg('<rect width="4" height="4" fill="none" stroke="none"/>'))).toThrow();
  });

  it('mọi lớp nhập vào đều có id riêng và đầy đủ thuộc tính', () => {
    const result = importSvg(PACKAGE);
    const ids = new Set(result.shapes.map((shape) => shape.id));
    expect(ids.size).toBe(result.shapes.length);
    for (const shape of result.shapes) {
      expect(shape.hidden).toBe(false);
      expect(shape.locked).toBe(false);
      expect(shape.name.length).toBeGreaterThan(0);
    }
  });

  it('không lấy hình elip làm đường khi hình đúng là elip có tỉ lệ khác nhau', () => {
    const result = importSvg(svg('<ellipse cx="12" cy="12" rx="8" ry="4" fill="#000"/>'));
    const ellipse = result.shapes[0].geometry as EllipseGeometry;
    expect(ellipse).toMatchObject({ type: 'ellipse', rx: 8, ry: 4 });
  });
});

describe('looksLikeSvgMarkup', () => {
  it('nhận biết mã SVG và loại chuỗi path data', () => {
    expect(looksLikeSvgMarkup('<svg viewBox="0 0 24 24"></svg>')).toBe(true);
    expect(looksLikeSvgMarkup('  <?xml version="1.0"?><svg/>')).toBe(true);
    expect(looksLikeSvgMarkup('<path d="M1 1"/>')).toBe(true);
    expect(looksLikeSvgMarkup('<circle cx="1"/>')).toBe(true);
    expect(looksLikeSvgMarkup('M 1 1 L 5 5')).toBe(false);
    expect(looksLikeSvgMarkup('<div>x</div>')).toBe(false);
    expect(looksLikeSvgMarkup('')).toBe(false);
  });
});
