import {
  HISTORY_LIMIT,
  createEditorState,
  editorReducer,
  selectionBounds,
  selectionCenter,
  type EditorAction,
  type EditorState,
} from './editor-state';
import { scaling, translation } from './geometry';
import {
  createDocument,
  createShape,
  type EllipseGeometry,
  type Geometry,
  type IconShape,
  type PathGeometry,
  type RectGeometry,
} from './model';
import { parsePathData } from './path-data';

/** Hình chữ nhật chỉ tô (không nét) với mã cố định để dễ viết kỳ vọng. */
const box = (id: string, x: number, y: number, width = 4, height = 4, overrides: Partial<IconShape> = {}): IconShape => ({
  ...createShape({ type: 'rect', x, y, width, height, rx: 0 }, { stroke: 'none', fill: 'currentColor', ...overrides }),
  id,
});

const start = (shapes: IconShape[], size = 24): EditorState => createEditorState(createDocument({ id: 'icon-test', size, shapes }));
const run = (state: EditorState, ...actions: EditorAction[]): EditorState => actions.reduce(editorReducer, state);
const ids = (state: EditorState) => state.doc.shapes.map((shape) => shape.id);
const rectOf = (state: EditorState, id: string): RectGeometry => {
  const shape = state.doc.shapes.find((item) => item.id === id);
  if (!shape || shape.geometry.type !== 'rect') throw new Error(`Không có rect ${id}`);
  return shape.geometry;
};
const xs = (state: EditorState) => state.doc.shapes.map((shape) => (shape.geometry as RectGeometry).x);

describe('trạng thái ban đầu', () => {
  it('createEditorState: sạch lịch sử, chưa chọn gì, chưa dirty', () => {
    const state = start([box('a', 0, 0)]);
    expect(state).toMatchObject({ past: [], future: [], selection: [], gesture: false, dirty: false });
  });

  it('load thay toàn bộ trạng thái', () => {
    const edited = run(start([box('a', 0, 0)]), { type: 'select', ids: ['a'] }, { type: 'remove', ids: ['a'] });
    const doc = createDocument({ id: 'khac', shapes: [box('z', 1, 1)] });
    const loaded = run(edited, { type: 'load', doc });
    expect(loaded.doc).toBe(doc);
    expect(loaded).toMatchObject({ past: [], future: [], selection: [], dirty: false });
  });

  it('markSaved tắt cờ dirty nhưng giữ lịch sử', () => {
    const edited = run(start([box('a', 0, 0)]), { type: 'transform', ids: ['a'], matrix: translation(1, 0) });
    expect(edited.dirty).toBe(true);
    const saved = run(edited, { type: 'markSaved' });
    expect(saved.dirty).toBe(false);
    expect(saved.past).toHaveLength(1);
  });

  it('hành động lạ trả về nguyên trạng thái', () => {
    const state = start([box('a', 0, 0)]);
    expect(editorReducer(state, { type: 'khong-co' } as unknown as EditorAction)).toBe(state);
  });
});

describe('hoàn tác và làm lại', () => {
  it('undo/redo qua nhiều bước', () => {
    let state = start([box('a', 0, 0)]);
    state = run(state, { type: 'transform', ids: ['a'], matrix: translation(1, 0) }, { type: 'transform', ids: ['a'], matrix: translation(1, 0) });
    expect(rectOf(state, 'a').x).toBe(2);
    state = run(state, { type: 'undo' });
    expect(rectOf(state, 'a').x).toBe(1);
    state = run(state, { type: 'undo' });
    expect(rectOf(state, 'a').x).toBe(0);
    state = run(state, { type: 'redo' });
    expect(rectOf(state, 'a').x).toBe(1);
    state = run(state, { type: 'redo' });
    expect(rectOf(state, 'a').x).toBe(2);
    expect(state.future).toHaveLength(0);
  });

  it('undo khi hết lịch sử hoặc redo khi không có gì thì không đổi', () => {
    const state = start([box('a', 0, 0)]);
    expect(run(state, { type: 'undo' })).toBe(state);
    expect(run(state, { type: 'redo' })).toBe(state);
  });

  it('thay đổi mới sau undo xoá các bước làm lại', () => {
    let state = start([box('a', 0, 0)]);
    state = run(state, { type: 'transform', ids: ['a'], matrix: translation(1, 0) }, { type: 'undo' });
    expect(state.future).toHaveLength(1);
    state = run(state, { type: 'transform', ids: ['a'], matrix: translation(0, 5) });
    expect(state.future).toHaveLength(0);
    expect(run(state, { type: 'redo' })).toBe(state);
  });

  it('undo bỏ khỏi vùng chọn những lớp không còn tồn tại', () => {
    let state = start([box('a', 0, 0)]);
    state = run(state, { type: 'addShapes', shapes: [box('b', 10, 10)] });
    expect(state.selection).toEqual(['b']);
    state = run(state, { type: 'undo' });
    expect(state.selection).toEqual([]);
    expect(ids(state)).toEqual(['a']);
    state = run(state, { type: 'redo' });
    // redo không tự chọn lại lớp
    expect(ids(state)).toEqual(['a', 'b']);
    expect(state.selection).toEqual([]);
  });

  it('lịch sử bị cắt ở HISTORY_LIMIT bước', () => {
    let state = start([box('a', 0, 0)]);
    for (let index = 1; index <= HISTORY_LIMIT + 20; index += 1) state = run(state, { type: 'setMeta', patch: { name: `n${index}` } });
    expect(state.past).toHaveLength(HISTORY_LIMIT);
    for (let index = 0; index < HISTORY_LIMIT + 5; index += 1) state = run(state, { type: 'undo' });
    expect(state.doc.name).toBe('n20');
    expect(state.future.length).toBeLessThanOrEqual(HISTORY_LIMIT);
  });

  it('undo và redo đánh dấu dirty', () => {
    let state = run(start([box('a', 0, 0)]), { type: 'transform', ids: ['a'], matrix: translation(1, 0) }, { type: 'markSaved' });
    state = run(state, { type: 'undo' });
    expect(state.dirty).toBe(true);
  });
});

