/** @jest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import type { HrmPayrollTrace } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { PayrollTraceDrawer } from './payroll-trace-drawer';

jest.mock('../hrm-api', () => {
  const actual = jest.requireActual('../hrm-api');
  return { ...actual, hrmFetch: jest.fn() };
});
const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;

const trace = (over: Partial<HrmPayrollTrace> = {}): HrmPayrollTrace => ({
  run: { id: 'run1', status: 'CALCULATED', calculatedAt: '2026-09-05T01:00:00.000Z', stale: false },
  period: { from: '2026-08-01', to: '2026-08-31', timesheetPeriodId: 'tp1' },
  employee: { id: 'e1', code: 'NV001', name: 'Nguyễn Văn An' },
  inputs: { PAID_MINUTES: 9600 },
  totals: {
    scheduledMinutes: 10080,
    paidMinutes: 9600,
    workedMinutes: 8000,
    otMinutes: 120,
    lateMinutes: 0,
    earlyMinutes: 0,
    workdayUnits: 20,
    tripAllowanceAmount: 300000,
  },
  days: [
    {
      date: '2026-08-07',
      status: 'BUSINESS_TRIP',
      scheduledMinutes: 480,
      workedMinutes: 0,
      paidMinutes: 480,
      otMinutes: 0,
      lateMinutes: 0,
      earlyMinutes: 0,
      workdayUnits: 1,
      tripAllowanceAmount: 300000,
      adjusted: false,
      anomalies: [],
      sources: [{ kind: 'TRIP', id: 'trip-1', minutes: null, label: 'Đà Nẵng' }],
    },
    {
      date: '2026-08-08',
      status: 'OFF',
      scheduledMinutes: 0,
      workedMinutes: 0,
      paidMinutes: 0,
      otMinutes: 0,
      lateMinutes: 0,
      earlyMinutes: 0,
      workdayUnits: 0,
      tripAllowanceAmount: 0,
      adjusted: false,
      anomalies: [],
      sources: [],
    },
  ],
  reconciled: true,
  differences: [],
  ...over,
});

beforeEach(() => fetchMock.mockReset());

describe('PayrollTraceDrawer', () => {
  it('hiển thị đối soát khớp, tổng đầu vào và đơn tác động từng ngày có link mở đơn', async () => {
    fetchMock.mockResolvedValue({ data: trace() } as never);
    render(<PayrollTraceDrawer runId="run1" employeeId="e1" onClose={jest.fn()} />);
    expect(await screen.findByText(/Khớp: tổng từng ngày công/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/payroll-runs/run1/employees/e1/trace');
    const table = screen.getByRole('table', { name: 'Công từng ngày' });
    // Ngày nghỉ không phát sinh gì bị ẩn; ngày công tác hiển thị đơn kèm link.
    expect(within(table).queryByText('08/08/2026')).toBeNull();
    const link = within(table).getByRole('link');
    expect(link.textContent).toContain('Đơn công tác: Đà Nẵng');
    expect(link.getAttribute('href')).toBe('/approvals?type=business_trip&request=trip-1');
    expect(screen.getAllByText('Công tác phí').length).toBe(2);
  });

  it('lệch bảng công: báo cần tính lại lương và liệt kê chênh lệch', async () => {
    fetchMock.mockResolvedValue({
      data: trace({ reconciled: false, differences: ['PAID_MINUTES: lương dùng 9600, bảng công hiện tại 9360'] }),
    } as never);
    render(<PayrollTraceDrawer runId="run1" employeeId="e1" onClose={jest.fn()} />);
    const box = await screen.findByTestId('trace-reconciliation');
    expect(box.textContent).toContain('Lệch: bảng công đã thay đổi sau khi tính lương');
    expect(box.textContent).toContain('lương dùng 9600');
  });

  it('không chọn nhân viên thì không gọi API; lỗi tải hiển thị cảnh báo', async () => {
    const view = render(<PayrollTraceDrawer runId="run1" employeeId={null} onClose={jest.fn()} />);
    expect(fetchMock).not.toHaveBeenCalled();
    view.unmount();
    fetchMock.mockRejectedValue(new Error('Không tìm thấy lần tính lương'));
    render(<PayrollTraceDrawer runId="run1" employeeId="e1" onClose={jest.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Không tìm thấy lần tính lương');
  });
});
