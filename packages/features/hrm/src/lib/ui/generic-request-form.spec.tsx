/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import type { HrmRequestType } from '@enterprise-platform/contracts-hrm';
import {
  GenericRequestForm,
  customTimeError,
  isFieldBlank,
  missingRequiredFields,
} from './generic-request-form';

jest.mock('../hrm-api', () => ({ hrmFetch: jest.fn(async () => ({ data: null })) }));

const type = (over: Partial<HrmRequestType> = {}): HrmRequestType => ({
  id: 't1',
  tenantId: 'x',
  code: 'DI_MUON',
  name: 'Xin đi muộn',
  description: null,
  engine: 'GENERIC',
  kind: 'custom',
  timeMode: 'NONE',
  requiresAttachment: false,
  fields: [],
  icon: null,
  isSystem: false,
  active: true,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('kiểm tra form loại đơn tuỳ chỉnh', () => {
  it('trường trống: chuỗi rỗng, khoảng trắng; checkbox không bao giờ coi là trống', () => {
    const text = { key: 'a', label: 'A', type: 'text' as const, required: true };
    expect(isFieldBlank(text, undefined)).toBe(true);
    expect(isFieldBlank(text, '   ')).toBe(true);
    expect(isFieldBlank(text, 'x')).toBe(false);
    expect(isFieldBlank(text, 0)).toBe(false);
    expect(isFieldBlank({ key: 'c', label: 'C', type: 'checkbox', required: true }, false)).toBe(false);
  });

  it('liệt kê trường bắt buộc còn thiếu theo thứ tự khai báo', () => {
    const fields = [
      { key: 'a', label: 'Nơi đến', type: 'text' as const, required: true },
      { key: 'b', label: 'Ghi chú', type: 'textarea' as const },
      { key: 'c', label: 'Số người', type: 'number' as const, required: true },
    ];
    expect(missingRequiredFields(fields, { a: 'Hà Nội' }).map((f) => f.label)).toEqual(['Số người']);
    expect(missingRequiredFields(fields, {}).map((f) => f.label)).toEqual(['Nơi đến', 'Số người']);
  });

  it('thời gian theo chế độ của loại đơn', () => {
    expect(customTimeError('NONE', '', '')).toBe('');
    expect(customTimeError('SINGLE_DATE', '', '')).toBe('Vui lòng chọn ngày.');
    expect(customTimeError('SINGLE_DATE', '2026-11-02', '')).toBe('');
    expect(customTimeError('DATE_RANGE', '2026-11-02', '')).toBe('Vui lòng chọn từ ngày và đến ngày.');
    expect(customTimeError('DATE_RANGE', '2026-11-03', '2026-11-02')).toBe(
      'Đến ngày phải từ ngày bắt đầu trở đi.',
    );
    expect(customTimeError('DATE_RANGE', '2026-11-02', '2026-11-02')).toBe('');
    expect(customTimeError('RANGE_DATETIME', '', '')).toBe('Vui lòng chọn từ ngày giờ và đến ngày giờ.');
    expect(customTimeError('RANGE_DATETIME', '2026-11-02T09:00', '2026-11-02T09:00')).toBe(
      'Thời điểm kết thúc phải sau thời điểm bắt đầu.',
    );
    expect(customTimeError('RANGE_DATETIME', '2026-11-02T09:00', '2026-11-02T11:30')).toBe('');
  });
});

describe('GenericRequestForm', () => {
  const noop = () => undefined;

  it('khoảng ngày giờ hiện hai ô từ và đến; không có thời gian thì không hiện ô nào', () => {
    const { rerender } = render(
      <GenericRequestForm
        type={type({ timeMode: 'RANGE_DATETIME' })}
        employeeId="e1"
        fromAt=""
        toAt=""
        onTimeChange={noop}
        values={{}}
        onValuesChange={noop}
      />,
    );
    expect(screen.getByLabelText('Từ ngày giờ (ngày)')).toBeTruthy();
    expect(screen.getByLabelText('Đến ngày giờ (giờ)')).toBeTruthy();
    rerender(
      <GenericRequestForm
        type={type({ timeMode: 'NONE' })}
        employeeId="e1"
        fromAt=""
        toAt=""
        onTimeChange={noop}
        values={{}}
        onValuesChange={noop}
      />,
    );
    expect(screen.queryByLabelText('Từ ngày giờ (ngày)')).toBeNull();
  });

  it('dựng trường theo khai báo và trả giá trị mới qua onValuesChange', () => {
    const onValuesChange = jest.fn();
    render(
      <GenericRequestForm
        type={type({
          fields: [
            { key: 'noi_den', label: 'Nơi đến', type: 'text', required: true },
            { key: 'so_nguoi', label: 'Số người', type: 'number' },
            { key: 'can_xe', label: 'Cần xe', type: 'checkbox' },
          ],
        })}
        employeeId="e1"
        fromAt=""
        toAt=""
        onTimeChange={noop}
        values={{ noi_den: 'A' }}
        onValuesChange={onValuesChange}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Nơi đến/), { target: { value: 'Hà Nội' } });
    expect(onValuesChange).toHaveBeenLastCalledWith({ noi_den: 'Hà Nội' });
    fireEvent.change(screen.getByLabelText(/Số người/), { target: { value: '3' } });
    expect(onValuesChange).toHaveBeenLastCalledWith({ noi_den: 'A', so_nguoi: 3 });
    fireEvent.click(screen.getByLabelText(/Cần xe/));
    expect(onValuesChange).toHaveBeenLastCalledWith({ noi_den: 'A', can_xe: true });
  });
});
