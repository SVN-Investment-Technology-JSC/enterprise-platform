/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { hrmFetch } from '../hrm-api';
import TimeSettingsScreen from './time-settings-screen';

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

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;

const UNITS = [
  { id: 'u1', parentId: null, code: 'KD', name: 'Khối kinh doanh' },
  { id: 'u2', parentId: 'u1', code: 'KD1', name: 'Phòng Bán lẻ' },
];
const SITE = {
  id: 's1',
  name: 'Văn phòng Hà Nội',
  latitude: 21.0285,
  longitude: 105.8542,
  radius_meters: 150,
  active: true,
  updated_at: '2026-10-01T00:00:00.000Z',
  allowed_ips: ['203.0.113.0/24'],
  assignments: [{ id: 'a1', scope_type: 'UNIT', scope_id: 'u1', scope_name: 'Khối kinh doanh' }],
};
let settingsData: Record<string, unknown> = {};
const calls: { path: string; init?: RequestInit }[] = [];

function settingsApi() {
  return async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path === '/time-settings') return { data: settingsData };
    if (path === '/time-settings/sites' && init?.method === 'POST') return { data: { id: 'new-site' } };
    if (path.startsWith('/time-settings/')) return { data: {} };
    throw new Error(`unexpected ${path}`);
  };
}
const bodyOf = (path: string, method: string) =>
  JSON.parse(String(calls.find((c) => c.path === path && c.init?.method === method)?.init?.body));

// antd Table cần matchMedia, ResizeObserver và getComputedStyle(elt, pseudoElt), jsdom chưa hỗ trợ.
const nativeGetComputedStyle = window.getComputedStyle.bind(window);
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  };
  window.getComputedStyle = ((elt: Element) =>
    nativeGetComputedStyle(elt)) as typeof window.getComputedStyle;
});
afterAll(() => {
  window.getComputedStyle = nativeGetComputedStyle;
});

beforeEach(() => {
  mockActions.clear();
  mockActions.add('hrm.time.configure');
  fetchMock.mockReset();
  fetchMock.mockImplementation(settingsApi() as never);
  window.history.replaceState(null, '', '/?tab=calendar');
});

