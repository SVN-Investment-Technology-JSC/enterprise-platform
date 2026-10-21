import { fireEvent, render, screen } from '@testing-library/react';
import { clampNumber, formatDecimal, normalizeNumber, NumberField, SliderNumber } from './number-field';

describe('normalizeNumber', () => {
  it('đọc số có dấu phẩy hoặc dấu chấm thập phân', () => {
    expect(normalizeNumber('1,75')).toBe(1.75);
    expect(normalizeNumber('1.75')).toBe(1.75);
    expect(normalizeNumber(' -3 ')).toBe(-3);
    expect(normalizeNumber('.5')).toBe(0.5);
    expect(normalizeNumber('5.')).toBe(5);
    expect(normalizeNumber('+2')).toBe(2);
  });

  it('từ chối chữ không phải số', () => {
    expect(normalizeNumber('')).toBeNull();
    expect(normalizeNumber('abc')).toBeNull();
    expect(normalizeNumber('1.2.3')).toBeNull();
    expect(normalizeNumber('1e3')).toBeNull();
    expect(normalizeNumber('--1')).toBeNull();
    expect(normalizeNumber(',')).toBeNull();
  });

  it('kẹp theo min, max và làm tròn theo số chữ số', () => {
    expect(normalizeNumber('9', { max: 6 })).toBe(6);
    expect(normalizeNumber('-1', { min: 0 })).toBe(0);
    expect(normalizeNumber('1,23456', { digits: 2 })).toBe(1.23);
    expect(normalizeNumber('1,23456')).toBe(1.235);
  });
});

describe('clampNumber và formatDecimal', () => {
  it('làm tròn nhiễu số thực sau phép cộng', () => {
    expect(clampNumber(0.1 + 0.2)).toBe(0.3);
  });

  it('hiển thị dấu phẩy thập phân, không có số 0 thừa và không có -0', () => {
    expect(formatDecimal(1.75)).toBe('1,75');
    expect(formatDecimal(2)).toBe('2');
    expect(formatDecimal(1.23456, 2)).toBe('1,23');
    expect(formatDecimal(-0.0001, 2)).toBe('0');
  });
});

describe('NumberField', () => {
  const input = () => screen.getByRole('textbox', { name: 'Độ dày' }) as HTMLInputElement;

  it('hiện giá trị theo dạng dấu phẩy', () => {
    render(<NumberField label="Độ dày" value={1.75} onCommit={jest.fn()} />);
    expect(input().value).toBe('1,75');
  });

  it('áp dụng khi Enter, chấp nhận dấu phẩy', () => {
    const onCommit = jest.fn();
    render(<NumberField label="Độ dày" value={1.75} onCommit={onCommit} />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: '2,5' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(2.5);
  });

  it('áp dụng khi rời ô và kẹp theo min/max', () => {
    const onCommit = jest.fn();
    render(<NumberField label="Độ dày" value={1} min={0.25} max={6} onCommit={onCommit} />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: '99' } });
    fireEvent.blur(input());
    expect(onCommit).toHaveBeenCalledWith(6);
  });

  it('không áp dụng khi chữ nhập không phải số hoặc không đổi giá trị', () => {
    const onCommit = jest.fn();
    render(<NumberField label="Độ dày" value={2} onCommit={onCommit} />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'abc' } });
    fireEvent.blur(input());
    expect(onCommit).not.toHaveBeenCalled();
    expect(input().value).toBe('2');

    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: '2,0' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('Esc bỏ chữ đang gõ', () => {
    const onCommit = jest.fn();
    render(<NumberField label="Độ dày" value={2} onCommit={onCommit} />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: '5' } });
    fireEvent.keyDown(input(), { key: 'Escape' });
    fireEvent.blur(input());
    expect(onCommit).not.toHaveBeenCalled();
    expect(input().value).toBe('2');
  });

  it('mũi tên lên xuống đổi theo step, Shift nhảy mười bước', () => {
    const onCommit = jest.fn();
    render(<NumberField label="Độ dày" value={1} step={0.25} max={6} onCommit={onCommit} />);
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(onCommit).toHaveBeenLastCalledWith(1.25);
    fireEvent.keyDown(input(), { key: 'ArrowDown', shiftKey: true });
    expect(onCommit).toHaveBeenLastCalledWith(-1.5);
  });

  it('ô trống với dấu gạch ngang khi nhiều lớp có giá trị khác nhau', () => {
    render(<NumberField label="Độ dày" value={null} mixed onCommit={jest.fn()} />);
    expect(input().value).toBe('');
    expect(input().placeholder).toBe('—');
  });
});

describe('SliderNumber', () => {
  it('kéo thanh trượt báo bắt đầu, đổi giá trị liên tục và báo kết thúc', () => {
    const onChange = jest.fn();
    const onScrubStart = jest.fn();
    const onScrubEnd = jest.fn();
    render(
      <SliderNumber label="Độ mờ" value={100} min={0} max={100} step={1} digits={0} onChange={onChange} onScrubStart={onScrubStart} onScrubEnd={onScrubEnd} />,
    );
    const slider = screen.getByRole('slider', { name: 'Độ mờ (thanh trượt)' });
    fireEvent.pointerDown(slider);
    expect(onScrubStart).not.toHaveBeenCalled();
    fireEvent.change(slider, { target: { value: '60' } });
    fireEvent.change(slider, { target: { value: '40' } });
    expect(onScrubStart).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenNthCalledWith(1, 60);
    expect(onChange).toHaveBeenNthCalledWith(2, 40);
    fireEvent.pointerUp(slider);
    expect(onScrubEnd).toHaveBeenCalledTimes(1);
  });

  it('dùng phím mũi tên (không kéo chuột) thì không mở lượt kéo', () => {
    const onChange = jest.fn();
    const onScrubStart = jest.fn();
    render(<SliderNumber label="Độ mờ" value={100} min={0} max={100} step={1} digits={0} onChange={onChange} onScrubStart={onScrubStart} />);
    fireEvent.change(screen.getByRole('slider', { name: 'Độ mờ (thanh trượt)' }), { target: { value: '99' } });
    expect(onChange).toHaveBeenCalledWith(99);
    expect(onScrubStart).not.toHaveBeenCalled();
  });

  it('mỗi lượt kéo mới báo bắt đầu lại', () => {
    const onScrubStart = jest.fn();
    render(<SliderNumber label="Độ mờ" value={100} min={0} max={100} step={1} digits={0} onChange={jest.fn()} onScrubStart={onScrubStart} />);
    const slider = screen.getByRole('slider', { name: 'Độ mờ (thanh trượt)' });
    for (const value of ['80', '50']) {
      fireEvent.pointerDown(slider);
      fireEvent.change(slider, { target: { value } });
      fireEvent.pointerUp(slider);
    }
    expect(onScrubStart).toHaveBeenCalledTimes(2);
  });

  it('nhiều lớp có giá trị khác nhau thì ô số để trống', () => {
    render(<SliderNumber label="Độ mờ" value={80} mixed min={0} max={100} step={1} digits={0} onChange={jest.fn()} />);
    expect((screen.getByRole('textbox', { name: 'Độ mờ' }) as HTMLInputElement).value).toBe('');
  });

  it('ô số đi kèm áp dụng giá trị gõ vào', () => {
    const onChange = jest.fn();
    render(<SliderNumber label="Độ mờ" value={100} min={0} max={100} step={1} digits={0} onChange={onChange} />);
    const field = screen.getByRole('textbox', { name: 'Độ mờ' });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '35' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(35);
  });
});
