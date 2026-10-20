import {
  IDENTITY,
  alignOffsets,
  applyMatrix,
  deleteNode,
  distributeOffsets,
  ellipseToPath,
  flattenGeometry,
  geometryBounds,
  geometryToPath,
  hitTestShape,
  insertNode,
  isQuarterTurn,
  isScaleOnly,
  mapRectMatrix,
  moveNode,
  multiply,
  nearestOnPath,
  nodeIsSmooth,
  normalizeRect,
  rectCenter,
  rectToPath,
  rectsIntersect,
  rotation,
  scaling,
  setHandle,
  setNodePosition,
  toggleNodeSmooth,
  toggleSubpathClosed,
  transformGeometry,
  transformShape,
  translateShape,
  translation,
  unionRects,
  visualBounds,
  type Matrix,
} from './geometry.js';
import {
  createShape,
  type EllipseGeometry,
  type PathGeometry,
  type Point,
  type RectGeometry,
} from './model.js';
import { parsePathData } from './path-data.js';

const close = (actual: number, expected: number, digits = 6) => expect(actual).toBeCloseTo(expected, digits);
const pointClose = (actual: Point | undefined, expected: Point, digits = 6) => {
  expect(actual).toBeDefined();
  close((actual as Point).x, expected.x, digits);
  close((actual as Point).y, expected.y, digits);
};
const rect = (x: number, y: number, width: number, height: number, rx = 0): RectGeometry => ({ type: 'rect', x, y, width, height, rx });
const ellipse = (cx: number, cy: number, rx: number, ry: number): EllipseGeometry => ({ type: 'ellipse', cx, cy, rx, ry });
const path = (data: string): PathGeometry => parsePathData(data);

