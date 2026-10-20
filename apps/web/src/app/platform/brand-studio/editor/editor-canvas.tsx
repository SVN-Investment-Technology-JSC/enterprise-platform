'use client';

import {
  createShape,
  findShape,
  geometryBounds,
  geometryToPath,
  insertNode,
  nearestOnPath,
  normalizeRect,
  rotation,
  screenToDoc,
  setHandle,
  toggleNodeSmooth,
  toggleSubpathClosed,
  transformShape,
  translateShape,
  translation,
  type BrandPalette,
  type BrandRules,
  type EditorAction,
  type EditorState,
  type Geometry,
  type Guide,
  type IconShape,
  type PathGeometry,
  type Point,
  type Rect,
  type Viewport,
} from '@enterprise-platform/shared-brand-icon';
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent } from 'react';
import { EditorContextBar, type NodeContext } from './editor-context-bar';
import { GridLayer, OutsideMask, ShapesLayer } from './editor-canvas-layers';
import { EditorOverlay, type NodeOverlayTarget, type OverlayHint } from './editor-overlay';
import {
  HANDLE_CURSORS,
  clampPolygonSides,
  constrainAngle,
  deleteNodes,
  describeGeometry,
  editableSelection,
  ellipseFromDrag,
  formatUnits,
  geometryUnion,
  handlePoint,
  hitOpenEnd,
  hitSelectionHandle,
  hitTestNodes,
  hitTestTopShape,
  isDegenerateGeometry,
  lineFromDrag,
  mapRectByMatrix,
  mergeSelection,
  moveNodes,
  newShapeStyle,
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
  selectionLayout,
  shapesInMarquee,
  snapMove,
  snapPoint,
  snapTargetsFromRects,
  type EditorCommand,
  type HandleId,
  type MoveSnapOptions,
  type NodeRef,
  type OpenEnd,
  type PenDraft,
  type SnapTargets,
} from './interactions';
import type { DisplayMode, EditorTool } from './tool';
import { ZOOM_IN_FACTOR, ZOOM_OUT_FACTOR, type CanvasViewport } from './use-canvas-viewport';
import { isTypingTarget, useEditorKeyboard } from './use-editor-keyboard';

export interface EditorCanvasProps {
  readonly state: EditorState;
  readonly dispatch: Dispatch<EditorAction>;
  readonly palette: BrandPalette;
  readonly rules: BrandRules;
  readonly tool: EditorTool;
  readonly onToolChange: (tool: EditorTool) => void;
  readonly displayMode: DisplayMode;
  readonly showGrid: boolean;
  readonly snapGrid: boolean;
  readonly snapObjects: boolean;
  readonly polygonSides: number;
  readonly onPolygonSidesChange: (sides: number) => void;
  readonly viewport: CanvasViewport;
  readonly onSave: () => void;
  /** Tắt phím tắt khi có hộp thoại mở. */
  readonly keyboardEnabled?: boolean;
}

/* ---------- Hằng số tương tác (pixel màn hình) ---------- */

const DRAG_THRESHOLD_PX = 3;
const HIT_PX = 5;
const NODE_HIT_PX = 7;
const CLOSE_PX = 9;
const SNAP_PX = 6;
const DOUBLE_CLICK_MS = 350;
const DOUBLE_CLICK_PX = 5;
const DRAFT_ID = 'draft-shape';

const ROTATE_CURSOR = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0f172a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>',
)}") 12 12, grab`;

const EMPTY_TARGETS: SnapTargets = { xs: [], ys: [] };
const EMPTY_KEYS: ReadonlySet<string> = new Set();

type DrawTool = 'rect' | 'ellipse' | 'line' | 'polygon';
const isDrawTool = (tool: EditorTool): tool is DrawTool => tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'polygon';

interface NodeOrigin {
  readonly shape: IconShape;
  readonly path: PathGeometry;
  readonly refs: readonly NodeRef[];
}

interface DrawModifiers {
  readonly shift: boolean;
  readonly alt: boolean;
  readonly ctrl: boolean;
}

/** Phiên thao tác chuột đang diễn ra (từ bấm xuống tới nhả). Giữ trong ref để không dựng lại giao diện mỗi lần di chuột. */
type Session =
  | { kind: 'pan'; startLocal: Point; origin: Viewport }
  | {
      kind: 'move';
      startLocal: Point;
      startDoc: Point;
      shapes: readonly IconShape[];
      bounds: Rect;
      others: readonly Rect[];
      started: boolean;
      narrowTo: string | null;
    }
  | { kind: 'resize'; startLocal: Point; shapes: readonly IconShape[]; bounds: Rect; handle: HandleId; offset: Point; started: boolean }
  | { kind: 'rotate'; startLocal: Point; startDoc: Point; shapes: readonly IconShape[]; center: Point; started: boolean }
  | { kind: 'marquee'; startLocal: Point; startDoc: Point; base: readonly string[]; moved: boolean }
  | {
      kind: 'draw';
      tool: DrawTool;
      start: Point;
      targets: SnapTargets;
      geometry: Geometry | null;
      last: { point: Point; local: Point; mods: DrawModifiers } | null;
    }
  | { kind: 'pen-drag'; startLocal: Point; targets: SnapTargets; started: boolean }
  | {
      kind: 'node-move';
      startLocal: Point;
      startDoc: Point;
      origins: readonly NodeOrigin[];
      grabOrigin: Point;
      targets: SnapTargets;
      started: boolean;
    }
  | {
      kind: 'handle-drag';
      startLocal: Point;
      shape: IconShape;
      path: PathGeometry;
      sub: number;
      index: number;
      handle: 'hin' | 'hout';
      anchor: Point;
      targets: SnapTargets;
      started: boolean;
    }
  | { kind: 'node-marquee'; startLocal: Point; startDoc: Point; base: ReadonlySet<string>; moved: boolean };

