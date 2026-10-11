/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { HrmTripAllowanceRate } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { TripAllowancePanel } from './trip-allowance-panel';

jest.mock('../hrm-permissions', () => ({
  useHrmPermissions: () => ({
    actions: ['hrm.payroll.configure'],
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
jest.mock('./toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;
const rate = (over: Partial<HrmTripAllowanceRate>): HrmTripAllowanceRate => ({
  id: 'r1',
  tripType: 'DOMESTIC',
  dailyAmount: 300000,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  status: 'ACTIVE',
  note: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

beforeEach(() => fetchMock.mockReset());

describe('TripAllowancePanel', () => {
  it('liệt kê mức theo từng hình thức, báo hình thức chưa có mức hiện hành', async () => {
    fetchMock.mockResolvedValue({ data: [rate({})] } as never);
    render(<TripAllowancePanel />);
    const domestic = await screen.findByRole('region', { name: 'Công tác trong nước' });
    expect(within(domestic).getByText('Hiện hành')).toBeTruthy();
    expect(within(domestic).queryByText('Chưa có mức hiện hành')).toBeNull();
    const overseas = screen.getByRole('region', { name: 'Công tác nước ngoài' });
    expect(within(overseas).getByText('Chưa có mức hiện hành')).toBeTruthy();
    expect(within(overseas).getByText(/Chưa cấu hình/)).toBeTruthy();
  });

  it('thêm mức gọi POST với hình thức, số tiền và ngày hiệu lực', async () => {
    fetchMock.mockResolvedValue({ data: [] } as never);
    render(<TripAllowancePanel />);
    await screen.findByRole('region', { name: 'Công tác trong nước' });
    fireEvent.click(screen.getByRole('button', { name: /Thêm mức/ }));
    const dialog = await screen.findByRole('dialog');
    const amount = within(dialog).getByText(/Mức mỗi ngày công tác/).closest('label')!.querySelector('input')!;
    fireEvent.change(amount, { target: { value: '350000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/trip-allowance-rates',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const call = fetchMock.mock.calls.find((c) => c[1] && (c[1] as RequestInit).method === 'POST')!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toMatchObject({ tripType: 'DOMESTIC', dailyAmount: 350000 });
  });

  it('chỉ phiên bản gần nhất có nút huỷ, huỷ qua Popconfirm gọi DELETE', async () => {
    fetchMock.mockResolvedValue({
      data: [
        rate({ id: 'new', dailyAmount: 350000, effectiveFrom: '2026-06-01' }),
        rate({ id: 'old', dailyAmount: 300000, effectiveFrom: '2026-01-01', effectiveTo: '2026-05-31' }),
      ],
    } as never);
    render(<TripAllowancePanel />);
    await screen.findByRole('region', { name: 'Công tác trong nước' });
    expect(screen.getAllByRole('button', { name: /^Huỷ mức/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /^Huỷ mức/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Huỷ mức' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/trip-allowance-rates/new', expect.objectContaining({ method: 'DELETE' })),
    );
  });
});
