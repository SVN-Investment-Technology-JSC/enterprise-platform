import {
  DEFAULT_PALETTE,
  DEFAULT_RULES,
  createDocument,
  createEditorState,
  createShape,
  editorReducer,
  type EditorAction,
  type EditorState,
  type IconDocument,
  type IconShape,
  type PathGeometry,
  type Viewport,
} from '@enterprise-platform/shared-brand-icon';
import { act, fireEvent, render } from '@testing-library/react';
import { useEffect, useMemo, useReducer, useRef, useState, type Dispatch } from 'react';
import { EditorCanvas } from './editor-canvas';
import type { EditorTool } from './tool';
import type { CanvasViewport } from './use-canvas-viewport';

// jsdom chưa có PointerEvent: dựng bản tối thiểu để fireEvent mang theo toạ độ và phím bổ trợ.
beforeAll(() => {
  if (typeof window.PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
      readonly pointerId: number;

      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
      }
    }
    Object.defineProperty(window, 'PointerEvent', { value: PointerEventPolyfill, configurable: true, writable: true });
  }
});

/** Một đơn vị lưới = 16 pixel, gốc ở (0, 0): toạ độ chuột chia 16 là toạ độ lưới. */
const VIEW: Viewport = { zoom: 16, panX: 0, panY: 0 };
const px = (value: number) => value * 16;

interface Probe {
  state: EditorState;
  tool: EditorTool;
  dispatch: Dispatch<EditorAction>;
}

function makeViewport(): CanvasViewport {
  return {
    view: VIEW,
    width: 480,
    height: 480,
    containerRef: () => undefined,
    setView: jest.fn(),
    zoomBy: jest.fn(),
    fit: jest.fn(),
    percent: 1600,
  };
}

function Harness({
  initial,
  initialTool = 'select',
  probe,
  onSave,
  snapObjects = false,
  snapGrid = true,
}: {
  initial: IconDocument;
  initialTool?: EditorTool;
  probe: { current: Probe | null };
  onSave?: () => void;
  snapObjects?: boolean;
  snapGrid?: boolean;
}) {
  const [state, dispatch] = useReducer(editorReducer, initial, createEditorState);
  const [tool, setTool] = useState<EditorTool>(initialTool);
  const [sides, setSides] = useState(5);
  const viewport = useMemo(makeViewport, []);
  const latest = useRef(probe);
  useEffect(() => {
    latest.current.current = { state, tool, dispatch };
  });
  return (
    <EditorCanvas
      dispatch={dispatch}
      displayMode="brand"
      onPolygonSidesChange={setSides}
      onSave={onSave ?? (() => undefined)}
      onToolChange={setTool}
      palette={DEFAULT_PALETTE}
      polygonSides={sides}
      rules={DEFAULT_RULES}
      showGrid
      snapGrid={snapGrid}
      snapObjects={snapObjects}
      state={state}
      tool={tool}
      viewport={viewport}
    />
  );
}

function setup(shapes: IconShape[] = [], options: { tool?: EditorTool; snapObjects?: boolean; snapGrid?: boolean; onSave?: () => void } = {}) {
  const probe: { current: Probe | null } = { current: null };
  const doc = createDocument({ shapes });
  const utils = render(
    <Harness initial={doc} initialTool={options.tool} onSave={options.onSave} probe={probe} snapGrid={options.snapGrid} snapObjects={options.snapObjects} />,
  );
  const svg = utils.container.querySelector('svg') as SVGSVGElement;
  const read = () => (probe.current as Probe).state;
  const pointer = (type: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y: number, init: Record<string, unknown> = {}) =>
    fireEvent[type](svg, { clientX: px(x), clientY: px(y), button: 0, pointerId: 1, ...init });
  /** Phím bổ trợ chỉ áp lên lúc kéo và nhả (Shift lúc bấm xuống là thêm vào vùng chọn), trừ khi truyền riêng tham số cuối. */
  const drag = (from: [number, number], to: [number, number], init: Record<string, unknown> = {}, downInit: Record<string, unknown> = {}) => {
    pointer('pointerDown', from[0], from[1], downInit);
    pointer('pointerMove', (from[0] + to[0]) / 2, (from[1] + to[1]) / 2, init);
    pointer('pointerMove', to[0], to[1], init);
    pointer('pointerUp', to[0], to[1], init);
  };
  const click = (x: number, y: number, init: Record<string, unknown> = {}) => {
    pointer('pointerDown', x, y, init);
    pointer('pointerUp', x, y, init);
  };
  const key = (value: string, init: Record<string, unknown> = {}) => fireEvent.keyDown(window, { key: value, ...init });
  const act2 = (action: EditorAction) => act(() => (probe.current as Probe).dispatch(action));
  return { ...utils, svg, read, tool: () => (probe.current as Probe).tool, pointer, drag, click, key, send: act2 };
}

