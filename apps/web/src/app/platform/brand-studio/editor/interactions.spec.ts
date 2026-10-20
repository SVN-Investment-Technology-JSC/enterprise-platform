import {
  DEFAULT_PALETTE,
  DEFAULT_RULES,
  applyMatrix,
  createDocument,
  createShape,
  type IconDocument,
  type PathGeometry,
  type Point,
  type Rect,
} from '@enterprise-platform/shared-brand-icon';
import {
  clampPolygonSides,
  constrainAngle,
  defaultStrokePaint,
  defaultStrokeWidth,
  deleteNodes,
  describeGeometry,
  editableSelection,
  ellipseFromDrag,
  hitOpenEnd,
  hitSelectionHandle,
  hitTestNodes,
  hitTestTopShape,
  isDegenerateGeometry,
  keyToCommand,
  lineFromDrag,
  mapRectByMatrix,
  mergeSelection,
  moveNodes,
  nodeKey,
  nodesInRect,
  nudgeAmount,
  parseNodeKey,
  penAddNode,
  penCommitGeometry,
  penContinue,
  penDragHandle,
  penFinish,
  penNearFirst,
  penPreviewGeometry,
  penStart,
  rectFromDrag,
  regularPolygon,
  resizeMatrix,
  rotationDelta,
  segmentIntersectsRect,
  selectionLayout,
  shapeIntersectsRect,
  shapesInMarquee,
  snapMove,
  snapPoint,
  snapTargetsFromRects,
  wheelZoomFactor,
  type MoveSnapOptions,
} from './interactions';

const close = (actual: number, expected: number, digits = 6) => expect(actual).toBeCloseTo(expected, digits);
const closePoint = (actual: Point, expected: Point) => {
  close(actual.x, expected.x);
  close(actual.y, expected.y);
};
const closeRect = (actual: Rect, expected: Rect) => {
  close(actual.x, expected.x);
  close(actual.y, expected.y);
  close(actual.width, expected.width);
  close(actual.height, expected.height);
};

const BOX: Rect = { x: 4, y: 6, width: 8, height: 4 };

describe('resizeMatrix', () => {
  it('đổi cỡ từ góc dưới phải, giữ nguyên góc trên trái', () => {
    const matrix = resizeMatrix(BOX, 'se', { x: 16, y: 14 });
    closeRect(mapRectByMatrix(BOX, matrix), { x: 4, y: 6, width: 12, height: 8 });
  });

  it('tay cầm giữa cạnh chỉ đổi một trục', () => {
    const east = mapRectByMatrix(BOX, resizeMatrix(BOX, 'e', { x: 20, y: 99 }));
    closeRect(east, { x: 4, y: 6, width: 16, height: 4 });
    const north = mapRectByMatrix(BOX, resizeMatrix(BOX, 'n', { x: -50, y: 2 }));
    closeRect(north, { x: 4, y: 2, width: 8, height: 8 });
  });

  it('giữ tỷ lệ khi kéo góc (Shift): lấy trục có hệ số lớn hơn', () => {
    const rect = mapRectByMatrix(BOX, resizeMatrix(BOX, 'se', { x: 20, y: 11 }, { keepRatio: true }));
    // Hệ số theo x là 2, theo y là 1,25: lấy 2 cho cả hai trục.
    closeRect(rect, { x: 4, y: 6, width: 16, height: 8 });
    expect(rect.width / rect.height).toBeCloseTo(BOX.width / BOX.height, 6);
  });

  it('giữ tỷ lệ khi kéo giữa cạnh: trục kia co giãn quanh tâm của nó', () => {
    const rect = mapRectByMatrix(BOX, resizeMatrix(BOX, 'e', { x: 20, y: 6 }, { keepRatio: true }));
    closeRect(rect, { x: 4, y: 4, width: 16, height: 8 });
  });

  it('co giãn từ tâm khi giữ Alt', () => {
    const rect = mapRectByMatrix(BOX, resizeMatrix(BOX, 'e', { x: 14, y: 8 }, { fromCenter: true }));
    // Tâm (8, 8) giữ nguyên; mép phải ra x = 14 nên bán rộng 6.
    closeRect(rect, { x: 2, y: 6, width: 12, height: 4 });
  });

  it('kết hợp Shift và Alt', () => {
    const rect = mapRectByMatrix(BOX, resizeMatrix(BOX, 'se', { x: 16, y: 10 }, { keepRatio: true, fromCenter: true }));
    // Tâm (8, 8); góc kéo từ (12, 10) tới (16, 10): hệ số x = 2, y = 1 -> đồng đều 2.
    closeRect(rect, { x: 0, y: 4, width: 16, height: 8 });
  });

  it('kéo qua điểm neo thì lật hình', () => {
    const matrix = resizeMatrix(BOX, 'e', { x: 0, y: 8 });
    expect(matrix[0]).toBeLessThan(0);
    closeRect(mapRectByMatrix(BOX, matrix), { x: 0, y: 6, width: 4, height: 4 });
  });

  it('không làm hình biến mất khi kéo chạm điểm neo', () => {
    const matrix = resizeMatrix(BOX, 'e', { x: 4, y: 8 });
    expect(Math.abs(matrix[0])).toBeGreaterThan(0);
  });

  it('khung có cạnh bằng 0 không chia cho 0', () => {
    const flat: Rect = { x: 2, y: 5, width: 6, height: 0 };
    const matrix = resizeMatrix(flat, 'se', { x: 12, y: 9 }, { keepRatio: true });
    matrix.forEach((value) => expect(Number.isFinite(value)).toBe(true));
    const rect = mapRectByMatrix(flat, matrix);
    close(rect.width, 10);
  });

  it('điểm neo đứng yên sau khi biến đổi', () => {
    const matrix = resizeMatrix(BOX, 'nw', { x: 0, y: 0 });
    closePoint(applyMatrix(matrix, { x: 12, y: 10 }), { x: 12, y: 10 });
  });
});

