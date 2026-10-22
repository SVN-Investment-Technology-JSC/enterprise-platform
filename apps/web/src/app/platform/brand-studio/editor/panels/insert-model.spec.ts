import {
  DEFAULT_RULES,
  FRAME_KINDS,
  GLYPH_LIBRARY,
  createEditorState,
  editorReducer,
  geometryBounds,
  type PathGeometry,
} from '@enterprise-platform/shared-brand-icon';
import {
  analyzeSvg,
  checkSvgFile,
  clampSides,
  frameShape,
  FRAME_PREVIEW_PATHS,
  glyphShape,
  glyphsByGroup,
  importForInsert,
  insertBehind,
  MAX_SVG_BYTES,
  quickShape,
  readFileAsText,
  trimWarnings,
} from './insert-model';
import { rectShape, testDoc } from './panel-test-utils';

const nodesOf = (geometry: unknown) => (geometry as PathGeometry).subpaths[0].nodes;

function glyph(id: string) {
  const found = GLYPH_LIBRARY.find((item) => item.id === id);
  if (!found) throw new Error(`Không có hình mẫu ${id}`);
  return found;
}

describe('quickShape', () => {
  it('chữ nhật và hình tròn nằm giữa lưới, trên lưới nửa đơn vị, chỉ có nét', () => {
    const rect = quickShape('rect', { size: 24, strokeWidth: 1.75 });
    expect(rect.geometry).toEqual({ type: 'rect', x: 6, y: 6, width: 12, height: 12, rx: 0 });
    expect(rect).toMatchObject({ fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, name: 'Chữ nhật' });

    const circle = quickShape('ellipse', { size: 24, strokeWidth: 2 });
    expect(circle.geometry).toEqual({ type: 'ellipse', cx: 12, cy: 12, rx: 6, ry: 6 });
    expect(circle).toMatchObject({ strokeWidth: 2, name: 'Hình tròn' });
  });

  it('co theo cỡ lưới', () => {
    expect(geometryBounds(quickShape('rect', { size: 48, strokeWidth: 1.75 }).geometry)).toEqual({ x: 12, y: 12, width: 24, height: 24 });
    expect(geometryBounds(quickShape('rect', { size: 20, strokeWidth: 1.75 }).geometry)).toEqual({ x: 5, y: 5, width: 10, height: 10 });
  });

  it('đường thẳng nằm ngang qua tâm, không đóng', () => {
    const line = quickShape('line', { size: 24, strokeWidth: 1.75 });
    expect(line.geometry).toEqual({ type: 'path', subpaths: [{ closed: false, nodes: [{ x: 6, y: 12 }, { x: 18, y: 12 }] }] });
    expect(line.name).toBe('Đường thẳng');
  });

  it('đa giác có đúng số đỉnh, đóng kín, đỉnh đầu hướng lên và nằm giữa theo chiều ngang', () => {
    const shape = quickShape('polygon', { size: 24, strokeWidth: 1.75, sides: 6 });
    const geometry = shape.geometry as PathGeometry;
    expect(geometry.subpaths[0].closed).toBe(true);
    expect(nodesOf(geometry)).toHaveLength(6);
    expect(nodesOf(geometry)[0]).toEqual({ x: 12, y: 3 });
    const bounds = geometryBounds(geometry);
    expect(bounds.x + bounds.width / 2).toBeCloseTo(12, 2);
    expect(shape.name).toBe('Đa giác');
  });

  it('ngôi sao có gấp đôi số đỉnh, đỉnh trong ở gần tâm hơn đỉnh ngoài', () => {
    const shape = quickShape('star', { size: 24, strokeWidth: 1.75, sides: 5 });
    const nodes = nodesOf(shape.geometry);
    expect(nodes).toHaveLength(10);
    const distance = (node: { x: number; y: number }) => Math.hypot(node.x - 12, node.y - 12);
    expect(distance(nodes[0])).toBeGreaterThan(distance(nodes[1]));
    expect(distance(nodes[1])).toBeCloseTo(distance(nodes[3]), 2);
    expect(shape.name).toBe('Ngôi sao');
  });

  it('số cạnh mặc định là 5 và bị kẹp trong khoảng 3 đến 12', () => {
    expect(nodesOf(quickShape('polygon', { size: 24, strokeWidth: 1.75 }).geometry)).toHaveLength(5);
    expect(nodesOf(quickShape('polygon', { size: 24, strokeWidth: 1.75, sides: 1 }).geometry)).toHaveLength(3);
    expect(nodesOf(quickShape('polygon', { size: 24, strokeWidth: 1.75, sides: 99 }).geometry)).toHaveLength(12);
    expect(clampSides(4.6)).toBe(5);
  });

  it('mỗi hình có mã riêng', () => {
    const a = quickShape('rect', { size: 24, strokeWidth: 1.75 });
    const b = quickShape('rect', { size: 24, strokeWidth: 1.75 });
    expect(a.id).not.toBe(b.id);
  });
});

