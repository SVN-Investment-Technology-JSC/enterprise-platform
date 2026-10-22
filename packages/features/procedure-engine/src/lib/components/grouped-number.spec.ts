import { formatGroupedInput } from './grouped-number';

describe('formatGroupedInput', () => {
  it('chèn dấu chấm ngăn nghìn khi gõ thêm ở cuối', () => {
    expect(formatGroupedInput('1000', 4)).toEqual({ text: '1.000', caret: 5 });
    expect(formatGroupedInput('1.0000', 6)).toEqual({ text: '10.000', caret: 6 });
    expect(formatGroupedInput('1.000.0000', 10)).toEqual({ text: '10.000.000', caret: 10 });
  });

  it('giữ con trỏ đúng chỗ khi gõ hoặc xoá giữa chuỗi', () => {
    // Gõ "5" sau chữ số đầu của "1.000": "15.000" → con trỏ ngay sau "5".
    expect(formatGroupedInput('15.000', 2)).toEqual({ text: '15.000', caret: 2 });
    // Xoá chữ số đầu của "1.000.000" → "000.000" thành "0" bị bỏ số 0 đầu.
    expect(formatGroupedInput('.000.000', 0)).toEqual({ text: '0', caret: 0 });
    // Xoá một chữ số giữa "1.234.567" → "1.24.567".
    expect(formatGroupedInput('1.24.567', 3)).toEqual({ text: '124.567', caret: 2 });
  });

  it('giữ phần thập phân sau dấu phẩy và bỏ ký tự lạ', () => {
    expect(formatGroupedInput('1234567,5', 9)).toEqual({ text: '1.234.567,5', caret: 11 });
    expect(formatGroupedInput(',5', 2)).toEqual({ text: '0,5', caret: 3 });
    expect(formatGroupedInput('12a34', 5)).toEqual({ text: '1.234', caret: 5 });
    expect(formatGroupedInput('', 0)).toEqual({ text: '', caret: 0 });
  });
});
