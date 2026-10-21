import {
  alignOffsets,
  distributeOffsets,
  geometryToPath,
  rectCenter,
  scaling,
  transformShape,
  translation,
  unionRects,
  visualBounds,
  type AlignMode,
  type Matrix,
} from './geometry';
import { LIMITS } from './validate';
import {
  newId,
  type Geometry,
  type IconCategory,
  type IconDocument,
  type IconShape,
  type IconStatus,
  type PathGeometry,
  type Point,
  type Rect,
  type Subpath,
} from './model';

export const HISTORY_LIMIT = 100;

export interface EditorState {
  readonly doc: IconDocument;
  readonly past: readonly IconDocument[];
  readonly future: readonly IconDocument[];
  /** Mã các lớp đang chọn, theo thứ tự chọn. */
  readonly selection: readonly string[];
  /** Đang trong một thao tác kéo: các thay đổi gộp thành một bước hoàn tác. */
  readonly gesture: boolean;
  /** Có thay đổi chưa lưu so với lần `markSaved` gần nhất. */
  readonly dirty: boolean;
}

export type ShapeStylePatch = Partial<Omit<IconShape, 'id' | 'geometry'>>;
export type MetaPatch = Partial<{
  name: string;
  description: string;
  category: IconCategory;
  tags: readonly string[];
  status: IconStatus;
}>;

export type ReorderMode = 'forward' | 'backward' | 'front' | 'back';

export type EditorAction =
  | { type: 'load'; doc: IconDocument }
  | { type: 'markSaved' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'select'; ids: readonly string[]; additive?: boolean }
  | { type: 'selectAll' }
  | { type: 'gestureStart' }
  | { type: 'gestureEnd' }
  | { type: 'setMeta'; patch: MetaPatch }
  | { type: 'setSize'; size: number; scale: boolean }
  | { type: 'addShapes'; shapes: readonly IconShape[]; select?: boolean }
  | { type: 'replaceShapes'; shapes: readonly IconShape[] }
  | { type: 'updateShapes'; ids: readonly string[]; patch: ShapeStylePatch }
  | { type: 'transform'; ids: readonly string[]; matrix: Matrix }
  | { type: 'remove'; ids: readonly string[] }
  | { type: 'duplicate'; ids: readonly string[]; offset?: number }
  | { type: 'reorder'; ids: readonly string[]; mode: ReorderMode }
  | { type: 'moveShape'; id: string; toIndex: number }
  | { type: 'align'; ids: readonly string[]; mode: AlignMode; to: 'selection' | 'canvas' }
  | { type: 'distribute'; ids: readonly string[]; axis: 'horizontal' | 'vertical' }
  | { type: 'convertToPath'; ids: readonly string[] }
  | { type: 'combine'; ids: readonly string[] }
  | { type: 'separate'; ids: readonly string[] };

export function createEditorState(doc: IconDocument): EditorState {
  return { doc, past: [], future: [], selection: [], gesture: false, dirty: false };
}

const sameList = <T>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((value, index) => value === b[index]);

function commit(state: EditorState, doc: IconDocument, selection: readonly string[] = state.selection): EditorState {
  if (doc === state.doc) return state;
  const alive = new Set(doc.shapes.map((shape) => shape.id));
  const nextSelection = selection.filter((id) => alive.has(id));
  if (state.gesture) {
    return { ...state, doc, selection: nextSelection, future: [], dirty: true };
  }
  return {
    ...state,
    doc,
    past: [...state.past, state.doc].slice(-HISTORY_LIMIT),
    future: [],
    selection: nextSelection,
    dirty: true,
  };
}

const withShapes = (doc: IconDocument, shapes: readonly IconShape[]): IconDocument => ({ ...doc, shapes });

const exists = (doc: IconDocument, ids: readonly string[]) => ids.filter((id) => doc.shapes.some((shape) => shape.id === id));

/** Lớp chưa khoá trong danh sách chọn; thao tác sửa không động tới lớp bị khoá. */
function editable(doc: IconDocument, ids: readonly string[]): IconShape[] {
  const wanted = new Set(ids);
  return doc.shapes.filter((shape) => wanted.has(shape.id) && !shape.locked);
}

