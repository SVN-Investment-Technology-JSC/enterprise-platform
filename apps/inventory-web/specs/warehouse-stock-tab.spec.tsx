import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { WarehouseStockTab } from '@enterprise-platform/feature-inventory';

const mockHistory = jest.fn();

jest.mock('../../../packages/features/inventory/src/lib/inventory-api', () => ({
  loadMaterialHistory: (code: string) => mockHistory(code),
}));
jest.mock('@enterprise-platform/shared-ui', () => ({
  formatDateTime: (value: string) => value,
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

const material = (patch: Record<string, unknown>) => ({
  id: String(patch.code),
  category: 'CONSUMABLE',
  unit: 'Cái',
  minStock: 0,
  maxStock: 0,
  isSerialized: false,
  isActive: true,
  kind: 'STOCK',
  ...patch,
});

const warehouses = [
  { id: 'w1', code: 'K1', name: 'Kho chính', type: 'PHYSICAL', isActive: true },
  { id: 'w2', code: 'K2', name: 'Kho phụ', type: 'PHYSICAL', isActive: true },
] as never;

const line = (id: string, warehouseId: string, materialId: string, quantity: number, reserved = 0) => ({
  id,
  warehouseId,
  materialId,
  quantity,
  quantityReserved: reserved,
  quantityBlocked: 0,
  available: quantity - reserved,
  updatedAt: '2026-11-01T00:00:00Z',
});

const materials = [
  material({ code: 'VT-001', name: 'Cáp điện', unit: 'Mét', minStock: 50 }),
  material({ code: 'VT-002', name: 'Găng tay' }),
  material({ code: 'DV-001', name: 'Dịch vụ lắp đặt', kind: 'SERVICE' }),
] as never;

const stock = [
  line('s1', 'w1', 'VT-001', 30, 5),
  line('s2', 'w2', 'VT-001', 10),
  line('s3', 'w1', 'VT-002', 0),
  line('s4', 'w2', 'VT-002', 200),
  line('s5', 'w1', 'DV-001', 3),
] as never;

describe('WarehouseStockTab', () => {
  beforeEach(() => {
    mockHistory.mockResolvedValue([
      { id: 'h1', transactionCode: 'TX-1', warehouseId: 'w1', materialId: 'VT-001', type: 'IMPORT', quantity: 30, createdBy: 'Thủ kho', createdAt: '2026-11-01', documentNumber: 'PN-01' },
      { id: 'h2', transactionCode: 'TX-2', warehouseId: 'w2', materialId: 'VT-001', type: 'IMPORT', quantity: 10, createdBy: 'Thủ kho', createdAt: '2026-11-02', documentNumber: 'PN-02' },
    ]);
  });
  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  it('bảng năm cột; bỏ dịch vụ và dòng hết hàng; hiện dòng hết hàng khi bật ô', () => {
    render(<WarehouseStockTab materials={materials} warehouses={warehouses} stock={stock} />);
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Mã',
      'Tên',
      'Kho',
      'Đơn vị',
      'Số lượng',
    ]);
    // VT-001 ở hai kho, VT-002 chỉ còn ở Kho phụ; dịch vụ không có tồn.
    expect(screen.getAllByRole('row')).toHaveLength(1 + 3);
    expect(screen.queryByText('Dịch vụ lắp đặt')).toBeNull();
    fireEvent.click(screen.getByLabelText(/Hiện cả dòng hết hàng/));
    expect(screen.getAllByRole('row')).toHaveLength(1 + 4);
  });

  it('lọc theo kho, mức tồn và tìm kiếm không dấu', () => {
    render(<WarehouseStockTab materials={materials} warehouses={warehouses} stock={stock} />);
    fireEvent.change(screen.getByLabelText('Kho'), { target: { value: 'w2' } });
    expect(screen.getAllByRole('row')).toHaveLength(1 + 2);
    fireEvent.change(screen.getByLabelText('Kho'), { target: { value: '' } });

    // Cáp điện: khả dụng 25 + 10 = 35 < tối thiểu 50.
    fireEvent.change(screen.getByLabelText('Mức tồn'), { target: { value: 'LOW' } });
    expect(screen.getAllByRole('row')).toHaveLength(1 + 2);
    expect(screen.queryByText('Găng tay')).toBeNull();
    fireEvent.change(screen.getByLabelText('Mức tồn'), { target: { value: 'EMPTY' } });
    expect(screen.getAllByRole('row')).toHaveLength(1 + 1);
    fireEvent.change(screen.getByLabelText('Mức tồn'), { target: { value: '' } });

    fireEvent.change(screen.getByLabelText('Tìm trong kho'), { target: { value: 'gang tay' } });
    expect(screen.getAllByRole('row')).toHaveLength(1 + 1);
    expect(screen.getByText('Găng tay')).toBeTruthy();
  });

  it('chân trang đổi số bản ghi (15, 30, 45) và chuyển trang', () => {
    const many = Array.from({ length: 40 }, (_, i) => material({ code: `VT-${String(i).padStart(3, '0')}`, name: `Hàng ${i}` }));
    const rows = many.map((m, i) => line(`r${i}`, 'w1', String(m.code), 5));
    render(<WarehouseStockTab materials={many as never} warehouses={warehouses} stock={rows as never} />);
    const sizes = screen.getByLabelText('Số bản ghi') as HTMLSelectElement;
    expect([...sizes.options].map((o) => o.value).filter(Boolean)).toEqual(['15', '30', '45']);
    expect(screen.getByText('1–15 / 40')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    expect(screen.getByText('16–30 / 40')).toBeTruthy();
    fireEvent.change(sizes, { target: { value: '45' } });
    expect(screen.getByText('1–40 / 40')).toBeTruthy();
  });

  it('bấm một dòng mở drawer: chi tiết tồn, lịch sử chỉ của kho đó và tồn theo kho', async () => {
    render(<WarehouseStockTab materials={materials} warehouses={warehouses} stock={stock} />);
    fireEvent.click(screen.getAllByText('Cáp điện')[0]);
    const drawer = screen.getByRole('dialog', { name: 'Tồn VT-001' });
    // "Tồn thực tế", "Đã giữ" và "Khả dụng" vừa là trường chi tiết vừa là cột của bảng tồn theo kho.
    for (const label of ['Tồn thực tế', 'Đã giữ', 'Khả dụng']) {
      expect(within(drawer).getAllByText(label).length).toBeGreaterThanOrEqual(2);
    }
    expect(within(drawer).getByText('Tồn tối thiểu')).toBeTruthy();
    expect(within(drawer).getByRole('heading', { name: 'Lịch sử xuất nhập tại kho này' })).toBeTruthy();
    await within(drawer).findByText('TX-1');
    // Phát sinh ở kho phụ không hiện trong lịch sử của dòng Kho chính.
    expect(within(drawer).queryByText('TX-2')).toBeNull();
    expect(within(drawer).getByRole('heading', { name: 'Tồn theo kho' })).toBeTruthy();
    expect(within(drawer).getByText('Tổng')).toBeTruthy();
    expect(mockHistory).toHaveBeenCalledWith('VT-001');
  });

  it('nút thao tác chỉ hiện khi có quyền và gửi đúng loại phiếu, mã vật tư', () => {
    const onOpenMovement = jest.fn();
    const onOpenStocktake = jest.fn();
    const { rerender } = render(<WarehouseStockTab materials={materials} warehouses={warehouses} stock={stock} />);
    expect(screen.queryByRole('button', { name: /Nhập kho/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Tạo đợt kiểm kê/ })).toBeNull();

    rerender(
      <WarehouseStockTab
        materials={materials}
        warehouses={warehouses}
        stock={stock}
        onOpenMovement={onOpenMovement}
        onOpenStocktake={onOpenStocktake}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Xuất kho/ }));
    expect(onOpenMovement).toHaveBeenLastCalledWith({ kind: 'issue' });
    fireEvent.change(screen.getByLabelText('Kho'), { target: { value: 'w2' } });
    fireEvent.click(screen.getByRole('button', { name: /Tạo đợt kiểm kê/ }));
    expect(onOpenStocktake).toHaveBeenCalledWith({ warehouseCode: 'K2' });

    fireEvent.click(screen.getAllByText('Cáp điện')[0]);
    const drawer = screen.getByRole('dialog', { name: 'Tồn VT-001' });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Nhập kho' }));
    expect(onOpenMovement).toHaveBeenLastCalledWith({ kind: 'receipt', materialCode: 'VT-001' });
  });
});