describe('rotationDelta', () => {
  const center = { x: 0, y: 0 };

  it('đo góc xoay từ lúc bấm', () => {
    close(rotationDelta(center, { x: 10, y: 0 }, { x: 0, y: 10 }, false), 90);
    close(rotationDelta(center, { x: 10, y: 0 }, { x: 0, y: -10 }, false), -90);
  });

  it('làm tròn theo bước 15 độ khi giữ Shift', () => {
    const start = { x: 10, y: 0 };
    const pointer = { x: 10 * Math.cos((38 * Math.PI) / 180), y: 10 * Math.sin((38 * Math.PI) / 180) };
    close(rotationDelta(center, start, pointer, true), 45);
    close(rotationDelta(center, start, pointer, false), 38);
  });

  it('đưa góc về khoảng (-180, 180]', () => {
    const delta = rotationDelta(center, { x: 10, y: 1 }, { x: 10, y: -1 }, false);
    expect(Math.abs(delta)).toBeLessThan(180);
  });
});

describe('constrainAngle', () => {
  it('làm tròn góc giữ nguyên độ dài', () => {
    const point = constrainAngle({ x: 0, y: 0 }, { x: 10, y: 1 }, 15);
    close(point.y, 0, 4);
    close(Math.hypot(point.x, point.y), Math.hypot(10, 1), 3);
  });

  it('trả lại điểm khi độ dài bằng 0', () => {
    expect(constrainAngle({ x: 3, y: 3 }, { x: 3, y: 3 }, 15)).toEqual({ x: 3, y: 3 });
  });
});

describe('khung chọn và tay cầm', () => {
  const view = { zoom: 10, panX: 20, panY: 30 };

  it('bố cục theo toạ độ màn hình, có 8 tay cầm và tay cầm xoay', () => {
    const layout = selectionLayout({ x: 2, y: 2, width: 8, height: 6 }, view, { resizable: true });
    expect(layout.frame).toEqual({ x: 40, y: 50, width: 80, height: 60 });
    expect(layout.handles).toHaveLength(8);
    expect(layout.rotate).toEqual({ x: 80, y: 28 });
  });

  it('ẩn tay cầm giữa cạnh khi cạnh quá ngắn', () => {
    const layout = selectionLayout({ x: 2, y: 2, width: 1, height: 8 }, view, { resizable: true });
    const ids = layout.handles.map((handle) => handle.id);
    expect(ids).not.toContain('n');
    expect(ids).not.toContain('s');
    expect(ids).toContain('e');
    expect(ids).toContain('w');
  });

  it('khung chỉ xem thì không có tay cầm', () => {
    const layout = selectionLayout({ x: 0, y: 0, width: 4, height: 4 }, view, { resizable: false });
    expect(layout.handles).toHaveLength(0);
    expect(layout.rotate).toBeNull();
  });

  it('hit-test tay cầm: xoay trước, rồi tay cầm gần nhất', () => {
    const layout = selectionLayout({ x: 2, y: 2, width: 8, height: 6 }, view, { resizable: true });
    expect(hitSelectionHandle(layout, { x: 80, y: 28 })).toEqual({ type: 'rotate' });
    expect(hitSelectionHandle(layout, { x: 41, y: 52 })).toEqual({ type: 'resize', handle: 'nw' });
    expect(hitSelectionHandle(layout, { x: 120, y: 80 })).toEqual({ type: 'resize', handle: 'e' });
    expect(hitSelectionHandle(layout, { x: 300, y: 300 })).toBeNull();
  });
});

