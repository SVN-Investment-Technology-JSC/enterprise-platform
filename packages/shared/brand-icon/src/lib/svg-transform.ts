import { IDENTITY, multiply, rotation, scaling, translation, type Matrix } from './geometry';
import { parseLength } from './svg-length';

const TOKEN = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?[a-zA-Z%]*/g;
const FUNCTION = /(matrix|translatex|translatey|translate|scalex|scaley|scale|rotate|skewx|skewy|skew)\s*\(([^)]*)\)/gi;

const ANGLE_UNITS: Record<string, number> = { '': 1, deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360 };

interface Args {
  readonly raw: string[];
  /** Có tham số nào không đọc được hoặc dùng phần trăm (không đổi được khi chưa biết khung). */
  bad: boolean;
}

const split = (text: string): Args => ({ raw: text.match(TOKEN) ?? [], bad: false });

function plain(args: Args, index: number, fallback: number): number {
  const raw = args.raw[index];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (Number.isFinite(value)) return value;
  const length = parseLength(raw, { fontSize: 16, percentBase: 0 });
  if (length === null || raw.endsWith('%')) {
    args.bad = true;
    return fallback;
  }
  return length;
}

function angle(args: Args, index: number, fallback: number): number {
  const raw = args.raw[index];
  if (raw === undefined) return fallback;
  const match = /^([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)([a-zA-Z]*)$/.exec(raw);
  const factor = match ? ANGLE_UNITS[match[2].toLowerCase()] : undefined;
  if (!match || factor === undefined) {
    args.bad = true;
    return fallback;
  }
  return Number(match[1]) * factor;
}

const tangent = (degrees: number) => Math.tan((degrees * Math.PI) / 180);

/**
 * Đọc `transform` của SVG hoặc CSS: `matrix`, `translate(X|Y)`, `scale(X|Y)`, `rotate`, `skew(X|Y)`; góc có đơn vị
 * `deg`/`rad`/`grad`/`turn`, độ dài có đơn vị px/pt/mm... Trả về ma trận gộp và cờ `bad` khi gặp tham số không đọc được
 * (ví dụ phần trăm trong `translate`, cần biết khung của phần tử).
 */
export function parseTransformList(value: string | null | undefined): { matrix: Matrix; bad: boolean } {
  if (!value) return { matrix: IDENTITY, bad: false };
  let result: Matrix = IDENTITY;
  let bad = false;
  for (const match of value.matchAll(FUNCTION)) {
    const name = match[1].toLowerCase();
    const args = split(match[2]);
    let next: Matrix = IDENTITY;
    switch (name) {
      case 'matrix':
        if (args.raw.length === 6) next = args.raw.map((_, index) => plain(args, index, 0)) as unknown as Matrix;
        else args.bad = true;
        break;
      case 'translate':
        next = translation(plain(args, 0, 0), plain(args, 1, 0));
        break;
      case 'translatex':
        next = translation(plain(args, 0, 0), 0);
        break;
      case 'translatey':
        next = translation(0, plain(args, 0, 0));
        break;
      case 'scale': {
        const sx = plain(args, 0, 1);
        next = scaling(sx, plain(args, 1, sx));
        break;
      }
      case 'scalex':
        next = scaling(plain(args, 0, 1), 1);
        break;
      case 'scaley':
        next = scaling(1, plain(args, 0, 1));
        break;
      case 'rotate':
        next = rotation(angle(args, 0, 0), plain(args, 1, 0), plain(args, 2, 0));
        break;
      case 'skewx':
        next = [1, 0, tangent(angle(args, 0, 0)), 1, 0, 0];
        break;
      case 'skewy':
        next = [1, tangent(angle(args, 0, 0)), 0, 1, 0, 0];
        break;
      default:
        next = [1, tangent(angle(args, 1, 0)), tangent(angle(args, 0, 0)), 1, 0, 0];
    }
    if (args.bad) bad = true;
    result = multiply(result, next);
  }
  return { matrix: result, bad };
}

/** Giữ tên cũ: ma trận của một chuỗi `transform`. */
export function parseTransform(value: string | null | undefined): Matrix {
  return parseTransformList(value).matrix;
}
