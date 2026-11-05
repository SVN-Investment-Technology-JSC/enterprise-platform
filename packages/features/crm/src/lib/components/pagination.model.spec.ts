import { pageCountOf, pageItems } from './pagination.model';

describe('thanh số trang', () => {
  it('ít trang thì hiện hết', () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('nhiều trang: trang đầu, cuối, hai trang mỗi bên trang đang xem, còn lại là dấu …', () => {
    expect(pageItems(1, 21)).toEqual([1, 2, 3, 'gap', 21]);
    expect(pageItems(10, 21)).toEqual([1, 'gap', 8, 9, 10, 11, 12, 'gap', 21]);
    expect(pageItems(21, 21)).toEqual([1, 'gap', 19, 20, 21]);
  });

  it('dải ẩn chỉ một trang thì hiện số trang đó thay cho dấu …', () => {
    expect(pageItems(4, 21)).toEqual([1, 2, 3, 4, 5, 6, 'gap', 21]);
    expect(pageItems(5, 21)).toEqual([1, 2, 3, 4, 5, 6, 7, 'gap', 21]);
  });

  it('trang ngoài khoảng được kéo về trong khoảng; số trang từ tổng dòng', () => {
    expect(pageItems(99, 3)).toEqual([1, 2, 3]);
    expect(pageCountOf(0, 20)).toBe(1);
    expect(pageCountOf(405, 20)).toBe(21);
    expect(pageCountOf(40, 20)).toBe(2);
  });
});
