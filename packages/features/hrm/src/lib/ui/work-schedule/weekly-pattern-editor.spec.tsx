/** @jest-environment jsdom */
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { HrmShiftDefinition } from '@enterprise-platform/contracts-hrm';
import { emptyPattern, type PatternRow } from '../../hrm-work-schedule-model';
import { WeeklyPatternEditor } from './weekly-pattern-editor';

const shifts = [
  { id: 's-hc', code: 'HC', name: 'Hành chính', startTime: '08:00', endTime: '17:30', status: 'ACTIVE' },
  { id: 's-t7', code: 'HC-T7', name: 'HC sáng T7', startTime: '07:30', endTime: '11:30', status: 'ACTIVE' },
] as unknown as HrmShiftDefinition[];

let latest: PatternRow[] = [];
function Harness({ initial }: { initial?: PatternRow[] }) {
  const [pattern, setPattern] = useState<PatternRow[]>(initial ?? emptyPattern());
  latest = pattern;
  return <WeeklyPatternEditor pattern={pattern} onChange={setPattern} shifts={shifts} />;
}

async function chooseShortcut(placeholder: RegExp, option: string) {
  fireEvent.click(screen.getByPlaceholderText(placeholder));
  const options = await screen.findAllByRole('option');
  fireEvent.click(options.find((o) => o.textContent?.includes(option)) as HTMLElement);
}

describe('WeeklyPatternEditor', () => {
  it('chọn ca ở lối tắt T2-T6 là điền ngay vào năm dòng, không cần bấm thêm nút', async () => {
    render(<Harness />);
    expect(screen.getByTestId('pattern-skip-warning').textContent).toContain('T2, T3, T4, T5, T6, T7, CN');
    await chooseShortcut(/Chọn ca cho T2-T6/, 'Hành chính');
    expect(latest.filter((r) => r.dayType === 'SHIFT').map((r) => `${r.weekday}:${r.shiftId}`)).toEqual([
      '1:s-hc', '2:s-hc', '3:s-hc', '4:s-hc', '5:s-hc',
    ]);
    // còn T7 và CN chưa chọn: vẫn cảnh báo
    expect(screen.getByTestId('pattern-skip-warning').textContent).toContain('T7, CN');
  });

  it('thứ bảy chọn ca nửa ngày và chủ nhật nghỉ: hết cảnh báo khi đủ bảy ngày', async () => {
    render(<Harness />);
    await chooseShortcut(/Chọn ca cho T2-T6/, 'Hành chính');
    await chooseShortcut(/Chọn ca làm việc thứ bảy/, 'HC sáng T7');
    fireEvent.click(screen.getByRole('button', { name: 'Chủ nhật nghỉ' }));
    expect(latest.map((r) => r.dayType)).toEqual(['SHIFT', 'SHIFT', 'SHIFT', 'SHIFT', 'SHIFT', 'SHIFT', 'OFF']);
    expect(latest[5].shiftId).toBe('s-t7');
    expect(screen.queryByTestId('pattern-skip-warning')).toBeNull();
  });

  it('chỉ đặt Chủ nhật nghỉ thì cảnh báo rõ T2 đến T7 sẽ không có ca', () => {
    render(<Harness initial={emptyPattern().map((r) => (r.weekday === 7 ? { ...r, dayType: 'OFF' as const } : r))} />);
    const warning = screen.getByTestId('pattern-skip-warning');
    expect(within(warning).getByText(/Chưa chọn ca cho: T2, T3, T4, T5, T6, T7/)).toBeTruthy();
    expect(warning.textContent).toContain('sẽ không có ca');
  });
});