describe('thao tác kéo (gesture)', () => {
  const move = (dx: number): EditorAction => ({ type: 'transform', ids: ['a'], matrix: translation(dx, 0) });

  it('nhiều thay đổi trong một lần kéo gộp thành đúng một bước hoàn tác', () => {
    let state = start([box('a', 0, 0)]);
    state = run(state, { type: 'gestureStart' }, move(1), move(1), move(1), { type: 'gestureEnd' });
    expect(rectOf(state, 'a').x).toBe(3);
    expect(state.gesture).toBe(false);
    expect(state.past).toHaveLength(1);
    state = run(state, { type: 'undo' });
    expect(rectOf(state, 'a').x).toBe(0);
    expect(state.past).toHaveLength(0);
    state = run(state, { type: 'redo' });
    expect(rectOf(state, 'a').x).toBe(3);
  });

  it('trong lúc kéo, thay đổi không thêm bước vào lịch sử nhưng đánh dấu dirty', () => {
    let state = run(start([box('a', 0, 0)]), { type: 'gestureStart' });
    expect(state.dirty).toBe(false);
    state = run(state, move(2));
    expect(state.past).toHaveLength(1);
    expect(state.dirty).toBe(true);
    expect(state.gesture).toBe(true);
  });

  it('gestureEnd mà không đổi gì thì bỏ bước đã chụp', () => {
    let state = run(start([box('a', 0, 0)]), move(1));
    expect(state.past).toHaveLength(1);
    state = run(state, { type: 'gestureStart' }, { type: 'gestureEnd' });
    expect(state.past).toHaveLength(1);
    expect(state.gesture).toBe(false);
    expect(rectOf(state, 'a').x).toBe(1);
  });

  it('một cú bấm không đổi gì không làm mất các bước làm lại', () => {
    let state = run(start([box('a', 0, 0)]), move(1), { type: 'undo' });
    expect(state.future).toHaveLength(1);
    state = run(state, { type: 'gestureStart' }, { type: 'gestureEnd' });
    expect(state.future).toHaveLength(1);
    state = run(state, { type: 'redo' });
    expect(rectOf(state, 'a').x).toBe(1);
  });

  it('kéo có thay đổi thật thì xoá các bước làm lại', () => {
    let state = run(start([box('a', 0, 0)]), move(1), { type: 'undo' });
    state = run(state, { type: 'gestureStart' });
    expect(state.future).toHaveLength(1);
    state = run(state, move(5));
    expect(state.future).toHaveLength(0);
    state = run(state, { type: 'gestureEnd' });
    expect(state.past).toHaveLength(1);
  });

  it('gestureStart hai lần không chụp trùng; gestureEnd khi không kéo thì bỏ qua', () => {
    const state = start([box('a', 0, 0)]);
    const started = run(state, { type: 'gestureStart' });
    expect(run(started, { type: 'gestureStart' })).toBe(started);
    expect(run(state, { type: 'gestureEnd' })).toBe(state);
  });

  it('undo giữa chừng khi đang kéo tắt chế độ kéo', () => {
    let state = run(start([box('a', 0, 0)]), { type: 'gestureStart' }, move(3));
    state = run(state, { type: 'undo' });
    expect(state.gesture).toBe(false);
    expect(rectOf(state, 'a').x).toBe(0);
    expect(run(state, { type: 'gestureEnd' })).toBe(state);
  });
});

