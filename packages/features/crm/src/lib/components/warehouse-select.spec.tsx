/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { clearWarehouseCache, WarehouseSelect } from './warehouse-select';

const mockLoadWarehouses = jest.fn();
jest.mock('../crm-api', () => ({ loadWarehouses: (...args: unknown[]) => mockLoadWarehouses(...args) }));
jest.mock('@enterprise-platform/shared-ui', () => ({
  SearchableSelect: ({
    options,
    value,
    placeholder,
    onChange,
  }: {
    options: { value: string; label: string; description?: string }[];
    value: string;
    placeholder?: string;
    onChange: (value: string) => void;
  }) => (
    <div data-value={value} data-placeholder={placeholder}>
      {options.map((option) => (
        <button key={option.value} type="button" onClick={() => onChange(option.value)}>
          {`${option.label}|${option.description ?? ''}`}
        </button>
      ))}
      <button type="button" onClick={() => onChange('')}>
        bỏ chọn
      </button>
    </div>
  ),
}));

beforeEach(() => {
  clearWarehouseCache();
  mockLoadWarehouses.mockReset();
  mockLoadWarehouses.mockResolvedValue([
    { code: 'KHO-1', name: 'Kho Hà Nội', isActive: true },
    { code: 'KHO-2', name: 'Kho Hồ Chí Minh', isActive: true },
    { code: 'KHO-OLD', name: 'Kho cũ', isActive: false },
  ]);
});

describe('WarehouseSelect (D3-37)', () => {
  it('kho đang hoạt động kèm tồn khả dụng của mặt hàng; chọn trả mã kho, bỏ chọn trả rỗng', async () => {
    const onChange = jest.fn();
    render(<WarehouseSelect value={null} onChange={onChange} stock={[{ warehouseCode: 'KHO-2', available: 12 }]} />);
    await waitFor(() => expect(screen.getByText('Kho Hồ Chí Minh|Khả dụng 12')).toBeTruthy());
    expect(screen.getByText('Kho Hà Nội|Khả dụng 0')).toBeTruthy();
    expect(screen.queryByText(/Kho cũ/)).toBeNull();
    fireEvent.click(screen.getByText('Kho Hồ Chí Minh|Khả dụng 12'));
    expect(onChange).toHaveBeenLastCalledWith('KHO-2');
    fireEvent.click(screen.getByText('bỏ chọn'));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('danh sách kho tải một lần cho nhiều ô; kho đang chọn đã ngừng vẫn hiện', async () => {
    render(
      <>
        <WarehouseSelect value="KHO-OLD" onChange={jest.fn()} />
        <WarehouseSelect value={null} onChange={jest.fn()} />
      </>,
    );
    await waitFor(() => expect(screen.getByText('Kho cũ|')).toBeTruthy());
    expect(mockLoadWarehouses).toHaveBeenCalledTimes(1);
  });
});
