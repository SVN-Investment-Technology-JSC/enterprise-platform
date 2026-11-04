import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import {
  MaterialHistorySection,
  loadUserNames,
  resetUserNamesForTest,
  userLabel,
} from '@enterprise-platform/feature-inventory';

const USER_ID = 'fe5f4c6c-7881-4fe6-b882-481c352ba066';
const mockAuthFetch = jest.fn();
const mockHistory = jest.fn();

jest.mock('@enterprise-platform/shared-ui', () => ({
  authFetch: (...args: unknown[]) => mockAuthFetch(...args),
  formatDateTime: (value: string) => value,
}));

jest.mock('../../../packages/features/inventory/src/lib/inventory-api', () => ({
  loadMaterialHistory: () => mockHistory(),
}));

const ROW = {
  id: 'h1',
  transactionCode: 'TXN-1793176477443-234',
  warehouseId: 'w1',
  materialId: 'm1',
  type: 'RECEIPT',
  quantity: 2,
  createdBy: USER_ID,
  createdAt: '2026-10-28T14:12:00Z',
  documentNumber: 'test',
};
const WAREHOUSES = [{ id: 'w1', code: 'K1', name: 'Kho Gia Lai', type: 'MAIN', isActive: true }] as never;

beforeEach(() => {
  resetUserNamesForTest();
  mockAuthFetch.mockReset();
  mockHistory.mockResolvedValue([ROW]);
});
afterEach(cleanup);

describe('userLabel', () => {
  const names = new Map([[USER_ID, 'Nguyễn Văn An']]);

  it('có trong danh bạ thì hiện tên; dữ liệu cũ lưu thẳng tên thì giữ nguyên', () => {
    expect(userLabel(names, USER_ID)).toBe('Nguyễn Văn An');
    expect(userLabel(names, 'Thủ kho')).toBe('Thủ kho');
  });

  it('id không tra được thì rút còn 8 ký tự đầu, rỗng thì hiện dấu gạch', () => {
    expect(userLabel(names, '11111111-2222-3333-4444-555555555555')).toBe('11111111');
    expect(userLabel(names, undefined)).toBe('—');
    expect(userLabel(names, '  ', 'Hệ thống')).toBe('Hệ thống');
  });
});

describe('loadUserNames', () => {
  it('đọc danh bạ Workspace một lần cho cả phiên', async () => {
    mockAuthFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ people: [{ userId: USER_ID, displayName: 'Nguyễn Văn An' }, { userId: 'x' }] }),
    });
    const first = await loadUserNames();
    await loadUserNames();
    expect(first.get(USER_ID)).toBe('Nguyễn Văn An');
    expect(first.has('x')).toBe(false);
    expect(mockAuthFetch).toHaveBeenCalledTimes(1);
    expect(mockAuthFetch.mock.calls[0][0]).toBe('/api/workspace/v1/directory');
  });

  it('lỗi thì trả danh bạ rỗng và lần sau thử lại', async () => {
    mockAuthFetch.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });
    expect((await loadUserNames()).size).toBe(0);
    mockAuthFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ people: [{ userId: USER_ID, displayName: 'Nguyễn Văn An' }] }),
    });
    expect((await loadUserNames()).get(USER_ID)).toBe('Nguyễn Văn An');
  });
});

describe('Lịch sử xuất nhập: người thực hiện', () => {
  const material = { code: 'BO-DO', unit: 'Bộ', kind: 'STOCK' } as never;

  it('hiện tên người dùng thay cho id', async () => {
    mockAuthFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ people: [{ userId: USER_ID, displayName: 'Nguyễn Văn An' }] }),
    });
    render(<MaterialHistorySection material={material} warehouses={WAREHOUSES} />);
    expect(await screen.findByText('Nguyễn Văn An')).toBeTruthy();
    expect(screen.queryByText(USER_ID)).toBeNull();
  });

  it('không có danh bạ thì hiện id rút gọn, không để lộ cả chuỗi dài', async () => {
    mockAuthFetch.mockRejectedValue(new Error('offline'));
    render(<MaterialHistorySection material={material} warehouses={WAREHOUSES} />);
    await waitFor(() => expect(screen.getByText('fe5f4c6c')).toBeTruthy());
    expect(screen.queryByText(USER_ID)).toBeNull();
  });

  it('số phiếu luôn là mã giao dịch; số hóa đơn nhập tay hiện dòng dưới khi có', async () => {
    mockAuthFetch.mockRejectedValue(new Error('offline'));
    mockHistory.mockResolvedValue([
      ROW,
      { ...ROW, id: 'h2', transactionCode: 'TXN-2', documentNumber: undefined },
    ]);
    render(<MaterialHistorySection material={material} warehouses={WAREHOUSES} />);
    expect(await screen.findByText('Hóa đơn: test')).toBeTruthy();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0].textContent).toContain('TXN-1793176477443-234');
    expect(rows[1].textContent).toContain('TXN-2');
    // Dòng không có số hóa đơn thì không có dòng phụ.
    expect(rows[1].textContent).not.toContain('Hóa đơn');
    expect(screen.getAllByText(/^Hóa đơn:/)).toHaveLength(1);
  });
});