const rectShape = (overrides: Partial<IconShape> = {}) =>
  createShape({ type: 'rect', x: 2, y: 2, width: 8, height: 4, rx: 0 }, { id: 'rect-1', name: 'Khung', ...overrides });
const pathShape = (geometry: PathGeometry, overrides: Partial<IconShape> = {}) => createShape(geometry, { id: 'path-1', name: 'Đường', ...overrides });

describe('EditorCanvas: vẽ hình', () => {
  it('kéo công cụ chữ nhật tạo hình đã bắt dính lưới, chọn hình đó và về công cụ chọn', () => {
    const view = setup([], { tool: 'rect' });
    view.drag([2.1, 2.2], [10.2, 6.1]);
    const { shapes } = view.read().doc;
    expect(shapes).toHaveLength(1);
    expect(shapes[0].geometry).toEqual({ type: 'rect', x: 2, y: 2, width: 8, height: 4, rx: 0 });
    expect(shapes[0].fill).toBe('none');
    expect(shapes[0].stroke).toBe('brand:sapphire');
    expect(shapes[0].strokeWidth).toBe(1.75);
    expect(view.read().selection).toEqual([shapes[0].id]);
    expect(view.tool()).toBe('select');
    expect(view.read().past).toHaveLength(1);
  });

  it('giữ Shift thì vuông, giữ Alt thì kéo từ tâm', () => {
    const square = setup([], { tool: 'rect' });
    square.drag([2, 2], [10, 5], { shiftKey: true });
    expect(square.read().doc.shapes[0].geometry).toEqual({ type: 'rect', x: 2, y: 2, width: 8, height: 8, rx: 0 });
    square.unmount();

    const centered = setup([], { tool: 'rect' });
    centered.drag([8, 8], [10, 11], { altKey: true });
    expect(centered.read().doc.shapes[0].geometry).toEqual({ type: 'rect', x: 6, y: 5, width: 4, height: 6, rx: 0 });
  });

  it('elip, đường thẳng và đa giác', () => {
    const ellipse = setup([], { tool: 'ellipse' });
    ellipse.drag([2, 2], [10, 6], { shiftKey: true });
    expect(ellipse.read().doc.shapes[0].geometry).toEqual({ type: 'ellipse', cx: 6, cy: 6, rx: 4, ry: 4 });
    ellipse.unmount();

    const line = setup([], { tool: 'line' });
    line.drag([2, 2], [10, 2.3]);
    const lineGeometry = line.read().doc.shapes[0].geometry as PathGeometry;
    expect(lineGeometry.subpaths[0].closed).toBe(false);
    expect(lineGeometry.subpaths[0].nodes).toHaveLength(2);
    line.unmount();

    const polygon = setup([], { tool: 'polygon' });
    polygon.drag([12, 12], [12, 6]);
    const polygonGeometry = polygon.read().doc.shapes[0].geometry as PathGeometry;
    expect(polygonGeometry.subpaths[0].closed).toBe(true);
    expect(polygonGeometry.subpaths[0].nodes).toHaveLength(5);
  });

  it('phím lên xuống đổi số cạnh của đa giác', () => {
    const view = setup([], { tool: 'polygon' });
    view.key('ArrowUp');
    view.key('ArrowUp');
    view.drag([12, 12], [12, 6]);
    expect((view.read().doc.shapes[0].geometry as PathGeometry).subpaths[0].nodes).toHaveLength(7);
  });

  it('bấm không kéo thì không tạo hình', () => {
    const view = setup([], { tool: 'rect' });
    view.click(4, 4);
    expect(view.read().doc.shapes).toHaveLength(0);
    expect(view.tool()).toBe('rect');
  });

  it('Esc khi đang kéo huỷ hình đang vẽ', () => {
    const view = setup([], { tool: 'rect' });
    view.pointer('pointerDown', 2, 2);
    view.pointer('pointerMove', 8, 6);
    view.key('Escape');
    view.pointer('pointerUp', 8, 6);
    expect(view.read().doc.shapes).toHaveLength(0);
  });
});

