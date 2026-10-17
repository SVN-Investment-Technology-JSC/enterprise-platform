/** @jest-environment jsdom */
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MoneyInput } from './form-parts';

function Harness({ initial = 0, allowNegative = false, onValue }: { initial?: number; allowNegative?: boolean; onValue?: (value: number) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <MoneyInput
      aria-label="Số tiền"
      value={value}
      allowNegative={allowNegative}
      onChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
    />
  );
}

const input = () => screen.getByLabelText('Số tiền') as HTMLInputElement;

/** Giả lập người dùng gõ/dán: đặt chuỗi mới và vị trí con trỏ rồi phát sự kiện change. */
function type(value: string, caret = value.length) {
  const element = input();
  fireEvent.change(element, { target: { value, selectionStart: caret, selectionEnd: caret } });
}

describe('MoneyInput: định dạng tiền theo thời gian thực', () => {
  it('hiện dấu phân cách hàng nghìn sau từng ký tự gõ', () => {
    const seen: number[] = [];
    render(<Harness onValue={(value) => seen.push(value)} />);
    let text = '';
    const shown: string[] = [];
    for (const ch of '1500000') {
      text = input().value + ch;
      type(text);
      shown.push(input().value);
    }
    expect(shown).toEqual(['1', '15', '150', '1.500', '15.000', '150.000', '1.500.000']);
    expect(seen.at(-1)).toBe(1_500_000);
  });

  it('bỏ ký tự không phải số và chỉ giữ số nguyên', () => {
    render(<Harness />);
    type('12ab3');
    expect(input().value).toBe('123');
    type('');
    expect(input().value).toBe('');
  });

  it('dán chuỗi có dấu chấm, đơn vị và phần thập phân thì lấy đúng số nguyên đồng', () => {
    const seen: number[] = [];
    render(<Harness onValue={(value) => seen.push(value)} />);
    type('1.500.000 đ');
    expect(input().value).toBe('1.500.000');
    type('2.750.000,50 ₫');
    expect(input().value).toBe('2.750.000');
    expect(seen.at(-1)).toBe(2_750_000);
  });

  it('sửa giữa chuỗi: con trỏ ở đúng chỗ, không nhảy về cuối', () => {
    render(<Harness initial={1500} />);
    expect(input().value).toBe('1.500');
    // Gõ "2" ngay sau chữ số đầu: "1" + "2" + ".500", con trỏ sau chữ số thứ hai.
    type('12.500', 2);
    expect(input().value).toBe('12.500');
    expect(input().selectionStart).toBe(2);
    // Gõ thêm một chữ số làm đổi dấu chấm: "12" + "3" + ".500" → "123.500", con trỏ vẫn ngay sau chữ số thứ ba.
    type('123.500', 3);
    expect(input().value).toBe('123.500');
    expect(input().selectionStart).toBe(3);
    // Chèn chữ số đẩy dấu chấm sang phải: "1" + "9" + "23.500" → "1.923.500", con trỏ sau chữ số thứ hai, tức sau "9".
    type('1923.500', 2);
    expect(input().value).toBe('1.923.500');
    expect(input().selectionStart).toBe(3);
  });

  it('xoá giữa chuỗi: dấu chấm được dựng lại, con trỏ giữ nguyên số chữ số phía trước', () => {
    render(<Harness initial={1_500_000} />);
    // Xoá chữ số "5" (ký tự thứ ba) khỏi "1.500.000".
    type('1.00.000', 2);
    expect(input().value).toBe('100.000');
    expect(input().selectionStart).toBe(1);
  });

  it('gõ ký tự không hợp lệ không làm con trỏ nhảy: ô giữ nguyên số và vị trí', () => {
    render(<Harness initial={1500} />);
    type('1.5a00', 4);
    expect(input().value).toBe('1.500');
    expect(input().selectionStart).toBe(3);
  });

  it('số quá dài (vượt giới hạn 15 chữ số) bị từ chối, giữ nguyên số cũ', () => {
    const seen: number[] = [];
    render(<Harness initial={999_999_999_999_999} onValue={(value) => seen.push(value)} />);
    expect(input().value).toBe('999.999.999.999.999');
    type('9.999.999.999.999.999');
    expect(input().value).toBe('999.999.999.999.999');
    expect(seen).toEqual([]);
  });

  it('số 0 và ô trống đều là rỗng; số 0 đứng đầu bị bỏ', () => {
    render(<Harness />);
    type('0');
    expect(input().value).toBe('');
    type('0012');
    expect(input().value).toBe('12');
  });

  it('mặc định không nhận số âm; allowNegative nhận dấu trừ ở đầu (số dư đầu kỳ)', () => {
    const plain = render(<Harness />);
    type('-500');
    expect(input().value).toBe('500');
    plain.unmount();

    const seen: number[] = [];
    render(<Harness allowNegative onValue={(value) => seen.push(value)} />);
    type('-');
    expect(input().value).toBe('-');
    type('-1500');
    expect(input().value).toBe('-1.500');
    expect(seen.at(-1)).toBe(-1500);
    type('');
    expect(input().value).toBe('');
    expect(seen.at(-1)).toBe(0);
  });

  it('hiển thị đúng giá trị có sẵn khi mở phiếu để sửa', () => {
    render(<Harness initial={24_500_000} />);
    expect(input().value).toBe('24.500.000');
  });
});
