import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CustomerSummary, ProjectSummary } from '@enterprise-platform/contracts-workspace';
import { listAllProjects, listProjectReportGroups } from '../workspace-api';
import { downloadProjectReportXlsx, downloadProjectsXlsx } from '../project-export-xlsx';
import { PROJECT_CELL_WRAP_STORAGE_KEY } from '../project-cell-wrap';
import type { ProjectReportSheet } from '../project-report-export';
import { ProjectsListView } from './projects-list-view';

jest.mock('../workspace-api', () => ({
  listAllProjects: jest.fn(),
  listProjects: jest.fn().mockResolvedValue({ items: [], total: 0 }),
  listCustomers: jest.fn(),
  listProjectTypes: jest.fn().mockResolvedValue({ items: [] }),
  listProjectGroups: jest.fn().mockResolvedValue({ items: [], canEdit: false }),
  listTags: jest.fn().mockResolvedValue({ items: [] }),
  loadDirectory: jest.fn().mockResolvedValue({ people: [], degraded: false }),
  listProjectReportGroups: jest.fn(),
  listMembers: jest.fn().mockResolvedValue({ items: [] }),
}));

// Hộp tạo dự án không thuộc phạm vi các ca này (và kéo theo nhiều API khác).
jest.mock('./project-form', () => ({ ProjectForm: () => null }));

jest.mock('../project-export-xlsx', () => ({
  downloadProjectsXlsx: jest.fn(),
  downloadProjectReportXlsx: jest.fn(),
}));

