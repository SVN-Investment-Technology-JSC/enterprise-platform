/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { HrmCompOffBalanceDetail, HrmCompOffLedgerEntry } from '@enterprise-platform/contracts-hrm';
import { compOffApi } from '../../hrm-comp-off-api';
import { CompOffLedgerSheet } from './comp-off-ledger-sheet';

const mockActions = new Set<string>();
jest.mock('../../hrm-permissions', () => ({
  useHrmPermissions: () => ({
    actions: [...mockActions],
    loading: false,
    error: '',
    displayName: '',
    can: (p: string) => mockActions.has(p),
    any: (list: readonly string[]) => list.some((p) => mockActions.has(p)),
  }),
}));
jest.mock('../../hrm-comp-off-api', () => ({
  compOffApi: { detail: jest.fn(), reverseAdjustment: jest.fn() },
}));

const api = compOffApi as jest.Mocked<typeof compOffApi>;

const entry = (over: Partial<HrmCompOffLedgerEntry>): HrmCompOffLedgerEntry => ({
  id: 'x',
  kind: 'ADJUST',
  days: 1,
  occurredOn: '2026-11-13',
  lotId: 'lot',
  expiresOn: null,
  periodMonth: null,
  sourceHours: null,
  capHours: null,
  excessHours: null,
  requestId: null,
  reason: null,
  createdBy: 'u1',
  createdAt: '2026-11-13T01:00:00.000Z',
  actorLabel: 'HR01 · Nguyễn Thị Hoa',
  source: 'MANUAL',
  batchId: null,
  reversesId: null,
  reversedById: null,
  ...over,
});

const detail = (entries: HrmCompOffLedgerEntry[]): HrmCompOffBalanceDetail => ({
  employeeId: 'e1',
  available: 4.3,
  reserved: 0,
  usageStepDays: 0.5,
  lots: [],
  entries,
});

beforeEach(() => {
  mockActions.clear();
  jest.clearAllMocks();
});

describe('sổ quỹ nghỉ bù: lịch sử điều chỉnh và import', () => {
  it('hiện người thực hiện, nguồn import và đánh dấu dòng đã đảo; dòng đảo không có nút đảo', async () => {
    mockActions.add('hrm.comp_off.adjust');
    api.detail.mockResolvedValue(
      detail([
        entry({ id: 'rev', days: -1, reason: 'Nhập nhầm', reversesId: 'imp-done' }),
        entry({ id: 'imp-done', days: 1, reason: 'Quy đổi T10', source: 'IMPORT', batchId: 'b1', reversedById: 'rev' }),
        entry({ id: 'imp-live', days: 4.3, reason: 'Quy đổi T10 (23 giờ)', source: 'IMPORT', batchId: 'b1' }),
      ]),
    );
    render(<CompOffLedgerSheet employee={{ id: 'e1', label: 'NV1 - Nhân viên 1' }} onClose={() => undefined} />);
    expect(await screen.findByText('Quy đổi T10 (23 giờ)')).toBeTruthy();
    expect(screen.getAllByText('HR01 · Nguyễn Thị Hoa').length).toBe(3);
    expect(screen.getAllByText('Import Excel').length).toBe(2);
    expect(screen.getAllByText('Bấm tay').length).toBe(1);
    expect(screen.getByText('Đã đảo điều chỉnh')).toBeTruthy();
    // Chỉ dòng điều chỉnh chưa đảo và không phải dòng đảo mới có nút.
    expect(screen.getAllByRole('button', { name: 'Đảo điều chỉnh' })).toHaveLength(1);
  });

  it('không có quyền điều chỉnh thì không có cột và nút thao tác', async () => {
    api.detail.mockResolvedValue(detail([entry({ id: 'a', reason: 'Cộng', source: 'IMPORT' })]));
    render(<CompOffLedgerSheet employee={{ id: 'e1', label: 'NV1' }} onClose={() => undefined} />);
    await screen.findByText('Cộng');
    expect(screen.queryByRole('button', { name: 'Đảo điều chỉnh' })).toBeNull();
    expect(screen.queryByText('Thao tác')).toBeNull();
  });

  it('đảo điều chỉnh cần lý do, gọi API rồi tải lại sổ và báo màn chính', async () => {
    mockActions.add('hrm.comp_off.adjust');
    api.detail.mockResolvedValue(detail([entry({ id: 'imp-live', days: 4.3, reason: 'Quy đổi T10', source: 'IMPORT' })]));
    api.reverseAdjustment.mockResolvedValue({ available: 0, reversalId: 'r1' });
    const onChanged = jest.fn();
    render(<CompOffLedgerSheet employee={{ id: 'e1', label: 'NV1' }} onClose={() => undefined} onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Đảo điều chỉnh' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = (await within(dialog).findByRole('button', { name: 'Xác nhận' })) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Lý do đảo điều chỉnh/), { target: { value: 'Nhập nhầm tệp' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(api.reverseAdjustment).toHaveBeenCalledWith('imp-live', 'Nhập nhầm tệp'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.detail).toHaveBeenCalledTimes(2);
  });
});
