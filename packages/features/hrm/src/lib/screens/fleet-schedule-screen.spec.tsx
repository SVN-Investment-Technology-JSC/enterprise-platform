/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { hrmFetch } from '../hrm-api';
import FleetScheduleScreen, { barGeometry } from './fleet-schedule-screen';

jest.mock('../hrm-permissions', () => ({
  useHrmPermissions: () => ({
    actions: ['hrm.fleet.read'],
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

const vehicle = (id: string, plateNo: string, status = 'ACTIVE') => ({ id, plateNo, name: 'Innova', seats: 7, status, note: null });
const today = new Date();
const at = (hour: number, dayOffset = 0) =>
  new Date(today.getFullYear(), today.getMonth(), today.getDate() + dayOffset, hour, 0, 0).toISOString();
const booking = (over: Record<string, unknown>) => ({
  id: 'b1',
  vehicleId: 'v1',
  vehiclePlateNo: '51A-111.11',
  vehicleName: 'Innova',
  driverId: 'd1',
  driverName: 'Nguyễn Văn A',
  startAt: at(8),
  endAt: at(17),
  destination: 'Hà Nội',
  purpose: 'Gặp khách',
  requesterEmployeeId: 'e1',
  requesterName: 'Trần Thị B',
  sourceModule: 'HRM',
  sourceType: 'BUSINESS_TRIP',
  sourceId: 's1',
  sourceLabel: 'Đơn công tác: Hà Nội',
  status: 'CONFIRMED',
  ...over,
});

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((async (path: string) => {
    if (path === '/fleet/vehicles') return { data: [vehicle('v1', '51A-111.11'), vehicle('v2', '51A-222.22'), vehicle('v3', '51A-999.99', 'INACTIVE')] };
    if (path.startsWith('/fleet/bookings')) return { data: [booking({}), booking({ id: 'b2', vehicleId: 'v2', vehiclePlateNo: '51A-222.22', status: 'PENDING', sourceLabel: 'Họp khách hàng', sourceType: 'CALENDAR_EVENT' })] };
    throw new Error(`unexpected ${path}`);
  }) as never);
});

describe('barGeometry', () => {
  const from = new Date(2026, 10, 1);
  const to = new Date(2026, 10, 11);
  it('đặt thanh theo tỉ lệ khung thời gian và cắt phần nằm ngoài khung', () => {
    const inside = barGeometry({ startAt: new Date(2026, 10, 2).toISOString(), endAt: new Date(2026, 10, 4).toISOString() }, from, to);
    expect(inside.left).toBeCloseTo(10);
    expect(inside.width).toBeCloseTo(20);
    const clipped = barGeometry({ startAt: new Date(2026, 9, 28).toISOString(), endAt: new Date(2026, 10, 3).toISOString() }, from, to);
    expect(clipped.left).toBe(0);
    expect(clipped.width).toBeCloseTo(20);
  });
  it('lịch rất ngắn vẫn có bề rộng tối thiểu để bấm được', () => {
    const tiny = barGeometry({ startAt: at(8), endAt: at(8) }, new Date(today.getFullYear(), today.getMonth(), today.getDate()), new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14));
    expect(tiny.width).toBeGreaterThanOrEqual(0.8);
  });
});

describe('FleetScheduleScreen (lịch xe)', () => {
  it('mỗi xe đang dùng là một hàng; xe ngừng sử dụng không có lịch thì ẩn; lịch hiện thành thanh', async () => {
    render(<FleetScheduleScreen />);
    expect(await screen.findByText('51A-111.11')).toBeTruthy();
    expect(screen.getByText('51A-222.22')).toBeTruthy();
    expect(screen.queryByText('51A-999.99')).toBeNull();
    expect(screen.getByText('Đơn công tác: Hà Nội')).toBeTruthy();
    expect(screen.getByText('Họp khách hàng')).toBeTruthy();
    const bar = screen.getByText('Họp khách hàng').closest('button') as HTMLElement;
    // Chờ đơn gốc duyệt: thanh nét đứt, khác với lịch đã xác nhận.
    expect(bar.className).toMatch(/border-dashed/);
    expect((screen.getByText('Đơn công tác: Hà Nội').closest('button') as HTMLElement).className).toMatch(/bg-blue-600/);
  });

  it('hỏi lịch theo khung thời gian đang xem; đổi sang 30 ngày thì hỏi lại', async () => {
    render(<FleetScheduleScreen />);
    await screen.findByText('51A-111.11');
    const bookingCalls = () => fetchMock.mock.calls.map((c: unknown[]) => String(c[0])).filter((p: string) => p.startsWith('/fleet/bookings'));
    expect(bookingCalls()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '30 ngày' }));
    await waitFor(() => expect(bookingCalls()).toHaveLength(2));
    const params = new URLSearchParams(bookingCalls()[1].split('?')[1]);
    expect((Date.parse(params.get('to') as string) - Date.parse(params.get('from') as string)) / 86_400_000).toBeGreaterThanOrEqual(29);
  });

  it('bấm vào thanh mở ngăn kéo chi tiết chỉ đọc kèm nguồn và trạng thái', async () => {
    render(<FleetScheduleScreen />);
    fireEvent.click((await screen.findByText('Đơn công tác: Hà Nội')).closest('button') as HTMLElement);
    // Một ở chú giải, một ở trạng thái trong ngăn kéo.
    await waitFor(() => expect(screen.getAllByText('Đã xác nhận')).toHaveLength(2));
    expect(screen.getByText('Nguyễn Văn A')).toBeTruthy();
    expect(screen.getByText('Trần Thị B')).toBeTruthy();
    expect(screen.getByText('Loại nguồn').nextElementSibling?.textContent).toBe('Đơn công tác');
    expect(screen.getAllByText('Đơn công tác: Hà Nội').length).toBeGreaterThan(1);
    expect(screen.queryByRole('button', { name: /Xoá|Huỷ|Sửa/ })).toBeNull();
  });

  it('báo lỗi khi không tải được lịch', async () => {
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error('Mất kết nối'));
    render(<FleetScheduleScreen />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Mất kết nối/);
  });
});
