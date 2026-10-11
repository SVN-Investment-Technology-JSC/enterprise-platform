/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { hrmFetch } from '../hrm-api';
import { RequestTimeRange } from './request-time-range';

jest.mock('../hrm-api', () => ({ hrmFetch: jest.fn() }));
const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;

const preview = (over: Record<string, unknown> = {}) => ({
  fromAt: 'a',
  toAt: 'b',
  timezone: 'Asia/Ho_Chi_Minh',
  totalMinutes: 150,
  totalHours: 2.5,
  totalDays: 0.5,
  days: [],
  warnings: [],
  errors: [],
  ...over,
});

beforeEach(() => {
  jest.useFakeTimers();
  fetchMock.mockReset();
});
afterEach(() => {
  jest.useRealTimers();
});

async function settle() {
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
}

describe('RequestTimeRange', () => {
  it('hỏi máy chủ số giờ và ngày công sau khi chọn đủ khoảng, hiển thị và báo cho form cha', async () => {
    fetchMock.mockResolvedValue({ data: preview({ warnings: ['Có một ngày lễ trong khoảng.'] }) } as never);
    const onPreview = jest.fn();
    render(
      <RequestTimeRange
        employeeId="e1"
        fromAt="2026-11-02T09:00"
        toAt="2026-11-02T11:30"
        leaveTypeId="lt1"
        onChange={jest.fn()}
        onPreview={onPreview}
      />,
    );
    await settle();
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('2,5 giờ (0,5 ngày công)'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const path = String(fetchMock.mock.calls[0][0]);
    expect(path).toContain('/requests/time-preview?');
    expect(path).toContain('employeeId=e1');
    expect(path).toContain('leaveTypeId=lt1');
    expect(screen.getByText('Có một ngày lễ trong khoảng.')).toBeTruthy();
    expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ totalMinutes: 150 }));
  });

  it('thời điểm kết thúc không sau bắt đầu: báo lỗi và không gọi máy chủ', async () => {
    render(
      <RequestTimeRange
        employeeId="e1"
        fromAt="2026-11-02T11:00"
        toAt="2026-11-02T09:00"
        onChange={jest.fn()}
      />,
    );
    await settle();
    expect(screen.getByRole('alert').textContent).toBe('Thời điểm kết thúc phải sau thời điểm bắt đầu.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lỗi chặn của máy chủ hiện cho người dùng', async () => {
    fetchMock.mockResolvedValue({
      data: preview({ totalMinutes: 0, totalDays: 0, errors: ['Chưa phân ca cho ngày 02/11/2026.'] }),
    } as never);
    render(
      <RequestTimeRange
        employeeId="e1"
        fromAt="2026-11-02T09:00"
        toAt="2026-11-02T11:30"
        onChange={jest.fn()}
      />,
    );
    await settle();
    await waitFor(() => expect(screen.getByText('Chưa phân ca cho ngày 02/11/2026.')).toBeTruthy());
  });

  it('showPreview=false (loại tuỳ chỉnh) không gọi máy chủ', async () => {
    render(
      <RequestTimeRange
        employeeId="e1"
        fromAt="2026-11-02T09:00"
        toAt="2026-11-02T11:30"
        showPreview={false}
        onChange={jest.fn()}
      />,
    );
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('chọn ngày bắt đầu sau ngày kết thúc thì kéo ngày kết thúc theo và giữ giờ kết thúc', async () => {
    fetchMock.mockResolvedValue({ data: preview() } as never);
    const onChange = jest.fn();
    render(
      <RequestTimeRange
        employeeId="e1"
        fromAt="2026-11-02T09:00"
        toAt="2026-11-02T17:00"
        onChange={onChange}
      />,
    );
    const date = screen.getByLabelText('Từ ngày giờ (ngày)') as HTMLInputElement;
    fireEvent.change(date, { target: { value: '05/11/2026' } });
    fireEvent.blur(date);
    await settle();
    expect(onChange).toHaveBeenCalledWith({
      fromAt: '2026-11-05T09:00',
      toAt: '2026-11-05T17:00',
    });
  });

  it('phản hồi sai hình dạng (máy chủ cũ) thì bỏ qua, không hiển thị', async () => {
    fetchMock.mockResolvedValue({ data: [] } as never);
    render(
      <RequestTimeRange
        employeeId="e1"
        fromAt="2026-11-02T09:00"
        toAt="2026-11-02T11:30"
        onChange={jest.fn()}
      />,
    );
    await settle();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