/** Điểm trên Bezier bậc ba theo tham số t. */
const cubicPoint = (p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point => {
  const mt = 1 - t;
  const f = (a: number, b: number, c: number, d: number) => mt ** 3 * a + 3 * mt * mt * t * b + 3 * mt * t * t * c + t ** 3 * d;
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
};

describe('ma trận', () => {
  it('multiply(first, second) áp second trước rồi first', () => {
    const matrix = multiply(translation(10, 0), scaling(2, 2));
    expect(applyMatrix(matrix, { x: 1, y: 1 })).toEqual({ x: 12, y: 2 });
    const reversed = multiply(scaling(2, 2), translation(10, 0));
    expect(applyMatrix(reversed, { x: 1, y: 1 })).toEqual({ x: 22, y: 2 });
  });

  it('IDENTITY là phần tử trung hoà', () => {
    const matrix: Matrix = [2, 1, -1, 3, 5, 7];
    expect(multiply(IDENTITY, matrix)).toEqual(matrix);
    expect(multiply(matrix, IDENTITY)).toEqual(matrix);
  });

  it('scaling quanh một tâm giữ nguyên tâm', () => {
    const matrix = scaling(3, 2, 10, 20);
    expect(applyMatrix(matrix, { x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
    expect(applyMatrix(matrix, { x: 11, y: 21 })).toEqual({ x: 13, y: 22 });
  });

  it('scaling âm là phép lật quanh tâm', () => {
    const matrix = scaling(-1, 1, 12, 12);
    expect(applyMatrix(matrix, { x: 2, y: 5 })).toEqual({ x: 22, y: 5 });
  });

  it('rotation dương xoay theo chiều kim đồng hồ trên màn hình (trục y hướng xuống)', () => {
    const matrix = rotation(90);
    const point = applyMatrix(matrix, { x: 1, y: 0 });
    pointClose(point, { x: 0, y: 1 });
  });

  it('rotation quanh tâm giữ nguyên tâm và xoay các điểm khác', () => {
    const matrix = rotation(90, 12, 12);
    pointClose(applyMatrix(matrix, { x: 12, y: 12 }), { x: 12, y: 12 });
    pointClose(applyMatrix(matrix, { x: 20, y: 12 }), { x: 12, y: 20 });
    pointClose(applyMatrix(matrix, { x: 12, y: 4 }), { x: 20, y: 12 });
  });

  it('isScaleOnly và isQuarterTurn phân loại đúng', () => {
    expect(isScaleOnly(IDENTITY)).toBe(true);
    expect(isScaleOnly(scaling(2, -1))).toBe(true);
    expect(isScaleOnly(rotation(90))).toBe(false);
    expect(isQuarterTurn(rotation(90))).toBe(true);
    expect(isQuarterTurn(rotation(270, 5, 5))).toBe(true);
    expect(isQuarterTurn(rotation(45))).toBe(false);
    expect(isQuarterTurn(IDENTITY)).toBe(false);
  });

  it('mapRectMatrix ánh xạ khung này sang khung kia', () => {
    const matrix = mapRectMatrix({ x: 2, y: 4, width: 4, height: 8 }, { x: 10, y: 10, width: 8, height: 8 });
    expect(applyMatrix(matrix, { x: 2, y: 4 })).toEqual({ x: 10, y: 10 });
    expect(applyMatrix(matrix, { x: 6, y: 12 })).toEqual({ x: 18, y: 18 });
  });

  it('mapRectMatrix không chia cho 0 khi khung nguồn rỗng', () => {
    const matrix = mapRectMatrix({ x: 5, y: 5, width: 0, height: 0 }, { x: 1, y: 2, width: 9, height: 9 });
    expect(matrix.every(Number.isFinite)).toBe(true);
    expect(applyMatrix(matrix, { x: 5, y: 5 })).toEqual({ x: 1, y: 2 });
  });
});

describe('rectToPath / ellipseToPath', () => {
  it('hình chữ nhật góc vuông thành 4 điểm đóng, không tay cầm', () => {
    const geometry = rectToPath(rect(2, 3, 10, 6));
    expect(geometry.subpaths).toHaveLength(1);
    expect(geometry.subpaths[0].closed).toBe(true);
    expect(geometry.subpaths[0].nodes).toEqual([
      { x: 2, y: 3 },
      { x: 12, y: 3 },
      { x: 12, y: 9 },
      { x: 2, y: 9 },
    ]);
  });

  it('hình chữ nhật bo góc có 8 điểm và khung bao đúng bằng hình gốc', () => {
    const geometry = rectToPath(rect(2, 3, 10, 6, 2));
    expect(geometry.subpaths[0].nodes).toHaveLength(8);
    const bounds = geometryBounds(geometry);
    close(bounds.x, 2);
    close(bounds.y, 3);
    close(bounds.width, 10);
    close(bounds.height, 6);
  });

  it('bán kính bo góc lớn hơn nửa cạnh ngắn được kẹp lại', () => {
    const geometry = rectToPath(rect(0, 0, 10, 4, 99));
    const bounds = geometryBounds(geometry);
    close(bounds.width, 10);
    close(bounds.height, 4);
    // bo hết cạnh ngắn: điểm đầu tiên cách mép trái đúng 2
    expect(geometry.subpaths[0].nodes[0].x).toBeCloseTo(2);
  });

  it('bán kính âm coi như góc vuông', () => {
    expect(rectToPath(rect(0, 0, 4, 4, -3)).subpaths[0].nodes).toHaveLength(4);
  });

  it('elip thành 4 điểm có tay cầm và khung bao khớp', () => {
    const geometry = ellipseToPath(ellipse(12, 10, 8, 5));
    expect(geometry.subpaths[0].nodes).toHaveLength(4);
    expect(geometry.subpaths[0].closed).toBe(true);
    const bounds = geometryBounds(geometry);
    close(bounds.x, 4, 3);
    close(bounds.y, 5, 3);
    close(bounds.width, 16, 3);
    close(bounds.height, 10, 3);
  });

  it('các điểm giữa của elip nằm trên elip (sai số của Bezier dưới 0,03%)', () => {
    const geometry = ellipseToPath(ellipse(0, 0, 10, 10));
    const [top, right] = geometry.subpaths[0].nodes;
    const middle = cubicPoint(top, top.hout as Point, right.hin as Point, right, 0.5);
    close(Math.hypot(middle.x, middle.y), 10, 1);
  });

  it('geometryToPath giữ nguyên đường và đổi rect, elip', () => {
    const existing = path('M 0 0 L 4 4');
    expect(geometryToPath(existing)).toBe(existing);
    expect(geometryToPath(rect(0, 0, 4, 4)).type).toBe('path');
    expect(geometryToPath(ellipse(4, 4, 2, 2)).type).toBe('path');
  });
});

describe('transformGeometry', () => {
  it('rect chỉ co giãn/tịnh tiến thì vẫn là rect và rx co theo', () => {
    const result = transformGeometry(rect(2, 2, 4, 6, 1), multiply(translation(10, 0), scaling(2, 2))) as RectGeometry;
    expect(result.type).toBe('rect');
    expect(result).toMatchObject({ x: 14, y: 4, width: 8, height: 12 });
    close(result.rx, 2);
  });

  it('rect lật ngang vẫn có chiều rộng dương', () => {
    const result = transformGeometry(rect(2, 2, 4, 6), scaling(-1, 1, 12, 12)) as RectGeometry;
    expect(result).toMatchObject({ type: 'rect', x: 18, y: 2, width: 4, height: 6 });
  });

  it('rect xoay bội 90 độ đổi chỗ chiều rộng và chiều cao', () => {
    const result = transformGeometry(rect(2, 4, 4, 10), rotation(90, 12, 12)) as RectGeometry;
    expect(result.type).toBe('rect');
    close(result.width, 10);
    close(result.height, 4);
    const direct = applyMatrix(rotation(90, 12, 12), { x: 2, y: 4 });
    const other = applyMatrix(rotation(90, 12, 12), { x: 6, y: 14 });
    close(result.x, Math.min(direct.x, other.x));
    close(result.y, Math.min(direct.y, other.y));
  });

  it('rect xoay góc bất kỳ thành path đúng bốn đỉnh đã xoay', () => {
    const matrix = rotation(30, 12, 12);
    const result = transformGeometry(rect(4, 4, 8, 6), matrix);
    expect(result.type).toBe('path');
    const nodes = (result as PathGeometry).subpaths[0].nodes;
    expect(nodes).toHaveLength(4);
    pointClose(nodes[0], applyMatrix(matrix, { x: 4, y: 4 }));
    pointClose(nodes[2], applyMatrix(matrix, { x: 12, y: 10 }));
  });

  it('elip co giãn vẫn là elip với bán kính đúng', () => {
    const result = transformGeometry(ellipse(5, 5, 2, 3), scaling(2, -3)) as EllipseGeometry;
    expect(result).toMatchObject({ type: 'ellipse', cx: 10, cy: -15, rx: 4, ry: 9 });
  });

  it('elip xoay 90 độ đổi chỗ hai bán kính', () => {
    const result = transformGeometry(ellipse(12, 12, 8, 4), rotation(90, 12, 12)) as EllipseGeometry;
    expect(result.type).toBe('ellipse');
    close(result.rx, 4);
    close(result.ry, 8);
    close(result.cx, 12);
    close(result.cy, 12);
  });

  it('elip xoay 45 độ thành path', () => {
    expect(transformGeometry(ellipse(12, 12, 8, 4), rotation(45, 12, 12)).type).toBe('path');
  });

  it('path biến đổi cả điểm neo lẫn tay cầm', () => {
    const geometry = path('M 0 0 C 1 0 2 1 3 3');
    const result = transformGeometry(geometry, multiply(translation(10, 10), scaling(2, 2))) as PathGeometry;
    const [a, b] = result.subpaths[0].nodes;
    expect(a).toEqual({ x: 10, y: 10, hout: { x: 12, y: 10 } });
    expect(b).toEqual({ x: 16, y: 16, hin: { x: 14, y: 12 } });
    expect(result.subpaths[0].closed).toBe(false);
  });

  it('không làm thay đổi dữ liệu gốc', () => {
    const geometry = path('M 0 0 L 4 4');
    const snapshot = JSON.stringify(geometry);
    transformGeometry(geometry, translation(5, 5));
    expect(JSON.stringify(geometry)).toBe(snapshot);
  });

  it('transformShape giữ nguyên kiểu dáng, translateShape dịch hình', () => {
    const shape = createShape(rect(0, 0, 4, 4), { stroke: '#ff0000', strokeWidth: 2 });
    const moved = translateShape(shape, 3, 5);
    expect(moved.geometry).toMatchObject({ x: 3, y: 5 });
    expect(moved.id).toBe(shape.id);
    expect(moved.stroke).toBe('#ff0000');
    expect(transformShape(shape, IDENTITY).geometry).toMatchObject({ x: 0, y: 0, width: 4 });
  });
});

describe('khung bao', () => {
  it('đường thẳng: khung bao theo điểm neo', () => {
    expect(geometryBounds(path('M 2 3 L 10 8'))).toEqual({ x: 2, y: 3, width: 8, height: 5 });
  });

  it('đường cong phình ra ngoài các điểm neo thì khung bao phải tính cả cực trị', () => {
    // Bezier từ (0,0) tới (10,0) với tay cầm kéo lên y = -10: đỉnh thật ở y = -7,5
    const bounds = geometryBounds(path('M 0 0 C 0 -10 10 -10 10 0'));
    close(bounds.x, 0);
    close(bounds.width, 10);
    close(bounds.y, -7.5, 5);
    close(bounds.height, 7.5, 5);
  });

  it('đường cong vượt cả hai phía theo trục x', () => {
    const bounds = geometryBounds(path('M 0 0 C 8 0 -8 10 0 10'));
    expect(bounds.x).toBeLessThan(0);
    expect(bounds.x + bounds.width).toBeGreaterThan(0);
  });

  it('tính cả đoạn đóng của đường kín có cong', () => {
    const geometry: PathGeometry = {
      type: 'path',
      subpaths: [
        {
          closed: true,
          nodes: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10, hout: { x: 10, y: 30 } },
          ],
        },
      ],
    };
    // đoạn đóng từ (10,10) về (0,0) có tay cầm ra rất xa nên khung bao phải cao hơn 10
    expect(geometryBounds(geometry).height).toBeGreaterThan(10);
  });

  it('rect và elip lấy trực tiếp từ tham số', () => {
    expect(geometryBounds(rect(1, 2, 3, 4))).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(geometryBounds(ellipse(10, 10, 3, 2))).toEqual({ x: 7, y: 8, width: 6, height: 4 });
  });

  it('đường rỗng cho khung bao bằng 0', () => {
    expect(geometryBounds({ type: 'path', subpaths: [] })).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('visualBounds mở rộng nửa độ dày nét mỗi phía, bỏ qua khi nét là none', () => {
    const stroked = createShape(rect(4, 4, 8, 8), { strokeWidth: 2 });
    expect(visualBounds(stroked)).toEqual({ x: 3, y: 3, width: 10, height: 10 });
    const filled = createShape(rect(4, 4, 8, 8), { stroke: 'none', fill: '#000000', strokeWidth: 4 });
    expect(visualBounds(filled)).toEqual({ x: 4, y: 4, width: 8, height: 8 });
  });

  it('unionRects, rectsIntersect, rectCenter, normalizeRect', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([{ x: 0, y: 0, width: 2, height: 2 }, { x: 5, y: 1, width: 1, height: 6 }])).toEqual({
      x: 0,
      y: 0,
      width: 6,
      height: 7,
    });
    const a = { x: 0, y: 0, width: 4, height: 4 };
    expect(rectsIntersect(a, { x: 3, y: 3, width: 4, height: 4 })).toBe(true);
    expect(rectsIntersect(a, { x: 4, y: 0, width: 2, height: 2 })).toBe(true);
    expect(rectsIntersect(a, { x: 4.5, y: 0, width: 2, height: 2 })).toBe(false);
    expect(rectCenter(a)).toEqual({ x: 2, y: 2 });
    expect(normalizeRect({ x: 5, y: 1 }, { x: 2, y: 9 })).toEqual({ x: 2, y: 1, width: 3, height: 8 });
  });
});

describe('làm phẳng và nhấp chọn', () => {
  it('flattenGeometry giữ trạng thái đóng và bám sát đường cong', () => {
    const lines = flattenGeometry(ellipse(12, 12, 8, 8));
    expect(lines).toHaveLength(1);
    expect(lines[0].closed).toBe(true);
    for (const point of lines[0].points) close(Math.hypot(point.x - 12, point.y - 12), 8, 1);
  });

  it('flattenGeometry của đường thẳng không thêm điểm thừa', () => {
    const lines = flattenGeometry(path('M 0 0 L 4 0 L 4 4'));
    expect(lines[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
    ]);
    expect(lines[0].closed).toBe(false);
  });

  it('chỉ có nét: nhấp gần nét thì trúng, xa nét thì trượt', () => {
    const shape = createShape(path('M 2 12 L 22 12'), { strokeWidth: 2 });
    expect(hitTestShape(shape, { x: 12, y: 12 }, 0)).toBe(true);
    expect(hitTestShape(shape, { x: 12, y: 12.9 }, 0)).toBe(true);
    expect(hitTestShape(shape, { x: 12, y: 13.5 }, 0)).toBe(false);
    expect(hitTestShape(shape, { x: 12, y: 13.5 }, 0.6)).toBe(true);
    expect(hitTestShape(shape, { x: 30, y: 12 }, 0.4)).toBe(false);
  });

  it('chỉ có nét và hình kín: nhấp vào ruột rỗng thì trượt', () => {
    const shape = createShape(rect(4, 4, 16, 16), { strokeWidth: 1 });
    expect(hitTestShape(shape, { x: 12, y: 12 }, 0)).toBe(false);
    expect(hitTestShape(shape, { x: 4, y: 12 }, 0)).toBe(true);
  });

  it('có tô: nhấp vào bên trong thì trúng, kể cả khi không có nét', () => {
    const shape = createShape(rect(4, 4, 16, 16), { fill: '#000000', stroke: 'none' });
    expect(hitTestShape(shape, { x: 12, y: 12 }, 0)).toBe(true);
    expect(hitTestShape(shape, { x: 2, y: 12 }, 0)).toBe(false);
  });

  it('tô đường mở: coi như đóng ngầm để tính điểm bên trong', () => {
    const shape = createShape(path('M 4 4 L 20 4 L 20 20'), { fill: '#000000', stroke: 'none' });
    expect(hitTestShape(shape, { x: 16, y: 8 }, 0)).toBe(true);
    expect(hitTestShape(shape, { x: 6, y: 16 }, 0)).toBe(false);
  });

  it('lỗ ở giữa: nonzero cùng chiều thì lấp đầy, evenodd thì để trống', () => {
    const data = 'M 0 0 H 24 V 24 H 0 Z M 8 8 H 16 V 16 H 8 Z';
    const nonzero = createShape(path(data), { fill: '#000000', stroke: 'none', fillRule: 'nonzero' });
    const evenodd = createShape(path(data), { fill: '#000000', stroke: 'none', fillRule: 'evenodd' });
    expect(hitTestShape(nonzero, { x: 12, y: 12 }, 0)).toBe(true);
    expect(hitTestShape(evenodd, { x: 12, y: 12 }, 0)).toBe(false);
    expect(hitTestShape(evenodd, { x: 4, y: 4 }, 0)).toBe(true);
  });

  it('lỗ ngược chiều: nonzero cũng để trống', () => {
    const data = 'M 0 0 H 24 V 24 H 0 Z M 8 8 V 16 H 16 V 8 Z';
    const shape = createShape(path(data), { fill: '#000000', stroke: 'none', fillRule: 'nonzero' });
    expect(hitTestShape(shape, { x: 12, y: 12 }, 0)).toBe(false);
    expect(hitTestShape(shape, { x: 4, y: 4 }, 0)).toBe(true);
  });

  it('ngôi sao năm cánh tự cắt: evenodd bỏ trống phần ruột, nonzero thì tô', () => {
    const star = 'M 12 2 L 18.5 21 L 2.5 9 L 21.5 9 L 5.5 21 Z';
    const evenodd = createShape(path(star), { fill: '#000000', stroke: 'none', fillRule: 'evenodd' });
    const nonzero = createShape(path(star), { fill: '#000000', stroke: 'none', fillRule: 'nonzero' });
    // tâm ngôi sao nằm trong ngũ giác ruột (số vòng quấn 2)
    expect(hitTestShape(nonzero, { x: 12, y: 12 }, 0)).toBe(true);
    expect(hitTestShape(evenodd, { x: 12, y: 12 }, 0)).toBe(false);
    // đầu cánh chỉ bị phủ một lần nên cả hai quy tắc đều tô
    expect(hitTestShape(evenodd, { x: 12, y: 5 }, 0)).toBe(true);
    expect(hitTestShape(nonzero, { x: 12, y: 5 }, 0)).toBe(true);
  });

  it('hình không nét không tô vẫn nhấp chọn được theo đường viền', () => {
    const shape = createShape(rect(4, 4, 16, 16), { stroke: 'none', fill: 'none' });
    expect(hitTestShape(shape, { x: 4, y: 12 }, 0.5)).toBe(true);
    expect(hitTestShape(shape, { x: 12, y: 12 }, 0.5)).toBe(false);
  });

  it('nhấp trúng chấm đơn lẻ có nét', () => {
    const shape = createShape({ type: 'path', subpaths: [{ closed: false, nodes: [{ x: 5, y: 5 }] }] }, { strokeWidth: 2 });
    expect(hitTestShape(shape, { x: 5.5, y: 5 }, 0)).toBe(true);
    expect(hitTestShape(shape, { x: 8, y: 5 }, 0)).toBe(false);
  });
});

describe('thao tác điểm neo', () => {
  const triangle = () => path('M 0 0 L 10 0 L 10 10 Z');

  it('moveNode dời điểm cùng tay cầm, không đụng điểm khác', () => {
    const geometry = path('M 0 0 C 1 0 2 1 3 3 L 8 8');
    const moved = moveNode(geometry, 0, 1, 2, 3);
    expect(moved.subpaths[0].nodes[1]).toEqual({ x: 5, y: 6, hin: { x: 4, y: 4 } });
    expect(moved.subpaths[0].nodes[0]).toEqual(geometry.subpaths[0].nodes[0]);
    expect(geometry.subpaths[0].nodes[1]).toEqual({ x: 3, y: 3, hin: { x: 2, y: 1 } });
  });

  it('moveNode với chỉ số sai trả về nguyên đường', () => {
    const geometry = triangle();
    expect(moveNode(geometry, 0, 9, 1, 1)).toBe(geometry);
    expect(moveNode(geometry, 5, 0, 1, 1)).toBe(geometry);
  });

  it('setNodePosition đặt điểm tại toạ độ tuyệt đối', () => {
    const moved = setNodePosition(triangle(), 0, 2, 4, 5);
    expect(moved.subpaths[0].nodes[2]).toEqual({ x: 4, y: 5 });
  });

  it('setHandle none chỉ đổi một tay cầm', () => {
    const geometry = path('M 0 0 C 1 0 2 1 3 3 C 4 5 6 6 7 7');
    const result = setHandle(geometry, 0, 1, 'hout', { x: 5, y: 5 });
    expect(result.subpaths[0].nodes[1].hout).toEqual({ x: 5, y: 5 });
    expect(result.subpaths[0].nodes[1].hin).toEqual({ x: 2, y: 1 });
  });

  it('setHandle collinear giữ độ dài tay cầm đối diện và đặt thẳng hàng ngược hướng', () => {
    const geometry: PathGeometry = {
      type: 'path',
      subpaths: [{ closed: false, nodes: [{ x: 0, y: 0 }, { x: 10, y: 10, hin: { x: 8, y: 10 }, hout: { x: 14, y: 10 } }, { x: 20, y: 20 }] }],
    };
    const result = setHandle(geometry, 0, 1, 'hout', { x: 10, y: 14 }, 'collinear');
    const node = result.subpaths[0].nodes[1];
    expect(node.hout).toEqual({ x: 10, y: 14 });
    // tay cầm vào cũ dài 2 -> giữ dài 2, đổi hướng thành ngược với tay cầm ra (lên trên)
    pointClose(node.hin, { x: 10, y: 8 });
  });

  it('setHandle symmetric làm hai tay cầm đối xứng hoàn toàn', () => {
    const geometry: PathGeometry = {
      type: 'path',
      subpaths: [{ closed: false, nodes: [{ x: 0, y: 0 }, { x: 10, y: 10, hin: { x: 8, y: 10 } }, { x: 20, y: 20 }] }],
    };
    const result = setHandle(geometry, 0, 1, 'hout', { x: 13, y: 14 }, 'symmetric');
    pointClose(result.subpaths[0].nodes[1].hin, { x: 7, y: 6 });
  });

  it('setHandle collinear khi chưa có tay cầm đối diện lấy cùng độ dài', () => {
    const geometry: PathGeometry = {
      type: 'path',
      subpaths: [{ closed: false, nodes: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }] }],
    };
    const result = setHandle(geometry, 0, 1, 'hin', { x: 7, y: 10 }, 'collinear');
    pointClose(result.subpaths[0].nodes[1].hout, { x: 13, y: 10 });
  });

  it('setHandle đặt tay cầm trùng điểm neo thì không chia cho 0', () => {
    const geometry: PathGeometry = {
      type: 'path',
      subpaths: [{ closed: false, nodes: [{ x: 0, y: 0 }, { x: 10, y: 10, hin: { x: 8, y: 10 } }, { x: 20, y: 20 }] }],
    };
    const result = setHandle(geometry, 0, 1, 'hout', { x: 10, y: 10 }, 'collinear');
    expect(result.subpaths[0].nodes[1].hin).toEqual({ x: 8, y: 10 });
  });

  it('toggleNodeSmooth: góc nhọn thành trơn với tay cầm thẳng hàng song song với hai điểm lân cận', () => {
    const geometry = path('M 0 0 L 10 0 L 10 10');
    const smooth = toggleNodeSmooth(geometry, 0, 1);
    const node = smooth.subpaths[0].nodes[1];
    expect(nodeIsSmooth(node)).toBe(true);
    // hướng tiếp tuyến = từ điểm 0 tới điểm 2: (10,10)/|..|
    const ux = 10 / Math.hypot(10, 10);
    const uy = 10 / Math.hypot(10, 10);
    pointClose(node.hin, { x: 10 - ux * (10 / 3), y: 0 - uy * (10 / 3) });
    pointClose(node.hout, { x: 10 + ux * (10 / 3), y: 0 + uy * (10 / 3) });
  });

  it('toggleNodeSmooth hai lần trở về góc nhọn', () => {
    const geometry = path('M 0 0 L 10 0 L 10 10');
    const back = toggleNodeSmooth(toggleNodeSmooth(geometry, 0, 1), 0, 1);
    expect(back.subpaths[0].nodes[1]).toEqual({ x: 10, y: 0 });
    expect(nodeIsSmooth(back.subpaths[0].nodes[1])).toBe(false);
  });

  it('toggleNodeSmooth điểm đầu của đường kín dùng điểm cuối làm lân cận', () => {
    const smooth = toggleNodeSmooth(triangle(), 0, 0);
    const node = smooth.subpaths[0].nodes[0];
    expect(node.hin).toBeDefined();
    expect(node.hout).toBeDefined();
  });

  it('toggleNodeSmooth điểm đầu của đường mở chỉ có tay cầm ra', () => {
    const smooth = toggleNodeSmooth(path('M 0 0 L 10 0 L 10 10'), 0, 0);
    const node = smooth.subpaths[0].nodes[0];
    expect(node.hin).toBeUndefined();
    pointClose(node.hout, { x: 10 / 3, y: 0 });
  });

  it('deleteNode bỏ điểm và giữ nguyên trạng thái đóng khi còn từ 3 điểm', () => {
    const square = path('M 0 0 L 10 0 L 10 10 L 0 10 Z');
    const result = deleteNode(square, 0, 1);
    expect(result.subpaths[0].nodes).toHaveLength(3);
    expect(result.subpaths[0].closed).toBe(true);
  });

  it('deleteNode làm đường kín còn 2 điểm thì chuyển thành đường mở', () => {
    const result = deleteNode(triangle(), 0, 0);
    expect(result.subpaths[0].nodes).toHaveLength(2);
    expect(result.subpaths[0].closed).toBe(false);
  });

  it('deleteNode còn dưới 2 điểm thì bỏ luôn đường con', () => {
    const result = deleteNode(path('M 0 0 L 4 4 M 8 8 L 9 9'), 0, 0);
    expect(result.subpaths).toHaveLength(1);
    expect(result.subpaths[0].nodes[0]).toEqual({ x: 8, y: 8 });
  });

  it('toggleSubpathClosed chỉ áp dụng từ 3 điểm', () => {
    const open = path('M 0 0 L 4 0 L 4 4');
    expect(toggleSubpathClosed(open, 0).subpaths[0].closed).toBe(true);
    expect(toggleSubpathClosed(toggleSubpathClosed(open, 0), 0).subpaths[0].closed).toBe(false);
    const line = path('M 0 0 L 4 0');
    expect(toggleSubpathClosed(line, 0)).toBe(line);
  });
});