interface OverlayState {
  readonly hoverId: string | null;
  readonly hoverCursor: string | null;
  readonly marquee: Rect | null;
  readonly guides: readonly Guide[];
  readonly draft: IconShape | null;
  readonly hint: OverlayHint | null;
  readonly penHover: Point | null;
  readonly penClosing: boolean;
  readonly endHint: Point | null;
}

const EMPTY_OVERLAY: OverlayState = {
  hoverId: null,
  hoverCursor: null,
  marquee: null,
  guides: [],
  draft: null,
  hint: null,
  penHover: null,
  penClosing: false,
  endHint: null,
};

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function toolCursor(tool: EditorTool): string {
  if (tool === 'hand') return 'grab';
  if (tool === 'select' || tool === 'node') return 'default';
  return 'crosshair';
}

function drawGeometry(tool: DrawTool, start: Point, end: Point, mods: DrawModifiers, sides: number): Geometry {
  switch (tool) {
    case 'rect':
      return rectFromDrag(start, end, { equal: mods.shift, fromCenter: mods.alt });
    case 'ellipse':
      return ellipseFromDrag(start, end, { equal: mods.shift, fromCenter: mods.alt });
    case 'line':
      return lineFromDrag(start, end, mods.shift);
    default:
      return regularPolygon(start, end, sides, mods.shift);
  }
}

function drawHint(tool: DrawTool, start: Point, end: Point, geometry: Geometry, sides: number): string {
  if (tool === 'line') {
    const angle = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
    return `${formatUnits(distance(start, end))} / ${Math.round(angle)}°`;
  }
  if (tool === 'polygon') return `R ${formatUnits(distance(start, end))} / ${sides} cạnh`;
  return describeGeometry(geometry);
}

/**
 * Canvas thiết kế: vẽ mặt giấy, các lớp hình và lớp phủ (tay cầm, điểm neo, đường dóng), xử lý chuột, bàn phím, phóng to/kéo nền.
 *
 * Mọi thao tác kéo tính từ ảnh chụp lúc bấm (không cộng dồn sai số), gửi `replaceShapes` mỗi khung hình
 * và nằm gọn trong một cặp `gestureStart`/`gestureEnd` nên một lần kéo là một bước hoàn tác.
 * Bản nháp (hình đang vẽ, đường bút, khung quét) chỉ nằm ở state cục bộ cho tới khi nhả chuột.
 */
