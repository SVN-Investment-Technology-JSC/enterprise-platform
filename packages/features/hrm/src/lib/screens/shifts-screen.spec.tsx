/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HrmApiError, hrmFetch } from '../hrm-api';
import ShiftsScreen from './shifts-screen';

jest.mock('../hrm-permissions', () => ({
  useHrmPermissions: () => ({
    actions: ['hrm.shift.read', 'hrm.shift.manage'],
    loading: false,
    error: '',
    displayName: '',
    can: () => true,
    any: () => true,
  }),
}));
jest.mock('../hrm-api', () => {
  const actual = jest.requireActual('../hrm-api');
  return { ...actual, hrmFetch: jest.fn() };
});

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;

const shift = {
  id: 's1',
  tenantId: 't',
  code: 'HC',
  name: 'Hành chính',
  startTime: '08:00:00',
  endTime: '17:30:00',
  breakMinutes: 60,
  breakStartTime: '12:00:00',
  breakEndTime: '13:00:00',
  crossMidnight: false,
  graceLateMinutes: 10,
  graceEarlyMinutes: 5,
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-03-04T05:06:07.890Z',
};
const inactive = { ...shift, id: 's2', code: 'DEM', name: 'Ca đêm', status: 'INACTIVE', updatedAt: '2026-04-01T00:00:00.000Z' };

type Call = { path: string; init?: RequestInit };
let calls: Call[];
let patchError: unknown = null;

beforeEach(() => {
  calls = [];
  patchError = null;
  fetchMock.mockReset();
  fetchMock.mockImplementation((async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path === '/shifts' && !init) return { data: [shift, inactive] };
    if (init?.method === 'PATCH' && patchError) throw patchError;
    return { data: shift };
  }) as never);
});

const patches = () => calls.filter((c) => c.init?.method === 'PATCH');

describe('ShiftsScreen (danh mục ca làm việc)', () => {
  it('lists the catalog and points assignment to the Phân ca làm việc screen', async () => {
    render(<ShiftsScreen />);
    expect(await screen.findByText('Hành chính')).toBeTruthy();
    expect(screen.getByText('Ca đêm')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Phân ca làm việc' });
    expect(link.getAttribute('href')).toBe('/timekeeping?view=schedules');
    expect(screen.getByText(/Phân ca cho nhân viên thực hiện tại/)).toBeTruthy();
    // Không còn thao tác phân ca ở màn danh mục.
    expect(screen.queryByText(/Bảng phân ca/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Gán ca/ })).toBeNull();
    expect(calls.map((c) => c.path)).toEqual(['/shifts']);
  });

  it('sends expectedUpdatedAt from the loaded shift when editing and auto-computes the break end', async () => {
    render(<ShiftsScreen />);
    await screen.findByText('Hành chính');
    fireEvent.click(screen.getAllByRole('button', { name: 'Sửa' })[0]);
    const dialog = await screen.findByRole('dialog', { name: /Cập nhật ca: HC/ });
    fireEvent.change(within(dialog).getByLabelText('Thời gian nghỉ (phút)'), { target: { value: '90' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cập nhật thay đổi' }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].path).toBe('/shifts/s1');
    const body = JSON.parse(String(patches()[0].init?.body));
    expect(body.expectedUpdatedAt).toBe('2026-03-04T05:06:07.890Z');
    expect(body.breakMinutes).toBe(90);
    expect(body.breakStartTime).toBe('12:00');
    expect(body.breakEndTime).toBe('13:30');
  });

  it('creates a shift with POST and without expectedUpdatedAt', async () => {
    render(<ShiftsScreen />);
    await screen.findByText('Hành chính');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm ca làm việc' }));
    const dialog = await screen.findByRole('dialog', { name: 'Thêm ca làm việc mới' });
    fireEvent.change(within(dialog).getByLabelText('Mã ca làm việc'), { target: { value: 'ca-sang' } });
    fireEvent.change(within(dialog).getByLabelText('Tên ca làm việc'), { target: { value: 'Ca sáng' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu ca làm việc' }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.init?.method === 'POST') as Call;
    expect(post.path).toBe('/shifts');
    const body = JSON.parse(String(post.init?.body));
    expect(body.code).toBe('CA-SANG');
    expect(body).not.toHaveProperty('expectedUpdatedAt');
  });

  it('requires a code and a name before saving', async () => {
    render(<ShiftsScreen />);
    await screen.findByText('Hành chính');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm ca làm việc' }));
    const dialog = await screen.findByRole('dialog', { name: 'Thêm ca làm việc mới' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu ca làm việc' }));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(false);
  });

  it('shows a stale-version message and reloads when the shift was changed by someone else', async () => {
    patchError = new HrmApiError('stale', 409, 'HRM_STALE_VERSION');
    render(<ShiftsScreen />);
    await screen.findByText('Hành chính');
    fireEvent.click(screen.getAllByRole('button', { name: 'Sửa' })[0]);
    const dialog = await screen.findByRole('dialog', { name: /Cập nhật ca: HC/ });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cập nhật thay đổi' }));
    expect(await within(dialog).findByText(/đã được người khác cập nhật/)).toBeTruthy();
    await waitFor(() => expect(calls.filter((c) => c.path === '/shifts' && !c.init)).toHaveLength(2));
  });

  it('reactivates an inactive shift and deactivates an active one after confirmation', async () => {
    render(<ShiftsScreen />);
    await screen.findByText('Ca đêm');
    fireEvent.click(screen.getByRole('button', { name: 'Kích hoạt lại' }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].path).toBe('/shifts/s2');
    expect(JSON.parse(String(patches()[0].init?.body))).toEqual({
      status: 'ACTIVE',
      expectedUpdatedAt: '2026-04-01T00:00:00.000Z',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Ngừng dùng' }));
    const confirmButtons = await screen.findAllByRole('button', { name: 'Ngừng dùng' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(JSON.parse(String(patches()[1].init?.body))).toMatchObject({ status: 'INACTIVE', expectedUpdatedAt: shift.updatedAt });
  });
});
