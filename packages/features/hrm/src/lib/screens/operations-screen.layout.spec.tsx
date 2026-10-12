/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { hrmFetch } from '../hrm-api';
import OperationsScreen from './operations-screen';

const mockActions = new Set<string>();
jest.mock('../hrm-permissions', () => ({
  useHrmPermissions: () => ({
    actions: [...mockActions],
    loading: false,
    error: '',
    displayName: '',
    can: (p: string) => mockActions.has(p),
    any: (list: readonly string[]) => list.some((p) => mockActions.has(p)),
  }),
}));
jest.mock('../hrm-api', () => {
  const actual = jest.requireActual('../hrm-api');
  return { ...actual, hrmFetch: jest.fn(), hrmEmployeeOptions: jest.fn() };
});
// Bảng nhật ký của antd cần các API trình duyệt mà jsdom không có; màn này chỉ kiểm bố cục nên thay bằng khung rỗng.
jest.mock('../ui/hrm-audit-trail', () => ({
  ...jest.requireActual('../ui/hrm-audit-trail'),
  HrmAuditTrail: () => <div data-testid="audit-trail" />,
}));
jest.mock('../ui/approval-policy-card', () => ({
  ApprovalPolicyCard: () => <div data-testid="approval-policy-card" />,
}));

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;

const settings = {
  enabled: true,
  timezone: 'Asia/Ho_Chi_Minh',
  from_month: '2026-01',
  carryover_enabled: false,
  run_hour: 2,
  last_success_date: '2026-10-11',
  last_error: '',
};
const runs = [
  {
    id: 'r1',
    started_at: '2026-10-12T02:00:03.000Z',
    status: 'SUCCEEDED',
    error: '',
    result: { summary: { createdTransactions: 12, skipped: 340, errors: 0, missingContract: 2 }, months: [{ month: '2026-10', credited: 12, skipped: 340 }] },
  },
  { id: 'r2', started_at: '2026-10-11T02:00:03.000Z', status: 'FAILED', error: 'Không kết nối được cơ sở dữ liệu', result: null },
];
const rules = [
  { id: 'b1', request_kind: 'LEAVE', sub_type_code: null, definition_id: 'd1', mode: 'PROCEDURE', configuration_status: 'ACTIVE', enabled: true, updated_at: '2026-09-20T00:00:00.000Z' },
  { id: 'b2', request_kind: 'OT', sub_type_code: null, definition_id: null, mode: 'DIRECT', configuration_status: 'CONFLICT', enabled: false, updated_at: '2026-09-20T00:00:00.000Z' },
];
const workflows = [
  {
    id: 'w1', request_kind: 'BUSINESS_TRIP', request_id: 'q1', instance_id: 'i1', instance_code: 'PR-0001', status: 'FAILED', attempts: 3,
    last_error: 'Lỗi 503', definition_version_id: 'v1', legacy_link_id: null, related_instances: [], employee_label: 'NV001 · Nguyễn Văn An',
    title: 'Công tác Hà Nội', created_at: '2026-10-05T09:30:00.000Z',
  },
  {
    id: 'w2', request_kind: 'LEAVE', request_id: 'q2', instance_id: 'i2', instance_code: 'PR-0002', status: 'RUNNING', attempts: 1,
    last_error: '', definition_version_id: 'v1', legacy_link_id: null, related_instances: [], employee_label: 'NV002 · Trần Thị Bình',
    title: 'Nghỉ phép', created_at: '2026-10-06T09:30:00.000Z',
  },
];

let operations: Record<string, unknown>;

