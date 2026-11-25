import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SerialHub } from '../../../packages/features/inventory/src/lib/components/serial-hub';

const mockLoadAllSerials = jest.fn();

jest.mock('../../../packages/features/inventory/src/lib/inventory-api', () => ({
  loadAllSerials: () => mockLoadAllSerials(),
  deleteSerial: jest.fn(),
  loadSerialHistory: jest.fn().mockResolvedValue({
    serialNumber: 'SN-A1',
    materialCode: 'MAT-A',
    events: [],
    movements: [],
  }),
  updateSerial: jest.fn(),
}));

jest.mock('../../../packages/features/inventory/src/lib/inventory-permissions', () => ({
  useInventoryPermissions: () => ({ canManage: true }),
}));

jest.mock('@enterprise-platform/shared-ui', () => ({
  ...jest.requireActual('../../../packages/shared/ui/src/lib/currency-format'),
  ...jest.requireActual('../../../packages/shared/ui/src/lib/vn-number-input'),
  ...jest.requireActual('../../../packages/shared/ui/src/lib/close-guard'),
  formatDateTime: (value: string) => value,
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
  SearchableSelect: ({
    options,
    value,
    placeholder,
    onChange,
  }: {
    options: { value: string; label: string }[];
    value: string;
    placeholder?: string;
    onChange: (value: string) => void;
  }) => (
    <select aria-label={placeholder ?? 'Số bản ghi'} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">--</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const materials = [
  { id: 'm1', code: 'MAT-A', name: 'Sản phẩm A', unit: 'Cái', isSerialized: true, trackingMode: 'SERIAL', isActive: true },
  { id: 'm2', code: 'MAT-B', name: 'Sản phẩm B', unit: 'Cái', isSerialized: true, trackingMode: 'SERIAL', isActive: true },
] as never;

const warehouses = [{ id: 'w1', code: 'K1', name: 'Kho chính', type: 'PHYSICAL', isActive: true }] as never;

const serialRows = [
  { id: 's1', materialCode: 'MAT-A', serialNumber: 'SN-A1', stockState: 'IN_STOCK', currentWarehouseId: 'w1', qualityStatus: 'PASSED' },
  { id: 's2', materialCode: 'MAT-A', serialNumber: 'SN-A2', qualityStatus: 'PASSED' },
  { id: 's3', materialCode: 'MAT-B', serialNumber: 'SN-B1', stockState: 'IN_STOCK', currentWarehouseId: 'w1', qualityStatus: 'PASSED' },
  { id: 's4', materialCode: 'MAT-B', serialNumber: 'SN-B2', qualityStatus: 'PASSED' },
];

describe('SerialHub', () => {
  beforeEach(() => {
    mockLoadAllSerials.mockResolvedValue(serialRows);
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  it('gom nhóm serial theo vật tư, xổ chi tiết khi bấm nhóm và mở drawer khi bấm serial', async () => {
    render(<SerialHub materials={materials} warehouses={warehouses} statuses={['PASSED']} usageStates={['NEW']} />);

    await waitFor(() => {
      expect(screen.getByText('MAT-A')).toBeTruthy();
      expect(screen.getByText('MAT-B')).toBeTruthy();
    });

    // Mặc định thu gọn, chưa hiển thị mã serial chi tiết
    expect(screen.queryByText('SN-A1')).toBeNull();
    expect(screen.queryByText('SN-B1')).toBeNull();
    expect(screen.getAllByText('2 serial')).toHaveLength(2);

    // Bấm nhóm Sản phẩm A -> xổ ra SN-A1, SN-A2; nhóm B vẫn thu gọn
    fireEvent.click(screen.getByText('MAT-A'));
    expect(screen.getByText('SN-A1')).toBeTruthy();
    expect(screen.getByText('SN-A2')).toBeTruthy();
    expect(screen.queryByText('SN-B1')).toBeNull();

    // Bấm vào SN-A1 -> mở drawer vòng đời
    fireEvent.click(screen.getByText('SN-A1'));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy();
    });

    // Bấm lại nhóm A -> thu gọn (SN-A2 biến mất khỏi bảng)
    fireEvent.click(screen.getAllByText('MAT-A')[0]);
    expect(screen.queryByText('SN-A2')).toBeNull();
  });
});