export function EditorCanvas({
  state,
  dispatch,
  palette,
  rules,
  tool,
  onToolChange,
  displayMode,
  showGrid,
  snapGrid,
  snapObjects,
  polygonSides,
  onPolygonSidesChange,
  viewport,
  onSave,
  keyboardEnabled = true,
}: EditorCanvasProps) {
  const { doc, selection } = state;
  const { view, width, height } = viewport;

  const session = useRef<Session | null>(null);
  const lastDown = useRef<{ time: number; x: number; y: number } | null>(null);
  const spaceDown = useRef(false);
  const [spacePan, setSpacePan] = useState(false);
  const [panning, setPanning] = useState(false);
  const [overlay, setOverlay] = useState<OverlayState>(EMPTY_OVERLAY);

  const [pen, setPenState] = useState<PenDraft | null>(null);
  const penRef = useRef<PenDraft | null>(null);
  const setPen = (next: PenDraft | null) => {
    penRef.current = next;
    setPenState(next);
  };

  const [nodeSel, setNodeSelState] = useState<ReadonlySet<string>>(EMPTY_KEYS);
  const nodeSelRef = useRef<ReadonlySet<string>>(EMPTY_KEYS);
  const setNodeSel = (next: ReadonlySet<string>) => {
    nodeSelRef.current = next;
    setNodeSelState(next);
  };

  const patchOverlay = (patch: Partial<OverlayState>) =>
    setOverlay((previous) => {
      const keys = Object.keys(patch) as Array<keyof OverlayState>;
      const unchanged = keys.every((key) => {
        const before = previous[key];
        const after = patch[key];
        return before === after || (Array.isArray(before) && Array.isArray(after) && before.length === 0 && after.length === 0);
      });
      return unchanged ? previous : { ...previous, ...patch };
    });

  /* ---------- Dữ liệu dẫn xuất ---------- */

  const snapStep = snapGrid ? rules.snapStep : 0;
  const threshold = Math.min(0.5, Math.max(0.05, SNAP_PX / view.zoom));
  const style = useMemo(() => newShapeStyle(displayMode, palette, rules), [displayMode, palette, rules]);

  const selectedShapes = useMemo(
    () =>
      selection.flatMap((id) => {
        const shape = findShape(doc, id);
        return shape && !shape.hidden ? [shape] : [];
      }),
    [doc, selection],
  );
  const editable = useMemo(() => editableSelection(doc, selection), [doc, selection]);
  const frameBounds = useMemo(() => geometryUnion(editable), [editable]);
  const layout = tool === 'select' && frameBounds ? selectionLayout(frameBounds, view, { resizable: true }) : null;

  // Chỉ bút và các công cụ vẽ cần đường dóng của mọi hình; công cụ khác không tính để khỏi tốn công mỗi khung hình khi kéo.
  const needsAllTargets = tool === 'pen' || isDrawTool(tool);
  const allTargets = useMemo(
    () =>
      needsAllTargets
        ? snapTargetsFromRects(
            doc.shapes.filter((shape) => !shape.hidden).map((shape) => geometryBounds(shape.geometry)),
            doc.size,
          )
        : EMPTY_TARGETS,
    [needsAllTargets, doc.shapes, doc.size],
  );

  const nodeTargets = useMemo(
    () => (tool === 'node' ? editable.map((shape) => ({ shape, path: geometryToPath(shape.geometry) })) : []),
    [tool, editable],
  );
  const nodeOverlayTargets = useMemo<NodeOverlayTarget[]>(
    () => nodeTargets.map((target) => ({ shapeId: target.shape.id, path: target.path })),
    [nodeTargets],
  );

  const targetsExcluding = (ids: ReadonlySet<string>): SnapTargets =>
    snapTargetsFromRects(
      doc.shapes.filter((shape) => !shape.hidden && !ids.has(shape.id)).map((shape) => geometryBounds(shape.geometry)),
      doc.size,
    );

  /* ---------- Toạ độ ---------- */

  const rootRef = useRef<HTMLDivElement | null>(null);
  const { containerRef } = viewport;
  // Phải ổn định giữa các lần dựng: ref đổi định danh sẽ bị gỡ và gắn lại mỗi lần.
  const setRoot = useCallback(
    (element: HTMLDivElement | null) => {
      rootRef.current = element;
      containerRef(element);
    },
    [containerRef],
  );
  const localPoint = (event: { clientX: number; clientY: number }): Point => {
    const rect = rootRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };

  const moveOptions = (event: { shiftKey: boolean; altKey: boolean }): MoveSnapOptions => ({
    step: snapStep,
    threshold,
    objects: snapObjects,
    axisLock: event.shiftKey,
    disabled: event.altKey,
  });

  /* ---------- Tiện ích chọn điểm neo ---------- */

  const refsByShape = (keys: ReadonlySet<string>): Map<string, NodeRef[]> => {
    const groups = new Map<string, NodeRef[]>();
    for (const key of keys) {
      const parsed = parseNodeKey(key);
      if (!parsed) continue;
      groups.set(parsed.shapeId, [...(groups.get(parsed.shapeId) ?? []), { sub: parsed.sub, index: parsed.index }]);
    }
    return groups;
  };

  const commitPaths = (updates: ReadonlyArray<{ shape: IconShape; path: PathGeometry }>) => {
    if (updates.length === 0) return;
    dispatch({ type: 'replaceShapes', shapes: updates.map(({ shape, path }) => ({ ...shape, geometry: path })) });
  };

  /* ---------- Bút ---------- */

  const finishPen = (closed: boolean) => {
    const draft = penRef.current;
    setPen(null);
    patchOverlay({ penHover: null, penClosing: false, guides: [] });
    if (!draft) return;
    const subpath = penFinish(draft, closed);
    if (!subpath) return;
    if (draft.target) {
      const shape = findShape(doc, draft.target.shapeId);
      if (shape) {
        dispatch({ type: 'replaceShapes', shapes: [{ ...shape, geometry: penCommitGeometry(shape.geometry, subpath, draft.target.sub) }] });
        dispatch({ type: 'select', ids: [shape.id] });
        return;
      }
    }
    dispatch({ type: 'addShapes', shapes: [createShape({ type: 'path', subpaths: [subpath] }, style)], select: true });
  };

  /** Đầu mút đường mở của hình đang chọn nằm dưới con trỏ (để nối tiếp). */
  const findContinuation = (point: Point): { shape: IconShape; end: OpenEnd } | null => {
    const tolerance = CLOSE_PX / view.zoom;
    for (const shape of editable) {
      if (shape.geometry.type !== 'path') continue;
      const end = hitOpenEnd(shape.geometry, point, tolerance);
      if (end) return { shape, end };
    }
    return null;
  };

  /* ---------- Vẽ hình bằng kéo ---------- */

  const updateDraw = (s: Extract<Session, { kind: 'draw' }>, point: Point, local: Point, mods: DrawModifiers) => {
    const snapped = snapPoint(point, s.targets, { step: snapStep, threshold, objects: snapObjects, disabled: mods.ctrl });
    const geometry = drawGeometry(s.tool, s.start, snapped.point, mods, polygonSides);
    s.geometry = geometry;
    s.last = { point, local, mods };
    patchOverlay({
      draft: createShape(geometry, { id: DRAFT_ID, ...style }),
      guides: snapped.guides,
      hint: { x: local.x + 14, y: local.y + 18, text: drawHint(s.tool, s.start, snapped.point, geometry, polygonSides) },
    });
  };

  const refreshDraw = () => {
    const s = session.current;
    if (s?.kind === 'draw' && s.last) updateDraw(s, s.last.point, s.last.local, s.last.mods);
  };

  // Giữ bản mới nhất của các hàm cần gọi từ effect mà không phải khai báo chúng làm phụ thuộc.
  const api = useRef({ refreshDraw, finishPen });
  useEffect(() => {
    api.current = { refreshDraw, finishPen };
  });

  useEffect(() => {
    api.current.refreshDraw();
  }, [polygonSides]);

  const previousTool = useRef(tool);
  useEffect(() => {
    if (previousTool.current === 'pen' && tool !== 'pen' && penRef.current) api.current.finishPen(false);
    if (tool !== 'node') setNodeSel(EMPTY_KEYS);
    patchOverlay({ hoverId: null, hoverCursor: null, penHover: null, penClosing: false, endHint: null, guides: [] });
    previousTool.current = tool;
  }, [tool]);

  // Bỏ điểm neo đang chọn của những hình không còn được chọn.
  useEffect(() => {
    if (nodeSel.size === 0) return;
    const alive = new Set(selection);
    const kept = [...nodeSel].filter((key) => {
      const parsed = parseNodeKey(key);
      return parsed !== null && alive.has(parsed.shapeId);
    });
    if (kept.length !== nodeSel.size) setNodeSel(new Set(kept));
  }, [selection, nodeSel]);

  /* ---------- Thao tác với điểm neo ---------- */

  const moveSelectedNodes = (dx: number, dy: number) => {
    const groups = refsByShape(nodeSelRef.current);
    commitPaths(
      nodeTargets.flatMap((target) => {
        const refs = groups.get(target.shape.id);
        return refs ? [{ shape: target.shape, path: moveNodes(target.path, refs, dx, dy) }] : [];
      }),
    );
  };

  const deleteSelectedNodes = () => {
    const groups = refsByShape(nodeSelRef.current);
    const updates: Array<{ shape: IconShape; path: PathGeometry }> = [];
    const removed: string[] = [];
    for (const target of nodeTargets) {
      const refs = groups.get(target.shape.id);
      if (!refs) continue;
      const path = deleteNodes(target.path, refs);
      if (path.subpaths.length === 0) removed.push(target.shape.id);
      else updates.push({ shape: target.shape, path });
    }
    if (updates.length === 0 && removed.length === 0) return;
    dispatch({ type: 'gestureStart' });
    commitPaths(updates);
    if (removed.length > 0) dispatch({ type: 'remove', ids: removed });
    dispatch({ type: 'gestureEnd' });
    setNodeSel(EMPTY_KEYS);
  };

  const toggleSmoothSelected = () => {
    const groups = refsByShape(nodeSelRef.current);
    commitPaths(
      nodeTargets.flatMap((target) => {
        const refs = groups.get(target.shape.id);
        if (!refs) return [];
        return [{ shape: target.shape, path: refs.reduce((path, ref) => toggleNodeSmooth(path, ref.sub, ref.index), target.path) }];
      }),
    );
  };

  /** Đóng/mở các đường con của điểm neo đang chọn; chưa chọn điểm nào thì áp cho mọi đường con của hình đang sửa. */
  const toggleClosed = () => {
    const groups = refsByShape(nodeSelRef.current);
    const hasSelection = groups.size > 0;
    commitPaths(
      nodeTargets.flatMap((target) => {
        const refs = groups.get(target.shape.id);
        if (hasSelection && !refs) return [];
        const subs = refs ? [...new Set(refs.map((ref) => ref.sub))] : target.path.subpaths.map((_, index) => index);
        const path = subs.reduce((current, sub) => toggleSubpathClosed(current, sub), target.path);
        return path === target.path ? [] : [{ shape: target.shape, path }];
      }),
    );
  };

  const nodeContext: NodeContext | null = (() => {
    if (tool !== 'node' || nodeTargets.length === 0) return null;
    const groups = refsByShape(nodeSel);
    let closed: boolean | null = null;
    for (const target of nodeTargets) {
      const refs = groups.get(target.shape.id);
      if (groups.size > 0 && !refs) continue;
      const subs = refs ? [...new Set(refs.map((ref) => ref.sub))] : target.path.subpaths.map((_, index) => index);
      const sub = subs.map((index) => target.path.subpaths[index]).find((candidate) => candidate && candidate.nodes.length >= 3);
      if (sub) {
        closed = sub.closed;
        break;
      }
    }
    return {
      selectedCount: nodeSel.size,
      closed,
      onToggleClosed: toggleClosed,
      onToggleSmooth: toggleSmoothSelected,
      onDelete: deleteSelectedNodes,
    };
  })();

  /* ---------- Phím tắt ---------- */

  const cancelSession = () => {
    const current = session.current;
    session.current = null;
    setPanning(false);
    if (!current) return;
    const dragging =
      (current.kind === 'move' || current.kind === 'resize' || current.kind === 'rotate' || current.kind === 'node-move' || current.kind === 'handle-drag') &&
      current.started;
    if (dragging) dispatch({ type: 'undo' });
    patchOverlay({ guides: [], hint: null, marquee: null, draft: null });
  };

  const runCommand = (command: EditorCommand) => {
    switch (command.type) {
      case 'tool':
        if (session.current) return;
        onToolChange(command.tool);
        return;
      case 'undo':
        if (!session.current) dispatch({ type: 'undo' });
        return;
      case 'redo':
        if (!session.current) dispatch({ type: 'redo' });
        return;
      case 'duplicate':
        if (selection.length > 0 && !session.current) dispatch({ type: 'duplicate', ids: selection });
        return;
      case 'delete':
        if (session.current) return;
        if (tool === 'node' && nodeSelRef.current.size > 0) deleteSelectedNodes();
        else if (selection.length > 0) dispatch({ type: 'remove', ids: selection });
        return;
      case 'selectAll':
        dispatch({ type: 'selectAll' });
        return;
      case 'escape':
        if (session.current) cancelSession();
        else if (penRef.current) {
          setPen(null);
          patchOverlay({ penHover: null, penClosing: false });
        } else if (tool === 'node' && nodeSelRef.current.size > 0) setNodeSel(EMPTY_KEYS);
        else dispatch({ type: 'select', ids: [] });
        return;
      case 'enter':
        if (penRef.current) finishPen(false);
        return;
      case 'save':
        onSave();
        return;
      case 'reorder':
        if (selection.length > 0 && !session.current) dispatch({ type: 'reorder', ids: selection, mode: command.mode });
        return;
      case 'nudge': {
        if (session.current) return;
        const amount = nudgeAmount(rules.snapStep, command.shift, command.alt);
        if (tool === 'node' && nodeSelRef.current.size > 0) {
          moveSelectedNodes(command.dx * amount, command.dy * amount);
        } else if (editable.length > 0) {
          dispatch({ type: 'transform', ids: editable.map((shape) => shape.id), matrix: translation(command.dx * amount, command.dy * amount) });
        }
        return;
      }
      case 'zoom':
        if (command.direction === 'fit') viewport.fit();
        else viewport.zoomBy(command.direction === 'in' ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR);
        return;
      case 'polygonSides':
        onPolygonSidesChange(clampPolygonSides(polygonSides + command.delta));
        return;
      default:
        return;
    }
  };

  useEditorKeyboard({
    enabled: keyboardEnabled,
    tool,
    onCommand: runCommand,
    onSpace: (pressed) => {
      spaceDown.current = pressed;
      setSpacePan(pressed);
    },
  });

  /* ---------- Chuột: bấm xuống ---------- */

  const detectDouble = (local: Point): boolean => {
    const now = typeof performance === 'undefined' ? Date.now() : performance.now();
    const previous = lastDown.current;
    const isDouble = previous !== null && now - previous.time < DOUBLE_CLICK_MS && Math.hypot(local.x - previous.x, local.y - previous.y) < DOUBLE_CLICK_PX;
    lastDown.current = isDouble ? null : { time: now, x: local.x, y: local.y };
    return isDouble;
  };

  const beginMove = (ids: readonly string[], point: Point, local: Point, narrowTo: string | null) => {
    const shapes = editableSelection(doc, ids);
    const bounds = geometryUnion(shapes);
    if (!bounds) return;
    const taken = new Set(shapes.map((shape) => shape.id));
    const others = doc.shapes.filter((shape) => !shape.hidden && !taken.has(shape.id)).map((shape) => geometryBounds(shape.geometry));
    session.current = { kind: 'move', startLocal: local, startDoc: point, shapes, bounds, others, started: false, narrowTo };
  };

  const downSelect = (event: ReactPointerEvent<SVGSVGElement>, local: Point, point: Point, isDouble: boolean) => {
    if (layout && frameBounds) {
      const hit = hitSelectionHandle(layout, local);
      if (hit?.type === 'rotate') {
        session.current = { kind: 'rotate', startLocal: local, startDoc: point, shapes: editable, center: { x: frameBounds.x + frameBounds.width / 2, y: frameBounds.y + frameBounds.height / 2 }, started: false };
        return;
      }
      if (hit?.type === 'resize') {
        const grab = handlePoint(frameBounds, hit.handle);
        session.current = {
          kind: 'resize',
          startLocal: local,
          shapes: editable,
          bounds: frameBounds,
          handle: hit.handle,
          offset: { x: grab.x - point.x, y: grab.y - point.y },
          started: false,
        };
        return;
      }
    }

    const hitId = hitTestTopShape(doc, point, HIT_PX / view.zoom);
    if (hitId) {
      if (event.shiftKey) {
        dispatch({ type: 'select', ids: [hitId], additive: true });
        return;
      }
      if (isDouble) {
        dispatch({ type: 'select', ids: [hitId] });
        onToolChange('node');
        return;
      }
      const inSelection = selection.includes(hitId);
      if (!inSelection) dispatch({ type: 'select', ids: [hitId] });
      beginMove(inSelection ? selection : [hitId], point, local, inSelection && selection.length > 1 ? hitId : null);
      return;
    }

    if (!event.shiftKey) dispatch({ type: 'select', ids: [] });
    session.current = { kind: 'marquee', startLocal: local, startDoc: point, base: event.shiftKey ? selection : [], moved: false };
  };

  const downNode = (event: ReactPointerEvent<SVGSVGElement>, local: Point, point: Point, isDouble: boolean) => {
    const tolerance = NODE_HIT_PX / view.zoom;
    const selectedNow = nodeSelRef.current;

    for (const target of [...nodeTargets].reverse()) {
      const hit = hitTestNodes(target.path, point, tolerance, (sub, index) => selectedNow.has(nodeKey(target.shape.id, sub, index)));
      if (!hit) continue;
      const targets = targetsExcluding(new Set(nodeTargets.map((item) => item.shape.id)));

      if (hit.kind === 'handle') {
        const anchor = target.path.subpaths[hit.sub].nodes[hit.index];
        session.current = {
          kind: 'handle-drag',
          startLocal: local,
          shape: target.shape,
          path: target.path,
          sub: hit.sub,
          index: hit.index,
          handle: hit.handle,
          anchor: { x: anchor.x, y: anchor.y },
          targets,
          started: false,
        };
        return;
      }

      const key = nodeKey(target.shape.id, hit.sub, hit.index);
      if (isDouble) {
        setNodeSel(new Set([key]));
        commitPaths([{ shape: target.shape, path: toggleNodeSmooth(target.path, hit.sub, hit.index) }]);
        return;
      }
      let keys = selectedNow;
      if (event.shiftKey) {
        const next = new Set(selectedNow);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        setNodeSel(next);
        if (!next.has(key)) return;
        keys = next;
      } else if (!selectedNow.has(key)) {
        keys = new Set([key]);
        setNodeSel(keys);
      }

      const groups = refsByShape(keys);
      const origins: NodeOrigin[] = nodeTargets.flatMap((item) => {
        const refs = groups.get(item.shape.id);
        return refs ? [{ shape: item.shape, path: item.path, refs }] : [];
      });
      const grabbed = target.path.subpaths[hit.sub].nodes[hit.index];
      session.current = {
        kind: 'node-move',
        startLocal: local,
        startDoc: point,
        origins,
        grabOrigin: { x: grabbed.x, y: grabbed.y },
        targets,
        started: false,
      };
      return;
    }

    for (const target of nodeTargets) {
      const nearest = nearestOnPath(target.path, point);
      if (nearest && nearest.distance <= tolerance + target.shape.strokeWidth / 2) {
        if (isDouble) {
          commitPaths([{ shape: target.shape, path: insertNode(target.path, nearest.sub, nearest.segment, nearest.t) }]);
          setNodeSel(new Set([nodeKey(target.shape.id, nearest.sub, nearest.segment + 1)]));
        }
        return;
      }
    }

    const hitId = hitTestTopShape(doc, point, HIT_PX / view.zoom);
    if (hitId) {
      dispatch({ type: 'select', ids: [hitId], additive: event.shiftKey });
      setNodeSel(EMPTY_KEYS);
      return;
    }
    session.current = { kind: 'node-marquee', startLocal: local, startDoc: point, base: event.shiftKey ? selectedNow : EMPTY_KEYS, moved: false };
  };

  const downPen = (event: ReactPointerEvent<SVGSVGElement>, local: Point, point: Point, isDouble: boolean) => {
    const snapped = snapPoint(point, allTargets, { step: snapStep, threshold, objects: snapObjects, disabled: event.altKey });
    const draft = penRef.current;
    const tolerance = CLOSE_PX / view.zoom;

    if (!draft) {
      const continuation = findContinuation(point);
      if (continuation) {
        setPen(penContinue(continuation.shape.id, geometryToPath(continuation.shape.geometry), continuation.end));
        patchOverlay({ endHint: null });
        return;
      }
      setPen(penStart(snapped.point));
      session.current = { kind: 'pen-drag', startLocal: local, targets: allTargets, started: false };
      return;
    }
    if (isDouble) {
      finishPen(false);
      return;
    }
    if (penNearFirst(draft, point, tolerance)) {
      finishPen(true);
      return;
    }
    setPen(penAddNode(draft, snapped.point));
    session.current = { kind: 'pen-drag', startLocal: local, targets: allTargets, started: false };
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button === 2) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && isTypingTarget(active)) active.blur();

    const local = localPoint(event);
    const point = screenToDoc(view, local);
    const isDouble = detectDouble(local);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Con trỏ không còn hoạt động hoặc môi trường không hỗ trợ: vẫn xử lý bình thường nhưng không giữ được chuột khi ra ngoài khung.
    }

    if (event.button === 1 || tool === 'hand' || spaceDown.current) {
      event.preventDefault();
      session.current = { kind: 'pan', startLocal: local, origin: view };
      setPanning(true);
      return;
    }
    if (event.button !== 0) return;

    if (isDrawTool(tool)) {
      const snapped = snapPoint(point, allTargets, { step: snapStep, threshold, objects: snapObjects, disabled: event.ctrlKey || event.metaKey });
      session.current = { kind: 'draw', tool, start: snapped.point, targets: allTargets, geometry: null, last: null };
      return;
    }
    if (tool === 'pen') downPen(event, local, point, isDouble);
    else if (tool === 'node') downNode(event, local, point, isDouble);
    else downSelect(event, local, point, isDouble);
  };

  /* ---------- Chuột: di chuyển ---------- */

  const beginGesture = (s: { started: boolean }) => {
    if (s.started) return;
    s.started = true;
    dispatch({ type: 'gestureStart' });
  };

  const passedThreshold = (s: { startLocal: Point; started?: boolean; moved?: boolean }, local: Point) =>
    Boolean(s.started) || Boolean(s.moved) || distance(local, s.startLocal) >= DRAG_THRESHOLD_PX;

  const handleHover = (event: ReactPointerEvent<SVGSVGElement>, local: Point, point: Point) => {
    if (tool === 'select') {
      const hit = layout ? hitSelectionHandle(layout, local) : null;
      patchOverlay({
        hoverCursor: hit ? (hit.type === 'rotate' ? ROTATE_CURSOR : HANDLE_CURSORS[hit.handle]) : null,
        hoverId: hit ? null : hitTestTopShape(doc, point, HIT_PX / view.zoom),
      });
      return;
    }
    if (tool === 'pen') {
      const draft = penRef.current;
      const snapped = snapPoint(point, allTargets, { step: snapStep, threshold, objects: snapObjects, disabled: event.altKey });
      const continuation = draft ? null : findContinuation(point);
      const endNode = continuation ? geometryToPath(continuation.shape.geometry).subpaths[continuation.end.sub].nodes[continuation.end.index] : null;
      patchOverlay({
        penHover: snapped.point,
        guides: snapped.guides,
        penClosing: draft ? penNearFirst(draft, point, CLOSE_PX / view.zoom) : false,
        endHint: endNode ? { x: endNode.x, y: endNode.y } : null,
      });
    }
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const local = localPoint(event);
    const point = screenToDoc(view, local);
    const s = session.current;
    if (!s) {
      handleHover(event, local, point);
      return;
    }

    switch (s.kind) {
      case 'pan':
        viewport.setView({ ...s.origin, panX: s.origin.panX + (local.x - s.startLocal.x), panY: s.origin.panY + (local.y - s.startLocal.y) });
        return;

      case 'move': {
        if (!passedThreshold(s, local)) return;
        beginGesture(s);
        const snap = snapMove(s.bounds, point.x - s.startDoc.x, point.y - s.startDoc.y, s.others, doc.size, moveOptions(event));
        dispatch({ type: 'replaceShapes', shapes: s.shapes.map((shape) => translateShape(shape, snap.dx, snap.dy)) });
        patchOverlay({ guides: snap.guides });
        return;
      }

      case 'resize': {
        if (!passedThreshold(s, local)) return;
        beginGesture(s);
        const target = snapPoint({ x: point.x + s.offset.x, y: point.y + s.offset.y }, EMPTY_TARGETS, {
          step: snapStep,
          threshold: 0,
          objects: false,
          disabled: event.ctrlKey || event.metaKey,
        }).point;
        const matrix = resizeMatrix(s.bounds, s.handle, target, { keepRatio: event.shiftKey, fromCenter: event.altKey });
        dispatch({ type: 'replaceShapes', shapes: s.shapes.map((shape) => transformShape(shape, matrix)) });
        const rect = mapRectByMatrix(s.bounds, matrix);
        patchOverlay({ hint: { x: local.x + 14, y: local.y + 18, text: `${formatUnits(rect.width)} × ${formatUnits(rect.height)}` } });
        return;
      }

      case 'rotate': {
        if (!passedThreshold(s, local)) return;
        beginGesture(s);
        const degrees = rotationDelta(s.center, s.startDoc, point, event.shiftKey);
        const matrix = rotation(degrees, s.center.x, s.center.y);
        dispatch({ type: 'replaceShapes', shapes: s.shapes.map((shape) => transformShape(shape, matrix)) });
        patchOverlay({ hint: { x: local.x + 14, y: local.y + 18, text: `${formatUnits(degrees)}°` } });
        return;
      }

      case 'marquee': {
        if (!passedThreshold(s, local)) return;
        s.moved = true;
        const rect = normalizeRect(s.startDoc, point);
        patchOverlay({ marquee: rect });
        dispatch({ type: 'select', ids: mergeSelection(s.base, shapesInMarquee(doc, rect)) });
        return;
      }

      case 'draw':
        updateDraw(s, point, local, { shift: event.shiftKey, alt: event.altKey, ctrl: event.ctrlKey || event.metaKey });
        return;

      case 'pen-drag': {
        if (!passedThreshold(s, local)) return;
        s.started = true;
        const draft = penRef.current;
        if (!draft) return;
        const snapped = snapPoint(point, s.targets, { step: snapStep, threshold, objects: snapObjects, disabled: event.altKey });
        setPen(penDragHandle(draft, snapped.point));
        return;
      }

      case 'node-move': {
        if (!passedThreshold(s, local)) return;
        beginGesture(s);
        let dx = point.x - s.startDoc.x;
        let dy = point.y - s.startDoc.y;
        if (event.shiftKey) {
          if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        const snapped = snapPoint({ x: s.grabOrigin.x + dx, y: s.grabOrigin.y + dy }, s.targets, {
          step: snapStep,
          threshold,
          objects: snapObjects,
          disabled: event.altKey,
        });
        const moveX = snapped.point.x - s.grabOrigin.x;
        const moveY = snapped.point.y - s.grabOrigin.y;
        commitPaths(s.origins.map((origin) => ({ shape: origin.shape, path: moveNodes(origin.path, origin.refs, moveX, moveY) })));
        patchOverlay({ guides: snapped.guides });
        return;
      }

      case 'handle-drag': {
        if (!passedThreshold(s, local)) return;
        beginGesture(s);
        let target = snapPoint(point, s.targets, { step: snapStep, threshold, objects: snapObjects, disabled: event.altKey }).point;
        if (event.shiftKey) target = constrainAngle(s.anchor, target, 45);
        const path = setHandle(s.path, s.sub, s.index, s.handle, target, event.altKey ? 'none' : 'collinear');
        commitPaths([{ shape: s.shape, path }]);
        return;
      }

      case 'node-marquee': {
        if (!passedThreshold(s, local)) return;
        s.moved = true;
        const rect = normalizeRect(s.startDoc, point);
        patchOverlay({ marquee: rect });
        const picked = new Set(s.base);
        for (const target of nodeTargets) {
          for (const ref of nodesInRect(target.path, rect)) picked.add(nodeKey(target.shape.id, ref.sub, ref.index));
        }
        setNodeSel(picked);
        return;
      }

      default:
        return;
    }
  };

  /* ---------- Chuột: nhả ---------- */

  const endSession = () => {
    const s = session.current;
    session.current = null;
    setPanning(false);
    if (!s) return;

    switch (s.kind) {
      case 'move':
        if (s.started) dispatch({ type: 'gestureEnd' });
        else if (s.narrowTo) dispatch({ type: 'select', ids: [s.narrowTo] });
        patchOverlay({ guides: [] });
        return;
      case 'resize':
      case 'rotate':
        if (s.started) dispatch({ type: 'gestureEnd' });
        patchOverlay({ hint: null });
        return;
      case 'node-move':
      case 'handle-drag':
        if (s.started) dispatch({ type: 'gestureEnd' });
        patchOverlay({ guides: [] });
        return;
      case 'marquee':
        patchOverlay({ marquee: null });
        return;
      case 'node-marquee':
        patchOverlay({ marquee: null });
        if (!s.moved) {
          if (nodeSelRef.current.size > 0) setNodeSel(EMPTY_KEYS);
          else dispatch({ type: 'select', ids: [] });
        }
        return;
      case 'draw': {
        patchOverlay({ draft: null, guides: [], hint: null });
        if (s.geometry && !isDegenerateGeometry(s.geometry)) {
          dispatch({ type: 'addShapes', shapes: [createShape(s.geometry, style)], select: true });
          onToolChange('select');
        }
        return;
      }
      default:
        return;
    }
  };

  const onPointerLeave = () => {
    if (!session.current) patchOverlay({ hoverId: null, penHover: null, penClosing: false, endHint: null, guides: [] });
  };

  /* ---------- Dựng giao diện ---------- */

  const draftDoc = useMemo(() => (overlay.draft ? { ...doc, shapes: [overlay.draft] } : null), [doc, overlay.draft]);
  const penDoc = useMemo(() => {
    if (!pen) return null;
    const shape = createShape(penPreviewGeometry(pen, overlay.penHover, overlay.penClosing), { id: DRAFT_ID, ...style });
    return { ...doc, shapes: [shape] };
  }, [pen, overlay.penHover, overlay.penClosing, doc, style]);

  const hoverShape = overlay.hoverId && !selection.includes(overlay.hoverId) ? (findShape(doc, overlay.hoverId) ?? null) : null;
  const showOutlines = tool === 'select' || tool === 'node' || tool === 'hand';
  const cursor = panning ? 'grabbing' : tool === 'hand' || spacePan ? 'grab' : (overlay.hoverCursor ?? toolCursor(tool));

  return (
    <div ref={setRoot} className="relative h-full min-h-0 w-full overflow-hidden bg-slate-100" style={{ cursor, touchAction: 'none' }}>
      <svg
        role="img"
        aria-label="Bản vẽ icon"
        className="absolute inset-0 h-full w-full select-none"
        onContextMenu={(event) => event.preventDefault()}
        onLostPointerCapture={endSession}
        onPointerCancel={endSession}
        onPointerDown={onPointerDown}
        onPointerLeave={onPointerLeave}
        onPointerMove={onPointerMove}
        onPointerUp={endSession}
      >
        <g transform={`translate(${view.panX} ${view.panY}) scale(${view.zoom})`}>
          <GridLayer fine={view.zoom >= 10} safePadding={rules.safePadding} showGrid={showGrid} size={doc.size} />
          <ShapesLayer colorMode={displayMode} doc={doc} palette={palette} />
          {draftDoc ? <ShapesLayer colorMode={displayMode} doc={draftDoc} opacity={0.9} palette={palette} /> : null}
          {penDoc ? <ShapesLayer colorMode={displayMode} doc={penDoc} opacity={0.9} palette={palette} /> : null}
          <OutsideMask size={doc.size} />
        </g>
        <EditorOverlay
          endHint={overlay.endHint}
          guides={overlay.guides}
          height={height}
          hint={overlay.hint}
          hover={showOutlines ? hoverShape : null}
          layout={layout}
          marquee={overlay.marquee}
          nodes={tool === 'node' ? nodeOverlayTargets : null}
          pen={pen ? { draft: pen, hover: overlay.penHover, closing: overlay.penClosing } : null}
          selected={showOutlines ? selectedShapes : []}
          selectedNodes={nodeSel}
          view={view}
          width={width}
        />
      </svg>
      <EditorContextBar
        node={nodeContext}
        onPolygonSidesChange={onPolygonSidesChange}
        penDrawing={pen !== null}
        polygonSides={polygonSides}
        tool={tool}
      />
    </div>
  );
}
