import { snapMovingRect, snapPointToStep, snapToStep, type SnapOptions } from './snap.js';

const rect = (x: number, y: number, width = 4, height = 4) => ({ x, y, width, height });
const grid: SnapOptions = { step: 0.5, threshold: 0.3, objects: false };
const objects: SnapOptions = { step: 0.5, threshold: 0.3, objects: true };

describe('snapToStep', () => {
  it('làm tròn tới bội gần nhất', () => {
    expect(snapToStep(3.1, 0.5)).toBe(3);
    expect(snapToStep(3.3, 0.5)).toBe(3.5);
    expect(snapToStep(3.25, 0.5)).toBe(3.5);
    expect(snapToStep(-3.3, 0.5)).toBe(-3.5);
    expect(snapToStep(7, 2)).toBe(8);
  });

  it('bước <= 0 hoặc không hợp lệ thì giữ nguyên', () => {
    expect(snapToStep(3.14159, 0)).toBe(3.14159);
    expect(snapToStep(3.14159, -1)).toBe(3.14159);
    expect(snapToStep(3.14159, Number.NaN)).toBe(3.14159);
  });

  it('không trả -0', () => {
    expect(Object.is(snapToStep(-0.1, 0.5), 0)).toBe(true);
    expect(Object.is(snapToStep(-0.2, 1), 0)).toBe(true);
  });

  it('bỏ nhiễu dấu phẩy động của bước thập phân', () => {
    expect(snapToStep(0.31, 0.1)).toBe(0.3);
    expect(snapToStep(0.74, 0.1)).toBe(0.7);
    expect(snapToStep(12.34, 0.05)).toBe(12.35);
  });

  it('snapPointToStep áp cho cả hai trục', () => {
    expect(snapPointToStep({ x: 3.1, y: 5.8 }, 0.5)).toEqual({ x: 3, y: 6 });
  });
});

describe('snapMovingRect: bắt dính lưới', () => {
  it('đưa góc trên trái về giao điểm lưới gần nhất', () => {
    const result = snapMovingRect(rect(3.1, 5.2), [], 24, grid);
    expect(result.dx).toBeCloseTo(-0.1);
    expect(result.dy).toBeCloseTo(-0.2);
    expect(result.guides).toEqual([]);
  });

  it('bước 0 thì tắt bắt dính lưới', () => {
    const result = snapMovingRect(rect(3.1, 5.2), [], 24, { ...grid, step: 0 });
    expect(result).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('đang đúng lưới thì không dịch', () => {
    const result = snapMovingRect(rect(3, 5), [], 24, grid);
    expect(result.dx).toBeCloseTo(0);
    expect(result.dy).toBeCloseTo(0);
  });
});

describe('snapMovingRect: bắt dính vào đối tượng', () => {
  it('cạnh trái chạm cạnh trái canvas trong ngưỡng, kèm đường dóng', () => {
    const result = snapMovingRect(rect(0.2, 7.3), [], 24, objects);
    expect(result.dx).toBeCloseTo(-0.2);
    expect(result.guides).toContainEqual({ axis: 'x', value: 0 });
  });

  it('cạnh phải chạm cạnh phải canvas', () => {
    const result = snapMovingRect(rect(19.9, 7.3), [], 24, objects);
    expect(result.dx).toBeCloseTo(0.1);
    expect(result.guides).toContainEqual({ axis: 'x', value: 24 });
  });

  it('tâm hình chạm tâm canvas', () => {
    const result = snapMovingRect(rect(10.1, 3.3), [], 24, objects);
    expect(result.dx).toBeCloseTo(-0.1);
    expect(result.guides).toContainEqual({ axis: 'x', value: 12 });
  });

  it('bắt dính vào cạnh và tâm của hình khác', () => {
    const others = [rect(10, 0, 6, 6)];
    // cạnh phải của hình đang kéo (6,1 + 4 = 10,1) gần cạnh trái hình kia (10)
    const left = snapMovingRect(rect(6.1, 8.1), others, 24, objects);
    expect(left.dx).toBeCloseTo(-0.1, 5);
    expect(left.guides).toContainEqual({ axis: 'x', value: 10 });
    // cạnh trên của hình đang kéo (5,9) gần cạnh dưới của hình kia (6)
    const vertical = snapMovingRect(rect(6.7, 5.9), others, 24, objects);
    expect(vertical.dy).toBeCloseTo(0.1);
    expect(vertical.guides).toContainEqual({ axis: 'y', value: 6 });
  });

  it('chọn ứng viên gần nhất khi có nhiều đích trong ngưỡng', () => {
    const others = [rect(5.2, 0, 1, 1), rect(5.4, 0, 1, 1)];
    // cạnh trái của hình kéo ở 5,35 -> gần 5,4 hơn 5,2
    const result = snapMovingRect(rect(5.35, 10), others, 24, { ...objects, threshold: 0.5 });
    expect(result.dx).toBeCloseTo(0.05);
    expect(result.guides).toContainEqual({ axis: 'x', value: 5.4 });
  });

  it('ngoài ngưỡng thì rơi về bắt dính lưới trên trục đó', () => {
    const result = snapMovingRect(rect(3.1, 5.2), [], 24, objects);
    expect(result.dx).toBeCloseTo(-0.1);
    expect(result.dy).toBeCloseTo(-0.2);
    expect(result.guides).toEqual([]);
  });

  it('hai trục độc lập: x dính đối tượng, y dính lưới', () => {
    const result = snapMovingRect(rect(0.1, 5.2), [], 24, objects);
    expect(result.dx).toBeCloseTo(-0.1);
    expect(result.dy).toBeCloseTo(-0.2);
    expect(result.guides).toEqual([{ axis: 'x', value: 0 }]);
  });

  it('bắt dính đối tượng nhưng không có bước lưới thì không dịch khi không có gì gần', () => {
    const result = snapMovingRect(rect(3.1, 5.2), [], 24, { step: 0, threshold: 0.3, objects: true });
    expect(result).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('đối tượng bị tắt thì bỏ qua cạnh và tâm của hình khác, chỉ dính lưới', () => {
    const result = snapMovingRect(rect(0.2, 5.2), [rect(0.3, 0)], 24, grid);
    expect(result.dx).toBeCloseTo(0.3 - 0.2 - 0.3, 5);
    expect(result.guides).toEqual([]);
  });

  it('ngưỡng bằng 0 chỉ dính khi trùng khít', () => {
    const exact = snapMovingRect(rect(0, 5), [], 24, { ...objects, threshold: 0 });
    expect(exact.guides).toContainEqual({ axis: 'x', value: 0 });
    const near = snapMovingRect(rect(0.01, 5), [], 24, { ...objects, threshold: 0 });
    expect(near.guides.find((guide) => guide.axis === 'x')).toBeUndefined();
  });
});