describe('siêu dữ liệu và kích thước', () => {
  it('setMeta đổi tên, mô tả, loại, trạng thái, thẻ', () => {
    const state = run(start([]), {
      type: 'setMeta',
      patch: { name: 'Chuông', description: 'mô tả', category: 'module', status: 'published', tags: ['a', 'b'] },
    });
    expect(state.doc).toMatchObject({ name: 'Chuông', description: 'mô tả', category: 'module', status: 'published', tags: ['a', 'b'] });
    expect(state.past).toHaveLength(1);
  });

  it('setMeta không đổi gì thì không tạo bước hoàn tác', () => {
    const state = run(start([]), { type: 'setMeta', patch: { name: 'X', tags: ['a'] } });
    expect(run(state, { type: 'setMeta', patch: { name: 'X' } })).toBe(state);
    expect(run(state, { type: 'setMeta', patch: { tags: ['a'] } })).toBe(state);
    expect(run(state, { type: 'setMeta', patch: {} })).toBe(state);
  });

  it('setMeta bỏ qua trường undefined thay vì xoá dữ liệu', () => {
    const state = run(start([]), { type: 'setMeta', patch: { name: 'Giữ nguyên' } });
    const next = run(state, { type: 'setMeta', patch: { name: undefined, description: 'mới' } });
    expect(next.doc.name).toBe('Giữ nguyên');
    expect(next.doc.description).toBe('mới');
  });

  it('setSize kẹp trong 8..128 và làm tròn', () => {
    expect(run(start([]), { type: 'setSize', size: 999, scale: false }).doc.size).toBe(128);
    expect(run(start([]), { type: 'setSize', size: 1, scale: false }).doc.size).toBe(8);
    expect(run(start([]), { type: 'setSize', size: 31.6, scale: false }).doc.size).toBe(32);
  });

  it('setSize bỏ qua số không hợp lệ hoặc cùng kích thước', () => {
    const state = start([box('a', 0, 0)]);
    expect(run(state, { type: 'setSize', size: Number.NaN, scale: true })).toBe(state);
    expect(run(state, { type: 'setSize', size: Number.POSITIVE_INFINITY, scale: false })).toBe(state);
    expect(run(state, { type: 'setSize', size: 24, scale: true })).toBe(state);
    expect(run(state, { type: 'setSize', size: 24.2, scale: true })).toBe(state);
  });

  it('setSize không scale chỉ đổi cạnh lưới, hình giữ nguyên', () => {
    const state = run(start([box('a', 2, 2)]), { type: 'setSize', size: 48, scale: false });
    expect(state.doc.size).toBe(48);
    expect(rectOf(state, 'a')).toMatchObject({ x: 2, y: 2, width: 4, height: 4 });
  });

  it('setSize có scale co giãn mọi hình theo tỉ lệ cạnh lưới (cả rect, elip và đường)', () => {
    const rectShape = box('r', 2, 2, 4, 6);
    const ellipseShape: IconShape = { ...createShape({ type: 'ellipse', cx: 12, cy: 12, rx: 3, ry: 2 }), id: 'e' };
    const pathShape: IconShape = { ...createShape(parsePathData('M 2 2 L 10 4 C 12 4 14 6 16 8')), id: 'p' };
    const state = run(start([rectShape, ellipseShape, pathShape], 24), { type: 'setSize', size: 48, scale: true });
    expect(state.doc.size).toBe(48);
    expect(rectOf(state, 'r')).toMatchObject({ x: 4, y: 4, width: 8, height: 12 });
    expect(state.doc.shapes[1].geometry).toMatchObject({ type: 'ellipse', cx: 24, cy: 24, rx: 6, ry: 4 } satisfies Partial<EllipseGeometry>);
    const nodes = (state.doc.shapes[2].geometry as PathGeometry).subpaths[0].nodes;
    expect(nodes[1]).toMatchObject({ x: 20, y: 8, hout: { x: 24, y: 8 } });
    expect(nodes[2]).toMatchObject({ x: 32, y: 16 });
    // thu nhỏ rồi phóng lại cho đúng hình ban đầu
    const back = run(state, { type: 'setSize', size: 24, scale: true });
    expect(rectOf(back, 'r')).toMatchObject({ x: 2, y: 2, width: 4, height: 6 });
    expect(back.past).toHaveLength(2);
  });

  it('setSize là một bước hoàn tác', () => {
    const state = run(start([box('a', 2, 2)]), { type: 'setSize', size: 48, scale: true }, { type: 'undo' });
    expect(state.doc.size).toBe(24);
    expect(rectOf(state, 'a').x).toBe(2);
  });
});

describe('chọn lớp', () => {
  const base = () => start([box('a', 0, 0), box('b', 5, 0), box('c', 10, 0, 4, 4, { hidden: true }), box('d', 15, 0, 4, 4, { locked: true })]);

  it('select thay vùng chọn, bỏ qua mã không tồn tại', () => {
    const state = run(base(), { type: 'select', ids: ['a', 'khong-co', 'b'] });
    expect(state.selection).toEqual(['a', 'b']);
  });

  it('select additive bật/tắt từng lớp', () => {
    let state = run(base(), { type: 'select', ids: ['a'] }, { type: 'select', ids: ['b'], additive: true });
    expect(state.selection).toEqual(['a', 'b']);
    state = run(state, { type: 'select', ids: ['a'], additive: true });
    expect(state.selection).toEqual(['b']);
  });

  it('select không đổi gì thì trả về cùng trạng thái', () => {
    const state = run(base(), { type: 'select', ids: ['a'] });
    expect(run(state, { type: 'select', ids: ['a'] })).toBe(state);
    expect(run(state, { type: 'select', ids: ['khong-co'], additive: true })).toBe(state);
  });

  it('select không đụng vào lịch sử hoàn tác', () => {
    const state = run(base(), { type: 'select', ids: ['a'] });
    expect(state.past).toHaveLength(0);
    expect(state.dirty).toBe(false);
  });

  it('selectAll bỏ qua lớp ẩn và lớp khoá', () => {
    expect(run(base(), { type: 'selectAll' }).selection).toEqual(['a', 'b']);
  });

  it('selectionBounds và selectionCenter theo khung bao của vùng chọn', () => {
    const state = base();
    expect(selectionBounds(state.doc, ['a', 'b'])).toEqual({ x: 0, y: 0, width: 9, height: 4 });
    expect(selectionBounds(state.doc, [])).toBeNull();
    expect(selectionCenter(state.doc, ['a', 'b'])).toEqual({ x: 4.5, y: 2 });
    // không chọn gì: tâm lưới
    expect(selectionCenter(state.doc, [])).toEqual({ x: 12, y: 12 });
  });
});

