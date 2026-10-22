/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { hrmFetch } from '../hrm-api';
import { toast } from './toast';
import {
  AutoAttendanceEmployeesPanel,
  autoAttendanceEmployeeError,
  rangeLabel,
  weekdaysLabel,
} from './auto-attendance-employees-panel';

jest.mock('../hrm-api', () => {
  const actual = jest.requireActual('../hrm-api');
  return {
    ...actual,
    hrmFetch: jest.fn(),
    hrmEmployeeOptions: jest.fn(async () => [{ value: 'e1', label: 'NV001 · An' }]),
  };
});
jest.mock('./toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;

const row = (over: object = {}) => ({
  id: 'r1',
  employeeId: 'e1',
  employeeCode: 'NV001',
  fullName: 'An',
  weekdays: null,
  fromDate: '2026-10-01',
  toDate: null,
  reason: 'Không chấm vân tay',
  createdAt: null,
  updatedAt: null,
  removedAt: null,
  ...over,
});

beforeEach(() => {
  fetchMock.mockReset();
  (toast.success as jest.Mock).mockClear();
  (toast.error as jest.Mock).mockClear();
});

describe('autoAttendanceEmployeeError', () => {
  it('cần nhân viên và lý do; ngày kết thúc không trước ngày bắt đầu', () => {
    expect(autoAttendanceEmployeeError({ employeeId: '', reason: 'x', fromDate: '', toDate: '' })).toContain('nhân viên');
    expect(autoAttendanceEmployeeError({ employeeId: 'e', reason: ' ', fromDate: '', toDate: '' })).toContain('lý do');
    expect(
      autoAttendanceEmployeeError({ employeeId: 'e', reason: 'x', fromDate: '2026-10-02', toDate: '2026-10-01' }),
    ).toContain('kết thúc');
    expect(autoAttendanceEmployeeError({ employeeId: 'e', reason: 'x', fromDate: '', toDate: '' })).toBeNull();
  });

  it('nhãn thứ và khoảng ngày', () => {
    expect(weekdaysLabel(null)).toBe('Mọi ngày có ca');
    expect(weekdaysLabel([6, 1])).toBe('T2, T7');
    expect(rangeLabel({ fromDate: '2026-10-01', toDate: null })).toBe('01/10/2026 - chưa kết thúc');
  });
});

describe('AutoAttendanceEmployeesPanel', () => {
  it('hiện danh sách đang áp dụng kèm lý do và gỡ được', async () => {
    fetchMock.mockImplementation((async (_path: string, init?: RequestInit) =>
      init?.method === 'DELETE'
        ? { data: row({ removedAt: '2026-10-19T00:00:00Z' }) }
        : { data: { active: [row()], history: [] }, ready: true }) as never);
    render(<AutoAttendanceEmployeesPanel />);
    expect(await screen.findByText(/Không chấm vân tay/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Gỡ' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Đã gỡ chấm công tự động của nhân viên'));
    expect(fetchMock).toHaveBeenCalledWith('/auto-attendance-employees/r1', { method: 'DELETE' });
  });

  it('chưa chọn nhân viên hoặc chưa nhập lý do thì nút lưu bị khóa và không gọi API', async () => {
    fetchMock.mockResolvedValue({ data: { active: [], history: [] }, ready: true } as never);
    render(<AutoAttendanceEmployeesPanel />);
    await screen.findByText('Chưa có nhân viên nào.');
    expect((screen.getByRole('button', { name: 'Lưu cho nhân viên' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'PUT')).toBe(false);
  });

  it('chưa chạy migration 0066: báo rõ và khóa lưu', async () => {
    fetchMock.mockResolvedValue({ data: { active: [], history: [] }, ready: false } as never);
    render(<AutoAttendanceEmployeesPanel />);
    expect(await screen.findByText(/migration 0066/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Lưu cho nhân viên' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('mở lịch sử đã gỡ', async () => {
    fetchMock.mockResolvedValue({
      data: { active: [], history: [row({ id: 'h1', reason: 'Nghỉ việc', removedAt: '2026-10-18T00:00:00Z' })] },
      ready: true,
    } as never);
    render(<AutoAttendanceEmployeesPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /Lịch sử đã gỡ \(1\)/ }));
    expect(await screen.findByText(/Nghỉ việc/)).toBeTruthy();
  });
});
