/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { HrmTripDayLine, HrmTripDayLines } from '@enterprise-platform/contracts-hrm';
import { compOffApi } from '../hrm-comp-off-api';
import { formatTripMinutes, tripDayChanges, tripDayLabel, tripWindowProblem } from '../comp-off-model';
import { TripDayLinesPanel } from './trip-day-lines-panel';

jest.mock('../hrm-comp-off-api', () => ({
  compOffApi: { tripDayLines: jest.fn(), saveTripDayLines: jest.fn(), decideTripDayLines: jest.fn() },
}));
const api = compOffApi as jest.Mocked<typeof compOffApi>;

const line = (date: string, over: Partial<HrmTripDayLine> = {}): HrmTripDayLine => ({
  date,
  plannedWindows: [],
  actualWindows: [],
  status: 'PLANNED',
  decisionNote: null,
  scheduledMinutes: 480,
  normalMinutes: 0,
  otMinutes: 0,
  nightMinutes: 0,
  restsNextMorning: false,
  ...over,
});
const trip = (lines: HrmTripDayLine[], over: Partial<HrmTripDayLines> = {}): HrmTripDayLines => ({
  tripId: 't1',
  employeeId: 'e1',
  fromDate: '2025-10-12',
  toDate: '2025-10-13',
  tripStatus: 'APPROVED',
  lines,
  canEdit: true,
  canDecide: false,
  ...over,
});

beforeEach(() => jest.clearAllMocks());

describe('tiện ích giờ làm theo ngày', () => {
  it('đọc số phút, nhãn ngày và kiểm tra khung giờ', () => {
    expect(formatTripMinutes(480)).toBe('8 giờ');
    expect(formatTripMinutes(210)).toBe('3 giờ 30');
    expect(formatTripMinutes(0)).toBe('0');
    expect(tripDayLabel('2025-10-12')).toBe('Chủ nhật, 12/10');
    expect(tripWindowProblem([{ from: '18:00', to: '05:00' }])).toBe('');
    expect(tripWindowProblem([{ from: '', to: '05:00' }])).toContain('đủ giờ');
    expect(
      tripWindowProblem([
        { from: '08:00', to: '12:00' },
        { from: '11:00', to: '13:00' },
      ]),
    ).toContain('chồng nhau');
  });

  it('chỉ gửi những ngày đã sửa so với dữ liệu đang lưu', () => {
    const lines = [line('2025-10-12', { actualWindows: [{ from: '18:00', to: '05:00' }] }), line('2025-10-13')];
    const drafts = { '2025-10-12': [{ from: '18:00', to: '05:00' }], '2025-10-13': [{ from: '18:00', to: '03:00' }] };
    expect(tripDayChanges(lines, drafts, 'ACTUAL').map((c) => c.date)).toEqual(['2025-10-13']);
  });
});

describe('TripDayLinesPanel', () => {
  it('hiện từng ngày với giờ khai, giờ trong ca và giờ làm thêm', async () => {
    api.tripDayLines.mockResolvedValue(
      trip([
        line('2025-10-12', {
          actualWindows: [{ from: '18:00', to: '05:00' }],
          status: 'ACTUAL_APPROVED',
          normalMinutes: 480,
          otMinutes: 180,
          nightMinutes: 180,
        }),
        line('2025-10-13'),
      ]),
    );
    render(<TripDayLinesPanel tripId="t1" />);
    expect(await screen.findByText('18:00 - 05:00')).toBeTruthy();
    expect(screen.getAllByText('8 giờ').length).toBeGreaterThan(0);
    expect(screen.getByText(/trong đó 3 giờ đêm/)).toBeTruthy();
    expect(screen.getByText('Đã xác nhận')).toBeTruthy();
    expect(screen.getByText('Theo ca')).toBeTruthy();
  });

  it('khai giờ thực tế bằng mẫu ca đêm và gửi chờ xác nhận', async () => {
    const before = trip([line('2025-10-12'), line('2025-10-13')]);
    api.tripDayLines.mockResolvedValue(before);
    api.saveTripDayLines.mockResolvedValue(trip([line('2025-10-12', { status: 'ACTUAL_PENDING', actualWindows: [{ from: '18:00', to: '05:00' }] }), line('2025-10-13')]));
    render(<TripDayLinesPanel tripId="t1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Khai giờ thực tế' }));
    const row = screen.getByText('Chủ nhật, 12/10').closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Ca đêm 18:00 đến 05:00' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gửi xác nhận giờ thực tế' }));
    await waitFor(() => expect(api.saveTripDayLines).toHaveBeenCalled());
    expect(api.saveTripDayLines).toHaveBeenCalledWith('t1', {
      mode: 'ACTUAL',
      lines: [{ date: '2025-10-12', windows: [{ from: '18:00', to: '05:00' }] }],
    });
    expect(await screen.findByText('Chờ xác nhận')).toBeTruthy();
  });

  it('lỗi từ máy chủ hiện ngay dưới bảng', async () => {
    api.tripDayLines.mockResolvedValue(trip([line('2025-10-12')]));
    api.saveTripDayLines.mockRejectedValue(new Error('Ngày 2025-10-12 đã được duyệt giờ thực tế'));
    render(<TripDayLinesPanel tripId="t1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Khai giờ thực tế' }));
    // Khai giờ dự kiến đang tạm ẩn: chỉ còn khai giờ thực tế.
    expect(screen.queryByRole('button', { name: 'Khai giờ dự kiến' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ca đêm 18:00 đến 05:00' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gửi xác nhận giờ thực tế' }));
    expect(await screen.findByText('Ngày 2025-10-12 đã được duyệt giờ thực tế')).toBeTruthy();
  });

  it('người duyệt thấy nút xác nhận khi có ngày chờ; nhân viên thì không', async () => {
    const pending = trip([line('2025-10-12', { status: 'ACTUAL_PENDING', actualWindows: [{ from: '18:00', to: '05:00' }] })], {
      canDecide: true,
      canEdit: false,
    });
    api.tripDayLines.mockResolvedValue(pending);
    api.decideTripDayLines.mockResolvedValue({ ...pending, lines: [line('2025-10-12', { status: 'ACTUAL_APPROVED' })] });
    const { unmount } = render(<TripDayLinesPanel tripId="t1" />);
    expect(await screen.findByText(/1 ngày đang chờ bạn xác nhận/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Khai giờ dự kiến' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận giờ thực tế' }));
    await waitFor(() => expect(api.decideTripDayLines).toHaveBeenCalledWith('t1', { decision: 'APPROVE', note: '' }));
    unmount();
    api.tripDayLines.mockResolvedValue({ ...pending, canDecide: false, canEdit: true });
    render(<TripDayLinesPanel tripId="t1" />);
    await screen.findByText('Chờ xác nhận');
    expect(screen.queryByText(/đang chờ bạn xác nhận/)).toBeNull();
  });
});