describe('thêm, thay, sửa kiểu', () => {
  it('addShapes thêm lên trên cùng và mặc định chọn các lớp mới', () => {
    const state = run(start([box('a', 0, 0)]), { type: 'addShapes', shapes: [box('b', 5, 5), box('c', 9, 9)] });
    expect(ids(state)).toEqual(['a', 'b', 'c']);
    expect(state.selection).toEqual(['b', 'c']);
    expect(state.dirty).toBe(true);
  });

  it('addShapes với select=false giữ vùng chọn cũ; danh sách rỗng không đổi gì', () => {
    let state = run(start([box('a', 0, 0)]), { type: 'select', ids: ['a'] });
    const initial = state;
    state = run(state, { type: 'addShapes', shapes: [box('b', 5, 5)], select: false });
    expect(state.selection).toEqual(['a']);
    expect(run(initial, { type: 'addShapes', shapes: [] })).toBe(initial);
  });

  it('replaceShapes thay đúng lớp theo mã, bỏ qua mã lạ và lớp không đổi', () => {
    const state = start([box('a', 0, 0), box('b', 5, 0)]);
    const replacement = box('a', 9, 9);
    const next = run(state, { type: 'replaceShapes', shapes: [replacement, box('lạ', 1, 1)] });
    expect(ids(next)).toEqual(['a', 'b']);
    expect(rectOf(next, 'a').x).toBe(9);
    expect(run(state, { type: 'replaceShapes', shapes: [state.doc.shapes[0]] })).toBe(state);
    expect(run(state, { type: 'replaceShapes', shapes: [box('lạ', 1, 1)] })).toBe(state);
  });

  it('updateShapes áp mẫu kiểu cho các lớp chọn, kể cả đổi khoá', () => {
    const state = start([box('a', 0, 0, 4, 4, { locked: true }), box('b', 5, 0)]);
    const next = run(state, { type: 'updateShapes', ids: ['a', 'b'], patch: { fill: '#ff0000', locked: false } });
    expect(next.doc.shapes.map((shape) => [shape.fill, shape.locked])).toEqual([
      ['#ff0000', false],
      ['#ff0000', false],
    ]);
    expect(next.past).toHaveLength(1);
  });

  it('updateShapes không thay đổi giá trị nào thì không tạo bước hoàn tác', () => {
    const state = start([box('a', 0, 0)]);
    expect(run(state, { type: 'updateShapes', ids: ['a'], patch: { fill: 'currentColor' } })).toBe(state);
    expect(run(state, { type: 'updateShapes', ids: ['khong-co'], patch: { fill: '#ff0000' } })).toBe(state);
    expect(run(state, { type: 'updateShapes', ids: ['a'], patch: {} })).toBe(state);
  });

  it('updateShapes chỉ đổi lớp được nêu', () => {
    const next = run(start([box('a', 0, 0), box('b', 5, 0)]), { type: 'updateShapes', ids: ['b'], patch: { opacity: 0.5 } });
    expect(next.doc.shapes[0].opacity).toBe(1);
    expect(next.doc.shapes[1].opacity).toBe(0.5);
  });
});

describe('biến đổi, xoá, nhân đôi', () => {
  it('transform di chuyển lớp được chọn, bỏ qua lớp khoá', () => {
    const state = start([box('a', 0, 0), box('b', 5, 0, 4, 4, { locked: true })]);
    const next = run(state, { type: 'transform', ids: ['a', 'b'], matrix: translation(2, 3) });
    expect(rectOf(next, 'a')).toMatchObject({ x: 2, y: 3 });
    expect(rectOf(next, 'b')).toMatchObject({ x: 5, y: 0 });
  });

  it('transform chỉ có lớp khoá hoặc không có lớp nào thì không đổi', () => {
    const state = start([box('a', 0, 0, 4, 4, { locked: true })]);
    expect(run(state, { type: 'transform', ids: ['a'], matrix: translation(1, 1) })).toBe(state);
    expect(run(state, { type: 'transform', ids: [], matrix: translation(1, 1) })).toBe(state);
  });

  it('transform co giãn quanh tâm', () => {
    const next = run(start([box('a', 8, 8, 8, 8)]), { type: 'transform', ids: ['a'], matrix: scaling(0.5, 0.5, 12, 12) });
    expect(rectOf(next, 'a')).toMatchObject({ x: 10, y: 10, width: 4, height: 4 });
  });

  it('remove xoá lớp và bỏ khỏi vùng chọn', () => {
    let state = run(start([box('a', 0, 0), box('b', 5, 0), box('c', 9, 0)]), { type: 'select', ids: ['a', 'b', 'c'] });
    state = run(state, { type: 'remove', ids: ['b'] });
    expect(ids(state)).toEqual(['a', 'c']);
    expect(state.selection).toEqual(['a', 'c']);
    state = run(state, { type: 'remove', ids: ['a', 'c'] });
    expect(ids(state)).toEqual([]);
    expect(state.selection).toEqual([]);
  });

  it('remove không xoá lớp khoá; không có gì để xoá thì không đổi', () => {
    const state = start([box('a', 0, 0, 4, 4, { locked: true }), box('b', 5, 0)]);
    const next = run(state, { type: 'remove', ids: ['a', 'b'] });
    expect(ids(next)).toEqual(['a']);
    expect(run(next, { type: 'remove', ids: ['a'] })).toBe(next);
    expect(run(next, { type: 'remove', ids: ['khong-co'] })).toBe(next);
  });

  it('xoá rồi hoàn tác khôi phục lớp và thứ tự', () => {
    const state = start([box('a', 0, 0), box('b', 5, 0), box('c', 9, 0)]);
    const next = run(state, { type: 'remove', ids: ['b'] }, { type: 'undo' });
    expect(ids(next)).toEqual(['a', 'b', 'c']);
  });

  it('duplicate tạo bản sao lệch 1 đơn vị, mã mới, mở khoá và chọn các bản sao', () => {
    const state = start([box('a', 0, 0, 4, 4, { locked: true }), box('b', 5, 0)]);
    const next = run(state, { type: 'duplicate', ids: ['a', 'b'] });
    expect(next.doc.shapes).toHaveLength(4);
    const copies = next.doc.shapes.slice(2);
    expect(copies.map((shape) => (shape.geometry as RectGeometry).x)).toEqual([1, 6]);
    expect(copies.map((shape) => (shape.geometry as RectGeometry).y)).toEqual([1, 1]);
    expect(copies.every((shape) => !shape.locked)).toBe(true);
    expect(copies.every((shape) => shape.name.endsWith('bản sao'))).toBe(true);
    expect(new Set(next.doc.shapes.map((shape) => shape.id)).size).toBe(4);
    expect(next.selection).toEqual(copies.map((shape) => shape.id));
    // bản gốc không đổi
    expect(rectOf(next, 'a')).toMatchObject({ x: 0, y: 0 });
  });

  it('duplicate theo độ lệch tuỳ chọn; mã không tồn tại thì không đổi', () => {
    const state = start([box('a', 0, 0)]);
    const next = run(state, { type: 'duplicate', ids: ['a'], offset: 3 });
    expect((next.doc.shapes[1].geometry as RectGeometry).x).toBe(3);
    expect(run(state, { type: 'duplicate', ids: ['khong-co'] })).toBe(state);
  });
});