describe('hit-test và quét chọn', () => {
  const frame = createShape({ type: 'rect', x: 2, y: 2, width: 20, height: 20, rx: 0 }, { name: 'khung', fill: 'none', stroke: 'currentColor' });
  const dot = createShape({ type: 'ellipse', cx: 12, cy: 12, rx: 3, ry: 3 }, { name: 'chấm', fill: 'currentColor', stroke: 'none' });
  const hiddenShape = createShape({ type: 'rect', x: 6, y: 6, width: 4, height: 4, rx: 0 }, { name: 'ẩn', fill: 'currentColor', hidden: true });
  const lockedShape = createShape({ type: 'rect', x: 14, y: 14, width: 4, height: 4, rx: 0 }, { name: 'khoá', fill: 'currentColor', locked: true });
  const doc: IconDocument = createDocument({ shapes: [frame, dot, hiddenShape, lockedShape] });

  it('chọn hình nét theo đường viền, không theo vùng trống bên trong', () => {
    expect(hitTestTopShape(doc, { x: 2, y: 10 }, 0.2)).toBe(frame.id);
    expect(hitTestTopShape(doc, { x: 5, y: 5 }, 0.2)).toBeNull();
  });

  it('chọn hình tô theo vùng tô và ưu tiên lớp trên cùng', () => {
    expect(hitTestTopShape(doc, { x: 12, y: 12 }, 0.2)).toBe(dot.id);
  });

  it('bỏ qua lớp ẩn và lớp khoá', () => {
    expect(hitTestTopShape(doc, { x: 8, y: 8 }, 0.2)).toBeNull();
    expect(hitTestTopShape(doc, { x: 16, y: 16 }, 0.2)).toBeNull();
  });

  it('khung chọn nằm lọt trong hình nét rỗng thì không chọn hình đó', () => {
    expect(shapeIntersectsRect(frame, { x: 6, y: 6, width: 3, height: 3 })).toBe(false);
    expect(shapesInMarquee(doc, { x: 6, y: 6, width: 3, height: 3 })).toEqual([]);
  });

  it('khung chọn cắt nét thì chọn, không lấy lớp ẩn hay khoá', () => {
    expect(shapesInMarquee(doc, { x: 0, y: 0, width: 30, height: 30 })).toEqual([frame.id, dot.id]);
    expect(shapesInMarquee(doc, { x: 1, y: 8, width: 2, height: 2 })).toEqual([frame.id]);
  });

  it('khung chọn nằm trong vùng tô thì chọn hình tô', () => {
    expect(shapeIntersectsRect(dot, { x: 11.5, y: 11.5, width: 1, height: 1 })).toBe(true);
    expect(shapeIntersectsRect(dot, { x: 20, y: 20, width: 1, height: 1 })).toBe(false);
  });

  it('gộp danh sách chọn khi quét có Shift', () => {
    expect(mergeSelection(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('lớp sửa được loại bỏ lớp ẩn và khoá', () => {
    expect(editableSelection(doc, [frame.id, hiddenShape.id, lockedShape.id]).map((shape) => shape.id)).toEqual([frame.id]);
  });

  it('đoạn thẳng cắt hình chữ nhật', () => {
    const rect = { x: 0, y: 0, width: 4, height: 4 };
    expect(segmentIntersectsRect({ x: -2, y: 2 }, { x: 6, y: 2 }, rect)).toBe(true);
    expect(segmentIntersectsRect({ x: -2, y: 6 }, { x: 6, y: 6 }, rect)).toBe(false);
    expect(segmentIntersectsRect({ x: 1, y: 1 }, { x: 2, y: 2 }, rect)).toBe(true);
  });
});

describe('bắt dính', () => {
  const moveOptions: MoveSnapOptions = { step: 0.5, threshold: 0.3, objects: true, axisLock: false, disabled: false };

  it('bắt dính vào lưới theo cạnh/tâm gần lưới nhất', () => {
    // Hình tròn đường kính 6,5: cạnh lệch lưới nhưng tâm nằm đúng lưới, nên tâm được giữ trên lưới.
    const origin: Rect = { x: 8.75, y: 8.75, width: 6.5, height: 6.5 };
    const result = snapMove(origin, 0.1, 0.1, [], 24, { ...moveOptions, objects: false });
    close(origin.x + result.dx + origin.width / 2, 12);
    close(origin.y + result.dy + origin.height / 2, 12);
    expect(result.guides).toHaveLength(0);
  });

  it('bắt dính vào tâm khung vẽ và hiện đường dóng', () => {
    const origin: Rect = { x: 10.5, y: 4, width: 3, height: 3 };
    const result = snapMove(origin, 0.1, 0, [], 24, { ...moveOptions, step: 0 });
    // Tâm hình ở 12,0 + 0,1 = 12,1: cách tâm khung (12) trong ngưỡng.
    expect(result.guides).toContainEqual({ axis: 'x', value: 12 });
    close(origin.x + result.dx + origin.width / 2, 12);
  });

  it('bắt dính vào cạnh hình khác ưu tiên hơn lưới', () => {
    const other: Rect = { x: 3.2, y: 20, width: 2, height: 2 };
    const origin: Rect = { x: 8, y: 4, width: 2, height: 2 };
    const result = snapMove(origin, -4.6, 0, [other], 24, moveOptions);
    // Cạnh trái hình đang kéo ở 3,4; cạnh trái hình kia ở 3,2 (cách 0,2, trong ngưỡng).
    close(origin.x + result.dx, 3.2);
    expect(result.guides).toContainEqual({ axis: 'x', value: 3.2 });
  });

  it('tắt bắt dính khi giữ Alt', () => {
    const origin: Rect = { x: 4.1, y: 4.1, width: 2, height: 2 };
    const result = snapMove(origin, 0.13, 0.17, [], 24, { ...moveOptions, disabled: true });
    expect(result).toEqual({ dx: 0.13, dy: 0.17, guides: [] });
  });

  it('khoá theo trục khi giữ Shift: trục còn lại không dời, không bắt dính trục đó', () => {
    const origin: Rect = { x: 4.1, y: 4.1, width: 2, height: 2 };
    const horizontal = snapMove(origin, 3, 0.4, [], 24, { ...moveOptions, axisLock: true });
    expect(horizontal.dy).toBe(0);
    close(origin.x + horizontal.dx, 7);
    const vertical = snapMove(origin, 0.4, -3, [], 24, { ...moveOptions, axisLock: true });
    expect(vertical.dx).toBe(0);
  });

  it('điểm bắt dính vào lưới và vào đường cạnh/tâm', () => {
    const targets = snapTargetsFromRects([{ x: 3.3, y: 3.3, width: 2, height: 2 }], 24);
    const grid = snapPoint({ x: 9.2, y: 9.8 }, targets, { step: 0.5, threshold: 0.2, objects: false });
    expect(grid.point).toEqual({ x: 9, y: 10 });
    const object = snapPoint({ x: 3.4, y: 9.8 }, targets, { step: 0.5, threshold: 0.2, objects: true });
    expect(object.point.x).toBeCloseTo(3.3, 6);
    expect(object.guides).toContainEqual({ axis: 'x', value: 3.3 });
    const off = snapPoint({ x: 9.2, y: 9.8 }, targets, { step: 0.5, threshold: 0.2, objects: true, disabled: true });
    expect(off.point).toEqual({ x: 9.2, y: 9.8 });
  });
});

describe('vẽ hình bằng kéo', () => {
  it('chữ nhật: kéo từ góc, Shift thành vuông, Alt từ tâm', () => {
    expect(rectFromDrag({ x: 2, y: 3 }, { x: 8, y: 5 })).toEqual({ type: 'rect', x: 2, y: 3, width: 6, height: 2, rx: 0 });
    expect(rectFromDrag({ x: 8, y: 5 }, { x: 2, y: 3 })).toEqual({ type: 'rect', x: 2, y: 3, width: 6, height: 2, rx: 0 });
    expect(rectFromDrag({ x: 2, y: 3 }, { x: 8, y: 5 }, { equal: true })).toEqual({ type: 'rect', x: 2, y: 3, width: 6, height: 6, rx: 0 });
    expect(rectFromDrag({ x: 8, y: 8 }, { x: 4, y: 12 }, { equal: true })).toEqual({ type: 'rect', x: 4, y: 8, width: 4, height: 4, rx: 0 });
    expect(rectFromDrag({ x: 8, y: 8 }, { x: 10, y: 11 }, { fromCenter: true })).toEqual({ type: 'rect', x: 6, y: 5, width: 4, height: 6, rx: 0 });
  });

  it('elip: kéo trong khung, Shift thành tròn', () => {
    expect(ellipseFromDrag({ x: 2, y: 2 }, { x: 10, y: 6 })).toEqual({ type: 'ellipse', cx: 6, cy: 4, rx: 4, ry: 2 });
    expect(ellipseFromDrag({ x: 2, y: 2 }, { x: 10, y: 6 }, { equal: true })).toEqual({ type: 'ellipse', cx: 6, cy: 6, rx: 4, ry: 4 });
    expect(ellipseFromDrag({ x: 12, y: 12 }, { x: 15, y: 14 }, { fromCenter: true })).toEqual({ type: 'ellipse', cx: 12, cy: 12, rx: 3, ry: 2 });
  });

  it('đường thẳng: hai điểm, Shift làm tròn góc 15 độ', () => {
    const free = lineFromDrag({ x: 1, y: 1 }, { x: 5, y: 3 });
    expect(free.subpaths[0]).toEqual({ closed: false, nodes: [{ x: 1, y: 1 }, { x: 5, y: 3 }] });
    const snapped = lineFromDrag({ x: 0, y: 0 }, { x: 10, y: 1 }, true);
    const end = snapped.subpaths[0].nodes[1];
    close(end.y, 0, 3);
    close(end.x, Math.hypot(10, 1), 3);
  });

  it('đa giác đều: đủ số cạnh, cùng bán kính, đỉnh đầu hướng về con trỏ', () => {
    const polygon = regularPolygon({ x: 12, y: 12 }, { x: 12, y: 6 }, 5);
    const sub = polygon.subpaths[0];
    expect(sub.closed).toBe(true);
    expect(sub.nodes).toHaveLength(5);
    closePoint(sub.nodes[0], { x: 12, y: 6 });
    for (const node of sub.nodes) close(Math.hypot(node.x - 12, node.y - 12), 6, 3);
  });

  it('đa giác đều: số cạnh bị giới hạn 3..12 và Shift làm tròn hướng', () => {
    expect(regularPolygon({ x: 0, y: 0 }, { x: 4, y: 0 }, 1).subpaths[0].nodes).toHaveLength(3);
    expect(regularPolygon({ x: 0, y: 0 }, { x: 4, y: 0 }, 99).subpaths[0].nodes).toHaveLength(12);
    const snapped = regularPolygon({ x: 0, y: 0 }, { x: 10, y: 1 }, 4, true).subpaths[0].nodes[0];
    close(snapped.y, 0, 3);
    expect(clampPolygonSides(Number.NaN)).toBe(5);
    expect(clampPolygonSides(7.4)).toBe(7);
  });

  it('nhận ra hình kéo quá nhỏ và mô tả kích thước', () => {
    expect(isDegenerateGeometry(rectFromDrag({ x: 1, y: 1 }, { x: 1.01, y: 1.01 }))).toBe(true);
    expect(isDegenerateGeometry(rectFromDrag({ x: 1, y: 1 }, { x: 4, y: 3 }))).toBe(false);
    expect(describeGeometry(rectFromDrag({ x: 1, y: 1 }, { x: 4.5, y: 3 }))).toBe('3,5 × 2');
  });

  it('kiểu hình mới: nét theo chế độ hiển thị, độ dày gần 1,75 nhất, không tô', () => {
    expect(defaultStrokePaint('currentColor', DEFAULT_PALETTE)).toBe('currentColor');
    expect(defaultStrokePaint('brand', DEFAULT_PALETTE)).toBe('brand:sapphire');
    expect(defaultStrokePaint('brand', { tokens: [{ key: 'ink', label: 'Mực', hex: '#000000' }] })).toBe('brand:ink');
    expect(defaultStrokePaint('brand', { tokens: [] })).toBe('currentColor');
    expect(defaultStrokeWidth(DEFAULT_RULES)).toBe(1.75);
    expect(defaultStrokeWidth({ ...DEFAULT_RULES, allowedStrokeWidths: [1, 2, 3] })).toBe(2);
    expect(defaultStrokeWidth({ ...DEFAULT_RULES, allowedStrokeWidths: [] })).toBe(1.75);
  });
});

describe('công cụ Bút', () => {
  it('bấm đặt điểm góc liên tiếp', () => {
    let draft = penStart({ x: 2, y: 2 });
    draft = penAddNode(draft, { x: 8, y: 2 });
    draft = penAddNode(draft, { x: 8, y: 8 });
    expect(draft.nodes).toEqual([
      { x: 2, y: 2 },
      { x: 8, y: 2 },
      { x: 8, y: 8 },
    ]);
  });

  it('bấm-kéo tạo điểm trơn với tay cầm đối xứng', () => {
    const draft = penDragHandle(penAddNode(penStart({ x: 2, y: 2 }), { x: 8, y: 8 }), { x: 10, y: 8 });
    expect(draft.nodes[1]).toEqual({ x: 8, y: 8, hout: { x: 10, y: 8 }, hin: { x: 6, y: 8 } });
  });

  it('kéo về đúng điểm vừa đặt thì bỏ tay cầm', () => {
    const smooth = penDragHandle(penStart({ x: 4, y: 4 }), { x: 6, y: 4 });
    const flat = penDragHandle(smooth, { x: 4, y: 4 });
    expect(flat.nodes[0]).toEqual({ x: 4, y: 4 });
  });

  it('chỉ đóng đường khi bấm gần điểm đầu và có từ 3 điểm', () => {
    let draft = penStart({ x: 2, y: 2 });
    draft = penAddNode(draft, { x: 8, y: 2 });
    expect(penNearFirst(draft, { x: 2, y: 2 }, 0.5)).toBe(false);
    draft = penAddNode(draft, { x: 8, y: 8 });
    expect(penNearFirst(draft, { x: 2.2, y: 2 }, 0.5)).toBe(true);
    expect(penNearFirst(draft, { x: 5, y: 5 }, 0.5)).toBe(false);
  });

  it('kết thúc: bỏ điểm cuối trùng (nhấp đôi), huỷ nếu dưới 2 điểm, chỉ đóng khi đủ 3 điểm', () => {
    const base = penAddNode(penStart({ x: 2, y: 2 }), { x: 8, y: 2 });
    expect(penFinish(penAddNode(base, { x: 8, y: 2 }), false)).toEqual({
      closed: false,
      nodes: [
        { x: 2, y: 2 },
        { x: 8, y: 2 },
      ],
    });
    expect(penFinish(penStart({ x: 2, y: 2 }), false)).toBeNull();
    expect(penFinish(penAddNode(penStart({ x: 2, y: 2 }), { x: 2, y: 2 }), false)).toBeNull();
    expect(penFinish(base, true)?.closed).toBe(false);
    expect(penFinish(penAddNode(base, { x: 8, y: 8 }), true)?.closed).toBe(true);
  });

  it('xem trước thêm đoạn tới con trỏ, hoặc đóng đường khi sắp đóng', () => {
    const draft = penAddNode(penAddNode(penStart({ x: 2, y: 2 }), { x: 8, y: 2 }), { x: 8, y: 8 });
    const open = penPreviewGeometry(draft, { x: 4, y: 8 });
    expect(open.subpaths[0].nodes).toHaveLength(4);
    expect(open.subpaths[0].closed).toBe(false);
    const closed = penPreviewGeometry(draft, { x: 4, y: 8 }, true);
    expect(closed.subpaths[0].nodes).toHaveLength(3);
    expect(closed.subpaths[0].closed).toBe(true);
    expect(penPreviewGeometry(draft, { x: 8, y: 8 }).subpaths[0].nodes).toHaveLength(3);
  });

  it('nối tiếp một đường mở: nối từ cuối giữ nguyên, nối từ đầu thì đảo chiều và đổi tay cầm', () => {
    const path: PathGeometry = {
      type: 'path',
      subpaths: [
        { closed: true, nodes: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
        { closed: false, nodes: [{ x: 2, y: 2, hout: { x: 3, y: 2 } }, { x: 6, y: 6, hin: { x: 5, y: 6 } }] },
      ],
    };
    expect(hitOpenEnd(path, { x: 6.1, y: 6 }, 0.5)).toEqual({ sub: 1, index: 1, atStart: false });
    expect(hitOpenEnd(path, { x: 2, y: 2.1 }, 0.5)).toEqual({ sub: 1, index: 0, atStart: true });
    expect(hitOpenEnd(path, { x: 0, y: 0 }, 0.5)).toBeNull();

    const fromEnd = penContinue('s1', path, { sub: 1, index: 1, atStart: false });
    expect(fromEnd.target).toEqual({ shapeId: 's1', sub: 1 });
    expect(fromEnd.nodes).toEqual(path.subpaths[1].nodes);

    const fromStart = penContinue('s1', path, { sub: 1, index: 0, atStart: true });
    expect(fromStart.nodes).toEqual([
      { x: 6, y: 6, hout: { x: 5, y: 6 } },
      { x: 2, y: 2, hin: { x: 3, y: 2 } },
    ]);
  });

  it('thay đường con khi hoàn tất nối tiếp, hoặc thêm đường con mới', () => {
    const path: PathGeometry = { type: 'path', subpaths: [{ closed: false, nodes: [{ x: 0, y: 0 }, { x: 4, y: 0 }] }] };
    const extended = { closed: false, nodes: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }] };
    expect(penCommitGeometry(path, extended, 0).subpaths).toEqual([extended]);
    expect(penCommitGeometry(path, extended, 5).subpaths).toHaveLength(2);
    const rectPath = penCommitGeometry({ type: 'rect', x: 0, y: 0, width: 2, height: 2, rx: 0 }, extended, 3);
    expect(rectPath.type).toBe('path');
    expect(rectPath.subpaths).toHaveLength(2);
  });
});

describe('công cụ Điểm neo', () => {
  const path: PathGeometry = {
    type: 'path',
    subpaths: [
      {
        closed: false,
        nodes: [
          { x: 2, y: 2 },
          { x: 8, y: 2, hin: { x: 6, y: 1 }, hout: { x: 10, y: 3 } },
          { x: 8, y: 8 },
          { x: 2, y: 8 },
        ],
      },
    ],
  };

  it('khoá nút để lưu và đọc lại', () => {
    expect(parseNodeKey(nodeKey('shape-ab', 1, 3))).toEqual({ shapeId: 'shape-ab', sub: 1, index: 3 });
    expect(parseNodeKey('hỏng')).toBeNull();
    expect(parseNodeKey('a|x|y')).toBeNull();
  });

  it('bấm trúng điểm neo; tay cầm chỉ bấm được khi điểm neo đang chọn', () => {
    const none = () => false;
    expect(hitTestNodes(path, { x: 8.1, y: 2 }, 0.4, none)).toEqual({ kind: 'anchor', sub: 0, index: 1 });
    expect(hitTestNodes(path, { x: 10, y: 3 }, 0.4, none)).toBeNull();
    const selected = (sub: number, index: number) => sub === 0 && index === 1;
    expect(hitTestNodes(path, { x: 10, y: 3.1 }, 0.4, selected)).toEqual({ kind: 'handle', sub: 0, index: 1, handle: 'hout' });
    expect(hitTestNodes(path, { x: 6, y: 1 }, 0.4, selected)).toEqual({ kind: 'handle', sub: 0, index: 1, handle: 'hin' });
    expect(hitTestNodes(path, { x: 5, y: 5 }, 0.4, selected)).toBeNull();
  });

  it('chọn các điểm neo nằm trong khung', () => {
    expect(nodesInRect(path, { x: 7, y: 1, width: 3, height: 8 })).toEqual([
      { sub: 0, index: 1 },
      { sub: 0, index: 2 },
    ]);
  });

  it('dời nhiều điểm neo cùng lúc, tay cầm đi cùng', () => {
    const moved = moveNodes(path, [{ sub: 0, index: 1 }, { sub: 0, index: 3 }], 1, -1);
    expect(moved.subpaths[0].nodes[1]).toEqual({ x: 9, y: 1, hin: { x: 7, y: 0 }, hout: { x: 11, y: 2 } });
    expect(moved.subpaths[0].nodes[3]).toEqual({ x: 3, y: 7 });
    expect(moved.subpaths[0].nodes[0]).toEqual({ x: 2, y: 2 });
  });

  it('xoá nhiều điểm neo không lệch chỉ số', () => {
    const result = deleteNodes(path, [{ sub: 0, index: 0 }, { sub: 0, index: 2 }]);
    expect(result.subpaths[0].nodes.map((node) => [node.x, node.y])).toEqual([
      [8, 2],
      [2, 8],
    ]);
  });

  it('xoá hết điểm của một đường con thì đường đó mất, đường con khác nguyên vẹn', () => {
    const two: PathGeometry = {
      type: 'path',
      subpaths: [
        { closed: false, nodes: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
        { closed: false, nodes: [{ x: 5, y: 5 }, { x: 6, y: 6 }, { x: 7, y: 7 }] },
      ],
    };
    const result = deleteNodes(two, [{ sub: 0, index: 0 }, { sub: 0, index: 1 }, { sub: 1, index: 2 }]);
    expect(result.subpaths).toHaveLength(1);
    expect(result.subpaths[0].nodes.map((node) => node.x)).toEqual([5, 6]);
  });
});

describe('phím tắt', () => {
  const key = (value: string, flags: Partial<{ ctrl: boolean; shift: boolean; alt: boolean }> = {}) =>
    keyToCommand({ key: value, ctrl: false, shift: false, alt: false, ...flags }, { tool: 'select' });

  it('chọn công cụ bằng chữ cái', () => {
    expect(key('v')).toEqual({ type: 'tool', tool: 'select' });
    expect(key('A')).toEqual({ type: 'tool', tool: 'node' });
    expect(key('p')).toEqual({ type: 'tool', tool: 'pen' });
    expect(key('r')).toEqual({ type: 'tool', tool: 'rect' });
    expect(key('e')).toEqual({ type: 'tool', tool: 'ellipse' });
    expect(key('l')).toEqual({ type: 'tool', tool: 'line' });
    expect(key('g')).toEqual({ type: 'tool', tool: 'polygon' });
    expect(key('h')).toEqual({ type: 'tool', tool: 'hand' });
    expect(key('q')).toBeNull();
  });

  it('Ctrl kết hợp: hoàn tác, làm lại, nhân đôi, chọn hết, lưu', () => {
    expect(key('z', { ctrl: true })).toEqual({ type: 'undo' });
    expect(key('Z', { ctrl: true, shift: true })).toEqual({ type: 'redo' });
    expect(key('y', { ctrl: true })).toEqual({ type: 'redo' });
    expect(key('d', { ctrl: true })).toEqual({ type: 'duplicate' });
    expect(key('a', { ctrl: true })).toEqual({ type: 'selectAll' });
    expect(key('s', { ctrl: true })).toEqual({ type: 'save' });
    expect(key('v', { ctrl: true })).toBeNull();
  });

  it('xoá, thoát, kết thúc', () => {
    expect(key('Delete')).toEqual({ type: 'delete' });
    expect(key('Backspace')).toEqual({ type: 'delete' });
    expect(key('Escape')).toEqual({ type: 'escape' });
    expect(key('Enter')).toEqual({ type: 'enter' });
  });

  it('đổi thứ tự lớp bằng [ và ]', () => {
    expect(key('[')).toEqual({ type: 'reorder', mode: 'backward' });
    expect(key(']')).toEqual({ type: 'reorder', mode: 'forward' });
    expect(key('[', { ctrl: true })).toEqual({ type: 'reorder', mode: 'back' });
    expect(key(']', { ctrl: true })).toEqual({ type: 'reorder', mode: 'front' });
  });

  it('phóng to, thu nhỏ, vừa khung', () => {
    expect(key('+')).toEqual({ type: 'zoom', direction: 'in' });
    expect(key('=')).toEqual({ type: 'zoom', direction: 'in' });
    expect(key('-')).toEqual({ type: 'zoom', direction: 'out' });
    expect(key('0')).toEqual({ type: 'zoom', direction: 'fit' });
  });

  it('mũi tên dịch hình, có phím bổ trợ', () => {
    expect(key('ArrowLeft')).toEqual({ type: 'nudge', dx: -1, dy: 0, shift: false, alt: false });
    expect(key('ArrowDown', { shift: true })).toEqual({ type: 'nudge', dx: 0, dy: 1, shift: true, alt: false });
    expect(key('ArrowUp', { alt: true })).toEqual({ type: 'nudge', dx: 0, dy: -1, shift: false, alt: true });
  });

  it('mũi tên lên xuống đổi số cạnh khi đang ở công cụ đa giác', () => {
    const polygon = (value: string) => keyToCommand({ key: value, ctrl: false, shift: false, alt: false }, { tool: 'polygon' });
    expect(polygon('ArrowUp')).toEqual({ type: 'polygonSides', delta: 1 });
    expect(polygon('ArrowDown')).toEqual({ type: 'polygonSides', delta: -1 });
    expect(polygon('ArrowLeft')).toEqual({ type: 'nudge', dx: -1, dy: 0, shift: false, alt: false });
  });

  it('bước dịch: 1 bước lưới, Shift x5, Alt 0,1', () => {
    expect(nudgeAmount(0.5, false, false)).toBe(0.5);
    expect(nudgeAmount(0.5, true, false)).toBe(2.5);
    expect(nudgeAmount(0.5, false, true)).toBe(0.1);
    expect(nudgeAmount(0.5, true, true)).toBe(0.5);
    expect(nudgeAmount(0, false, false)).toBe(1);
  });

  it('hệ số phóng theo con lăn: cuộn lên phóng to, xuống thu nhỏ', () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100)).toBeLessThan(1);
    expect(wheelZoomFactor(0)).toBe(1);
    expect(wheelZoomFactor(-3, 1)).toBeGreaterThan(wheelZoomFactor(-3, 0));
  });
});