describe('khung mẫu', () => {
  it('có chuỗi đường vẽ ảnh nhỏ cho mọi loại khung', () => {
    for (const kind of FRAME_KINDS) expect(FRAME_PREVIEW_PATHS[kind]).toMatch(/^M/);
  });

  it('khung dùng độ dày theo quy chuẩn và cỡ lưới của icon', () => {
    const shape = frameShape('circle', 32, { ...DEFAULT_RULES, allowedStrokeWidths: [2, 3] });
    expect(shape.strokeWidth).toBe(2);
    expect(shape.geometry).toMatchObject({ type: 'ellipse', cx: 16, cy: 16 });
  });

  it('insertBehind: chèn xuống dưới cùng, chọn hình vừa chèn, chỉ một bước hoàn tác', () => {
    const doc = testDoc([rectShape('a'), rectShape('b')]);
    const frame = frameShape('squircle', 24, DEFAULT_RULES);
    let state = createEditorState(doc);
    for (const action of insertBehind([frame])) state = editorReducer(state, action);

    expect(state.doc.shapes.map((shape) => shape.id)).toEqual([frame.id, 'a', 'b']);
    expect(state.selection).toEqual([frame.id]);
    expect(state.past).toHaveLength(1);
    expect(state.gesture).toBe(false);

    state = editorReducer(state, { type: 'undo' });
    expect(state.doc.shapes.map((shape) => shape.id)).toEqual(['a', 'b']);
  });
});

describe('thư viện hình mẫu', () => {
  it('gom theo nhóm theo đúng thứ tự và không bỏ sót hình nào', () => {
    const groups = glyphsByGroup();
    expect(groups.map((entry) => entry.group)).toEqual(['Monogram', 'Nghiệp vụ', 'Hệ thống']);
    expect(groups.flatMap((entry) => entry.items)).toHaveLength(GLYPH_LIBRARY.length);
  });

  it('chuyển hình mẫu thành lớp đường ở lưới 24', () => {
    const shape = glyphShape(glyph('monogram-v'), 24, 1.75);
    expect(shape).toMatchObject({ name: 'Monogram V (Việt Nam / Velocity)', strokeWidth: 1.75, fill: 'none' });
    expect(nodesOf(shape?.geometry)).toEqual([{ x: 6, y: 6 }, { x: 12, y: 18 }, { x: 18, y: 6 }]);
  });

  it('co hình mẫu về cỡ lưới của icon', () => {
    const shape = glyphShape(glyph('monogram-v'), 48, 2);
    expect(nodesOf(shape?.geometry)).toEqual([{ x: 12, y: 12 }, { x: 24, y: 36 }, { x: 36, y: 12 }]);
    expect(shape?.strokeWidth).toBe(2);
  });

  it('mọi hình mẫu đổi được thành lớp hợp lệ trong khung lưới', () => {
    for (const template of GLYPH_LIBRARY) {
      const shape = glyphShape(template, 24, 1.75);
      if (!shape) throw new Error(`Hình mẫu ${template.id} không đổi được thành lớp`);
      const box = geometryBounds(shape.geometry);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(24);
    }
  });

  it('dữ liệu đường hỏng thì trả null thay vì ném lỗi', () => {
    expect(glyphShape({ id: 'x', name: 'x', group: 'Monogram', path: 'khong phai duong' }, 24, 1.75)).toBeNull();
  });
});