describe('thứ tự lớp', () => {
  const four = () => start([box('a', 0, 0), box('b', 5, 0), box('c', 9, 0), box('d', 13, 0)]);
  const order = (state: EditorState) => ids(state).join('');

  it('front và back', () => {
    expect(order(run(four(), { type: 'reorder', ids: ['a'], mode: 'front' }))).toBe('bcda');
    expect(order(run(four(), { type: 'reorder', ids: ['c'], mode: 'back' }))).toBe('cabd');
    expect(order(run(four(), { type: 'reorder', ids: ['b', 'd'], mode: 'front' }))).toBe('acbd');
    expect(order(run(four(), { type: 'reorder', ids: ['b', 'd'], mode: 'back' }))).toBe('bdac');
  });

  it('forward và backward dịch từng bước một', () => {
    expect(order(run(four(), { type: 'reorder', ids: ['b'], mode: 'forward' }))).toBe('acbd');
    expect(order(run(four(), { type: 'reorder', ids: ['c'], mode: 'backward' }))).toBe('acbd');
  });

  it('forward/backward với nhiều lớp giữ thứ tự tương đối của vùng chọn', () => {
    expect(order(run(four(), { type: 'reorder', ids: ['a', 'b'], mode: 'forward' }))).toBe('cabd');
    expect(order(run(four(), { type: 'reorder', ids: ['c', 'd'], mode: 'backward' }))).toBe('acdb');
    // lớp liền kề nhau không đổi chỗ với nhau
    expect(order(run(four(), { type: 'reorder', ids: ['b', 'c'], mode: 'forward' }))).toBe('adbc');
  });

  it('đã ở đầu/cuối hoặc mã lạ thì không đổi, không tạo bước hoàn tác', () => {
    const state = four();
    expect(run(state, { type: 'reorder', ids: ['d'], mode: 'forward' })).toBe(state);
    expect(run(state, { type: 'reorder', ids: ['d'], mode: 'front' })).toBe(state);
    expect(run(state, { type: 'reorder', ids: ['a'], mode: 'backward' })).toBe(state);
    expect(run(state, { type: 'reorder', ids: ['a'], mode: 'back' })).toBe(state);
    expect(run(state, { type: 'reorder', ids: ['khong-co'], mode: 'front' })).toBe(state);
    expect(run(state, { type: 'reorder', ids: [], mode: 'front' })).toBe(state);
  });

  it('moveShape chuyển lớp tới vị trí chỉ định và kẹp chỉ số', () => {
    expect(order(run(four(), { type: 'moveShape', id: 'a', toIndex: 2 }))).toBe('bcad');
    expect(order(run(four(), { type: 'moveShape', id: 'd', toIndex: 0 }))).toBe('dabc');
    expect(order(run(four(), { type: 'moveShape', id: 'a', toIndex: 99 }))).toBe('bcda');
    expect(order(run(four(), { type: 'moveShape', id: 'd', toIndex: -5 }))).toBe('dabc');
  });

  it('moveShape: cùng vị trí hoặc mã lạ thì không đổi', () => {
    const state = four();
    expect(run(state, { type: 'moveShape', id: 'b', toIndex: 1 })).toBe(state);
    expect(run(state, { type: 'moveShape', id: 'khong-co', toIndex: 1 })).toBe(state);
  });

  it('đổi thứ tự là một bước hoàn tác', () => {
    const state = run(four(), { type: 'reorder', ids: ['a'], mode: 'front' }, { type: 'undo' });
    expect(order(state)).toBe('abcd');
  });
});

