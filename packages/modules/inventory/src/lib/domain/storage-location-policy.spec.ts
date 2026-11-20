import {
  collapseSpaces,
  joinSegments,
  locationKey,
  normalizeLevelNames,
  normalizeStorageLocations,
  parseLevelNames,
  splitLocationText,
} from './storage-location-policy.js';

describe('chuẩn hoá vị trí lưu trữ', () => {
  it('gộp khoảng trắng, giữ nguyên hoa thường và dấu', () => {
    expect(collapseSpaces('  Kệ   3 \n Ngăn 2 ')).toBe('Kệ 3 Ngăn 2');
    expect(locationKey('  KỆ  3 ')).toBe('kệ 3');
  });

  it('chữ không theo cấu trúc vẫn là một vị trí hợp lệ, không tách cấp', () => {
    const [gate, code] = normalizeStorageLocations([{ locationText: 'gần cửa' }, { locationText: 'A-03-02' }]);
    expect(gate).toMatchObject({ locationText: 'gần cửa', segments: undefined });
    expect(code).toMatchObject({ locationText: 'A-03-02', segments: undefined });
  });

  it('thiếu chuỗi thì ghép từ các cấp; chuỗi có thì chuỗi thắng khi lệch', () => {
    const list = normalizeStorageLocations([
      { segments: ['Khu A', ' Kệ 3 ', '', 'Ngăn 2'] },
      { locationText: 'Kho phụ', segments: ['Khu B'] },
    ]);
    expect(list[0]).toMatchObject({ locationText: 'Khu A / Kệ 3 / Ngăn 2', segments: ['Khu A', 'Kệ 3', 'Ngăn 2'] });
    expect(list[1]).toMatchObject({ locationText: 'Kho phụ', segments: ['Khu B'] });
  });

  it('không giới hạn số cấp', () => {
    const segments = Array.from({ length: 12 }, (_, index) => `Cấp ${index + 1}`);
    const [entry] = normalizeStorageLocations([{ segments }]);
    expect(entry.segments).toHaveLength(12);
    expect(entry.locationText).toBe(joinSegments(segments));
  });

  it('bỏ dòng trống, gộp trùng không phân biệt hoa thường và giữ dòng đầu', () => {
    const list = normalizeStorageLocations([
      { locationText: ' ' },
      { locationText: 'Kệ 3', note: 'nặng' },
      { locationText: 'KỆ   3', note: 'khác' },
      { locationText: 'Kệ 4' },
    ]);
    expect(list.map((entry) => entry.locationText)).toEqual(['Kệ 3', 'Kệ 4']);
    expect(list[0].note).toBe('nặng');
  });

  it('danh sách rỗng là hợp lệ (xóa hết vị trí)', () => {
    expect(normalizeStorageLocations([])).toEqual([]);
  });

  it('đúng một vị trí chính: dòng đầu tiên được đánh dấu; không đánh dấu thì dòng đầu tiên', () => {
    const flagged = normalizeStorageLocations([
      { locationText: 'A' },
      { locationText: 'B', isPrimary: true },
      { locationText: 'C', isPrimary: true },
    ]);
    expect(flagged.map((entry) => entry.isPrimary)).toEqual([false, true, false]);
    const none = normalizeStorageLocations([{ locationText: 'A' }, { locationText: 'B' }]);
    expect(none.map((entry) => entry.isPrimary)).toEqual([true, false]);
  });

  it('dòng trùng đánh dấu chính thì kết quả là chính', () => {
    const list = normalizeStorageLocations([{ locationText: 'A' }, { locationText: 'B' }, { locationText: 'b', isPrimary: true }]);
    expect(list.map((entry) => [entry.locationText, entry.isPrimary])).toEqual([
      ['A', false],
      ['B', true],
    ]);
  });

  it('từ chối chuỗi dài quá 255 ký tự và ghi chú dài quá 1000 ký tự', () => {
    expect(() => normalizeStorageLocations([{ locationText: 'x'.repeat(256) }])).toThrow(/dài quá 255/);
    expect(() => normalizeStorageLocations([{ locationText: 'A', note: 'n'.repeat(1001) }])).toThrow(/dài quá 1000/);
    expect(() => normalizeStorageLocations([{ locationText: 'x'.repeat(255) }])).not.toThrow();
  });

  it('từ chối payload không phải danh sách hoặc có phần tử hỏng', () => {
    expect(() => normalizeStorageLocations(undefined)).toThrow('Danh sách vị trí không hợp lệ.');
    expect(() => normalizeStorageLocations([null as never])).toThrow('Danh sách vị trí không hợp lệ.');
  });
});

describe('tách chuỗi vị trí', () => {
  it('chỉ tách theo / và >; gạch ngang giữ nguyên', () => {
    expect(splitLocationText('Khu A / Kệ 3 > Ngăn 2')).toEqual(['Khu A', 'Kệ 3', 'Ngăn 2']);
    expect(splitLocationText('A-03-02')).toEqual(['A-03-02']);
    expect(splitLocationText(' // ')).toEqual([]);
  });
});

describe('tên cấp', () => {
  it('đọc dữ liệu đã lưu: bỏ mục rỗng và không phải chuỗi, cắt tên quá 50 ký tự, không giới hạn số cấp', () => {
    expect(normalizeLevelNames([' Khu ', '', 7, 'Kệ', 'x'.repeat(60)])).toEqual(['Khu', 'Kệ', 'x'.repeat(50)]);
    expect(normalizeLevelNames(Array.from({ length: 30 }, (_, index) => `C${index}`))).toHaveLength(30);
    expect(normalizeLevelNames('Khu')).toEqual([]);
  });

  it('kiểm chặt khi người dùng gửi: null là bỏ ghi đè, mảng chuỗi hợp lệ, tên quá dài bị từ chối', () => {
    expect(parseLevelNames(null)).toBeNull();
    expect(parseLevelNames([' Khu ', '', 'Kệ'])).toEqual(['Khu', 'Kệ']);
    expect(parseLevelNames([])).toEqual([]);
    expect(() => parseLevelNames('Khu')).toThrow('Danh sách tên cấp không hợp lệ.');
    expect(() => parseLevelNames(['Khu', 3])).toThrow('Danh sách tên cấp không hợp lệ.');
    expect(() => parseLevelNames(['x'.repeat(51)])).toThrow(/dài quá 50/);
  });
});