describe('EditorCanvas: chọn và di chuyển', () => {
  it('bấm vào nét để chọn, bấm vùng trống để bỏ chọn', () => {
    const view = setup([rectShape()]);
    view.click(2, 4);
    expect(view.read().selection).toEqual(['rect-1']);
    view.click(20, 20);
    expect(view.read().selection).toEqual([]);
  });

  it('hình bị ẩn hoặc bị khoá không chọn được trên canvas', () => {
    const view = setup([rectShape({ locked: true })]);
    view.click(2, 4);
    expect(view.read().selection).toEqual([]);
    view.unmount();

    const hidden = setup([rectShape({ hidden: true })]);
    hidden.click(2, 4);
    expect(hidden.read().selection).toEqual([]);
  });

  it('Shift thêm hoặc bớt khỏi vùng chọn', () => {
    const other = createShape({ type: 'rect', x: 14, y: 2, width: 4, height: 4, rx: 0 }, { id: 'rect-2' });
    const view = setup([rectShape(), other]);
    view.click(2, 4);
    view.click(14, 4, { shiftKey: true });
    expect(view.read().selection).toEqual(['rect-1', 'rect-2']);
    view.click(14, 4, { shiftKey: true });
    expect(view.read().selection).toEqual(['rect-1']);
  });

  it('kéo khung chọn (marquee) chọn các hình nó chạm tới', () => {
    const other = createShape({ type: 'rect', x: 14, y: 14, width: 4, height: 4, rx: 0 }, { id: 'rect-2' });
    const view = setup([rectShape(), other]);
    view.drag([0.5, 0.5], [11, 8]);
    expect(view.read().selection).toEqual(['rect-1']);
    view.drag([0.5, 0.5], [20, 20]);
    expect(view.read().selection).toEqual(['rect-1', 'rect-2']);
  });

  it('kéo hình đi một đoạn bắt dính lưới và chỉ tính là một bước hoàn tác', () => {
    const view = setup([rectShape()]);
    view.drag([2, 4], [6.1, 8.2]);
    expect(view.read().doc.shapes[0].geometry).toEqual({ type: 'rect', x: 6, y: 6, width: 8, height: 4, rx: 0 });
    expect(view.read().past).toHaveLength(1);
    expect(view.read().gesture).toBe(false);
    act(() => view.key('z', { ctrlKey: true }));
    expect(view.read().doc.shapes[0].geometry).toEqual({ type: 'rect', x: 2, y: 2, width: 8, height: 4, rx: 0 });
  });

  it('giữ Shift khi kéo thì khoá theo trục', () => {
    const view = setup([rectShape()]);
    view.drag([2, 4], [8, 5.5], { shiftKey: true });
    expect(view.read().doc.shapes[0].geometry).toEqual({ type: 'rect', x: 8, y: 2, width: 8, height: 4, rx: 0 });
  });

  it('giữ Alt khi kéo thì không bắt dính', () => {
    const view = setup([rectShape()]);
    view.drag([2, 4], [4.13, 4], { altKey: true });
    const geometry = view.read().doc.shapes[0].geometry;
    expect(geometry.type === 'rect' && geometry.x).toBeCloseTo(4.13, 3);
  });

  it('kéo bắt dính vào tâm khung vẽ và hiện đường dóng', () => {
    const view = setup([rectShape({ id: 'rect-1' })], { snapObjects: true, snapGrid: false });
    // Hình rộng 8: tâm ở x = 6; kéo thêm 5,9 thì tâm ở 11,9, gần tâm khung (12).
    view.drag([2, 4], [7.9, 4]);
    const geometry = view.read().doc.shapes[0].geometry;
    expect(geometry.type === 'rect' && geometry.x + geometry.width / 2).toBeCloseTo(12, 4);
  });

  it('mũi tên dịch hình một bước lưới, Shift nhân 5, Alt 0,1', () => {
    const view = setup([rectShape()]);
    view.click(2, 4);
    view.key('ArrowRight');
    expect(view.read().doc.shapes[0].geometry).toMatchObject({ x: 2.5 });
    view.key('ArrowDown', { shiftKey: true });
    expect(view.read().doc.shapes[0].geometry).toMatchObject({ y: 4.5 });
    view.key('ArrowLeft', { altKey: true });
    const geometry = view.read().doc.shapes[0].geometry;
    expect(geometry.type === 'rect' && geometry.x).toBeCloseTo(2.4, 4);
  });

  it('hình khoá chọn qua danh sách lớp không bị dịch bằng phím mũi tên', () => {
    const view = setup([rectShape({ locked: true })]);
    view.send({ type: 'select', ids: ['rect-1'] });
    view.key('ArrowRight');
    expect(view.read().doc.shapes[0].geometry).toMatchObject({ x: 2 });
  });
});

