/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { hrmFetch } from '../hrm-api';
import LeaveAdjustmentHistoryScreen from './leave-adjustment-history-screen';

const mockActions = new Set<string>(['hrm.leave.read']);
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
  return { ...actual, hrmFetch: jest.fn() };
});

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;

const tx = (over: Record<string, unknown>) => ({
  id: 'tx-1',
  tenantId: 't',
  employeeId: 'e-1',
  leaveTypeId: 'lt-1',
  transactionType: 'ADJUSTMENT',
  daysChanged: 2,
  balanceAfter: 10,
  note: 'Bù phép tồn',
  balanceYear: 2026,
  createdAt: '2026-10-01T03:00:00.000Z',
  employeeName: 'Nguyễn Văn An',
  employeeCode: 'NV001',
  department: 'Kế toán',
  actorLabel: 'NV009 · Trần Thị HR',
  actorEmail: 'hr@savinajsc.com',
  ...over,
});

describe('Lịch sử điều chỉnh phép năm', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      data: [
        tx({}),
        tx({ id: 'tx-2', transactionType: 'REVERSAL', daysChanged: -2, note: 'Đảo tx-1: nhập nhầm' }),
        tx({ id: 'tx-3', employeeName: 'Lê Văn Cũ', actorLabel: null, actorEmail: null, note: 'Dữ liệu cũ' }),
      ],
    } as never);
  });

  it('chỉ lấy điều chỉnh và đảo điều chỉnh của phép năm, hiện tài khoản thực hiện (tên và email)', async () => {
    render(<LeaveAdjustmentHistoryScreen />);
    await waitFor(() => expect(screen.getAllByTestId('leave-adjustment-row')).toHaveLength(3));
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('types=ADJUSTMENT%2CREVERSAL');
    expect(url).toContain('annual=1');
    const actors = screen.getAllByTestId('adjustment-actor').map((c) => c.textContent);
    expect(actors[0]).toContain('Trần Thị HR');
    expect(actors[0]).toContain('hr@savinajsc.com');
    expect(actors[2]).toContain('Không xác định (dữ liệu cũ)');
  });

  it('tìm theo tài khoản thực hiện', async () => {
    render(<LeaveAdjustmentHistoryScreen />);
    await waitFor(() => expect(screen.getAllByTestId('leave-adjustment-row')).toHaveLength(3));
    fireEvent.change(screen.getByLabelText(/Tìm theo nhân viên, tài khoản thực hiện/), { target: { value: 'hr@savina' } });
    expect(screen.getAllByTestId('leave-adjustment-row')).toHaveLength(2);
  });

  it('không có quyền xem thì báo và không gọi API', () => {
    mockActions.clear();
    render(<LeaveAdjustmentHistoryScreen />);
    expect(screen.getByRole('alert').textContent).toContain('không có quyền');
    expect(fetchMock).not.toHaveBeenCalled();
    mockActions.add('hrm.leave.read');
  });
});