describe('insertNode', () => {
  it('đoạn thẳng: chèn đúng tại tham số t', () => {
    const result = insertNode(path('M 0 0 L 10 0 L 10 10'), 0, 0, 0.25);
    expect(result.subpaths[0].nodes.map((node) => [node.x, node.y])).toEqual([
      [0, 0],
      [2.5, 0],
      [10, 0],
      [10, 10],
    ]);
  });

  it('đoạn cong: giữ nguyên hình dạng (điểm mới nằm trên đường cong cũ, hai nửa ghép lại đúng)', () => {
    const geometry = path('M 0 0 C 0 10 10 10 10 0');
    const [p0, p3] = geometry.subpaths[0].nodes;
    const p1 = p0.hout as Point;
    const p2 = p3.hin as Point;
    const result = insertNode(geometry, 0, 0, 0.3);
    const [a, mid, b] = result.subpaths[0].nodes;
    pointClose(mid, cubicPoint(p0, p1, p2, p3, 0.3));
    // nửa đầu: tại tham số 0,5 trên nửa đầu = điểm tại t = 0,15 của đường gốc
    pointClose(cubicPoint(a, a.hout as Point, mid.hin as Point, mid, 0.5), cubicPoint(p0, p1, p2, p3, 0.15));
    // nửa sau: tại tham số 0,5 = điểm tại t = 0,65 của đường gốc
    pointClose(cubicPoint(mid, mid.hout as Point, b.hin as Point, b, 0.5), cubicPoint(p0, p1, p2, p3, 0.65));
    // khung bao không đổi
    const before = geometryBounds(geometry);
    const after = geometryBounds(result);
    close(after.x, before.x, 5);
    close(after.y, before.y, 5);
    close(after.width, before.width, 5);
    close(after.height, before.height, 5);
  });

  it('đoạn đóng của đường kín: chèn điểm vào cuối danh sách', () => {
    const result = insertNode(path('M 0 0 L 10 0 L 10 10 Z'), 0, 2, 0.5);
    const nodes = result.subpaths[0].nodes;
    expect(nodes).toHaveLength(4);
    expect(nodes[3]).toEqual({ x: 5, y: 5 });
    expect(result.subpaths[0].closed).toBe(true);
  });

  it('đoạn đóng có đường cong: cập nhật tay cầm của điểm cuối và điểm đầu', () => {
    const geometry: PathGeometry = {
      type: 'path',
      subpaths: [
        {
          closed: true,
          nodes: [
            { x: 0, y: 0, hin: { x: 0, y: 5 } },
            { x: 10, y: 0 },
            { x: 10, y: 10, hout: { x: 5, y: 15 } },
          ],
        },
      ],
    };
    const result = insertNode(geometry, 0, 2, 0.5);
    const nodes = result.subpaths[0].nodes;
    expect(nodes).toHaveLength(4);
    const from = geometry.subpaths[0].nodes[2];
    const to = geometry.subpaths[0].nodes[0];
    pointClose(nodes[3], cubicPoint(from, from.hout as Point, to.hin as Point, to, 0.5));
    expect(nodes[2].hout).toBeDefined();
    expect(nodes[0].hin).toBeDefined();
    // điểm đầu giữ nguyên vị trí
    expect(nodes[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('đường mở: không có đoạn đóng nên chỉ số đoạn cuối là không hợp lệ', () => {
    const open = path('M 0 0 L 10 0 L 10 10');
    expect(insertNode(open, 0, 2, 0.5)).toBe(open);
    expect(insertNode(open, 0, 7, 0.5)).toBe(open);
    expect(insertNode(open, 3, 0, 0.5)).toBe(open);
  });

  it('đường con chỉ có một điểm: không chèn được', () => {
    const single: PathGeometry = { type: 'path', subpaths: [{ closed: true, nodes: [{ x: 1, y: 1 }] }] };
    expect(insertNode(single, 0, 0, 0.5)).toBe(single);
  });

  it('không tạo tay cầm suy biến trùng điểm neo', () => {
    // đoạn chỉ có tay cầm ra (tay cầm vào trùng điểm cuối)
    const geometry: PathGeometry = {
      type: 'path',
      subpaths: [{ closed: false, nodes: [{ x: 0, y: 0, hout: { x: 0, y: 0 + 6 } }, { x: 6, y: 6 }] }],
    };
    const result = insertNode(geometry, 0, 0, 0.5);
    const nodes = result.subpaths[0].nodes;
    // điểm cuối không có tay cầm vào nên nửa sau chỉ còn tay cầm ra của điểm mới
    expect(nodes[2].hin).toBeUndefined();
    pointClose(nodes[1], cubicPoint({ x: 0, y: 0 }, { x: 0, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 6 }, 0.5));
    for (const node of nodes) {
      if (node.hin) expect(node.hin.x === node.x && node.hin.y === node.y).toBe(false);
      if (node.hout) expect(node.hout.x === node.x && node.hout.y === node.y).toBe(false);
    }
  });
});

describe('nearestOnPath', () => {
  it('đường rỗng cho null', () => {
    expect(nearestOnPath({ type: 'path', subpaths: [] }, { x: 0, y: 0 })).toBeNull();
  });

  it('đoạn thẳng: trả về hình chiếu, tham số t tuyến tính và khoảng cách', () => {
    const result = nearestOnPath(path('M 0 0 L 10 0 L 10 10'), { x: 4, y: 3 });
    expect(result).not.toBeNull();
    expect(result).toMatchObject({ sub: 0, segment: 0 });
    close(result?.t ?? -1, 0.4);
    pointClose(result?.point, { x: 4, y: 0 });
    close(result?.distance ?? -1, 3);
  });

  it('chọn đoạn gần nhất trong nhiều đoạn', () => {
    const result = nearestOnPath(path('M 0 0 L 10 0 L 10 10'), { x: 13, y: 7 });
    expect(result?.segment).toBe(1);
    pointClose(result?.point, { x: 10, y: 7 });
  });

  it('đường kín: nhận ra đoạn đóng', () => {
    const result = nearestOnPath(path('M 0 0 L 10 0 L 10 10 Z'), { x: 3, y: 5 });
    expect(result?.segment).toBe(2);
  });

  it('đường cong: tham số t dùng được để chèn điểm đúng vị trí', () => {
    const geometry = path('M 0 0 C 0 10 10 10 10 0');
    const target = { x: 2, y: 7.5 };
    const result = nearestOnPath(geometry, target);
    expect(result).not.toBeNull();
    const inserted = insertNode(geometry, result?.sub ?? 0, result?.segment ?? 0, result?.t ?? 0);
    const mid = inserted.subpaths[0].nodes[1];
    expect(Math.hypot(mid.x - (result?.point.x ?? 0), mid.y - (result?.point.y ?? 0))).toBeLessThan(0.05);
  });

  it('nhận diện đúng đường con khi có nhiều đường con', () => {
    const result = nearestOnPath(path('M 0 0 L 4 0 M 20 20 L 24 20'), { x: 22, y: 19 });
    expect(result?.sub).toBe(1);
    expect(result?.segment).toBe(0);
  });
});

describe('căn chỉnh và phân phối', () => {
  const items = [
    { id: 'a', bounds: { x: 0, y: 0, width: 4, height: 2 } },
    { id: 'b', bounds: { x: 10, y: 6, width: 2, height: 4 } },
    { id: 'c', bounds: { x: 20, y: 3, width: 6, height: 6 } },
  ];
  const reference = { x: 0, y: 0, width: 24, height: 24 };

  it('căn trái, giữa, phải theo khung tham chiếu', () => {
    expect(alignOffsets(items, 'left', reference).get('b')).toEqual({ x: -10, y: 0 });
    expect(alignOffsets(items, 'center', reference).get('a')).toEqual({ x: 10, y: 0 });
    expect(alignOffsets(items, 'right', reference).get('c')).toEqual({ x: -2, y: 0 });
  });

  it('căn trên, giữa, dưới theo khung tham chiếu', () => {
    expect(alignOffsets(items, 'top', reference).get('b')).toEqual({ x: 0, y: -6 });
    expect(alignOffsets(items, 'middle', reference).get('c')).toEqual({ x: 0, y: 6 });
    expect(alignOffsets(items, 'bottom', reference).get('a')).toEqual({ x: 0, y: 22 });
  });

  it('căn theo khung bao của chính các hình', () => {
    const union = unionRects(items.map((item) => item.bounds)) as { x: number; y: number; width: number; height: number };
    const offsets = alignOffsets(items, 'left', union);
    expect(offsets.get('a')).toEqual({ x: 0, y: 0 });
    expect(offsets.get('c')).toEqual({ x: -20, y: 0 });
  });

  it('distribute cần ít nhất 3 hình', () => {
    expect(distributeOffsets(items.slice(0, 2), 'horizontal').size).toBe(0);
    expect(distributeOffsets([], 'vertical').size).toBe(0);
  });

  it('distribute ngang chia đều khoảng trống, hai hình ngoài cùng đứng yên', () => {
    const offsets = distributeOffsets(items, 'horizontal');
    expect(offsets.has('a')).toBe(false);
    expect(offsets.has('c')).toBe(false);
    // tổng bề rộng 26, các hình rộng 4+2+6=12, hai khoảng trống mỗi khoảng 7: b bắt đầu tại 4+7=11
    expect(offsets.get('b')).toEqual({ x: 1, y: 0 });
  });

  it('distribute dọc và không phụ thuộc thứ tự đầu vào', () => {
    const shuffled = [items[2], items[0], items[1]];
    const offsets = distributeOffsets(shuffled, 'vertical');
    // theo y: a(0..2), c(3..9), b(6..10): sắp theo y bắt đầu -> a, c, b. tổng cao 10, dùng 2+6+4=12 -> khoảng trống -1
    expect(offsets.size).toBe(1);
    expect(offsets.get('c')).toEqual({ x: 0, y: -1 + 2 - 3 });
  });

  it('distribute với 4 hình cho mọi khoảng trống bằng nhau', () => {
    const four = [
      { id: 'a', bounds: { x: 0, y: 0, width: 2, height: 2 } },
      { id: 'b', bounds: { x: 3, y: 0, width: 2, height: 2 } },
      { id: 'c', bounds: { x: 4, y: 0, width: 2, height: 2 } },
      { id: 'd', bounds: { x: 20, y: 0, width: 2, height: 2 } },
    ];
    const offsets = distributeOffsets(four, 'horizontal');
    const bx = 3 + (offsets.get('b')?.x ?? 0);
    const cx = 4 + (offsets.get('c')?.x ?? 0);
    // 22 - 8 = 14 chia 3 khoảng = 4,666...
    close(bx - 2, 14 / 3);
    close(cx - (bx + 2), 14 / 3);
    close(20 - (cx + 2), 14 / 3);
  });
});
