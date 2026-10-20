import { MAX_ZOOM, MIN_ZOOM, clampZoom, docToScreen, fitViewport, screenToDoc, zoomAt, type Viewport } from './viewport.js';

const view: Viewport = { zoom: 20, panX: 100, panY: 50 };

describe('chuyển toạ độ', () => {
  it('screenToDoc và docToScreen là hai phép nghịch đảo', () => {
    const point = { x: 7.25, y: -3.5 };
    const back = screenToDoc(view, docToScreen(view, point));
    expect(back.x).toBeCloseTo(point.x);
    expect(back.y).toBeCloseTo(point.y);
  });

  it('gốc lưới nằm tại panX, panY và một đơn vị bằng zoom pixel', () => {
    expect(docToScreen(view, { x: 0, y: 0 })).toEqual({ x: 100, y: 50 });
    expect(docToScreen(view, { x: 1, y: 2 })).toEqual({ x: 120, y: 90 });
    expect(screenToDoc(view, { x: 140, y: 70 })).toEqual({ x: 2, y: 1 });
  });
});

describe('clampZoom', () => {
  it('kẹp trong khoảng cho phép', () => {
    expect(clampZoom(1)).toBe(MIN_ZOOM);
    expect(clampZoom(10_000)).toBe(MAX_ZOOM);
    expect(clampZoom(30)).toBe(30);
    expect(MIN_ZOOM).toBeLessThan(MAX_ZOOM);
  });
});

describe('zoomAt', () => {
  it('điểm dưới con trỏ giữ nguyên vị trí sau khi phóng to hoặc thu nhỏ', () => {
    const anchor = { x: 230, y: 160 };
    for (const factor of [1.2, 0.8, 2, 0.5]) {
      const before = screenToDoc(view, anchor);
      const next = zoomAt(view, factor, anchor);
      const after = screenToDoc(next, anchor);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
      expect(next.zoom).toBeCloseTo(view.zoom * factor);
    }
  });

  it('bị kẹp ở giới hạn zoom nhưng điểm neo vẫn đứng yên', () => {
    const anchor = { x: 230, y: 160 };
    const big = zoomAt(view, 1000, anchor);
    expect(big.zoom).toBe(MAX_ZOOM);
    const before = screenToDoc(view, anchor);
    const after = screenToDoc(big, anchor);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(zoomAt(view, 0.0001, anchor).zoom).toBe(MIN_ZOOM);
  });

  it('đã ở giới hạn thì không dịch khung nhìn', () => {
    const maxed: Viewport = { zoom: MAX_ZOOM, panX: 10, panY: 20 };
    expect(zoomAt(maxed, 2, { x: 300, y: 300 })).toEqual(maxed);
  });

  it('không làm thay đổi khung nhìn cũ', () => {
    const snapshot = { ...view };
    zoomAt(view, 2, { x: 1, y: 1 });
    expect(view).toEqual(snapshot);
  });
});

describe('fitViewport', () => {
  it('vừa khít lưới vào vùng, căn giữa, chừa lề', () => {
    const fitted = fitViewport(24, 600, 400);
    // chiều cao hạn chế: (400 - 48) / 24
    expect(fitted.zoom).toBeCloseTo(352 / 24);
    expect(fitted.panX).toBeCloseTo((600 - 24 * fitted.zoom) / 2);
    expect(fitted.panY).toBeCloseTo((400 - 24 * fitted.zoom) / 2);
    const topLeft = docToScreen(fitted, { x: 0, y: 0 });
    const bottomRight = docToScreen(fitted, { x: 24, y: 24 });
    expect(topLeft.y).toBeCloseTo(24);
    expect(bottomRight.y).toBeCloseTo(376);
    expect((topLeft.x + bottomRight.x) / 2).toBeCloseTo(300);
  });

  it('lề tuỳ chỉnh', () => {
    const fitted = fitViewport(24, 400, 400, 0);
    expect(fitted.zoom).toBeCloseTo(400 / 24);
    expect(fitted.panX).toBeCloseTo(0);
  });

  it('vùng quá nhỏ hoặc âm thì dùng zoom tối thiểu, không ra số vô hạn', () => {
    const tiny = fitViewport(24, 10, 10);
    expect(tiny.zoom).toBe(MIN_ZOOM);
    expect(Number.isFinite(tiny.panX)).toBe(true);
    expect(fitViewport(24, 0, 0).zoom).toBe(MIN_ZOOM);
  });

  it('vùng rất lớn thì dùng zoom tối đa', () => {
    expect(fitViewport(8, 100_000, 100_000).zoom).toBe(MAX_ZOOM);
  });

  it('lưới lớn hơn thì zoom nhỏ hơn', () => {
    expect(fitViewport(48, 600, 600).zoom).toBeLessThan(fitViewport(24, 600, 600).zoom);
  });
});
