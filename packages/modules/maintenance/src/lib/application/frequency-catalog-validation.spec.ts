import { validateFrequencyCatalog } from './frequency-catalog-validation.js';

const option = (overrides: Record<string, unknown> = {}) => ({
  code: 'week', label: 'Tuần', intervalUnit: 'week', intervalCount: 1, sortOrder: 1, isActive: true, ...overrides,
});

describe('validateFrequencyCatalog', () => {
  it('danh mục hợp lệ thì không có lỗi', () => {
    expect(validateFrequencyCatalog({ options: [option(), option({ code: 'quarter', label: 'Quý', intervalUnit: 'month', intervalCount: 3 })] })).toEqual([]);
  });

  it('từ chối thay vì lặng lẽ bỏ dòng: tên trống, số kỳ ngoài 1-120, mã trùng, đơn vị lạ', () => {
    const errors = validateFrequencyCatalog({
      options: [
        option({ label: '   ' }),
        option({ code: 'big', label: 'Quá lớn', intervalCount: 500 }),
        option({ code: 'week', label: 'Trùng' }),
        option({ code: 'odd', label: 'Lạ', intervalUnit: 'century' }),
      ],
    });
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('tên tần suất không được để trống'),
      expect.stringContaining('"Quá lớn": số kỳ phải là số nguyên từ 1 đến 120'),
      expect.stringContaining('mã "week" bị trùng'),
      expect.stringContaining('"Lạ": đơn vị kỳ không hợp lệ'),
    ]));
  });

  it('danh mục rỗng hoặc sai hình dạng bị từ chối', () => {
    expect(validateFrequencyCatalog({ options: [] })).toHaveLength(1);
    expect(validateFrequencyCatalog(null)).toHaveLength(1);
  });
});
