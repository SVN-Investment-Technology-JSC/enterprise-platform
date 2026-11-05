import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MonthPickField } from '@enterprise-platform/feature-workspace';

afterEach(cleanup);

function Harness({ initial = '2026-11', min, max }: { initial?: string; min?: string; max?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <MonthPickField aria-label="Tháng báo cáo" value={value} onChange={setValue} min={min} max={max} />
      <output data-testid="value">{value}</output>
    </>
  );
}

describe('MonthPickField', () => {
  it('hiện "Tháng M/YYYY"; mở bảng thì chọn được tháng khác và bảng tự đóng', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Tháng báo cáo' });
    expect(trigger.textContent).toContain('Tháng 11/2026');
    fireEvent.click(trigger);
    expect(screen.getAllByRole('button', { name: /^Tháng \d+$/ })).toHaveLength(12);
    fireEvent.click(screen.getByRole('button', { name: 'Tháng 3' }));
    expect(screen.getByTestId('value').textContent).toBe('2026-03');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('đổi năm bằng hai mũi tên rồi chọn tháng của năm đó', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Tháng báo cáo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Năm trước' }));
    expect(screen.getByText('2025')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tháng 12' }));
    expect(screen.getByTestId('value').textContent).toBe('2025-12');
  });

  it('tháng ngoài khoảng min/max bị khoá; Esc chỉ đóng bảng chọn', () => {
    render(<Harness min="2026-06" max="2026-12" />);
    fireEvent.click(screen.getByRole('button', { name: 'Tháng báo cáo' }));
    expect((screen.getByRole('button', { name: 'Tháng 5' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Tháng 6' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
