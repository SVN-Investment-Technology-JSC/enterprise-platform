import { DEFAULT_EDITOR_PREFS, normalizeEditorPrefs } from './use-editor-prefs';

describe('normalizeEditorPrefs', () => {
  it('dữ liệu không dùng được thì lấy mặc định', () => {
    expect(normalizeEditorPrefs(null)).toBe(DEFAULT_EDITOR_PREFS);
    expect(normalizeEditorPrefs('chuỗi')).toBe(DEFAULT_EDITOR_PREFS);
    expect(normalizeEditorPrefs(42)).toBe(DEFAULT_EDITOR_PREFS);
  });

  it('chỉ nhận đúng kiểu từng trường, trường sai thì dùng mặc định', () => {
    const prefs = normalizeEditorPrefs({
      showGrid: false,
      snapGrid: 'có',
      snapObjects: false,
      displayMode: 'currentColor',
      polygonSides: 7.6,
    });
    expect(prefs.showGrid).toBe(false);
    expect(prefs.snapGrid).toBe(true);
    expect(prefs.snapObjects).toBe(false);
    expect(prefs.displayMode).toBe('currentColor');
    expect(prefs.polygonSides).toBe(8);
  });

  it('chế độ hiển thị lạ thì về màu thương hiệu, số cạnh bị giới hạn 3..12', () => {
    expect(normalizeEditorPrefs({ displayMode: 'khác' }).displayMode).toBe('brand');
    expect(normalizeEditorPrefs({ polygonSides: 1 }).polygonSides).toBe(3);
    expect(normalizeEditorPrefs({ polygonSides: 100 }).polygonSides).toBe(12);
    expect(normalizeEditorPrefs({ polygonSides: 'bảy' }).polygonSides).toBe(DEFAULT_EDITOR_PREFS.polygonSides);
  });

  it('mục thu gọn: lọc mã và giá trị sai, thiếu trường thì mặc định (Quy chuẩn thu gọn sẵn)', () => {
    expect(normalizeEditorPrefs({}).collapsed).toEqual({ compliance: true });
    expect(normalizeEditorPrefs({ collapsed: { layers: true, 'bad key!': true, preview: 'x' } }).collapsed).toEqual({ layers: true });
    expect(normalizeEditorPrefs({ collapsed: {} }).collapsed).toEqual({});
  });
});
