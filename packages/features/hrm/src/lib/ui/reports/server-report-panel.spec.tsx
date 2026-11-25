/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { hrmFetch } from '../../hrm-api';
import { downloadXlsx } from '../../hrm-xlsx';
import { ServerReportPanel } from './server-report-panel';

jest.mock('../../hrm-api', () => {
  const actual = jest.requireActual('../../hrm-api');
  return { ...actual, hrmFetch: jest.fn() };
});
jest.mock('../../hrm-xlsx', () => ({ downloadXlsx: jest.fn() }));
jest.mock('../toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;
const exportMock = downloadXlsx as jest.MockedFunction<typeof downloadXlsx>;

const report = {
  kind: 'overtime',
  columns: [
    { key: 'employeeName', label: 'Họ và tên', defaultOn: true, type: 'text' },
    { key: 'department', label: 'Phòng ban', defaultOn: false, type: 'text' },
    { key: 'totalHours', label: 'Tổng số giờ', defaultOn: true, type: 'number' },
  ],
  rows: [
    { employeeName: 'Bùi Công Quyền', department: 'Phòng Thí nghiệm', totalHours: 17 },
    { employeeName: 'Bùi Duy Khánh', department: 'Văn phòng', totalHours: 36 },
  ],
  total: 2,
  truncated: false,
};

beforeEach(() => {
  fetchMock.mockReset();
  exportMock.mockReset();
  fetchMock.mockImplementation((async (path: string) => {
    if (path === '/reports/filter-options')
      return { data: { departments: [{ id: 'd1', name: 'Phòng Thí nghiệm' }], employees: [], leaveTypes: [] } };
    if (path.startsWith('/reports/overtime')) return { data: report };
    return { data: {} };
  }) as never);
});

const renderPanel = () =>
  render(<ServerReportPanel kind="overtime" label="Lam them gio" description="Báo cáo làm thêm" statusFilter />);

describe('ServerReportPanel', () => {
  it('tải theo tháng hiện tại, xem trước các cột mặc định và xuất đúng các cột đã chọn', async () => {
    renderPanel();
    await screen.findByText('Bùi Công Quyền');
    const url = String(fetchMock.mock.calls.find((c) => String(c[0]).startsWith('/reports/overtime'))?.[0]);
    expect(url).toMatch(/from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}/);
    expect(screen.queryByText('Phòng Thí nghiệm')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Xuất Excel/ }));
    expect(exportMock).toHaveBeenCalledTimes(1);
    const [fileName, rows] = exportMock.mock.calls[0];
    expect(fileName).toMatch(/^Lam-them-gio_\d{8}_\d{8}$/);
    expect(rows).toEqual([
      ['Họ và tên', 'Tổng số giờ'],
      ['Bùi Công Quyền', 17],
      ['Bùi Duy Khánh', 36],
    ]);
  });

  it('chọn thêm cột thì xem trước và file Excel có thêm cột đó', async () => {
    renderPanel();
    await screen.findByText('Bùi Công Quyền');
    fireEvent.click(screen.getByRole('button', { name: /Cột xuất/ }));
    fireEvent.click(await screen.findByRole('option', { name: /Phòng ban/ }).then((o) => o.querySelector('button') as HTMLButtonElement));
    await screen.findAllByText('Phòng Thí nghiệm');
    fireEvent.click(screen.getByRole('button', { name: /Xuất Excel/ }));
    expect((exportMock.mock.calls[0][1] as unknown[][])[0]).toEqual(['Họ và tên', 'Phòng ban', 'Tổng số giờ']);
  });

  it('đổi tháng chưa gọi máy chủ; bấm Xem báo cáo mới tải lại theo tháng mới', async () => {
    renderPanel();
    await screen.findByText('Bùi Công Quyền');
    const firstFrom = /from=(\d{4}-\d{2})-01/.exec(String(fetchMock.mock.calls.find((c) => String(c[0]).startsWith('/reports/overtime'))?.[0]))?.[1];
    fetchMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Tháng trước' }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Xem báo cáo/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const nextFrom = /from=(\d{4}-\d{2})-01/.exec(String(fetchMock.mock.calls[0][0]))?.[1];
    expect(nextFrom).toBeTruthy();
    expect(nextFrom).not.toBe(firstFrom);
  });
});
