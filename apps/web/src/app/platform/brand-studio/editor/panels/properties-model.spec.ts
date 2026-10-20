import { applyMatrix, geometryBounds, transformShape, type Matrix, type Rect } from '@enterprise-platform/shared-brand-icon';
import {
  addTags,
  alignTarget,
  commonValue,
  flipAboutCenter,
  geometryRect,
  pathActionState,
  rectRadiusInfo,
  removeTag,
  resizeMatrix,
  rotateAboutCenter,
  withRectRadius,
} from './properties-model';
import { makeShape, rectShape } from './panel-test-utils';

const mapRect = (matrix: Matrix, rect: Rect): Rect => {
  const a = applyMatrix(matrix, { x: rect.x, y: rect.y });
  const b = applyMatrix(matrix, { x: rect.x + rect.width, y: rect.y + rect.height });
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
};

describe('commonValue', () => {
  it('trả giá trị chung và đánh dấu nhiều giá trị khi các lớp khác nhau', () => {
    const shapes = [rectShape('a', 0, 0, 4, 4, { strokeWidth: 2 }), rectShape('b', 0, 0, 4, 4, { strokeWidth: 2 })];
    expect(commonValue(shapes, (shape) => shape.strokeWidth, 1)).toEqual({ mixed: false, value: 2 });
    const mixed = [...shapes, rectShape('c', 0, 0, 4, 4, { strokeWidth: 1.5 })];
    expect(commonValue(mixed, (shape) => shape.strokeWidth, 1)).toEqual({ mixed: true, value: 2 });
  });

  it('dùng giá trị dự phòng khi chưa có lớp nào', () => {
    expect(commonValue([], (shape) => shape.opacity, 1)).toEqual({ mixed: false, value: 1 });
  });
});

describe('geometryRect', () => {
  it('gộp khung bao hình học, không tính nét viền', () => {
    const shapes = [rectShape('a', 2, 4, 4, 4, { strokeWidth: 3 }), rectShape('b', 10, 2, 2, 8)];
    expect(geometryRect(shapes)).toEqual({ x: 2, y: 2, width: 10, height: 8 });
    expect(geometryRect([])).toBeNull();
  });
});

describe('resizeMatrix', () => {
  const rect: Rect = { x: 6, y: 4, width: 12, height: 8 };

  it('đổi X hoặc Y chỉ dịch chuyển', () => {
    expect(mapRect(resizeMatrix(rect, 'x', 10, false) as Matrix, rect)).toEqual({ x: 10, y: 4, width: 12, height: 8 });
    expect(mapRect(resizeMatrix(rect, 'y', 0, false) as Matrix, rect)).toEqual({ x: 6, y: 0, width: 12, height: 8 });
  });

  it('đổi rộng giữ nguyên góc trên trái, không khoá tỷ lệ thì cao không đổi', () => {
    expect(mapRect(resizeMatrix(rect, 'width', 6, false) as Matrix, rect)).toEqual({ x: 6, y: 4, width: 6, height: 8 });
  });

  it('khoá tỷ lệ: đổi rộng kéo theo cao và ngược lại', () => {
    expect(mapRect(resizeMatrix(rect, 'width', 6, true) as Matrix, rect)).toEqual({ x: 6, y: 4, width: 6, height: 4 });
    expect(mapRect(resizeMatrix(rect, 'height', 16, true) as Matrix, rect)).toEqual({ x: 6, y: 4, width: 24, height: 16 });
  });

  it('khoá tỷ lệ không ảnh hưởng khi đổi vị trí', () => {
    expect(mapRect(resizeMatrix(rect, 'x', 0, true) as Matrix, rect)).toEqual({ x: 0, y: 4, width: 12, height: 8 });
  });

  it('không làm gì khi giá trị không đổi, không hợp lệ hoặc rộng cao quá nhỏ', () => {
    expect(resizeMatrix(rect, 'x', 6, false)).toBeNull();
    expect(resizeMatrix(rect, 'width', 12, true)).toBeNull();
    expect(resizeMatrix(rect, 'width', 0, false)).toBeNull();
    expect(resizeMatrix(rect, 'height', -2, false)).toBeNull();
    expect(resizeMatrix(rect, 'x', Number.NaN, false)).toBeNull();
  });

  it('khoá tỷ lệ không chia cho 0 với đường thẳng (cao bằng 0)', () => {
    const line: Rect = { x: 4, y: 12, width: 16, height: 0 };
    expect(mapRect(resizeMatrix(line, 'width', 8, true) as Matrix, line)).toEqual({ x: 4, y: 12, width: 8, height: 0 });
  });
});