beforeEach(() => {
  mockActions.clear();
  mockActions.add('hrm.automation.manage');
  mockActions.add('hrm.integration.manage');
  mockActions.add('hrm.audit.read');
  window.history.replaceState(null, '', '/');
  operations = { settings, runs, rules, workflows, procedureAvailable: true };
  fetchMock.mockReset();
  fetchMock.mockImplementation((async (path: string) => {
    if (path === '/operations') return { data: operations };
    if (path === '/operations/procedure-definitions') return { data: [{ id: 'd1', code: 'QT-01', name: 'Duyệt nghỉ phép' }] };
    if (path === '/operations/leave-year-end-checklist')
      return {
        data: {
          year: 2026, daysToYearEnd: 80, carryoverEnabled: false, resetTypes: [{ code: 'AL', name: 'Phép năm' }],
          resetsLastYear: 341, pendingRequests: 4, reconcileMismatchCount: 0, warnCarryoverOff: true,
        },
      };
    throw new Error(`unexpected ${path}`);
  }) as never);
});

const urlTab = () => new URLSearchParams(window.location.search).get('tab');

describe('OperationsScreen: bố cục theo tab', () => {
  it('tiêu đề Vận hành & tích hợp, ba tab theo quyền, mặc định mở tab đầu và không ghi gì lên URL', async () => {
    render(<OperationsScreen />);
    expect(screen.getByRole('heading', { name: 'Vận hành & tích hợp' })).toBeTruthy();
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Tác vụ tự động tính phép', 'Quy trình liên module (Procedure)', 'Nhật ký nghiệp vụ']);
    expect(screen.getByRole('tab', { name: 'Tác vụ tự động tính phép' }).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByText('Lịch tự động hàng ngày')).toBeTruthy();
    expect(urlTab()).toBeNull();
  });

  it('chỉ hiện tab theo quyền: không có hrm.integration.manage thì không có tab Procedure; một tab duy nhất thì không vẽ thanh tab', async () => {
    mockActions.delete('hrm.integration.manage');
    const first = render(<OperationsScreen />);
    await screen.findByText('Lịch tự động hàng ngày');
    expect(screen.queryByRole('tab', { name: /Procedure/ })).toBeNull();
    first.unmount();
    mockActions.clear();
    mockActions.add('hrm.audit.read');
    render(<OperationsScreen />);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(await screen.findByTestId('audit-trail')).toBeTruthy();
  });

  it('bấm tab ghi ?tab= lên URL; mở thẳng bằng URL và nghe popstate; tab không hợp lệ rơi về tab đầu và được sửa', async () => {
    render(<OperationsScreen />);
    await screen.findByText('Lịch tự động hàng ngày');
    fireEvent.click(screen.getByRole('tab', { name: /Procedure/ }));
    expect(urlTab()).toBe('workflow');
    expect(await screen.findByText('Quy tắc chuyển tiếp Procedure')).toBeTruthy();
    act(() => {
      window.history.replaceState(null, '', '/?tab=audit');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(await screen.findByTestId('audit-trail')).toBeTruthy();
    act(() => {
      window.history.replaceState(null, '', '/?tab=khong-co');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => expect(urlTab()).toBe('automation'));
  });

  it('tab Tác vụ tự động: thông tin lịch, checklist cuối năm với cảnh báo, các lần chạy có chi tiết và nhãn kết quả', async () => {
    render(<OperationsScreen />);
    const lich = (await screen.findByText('Lịch tự động hàng ngày')).closest('section') as HTMLElement;
    expect(within(lich).getByText('Đang bật')).toBeTruthy();
    expect(within(lich).getByText('01/2026')).toBeTruthy();
    expect(within(lich).getByRole('button', { name: /Cấu hình lịch/ })).toBeTruthy();
    expect(within(lich).getByRole('button', { name: /Chạy tác vụ ngay/ })).toBeTruthy();
    const checklist = (await screen.findByText('Checklist cuối năm 2026')).closest('section') as HTMLElement;
    expect(within(checklist).getByRole('alert').textContent).toContain('Tự động chốt phép cuối năm');
    expect(checklist.textContent).toContain('Đơn nghỉ trừ quỹ đang chờ duyệt trong năm: 4');
    const list = screen.getByRole('table', { name: 'Các lần chạy tác vụ' });
    expect(within(list).getByText('Thành công')).toBeTruthy();
    expect(within(list).getByText('Thất bại')).toBeTruthy();
    expect(list.textContent).toContain('12 mới · 340 đã có · 2 thiếu HĐ');
    const toggles = within(list).getAllByRole('button', { name: /Chi tiết lần chạy/ });
    expect(toggles).toHaveLength(2);
    fireEvent.click(toggles[1]);
    expect(await within(list).findByText('Không kết nối được cơ sở dữ liệu', { selector: 'li' })).toBeTruthy();
  });

  it('chạy tác vụ ngay hỏi xác nhận rồi gọi POST /operations/automation/run và hiện kết quả', async () => {
    const posts: string[] = [];
    fetchMock.mockImplementation((async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(path);
        return { data: { summary: { createdTransactions: 5, skipped: 7, errors: 0 }, months: [{ month: '2026-10', credited: 5, skipped: 7 }] } };
      }
      if (path === '/operations') return { data: operations };
      if (path === '/operations/procedure-definitions') return { data: [] };
      if (path === '/operations/leave-year-end-checklist') throw new Error('x');
      throw new Error(`unexpected ${path}`);
    }) as never);
    render(<OperationsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /Chạy tác vụ ngay/ }));
    expect(posts).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Chạy ngay' }));
    await waitFor(() => expect(posts).toEqual(['/operations/automation/run']));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Kết quả chạy tác vụ quỹ phép')).toBeTruthy();
    expect(within(dialog).getByText('5')).toBeTruthy();
  });

  it('tab Procedure: quy tắc với nhãn chế độ, cần đối soát, nút chỉnh cấu hình; đồng bộ đơn có nút gắn lại cho liên kết lỗi', async () => {
    window.history.replaceState(null, '', '/?tab=workflow');
    render(<OperationsScreen />);
    const rulesTable = await screen.findByRole('table', { name: 'Quy tắc chuyển tiếp Procedure' });
    expect(within(rulesTable).getByText('Procedure BPMN')).toBeTruthy();
    expect(within(rulesTable).getByText('Duyệt trực tiếp')).toBeTruthy();
    expect(within(rulesTable).getByText('Cần đối soát')).toBeTruthy();
    expect(within(rulesTable).getByText('QT-01 · Duyệt nghỉ phép')).toBeTruthy();
    expect(within(rulesTable).getAllByRole('button', { name: 'Chỉnh cấu hình' })).toHaveLength(2);
    expect(within(rulesTable).getByRole('button', { name: 'Ánh xạ trường' })).toBeTruthy();
    const syncTable = screen.getByRole('table', { name: 'Trạng thái đồng bộ đơn' });
    expect(within(syncTable).getByText('Lỗi đồng bộ')).toBeTruthy();
    expect(within(syncTable).getByText('Đang duyệt')).toBeTruthy();
    expect(within(syncTable).getAllByRole('button', { name: /Gắn lại quy trình/ })).toHaveLength(1);
    expect(screen.getByTestId('approval-policy-card')).toBeTruthy();
  });

  it('Procedure không khả dụng: cảnh báo còn cấu hình duyệt qua Procedure và nút chuyển sang duyệt trực tiếp', async () => {
    operations = { ...operations, procedureAvailable: false };
    window.history.replaceState(null, '', '/?tab=workflow');
    render(<OperationsScreen />);
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((a) => (a.textContent ?? '').includes('Procedure Engine đang không khả dụng nhưng còn 1 cấu hình duyệt qua Procedure'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Chuyển sang duyệt trực tiếp' })).toBeTruthy();
  });

  it('không có quyền nào của màn: báo không có quyền xem', () => {
    mockActions.clear();
    render(<OperationsScreen />);
    expect(screen.getByRole('alert').textContent).toContain('Bạn không có quyền xem vận hành và tích hợp');
  });
});
