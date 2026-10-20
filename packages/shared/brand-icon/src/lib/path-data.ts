import { roundTo, type PathGeometry, type PathNode, type Point, type Subpath } from './model.js';

const EPSILON = 1e-6;
const NUMBER = /\s*,?\s*([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/y;
const FLAG = /\s*,?\s*([01])/y;
const COMMANDS = 'MmLlHhVvCcSsQqTtAaZz';
const ARGUMENT_COUNT: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

interface MutableNode {
  x: number;
  y: number;
  hin?: Point;
  hout?: Point;
}

interface MutableSubpath {
  nodes: MutableNode[];
  closed: boolean;
}

const near = (a: Point, b: Point) => Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;

export function formatNumber(value: number): string {
  const rounded = roundTo(value, 3);
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/**
 * Đổi cung elip SVG (dạng điểm cuối) thành các đoạn Bezier bậc ba, mỗi đoạn tối đa 90 độ.
 */
function arcToCubics(
  from: Point,
  rxIn: number,
  ryIn: number,
  rotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  to: Point,
): Array<{ c1: Point; c2: Point; to: Point; line?: true }> {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx < EPSILON || ry < EPSILON || near(from, to)) return [{ c1: from, c2: to, to, line: true }];

  const phi = (rotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }

  const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const factor = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator));
  const cxp = (factor * rx * y1p) / ry;
  const cyp = (-factor * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (from.x + to.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (from.y + to.y) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const sign = ux * vy - uy * vx < 0 ? -1 : 1;
    const dot = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
    return sign * Math.acos(Math.min(1, Math.max(-1, dot)));
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / segments;
  const t = (4 / 3) * Math.tan(step / 4);
  const result: Array<{ c1: Point; c2: Point; to: Point }> = [];

  const pointAt = (a: number, ox: number, oy: number): Point => {
    const cosA = Math.cos(a);
    const sinA = Math.sin(a);
    return {
      x: cx + cosPhi * rx * (cosA + ox) - sinPhi * ry * (sinA + oy),
      y: cy + sinPhi * rx * (cosA + ox) + cosPhi * ry * (sinA + oy),
    };
  };

  for (let index = 0; index < segments; index += 1) {
    const a1 = theta1 + index * step;
    const a2 = a1 + step;
    const end = index === segments - 1 ? to : pointAt(a2, 0, 0);
    result.push({
      c1: pointAt(a1, -t * Math.sin(a1), t * Math.cos(a1)),
      c2: pointAt(a2, t * Math.sin(a2), -t * Math.cos(a2)),
      to: end,
    });
  }
  return result;
}

function tokenize(data: string): Array<{ command: string; args: number[] }> {
  const result: Array<{ command: string; args: number[] }> = [];
  let index = 0;
  const length = data.length;

  const skipSpace = () => {
    while (index < length && /[\s,]/.test(data[index])) index += 1;
  };

  while (true) {
    skipSpace();
    if (index >= length) break;
    const command = data[index];
    if (!COMMANDS.includes(command)) throw new Error(`Lệnh path không hợp lệ: "${command}"`);
    index += 1;
    const lower = command.toLowerCase();
    const count = ARGUMENT_COUNT[lower];
    if (count === 0) {
      result.push({ command, args: [] });
      continue;
    }

    let repeat = 0;
    while (true) {
      skipSpace();
      if (index >= length || COMMANDS.includes(data[index])) break;
      const args: number[] = [];
      for (let position = 0; position < count; position += 1) {
        const isFlag = lower === 'a' && (position === 3 || position === 4);
        const pattern = isFlag ? FLAG : NUMBER;
        pattern.lastIndex = index;
        const match = pattern.exec(data);
        if (!match) throw new Error('Số liệu path không hợp lệ.');
        args.push(Number(match[1]));
        index = pattern.lastIndex;
      }
      // Lệnh lặp ngầm: sau M là L, sau m là l
      const effective = repeat > 0 && lower === 'm' ? (command === 'm' ? 'l' : 'L') : command;
      result.push({ command: effective, args });
      repeat += 1;
    }
    if (repeat === 0) throw new Error(`Thiếu tham số cho lệnh "${command}".`);
  }
  return result;
}

function finalizeSubpath(sub: MutableSubpath): Subpath | null {
  const nodes = sub.nodes;
  if (nodes.length === 0) return null;
  if (sub.closed && nodes.length > 1 && near(nodes[0], nodes[nodes.length - 1])) {
    const last = nodes.pop() as MutableNode;
    if (last.hin) nodes[0].hin = last.hin;
  }
  const clean: PathNode[] = nodes.map((node) => ({
    x: node.x,
    y: node.y,
    ...(node.hin && !near(node.hin, node) ? { hin: node.hin } : {}),
    ...(node.hout && !near(node.hout, node) ? { hout: node.hout } : {}),
  }));
  return { nodes: clean, closed: sub.closed };
}

/**
 * Đọc chuỗi `d` của SVG thành các đường con gồm điểm neo và tay cầm Bezier.
 * Hỗ trợ đủ lệnh M L H V C S Q T A Z, viết hoa lẫn viết thường.
 */
export function parsePathData(data: string): PathGeometry {
  const subpaths: Subpath[] = [];
  let current = null as MutableSubpath | null;
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  let lastCubicControl = null as Point | null;
  let lastQuadControl = null as Point | null;

  const flush = () => {
    if (!current) return;
    const done = finalizeSubpath(current);
    if (done) subpaths.push(done);
    current = null;
  };

  const ensureSubpath = (): MutableSubpath => {
    if (!current) {
      current = { nodes: [{ x: cx, y: cy }], closed: false };
      startX = cx;
      startY = cy;
    }
    return current;
  };

  const lineTo = (x: number, y: number) => {
    ensureSubpath().nodes.push({ x, y });
    cx = x;
    cy = y;
  };

  const cubicTo = (c1: Point, c2: Point, x: number, y: number) => {
    const sub = ensureSubpath();
    sub.nodes[sub.nodes.length - 1].hout = c1;
    sub.nodes.push({ x, y, hin: c2 });
    cx = x;
    cy = y;
    lastCubicControl = c2;
  };

  for (const { command, args } of tokenize(data.trim())) {
    const relative = command === command.toLowerCase();
    const type = command.toLowerCase();
    const ox = relative ? cx : 0;
    const oy = relative ? cy : 0;
    const keepCubic = type === 's' || type === 'c';
    const keepQuad = type === 'q' || type === 't';
    const previousCubic = lastCubicControl;
    const previousQuad = lastQuadControl;
    if (!keepCubic) lastCubicControl = null;
    if (!keepQuad) lastQuadControl = null;

    switch (type) {
      case 'm': {
        flush();
        cx = args[0] + ox;
        cy = args[1] + oy;
        startX = cx;
        startY = cy;
        current = { nodes: [{ x: cx, y: cy }], closed: false };
        break;
      }
      case 'l':
        lineTo(args[0] + ox, args[1] + oy);
        break;
      case 'h':
        lineTo(args[0] + ox, cy);
        break;
      case 'v':
        lineTo(cx, args[0] + oy);
        break;
      case 'c':
        cubicTo(
          { x: args[0] + ox, y: args[1] + oy },
          { x: args[2] + ox, y: args[3] + oy },
          args[4] + ox,
          args[5] + oy,
        );
        break;
      case 's': {
        const c1 = previousCubic ? { x: 2 * cx - previousCubic.x, y: 2 * cy - previousCubic.y } : { x: cx, y: cy };
        cubicTo(c1, { x: args[0] + ox, y: args[1] + oy }, args[2] + ox, args[3] + oy);
        break;
      }
      case 'q': {
        const q = { x: args[0] + ox, y: args[1] + oy };
        const to = { x: args[2] + ox, y: args[3] + oy };
        cubicTo(
          { x: cx + (2 / 3) * (q.x - cx), y: cy + (2 / 3) * (q.y - cy) },
          { x: to.x + (2 / 3) * (q.x - to.x), y: to.y + (2 / 3) * (q.y - to.y) },
          to.x,
          to.y,
        );
        lastCubicControl = null;
        lastQuadControl = q;
        break;
      }
      case 't': {
        const q = previousQuad ? { x: 2 * cx - previousQuad.x, y: 2 * cy - previousQuad.y } : { x: cx, y: cy };
        const to = { x: args[0] + ox, y: args[1] + oy };
        cubicTo(
          { x: cx + (2 / 3) * (q.x - cx), y: cy + (2 / 3) * (q.y - cy) },
          { x: to.x + (2 / 3) * (q.x - to.x), y: to.y + (2 / 3) * (q.y - to.y) },
          to.x,
          to.y,
        );
        lastCubicControl = null;
        lastQuadControl = q;
        break;
      }
      case 'a': {
        const to = { x: args[5] + ox, y: args[6] + oy };
        for (const segment of arcToCubics({ x: cx, y: cy }, args[0], args[1], args[2], args[3] === 1, args[4] === 1, to)) {
          if (segment.line) lineTo(segment.to.x, segment.to.y);
          else cubicTo(segment.c1, segment.c2, segment.to.x, segment.to.y);
        }
        lastCubicControl = null;
        break;
      }
      case 'z': {
        if (current) {
          (current as MutableSubpath).closed = true;
          flush();
        }
        cx = startX;
        cy = startY;
        break;
      }
      default:
        break;
    }
  }
  flush();
  return { type: 'path', subpaths };
}

function nodeToSegment(from: PathNode, to: PathNode): string {
  if (from.hout || to.hin) {
    const c1 = from.hout ?? from;
    const c2 = to.hin ?? to;
    return `C ${formatNumber(c1.x)} ${formatNumber(c1.y)} ${formatNumber(c2.x)} ${formatNumber(c2.y)} ${formatNumber(to.x)} ${formatNumber(to.y)}`;
  }
  return `L ${formatNumber(to.x)} ${formatNumber(to.y)}`;
}

export function subpathToData(sub: Subpath): string {
  const nodes = sub.nodes;
  if (nodes.length === 0) return '';
  const parts = [`M ${formatNumber(nodes[0].x)} ${formatNumber(nodes[0].y)}`];
  for (let index = 1; index < nodes.length; index += 1) parts.push(nodeToSegment(nodes[index - 1], nodes[index]));
  if (sub.closed) {
    const last = nodes[nodes.length - 1];
    const first = nodes[0];
    if (nodes.length > 1 && (last.hout || first.hin)) parts.push(nodeToSegment(last, first));
    parts.push('Z');
  }
  return parts.join(' ');
}

export function pathToData(geometry: PathGeometry): string {
  return geometry.subpaths.map(subpathToData).filter(Boolean).join(' ');
}

/** Chuỗi `d` hợp lệ: bắt đầu bằng M, chỉ gồm lệnh, số, dấu cách và dấu phẩy; có giới hạn độ dài. */
export const MAX_PATH_DATA_LENGTH = 20000;
const PATH_DATA_PATTERN = /^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-.,\s]*$/;

export function isValidPathData(data: string | undefined): boolean {
  if (data === undefined) return true;
  const trimmed = data.trim();
  if (trimmed === '') return true;
  return trimmed.length <= MAX_PATH_DATA_LENGTH && PATH_DATA_PATTERN.test(trimmed) && /^[Mm]/.test(trimmed);
}