describe('xoay và lật quanh tâm', () => {
  const shape = rectShape('a', 4, 10, 16, 4);

  it('xoay 90 độ hoán đổi rộng cao và giữ nguyên tâm', () => {
    const rect = geometryRect([shape]) as Rect;
    const turned = transformShape(shape, rotateAboutCenter(rect, 90));
    expect(turned.geometry.type).toBe('rect');
    const box = geometryBounds(turned.geometry);
    expect(box.x).toBeCloseTo(10);
    expect(box.y).toBeCloseTo(4);
    expect(box.width).toBeCloseTo(4);
    expect(box.height).toBeCloseTo(16);
  });

  it('xoay trái rồi xoay phải trả về hình cũ', () => {
    const rect = geometryRect([shape]) as Rect;
    const there = transformShape(shape, rotateAboutCenter(rect, -90));
    const back = transformShape(there, rotateAboutCenter(geometryRect([there]) as Rect, 90));
    const box = geometryBounds(back.geometry);
    expect(box.x).toBeCloseTo(4);
    expect(box.y).toBeCloseTo(10);
    expect(box.width).toBeCloseTo(16);
  });

  it('xoay góc bất kỳ biến hình chữ nhật thành đường', () => {
    const rect = geometryRect([shape]) as Rect;
    expect(transformShape(shape, rotateAboutCenter(rect, 30)).geometry.type).toBe('path');
  });

  it('lật ngang một nhóm đổi chỗ các hình đối xứng qua tâm nhóm', () => {
    const left = rectShape('left', 2, 6, 2, 4);
    const right = rectShape('right', 10, 6, 2, 4);
    const matrix = flipAboutCenter(geometryRect([left, right]) as Rect, 'horizontal');
    expect(geometryBounds(transformShape(left, matrix).geometry)).toMatchObject({ x: 10, width: 2 });
    expect(geometryBounds(transformShape(right, matrix).geometry)).toMatchObject({ x: 2, width: 2 });
  });

  it('lật dọc giữ nguyên x và đổi y qua tâm', () => {
    const top = rectShape('top', 6, 2, 4, 2);
    const bottom = rectShape('bottom', 6, 10, 4, 2);
    const matrix = flipAboutCenter(geometryRect([top, bottom]) as Rect, 'vertical');
    expect(geometryBounds(transformShape(top, matrix).geometry)).toMatchObject({ x: 6, y: 10 });
  });
});

