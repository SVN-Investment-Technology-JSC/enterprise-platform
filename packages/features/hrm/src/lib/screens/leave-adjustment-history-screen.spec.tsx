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

  it('có quyền xem quỹ nghỉ bù thì gộp cả dòng import nghỉ bù và lọc được theo quỹ', async () => {
    mockActions.add('hrm.comp_off.view');
    fetchMock.mockImplementation((async (path: string) => {
      if (String(path).startsWith('/comp-off/adjustments'))
        return {
          data: [
            {
              id: 'c-1',
              kind: 'ADJUST',
              days: 4.3,
              occurredOn: '2026-11-13',
              createdAt: '2026-11-13T02:00:00.000Z',
              reason: 'Quy đổi T10 (23 giờ)',
              source: 'IMPORT',
              reversesId: null,
              actorLabel: 'HR01 · Nguyễn Thị Hoa',
              actorEmail: 'hoa@savinajsc.com',
              employeeId: 'e-9',
              employeeName: 'Phạm Văn Bù',
              employeeCode: 'NV099',
              department: 'Kho',
            },
          ],
        };
      return { data: [tx({})] };
    }) as never);
    render(<LeaveAdjustmentHistoryScreen />);
    await waitFor(() => expect(screen.getAllByTestId('leave-adjustment-row')).toHaveLength(2));
    expect(screen.getByText('Phạm Văn Bù')).toBeTruthy();
    expect(screen.getByText('Import Excel')).toBeTruthy();
    expect(screen.getByText('Quy đổi T10 (23 giờ)')).toBeTruthy();
    // Dòng mới nhất (nghỉ bù, 13/11) nằm trên dòng phép năm (01/10).
    expect(screen.getAllByTestId('leave-adjustment-row')[0].textContent).toContain('Phạm Văn Bù');
    mockActions.delete('hrm.comp_off.view');
  });

  it('mặc định sắp xếp mới nhất trước dù hai quỹ trả thời gian khác định dạng', async () => {
    mockActions.add('hrm.comp_off.view');
    const compOff = (id: string, createdAt: string) => ({
      id,
      kind: 'ADJUST',
      days: 1,
      occurredOn: '2026-11-13',
      createdAt,
      reason: id,
      source: 'MANUAL',
      reversesId: null,
      employeeId: 'e-9',
      employeeName: 'Bù ' + id,
      employeeCode: 'NV099',
      department: null,
    });
    fetchMock.mockImplementation((async (path: string) => {
      if (String(path).startsWith('/comp-off/adjustments'))
        return { data: [compOff('moi', '2026-11-13T07:32:35.000Z'), compOff('cu', '2026-11-11T03:00:00.000Z')] };
      return {
        data: [
          tx({ id: 'a-giua', employeeName: 'Phép giữa', createdAt: 'Fri Nov 13 2026 09:00:00 GMT+0700 (Indochina Time)' }),
          tx({ id: 'a-cu', employeeName: 'Phép cũ', createdAt: '2026-10-01T03:00:00.000Z' }),
        ],
      };
    }) as never);
    render(<LeaveAdjustmentHistoryScreen />);
    await waitFor(() => expect(screen.getAllByTestId('leave-adjustment-row')).toHaveLength(4));
    const names = screen.getAllByTestId('leave-adjustment-row').map((r) => r.textContent ?? '');
    expect(names[0]).toContain('Bù moi');
    expect(names[1]).toContain('Phép giữa');
    expect(names[2]).toContain('Bù cu');
    expect(names[3]).toContain('Phép cũ');
    mockActions.delete('hrm.comp_off.view');
  });

  it('không có quyền xem quỹ nghỉ bù thì không gọi API nghỉ bù', async () => {
    render(<LeaveAdjustmentHistoryScreen />);
    await waitFor(() => expect(screen.getAllByTestId('leave-adjustment-row')).toHaveLength(3));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith('/comp-off'))).toBe(false);
  });

  it('không có quyền xem thì báo và không gọi API', () => {
    mockActions.clear();
    render(<LeaveAdjustmentHistoryScreen />);
    expect(screen.getByRole('alert').textContent).toContain('không có quyền');
    expect(fetchMock).not.toHaveBeenCalled();
    mockActions.add('hrm.leave.read');
  });
});
