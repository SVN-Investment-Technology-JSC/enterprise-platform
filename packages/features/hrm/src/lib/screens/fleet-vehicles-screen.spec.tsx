/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { hrmFetch } from '../hrm-api';
import FleetVehiclesScreen from './fleet-vehicles-screen';

jest.mock('../hrm-permissions', () => ({
  useHrmPermissions: () => ({
    actions: ['hrm.fleet.read', 'hrm.fleet.manage'],
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
const vehicles = [
  { id: 'v1', plateNo: '51A-111.11', name: 'Toyota Innova', seats: 7, status: 'ACTIVE', note: null },
  { id: 'v2', plateNo: '51A-222.22', name: 'Ford Transit', seats: 16, status: 'INACTIVE', note: 'Đang sửa' },
];

type Call = { path: string; init?: RequestInit };
let calls: Call[];
let postError: Error | null;

beforeEach(() => {
  calls = [];
  postError = null;
  fetchMock.mockReset();
  fetchMock.mockImplementation((async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path === '/fleet/vehicles' && !init) return { data: vehicles };
    if (init?.method === 'POST' && postError) throw postError;
    return { data: vehicles[0] };
  }) as never);
});

const writes = () => calls.filter((c) => c.init?.method);

describe('FleetVehiclesScreen (danh mục xe)', () => {
  it('liệt kê xe kèm trạng thái và lọc theo biển số hoặc tên', async () => {
    render(<FleetVehiclesScreen />);
    expect(await screen.findByText('51A-111.11')).toBeTruthy();
    expect(screen.getByText('Đang sử dụng')).toBeTruthy();
    expect(screen.getByText('Ngừng sử dụng', { selector: 'span' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Tìm biển số hoặc tên xe'), { target: { value: 'transit' } });
    expect(screen.queryByText('51A-111.11')).toBeNull();
    expect(screen.getByText('51A-222.22')).toBeTruthy();
  });

  it('thêm xe: kiểm tra đầu vào rồi gửi biển số in hoa, tên, số chỗ', async () => {
    render(<FleetVehiclesScreen />);
    await screen.findByText('51A-111.11');
    fireEvent.click(screen.getByRole('button', { name: /Thêm xe/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Lưu' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/biển số và tên xe/i);
    expect(writes()).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/^Biển số/), { target: { value: '51b-333.33' } });
    fireEvent.change(screen.getByLabelText(/^Tên xe/), { target: { value: ' Hyundai Solati ' } });
    fireEvent.change(screen.getByLabelText(/^Số chỗ ngồi/), { target: { value: '16' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].path).toBe('/fleet/vehicles');
    expect(writes()[0].init?.method).toBe('POST');
    expect(JSON.parse(String(writes()[0].init?.body))).toEqual({ plateNo: '51B-333.33', name: 'Hyundai Solati', seats: 16, note: null });
  });

  it('hiện lỗi của máy chủ khi biển số đã có', async () => {
    postError = new Error('Biển số đã có trong danh mục');
    render(<FleetVehiclesScreen />);
    await screen.findByText('51A-111.11');
    fireEvent.click(screen.getByRole('button', { name: /Thêm xe/ }));
    fireEvent.change(await screen.findByLabelText(/^Biển số/), { target: { value: '51A-111.11' } });
    fireEvent.change(screen.getByLabelText(/^Tên xe/), { target: { value: 'Xe trùng' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Biển số đã có/);
  });

  it('kích hoạt lại xe đã ngừng sử dụng bằng PATCH status', async () => {
    render(<FleetVehiclesScreen />);
    await screen.findByText('51A-222.22');
    fireEvent.click(screen.getByRole('button', { name: 'Kích hoạt lại' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].path).toBe('/fleet/vehicles/v2');
    expect(JSON.parse(String(writes()[0].init?.body))).toEqual({ status: 'ACTIVE' });
  });
});
