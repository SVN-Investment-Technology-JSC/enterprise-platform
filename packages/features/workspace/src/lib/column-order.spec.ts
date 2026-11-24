import {
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  clampColumnWidth,
  explicitTableStyle,
  moveColumn,
  neighbourColumn,
  resolveColumnOrder,
  sanitizeColumnWidths,
} from './column-order';

describe('resolveColumnOrder', () => {
  const defaults = ['a', 'b', 'c', 'd'];

  it('không có bản lưu thì giữ thứ tự mặc định', () => {
    expect(resolveColumnOrder(defaults, undefined)).toEqual(defaults);
  });

  it('theo bản lưu, bỏ id lạ và id trùng', () => {
    expect(resolveColumnOrder(defaults, ['c', 'x', 'a', 'c'])).toEqual([
      'c',
      'a',
      'b',
      'd',
    ]);
  });

  it('cột mới chưa có trong bản lưu được nối vào cuối theo thứ tự mặc định', () => {
    expect(resolveColumnOrder(['a', 'b', 'c', 'e'], ['b', 'a'])).toEqual([
      'b',
      'a',
      'c',
      'e',
    ]);
  });
});

describe('moveColumn', () => {
  const order = ['name', 'a', 'b', 'c'];
  const pinned = ['name'];

  it('đưa cột ra sau cột đích', () => {
    expect(moveColumn(order, 'a', 'c', 'after', pinned)).toEqual([
      'name',
      'b',
      'c',
      'a',
    ]);
  });

  it('đưa cột ra trước cột đích', () => {
    expect(moveColumn(order, 'c', 'a', 'before', pinned)).toEqual([
      'name',
      'c',
      'a',
      'b',
    ]);
  });

  it('thả ngay chỗ cũ thì trả nguyên mảng', () => {
    expect(moveColumn(order, 'a', 'b', 'before', pinned)).toBe(order);
    expect(moveColumn(order, 'a', 'a', 'after', pinned)).toBe(order);
  });

  it('không kéo được cột ghim và không chèn trước cột ghim', () => {
    expect(moveColumn(order, 'name', 'c', 'after', pinned)).toBe(order);
    expect(moveColumn(order, 'b', 'name', 'before', pinned)).toBe(order);
  });

  it('thả sau cột ghim thì đứng ngay sau nó', () => {
    expect(moveColumn(order, 'c', 'name', 'after', pinned)).toEqual([
      'name',
      'c',
      'a',
      'b',
    ]);
  });

  it('id không có trong bảng thì không đổi', () => {
    expect(moveColumn(order, 'zzz', 'a', 'after', pinned)).toBe(order);
    expect(moveColumn(order, 'a', 'zzz', 'after', pinned)).toBe(order);
  });

  it('nhiều cột ghim: thả sau cột ghim đầu thì vào sau cột ghim cuối, không chen giữa', () => {
    expect(
      moveColumn(['s', 'p', 'x', 'y'], 'y', 's', 'after', ['s', 'p']),
    ).toEqual(['s', 'p', 'y', 'x']);
    expect(
      moveColumn(['s', 'p', 'x', 'y'], 'y', 'p', 'before', ['s', 'p']),
    ).toEqual(['s', 'p', 'x', 'y']);
  });
});

describe('neighbourColumn', () => {
  const order = ['name', 'a', 'b'];

  it('lấy cột kế bên', () => {
    expect(neighbourColumn(order, 'a', 1, ['name'])).toBe('b');
    expect(neighbourColumn(order, 'b', -1, ['name'])).toBe('a');
  });

  it('hết chỗ hoặc gặp cột ghim thì không có', () => {
    expect(neighbourColumn(order, 'b', 1, ['name'])).toBeUndefined();
    expect(neighbourColumn(order, 'a', -1, ['name'])).toBeUndefined();
  });
});

describe('độ rộng cột', () => {
  it('kẹp độ rộng vào khoảng cho phép và làm tròn', () => {
    expect(clampColumnWidth(10)).toBe(MIN_COLUMN_WIDTH);
    expect(clampColumnWidth(5000)).toBe(MAX_COLUMN_WIDTH);
    expect(clampColumnWidth(120.4)).toBe(120);
    expect(clampColumnWidth(Number.NaN)).toBe(MIN_COLUMN_WIDTH);
  });

  it('bản lưu hỏng hoặc có id lạ thì được lọc', () => {
    expect(sanitizeColumnWidths(undefined, ['a'])).toBeUndefined();
    expect(sanitizeColumnWidths([1, 2], ['a'])).toBeUndefined();
    expect(sanitizeColumnWidths({ a: 100, z: 50, b: 'x' }, ['a', 'b'])).toEqual(
      { a: 100 },
    );
    expect(sanitizeColumnWidths({ a: 5 }, ['a'])).toEqual({
      a: MIN_COLUMN_WIDTH,
    });
  });

  it('kiểu bảng cố định chỉ có khi mọi cột hiện đều có số đo', () => {
    expect(explicitTableStyle(['a', 'b'], undefined)).toBeUndefined();
    expect(explicitTableStyle(['a', 'b'], { a: 100 })).toBeUndefined();
    expect(explicitTableStyle(['a', 'b'], { a: 100, b: 50, c: 999 })).toEqual({
      tableLayout: 'fixed',
      width: '100%',
      minWidth: 150,
    });
  });
});