describe('căn chỉnh', () => {
  const trio = () => start([box('a', 2, 3, 4, 2), box('b', 8, 10, 6, 4), box('c', 16, 6, 2, 8)]);
  const pos = (state: EditorState, id: string) => {
    const geometry = rectOf(state, id);
    return { x: geometry.x, y: geometry.y };
  };

  it('căn theo khung bao của vùng chọn', () => {
    const left = run(trio(), { type: 'align', ids: ['a', 'b', 'c'], mode: 'left', to: 'selection' });
    expect([pos(left, 'a').x, pos(left, 'b').x, pos(left, 'c').x]).toEqual([2, 2, 2]);
    const right = run(trio(), { type: 'align', ids: ['a', 'b', 'c'], mode: 'right', to: 'selection' });
    // mép phải chung = 18
    expect([pos(right, 'a').x + 4, pos(right, 'b').x + 6, pos(right, 'c').x + 2]).toEqual([18, 18, 18]);
    const top = run(trio(), { type: 'align', ids: ['a', 'b', 'c'], mode: 'top', to: 'selection' });
    expect([pos(top, 'a').y, pos(top, 'b').y, pos(top, 'c').y]).toEqual([3, 3, 3]);
    const bottom = run(trio(), { type: 'align', ids: ['a', 'b', 'c'], mode: 'bottom', to: 'selection' });
    expect([pos(bottom, 'a').y + 2, pos(bottom, 'b').y + 4, pos(bottom, 'c').y + 8]).toEqual([14, 14, 14]);
  });

  it('căn giữa theo trục dọc và ngang của vùng chọn', () => {
    const center = run(trio(), { type: 'align', ids: ['a', 'b', 'c'], mode: 'center', to: 'selection' });
    // khung bao x: 2..18 -> tâm 10
    expect([pos(center, 'a').x + 2, pos(center, 'b').x + 3, pos(center, 'c').x + 1]).toEqual([10, 10, 10]);
    const middle = run(trio(), { type: 'align', ids: ['a', 'b', 'c'], mode: 'middle', to: 'selection' });
    // khung bao y: 3..14 -> tâm 8,5
    expect([pos(middle, 'a').y + 1, pos(middle, 'b').y + 2, pos(middle, 'c').y + 4]).toEqual([8.5, 8.5, 8.5]);
  });

  it('căn theo khung canvas, kể cả khi chỉ chọn một lớp', () => {
    const state = run(trio(), { type: 'align', ids: ['a'], mode: 'center', to: 'canvas' }, { type: 'align', ids: ['a'], mode: 'middle', to: 'canvas' });
    expect(pos(state, 'a')).toEqual({ x: 10, y: 11 });
    const corner = run(trio(), { type: 'align', ids: ['b'], mode: 'right', to: 'canvas' }, { type: 'align', ids: ['b'], mode: 'bottom', to: 'canvas' });
    expect(pos(corner, 'b')).toEqual({ x: 18, y: 20 });
  });

  it('canvas theo cạnh lưới hiện tại', () => {
    const state = run(start([box('a', 0, 0, 4, 4)], 48), { type: 'align', ids: ['a'], mode: 'center', to: 'canvas' });
    expect(pos(state, 'a').x).toBe(22);
  });

  it('căn có tính độ dày nét (khung bao thị giác)', () => {
    const stroked: IconShape = { ...createShape({ type: 'rect', x: 5, y: 5, width: 4, height: 4, rx: 0 }, { strokeWidth: 2 }), id: 's' };
    const state = run(start([stroked]), { type: 'align', ids: ['s'], mode: 'left', to: 'canvas' });
    // mép nét nằm đúng mép trái, nên hình dời tới x = 1
    expect(rectOf(state, 's').x).toBe(1);
  });

  it('không căn lớp khoá', () => {
    const state = start([box('a', 5, 5), box('b', 9, 9, 4, 4, { locked: true })]);
    const next = run(state, { type: 'align', ids: ['a', 'b'], mode: 'left', to: 'canvas' });
    expect(rectOf(next, 'a').x).toBe(0);
    expect(rectOf(next, 'b').x).toBe(9);
  });

  it('căn theo vùng chọn cần ít nhất hai lớp chưa khoá', () => {
    const state = trio();
    expect(run(state, { type: 'align', ids: ['a'], mode: 'left', to: 'selection' })).toBe(state);
    expect(run(state, { type: 'align', ids: [], mode: 'left', to: 'canvas' })).toBe(state);
    const withLocked = start([box('a', 2, 2), box('b', 8, 8, 4, 4, { locked: true })]);
    expect(run(withLocked, { type: 'align', ids: ['a', 'b'], mode: 'left', to: 'selection' })).toBe(withLocked);
  });

  it('đã căn rồi thì không tạo bước hoàn tác', () => {
    const state = start([box('a', 0, 0), box('b', 0, 10)]);
    expect(run(state, { type: 'align', ids: ['a', 'b'], mode: 'left', to: 'selection' })).toBe(state);
    const aligned = run(trio(), { type: 'align', ids: ['a', 'b', 'c'], mode: 'left', to: 'selection' });
    expect(run(aligned, { type: 'align', ids: ['a', 'b', 'c'], mode: 'left', to: 'selection' })).toBe(aligned);
  });

  it('căn một bước hoàn tác được', () => {
    const state = run(trio(), { type: 'align', ids: ['a', 'b', 'c'], mode: 'left', to: 'selection' }, { type: 'undo' });
    expect(pos(state, 'b')).toEqual({ x: 8, y: 10 });
  });
});

describe('phân phối đều', () => {
  it('chia đều khoảng trống ngang, hai hình ngoài cùng đứng yên', () => {
    const state = start([box('a', 0, 0), box('b', 5, 0), box('c', 20, 0)]);
    const next = run(state, { type: 'distribute', ids: ['a', 'b', 'c'], axis: 'horizontal' });
    expect(xs(next)).toEqual([0, 10, 20]);
  });

  it('chia đều theo chiều dọc', () => {
    const state = start([box('a', 0, 0), box('b', 0, 3), box('c', 0, 20)]);
    const next = run(state, { type: 'distribute', ids: ['a', 'b', 'c'], axis: 'vertical' });
    expect(next.doc.shapes.map((shape) => (shape.geometry as RectGeometry).y)).toEqual([0, 10, 20]);
  });

  it('không phụ thuộc thứ tự lớp trong danh sách', () => {
    const state = start([box('c', 20, 0), box('a', 0, 0), box('b', 5, 0)]);
    const next = run(state, { type: 'distribute', ids: ['c', 'a', 'b'], axis: 'horizontal' });
    expect(rectOf(next, 'b').x).toBe(10);
  });

  it('cần ít nhất ba lớp chưa khoá', () => {
    const two = start([box('a', 0, 0), box('b', 5, 0)]);
    expect(run(two, { type: 'distribute', ids: ['a', 'b'], axis: 'horizontal' })).toBe(two);
    const locked = start([box('a', 0, 0), box('b', 5, 0), box('c', 20, 0, 4, 4, { locked: true })]);
    expect(run(locked, { type: 'distribute', ids: ['a', 'b', 'c'], axis: 'horizontal' })).toBe(locked);
  });

  it('đã đều sẵn thì không tạo bước hoàn tác', () => {
    const state = start([box('a', 0, 0), box('b', 10, 0), box('c', 20, 0)]);
    expect(run(state, { type: 'distribute', ids: ['a', 'b', 'c'], axis: 'horizontal' })).toBe(state);
  });
});