describe('EditorCanvas: đổi kích thước và xoay', () => {
  it('kéo tay cầm góc dưới phải đổi cỡ, giữ nguyên góc trên trái', () => {
    const view = setup([rectShape()]);
    view.click(2, 4);
    view.drag([10, 6], [14, 10]);
    expect(view.read().doc.shapes[0].geometry).toEqual({ type: 'rect', x: 2, y: 2, width: 12, height: 8, rx: 0 });
    expect(view.read().past).toHaveLength(1);
  });

  it('giữ Shift khi kéo góc thì giữ tỷ lệ, giữ Alt thì co giãn từ tâm', () => {
    const keep = setup([rectShape()]);
    keep.click(2, 4);
    keep.drag([10, 6], [18, 7], { shiftKey: true });
    expect(keep.read().doc.shapes[0].geometry).toEqual({ type: 'rect', x: 2, y: 2, width: 16, height: 8, rx: 0 });
    keep.unmount();

    const center = setup([rectShape()]);
    center.click(2, 4);
    center.drag([10, 6], [12, 6], { altKey: true });
    // Tâm (6, 4) giữ nguyên; mép phải ra 12 nên rộng 12.
    expect(center.read().doc.shapes[0].geometry).toEqual({ type: 'rect', x: 0, y: 2, width: 12, height: 4, rx: 0 });
  });

  it('tay cầm xoay đưa hình về dạng đường và xoay theo bước 15 độ khi giữ Shift', () => {
    const view = setup([rectShape()]);
    view.click(2, 4);
    // Khung chọn rộng 8, cao 4; tay cầm xoay cách mép trên 22px, trên tâm khung (x = 6).
    const rotateY = 2 - 22 / 16;
    view.pointer('pointerDown', 6, rotateY);
    // Từ phía trên tâm, kéo sang phải-dưới nhiều độ.
    view.pointer('pointerMove', 12, 4 - 3);
    view.pointer('pointerMove', 9.2, 4 - 7, { shiftKey: true });
    view.pointer('pointerUp', 9.2, 4 - 7, { shiftKey: true });
    const geometry = view.read().doc.shapes[0].geometry as PathGeometry;
    expect(geometry.type).toBe('path');
    expect(geometry.subpaths[0].nodes).toHaveLength(4);
    expect(view.read().past).toHaveLength(1);
  });
});

