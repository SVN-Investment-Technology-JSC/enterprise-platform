/** @jest-environment jsdom */
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { nearestTimeOption, TimeComboInput, timeOptions } from './time-combo-input';

function Harness({ initial = '07:30', onValue }: { initial?: string; onValue?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <TimeComboInput
      aria-label="Giờ bắt đầu"
      value={value}
      onChange={(v) => {
        setValue(v);
        onValue?.(v);
      }}
    />
  );
}

describe('timeOptions', () => {
  it('48 mốc 24 giờ mỗi 30 phút, từ 00:00 đến 23:30', () => {
    const options = timeOptions();
    expect(options).toHaveLength(48);
    expect(options[0]).toBe('00:00');
    expect(options[15]).toBe('07:30');
    expect(options[47]).toBe('23:30');
    expect(timeOptions(60)).toHaveLength(24);
  });

  it('mốc gần nhất không nhỏ hơn giờ đang nhập', () => {
    const options = timeOptions();
    expect(nearestTimeOption(options, '07:30')).toBe('07:30');
    expect(nearestTimeOption(options, '07:31')).toBe('08:00');
    expect(nearestTimeOption(options, '23:45')).toBe('23:30');
    expect(nearestTimeOption(options, '')).toBe('00:00');
  });
});

describe('TimeComboInput', () => {
  it('bấm vào ô mở danh sách giờ 24 giờ, chọn một mốc thì đổi giá trị và đóng danh sách', () => {
    const seen: string[] = [];
    render(<Harness onValue={(v) => seen.push(v)} />);
    const input = screen.getByLabelText('Giờ bắt đầu') as HTMLInputElement;
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(input);
    const list = screen.getByRole('listbox', { name: /24 giờ/ });
    expect(within(list).getAllByRole('option')).toHaveLength(48);
    expect(within(list).getByRole('option', { name: '07:30' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(within(list).getByRole('option', { name: '17:00' }));
    expect(seen).toEqual(['17:00']);
    expect(input.value).toBe('17:00');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('gõ tay các kiểu 730, 7h30, 7:30 đều chuẩn hoá về HH:mm khi nhấn Enter hoặc rời ô', () => {
    const seen: string[] = [];
    render(<Harness initial="" onValue={(v) => seen.push(v)} />);
    const input = screen.getByLabelText('Giờ bắt đầu') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1730' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('17:30');
    fireEvent.change(input, { target: { value: '9h5' } });
    fireEvent.blur(input);
    expect(input.value).toBe('09:05');
    expect(seen).toEqual(['17:30', '09:05']);
  });

  it('giờ không hợp lệ (25:00) bị bỏ, trả về giá trị cũ', () => {
    const seen: string[] = [];
    render(<Harness initial="08:00" onValue={(v) => seen.push(v)} />);
    const input = screen.getByLabelText('Giờ bắt đầu') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '25:00' } });
    fireEvent.blur(input);
    expect(input.value).toBe('08:00');
    expect(seen).toEqual([]);
  });

  it('phím mũi tên đổi mốc giờ và Escape đóng danh sách', () => {
    const seen: string[] = [];
    render(<Harness initial="08:00" onValue={(v) => seen.push(v)} />);
    const input = screen.getByLabelText('Giờ bắt đầu');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(seen.length).toBeGreaterThan(0);
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