describe('chuyển sang đường, gộp, tách', () => {
  it('convertToPath đổi rect và elip thành path, giữ kiểu dáng; không đụng path và lớp khoá', () => {
    const rectShape = box('r', 2, 2, 8, 8);
    const ellipseShape: IconShape = { ...createShape({ type: 'ellipse', cx: 12, cy: 12, rx: 4, ry: 4 }), id: 'e' };
    const pathShape: IconShape = { ...createShape(parsePathData('M 0 0 L 4 4')), id: 'p' };
    const lockedShape = box('l', 0, 0, 4, 4, { locked: true });
    const state = start([rectShape, ellipseShape, pathShape, lockedShape]);
    const next = run(state, { type: 'convertToPath', ids: ['r', 'e', 'p', 'l'] });
    expect(next.doc.shapes.map((shape) => shape.geometry.type)).toEqual(['path', 'path', 'path', 'rect']);
    expect(next.doc.shapes[2]).toBe(state.doc.shapes[2]);
    expect(next.doc.shapes[0].fill).toBe('currentColor');
    expect(next.doc.shapes[0].id).toBe('r');
    expect((next.doc.shapes[0].geometry as PathGeometry).subpaths[0].nodes).toHaveLength(4);
  });

  it('convertToPath không có gì để đổi thì không tạo bước', () => {
    const state = start([{ ...createShape(parsePathData('M 0 0 L 4 4')), id: 'p' }]);
    expect(run(state, { type: 'convertToPath', ids: ['p'] })).toBe(state);
  });

  it('combine gộp các lớp thành một đường nhiều đường con, lấy kiểu của lớp đầu và đứng ở vị trí lớp đầu', () => {
    const a = box('a', 0, 0, 4, 4, { fill: '#ff0000' });
    const b = box('b', 10, 0, 4, 4, { fill: '#00ff00' });
    const mid: IconShape = { ...createShape(parsePathData('M 0 20 L 4 20')), id: 'mid' };
    const state = start([a, mid, b]);
    const next = run(state, { type: 'combine', ids: ['b', 'a'] });
    expect(ids(next)).toEqual(['a', 'mid']);
    const merged = next.doc.shapes[0];
    expect(merged.fill).toBe('#ff0000');
    expect(merged.name).toBe('Đường gộp');
    const geometry = merged.geometry as PathGeometry;
    expect(geometry.type).toBe('path');
    expect(geometry.subpaths).toHaveLength(2);
    expect(geometry.subpaths[0].nodes[0]).toEqual({ x: 0, y: 0 });
    expect(geometry.subpaths[1].nodes[0]).toEqual({ x: 10, y: 0 });
    expect(next.selection).toEqual(['a']);
  });

  it('combine cần ít nhất hai lớp chưa khoá', () => {
    const state = start([box('a', 0, 0), box('b', 5, 0, 4, 4, { locked: true })]);
    expect(run(state, { type: 'combine', ids: ['a', 'b'] })).toBe(state);
    expect(run(state, { type: 'combine', ids: ['a'] })).toBe(state);
  });

  it('combine bỏ qua lớp khoá nhưng vẫn gộp các lớp còn lại', () => {
    const state = start([box('a', 0, 0), box('b', 5, 0), box('c', 9, 0, 4, 4, { locked: true })]);
    const next = run(state, { type: 'combine', ids: ['a', 'b', 'c'] });
    expect(ids(next)).toEqual(['a', 'c']);
  });

  it('separate tách từng đường con thành lớp riêng với mã mới, tên đánh số và chọn các lớp mới', () => {
    const multi: IconShape = {
      ...createShape(parsePathData('M 0 0 L 4 0 L 4 4 Z M 10 10 L 14 10 M 20 0 L 22 2'), { fill: '#ff0000', name: 'Nhiều' }),
      id: 'multi',
    };
    const state = start([box('a', 0, 0), multi]);
    const next = run(state, { type: 'separate', ids: ['multi'] });
    expect(next.doc.shapes).toHaveLength(4);
    expect(next.doc.shapes[0].id).toBe('a');
    const parts = next.doc.shapes.slice(1);
    expect(parts.map((shape) => shape.name)).toEqual(['Nhiều 1', 'Nhiều 2', 'Nhiều 3']);
    expect(parts.every((shape) => shape.fill === '#ff0000')).toBe(true);
    expect(parts.map((shape) => (shape.geometry as PathGeometry).subpaths.length)).toEqual([1, 1, 1]);
    expect((parts[0].geometry as PathGeometry).subpaths[0].closed).toBe(true);
    expect(new Set(next.doc.shapes.map((shape) => shape.id)).size).toBe(4);
    expect(next.selection).toEqual(parts.map((shape) => shape.id));
  });

  it('separate chỉ áp cho đường có nhiều đường con và chưa khoá', () => {
    const single: IconShape = { ...createShape(parsePathData('M 0 0 L 4 4')), id: 'single' };
    const locked: IconShape = { ...createShape(parsePathData('M 0 0 L 4 4 M 8 8 L 9 9'), {}), id: 'locked', locked: true };
    const state = start([single, locked, box('r', 0, 0)]);
    expect(run(state, { type: 'separate', ids: ['single', 'locked', 'r'] })).toBe(state);
  });

  it('combine rồi separate cho lại số đường con ban đầu; undo hoàn nguyên từng bước', () => {
    const state = start([box('a', 0, 0), box('b', 10, 0), box('c', 20, 0)]);
    const combined = run(state, { type: 'combine', ids: ['a', 'b', 'c'] });
    expect(combined.doc.shapes).toHaveLength(1);
    const separated = run(combined, { type: 'separate', ids: combined.selection });
    expect(separated.doc.shapes).toHaveLength(3);
    expect(separated.doc.shapes.map((shape) => (shape.geometry as PathGeometry).subpaths[0].nodes[0].x)).toEqual([0, 10, 20]);
    const undone = run(separated, { type: 'undo' }, { type: 'undo' });
    expect(undone.doc.shapes.map((shape) => shape.geometry.type)).toEqual(['rect', 'rect', 'rect']);
  });
});

