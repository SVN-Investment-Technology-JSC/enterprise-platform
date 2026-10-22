/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { hrmFetch } from '../hrm-api';
import { toast } from '../ui/toast';
import AutoAttendanceScreen, { autoAttendanceError } from './auto-attendance-screen';

jest.mock('../hrm-api', () => {
  const actual = jest.requireActual('../hrm-api');
  return { ...actual, hrmFetch: jest.fn() };
});
jest.mock('../ui/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;

const settings = (over: object = {}) => ({
  enabled: false,
  weekdays: [] as number[],
  enabledFrom: null as string | null,
  ready: true,
  updatedAt: null,
  ...over,
});

function mockApi(initial: object) {
  fetchMock.mockImplementation((async (path: string, init?: RequestInit) => {
    if (path.startsWith('/auto-attendance-employees')) return { data: { active: [], history: [] }, ready: true };
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      return { data: settings({ ...body, enabledFrom: body.enabled ? '2026-10-15' : null }) };
    }
    return { data: initial };
  }) as never);
}

/** Ô chọn thứ của cấu hình chung (khối "Theo nhân viên" cũng có các ô thứ riêng). */
const day = (name: string) =>
  within(screen.getByRole('list', { name: 'Các thứ áp dụng' })).getByRole('checkbox', { name }) as HTMLInputElement;

beforeEach(() => {
  fetchMock.mockReset();
  (toast.success as jest.Mock).mockClear();
  (toast.error as jest.Mock).mockClear();
});

describe('autoAttendanceError', () => {
  it('bật mà chưa chọn thứ nào thì báo lỗi', () => {
    expect(autoAttendanceError(true, [])).toContain('ít nhất một thứ');
    expect(autoAttendanceError(true, [6])).toBeNull();
    expect(autoAttendanceError(false, [])).toBeNull();
  });
});

describe('AutoAttendanceScreen', () => {
  it('mặc định tắt: các thứ bị khóa và nút lưu chưa bấm được', async () => {
    mockApi(settings());
    render(<AutoAttendanceScreen />);
    expect(await screen.findByText('Hiện đang tắt.')).toBeTruthy();
    expect(day('T7').disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Lưu cấu hình' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('bật, chọn thứ Bảy rồi lưu: gửi enabled và weekdays, báo đã bật', async () => {
    mockApi(settings());
    render(<AutoAttendanceScreen />);
    await screen.findByText('Hiện đang tắt.');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bật chấm công tự động' }));
    fireEvent.click(day('T7'));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Đã bật chấm công tự động'));
    const put = fetchMock.mock.calls.find(
      (call) => call[0] === '/auto-attendance-settings' && (call[1] as RequestInit | undefined)?.method === 'PUT',
    );
    expect(JSON.parse(String((put?.[1] as RequestInit).body))).toEqual({ enabled: true, weekdays: [6] });
    expect(await screen.findByTestId('auto-attendance-since')).toBeTruthy();
  });

  it('bật nhưng chưa chọn thứ nào thì không gọi API', async () => {
    mockApi(settings());
    render(<AutoAttendanceScreen />);
    await screen.findByText('Hiện đang tắt.');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bật chấm công tự động' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
    expect(toast.error).toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some(
        (call) => call[0] === '/auto-attendance-settings' && (call[1] as RequestInit | undefined)?.method === 'PUT',
      ),
    ).toBe(false);
  });

  it('đang bật: hiện ngày bắt đầu áp dụng và tắt được mà không cần chọn thứ', async () => {
    mockApi(settings({ enabled: true, weekdays: [6], enabledFrom: '2026-10-10' }));
    render(<AutoAttendanceScreen />);
    const since = await screen.findByTestId('auto-attendance-since');
    expect(within(since).getByText(/10\/10\/2026/)).toBeTruthy();
    expect(day('T7').checked).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bật chấm công tự động' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Đã tắt chấm công tự động'));
  });

  it('chưa chạy migration: báo rõ và khóa toàn bộ', async () => {
    mockApi(settings({ ready: false }));
    render(<AutoAttendanceScreen />);
    expect(await screen.findByText(/migration 0055/)).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'Bật chấm công tự động' }) as HTMLInputElement).disabled).toBe(true);
  });
});
