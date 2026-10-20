/**
 * Kiểm thử ngẫu nhiên có hạt giống cố định: sinh nhiều đầu vào rồi kiểm tra các tính chất bất biến
 * (cung đúng elip, lệnh tương đối = tuyệt đối, undo về đúng ban đầu, bước chuẩn hoá không bao giờ ném lỗi...).
 */
import { normalizeRules } from './compliance';
import {
  createEditorState,
  editorReducer,
  type EditorAction,
  type EditorState,
} from './editor-state';
import { geometryBounds, insertNode, scaling, translation } from './geometry';
import { createDocument, createShape, type IconShape, type PathGeometry, type Point } from './model';
import { normalizePalette } from './palette';
import { parsePathData, pathToData } from './path-data';
import { normalizeDocument, normalizeLibrary, normalizeShape } from './validate';

/** Bộ sinh số ngẫu nhiên mulberry32, cố định theo hạt giống để lỗi tái hiện được. */
function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min: number, max: number) => min + next() * (max - min),
    int: (min: number, max: number) => Math.floor(min + next() * (max - min + 1)),
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)],
    bool: () => next() < 0.5,
  };
}

const r3 = (value: number) => Math.round(value * 1000) / 1000;

const cubicAt = (p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point => {
  const mt = 1 - t;
  const f = (a: number, b: number, c: number, d: number) => mt ** 3 * a + 3 * mt * mt * t * b + 3 * mt * t * t * c + t ** 3 * d;
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
};

/** Lấy mẫu dày dọc theo đường (kể cả đoạn đóng). */
function samplePath(geometry: PathGeometry, perSegment = 200): Point[] {
  const points: Point[] = [];
  for (const sub of geometry.subpaths) {
    const segments: Array<[(typeof sub.nodes)[number], (typeof sub.nodes)[number]]> = [];
    for (let index = 1; index < sub.nodes.length; index += 1) segments.push([sub.nodes[index - 1], sub.nodes[index]]);
    if (sub.closed && sub.nodes.length > 1) segments.push([sub.nodes[sub.nodes.length - 1], sub.nodes[0]]);
    for (const [from, to] of segments) {
      for (let step = 0; step <= perSegment; step += 1) {
        points.push(cubicAt(from, from.hout ?? from, to.hin ?? to, to, step / perSegment));
      }
    }
    if (sub.nodes.length === 1) points.push({ x: sub.nodes[0].x, y: sub.nodes[0].y });
  }
  return points;
}

describe('khung bao so với lấy mẫu dày', () => {
  it('geometryBounds của đường cong ngẫu nhiên khớp khung bao tính bằng lấy mẫu (sai số < 0,01)', () => {
    const rng = random(20261020);
    for (let round = 0; round < 150; round += 1) {
      const count = rng.int(2, 6);
      const nodes = Array.from({ length: count }, () => {
        const x = rng.range(0, 24);
        const y = rng.range(0, 24);
        return {
          x,
          y,
          ...(rng.bool() ? { hin: { x: x + rng.range(-8, 8), y: y + rng.range(-8, 8) } } : {}),
          ...(rng.bool() ? { hout: { x: x + rng.range(-8, 8), y: y + rng.range(-8, 8) } } : {}),
        };
      });
      const geometry: PathGeometry = { type: 'path', subpaths: [{ closed: rng.bool() && count > 2, nodes }] };
      const bounds = geometryBounds(geometry);
      const samples = samplePath(geometry, 400);
      const minX = Math.min(...samples.map((p) => p.x));
      const maxX = Math.max(...samples.map((p) => p.x));
      const minY = Math.min(...samples.map((p) => p.y));
      const maxY = Math.max(...samples.map((p) => p.y));
      expect(Math.abs(bounds.x - minX)).toBeLessThan(0.01);
      expect(Math.abs(bounds.x + bounds.width - maxX)).toBeLessThan(0.01);
      expect(Math.abs(bounds.y - minY)).toBeLessThan(0.01);
      expect(Math.abs(bounds.y + bounds.height - maxY)).toBeLessThan(0.01);
    }
  });
});

describe('insertNode giữ nguyên đường cong', () => {
  it('chèn tại tham số ngẫu nhiên: đường mới nằm đúng trên đường cũ', () => {
    const rng = random(7);
    for (let round = 0; round < 80; round += 1) {
      const count = rng.int(2, 5);
      const closed = count > 2 && rng.bool();
      const nodes = Array.from({ length: count }, () => {
        const x = rng.range(0, 24);
        const y = rng.range(0, 24);
        return { x, y, hin: { x: x + rng.range(-6, 6), y: y + rng.range(-6, 6) }, hout: { x: x + rng.range(-6, 6), y: y + rng.range(-6, 6) } };
      });
      const geometry: PathGeometry = { type: 'path', subpaths: [{ closed, nodes }] };
      const lastSegment = closed ? count - 1 : count - 2;
      const segment = rng.int(0, lastSegment);
      const t = rng.range(0.05, 0.95);
      const result = insertNode(geometry, 0, segment, t);
      expect(result.subpaths[0].nodes).toHaveLength(count + 1);

      const from = nodes[segment];
      const to = nodes[(segment + 1) % count];
      const [a, mid, b] = [result.subpaths[0].nodes[segment], result.subpaths[0].nodes[segment + 1], result.subpaths[0].nodes[(segment + 2) % (count + 1)]];
      for (let step = 0; step <= 10; step += 1) {
        const u = step / 10;
        const original = cubicAt(from, from.hout, to.hin, to, t * u);
        const left = cubicAt(a, a.hout ?? a, mid.hin ?? mid, mid, u);
        expect(left.x).toBeCloseTo(original.x, 6);
        expect(left.y).toBeCloseTo(original.y, 6);
        const originalRight = cubicAt(from, from.hout, to.hin, to, t + (1 - t) * u);
        const right = cubicAt(mid, mid.hout ?? mid, b.hin ?? b, b, u);
        expect(right.x).toBeCloseTo(originalRight.x, 6);
        expect(right.y).toBeCloseTo(originalRight.y, 6);
      }
    }
  });
});

describe('cung elip', () => {
  /** Tâm elip theo hai nghiệm của công thức chuyển điểm cuối sang tâm (SVG 1.1, F.6.5). */
  function centers(from: Point, to: Point, rxIn: number, ryIn: number, phiDeg: number): { cx: number; cy: number; rx: number; ry: number }[] {
    const phi = (phiDeg * Math.PI) / 180;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const dx = (from.x - to.x) / 2;
    const dy = (from.y - to.y) / 2;
    const x1p = cos * dx + sin * dy;
    const y1p = -sin * dx + cos * dy;
    const lambda = (x1p * x1p) / (rxIn * rxIn) + (y1p * y1p) / (ryIn * ryIn);
    const scale = lambda > 1 ? Math.sqrt(lambda) : 1;
    const rx = rxIn * scale;
    const ry = ryIn * scale;
    const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    const root = Math.sqrt(Math.max(0, numerator / denominator));
    return [1, -1].map((sign) => {
      const cxp = (sign * root * rx * y1p) / ry;
      const cyp = (-sign * root * ry * x1p) / rx;
      return {
        cx: cos * cxp - sin * cyp + (from.x + to.x) / 2,
        cy: sin * cxp + cos * cyp + (from.y + to.y) / 2,
        rx,
        ry,
      };
    });
  }

  it('mọi điểm của cung ngẫu nhiên nằm trên elip, đúng chiều quay và đúng cung ngắn/dài', () => {
    const rng = random(424242);
    let checked = 0;
    for (let round = 0; round < 300; round += 1) {
      const from = { x: r3(rng.range(2, 22)), y: r3(rng.range(2, 22)) };
      const to = { x: r3(rng.range(2, 22)), y: r3(rng.range(2, 22)) };
      if (Math.hypot(from.x - to.x, from.y - to.y) < 1) continue;
      const rx = r3(rng.range(1, 14));
      const ry = r3(rng.range(1, 14));
      const phi = rng.int(0, 11) * 15;
      const large = rng.bool();
      const sweep = rng.bool();
      const geometry = parsePathData(`M ${from.x} ${from.y} A ${rx} ${ry} ${phi} ${large ? 1 : 0} ${sweep ? 1 : 0} ${to.x} ${to.y}`);
      const nodes = geometry.subpaths[0].nodes;
      expect(nodes[0]).toMatchObject(from);
      expect(nodes[nodes.length - 1]).toMatchObject(to);

      const candidates = centers(from, to, rx, ry, phi);
      const samples = samplePath(geometry, 60);
      const phiRad = (phi * Math.PI) / 180;
      const residual = (candidate: (typeof candidates)[number]) =>
        Math.max(
          ...samples.map((p) => {
            const ux = Math.cos(phiRad) * (p.x - candidate.cx) + Math.sin(phiRad) * (p.y - candidate.cy);
            const uy = -Math.sin(phiRad) * (p.x - candidate.cx) + Math.cos(phiRad) * (p.y - candidate.cy);
            return Math.abs((ux * ux) / (candidate.rx * candidate.rx) + (uy * uy) / (candidate.ry * candidate.ry) - 1);
          }),
        );
      const best = candidates.reduce((a, b) => (residual(a) <= residual(b) ? a : b));
      // Bezier xấp xỉ cung 90 độ với sai số tương đối nhỏ hơn 0,03%
      expect(residual(best)).toBeLessThan(0.002);

      // chiều quay và độ lớn cung quanh tâm tìm được
      let total = 0;
      let previous: number | null = null;
      for (const p of samples) {
        const ux = Math.cos(phiRad) * (p.x - best.cx) + Math.sin(phiRad) * (p.y - best.cy);
        const uy = -Math.sin(phiRad) * (p.x - best.cx) + Math.cos(phiRad) * (p.y - best.cy);
        const angle = Math.atan2(uy / best.ry, ux / best.rx);
        if (previous !== null) {
          let delta = angle - previous;
          while (delta > Math.PI) delta -= 2 * Math.PI;
          while (delta < -Math.PI) delta += 2 * Math.PI;
          total += delta;
        }
        previous = angle;
      }
      expect(total > 0).toBe(sweep);
      const scaledUp = best.rx > rx + 1e-9 || best.ry > ry + 1e-9;
      if (!scaledUp) expect(Math.abs(total) > Math.PI).toBe(large);
      else expect(Math.abs(total)).toBeCloseTo(Math.PI, 1);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(200);
  });
});

describe('lệnh tương đối và tuyệt đối', () => {
  type Command = { letter: string; args: number[] };

  /** Sinh một đường tuyệt đối ngẫu nhiên dùng đủ M L H V C S Q T A Z. */
  function randomAbsolute(rng: ReturnType<typeof random>): Command[] {
    // toạ độ là bội của 0,25 để hiệu tương đối cộng lại đúng tuyệt đối, không dính sai số làm tròn
    const p = () => rng.int(0, 96) / 4;
    const commands: Command[] = [{ letter: 'M', args: [p(), p()] }];
    const count = rng.int(3, 10);
    for (let index = 0; index < count; index += 1) {
      const letter = rng.pick(['L', 'H', 'V', 'C', 'S', 'Q', 'T', 'A', 'Z', 'M'] as const);
      switch (letter) {
        case 'L':
        case 'T':
        case 'M':
          commands.push({ letter, args: [p(), p()] });
          break;
        case 'H':
        case 'V':
          commands.push({ letter, args: [p()] });
          break;
        case 'C':
          commands.push({ letter, args: [p(), p(), p(), p(), p(), p()] });
          break;
        case 'S':
        case 'Q':
          commands.push({ letter, args: [p(), p(), p(), p()] });
          break;
        case 'A':
          commands.push({ letter, args: [rng.int(4, 40) / 4, rng.int(4, 40) / 4, rng.int(0, 6) * 15, rng.int(0, 1), rng.int(0, 1), p(), p()] });
          break;
        default:
          commands.push({ letter, args: [] });
      }
    }
    return commands;
  }

  function toRelative(commands: Command[]): Command[] {
    let cx = 0;
    let cy = 0;
    let sx = 0;
    let sy = 0;
    return commands.map(({ letter, args }) => {
      const result: Command = { letter: letter.toLowerCase(), args: [...args] };
      switch (letter) {
        case 'M':
          result.args = [args[0] - cx, args[1] - cy];
          cx = sx = args[0];
          cy = sy = args[1];
          break;
        case 'L':
        case 'T':
          result.args = [args[0] - cx, args[1] - cy];
          cx = args[0];
          cy = args[1];
          break;
        case 'H':
          result.args = [args[0] - cx];
          cx = args[0];
          break;
        case 'V':
          result.args = [args[0] - cy];
          cy = args[0];
          break;
        case 'C':
          result.args = [args[0] - cx, args[1] - cy, args[2] - cx, args[3] - cy, args[4] - cx, args[5] - cy];
          cx = args[4];
          cy = args[5];
          break;
        case 'S':
        case 'Q':
          result.args = [args[0] - cx, args[1] - cy, args[2] - cx, args[3] - cy];
          cx = args[2];
          cy = args[3];
          break;
        case 'A':
          result.args = [args[0], args[1], args[2], args[3], args[4], args[5] - cx, args[6] - cy];
          cx = args[5];
          cy = args[6];
          break;
        default:
          cx = sx;
          cy = sy;
      }
      return result;
    });
  }

  const serialize = (commands: Command[]) => commands.map(({ letter, args }) => `${letter} ${args.map((value) => r3(value)).join(' ')}`).join(' ');

  it('đường viết bằng lệnh tương đối cho đúng hình như đường viết bằng lệnh tuyệt đối', () => {
    const rng = random(99);
    for (let round = 0; round < 200; round += 1) {
      const absolute = randomAbsolute(rng);
      const relative = toRelative(absolute);
      const a = parsePathData(serialize(absolute));
      const b = parsePathData(serialize(relative));
      expect(b.subpaths).toHaveLength(a.subpaths.length);
      a.subpaths.forEach((sub, index) => {
        expect(b.subpaths[index].closed).toBe(sub.closed);
        expect(b.subpaths[index].nodes).toHaveLength(sub.nodes.length);
        sub.nodes.forEach((node, nodeIndex) => {
          const peer = b.subpaths[index].nodes[nodeIndex];
          expect(peer.x).toBeCloseTo(node.x, 2);
          expect(peer.y).toBeCloseTo(node.y, 2);
          expect(Boolean(peer.hin)).toBe(Boolean(node.hin));
          expect(Boolean(peer.hout)).toBe(Boolean(node.hout));
        });
      });
    }
  });

  it('parse -> pathToData -> parse ổn định cho đường ngẫu nhiên', () => {
    const rng = random(5);
    for (let round = 0; round < 200; round += 1) {
      const first = parsePathData(serialize(randomAbsolute(rng)));
      const data = pathToData(first);
      const second = parsePathData(data);
      expect(pathToData(second)).toBe(data);
      expect(second.subpaths.map((sub) => [sub.closed, sub.nodes.length])).toEqual(first.subpaths.map((sub) => [sub.closed, sub.nodes.length]));
    }
  });
});

describe('bộ chuẩn hoá không bao giờ ném lỗi với dữ liệu rác', () => {
  function garbage(rng: ReturnType<typeof random>, depth = 0): unknown {
    const kind = rng.int(0, depth > 3 ? 6 : 10);
    switch (kind) {
      case 0:
        return null;
      case 1:
        return undefined;
      case 2:
        return rng.range(-5000, 5000);
      case 3:
        return rng.pick([Number.NaN, Infinity, -Infinity, -0, 0]);
      case 4:
        return rng.pick(['', 'none', 'currentColor', 'brand:x', '#fff', '"><script>', 'M 0 0 L 1 1', 'rect', 'path', 'ellipse', 'x'.repeat(200)]);
      case 5:
        return rng.bool();
      case 6:
        return rng.pick(['round', 'butt', 'evenodd', 'published', 'brand', 'custom']);
      case 7:
        return Array.from({ length: rng.int(0, 4) }, () => garbage(rng, depth + 1));
      default: {
        const keys = ['id', 'name', 'shapes', 'geometry', 'type', 'x', 'y', 'cx', 'cy', 'rx', 'ry', 'width', 'height', 'subpaths', 'nodes', 'closed', 'hin', 'hout', 'fill', 'stroke', 'strokeWidth', 'tags', 'size', 'category', 'glyphPath', 'containerShape', 'tokens', 'key', 'hex', 'icons', 'allowedStrokeWidths', '__proto__', 'constructor'];
        const result: Record<string, unknown> = {};
        for (let index = 0; index < rng.int(0, 8); index += 1) result[rng.pick(keys)] = garbage(rng, depth + 1);
        return result;
      }
    }
  }

  /** Đối tượng gần đúng: đủ khung để đi sâu vào các nhánh bên trong bộ chuẩn hoá. */
  function nearlyValid(rng: ReturnType<typeof random>) {
    const shape = () => ({
      id: garbage(rng),
      name: garbage(rng),
      geometry: rng.pick([
        { type: 'rect', x: garbage(rng), y: 1, width: garbage(rng), height: 3, rx: garbage(rng) },
        { type: 'ellipse', cx: 1, cy: garbage(rng), rx: garbage(rng), ry: 2 },
        { type: 'path', subpaths: [{ closed: garbage(rng), nodes: [{ x: 1, y: 2, hin: garbage(rng), hout: garbage(rng) }, garbage(rng)] }, garbage(rng)] },
        garbage(rng),
      ]),
      fill: garbage(rng),
      stroke: garbage(rng),
      strokeWidth: garbage(rng),
      opacity: garbage(rng),
      linecap: garbage(rng),
      hidden: garbage(rng),
    });
    return {
      id: rng.pick(['icon-1', garbage(rng)]),
      name: rng.pick(['Tên', garbage(rng)]),
      shapes: rng.bool() ? Array.from({ length: rng.int(0, 3) }, shape) : garbage(rng),
      tags: garbage(rng),
      size: garbage(rng),
      category: garbage(rng),
      createdAt: garbage(rng),
    };
  }

  it('normalizeDocument, normalizeShape, normalizeLibrary, normalizePalette, normalizeRules', () => {
    const rng = random(13);
    for (let round = 0; round < 1500; round += 1) {
      const value = round % 2 === 0 ? garbage(rng) : nearlyValid(rng);
      expect(() => normalizeDocument(value)).not.toThrow();
      expect(() => normalizeShape(value)).not.toThrow();
      expect(() => normalizePalette(value)).not.toThrow();
      expect(() => normalizeRules(value)).not.toThrow();
      try {
        normalizeLibrary([value, value]);
      } catch (error) {
        throw new Error(`normalizeLibrary ném lỗi: ${String(error)}`);
      }
    }
  });

  it('kết quả của normalizeDocument luôn ổn định khi chuẩn hoá lần hai', () => {
    const rng = random(31);
    let accepted = 0;
    for (let round = 0; round < 1500; round += 1) {
      const doc = normalizeDocument(nearlyValid(rng));
      if (!doc) continue;
      accepted += 1;
      expect(normalizeDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    }
    expect(accepted).toBeGreaterThan(20);
  });
});

describe('bộ giảm trạng thái của trình soạn thảo', () => {
  const makeShape = (rng: ReturnType<typeof random>, index: number): IconShape => {
    const geometry = rng.pick([
      { type: 'rect', x: rng.int(0, 16), y: rng.int(0, 16), width: rng.int(1, 8), height: rng.int(1, 8), rx: 0 } as const,
      { type: 'ellipse', cx: rng.int(4, 20), cy: rng.int(4, 20), rx: rng.int(1, 4), ry: rng.int(1, 4) } as const,
      parsePathData(`M ${rng.int(0, 20)} ${rng.int(0, 20)} L ${rng.int(0, 20)} ${rng.int(0, 20)} M ${rng.int(0, 20)} ${rng.int(0, 20)} L ${rng.int(0, 20)} ${rng.int(0, 20)}`),
    ]);
    return { ...createShape(geometry, { stroke: rng.bool() ? 'currentColor' : 'none', fill: rng.bool() ? 'brand:sapphire' : 'none', locked: rng.next() < 0.15 }), id: `s${index}` };
  };

  function randomAction(rng: ReturnType<typeof random>, state: EditorState, counter: { value: number }): EditorAction {
    const ids = state.doc.shapes.map((shape) => shape.id);
    const some = () => {
      const chosen = ids.filter(() => rng.bool());
      return chosen.length > 0 ? chosen : ids.slice(0, 1);
    };
    const kind = rng.int(0, 17);
    switch (kind) {
      case 0:
        return { type: 'addShapes', shapes: [makeShape(rng, (counter.value += 1))] };
      case 1:
        return { type: 'remove', ids: some() };
      case 2:
        return { type: 'duplicate', ids: some() };
      case 3:
        return { type: 'transform', ids: some(), matrix: rng.pick([translation(1, 2), scaling(1.5, 0.5, 12, 12), translation(-3, 0)]) };
      case 4:
        return { type: 'reorder', ids: some(), mode: rng.pick(['forward', 'backward', 'front', 'back'] as const) };
      case 5:
        return { type: 'moveShape', id: rng.pick(ids.length > 0 ? ids : ['x']), toIndex: rng.int(-1, ids.length) };
      case 6:
        return { type: 'align', ids: some(), mode: rng.pick(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const), to: rng.pick(['selection', 'canvas'] as const) };
      case 7:
        return { type: 'distribute', ids: some(), axis: rng.pick(['horizontal', 'vertical'] as const) };
      case 8:
        return { type: 'convertToPath', ids: some() };
      case 9:
        return { type: 'combine', ids: some() };
      case 10:
        return { type: 'separate', ids: some() };
      case 11:
        return { type: 'updateShapes', ids: some(), patch: { fill: rng.pick(['none', '#ff0000', 'brand:emerald']), locked: rng.next() < 0.2 } };
      case 12:
        return { type: 'select', ids: some(), additive: rng.bool() };
      case 13:
        return { type: 'selectAll' };
      case 14:
        return { type: 'setSize', size: rng.pick([16, 24, 32, 48]), scale: rng.bool() };
      case 15:
        return { type: 'setMeta', patch: { name: rng.pick(['A', 'B', 'C']) } };
      case 16:
        return { type: 'undo' };
      default:
        return { type: 'redo' };
    }
  }

  it('bất biến sau mọi chuỗi thao tác ngẫu nhiên: mã lớp duy nhất, vùng chọn hợp lệ, hình học hữu hạn', () => {
    const rng = random(2026);
    for (let run = 0; run < 60; run += 1) {
      const counter = { value: 100 };
      let state = createEditorState(createDocument({ id: 'fuzz', shapes: Array.from({ length: rng.int(0, 5) }, (_, index) => makeShape(rng, index)) }));
      for (let step = 0; step < 60; step += 1) {
        state = editorReducer(state, randomAction(rng, state, counter));
        const ids = state.doc.shapes.map((shape) => shape.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(state.selection.every((id) => ids.includes(id))).toBe(true);
        expect(new Set(state.selection).size).toBe(state.selection.length);
        expect(state.past.length).toBeLessThanOrEqual(100);
        expect(JSON.stringify(state.doc)).not.toMatch(/null|NaN|Infinity/);
      }
    }
  });

  it('hoàn tác hết rồi làm lại hết về đúng tài liệu cuối', () => {
    const rng = random(77);
    for (let run = 0; run < 60; run += 1) {
      const counter = { value: 100 };
      const initial = createDocument({ id: 'fuzz', shapes: Array.from({ length: rng.int(1, 5) }, (_, index) => makeShape(rng, index)) });
      let state = createEditorState(initial);
      for (let step = 0; step < 40; step += 1) {
        const action = randomAction(rng, state, counter);
        if (action.type === 'undo' || action.type === 'redo') continue;
        state = editorReducer(state, action);
      }
      const final = JSON.stringify(state.doc);
      while (state.past.length > 0) state = editorReducer(state, { type: 'undo' });
      expect(JSON.stringify(state.doc)).toBe(JSON.stringify(initial));
      while (state.future.length > 0) state = editorReducer(state, { type: 'redo' });
      expect(JSON.stringify(state.doc)).toBe(final);
    }
  });

  it('nhiều thay đổi trong một lần kéo luôn thành đúng một bước hoàn tác', () => {
    const rng = random(8);
    for (let run = 0; run < 40; run += 1) {
      const counter = { value: 100 };
      const initial = createDocument({ id: 'fuzz', shapes: Array.from({ length: 4 }, (_, index) => makeShape(rng, index)) });
      let state = createEditorState(initial);
      state = editorReducer(state, { type: 'gestureStart' });
      for (let step = 0; step < 15; step += 1) {
        const action = randomAction(rng, state, counter);
        if (action.type === 'undo' || action.type === 'redo') continue;
        state = editorReducer(state, action);
      }
      state = editorReducer(state, { type: 'gestureEnd' });
      expect(state.past.length).toBeLessThanOrEqual(1);
      state = editorReducer(state, { type: 'undo' });
      expect(JSON.stringify(state.doc)).toBe(JSON.stringify(initial));
    }
  });
});
