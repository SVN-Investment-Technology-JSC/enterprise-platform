import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { VnNumberInput } from './vn-number-input';

function Harness({ initial = '', onValue }: { initial?: string; onValue?: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <VnNumberInput
        aria-label="Giá"
        value={value}
        onChange={(next) => {
          setValue(next);
          onValue?.(next);
        }}
      />
      <button type="button" onClick={() => setValue('1234.5')}>
        đặt lại
      </button>
    </>
  );
}

describe('VnNumberInput', () => {
  it('hiển thị có ngăn nghìn và trả về giá trị chuẩn', () => {
    const seen: string[] = [];
    render(<Harness onValue={(value) => seen.push(value)} />);
    const input = screen.getByLabelText('Giá') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '500000000,01' } });
    expect(input.value).toBe('500.000.000,01');
    expect(seen.at(-1)).toBe('500000000.01');
  });

  it('giữ dấu phẩy đang gõ dở và bỏ khi rời ô', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Giá') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '500,' } });
    expect(input.value).toBe('500,');
    fireEvent.blur(input);
    expect(input.value).toBe('500');
  });

  it('không nhận chữ', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Giá') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12ab3' } });
    expect(input.value).toBe('123');
  });

  it('hiển thị giá trị ban đầu và đồng bộ khi giá trị bên ngoài đổi', () => {
    render(<Harness initial="1500000.5" />);
    const input = screen.getByLabelText('Giá') as HTMLInputElement;
    expect(input.value).toBe('1.500.000,5');
    fireEvent.click(screen.getByText('đặt lại'));
    expect(input.value).toBe('1.234,5');
  });

  it('dán chuỗi kiểu Việt Nam', () => {
    const seen: string[] = [];
    render(<Harness onValue={(value) => seen.push(value)} />);
    const input = screen.getByLabelText('Giá') as HTMLInputElement;
    fireEvent.paste(input, { clipboardData: { getData: () => '500.000.000,01 đ' } });
    expect(input.value).toBe('500.000.000,01');
    expect(seen.at(-1)).toBe('500000000.01');
  });

  it('xóa hết thì trả về rỗng', () => {
    const seen: string[] = [];
    render(<Harness initial="12" onValue={(value) => seen.push(value)} />);
    const input = screen.getByLabelText('Giá') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    expect(seen.at(-1)).toBe('');
  });

  it('phím chấm ở bàn phím số thành dấu thập phân', () => {
    render(<Harness initial="12" />);
    const input = screen.getByLabelText('Giá') as HTMLInputElement;
    input.setSelectionRange(2, 2);
    fireEvent.change(input, { target: { value: '12.', selectionStart: 3 } });
    expect(input.value).toBe('12,');
  });

  it('form giữ giá trị dạng số vẫn gõ được 0,05', () => {
    function NumberHarness() {
      const [amount, setAmount] = useState<number | undefined>(undefined);
      return (
        <VnNumberInput
          aria-label="Giá"
          value={amount === undefined ? '' : String(amount)}
          onChange={(next) => setAmount(next === '' ? undefined : Number(next))}
        />
      );
    }
    render(<NumberHarness />);
    const input = screen.getByLabelText('Giá') as HTMLInputElement;
    for (const typed of ['0', '0,', '0,0', '0,05']) {
      fireEvent.change(input, { target: { value: typed } });
      expect(input.value).toBe(typed);
    }
  });
});