export function selectionBounds(doc: IconDocument, ids: readonly string[]): Rect | null {
  const wanted = new Set(ids);
  return unionRects(doc.shapes.filter((shape) => wanted.has(shape.id)).map(visualBounds));
}

function reorder(shapes: readonly IconShape[], ids: ReadonlySet<string>, mode: ReorderMode): IconShape[] {
  const list = [...shapes];
  const selected = list.filter((shape) => ids.has(shape.id));
  const rest = list.filter((shape) => !ids.has(shape.id));
  if (selected.length === 0) return list;
  if (mode === 'front') return [...rest, ...selected];
  if (mode === 'back') return [...selected, ...rest];

  const result = [...list];
  if (mode === 'forward') {
    for (let index = result.length - 2; index >= 0; index -= 1) {
      if (ids.has(result[index].id) && !ids.has(result[index + 1].id)) {
        [result[index], result[index + 1]] = [result[index + 1], result[index]];
      }
    }
  } else {
    for (let index = 1; index < result.length; index += 1) {
      if (ids.has(result[index].id) && !ids.has(result[index - 1].id)) {
        [result[index], result[index - 1]] = [result[index - 1], result[index]];
      }
    }
  }
  return result;
}

/** Bỏ các độ dịch bằng 0 (sai số dưới 1e-9) để thao tác không làm đổi gì thì không tạo bước hoàn tác. */
function movingOffsets(offsets: ReadonlyMap<string, Point>): Map<string, Point> {
  return new Map([...offsets].filter(([, offset]) => Math.abs(offset.x) > 1e-9 || Math.abs(offset.y) > 1e-9));
}

function combinePaths(doc: IconDocument, ids: readonly string[]): { doc: IconDocument; selection: string[] } | null {
  const targets = editable(doc, ids);
  if (targets.length < 2) return null;
  const subpaths: Subpath[] = targets.flatMap((shape) => [...geometryToPath(shape.geometry).subpaths]);
  const nodeCount = subpaths.reduce((sum, sub) => sum + sub.nodes.length, 0);
  // Đường gộp vượt giới hạn của thư viện sẽ làm cả icon bị từ chối khi nạp lại.
  if (subpaths.length > LIMITS.maxSubpaths || nodeCount > LIMITS.maxNodes) return null;
  const first = targets[0];
  const merged: IconShape = { ...first, name: 'Đường gộp', geometry: { type: 'path', subpaths } };
  const drop = new Set(targets.map((shape) => shape.id));
  const shapes = doc.shapes.flatMap((shape) => {
    if (shape.id === first.id) return [merged];
    return drop.has(shape.id) ? [] : [shape];
  });
  return { doc: withShapes(doc, shapes), selection: [merged.id] };
}

function separatePath(doc: IconDocument, ids: readonly string[]): { doc: IconDocument; selection: string[] } | null {
  const targets = new Set(
    editable(doc, ids)
      .filter((shape) => geometryToPath(shape.geometry).subpaths.length > 1)
      .map((shape) => shape.id),
  );
  if (targets.size === 0) return null;
  const extra = editable(doc, ids)
    .filter((shape) => targets.has(shape.id))
    .reduce((sum, shape) => sum + geometryToPath(shape.geometry).subpaths.length - 1, 0);
  if (doc.shapes.length + extra > LIMITS.maxShapes) return null;
  const selection: string[] = [];
  const shapes = doc.shapes.flatMap((shape) => {
    if (!targets.has(shape.id)) return [shape];
    return geometryToPath(shape.geometry).subpaths.map((sub, index): IconShape => {
      const id = newId('shape');
      selection.push(id);
      const geometry: PathGeometry = { type: 'path', subpaths: [sub] };
      return { ...shape, id, name: `${shape.name} ${index + 1}`, geometry };
    });
  });
  return { doc: withShapes(doc, shapes), selection };
}

