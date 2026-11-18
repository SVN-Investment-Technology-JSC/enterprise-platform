import { sanitizeDetails } from './project-request-events.js';

describe('sanitizeDetails — chi tiết đơn đến từ module khác', () => {
  it('giữ cặp nhãn/giá trị hợp lệ, cắt khoảng trắng thừa', () => {
    expect(sanitizeDetails([{ label: ' Địa điểm ', value: ' Kon Tum ' }])).toEqual([
      { label: 'Địa điểm', value: 'Kon Tum' },
    ]);
  });

  it('không phải danh sách hoặc rỗng thì trả null để cột không ghi rác', () => {
    expect(sanitizeDetails(undefined)).toBeNull();
    expect(sanitizeDetails('x')).toBeNull();
    expect(sanitizeDetails({ label: 'a', value: 'b' })).toBeNull();
    expect(sanitizeDetails([])).toBeNull();
  });

  it('bỏ phần tử sai hình dạng hoặc có nhãn/giá trị trống thay vì làm hỏng cả danh sách', () => {
    const result = sanitizeDetails([
      { label: 'Hợp lệ', value: 'ok' },
      { label: '', value: 'thiếu nhãn' },
      { label: 'Thiếu giá trị', value: '  ' },
      { label: 5, value: 'nhãn không phải chuỗi' },
      null,
      'chuỗi lẻ',
    ]);
    expect(result).toEqual([{ label: 'Hợp lệ', value: 'ok' }]);
  });

  it('cắt độ dài và số dòng để đơn của module khác không phình bảng', () => {
    const many = Array.from({ length: 60 }, (_, index) => ({ label: `L${index}`, value: 'x'.repeat(5000) }));
    const result = sanitizeDetails([{ label: 'n'.repeat(300), value: 'v'.repeat(5000) }, ...many]) ?? [];
    expect(result).toHaveLength(40);
    expect(result[0]?.label).toHaveLength(100);
    expect(result[0]?.value).toHaveLength(2000);
  });
});
