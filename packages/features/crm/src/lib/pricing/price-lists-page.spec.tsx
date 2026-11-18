/**
 * @jest-environment jsdom
 */
import {
  CRM_NO_CAPABILITIES,
  type CrmCapabilities,
  type PriceListDetail,
  type PriceListItem,
  type PriceListSummary,
} from '@enterprise-platform/contracts-crm';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PRICE_LISTS_CHANGED_EVENT } from './price-list-sync-banner';
import { NO_DEFAULT_LIST_HINT, PriceListsPage } from './price-lists-page';

jest.mock('../sales.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));
jest.mock('./pricing.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));

// Bảng antd đo kích thước bằng API jsdom không có; thay bằng bảng HTML giữ `columns`, `onRow`.
jest.mock('antd', () => ({
  Table: ({
    columns,
    dataSource,
    rowKey,
    onRow,
    locale,
  }: {
    columns: { key?: string; title?: ReactNode; dataIndex?: string; render?: (value: unknown, row: unknown, index: number) => unknown }[];
    dataSource: Record<string, unknown>[];
    rowKey: string;
    onRow?: (row: unknown) => Record<string, unknown>;
    locale?: { emptyText?: string };
  }) => (
    <table>
      <thead>
        <tr>
          {columns.map((column, index) => (
            <th key={column.key ?? column.dataIndex ?? index}>{column.title}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {dataSource.length ? (
          dataSource.map((row, index) => (
            <tr key={String(row[rowKey])} data-row-key={String(row[rowKey])} {...(onRow?.(row) ?? {})}>
              {columns.map((column, cell) => (
                <td key={column.key ?? column.dataIndex ?? cell}>
                  {(column.render ? column.render(column.dataIndex ? row[column.dataIndex] : undefined, row, index) : row[column.dataIndex ?? '']) as never}
                </td>
              ))}
            </tr>
          ))
        ) : (
          <tr>
            <td>{locale?.emptyText}</td>
          </tr>
        )}
      </tbody>
    </table>
  ),
}));

const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock('@enterprise-platform/shared-ui', () => ({
  SearchableSelect: ({ value }: { value: string }) => <div data-select-value={value} />,
  Popconfirm: ({ children, onConfirm, okText }: { children: ReactNode; onConfirm: () => void; okText: string }) => (
    <>
      {children}
      <button type="button" onClick={onConfirm}>{`Xác nhận ${okText}`}</button>
    </>
  ),
  toast: { success: (...args: unknown[]) => mockToast.success(...args), error: (...args: unknown[]) => mockToast.error(...args) },
}));
jest.mock('@enterprise-platform/shared-ui/date-picker', () => ({
  DatePickerInput: ({ value, onChange, 'aria-label': label }: { value?: string; onChange: (v: string) => void; 'aria-label'?: string }) => (
    <input aria-label={label} value={value ?? ''} onChange={(event) => onChange(event.target.value)} />
  ),
}));

const mockApi = {
  listPriceLists: jest.fn(),
  getPriceList: jest.fn(),
  deletePriceList: jest.fn(),
  deletePriceListItem: jest.fn(),
  setManualPrice: jest.fn(),
  clearManualPrice: jest.fn(),
  setPriceListVatRate: jest.fn(),
  createPriceList: jest.fn(),
  updatePriceList: jest.fn(),
  upsertPriceListItems: jest.fn(),
  updatePriceListItem: jest.fn(),
  searchCatalog: jest.fn(),
  listCatalogTradeCategories: jest.fn(),
};
jest.mock('../crm-api', () => ({
  errorMessage: (cause: { message?: string } | undefined, fallback: string) => cause?.message || fallback,
  ...Object.fromEntries(
    [
      'listPriceLists', 'getPriceList', 'deletePriceList', 'deletePriceListItem', 'setManualPrice', 'clearManualPrice', 'setPriceListVatRate',
      'createPriceList', 'updatePriceList', 'upsertPriceListItems', 'updatePriceListItem', 'searchCatalog', 'listCatalogTradeCategories',
    ].map((name) => [name, (...args: unknown[]) => mockApi[name as keyof typeof mockApi](...args)]),
  ),
}));

const MANAGER: CrmCapabilities = { ...CRM_NO_CAPABILITIES, canManage: true };
const STAFF: CrmCapabilities = { ...CRM_NO_CAPABILITIES, canWriteQuote: true };
let mockCapabilities = MANAGER;
jest.mock('../crm-context', () => ({
  ...jest.requireActual('../crm-context'),
  useCrm: () => ({ capabilities: mockCapabilities }),
}));

const summary = (id: string, patch: Partial<PriceListSummary> = {}): PriceListSummary => ({
  id,
  code: id.toUpperCase(),
  name: `Bảng ${id}`,
  listType: 'DERIVED',
  ratioPercent: 105,
  isStandard: false,
  currency: 'VND',
  validFrom: '2026-01-01',
  validTo: null,
  status: 'ACTIVE',
  note: null,
  itemCount: 3,
  usageCount: 0,
  updatedAt: '2026-01-01T00:00:00Z',
  ...patch,
});
const item = (id: string, patch: Partial<PriceListItem> = {}): PriceListItem => ({
  id,
  materialId: `m-${id}`,
  materialCode: `M${id}`,
  materialName: `Mặt hàng ${id}`,
  unit: 'Cái',
  price: 12_345,
  vatRate: 10,
  priceMode: 'SYNCED',
  sourceActive: true,
  ...patch,
});
const detail = (list: PriceListSummary, items: PriceListItem[]): PriceListDetail => ({ ...list, items });

const DEFAULT = summary('md', { code: 'BG-MAC-DINH', name: 'Bảng giá mặc định', listType: 'DEFAULT', ratioPercent: null });
const DERIVED = summary('105', { code: 'BG-105', name: 'Bảng giá 105', ratioPercent: 105, usageCount: 2 });
const MANUAL = summary('cu', { code: 'BG-CU', name: 'Bảng giá cũ', listType: 'MANUAL', ratioPercent: null });

const DEFAULT_ITEMS = [
  item('1', { price: 12_345 }),
  item('4', { price: null }),
  item('5', { price: 0 }),
  item('6', { price: 5_000, sourceActive: false }),
];
const DERIVED_ITEMS = [item('1', { price: 12_962, priceMode: 'RATIO' }), item('2', { price: 9_999, priceMode: 'MANUAL' })];
const MANUAL_ITEMS = [item('9', { price: 1_000, priceMode: 'MANUAL' })];

function stub(lists: PriceListSummary[] = [MANUAL, DERIVED, DEFAULT]) {
  mockApi.listPriceLists.mockResolvedValue(lists);
  mockApi.getPriceList.mockImplementation(async (id: string) =>
    id === DEFAULT.id ? detail(DEFAULT, DEFAULT_ITEMS) : id === DERIVED.id ? detail(DERIVED, DERIVED_ITEMS) : detail(MANUAL, MANUAL_ITEMS),
  );
}

const listTable = () => screen.getByRole('region', { name: 'Bảng giá' });
const itemsTable = () => screen.getByRole('region', { name: 'Dòng giá' });
const listRow = (code: string) => within(listTable()).getByText(code).closest('tr') as HTMLElement;
const itemRow = (code: string) => within(itemsTable()).getByText(code).closest('tr') as HTMLElement;

async function openList(code: string) {
  fireEvent.click(await within(listTable()).findByText(code));
  await within(itemsTable()).findByText(/Dòng giá: /);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCapabilities = MANAGER;
  stub();
});

describe('Trang bảng giá (C2)', () => {
  it('C2.1: cột "Loại" có Mặc định, Theo tỷ lệ (kèm %), Tự nhập; bảng mặc định đứng đầu; cột Đang dùng theo usageCount', async () => {
    render(<PriceListsPage />);
    await within(listTable()).findByText('BG-MAC-DINH');
    expect(within(listTable()).getAllByRole('columnheader').map((cell) => cell.textContent)).toContain('Loại');
    const rows = within(listTable()).getAllByRole('row').slice(1);
    expect(rows[0].textContent).toContain('BG-MAC-DINH');
    expect(listRow('BG-MAC-DINH').textContent).toContain('Mặc định');
    expect(listRow('BG-105').textContent).toContain('Theo tỷ lệ (105%)');
    expect(listRow('BG-CU').textContent).toContain('Tự nhập');
    expect(listRow('BG-105').textContent).toContain('2 báo giá, đơn');
  });

  it('C2.2: chưa có bảng mặc định thì nút "Thêm bảng giá" khoá, có lời nhắc đồng bộ', async () => {
    stub([MANUAL]);
    render(<PriceListsPage />);
    await within(listTable()).findByText('BG-CU');
    const add = screen.getByRole('button', { name: /Thêm bảng giá/ }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(screen.getByRole('note').textContent).toBe(NO_DEFAULT_LIST_HINT);
  });

  it('có bảng mặc định thì nút "Thêm bảng giá" bấm được', async () => {
    render(<PriceListsPage />);
    await within(listTable()).findByText('BG-MAC-DINH');
    expect((screen.getByRole('button', { name: /Thêm bảng giá/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('C2.3: nhân viên không có nút thêm, sửa, xoá', async () => {
    mockCapabilities = STAFF;
    render(<PriceListsPage />);
    await within(listTable()).findByText('BG-105');
    expect(screen.queryByRole('button', { name: /Thêm bảng giá/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Sửa/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Xoá/ })).toBeNull();
    await openList('BG-105');
    expect(within(itemsTable()).queryByRole('button', { name: /Nhập giá tay|Bỏ giá tay|Sửa thuế suất/ })).toBeNull();
  });

  it('C2.4, C2.5, C2.6, C2.7: bảng mặc định chỉ sửa thuế suất; giá rỗng "Chưa nhập giá ở Kho", giá 0 là "0 đ"; nhãn "Ngừng dùng ở Kho"', async () => {
    render(<PriceListsPage />);
    await within(listTable()).findByText('BG-MAC-DINH');
    // Không sửa, xoá bảng mặc định.
    expect(within(listRow('BG-MAC-DINH')).queryByRole('button')).toBeNull();
    await openList('BG-MAC-DINH');
    const table = itemsTable();
    expect(within(table).queryByRole('button', { name: /Dán từ bảng tính|Thêm dòng giá|Nhập giá tay/ })).toBeNull();
    expect(within(table).queryByRole('button', { name: /^Xoá|^Sửa$/ })).toBeNull();
    expect(within(table).getAllByRole('button', { name: /^Sửa thuế suất/ })).toHaveLength(DEFAULT_ITEMS.length);
    expect(itemRow('M4').textContent).toContain('Chưa nhập giá ở Kho');
    expect(itemRow('M5').textContent).toContain('0 đ');
    expect(itemRow('M5').textContent).not.toContain('Chưa nhập giá ở Kho');
    expect(itemRow('M1').textContent).toContain('12.345 đ');
    expect(itemRow('M6').textContent).toContain('Ngừng dùng ở Kho');
    expect(itemRow('M1').textContent).not.toContain('Ngừng dùng ở Kho');
  });

  it('C2.8: sửa thuế suất "8,5" gửi 8.5; "abc" hoặc 101 báo lỗi tại ô, không gửi', async () => {
    mockApi.setPriceListVatRate.mockResolvedValue(detail(DEFAULT, [item('1', { vatRate: 8.5 }), ...DEFAULT_ITEMS.slice(1)]));
    render(<PriceListsPage />);
    await within(listTable()).findByText('BG-MAC-DINH');
    await openList('BG-MAC-DINH');
    fireEvent.click(within(itemRow('M1')).getByRole('button', { name: 'Sửa thuế suất M1' }));
    const dialog = screen.getByRole('dialog', { name: 'Sửa thuế suất' });
    const input = within(dialog).getByLabelText(/Thuế suất \(%\)/) as HTMLInputElement;
    for (const bad of ['abc', '101']) {
      fireEvent.change(input, { target: { value: bad } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(input.closest('label')?.textContent).toMatch(/Thuế suất (phải là số|phải từ 0 đến 100)/);
    }
    expect(mockApi.setPriceListVatRate).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '8,5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(mockApi.setPriceListVatRate).toHaveBeenCalledWith('md', '1', 8.5));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(itemRow('M1').textContent).toContain('8,5%');
  });

  it('C2.9: bảng theo tỷ lệ có cột "Cách tính"; không thêm, xoá dòng, dán nhiều dòng', async () => {
    render(<PriceListsPage />);
    await openList('BG-105');
    const table = itemsTable();
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toContain('Cách tính');
    expect(itemRow('M1').textContent).toContain('Theo tỷ lệ');
    expect(itemRow('M2').textContent).toContain('Giá tay');
    expect(within(table).queryByRole('button', { name: /Dán từ bảng tính|Thêm dòng giá|Sửa thuế suất/ })).toBeNull();
    expect(within(table).queryByRole('button', { name: /^Xoá/ })).toBeNull();
  });

  it('C2.10: "Nhập giá tay" mở hộp nhập giá; lưu xong dòng thành "Giá tay"', async () => {
    mockApi.setManualPrice.mockResolvedValue(detail(DERIVED, [item('1', { price: 15_000, priceMode: 'MANUAL' }), DERIVED_ITEMS[1]]));
    render(<PriceListsPage />);
    await openList('BG-105');
    fireEvent.click(within(itemRow('M1')).getByRole('button', { name: 'Nhập giá tay M1' }));
    const dialog = screen.getByRole('dialog', { name: 'Nhập giá tay' });
    const input = within(dialog).getByLabelText(/Đơn giá \(VND\)/);
    fireEvent.change(input, { target: { value: '-1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    expect(input.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(input, { target: { value: '15.000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(mockApi.setManualPrice).toHaveBeenCalledWith('105', '1', 15_000));
    await waitFor(() => expect(itemRow('M1').textContent).toContain('Giá tay'));
    expect(itemRow('M1').textContent).toContain('15.000 đ');
  });

  it('C2.11: "Bỏ giá tay" chỉ ở dòng giá tay; xong dòng về "Theo tỷ lệ" với giá mới', async () => {
    mockApi.clearManualPrice.mockResolvedValue(detail(DERIVED, [DERIVED_ITEMS[0], item('2', { price: 10_501, priceMode: 'RATIO' })]));
    render(<PriceListsPage />);
    await openList('BG-105');
    expect(within(itemRow('M1')).queryByRole('button', { name: /Bỏ giá tay/ })).toBeNull();
    expect(within(itemRow('M2')).getByRole('button', { name: 'Bỏ giá tay M2' })).toBeTruthy();
    fireEvent.click(within(itemRow('M2')).getByRole('button', { name: 'Xác nhận Bỏ giá tay' }));
    await waitFor(() => expect(mockApi.clearManualPrice).toHaveBeenCalledWith('105', '2'));
    await waitFor(() => expect(itemRow('M2').textContent).toContain('Theo tỷ lệ'));
    expect(itemRow('M2').textContent).toContain('10.501 đ');
  });

  it('C2.12: bảng tự nhập cũ giữ thao tác như trước (dán, thêm, sửa, xoá dòng)', async () => {
    render(<PriceListsPage />);
    await openList('BG-CU');
    const table = itemsTable();
    expect(within(table).getByRole('button', { name: /Dán từ bảng tính/ })).toBeTruthy();
    expect(within(table).getByRole('button', { name: /Thêm dòng giá/ })).toBeTruthy();
    expect(within(itemRow('M9')).getByRole('button', { name: 'Sửa' })).toBeTruthy();
    expect(within(itemRow('M9')).getByRole('button', { name: 'Xoá' })).toBeTruthy();
    expect(within(listRow('BG-CU')).getByRole('button', { name: 'Sửa bảng giá BG-CU' })).toBeTruthy();
  });

  it('C2.13: xoá bảng đang được dùng hiện lời 409 "Ngừng áp dụng" của server', async () => {
    const message = 'Bảng giá đang được báo giá hoặc đơn bán dùng, không xoá được. Hãy chuyển sang "Ngừng áp dụng".';
    mockApi.deletePriceList.mockRejectedValue({ statusCode: 409, code: 'PRICE_LIST_IN_USE', message });
    render(<PriceListsPage />);
    await within(listTable()).findByText('BG-105');
    fireEvent.click(within(listRow('BG-105')).getByRole('button', { name: 'Xác nhận Xoá' }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith(message));
    expect(mockApi.deletePriceList).toHaveBeenCalledWith('105');
  });

  it('C1.8: đồng bộ xong (sự kiện) thì trang tải lại danh sách và dòng giá đang mở', async () => {
    render(<PriceListsPage />);
    await openList('BG-MAC-DINH');
    expect(mockApi.listPriceLists).toHaveBeenCalledTimes(1);
    expect(mockApi.getPriceList).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new Event(PRICE_LISTS_CHANGED_EVENT));
    });
    await waitFor(() => expect(mockApi.listPriceLists).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockApi.getPriceList).toHaveBeenCalledTimes(2));
  });
});
