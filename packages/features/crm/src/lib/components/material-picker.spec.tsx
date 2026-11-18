import type { CrmCatalogMaterial } from '@enterprise-platform/contracts-crm';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MaterialPickerDialog } from './material-picker';

const material: CrmCatalogMaterial = {
  id: 'm-3333',
  code: '3333',
  name: 'Mặt hàng chưa có giá',
  unit: 'Cái',
  kind: 'STOCK',
  category: null,
  salePrice: null,
  avgCost: null,
  totalAvailable: 0,
  availableByWarehouse: null,
};

jest.mock('../sales.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));
// Bảng antd không chạy trong jsdom: thay bằng danh sách bấm được để chọn dòng.
jest.mock('antd', () => ({
  Table: ({
    dataSource,
    onRow,
  }: {
    dataSource: readonly { id: string; code: string }[];
    onRow: (row: { id: string; code: string }) => { onClick: () => void };
  }) => (
    <div>
      {dataSource.map((row) => (
        <button type="button" key={row.id} onClick={onRow(row).onClick}>
          {row.code}
        </button>
      ))}
    </div>
  ),
}));
jest.mock('./catalog-search', () => ({
  useCatalogSearch: () => ({ items: [material], loading: false, error: undefined }),
  CatalogSearchBar: () => null,
  CatalogPager: () => null,
}));

describe('MaterialPickerDialog: đơn giá ghi đè (dòng đơn bán)', () => {
  it('nhập đơn giá ghi đè thì trả về unitPrice', async () => {
    const onPick = jest.fn().mockResolvedValue(undefined);
    render(<MaterialPickerDialog title="Thêm dòng đơn" withOverridePrice onClose={jest.fn()} onPick={onPick} />);
    fireEvent.click(screen.getByText('3333'));
    fireEvent.change(screen.getByLabelText('Đơn giá ghi đè'), { target: { value: '50000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm dòng' }));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ unitPrice: 50000, quantity: 1 })));
  });

  it('bỏ trống đơn giá ghi đè thì unitPrice rỗng (theo bảng giá)', async () => {
    const onPick = jest.fn().mockResolvedValue(undefined);
    render(<MaterialPickerDialog title="Thêm dòng đơn" withOverridePrice onClose={jest.fn()} onPick={onPick} />);
    fireEvent.click(screen.getByText('3333'));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm dòng' }));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ unitPrice: null })));
  });

  it('đơn giá ghi đè âm hoặc không phải số: báo lỗi, không gửi', async () => {
    const onPick = jest.fn().mockResolvedValue(undefined);
    render(<MaterialPickerDialog title="Thêm dòng đơn" withOverridePrice onClose={jest.fn()} onPick={onPick} />);
    fireEvent.click(screen.getByText('3333'));
    fireEvent.change(screen.getByLabelText('Đơn giá ghi đè'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm dòng' }));
    expect(await screen.findByText('Đơn giá ghi đè phải là số không âm.')).toBeTruthy();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('không bật withOverridePrice thì không có ô ghi đè', () => {
    render(<MaterialPickerDialog title="Chọn mặt hàng" onClose={jest.fn()} onPick={jest.fn()} />);
    expect(screen.queryByLabelText('Đơn giá ghi đè')).toBeNull();
  });
});
