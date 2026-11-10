import { DEFAULT_PALETTE, parseGradient as parseOrNull } from '@enterprise-platform/shared-brand-icon';
import {
  addGradientStop,
  describePaint,
  gradientCss,
  removeGradientStop,
  setGradientAngle,
  setStopColor,
  setStopOffset,
  toGradient,
} from './paint-model';

const parseGradient = (paint: string) => {
  const gradient = parseOrNull(paint);
  if (!gradient) throw new Error('Gradient không hợp lệ: ' + paint);
  return gradient;
};
const addStop = (paint: string) => {
  const result = addGradientStop(paint, DEFAULT_PALETTE);
  if (!result) throw new Error('Không thêm được điểm màu: ' + paint);
  return result;
};

const BASE = 'linear:45:#ff0000@0,#0000ff@1';
const THREE = 'linear:90:#ff0000@0,#00ff00@0.4,#0000ff@1';

describe('describePaint với gradient', () => {
  it('nhận ra gradient hợp lệ, kèm dữ liệu để vẽ', () => {
    const described = describePaint(BASE, DEFAULT_PALETTE);
    expect(described).toMatchObject({ kind: 'gradient', label: 'Chuyển sắc', hex: null });
    expect(described.gradient?.stops).toHaveLength(2);
  });

  it('gradient hỏng không làm vỡ giao diện', () => {
    expect(describePaint('linear:hỏng', DEFAULT_PALETTE)).toMatchObject({ kind: 'custom', hex: null });
  });
});

describe('gradientCss', () => {
  it('đổi góc Studio sang góc CSS và màu thương hiệu sang hex', () => {
    const gradient = parseGradient('linear:0:brand:sapphire@0,#ffffff@0.5');
    expect(gradientCss(gradient, DEFAULT_PALETTE)).toBe('linear-gradient(90deg, #2563eb 0%, #ffffff 50%)');
    expect(gradientCss(parseGradient(BASE), DEFAULT_PALETTE)).toBe('linear-gradient(135deg, #ff0000 0%, #0000ff 100%)');
    expect(gradientCss(parseGradient('linear:300:#000000@0,#ffffff@1'), DEFAULT_PALETTE)).toContain('linear-gradient(30deg');
  });
});

describe('toGradient', () => {
  it('từ màu thương hiệu: giữ màu đó ở điểm đầu, điểm cuối là bản đậm hơn', () => {
    const gradient = parseGradient(toGradient('brand:sapphire', DEFAULT_PALETTE));
    expect(gradient.angle).toBe(45);
    expect(gradient.stops[0]).toEqual({ color: 'brand:sapphire', offset: 0 });
    expect(gradient.stops[1].color).toMatch(/^#[0-9a-f]{6}$/);
    expect(gradient.stops[1].color).not.toBe('#2563eb');
  });

  it('từ hex tuỳ ý', () => {
    expect(parseGradient(toGradient('#ff8800', DEFAULT_PALETTE))?.stops[0].color).toBe('#ff8800');
  });

  it('không màu, theo chữ hoặc màu hỏng: bắt đầu từ màu đầu bảng', () => {
    for (const paint of ['none', 'currentColor', 'brand:khong-co-that'.replace('khong-co-that', 'x'), '']) {
      const first = parseGradient(toGradient(paint, DEFAULT_PALETTE))?.stops[0].color;
      expect(first).toBeTruthy();
    }
    expect(parseGradient(toGradient('none', DEFAULT_PALETTE))?.stops[0].color).toBe('brand:sapphire');
  });

  it('đã là gradient hợp lệ thì giữ nguyên', () => {
    expect(toGradient(BASE, DEFAULT_PALETTE)).toBe(BASE);
  });
});

describe('sửa gradient', () => {
  it('setGradientAngle đưa góc về 0..360 và bỏ qua giá trị không phải số', () => {
    expect(setGradientAngle(BASE, 90)).toBe('linear:90:#ff0000@0,#0000ff@1');
    expect(setGradientAngle(BASE, -45)).toBe('linear:315:#ff0000@0,#0000ff@1');
    expect(setGradientAngle(BASE, Number.NaN)).toBe(BASE);
    expect(setGradientAngle('#ffffff', 90)).toBe('#ffffff');
  });

  it('setStopColor đổi đúng điểm, nhận cả màu thương hiệu, bỏ qua chỉ số sai', () => {
    expect(setStopColor(BASE, 1, '#00ff00')).toBe('linear:45:#ff0000@0,#00ff00@1');
    expect(setStopColor(BASE, 0, 'brand:navy')).toBe('linear:45:brand:navy@0,#0000ff@1');
    expect(setStopColor(BASE, 5, '#00ff00')).toBe(BASE);
    expect(setStopColor(BASE, -1, '#00ff00')).toBe(BASE);
    expect(setStopColor(BASE, 0, 'rác')).toBe(BASE);
  });

  it('setStopOffset kẹp giữa hai điểm kề để thứ tự không đổi', () => {
    expect(setStopOffset(THREE, 1, 0.7)).toBe('linear:90:#ff0000@0,#00ff00@0.7,#0000ff@1');
    expect(setStopOffset(THREE, 1, 5)).toBe('linear:90:#ff0000@0,#00ff00@1,#0000ff@1');
    expect(setStopOffset(THREE, 1, -5)).toBe('linear:90:#ff0000@0,#00ff00@0,#0000ff@1');
    expect(setStopOffset(THREE, 0, 0.9)).toBe('linear:90:#ff0000@0.4,#00ff00@0.4,#0000ff@1');
    expect(setStopOffset(THREE, 9, 0.5)).toBe(THREE);
    expect(setStopOffset(THREE, 1, Number.NaN)).toBe(THREE);
  });

  it('addGradientStop thêm vào khoảng trống rộng nhất với màu nội suy, trả chỉ số điểm mới', () => {
    const added = addStop(BASE);
    expect(added.index).toBe(1);
    expect(added.paint).toBe('linear:45:#ff0000@0,#800080@0.5,#0000ff@1');

    const wide = addStop(THREE);
    expect(wide.index).toBe(2);
    expect(parseGradient(wide.paint)?.stops.map((stop) => stop.offset)).toEqual([0, 0.4, 0.7, 1]);
  });

  it('addGradientStop dùng màu thật khi điểm màu theo bảng màu thương hiệu', () => {
    const added = addStop('linear:0:brand:sapphire@0,#ffffff@1');
    expect(parseGradient(added.paint)?.stops[1].color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('addGradientStop dừng ở 8 điểm màu và với paint không phải gradient', () => {
    const eight = `linear:0:${Array.from({ length: 8 }, (_, index) => `#00000${index}@${index / 7}`).join(',')}`;
    expect(parseGradient(eight)?.stops).toHaveLength(8);
    expect(addGradientStop(eight, DEFAULT_PALETTE)).toBeNull();
    expect(addGradientStop('#ffffff', DEFAULT_PALETTE)).toBeNull();
  });

  it('removeGradientStop giữ tối thiểu 2 điểm màu', () => {
    expect(removeGradientStop(THREE, 1)).toBe('linear:90:#ff0000@0,#0000ff@1');
    expect(removeGradientStop(BASE, 0)).toBe(BASE);
    expect(removeGradientStop(THREE, 7)).toBe(THREE);
  });
});
