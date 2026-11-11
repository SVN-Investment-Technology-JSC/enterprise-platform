import { DEFAULT_PALETTE, MAX_GRADIENT_STOPS, parseGradient as parseOrNull } from '@enterprise-platform/shared-brand-icon';
import {
  addGradientStop,
  describePaint,
  gradientCss,
  gradientStripCss,
  removeGradientStop,
  setGradientAngle,
  setStopColor,
  setStopOffset,
  setStopOpacity,
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

describe('gradientCss với gradient mở rộng', () => {
  it('tuyến tính có t0, t1 đặt vị trí điểm màu theo khoảng đó; kiểu lặp dùng repeating', () => {
    expect(gradientCss(parseGradient('linear:0,0.25,0.75:#ff0000@0,#0000ff@1'), DEFAULT_PALETTE)).toBe('linear-gradient(90deg, #ff0000 25%, #0000ff 75%)');
    expect(gradientCss(parseGradient('linear:0,0.25,0.75,repeat:#ff0000@0,#0000ff@1'), DEFAULT_PALETTE)).toContain('repeating-linear-gradient(');
  });

  it('điểm màu có độ đặc thành rgba', () => {
    expect(gradientCss(parseGradient('linear:0:#ff0000@0~0.5,#0000ff@1'), DEFAULT_PALETTE)).toBe('linear-gradient(90deg, rgba(255, 0, 0, 0.5) 0%, #0000ff 100%)');
  });

  it('hướng tâm thành radial-gradient hình tròn', () => {
    const radial = parseGradient('radial:0.5,0.5,0.5,0.5,0.5,1,0,0,1,0,0:#ffffff@0,#000000@1');
    expect(gradientCss(radial, DEFAULT_PALETTE)).toBe('radial-gradient(circle closest-side at 50% 50%, #ffffff 0%, #000000 100%)');
  });

  it('thanh xem trước điểm màu luôn là dải ngang đủ 0..100%', () => {
    expect(gradientStripCss(parseGradient('linear:300,0.25,0.75,repeat:#ff0000@0,#0000ff@1'), DEFAULT_PALETTE)).toBe('linear-gradient(90deg, #ff0000 0%, #0000ff 100%)');
    expect(gradientStripCss(parseGradient('radial:0.5,0.5,0.5,0.5,0.5,1,0,0,1,0,0:#ffffff@0,#000000@1'), DEFAULT_PALETTE)).toBe('linear-gradient(90deg, #ffffff 0%, #000000 100%)');
  });
});

describe('sửa gradient hướng tâm và độ đặc', () => {
  const RADIAL = 'radial:0.5,0.5,0.5,0.5,0.5,1,0,0,1,0,0:#ffffff@0,#000000@1';

  it('đổi góc không tác dụng với dải hướng tâm; đổi màu và vị trí điểm màu giữ nguyên tâm, bán kính, ma trận', () => {
    expect(setGradientAngle(RADIAL, 90)).toBe(RADIAL);
    expect(setStopColor(RADIAL, 0, '#ff0000')).toBe('radial:0.5,0.5,0.5,0.5,0.5,1,0,0,1,0,0:#ff0000@0,#000000@1');
    expect(setStopOffset(RADIAL, 1, 0.5)).toBe('radial:0.5,0.5,0.5,0.5,0.5,1,0,0,1,0,0:#ffffff@0,#000000@0.5');
  });

  it('setStopOpacity đặt, kẹp và bỏ độ đặc (bằng 1 là không ghi)', () => {
    expect(setStopOpacity(BASE, 0, 0.4)).toBe('linear:45:#ff0000@0~0.4,#0000ff@1');
    expect(setStopOpacity('linear:45:#ff0000@0~0.4,#0000ff@1', 0, 1)).toBe(BASE);
    expect(setStopOpacity(BASE, 1, -3)).toBe('linear:45:#ff0000@0,#0000ff@1~0');
    expect(setStopOpacity(BASE, 7, 0.5)).toBe(BASE);
    expect(setStopOpacity(BASE, 0, Number.NaN)).toBe(BASE);
  });

  it('giữ t0, t1 và kiểu trải khi sửa góc và điểm màu của dải tuyến tính', () => {
    const source = 'linear:45,0.25,0.75,repeat:#ff0000@0,#0000ff@1';
    expect(setGradientAngle(source, 90)).toBe('linear:90,0.25,0.75,repeat:#ff0000@0,#0000ff@1');
    expect(setStopColor(source, 1, '#00ff00')).toBe('linear:45,0.25,0.75,repeat:#ff0000@0,#00ff00@1');
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

  it('addGradientStop dừng ở số điểm màu tối đa và với paint không phải gradient', () => {
    const stops = Array.from({ length: MAX_GRADIENT_STOPS }, (_, index) => `#0000${index.toString(16).padStart(2, '0')}@${index / (MAX_GRADIENT_STOPS - 1)}`);
    const full = `linear:0:${stops.join(',')}`;
    expect(parseGradient(full).stops).toHaveLength(MAX_GRADIENT_STOPS);
    expect(addGradientStop(full, DEFAULT_PALETTE)).toBeNull();
    expect(addGradientStop('#ffffff', DEFAULT_PALETTE)).toBeNull();
  });

  it('addGradientStop giữ nguyên loại dải và lấy độ đặc trung bình của hai điểm kề', () => {
    const radial = 'radial:0.5,0.5,0.5,0.5,0.5,1,0,0,1,0,0,reflect:#ff0000@0~0.2,#0000ff@1';
    const added = addStop(radial);
    const gradient = parseGradient(added.paint);
    expect(gradient).toMatchObject({ kind: 'radial', spread: 'reflect' });
    expect(gradient.stops[1].opacity).toBeCloseTo(0.6, 5);
  });

  it('removeGradientStop giữ tối thiểu 2 điểm màu', () => {
    expect(removeGradientStop(THREE, 1)).toBe('linear:90:#ff0000@0,#0000ff@1');
    expect(removeGradientStop(BASE, 0)).toBe(BASE);
    expect(removeGradientStop(THREE, 7)).toBe(THREE);
  });
});