describe('TimeSettingsScreen: Địa điểm GPS gộp quy định chấm công', () => {
  beforeEach(() => {
    calls.length = 0;
    settingsData = {
      calendar: [],
      sites: [SITE],
      units: UNITS,
      location: { locationCheck: true, maxGpsAccuracyMeters: 50, legacyPolicy: false, configured: true },
      holidayStatus: { year: 2026, count: 1, missing: false, warning: null, templateLabel: '' },
    };
  });

  it('không còn mục Quy định chấm công riêng: ?tab=calendar hoặc ?tab=rules đều rơi về Địa điểm GPS', async () => {
    render(<TimeSettingsScreen />);
    expect((await screen.findAllByRole('button', { name: /Thêm địa điểm/ })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Tạo phiên bản mới' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Quy định chấm công' })).toBeNull();
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('sites');
  });

  it('một trang có cài đặt kiểm tra vị trí và danh sách địa điểm kèm IP và phòng ban được gán', async () => {
    render(<TimeSettingsScreen />);
    expect(await screen.findByText('Văn phòng Hà Nội')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Kiểm tra vị trí khi chấm công' }).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByLabelText('Sai số GPS tối đa (m)') as HTMLInputElement).value).toBe('50');
    expect(screen.getByText('203.0.113.0/24')).toBeTruthy();
    expect(screen.getByText('Khối kinh doanh (gồm đơn vị con)')).toBeTruthy();
  });

  it('lưu cài đặt kiểm tra vị trí gửi đúng nội dung', async () => {
    render(<TimeSettingsScreen />);
    // Thẻ nạp lại khi dữ liệu về: chờ giá trị thật rồi mới lấy phần tử.
    await waitFor(() => expect((screen.getByLabelText('Sai số GPS tối đa (m)') as HTMLInputElement).value).toBe('50'));
    const input = screen.getByLabelText('Sai số GPS tối đa (m)') as HTMLInputElement;
    const save = screen.getByRole('button', { name: 'Lưu cài đặt' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(input, { target: { value: '30' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(bodyOf('/time-settings/location', 'PUT')).toEqual({ locationCheck: true, maxGpsAccuracyMeters: 30 }));
  });

  it('không cho bật kiểm tra vị trí khi chưa có địa điểm nào đang dùng', async () => {
    settingsData = { ...settingsData, sites: [], location: { locationCheck: false, maxGpsAccuracyMeters: 100, legacyPolicy: false, configured: false } };
    render(<TimeSettingsScreen />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Kiểm tra vị trí khi chấm công' }));
    expect(screen.getByText(/Cần thêm ít nhất một địa điểm đang dùng/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Lưu cài đặt' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('tenant cũ chỉ kiểm IP: báo đang theo cấu hình cũ', async () => {
    settingsData = { ...settingsData, location: { locationCheck: false, maxGpsAccuracyMeters: 100, legacyPolicy: true, configured: true } };
    render(<TimeSettingsScreen />);
    expect(await screen.findByText(/kiểm chấm công theo IP của cấu hình cũ/)).toBeTruthy();
  });

  it('thêm địa điểm: lưu GPS kèm IP rồi gán cho phòng ban đã chọn', async () => {
    render(<TimeSettingsScreen />);
    fireEvent.click((await screen.findAllByRole('button', { name: /Thêm địa điểm/ }))[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Tên địa điểm/), { target: { value: 'Chi nhánh Đà Nẵng' } });
    fireEvent.change(within(dialog).getByLabelText(/Vĩ độ/), { target: { value: '16.0544' } });
    fireEvent.change(within(dialog).getByLabelText(/Kinh độ/), { target: { value: '108.2022' } });
    fireEvent.change(within(dialog).getByLabelText(/IP được phép/), { target: { value: '198.51.100.5\n198.51.100.0/24, 198.51.100.5' } });
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Áp dụng cho toàn công ty' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu địa điểm' }));
    await waitFor(() => expect(bodyOf('/time-settings/sites', 'POST')).toMatchObject({
      name: 'Chi nhánh Đà Nẵng',
      latitude: 16.0544,
      longitude: 108.2022,
      radiusMeters: 100,
      allowedIps: ['198.51.100.5', '198.51.100.0/24'],
    }));
    await waitFor(() => expect(bodyOf('/time-settings/sites/new-site/assignments', 'PUT').assignments).toEqual([{ scopeType: 'COMPANY', scopeId: '' }]));
  });

  it('sửa địa điểm: nạp sẵn IP và phòng ban, gửi kèm lý do và phiên bản, giữ phân công chức danh/nhân viên', async () => {
    settingsData = {
      ...settingsData,
      sites: [{ ...SITE, assignments: [...SITE.assignments, { id: 'a2', scope_type: 'POSITION', scope_id: 'p1', scope_name: 'Kế toán' }] }],
    };
    render(<TimeSettingsScreen />);
    await screen.findByText('Văn phòng Hà Nội');
    fireEvent.click(screen.getByRole('button', { name: 'Sửa Văn phòng Hà Nội' }));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText(/IP được phép/) as HTMLTextAreaElement).value).toBe('203.0.113.0/24');
    // Gán Khối kinh doanh (cha) thì Phòng Bán lẻ (con) cũng được tick theo kế thừa.
    expect(within(dialog).getByText('Áp dụng cho 2/2 đơn vị.')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Lý do thay đổi/), { target: { value: 'Đổi IP' } });
    fireEvent.change(within(dialog).getByLabelText(/IP được phép/), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu địa điểm' }));
    await waitFor(() => expect(bodyOf('/time-settings/sites/s1', 'PATCH')).toMatchObject({
      allowedIps: [],
      reason: 'Đổi IP',
      expectedUpdatedAt: '2026-10-01T00:00:00.000Z',
    }));
    await waitFor(() =>
      expect(bodyOf('/time-settings/sites/s1/assignments', 'PUT').assignments).toEqual([
        { scopeType: 'UNIT', scopeId: 'u1' },
        { scopeType: 'POSITION', scopeId: 'p1' },
      ]),
    );
  });

  it('cây phòng ban: bỏ tick đơn vị con tạo ngoại lệ, gửi UNIT_EXCLUDE; tick lại thì hết ngoại lệ', async () => {
    render(<TimeSettingsScreen />);
    await screen.findByText('Văn phòng Hà Nội');
    fireEvent.click(screen.getByRole('button', { name: 'Sửa Văn phòng Hà Nội' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByText('Phòng Bán lẻ (KD1)'));
    expect(within(dialog).getByText(/Áp dụng cho 1\/2 đơn vị/)).toBeTruthy();
    expect(within(dialog).getByText(/Ngoại lệ không áp dụng:/).textContent).toContain('Phòng Bán lẻ');
    fireEvent.change(within(dialog).getByLabelText(/Lý do thay đổi/), { target: { value: 'Ngoại lệ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu địa điểm' }));
    await waitFor(() =>
      expect(bodyOf('/time-settings/sites/s1/assignments', 'PUT').assignments).toEqual([
        { scopeType: 'UNIT', scopeId: 'u1' },
        { scopeType: 'UNIT_EXCLUDE', scopeId: 'u2' },
      ]),
    );
  });

  it('cây phòng ban: tick đơn vị cha áp cho cả nhánh con; tìm kiếm lọc cây', async () => {
    settingsData = { ...settingsData, sites: [{ ...SITE, assignments: [] }] };
    render(<TimeSettingsScreen />);
    await screen.findByText('Văn phòng Hà Nội');
    fireEvent.click(screen.getByRole('button', { name: 'Sửa Văn phòng Hà Nội' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Áp dụng cho 0/2 đơn vị.')).toBeTruthy();
    fireEvent.click(within(dialog).getByText('Khối kinh doanh (KD)'));
    expect(within(dialog).getByText('Áp dụng cho 2/2 đơn vị.')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Tìm phòng ban'), { target: { value: 'KD1' } });
    expect(within(dialog).getByText('Phòng Bán lẻ (KD1)')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Tìm phòng ban'), { target: { value: 'không có' } });
    expect(within(dialog).getByText('Không tìm thấy phòng ban.')).toBeTruthy();
  });

  it('ngừng địa điểm: hộp xác nhận, không hỏi lý do, gửi lý do cố định và phiên bản hiện tại', async () => {
    render(<TimeSettingsScreen />);
    await screen.findByText('Văn phòng Hà Nội');
    fireEvent.click(screen.getByRole('button', { name: 'Ngừng Văn phòng Hà Nội' }));
    expect(await screen.findByText('Ngừng địa điểm Văn phòng Hà Nội?')).toBeTruthy();
    expect(screen.queryByLabelText('Lý do')).toBeNull();
    expect(calls.some((c) => c.path.endsWith('/deactivate'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Ngừng địa điểm' }));
    await waitFor(() =>
      expect(bodyOf('/time-settings/sites/s1/deactivate', 'POST')).toEqual({
        reason: 'Ngừng địa điểm chấm công',
        expectedUpdatedAt: '2026-10-01T00:00:00.000Z',
      }),
    );
    expect(await screen.findByText('Đã ngừng địa điểm.')).toBeTruthy();
  });

  it('địa điểm đã lưu nhưng gán phòng ban lỗi thì báo rõ để mở lại gán', async () => {
    fetchMock.mockImplementation((async (path: string, init?: RequestInit) => {
      if (path.endsWith('/assignments')) throw new Error('Không tìm thấy địa điểm');
      return settingsApi()(path, init);
    }) as never);
    render(<TimeSettingsScreen />);
    fireEvent.click((await screen.findAllByRole('button', { name: /Thêm địa điểm/ }))[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Tên địa điểm/), { target: { value: 'Kho' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu địa điểm' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Đã lưu địa điểm nhưng chưa gán được phòng ban');
  });
});
