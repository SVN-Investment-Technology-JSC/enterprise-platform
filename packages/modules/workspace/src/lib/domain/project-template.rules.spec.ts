import { cleanTaskTitles } from './project-template.rules.js';

describe('cleanTaskTitles', () => {
  it('bỏ khoảng trắng thừa và dòng trống, giữ thứ tự', () => {
    expect(cleanTaskTitles(['  Hợp   đồng ', '', '   ', 'Triển khai'])).toEqual(['Hợp đồng', 'Triển khai']);
  });

  it('gộp tên trùng không phân biệt hoa thường và dấu, giữ lần xuất hiện đầu', () => {
    expect(cleanTaskTitles(['Hợp đồng', 'hop dong', 'HỢP ĐỒNG', 'Nghiệm thu'])).toEqual(['Hợp đồng', 'Nghiệm thu']);
  });

  it('danh sách rỗng là hợp lệ', () => {
    expect(cleanTaskTitles([])).toEqual([]);
  });

  it('không phải mảng hoặc phần tử không phải chữ thì báo lỗi', () => {
    expect(() => cleanTaskTitles('Hợp đồng')).toThrow('phải là một mảng');
    expect(() => cleanTaskTitles(['Hợp đồng', 5])).toThrow('phải là chữ');
  });

  it('tên quá dài hoặc quá nhiều công việc thì báo lỗi thay vì cắt lặng lẽ', () => {
    expect(() => cleanTaskTitles(['x'.repeat(201)])).toThrow('tối đa 200');
    expect(() => cleanTaskTitles(Array.from({ length: 31 }, (_, index) => `Việc ${index + 1}`))).toThrow('tối đa 30');
    expect(cleanTaskTitles(Array.from({ length: 30 }, (_, index) => `Việc ${index + 1}`))).toHaveLength(30);
  });
});
