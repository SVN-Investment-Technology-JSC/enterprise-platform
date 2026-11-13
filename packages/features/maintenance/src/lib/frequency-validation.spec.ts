import { validateFrequencyDraft } from './frequency-validation';

const option = (overrides: Record<string, unknown> = {}) =>
  ({ code: 'week', label: 'Tuần', intervalUnit: 'week', intervalCount: 1, sortOrder: 1, isActive: true, ...overrides }) as never;

describe('validateFrequencyDraft', () => {
  it('hợp lệ thì không có lỗi', () => {
    expect(validateFrequencyDraft({ options: [option()] })).toEqual([]);
  });
  it('báo tên trống và số kỳ ngoài khoảng', () => {
    const errors = validateFrequencyDraft({ options: [option({ label: ' ' }), option({ label: 'Lớn', intervalCount: 500 }), option({ label: 'Lẻ', intervalCount: 1.5 })] });
    expect(errors).toEqual([
      'Dòng 1: tên tần suất không được để trống.',
      '"Lớn": số kỳ phải là số nguyên từ 1 đến 120.',
      '"Lẻ": số kỳ phải là số nguyên từ 1 đến 120.',
    ]);
  });
});