describe('bo góc', () => {
  it('chỉ áp dụng khi mọi lớp sửa được đều là hình chữ nhật', () => {
    const a = rectShape('a');
    const circle = makeShape('c', { type: 'ellipse', cx: 12, cy: 12, rx: 4, ry: 4 });
    expect(rectRadiusInfo([a]).applicable).toBe(true);
    expect(rectRadiusInfo([a, circle]).applicable).toBe(false);
    expect(rectRadiusInfo([]).applicable).toBe(false);
    // lớp khoá không tính
    expect(rectRadiusInfo([a, { ...circle, locked: true }]).applicable).toBe(true);
  });

  it('giới hạn bo tối đa theo nửa cạnh ngắn nhất', () => {
    expect(rectRadiusInfo([rectShape('a', 0, 0, 12, 8), rectShape('b', 0, 0, 6, 20)])).toMatchObject({ applicable: true, max: 3 });
  });

  it('đánh dấu nhiều giá trị khi bo góc khác nhau', () => {
    const a = makeShape('a', { type: 'rect', x: 0, y: 0, width: 8, height: 8, rx: 1 });
    const b = makeShape('b', { type: 'rect', x: 0, y: 0, width: 8, height: 8, rx: 2 });
    expect(rectRadiusInfo([a, b])).toMatchObject({ mixed: true, value: 1 });
  });

  it('withRectRadius kẹp theo nửa cạnh ngắn và bỏ qua hình đã đúng, khoá hay không phải chữ nhật', () => {
    const wide = rectShape('wide', 0, 0, 12, 4);
    const same = makeShape('same', { type: 'rect', x: 0, y: 0, width: 8, height: 8, rx: 2 });
    const locked = rectShape('locked', 0, 0, 8, 8, { locked: true });
    const circle = makeShape('c', { type: 'ellipse', cx: 4, cy: 4, rx: 2, ry: 2 });
    const result = withRectRadius([wide, same, locked, circle], 2);
    expect(result.map((shape) => shape.id)).toEqual(['wide']);
    expect(result[0].geometry).toMatchObject({ type: 'rect', rx: 2 });
    expect(withRectRadius([wide], 99)[0].geometry).toMatchObject({ rx: 2 });
    expect(withRectRadius([wide], -3)).toEqual([]);
  });
});

describe('alignTarget', () => {
  it('một lớp chỉ căn theo khung vẽ, nhiều lớp theo lựa chọn', () => {
    expect(alignTarget(1, false)).toBe('canvas');
    expect(alignTarget(0, false)).toBe('canvas');
    expect(alignTarget(2, false)).toBe('selection');
    expect(alignTarget(3, true)).toBe('canvas');
  });
});

describe('pathActionState', () => {
  const open = makeShape('p', {
    type: 'path',
    subpaths: [{ closed: false, nodes: [{ x: 0, y: 0 }, { x: 4, y: 4 }] }],
  });
  const twoParts = makeShape('q', {
    type: 'path',
    subpaths: [
      { closed: false, nodes: [{ x: 0, y: 0 }, { x: 4, y: 4 }] },
      { closed: false, nodes: [{ x: 8, y: 8 }, { x: 12, y: 12 }] },
    ],
  });

  it('gộp cần từ hai lớp sửa được', () => {
    expect(pathActionState([open]).combine).toBe(false);
    expect(pathActionState([open, twoParts]).combine).toBe(true);
    expect(pathActionState([open, { ...twoParts, locked: true }]).combine).toBe(false);
  });

  it('tách chỉ khi có đường nhiều phần', () => {
    expect(pathActionState([open]).separate).toBe(false);
    expect(pathActionState([twoParts]).separate).toBe(true);
  });

  it('chuyển thành đường chỉ khi có hình chưa là đường', () => {
    expect(pathActionState([open, twoParts]).convert).toBe(false);
    expect(pathActionState([rectShape('r')]).convert).toBe(true);
    expect(pathActionState([{ ...rectShape('r'), locked: true }]).convert).toBe(false);
  });
});

describe('nhãn', () => {
  it('thêm nhãn, tách theo dấu phẩy, bỏ rỗng và trùng không phân biệt hoa thường', () => {
    expect(addTags([], ' kho , Bảo trì,, kho ,KHO')).toEqual(['kho', 'Bảo trì']);
    expect(addTags(['kho'], 'Kho')).toEqual(['kho']);
  });

  it('trả đúng mảng cũ khi không thêm được gì (để bỏ qua cập nhật)', () => {
    const tags = ['a'];
    expect(addTags(tags, '   ')).toBe(tags);
    expect(addTags(tags, 'A')).toBe(tags);
  });

  it('cắt nhãn quá dài và dừng ở mức tối đa', () => {
    expect(addTags([], 'x'.repeat(40))[0]).toHaveLength(24);
    expect(addTags(['a', 'b'], 'c, d, e', 3)).toEqual(['a', 'b', 'c']);
  });

  it('xoá một nhãn', () => {
    expect(removeTag(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });
});