describe('EditorCanvas: phím tắt', () => {
  it('Delete xoá hình đang chọn, Ctrl+Z hoàn tác', () => {
    const view = setup([rectShape()]);
    view.click(2, 4);
    view.key('Delete');
    expect(view.read().doc.shapes).toHaveLength(0);
    view.key('z', { ctrlKey: true });
    expect(view.read().doc.shapes).toHaveLength(1);
    view.key('y', { ctrlKey: true });
    expect(view.read().doc.shapes).toHaveLength(0);
  });

  it('Ctrl+D nhân đôi, Ctrl+A chọn hết, [ và ] đổi thứ tự lớp', () => {
    const view = setup([rectShape(), createShape({ type: 'ellipse', cx: 16, cy: 16, rx: 2, ry: 2 }, { id: 'ellipse-1' })]);
    view.key('a', { ctrlKey: true });
    expect(view.read().selection).toEqual(['rect-1', 'ellipse-1']);
    view.click(2, 4);
    view.key('d', { ctrlKey: true });
    expect(view.read().doc.shapes).toHaveLength(3);
    view.send({ type: 'select', ids: ['rect-1'] });
    view.key(']');
    expect(view.read().doc.shapes.map((shape) => shape.id)[1]).toBe('rect-1');
  });

  it('chọn công cụ bằng chữ cái, không bắt phím khi đang gõ trong ô nhập', () => {
    const view = setup([]);
    view.key('p');
    expect(view.tool()).toBe('pen');
    view.key('h');
    expect(view.tool()).toBe('hand');

    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'r' });
    expect(view.tool()).toBe('hand');
    input.remove();
  });

  it('Ctrl+S gọi lưu', () => {
    const onSave = jest.fn();
    const view = setup([], { onSave });
    view.key('s', { ctrlKey: true });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('Esc bỏ chọn', () => {
    const view = setup([rectShape()]);
    view.click(2, 4);
    view.key('Escape');
    expect(view.read().selection).toEqual([]);
  });
});

describe('EditorCanvas: công cụ Bút', () => {
  it('bấm đặt điểm góc rồi Enter kết thúc thành đường mở', () => {
    const view = setup([], { tool: 'pen' });
    view.click(4, 4);
    view.click(12, 4);
    view.click(12, 12);
    view.key('Enter');
    const shape = view.read().doc.shapes[0];
    const geometry = shape.geometry as PathGeometry;
    expect(geometry.subpaths[0].nodes.map((node) => [node.x, node.y])).toEqual([
      [4, 4],
      [12, 4],
      [12, 12],
    ]);
    expect(geometry.subpaths[0].closed).toBe(false);
    expect(view.tool()).toBe('pen');
    expect(view.read().selection).toEqual([shape.id]);
  });

  it('bấm lại điểm đầu thì đóng đường', () => {
    const view = setup([], { tool: 'pen' });
    view.click(4, 4);
    view.click(12, 4);
    view.click(12, 12);
    view.click(4.1, 4.1);
    const geometry = view.read().doc.shapes[0].geometry as PathGeometry;
    expect(geometry.subpaths[0].closed).toBe(true);
    expect(geometry.subpaths[0].nodes).toHaveLength(3);
  });

  it('bấm-kéo tạo điểm trơn với tay cầm đối xứng', () => {
    const view = setup([], { tool: 'pen' });
    view.click(4, 4);
    view.drag([12, 12], [16, 12]);
    view.key('Enter');
    const nodes = (view.read().doc.shapes[0].geometry as PathGeometry).subpaths[0].nodes;
    expect(nodes[1]).toEqual({ x: 12, y: 12, hout: { x: 16, y: 12 }, hin: { x: 8, y: 12 } });
  });

  it('Esc huỷ đường đang vẽ, không tạo hình', () => {
    const view = setup([], { tool: 'pen' });
    view.click(4, 4);
    view.click(12, 4);
    view.key('Escape');
    view.key('Enter');
    expect(view.read().doc.shapes).toHaveLength(0);
  });

  it('đổi sang công cụ khác thì chốt đường đang vẽ', () => {
    const view = setup([], { tool: 'pen' });
    view.click(4, 4);
    view.click(12, 4);
    view.key('v');
    expect(view.read().doc.shapes).toHaveLength(1);
    expect(view.tool()).toBe('select');
  });

  it('chỉ một điểm thì không tạo đường', () => {
    const view = setup([], { tool: 'pen' });
    view.click(4, 4);
    view.key('Enter');
    expect(view.read().doc.shapes).toHaveLength(0);
  });

  it('bấm vào đầu mút của đường mở đang chọn thì nối tiếp đường đó', () => {
    const open = pathShape({ type: 'path', subpaths: [{ closed: false, nodes: [{ x: 4, y: 4 }, { x: 12, y: 4 }] }] });
    const view = setup([open], { tool: 'select' });
    view.click(8, 4);
    view.key('p');
    view.click(12, 4);
    view.click(12, 12);
    view.key('Enter');
    expect(view.read().doc.shapes).toHaveLength(1);
    const nodes = (view.read().doc.shapes[0].geometry as PathGeometry).subpaths[0].nodes;
    expect(nodes.map((node) => [node.x, node.y])).toEqual([
      [4, 4],
      [12, 4],
      [12, 12],
    ]);
  });
});