describe('nhập SVG', () => {
  const SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1"><path d="M4 12h16"/><circle cx="12" cy="12" r="6"/></svg>';

  it('nhận đúng tệp .svg và từ chối tệp khác hoặc quá lớn', () => {
    expect(checkSvgFile({ name: 'a.svg', type: 'image/svg+xml', size: 100 })).toBeNull();
    expect(checkSvgFile({ name: 'A.SVG', type: '', size: 100 })).toBeNull();
    expect(checkSvgFile({ name: 'a', type: 'image/svg+xml', size: 100 })).toBeNull();
    expect(checkSvgFile({ name: 'a.png', type: 'image/png', size: 100 })).toBe('Chỉ nhận tệp .svg.');
    expect(checkSvgFile({ name: 'a.svg', type: 'image/svg+xml', size: MAX_SVG_BYTES + 1 })).toBe('Tệp quá lớn (tối đa 1 MB).');
  });

  it('đọc nội dung tệp bằng FileReader', async () => {
    await expect(readFileAsText(new File([SVG], 'a.svg', { type: 'image/svg+xml' }))).resolves.toBe(SVG);
  });

  it('phân tích SVG: số hình, độ dày nét và có lệch quy chuẩn hay không', () => {
    const analysis = analyzeSvg(SVG, 24, DEFAULT_RULES);
    expect(analysis.error).toBeNull();
    expect(analysis.result?.shapes).toHaveLength(2);
    expect(analysis.result?.dominantStrokeWidth).toBe(1);
    expect(analysis.deviates).toBe(true);

    const aligned = analyzeSvg(SVG.replace('stroke-width="1"', 'stroke-width="1.75"'), 24, DEFAULT_RULES);
    expect(aligned.deviates).toBe(false);
  });

  it('SVG toàn tô đặc không có nét thì không có độ dày chủ đạo và không lệch', () => {
    const analysis = analyzeSvg('<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16"/></svg>', 24, DEFAULT_RULES);
    expect(analysis.result?.dominantStrokeWidth).toBeNull();
    expect(analysis.deviates).toBe(false);
  });

  it('báo lỗi cho mã không phải SVG hợp lệ và để trống khi chưa nhập gì', () => {
    expect(analyzeSvg('', 24, DEFAULT_RULES)).toEqual({ result: null, error: null, deviates: false });
    expect(analyzeSvg('   ', 24, DEFAULT_RULES).result).toBeNull();
    const broken = analyzeSvg('<svg><path', 24, DEFAULT_RULES);
    expect(broken.result).toBeNull();
    expect(broken.error).toBeTruthy();
    expect(analyzeSvg('<svg viewBox="0 0 24 24"></svg>', 24, DEFAULT_RULES).error).toContain('Không tìm thấy hình nào');
  });

  it('từ chối mã quá lớn mà không đọc', () => {
    expect(analyzeSvg(`<svg>${' '.repeat(MAX_SVG_BYTES)}</svg>`, 24, DEFAULT_RULES).error).toContain('quá lớn');
  });

  it('importForInsert: chuẩn hoá ép mọi nét về độ dày theo quy chuẩn, không chuẩn hoá thì giữ nguyên', () => {
    const normalized = importForInsert(SVG, 24, DEFAULT_RULES, true);
    expect(normalized.shapes.map((shape) => shape.strokeWidth)).toEqual([1.75, 1.75]);
    const kept = importForInsert(SVG, 24, DEFAULT_RULES, false);
    expect(kept.shapes.map((shape) => shape.strokeWidth)).toEqual([1, 1]);
  });

  it('importForInsert co SVG về lưới của icon', () => {
    const result = importForInsert(SVG, 48, DEFAULT_RULES, false);
    expect(geometryBounds(result.shapes[0].geometry)).toMatchObject({ x: 8, width: 32 });
  });

  it('trimWarnings giữ vài cảnh báo đầu và đếm phần còn lại', () => {
    expect(trimWarnings(['a', 'b'])).toEqual({ shown: ['a', 'b'], hidden: 0 });
    expect(trimWarnings(['a', 'b', 'c', 'd', 'e'])).toEqual({ shown: ['a', 'b', 'c'], hidden: 2 });
    expect(trimWarnings([])).toEqual({ shown: [], hidden: 0 });
  });
});
