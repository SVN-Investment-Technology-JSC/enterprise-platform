/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { hrmFetch } from '../hrm-api';
import TimesheetStandardScreen, { draftError, monthOptions } from './timesheet-standard-screen';

jest.mock('../hrm-api', () => {
  const actual = jest.requireActual('../hrm-api');
  return { ...actual, hrmFetch: jest.fn() };
});
jest.mock('../ui/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;

const policy = (id: string, effectiveMonth: string, over: object = {}) => ({
  id,
  effectiveMonth,
  mode: 'FIXED',
  workdays: 24,
  note: null,
  updatedAt: '2026-09-01T00:00:00Z',
  ...over,
});

let state: { policies: ReturnType<typeof policy>[]; currentMonth: string; currentId: string | null };

beforeEach(() => {
  fetchMock.mockReset();
  state = {
    // Mới nhất trước: một chính sách sắp áp dụng, một đang áp dụng, một đã thay thế.
    policies: [
      policy('p3', '2027-01', { mode: 'DYNAMIC', workdays: null, note: 'Về công chuẩn động' }),
      policy('p2', '2026-09', { workdays: 24, note: 'Theo thỏa thuận' }),
      policy('p1', '2026-01', { workdays: 26 }),
    ],
    currentMonth: '2026-10',
    currentId: 'p2',
  };
  fetchMock.mockImplementation((async (path: string, init?: RequestInit) => {
    if (init?.method === 'POST' || init?.method === 'DELETE') return { data: {} };
    return { data: state };
  }) as never);
});

describe('draftError', () => {
  it('cần tháng hợp lệ, không ở quá khứ; cố định cần 1 đến 31 ngày, bước 0,5', () => {
    const base = { effectiveMonth: '2026-10', mode: 'DYNAMIC' as const, workdays: '', note: '' };
    expect(draftError(base, '2026-10')).toBeNull();
    expect(draftError({ ...base, effectiveMonth: '' }, '2026-10')).toMatch(/Chọn tháng/);
    expect(draftError({ ...base, effectiveMonth: '2026-09' }, '2026-10')).toMatch(/quá khứ/);
    expect(draftError({ ...base, mode: 'FIXED', workdays: '24.5' }, '2026-10')).toBeNull();
    expect(draftError({ ...base, mode: 'FIXED', workdays: '' }, '2026-10')).toMatch(/từ 1 đến 31/);
    expect(draftError({ ...base, mode: 'FIXED', workdays: '24.3' }, '2026-10')).toMatch(/bước 0,5/);
  });
});

describe('monthOptions', () => {
  it('liệt kê các tháng dạng "Tháng x/năm" từ tháng hiện tại, qua năm mới đúng', () => {
    const options = monthOptions('2026-11', 4);
    expect(options).toEqual([
      { value: '2026-11', label: 'Tháng 11/2026' },
      { value: '2026-12', label: 'Tháng 12/2026' },
      { value: '2027-01', label: 'Tháng 1/2027' },
      { value: '2027-02', label: 'Tháng 2/2027' },
    ]);
    expect(monthOptions('', 3)).toEqual([]);
  });
});

describe('TimesheetStandardScreen', () => {
  it('hiện các chính sách kèm trạng thái: đang áp dụng, sắp áp dụng, đã thay thế', async () => {
    render(<TimesheetStandardScreen />);
    const current = await screen.findByTestId('standard-policy-2026-09');
    expect(within(current).getByText('Đang áp dụng')).toBeTruthy();
    expect(within(current).getByText('Cố định 24 ngày công')).toBeTruthy();
    expect(within(current).getByText('Theo thỏa thuận')).toBeTruthy();
    expect(within(screen.getByTestId('standard-policy-2027-01')).getByText('Sắp áp dụng')).toBeTruthy();
    expect(within(screen.getByTestId('standard-policy-2026-01')).getByText('Đã thay thế')).toBeTruthy();
    // Đã có chính sách đang áp dụng nên dòng mặc định là đã thay thế
    expect(within(screen.getByTestId('standard-policy-default')).getByText('Đã thay thế')).toBeTruthy();
  });

  it('chỉ chính sách sắp áp dụng mới có nút Xóa; xóa gọi DELETE', async () => {
    render(<TimesheetStandardScreen />);
    await screen.findByTestId('standard-policy-2026-09');
    expect(screen.queryByRole('button', { name: /Xóa chính sách từ tháng 09\/2026/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Xóa chính sách từ tháng 01\/2026/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Xóa chính sách từ tháng 01/2027' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/timesheet-standards/p3', expect.objectContaining({ method: 'DELETE' })),
    );
  });

  it('chưa có chính sách nào thì dòng mặc định (động) đang áp dụng', async () => {
    state = { policies: [], currentMonth: '2026-10', currentId: null };
    render(<TimesheetStandardScreen />);
    const row = await screen.findByTestId('standard-policy-default');
    expect(within(row).getByText('Đang áp dụng')).toBeTruthy();
  });

  it('ban hành chính sách cố định gửi POST với tháng, số ngày và ghi chú', async () => {
    render(<TimesheetStandardScreen />);
    await screen.findByTestId('standard-policy-2026-09');
    // Chọn tháng áp dụng từ danh sách "Tháng x/năm" (ô chọn đầu tiên), rồi cách tính (ô thứ hai).
    fireEvent.click(screen.getAllByRole('textbox')[0]);
    fireEvent.click(await screen.findByRole('option', { name: 'Tháng 11/2026' }));
    fireEvent.click(screen.getAllByRole('textbox')[1]);
    fireEvent.click(await screen.findByRole('option', { name: 'Cố định số ngày công' }));
    fireEvent.change(screen.getByLabelText('Số ngày công chuẩn'), { target: { value: '24.5' } });
    fireEvent.change(screen.getByLabelText('Ghi chú chính sách'), { target: { value: 'Quý 4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ban hành' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/timesheet-standards',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ effectiveMonth: '2026-11', mode: 'FIXED', workdays: 24.5, note: 'Quý 4' }),
        }),
      ),
    );
  });

  it('cố định mà chưa nhập số ngày thì không gửi; danh sách tháng không có tháng quá khứ', async () => {
    render(<TimesheetStandardScreen />);
    await screen.findByTestId('standard-policy-2026-09');
    fireEvent.click(screen.getAllByRole('textbox')[0]);
    expect(await screen.findByRole('option', { name: 'Tháng 10/2026' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Tháng 9/2026' })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: 'Tháng 10/2026' }));
    fireEvent.click(screen.getAllByRole('textbox')[1]);
    fireEvent.click(await screen.findByRole('option', { name: 'Cố định số ngày công' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ban hành' }));
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });
});