describe('EditorCanvas: công cụ Điểm neo', () => {
  const zig = () =>
    pathShape({
      type: 'path',
      subpaths: [
        {
          closed: false,
          nodes: [
            { x: 4, y: 4 },
            { x: 12, y: 4 },
            { x: 12, y: 12 },
          ],
        },
      ],
    });

  it('kéo điểm neo đổi vị trí điểm đó và chỉ tính là một bước hoàn tác', () => {
    const view = setup([zig()]);
    view.click(8, 4);
    view.key('a');
    view.drag([12, 4], [14, 6]);
    const nodes = (view.read().doc.shapes[0].geometry as PathGeometry).subpaths[0].nodes;
    expect(nodes[1]).toEqual({ x: 14, y: 6 });
    expect(nodes[0]).toEqual({ x: 4, y: 4 });
    expect(view.read().past).toHaveLength(1);
  });

  it('rect được chuyển thành đường khi sửa điểm', () => {
    const view = setup([rectShape()]);
    view.click(2, 4);
    view.key('a');
    view.drag([2, 2], [3, 3]);
    const geometry = view.read().doc.shapes[0].geometry as PathGeometry;
    expect(geometry.type).toBe('path');
    expect(geometry.subpaths[0].nodes[0]).toEqual({ x: 3, y: 3 });
  });

  it('nhấp đôi vào đoạn thêm một điểm neo', () => {
    const view = setup([zig()]);
    view.click(8, 4);
    view.key('a');
    view.click(8, 4);
    view.click(8, 4);
    const nodes = (view.read().doc.shapes[0].geometry as PathGeometry).subpaths[0].nodes;
    expect(nodes).toHaveLength(4);
    expect(nodes[1]).toEqual({ x: 8, y: 4 });
  });

  it('nhấp đôi vào điểm neo đổi giữa góc và trơn', () => {
    const view = setup([zig()]);
    view.click(8, 4);
    view.key('a');
    view.click(12, 4);
    view.click(12, 4);
    const node = (view.read().doc.shapes[0].geometry as PathGeometry).subpaths[0].nodes[1];
    expect(node.hin || node.hout).toBeTruthy();
  });

  it('Delete xoá điểm neo đang chọn thay vì xoá cả hình', () => {
    const view = setup([zig()]);
    view.click(8, 4);
    view.key('a');
    view.click(12, 4);
    view.key('Delete');
    expect(view.read().doc.shapes).toHaveLength(1);
    expect((view.read().doc.shapes[0].geometry as PathGeometry).subpaths[0].nodes).toHaveLength(2);
  });

  it('mũi tên dịch điểm neo đang chọn', () => {
    const view = setup([zig()]);
    view.click(8, 4);
    view.key('a');
    view.click(12, 12);
    view.key('ArrowLeft');
    const nodes = (view.read().doc.shapes[0].geometry as PathGeometry).subpaths[0].nodes;
    expect(nodes[2]).toEqual({ x: 11.5, y: 12 });
  });

  it('kéo khung quét chọn nhiều điểm neo rồi dời cùng nhau', () => {
    const view = setup([zig()]);
    view.click(8, 4);
    view.key('a');
    view.drag([10, 2], [14, 14]);
    view.drag([12, 4], [13, 5]);
    const nodes = (view.read().doc.shapes[0].geometry as PathGeometry).subpaths[0].nodes;
    expect(nodes[0]).toEqual({ x: 4, y: 4 });
    expect(nodes[1]).toEqual({ x: 13, y: 5 });
    expect(nodes[2]).toEqual({ x: 13, y: 13 });
  });

  it('thanh ngữ cảnh có nút đóng đường khi có từ 3 điểm', () => {
    const view = setup([zig()]);
    view.click(8, 4);
    view.key('a');
    const button = view.getByRole('button', { name: 'Đóng đường' });
    fireEvent.click(button);
    expect((view.read().doc.shapes[0].geometry as PathGeometry).subpaths[0].closed).toBe(true);
    expect(view.getByRole('button', { name: 'Mở đường' })).toBeTruthy();
  });
});