jest.mock('@enterprise-platform/shared-ui', () => ({
  ...jest.requireActual('@enterprise-platform/shared-ui'),
  toast: { error: jest.fn(), success: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));

const listCustomersMock = jest.requireMock('../workspace-api').listCustomers as jest.Mock;
const listAll = listAllProjects as jest.Mock;
const listReportGroups = listProjectReportGroups as jest.Mock;
const downloadReport = downloadProjectReportXlsx as jest.Mock;

const LONG_NAME = 'Thí nghiệm định kỳ thiết bị điện trạm biến áp 110kV và đường dây đấu nối nhà máy điện mặt trời';
const LONG_CUSTOMER = 'Công ty Cổ phần Năng lượng Lộc Ninh 4 - Chi nhánh Bình Phước';

const project = (patch: Partial<ProjectSummary>): ProjectSummary =>
  ({
    id: 'p-1',
    code: '26/703/',
    name: LONG_NAME,
    status: 'active',
    ownerUserId: 'u-1',
    createdBy: 'u-1',
    customerId: 'k-1',
    progressPercent: 0,
    progressMethod: 'avg_tasks',
    metadata: {},
    createdAt: '2026-10-23T02:17:00.000Z',
    updatedAt: '2026-10-23T02:17:00.000Z',
    totalItems: 0,
    closedItems: 0,
    overdueItems: 0,
    ...patch,
  }) as unknown as ProjectSummary;

const CUSTOMER = { id: 'k-1', code: 'KH-LN4', name: LONG_CUSTOMER } as unknown as CustomerSummary;

async function renderList() {
  render(<ProjectsListView onOpenProject={jest.fn()} />);
  // Tab "Tất cả" để thấy thẳng dòng dự án (các tab khác gom nhóm và mới vào thì thu gọn).
  fireEvent.click(screen.getByRole('tab', { name: 'Tất cả' }));
  await screen.findByText(LONG_NAME);
  return screen.getByRole('table');
}

beforeEach(() => {
  window.localStorage.clear();
  listCustomersMock.mockResolvedValue([CUSTOMER]);
  listAll.mockResolvedValue([project({ reportGroupId: 'g-tn' })]);
  listReportGroups.mockResolvedValue({
    items: [
      { id: 'g-dv', name: 'Dịch vụ', sortOrder: 1 },
      { id: 'g-tn', name: 'Thí nghiệm', sortOrder: 2 },
    ],
    canEdit: false,
  });
  downloadReport.mockReset();
  (downloadProjectsXlsx as jest.Mock).mockReset();
});

afterEach(cleanup);

describe('bảng dự án: xuống dòng hay gọn một dòng', () => {
  it('mặc định chữ xuống dòng; cột khách hàng chỉ hiện mã cho gọn, tên khách hàng chỉ hiện khi rê chuột', async () => {
    const table = await renderList();
    expect(table.className).toContain('projectsWrap');
    expect(within(table).queryByText(LONG_CUSTOMER)).toBeNull();
    expect(screen.getByRole('button', { name: /Xuống dòng/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('bấm "Xuống dòng" để gọn một dòng; lựa chọn được nhớ cho lần mở sau', async () => {
    const table = await renderList();
    fireEvent.click(screen.getByRole('button', { name: /Xuống dòng/ }));
    expect(table.className).not.toContain('projectsWrap');
    expect(within(table).queryByText(LONG_CUSTOMER)).toBeNull();
    expect(screen.getByRole('button', { name: /Gọn một dòng/ }).getAttribute('aria-pressed')).toBe('false');
    expect(window.localStorage.getItem(PROJECT_CELL_WRAP_STORAGE_KEY)).toBe('compact');

    cleanup();
    const again = await renderList();
    await waitFor(() => expect(again.className).not.toContain('projectsWrap'));
  });

  it('STT vẫn đánh số và căn phải như cột số', async () => {
    const table = await renderList();
    const cell = within(table).getByText('1');
    expect(cell.className).toContain('numeric');
  });
});

describe('xuất theo nhóm báo cáo', () => {
  const openReportDialog = async () => {
    await renderList();
    fireEvent.click(screen.getByRole('button', { name: /Export/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Xuất theo nhóm báo cáo' }));
    expect(screen.getByRole('heading', { name: 'Xuất theo nhóm báo cáo' })).toBeTruthy();
  };
  // Nút "Export" của hộp thoại (nút cùng tên trên thanh công cụ đứng trước nó).
  const submit = () => screen.getAllByRole('button', { name: 'Export' }).at(-1) as HTMLElement;

  it('không xem được giá trị hợp đồng: báo trước các cột số sẽ trống, vẫn xuất được', async () => {
    await openReportDialog();
    expect(screen.getByText('Bạn không xem được giá trị hợp đồng nên các cột số sẽ trống.')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Báo cáo doanh thu theo lĩnh vực/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
    await act(async () => {
      fireEvent.click(submit());
    });
    await waitFor(() => expect(downloadReport).toHaveBeenCalledTimes(1));
    const [fileName, sheet] = downloadReport.mock.calls[0] as [string, ProjectReportSheet];
    expect(fileName).toMatch(/^Bao-cao-doanh-thu-theo-linh-vuc-ngay-\d{8}\.xlsx$/);
    expect(sheet.groupColumns.map((column) => column.label)).toEqual(['Dịch vụ', 'Thí nghiệm']);
    expect(sheet.projectCount).toBe(1);
    // Cùng tập dự án như cách xuất danh sách: mọi dự án xem được, không theo tab hay bộ lọc.
    expect(listAll).toHaveBeenLastCalledWith(20, {});
    expect(downloadProjectsXlsx).not.toHaveBeenCalled();
  });

  it('có giá trị hợp đồng: không hiện lời báo; đổi về kiểu chọn trường thì xuất danh sách như cũ', async () => {
    listAll.mockResolvedValue([project({ reportGroupId: 'g-tn', contractValue: 1_000 })]);
    await openReportDialog();
    expect(screen.queryByText('Bạn không xem được giá trị hợp đồng nên các cột số sẽ trống.')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Danh sách dự án/ }));
    expect(screen.getByText('Chọn tất cả')).toBeTruthy();
    await act(async () => {
      fireEvent.click(submit());
    });
    await waitFor(() => expect(downloadProjectsXlsx).toHaveBeenCalledTimes(1));
    expect(downloadReport).not.toHaveBeenCalled();
  });
});
