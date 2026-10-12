import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HrmCrumbsProvider } from '../hrm-crumbs';
import { SettingsCenter, useSettingsEmbedded } from './settings-center';

let mockView: string | null = null;
let mockTab: string | null = null;
let mockActions: string[] = [];
const mockReplace = jest.fn();

jest.mock('next/navigation', () => ({
  usePathname: () => '/settings',
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'view' ? mockView : key === 'tab' ? mockTab : null),
  }),
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    children,
    scroll: _scroll,
    replace: _replace,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    scroll?: boolean;
    replace?: boolean;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
jest.mock('../hrm-permissions', () => ({
  useHrmPermissions: () => ({
    can: (p: string) => mockActions.includes(p),
    any: (ps: readonly string[]) => ps.some((p) => mockActions.includes(p)),
  }),
}));

const Probe = () => <p data-testid="embedded">{String(useSettingsEmbedded())}</p>;
const Named = (name: string) => () => <p>{name}</p>;
const screens = {
  leave: Named('Màn phép năm'),
  time: Probe,
  schedules: Named('Màn phân ca'),
  shifts: Named('Màn danh mục ca'),
  payroll: Named('Màn lương'),
  'request-reasons': Named('Màn loại đơn'),
  approval: Named('Màn quy trình duyệt'),
  operations: Named('Màn vận hành'),
  permissions: Named('Màn quyền'),
};

const ADMIN = [
  'hrm.leave.manage',
  'hrm.time.configure',
  'hrm.device.manage',
  'hrm.schedule.read',
  'hrm.shift.read',
  'hrm.payroll.configure',
  'hrm.automation.manage',
  'hrm.integration.manage',
  'hrm.audit.read',
  'hrm.manage',
];

beforeEach(() => {
  try {
    localStorage.removeItem('hrm_settings_nav_hidden');
  } catch {
    /* bỏ qua */
  }
  mockView = null;
  mockTab = null;
  mockActions = ADMIN;
  mockReplace.mockReset();
});