describe('EditorCanvas: nền và thu phóng', () => {
  it('công cụ bàn tay kéo nền', () => {
    const probe: { current: Probe | null } = { current: null };
    const viewport = makeViewport();
    const { container } = render(
      <EditorCanvasWithViewport probe={probe} tool="hand" viewport={viewport} />,
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    fireEvent.pointerDown(svg, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 130, clientY: 90, button: 0, pointerId: 1 });
    expect(viewport.setView).toHaveBeenCalledWith({ zoom: 16, panX: 30, panY: -10 });
  });

  it('chuột giữa cũng kéo nền, phím + - 0 gọi thu phóng', () => {
    const probe: { current: Probe | null } = { current: null };
    const viewport = makeViewport();
    const { container } = render(<EditorCanvasWithViewport probe={probe} tool="select" viewport={viewport} />);
    const svg = container.querySelector('svg') as SVGSVGElement;
    fireEvent.pointerDown(svg, { clientX: 10, clientY: 10, button: 1, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 20, clientY: 40, button: 1, pointerId: 1 });
    expect(viewport.setView).toHaveBeenCalledWith({ zoom: 16, panX: 10, panY: 30 });
    fireEvent.pointerUp(svg, { clientX: 20, clientY: 40, button: 1, pointerId: 1 });

    fireEvent.keyDown(window, { key: '+' });
    fireEvent.keyDown(window, { key: '-' });
    fireEvent.keyDown(window, { key: '0' });
    expect(viewport.zoomBy).toHaveBeenCalledTimes(2);
    expect(viewport.fit).toHaveBeenCalledTimes(1);
  });
});

function EditorCanvasWithViewport({ probe, tool, viewport }: { probe: { current: Probe | null }; tool: EditorTool; viewport: CanvasViewport }) {
  const [state, dispatch] = useReducer(editorReducer, createDocument({ shapes: [] }), createEditorState);
  useEffect(() => {
    probe.current = { state, tool, dispatch };
  });
  return (
    <EditorCanvas
      dispatch={dispatch}
      displayMode="brand"
      onPolygonSidesChange={() => undefined}
      onSave={() => undefined}
      onToolChange={() => undefined}
      palette={DEFAULT_PALETTE}
      polygonSides={5}
      rules={DEFAULT_RULES}
      showGrid
      snapGrid
      snapObjects={false}
      state={state}
      tool={tool}
      viewport={viewport}
    />
  );
}