function scaleDocument(doc: IconDocument, size: number): IconDocument {
  const factor = size / doc.size;
  return {
    ...doc,
    size,
    shapes: doc.shapes.map((shape) => transformShape(shape, scaling(factor, factor, 0, 0))),
  };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const { doc } = state;
  switch (action.type) {
    case 'load':
      return createEditorState(action.doc);

    case 'markSaved':
      return { ...state, dirty: false };

    case 'undo': {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      const alive = new Set(previous.shapes.map((shape) => shape.id));
      return {
        ...state,
        doc: previous,
        past: state.past.slice(0, -1),
        future: [doc, ...state.future].slice(0, HISTORY_LIMIT),
        selection: state.selection.filter((id) => alive.has(id)),
        gesture: false,
        dirty: true,
      };
    }

    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      const alive = new Set(next.shapes.map((shape) => shape.id));
      return {
        ...state,
        doc: next,
        past: [...state.past, doc].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        selection: state.selection.filter((id) => alive.has(id)),
        gesture: false,
        dirty: true,
      };
    }

    case 'select': {
      const ids = exists(doc, action.ids);
      const next = action.additive
        ? [...state.selection.filter((id) => !ids.includes(id)), ...ids.filter((id) => !state.selection.includes(id))]
        : ids;
      return sameList(next, state.selection) ? state : { ...state, selection: next };
    }

    case 'selectAll':
      return { ...state, selection: doc.shapes.filter((shape) => !shape.hidden && !shape.locked).map((shape) => shape.id) };

    case 'gestureStart':
      if (state.gesture) return state;
      // Chụp trạng thái trước khi kéo; nếu cuối cùng không đổi gì thì `gestureEnd` bỏ bước này.
      // Chưa xoá `future`: một cú bấm không làm đổi gì không được phép làm mất các bước làm lại; `commit` sẽ xoá khi có thay đổi thật.
      return { ...state, gesture: true, past: [...state.past, doc].slice(-HISTORY_LIMIT) };

    case 'gestureEnd': {
      if (!state.gesture) return state;
      const last = state.past[state.past.length - 1];
      const unchanged = last === doc;
      return { ...state, gesture: false, past: unchanged ? state.past.slice(0, -1) : state.past };
    }

    case 'setMeta': {
      const patch = action.patch;
      const changes: MetaPatch = {};
      if (patch.name !== undefined && patch.name !== doc.name) changes.name = patch.name;
      if (patch.description !== undefined && patch.description !== doc.description) changes.description = patch.description;
      if (patch.category !== undefined && patch.category !== doc.category) changes.category = patch.category;
      if (patch.status !== undefined && patch.status !== doc.status) changes.status = patch.status;
      if (patch.tags !== undefined && !sameList(patch.tags, doc.tags)) changes.tags = patch.tags;
      if (Object.keys(changes).length === 0) return state;
      return commit(state, { ...doc, ...changes });
    }

    case 'setSize': {
      if (!Number.isFinite(action.size)) return state;
      const size = Math.round(Math.min(128, Math.max(8, action.size)));
      if (size === doc.size) return state;
      return commit(state, action.scale ? scaleDocument(doc, size) : { ...doc, size });
    }

    case 'addShapes': {
      // Quá giới hạn lớp của thư viện thì icon sẽ bị từ chối khi nạp lại, nên chỉ nhận phần còn chỗ.
      const added = action.shapes.slice(0, Math.max(0, LIMITS.maxShapes - doc.shapes.length));
      if (added.length === 0) return state;
      const next = withShapes(doc, [...doc.shapes, ...added]);
      return commit(state, next, action.select === false ? state.selection : added.map((shape) => shape.id));
    }

    case 'replaceShapes': {
      const byId = new Map(action.shapes.map((shape) => [shape.id, shape]));
      let changed = false;
      const shapes = doc.shapes.map((shape) => {
        const replacement = byId.get(shape.id);
        if (!replacement || replacement === shape) return shape;
        changed = true;
        return replacement;
      });
      return changed ? commit(state, withShapes(doc, shapes)) : state;
    }

    case 'updateShapes': {
      const targets = new Set(action.ids);
      let changed = false;
      const shapes = doc.shapes.map((shape) => {
        if (!targets.has(shape.id)) return shape;
        const next = { ...shape, ...action.patch };
        const differs = (Object.keys(action.patch) as Array<keyof ShapeStylePatch>).some((key) => next[key] !== shape[key]);
        if (!differs) return shape;
        changed = true;
        return next;
      });
      return changed ? commit(state, withShapes(doc, shapes)) : state;
    }

    case 'transform': {
      const targets = new Set(editable(doc, action.ids).map((shape) => shape.id));
      if (targets.size === 0) return state;
      return commit(state, withShapes(doc, doc.shapes.map((shape) => (targets.has(shape.id) ? transformShape(shape, action.matrix) : shape))));
    }

    case 'remove': {
      const targets = new Set(editable(doc, action.ids).map((shape) => shape.id));
      if (targets.size === 0) return state;
      return commit(state, withShapes(doc, doc.shapes.filter((shape) => !targets.has(shape.id))));
    }

    case 'duplicate': {
      const offset = action.offset ?? 1;
      const sources = doc.shapes
        .filter((shape) => action.ids.includes(shape.id))
        .slice(0, Math.max(0, LIMITS.maxShapes - doc.shapes.length));
      if (sources.length === 0) return state;
      const copies = sources.map((shape) => ({
        ...transformShape(shape, translation(offset, offset)),
        id: newId('shape'),
        name: `${shape.name} bản sao`,
        locked: false,
      }));
      return commit(state, withShapes(doc, [...doc.shapes, ...copies]), copies.map((shape) => shape.id));
    }

    case 'reorder': {
      const ids = new Set(exists(doc, action.ids));
      const shapes = reorder(doc.shapes, ids, action.mode);
      return shapes.every((shape, index) => shape === doc.shapes[index]) ? state : commit(state, withShapes(doc, shapes));
    }

    case 'moveShape': {
      const from = doc.shapes.findIndex((shape) => shape.id === action.id);
      if (from < 0) return state;
      const to = Math.min(doc.shapes.length - 1, Math.max(0, action.toIndex));
      if (from === to) return state;
      const shapes = [...doc.shapes];
      const [moved] = shapes.splice(from, 1);
      shapes.splice(to, 0, moved);
      return commit(state, withShapes(doc, shapes));
    }

    case 'align': {
      const targets = editable(doc, action.ids);
      if (targets.length === 0) return state;
      const items = targets.map((shape) => ({ id: shape.id, bounds: visualBounds(shape) }));
      const reference: Rect | null =
        action.to === 'canvas' ? { x: 0, y: 0, width: doc.size, height: doc.size } : unionRects(items.map((item) => item.bounds));
      if (!reference || (action.to === 'selection' && targets.length < 2)) return state;
      const offsets = movingOffsets(alignOffsets(items, action.mode, reference));
      if (offsets.size === 0) return state;
      return commit(
        state,
        withShapes(
          doc,
          doc.shapes.map((shape) => {
            const offset = offsets.get(shape.id);
            return offset ? transformShape(shape, translation(offset.x, offset.y)) : shape;
          }),
        ),
      );
    }

    case 'distribute': {
      const targets = editable(doc, action.ids);
      const offsets = movingOffsets(
        distributeOffsets(
          targets.map((shape) => ({ id: shape.id, bounds: visualBounds(shape) })),
          action.axis,
        ),
      );
      if (offsets.size === 0) return state;
      return commit(
        state,
        withShapes(
          doc,
          doc.shapes.map((shape) => {
            const offset = offsets.get(shape.id);
            return offset ? transformShape(shape, translation(offset.x, offset.y)) : shape;
          }),
        ),
      );
    }

    case 'convertToPath': {
      const targets = new Set(editable(doc, action.ids).filter((shape) => shape.geometry.type !== 'path').map((shape) => shape.id));
      if (targets.size === 0) return state;
      return commit(
        state,
        withShapes(
          doc,
          doc.shapes.map((shape) => (targets.has(shape.id) ? { ...shape, geometry: geometryToPath(shape.geometry) as Geometry } : shape)),
        ),
      );
    }

    case 'combine': {
      const result = combinePaths(doc, action.ids);
      return result ? commit(state, result.doc, result.selection) : state;
    }

    case 'separate': {
      const result = separatePath(doc, action.ids);
      return result ? commit(state, result.doc, result.selection) : state;
    }

    default:
      return state;
  }
}

/** Tâm của khung bao vùng chọn; dùng làm gốc xoay/lật. */
export function selectionCenter(doc: IconDocument, ids: readonly string[]) {
  const bounds = selectionBounds(doc, ids);
  return bounds ? rectCenter(bounds) : { x: doc.size / 2, y: doc.size / 2 };
}
