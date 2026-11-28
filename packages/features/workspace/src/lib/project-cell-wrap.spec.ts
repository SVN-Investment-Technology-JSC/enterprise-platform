import {
  DEFAULT_PROJECT_CELL_WRAP,
  PROJECT_CELL_WRAP_STORAGE_KEY,
  readProjectCellWrap,
  writeProjectCellWrap,
} from './project-cell-wrap';

describe('cách hiện chữ của bảng dự án', () => {
  afterEach(() => {
    window.localStorage.clear();
    jest.restoreAllMocks();
  });

  it('mặc định xuống dòng; giá trị lạ cũng về mặc định', () => {
    expect(DEFAULT_PROJECT_CELL_WRAP).toBe('wrap');
    expect(readProjectCellWrap()).toBe('wrap');
    window.localStorage.setItem(PROJECT_CELL_WRAP_STORAGE_KEY, 'lung-tung');
    expect(readProjectCellWrap()).toBe('wrap');
  });

  it('lưu "gọn một dòng"; chọn lại mặc định thì xoá khoá', () => {
    writeProjectCellWrap('compact');
    expect(window.localStorage.getItem(PROJECT_CELL_WRAP_STORAGE_KEY)).toBe('compact');
    expect(readProjectCellWrap()).toBe('compact');
    writeProjectCellWrap('wrap');
    expect(window.localStorage.getItem(PROJECT_CELL_WRAP_STORAGE_KEY)).toBeNull();
  });

  it('trình duyệt chặn lưu trữ: không ném lỗi, đọc ra mặc định', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readProjectCellWrap()).toBe('wrap');
    expect(() => writeProjectCellWrap('compact')).not.toThrow();
  });
});