describe('giới hạn của thư viện (nếu vượt, icon bị từ chối khi nạp lại)', () => {
  const many = (count: number) => Array.from({ length: count }, (_, index) => box(`s${index}`, index % 20, 0, 1, 1));

  it('addShapes chỉ nhận phần còn chỗ trong 200 lớp, hết chỗ thì không đổi', () => {
    const state = start(many(198));
    const next = run(state, { type: 'addShapes', shapes: [box('n1', 0, 0), box('n2', 1, 0), box('n3', 2, 0), box('n4', 3, 0), box('n5', 4, 0)] });
    expect(next.doc.shapes).toHaveLength(200);
    expect(next.selection).toEqual(['n1', 'n2']);
    expect(run(next, { type: 'addShapes', shapes: [box('n6', 0, 0)] })).toBe(next);
  });

  it('duplicate chỉ nhân đôi phần còn chỗ', () => {
    const state = start(many(199));
    const next = run(state, { type: 'duplicate', ids: ['s0', 's1', 's2'] });
    expect(next.doc.shapes).toHaveLength(200);
    expect(next.selection).toHaveLength(1);
    expect(run(next, { type: 'duplicate', ids: ['s0'] })).toBe(next);
  });

  it('combine không gộp khi đường gộp vượt 64 đường con', () => {
    const over = start(many(65));
    expect(run(over, { type: 'combine', ids: over.doc.shapes.map((shape) => shape.id) })).toBe(over);
    const ok = start(many(64));
    const merged = run(ok, { type: 'combine', ids: ok.doc.shapes.map((shape) => shape.id) });
    expect(merged.doc.shapes).toHaveLength(1);
    expect((merged.doc.shapes[0].geometry as PathGeometry).subpaths).toHaveLength(64);
  });

  it('combine không gộp khi tổng số điểm neo vượt 2000', () => {
    const big = (id: string) => ({ ...createShape({ type: 'path', subpaths: [{ closed: false, nodes: Array.from({ length: 1001 }, (_, index) => ({ x: index % 24, y: 1 })) }] }), id });
    const state = start([big('a'), big('b')]);
    expect(run(state, { type: 'combine', ids: ['a', 'b'] })).toBe(state);
  });

  it('separate không tách khi tổng số lớp sẽ vượt 200', () => {
    const subpaths = Array.from({ length: 64 }, (_, index) => ({ closed: false, nodes: [{ x: index % 24, y: 0 }, { x: index % 24, y: 5 }] }));
    const multi: IconShape = { ...createShape({ type: 'path', subpaths }), id: 'multi' };
    const state = start([...many(150), multi]);
    expect(run(state, { type: 'separate', ids: ['multi'] })).toBe(state);
    const roomy = start([...many(100), multi]);
    expect(run(roomy, { type: 'separate', ids: ['multi'] }).doc.shapes).toHaveLength(100 + 64);
  });
});

describe('tính bất biến', () => {
  it('không bao giờ sửa trực tiếp tài liệu cũ trong lịch sử', () => {
    const state = start([box('a', 0, 0), box('b', 5, 0)]);
    const snapshot = JSON.stringify(state.doc);
    let next = run(
      state,
      { type: 'transform', ids: ['a'], matrix: translation(3, 3) },
      { type: 'remove', ids: ['b'] },
      { type: 'duplicate', ids: ['a'] },
      { type: 'convertToPath', ids: ['a'] },
      { type: 'setSize', size: 32, scale: true },
    );
    next = run(next, { type: 'undo' }, { type: 'undo' }, { type: 'undo' }, { type: 'undo' }, { type: 'undo' });
    expect(JSON.stringify(next.doc)).toBe(snapshot);
  });

  it('vùng chọn luôn chỉ chứa lớp đang tồn tại sau mọi thao tác', () => {
    const actions: EditorAction[] = [
      { type: 'select', ids: ['a', 'b', 'c'] },
      { type: 'remove', ids: ['b'] },
      { type: 'duplicate', ids: ['a'] },
      { type: 'combine', ids: ['a', 'c'] },
      { type: 'undo' },
      { type: 'undo' },
      { type: 'redo' },
    ];
    let state = start([box('a', 0, 0), box('b', 5, 0), box('c', 9, 0)]);
    for (const action of actions) {
      state = editorReducer(state, action);
      const alive = new Set(ids(state));
      expect(state.selection.every((id) => alive.has(id))).toBe(true);
    }
  });

  it('hình học dùng trong kiểm thử là kiểu Geometry hợp lệ', () => {
    const geometry: Geometry = rectOf(start([box('a', 0, 0)]), 'a');
    expect(geometry.type).toBe('rect');
  });
});
