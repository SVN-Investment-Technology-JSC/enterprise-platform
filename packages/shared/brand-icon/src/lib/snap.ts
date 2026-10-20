import type { Point, Rect } from './model';

/** Làm tròn tới bội gần nhất của `step`; bỏ nhiễu dấu phẩy động (0,1 x 3 ra 0,3 chứ không phải 0,30000000000000004) và không trả -0. */
export const snapToStep = (value: number, step: number): number => {
  if (!(step > 0)) return value;
  const snapped = Math.round((Math.round(value / step) * step) * 1e9) / 1e9;
  return snapped === 0 ? 0 : snapped;
};

export const snapPointToStep = (point: Point, step: number): Point => ({
  x: snapToStep(point.x, step),
  y: snapToStep(point.y, step),
});

export interface Guide {
  readonly axis: 'x' | 'y';
  readonly value: number;
}

export interface SnapResult {
  readonly dx: number;
  readonly dy: number;
  readonly guides: readonly Guide[];
}

export interface SnapOptions {
  /** Bước lưới; 0 hoặc nhỏ hơn thì tắt bắt dính lưới. */
  readonly step: number;
  /** Ngưỡng bắt dính vào cạnh/tâm của hình khác, tính theo đơn vị lưới. */
  readonly threshold: number;
  /** Bắt dính vào cạnh và tâm của hình khác cùng cạnh/tâm của khung vẽ. */
  readonly objects: boolean;
}

function bestOffset(candidates: readonly number[], targets: readonly number[], threshold: number): { offset: number; target: number } | null {
  let best: { offset: number; target: number } | null = null;
  for (const candidate of candidates) {
    for (const target of targets) {
      const offset = target - candidate;
      if (Math.abs(offset) <= threshold && (!best || Math.abs(offset) < Math.abs(best.offset))) best = { offset, target };
    }
  }
  return best;
}

/**
 * Tính độ dịch cần cộng thêm để hình đang kéo bắt dính vào hình khác (cạnh trái/giữa/phải, trên/giữa/dưới), vào khung vẽ,
 * hoặc vào lưới. Cạnh/tâm hình khác được ưu tiên; không có thì bắt dính góc trên trái vào lưới.
 */
export function snapMovingRect(moving: Rect, others: readonly Rect[], canvasSize: number, options: SnapOptions): SnapResult {
  const xs: number[] = [];
  const ys: number[] = [];
  if (options.objects) {
    const frames: Rect[] = [...others, { x: 0, y: 0, width: canvasSize, height: canvasSize }];
    for (const frame of frames) {
      xs.push(frame.x, frame.x + frame.width / 2, frame.x + frame.width);
      ys.push(frame.y, frame.y + frame.height / 2, frame.y + frame.height);
    }
  }

  const movingXs = [moving.x, moving.x + moving.width / 2, moving.x + moving.width];
  const movingYs = [moving.y, moving.y + moving.height / 2, moving.y + moving.height];
  const bestX = options.objects ? bestOffset(movingXs, xs, options.threshold) : null;
  const bestY = options.objects ? bestOffset(movingYs, ys, options.threshold) : null;

  const guides: Guide[] = [];
  let dx = 0;
  let dy = 0;
  if (bestX) {
    dx = bestX.offset;
    guides.push({ axis: 'x', value: bestX.target });
  } else if (options.step > 0) {
    dx = snapToStep(moving.x, options.step) - moving.x;
  }
  if (bestY) {
    dy = bestY.offset;
    guides.push({ axis: 'y', value: bestY.target });
  } else if (options.step > 0) {
    dy = snapToStep(moving.y, options.step) - moving.y;
  }
  return { dx, dy, guides };
}
