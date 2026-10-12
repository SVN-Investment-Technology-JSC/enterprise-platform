/** @jest-environment jsdom */
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { DateTimeInput } from './date-time-input';

function Harness({ initial, onValue }: { initial: string; onValue?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <DateTimeInput
      aria-label="Từ"
      value={value}
      onChange={(v) => {
        setValue(v);
        onValue?.(v);
      }}
    />
  );
}

const dateBox = () => screen.getByLabelText('Từ (ngày)') as HTMLInputElement;
const timeBox = () => screen.getByLabelText('Từ (giờ)') as HTMLInputElement;
const nativeDate = () => document.querySelector('input[type="date"]') as HTMLInputElement;

describe('DateTimeInput: ngày và giờ không làm mất nhau', () => {
  it('bấm vào ô ngày rồi sang ô giờ không xoá ngày và không đổi giờ', () => {
    const seen: string[] = [];
    render(<Harness initial="2026-10-11T07:30" onValue={(v) => seen.push(v)} />);
    fireEvent.click(dateBox());
    fireEvent.focus(dateBox());
    fireEvent.blur(dateBox());
    fireEvent.focus(timeBox());
    expect(dateBox().value).toBe('11/10/2026');
    expect(timeBox().value).toBe('07:30');
    expect(seen).not.toContain('');
  });

  it('chọn ngày từ lịch rồi sang ô giờ: giờ đã nhập được giữ nguyên', () => {
    const seen: string[] = [];
    render(<Harness initial="2026-10-11T07:30" onValue={(v) => seen.push(v)} />);
    fireEvent.change(nativeDate(), { target: { value: '2026-10-14' } });
    expect(dateBox().value).toBe('14/10/2026');
    fireEvent.focus(timeBox());
    expect(timeBox().value).toBe('07:30');
    expect(seen[seen.length - 1]).toBe('2026-10-14T07:30');
  });

  it('gõ ngày mới rồi sang ô giờ: giờ không bị đặt lại 00:00', () => {
    render(<Harness initial="2026-10-11T08:15" />);
    fireEvent.change(dateBox(), { target: { value: '15102026' } });
    fireEvent.blur(dateBox());
    expect(dateBox().value).toBe('15/10/2026');
    expect(timeBox().value).toBe('08:15');
  });

  it('xoá trắng ô ngày rồi chọn lại ngày: giờ cũ được giữ, không về 00:00', () => {
    const seen: string[] = [];
    render(<Harness initial="2026-10-11T07:30" onValue={(v) => seen.push(v)} />);
    fireEvent.change(dateBox(), { target: { value: '' } });
    expect(seen[seen.length - 1]).toBe('');
    fireEvent.change(nativeDate(), { target: { value: '2026-10-20' } });
    expect(seen[seen.length - 1]).toBe('2026-10-20T07:30');
  });

  it('chọn giờ từ danh sách rồi quay lại ô ngày: ngày giữ nguyên', () => {
    render(<Harness initial="2026-10-11T07:30" />);
    fireEvent.click(timeBox());
    fireEvent.click(screen.getByRole('option', { name: '17:00' }));
    fireEvent.focus(dateBox());
    fireEvent.blur(dateBox());
    expect(dateBox().value).toBe('11/10/2026');
    expect(timeBox().value).toBe('17:00');
  });
});
