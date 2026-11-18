/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { snapToStep, tripDatesBetween, tripDayPlanLines, tripDayPlansProblem, TripDayPlanFields, type TripDayPlans } from './trip-day-plan-fields';

function Harness({ onValue }: { onValue: (v: TripDayPlans) => void }) {
  const [value, setValue] = useState<TripDayPlans>({});
  return (
    <TripDayPlanFields
      fromDate="2026-11-11"
      toDate="2026-11-12"
      value={value}
      onChange={(v) => {
        setValue(v);
        onValue(v);
      }}
    />
  );
}

describe('khai giờ làm theo ngày khi tạo đơn công tác', () => {
  it('liệt kê ngày, kiểm tra khung giờ và chỉ lấy ngày đã khai', () => {
    const dates = tripDatesBetween('2026-11-11', '2026-11-13');
    expect(dates).toEqual(['2026-11-11', '2026-11-12', '2026-11-13']);
    expect(tripDatesBetween('2026-11-13', '2026-11-11')).toEqual([]);
    const plans = { '2026-11-12': [{ from: '18:00', to: '05:00' }], '2026-11-13': [{ from: '07:30', to: '17:00' }] };
    expect(tripDayPlanLines(plans, dates)).toEqual([{ date: '2026-11-12', windows: plans['2026-11-12'] }]);
    expect(tripDayPlansProblem(plans, dates)).toBe('');
    expect(tripDayPlansProblem({ '2026-11-12': [{ from: '', to: '05:00' }] }, dates)).toContain('đủ giờ');
  });

  it('làm tròn giờ về bội số 15 phút', () => {
    expect(snapToStep('07:10')).toBe('07:15');
    expect(snapToStep('07:07')).toBe('07:00');
    expect(snapToStep('23:58')).toBe('23:45');
  });

  it('hiện sẵn giờ mặc định từng ngày và ghi nhận khi sửa giờ', () => {
    const onValue = jest.fn();
    render(<Harness onValue={onValue} />);
    fireEvent.click(screen.getByRole('button', { name: 'Khai giờ dự kiến' }));
    const from = screen.getByLabelText('Từ giờ, Thứ 4, 11/11') as HTMLInputElement;
    expect(from.value).toBe('07:30');
    fireEvent.click(from);
    fireEvent.click(screen.getAllByRole('option', { name: '18:00' })[0]);
    expect(onValue).toHaveBeenCalledWith({ '2026-11-11': [{ from: '18:00', to: '17:00' }] });
  });
});