describe('SettingsCenter', () => {
  it('mặc định là trang tổng quan: thẻ theo nhóm chức năng, số mục cấu hình và nút lịch sử thay đổi', () => {
    render(<SettingsCenter screens={screens} />);
    expect(screen.getByRole('heading', { name: 'Trung tâm cấu hình HRM' })).toBeTruthy();
    for (const id of ['leave', 'time', 'schedule', 'request', 'payroll', 'system'])
      expect(screen.getByTestId(`settings-group-${id}`)).toBeTruthy();
    expect(screen.getByTestId('settings-count').textContent).toContain('12 mục cấu hình');
    expect(screen.getByRole('link', { name: /Lịch sử thay đổi/ }).getAttribute('href')).toBe('/settings?view=operations&tab=audit');
    expect(within(screen.getByTestId('settings-group-time')).getByRole('link', { name: /Địa điểm GPS/ }).getAttribute('href')).toBe(
      '/settings?view=time&tab=sites',
    );
  });

  it('thanh bên có nhóm và mục; mục đang mở được đánh dấu, màn hình con nhận biết đang nằm trong trung tâm', () => {
    mockView = 'time';
    mockTab = 'sites';
    render(<SettingsCenter screens={screens} />);
    const nav = screen.getByRole('navigation', { name: 'Mục cấu hình' });
    expect(within(nav).getByText('Chấm công')).toBeTruthy();
    expect(within(nav).getByRole('link', { name: 'Địa điểm GPS' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Quy định chấm công' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByTestId('embedded').textContent).toBe('true');
    expect(screen.queryByRole('heading', { name: 'Trung tâm cấu hình HRM' })).toBeNull();
  });

  it('view không kèm tab mở mục đầu của view đó (liên kết cũ vẫn dùng được)', () => {
    mockView = 'leave';
    render(<SettingsCenter screens={screens} />);
    expect(screen.getByText('Màn phép năm')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Chính sách phép năm' }).getAttribute('aria-current')).toBe('page');
  });

  it('ẩn mục không có quyền: chỉ quyền thiết bị thì chỉ còn mục Thiết bị trong nhóm chấm công', () => {
    mockActions = ['hrm.device.manage'];
    render(<SettingsCenter screens={screens} />);
    const nav = screen.getByRole('navigation', { name: 'Mục cấu hình' });
    expect(within(nav).getByRole('link', { name: 'Thiết bị' })).toBeTruthy();
    expect(within(nav).queryByRole('link', { name: 'Quy định chấm công' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'Lương & OT' })).toBeNull();
    expect(screen.getByTestId('settings-count').textContent).toContain('1 mục cấu hình');
    expect(screen.queryByTestId('settings-group-payroll')).toBeNull();
    expect(screen.queryByRole('link', { name: /Lịch sử thay đổi/ })).toBeNull();
  });

  it('không có quyền nào thì không vẽ gì', () => {
    mockActions = [];
    const { container } = render(<SettingsCenter screens={screens} />);
    expect(container.textContent).toBe('');
  });

  it('tìm trong thanh bên lọc không dấu và ẩn mục Tổng quan', () => {
    render(<SettingsCenter screens={screens} />);
    const nav = screen.getByRole('navigation', { name: 'Mục cấu hình' });
    expect(within(nav).getByRole('link', { name: 'Tổng quan cấu hình' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Tìm cấu hình'), { target: { value: 'phan ca' } });
    expect(within(nav).getByRole('link', { name: 'Phân ca' })).toBeTruthy();
    expect(within(nav).queryByRole('link', { name: 'Danh mục ca' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'Tổng quan cấu hình' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Tìm cấu hình'), { target: { value: 'zzzz' } });
    expect(screen.getByText('Không có mục nào khớp.')).toBeTruthy();
  });

  it('tìm nhanh ở trang tổng quan lọc thẻ và đếm vẫn là tổng số mục có quyền', () => {
    render(<SettingsCenter screens={screens} />);
    fireEvent.change(screen.getByLabelText('Tìm nhanh cấu hình'), { target: { value: 'luong' } });
    expect(screen.getByTestId('settings-group-payroll')).toBeTruthy();
    expect(screen.queryByTestId('settings-group-time')).toBeNull();
    expect(screen.getByTestId('settings-count').textContent).toContain('12 mục cấu hình');
  });
  it('thu gọn và mở lại từng nhóm trong thanh bên; nhóm chứa mục đang mở không thu gọn được', () => {
    mockView = 'time';
    mockTab = 'sites';
    render(<SettingsCenter screens={screens} />);
    const nav = screen.getByRole('navigation', { name: 'Mục cấu hình' });
    // Nhóm Lương đang mở: thu gọn thì ẩn mục Lương & OT, bấm lại thì hiện.
    expect(within(nav).getByRole('link', { name: 'Lương & OT' })).toBeTruthy();
    const payrollGroup = within(nav).getByRole('button', { name: 'Lương' });
    expect(payrollGroup.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(payrollGroup);
    expect(within(nav).queryByRole('link', { name: 'Lương & OT' })).toBeNull();
    expect(payrollGroup.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(payrollGroup);
    expect(within(nav).getByRole('link', { name: 'Lương & OT' })).toBeTruthy();
    // Nhóm Chấm công chứa mục đang mở (Địa điểm GPS) nên bấm thu gọn không có tác dụng.
    fireEvent.click(within(nav).getByRole('button', { name: 'Chấm công' }));
    expect(within(nav).getByRole('link', { name: 'Địa điểm GPS' })).toBeTruthy();
  });

  it('màn hẹp: thanh Danh mục hiện nhóm › mục đang mở, bấm mở ngăn kéo menu và chọn mục thì ngăn kéo đóng', async () => {
    mockView = 'time';
    mockTab = 'sites';
    render(<SettingsCenter screens={screens} />);
    const bar = screen.getByTestId('settings-menu-bar');
    expect(bar.textContent).toContain('Chấm công');
    expect(bar.textContent).toContain('Địa điểm GPS');
    expect(bar.className).toContain('xl:hidden');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mở danh mục cấu hình' }));
    const dialog = await screen.findByRole('dialog');
    const link = within(dialog).getByRole('link', { name: 'Phân ca' });
    expect(link.getAttribute('href')).toBe('/settings?view=schedules');
    fireEvent.click(link);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('ẩn thanh bên ở màn rộng thì thanh Danh mục luôn hiện, nhớ lựa chọn và hiện lại được', () => {
    mockView = 'leave';
    const first = render(<SettingsCenter screens={screens} />);
    expect(screen.getByRole('complementary', { name: 'Danh mục cấu hình' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ẩn danh mục cấu hình' }));
    expect(screen.queryByRole('complementary', { name: 'Danh mục cấu hình' })).toBeNull();
    expect(screen.getByTestId('settings-menu-bar').className).not.toContain('xl:hidden');
    expect(localStorage.getItem('hrm_settings_nav_hidden')).toBe('true');
    first.unmount();
    render(<SettingsCenter screens={screens} />);
    expect(screen.queryByRole('complementary', { name: 'Danh mục cấu hình' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hiện danh mục cấu hình' }));
    expect(screen.getByRole('complementary', { name: 'Danh mục cấu hình' })).toBeTruthy();
    expect(localStorage.getItem('hrm_settings_nav_hidden')).toBe('false');
  });

  it('đặt breadcrumb của khung: nhóm và mục đang mở; trang tổng quan không thêm bậc nào', () => {
    const setCrumbs = jest.fn();
    mockView = 'schedules';
    const { unmount } = render(
      <HrmCrumbsProvider value={setCrumbs}>
        <SettingsCenter screens={screens} />
      </HrmCrumbsProvider>,
    );
    expect(setCrumbs).toHaveBeenLastCalledWith(['Lịch làm việc', 'Phân ca']);
    unmount();
    expect(setCrumbs).toHaveBeenLastCalledWith([]);
    setCrumbs.mockClear();
    mockView = null;
    render(
      <HrmCrumbsProvider value={setCrumbs}>
        <SettingsCenter screens={screens} />
      </HrmCrumbsProvider>,
    );
    expect(setCrumbs).toHaveBeenLastCalledWith([]);
  });
});
