/**
 * @jest-environment jsdom
 */
import {
  CRM_NO_CAPABILITIES,
  type CrmCapabilities,
  type PriceListSummary,
  type SalesOrderDetail,
  type SalesOrderLine,
} from '@enterprise-platform/contracts-crm';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { OrderDetail } from './order-detail';
import { CreateOrderDialog } from './orders-page';

jest.mock('../sales.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));
jest.mock('antd', () => ({ Table: () => null }));

const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock('@enterprise-platform/shared-ui', () => ({
  SearchableSelect: ({
    options,
    value,
    disabled,
    onChange,
  }: {
    options: { value: string; label: string }[];
    value: string;
    disabled?: boolean;
    onChange: (value: string) => void;
  }) => (
    <div data-select-value={value} data-disabled={disabled ? 'true' : undefined}>
      {options.map((option) => (
        <span key={option.value} role="option" aria-selected={option.value === value} onClick={() => onChange(option.value)}>
          {`chọn ${option.label}`}
        </span>
      ))}
    </div>
  ),
  Popconfirm: ({ children }: { children: ReactNode }) => <>{children}</>,
  formatDateTime: (value: string) => value,
  toast: { success: (...args: unknown[]) => mockToast.success(...args), error: (...args: unknown[]) => mockToast.error(...args) },
}));
jest.mock('@enterprise-platform/shared-ui/date-picker', () => ({
  DatePickerInput: ({ value, onChange, 'aria-label': label }: { value?: string; onChange: (v: string) => void; 'aria-label'?: string }) => (
    <input aria-label={label} value={value ?? ''} onChange={(event) => onChange(event.target.value)} />
  ),
}));
jest.mock('../components/warehouse-select', () => ({ WarehouseSelect: () => null }));
// Hộp chọn mặt hàng thay bằng nút trả về sẵn một mặt hàng kèm thuế suất sửa tay.
jest.mock('../components/material-picker', () => ({
  MaterialPickerDialog: ({ onPick }: { onPick: (picked: unknown) => Promise<void> }) => (
    <div role="dialog" aria-label="Thêm dòng đơn">
      <button
        type="button"
        onClick={() => void onPick({ material: { id: 'm9', code: 'VT-09' }, quantity: 2, unitPrice: null, vatRate: null, overrideVatRate: 8.5 })}
      >
        Chọn VT-09
      </button>
    </div>
  ),
}));
jest.mock('../documents', () => ({ DocumentsPanel: () => null }));
jest.mock('../receivables/order-receivable-panel', () => ({ OrderReceivablePanel: () => null }));
jest.mock('./order-info-note', () => ({ OrderInfoNote: () => null }));

const mockApi = {
  getOrder: jest.fn(),
  updateOrder: jest.fn(),
  createOrder: jest.fn(),
  listPriceLists: jest.fn(),
  listCustomers: jest.fn(),
  listContracts: jest.fn(),
  loadMaterialStock: jest.fn(),
};
jest.mock('../crm-api', () => ({
  errorMessage: (cause: { message?: string } | undefined, fallback: string) => cause?.message || fallback,
  ...Object.fromEntries(
    ['getOrder', 'updateOrder', 'createOrder', 'listPriceLists', 'listCustomers', 'listContracts', 'loadMaterialStock'].map((name) => [
      name,
      (...args: unknown[]) => mockApi[name as keyof typeof mockApi](...args),
    ]),
  ),
}));

const mockWriter: CrmCapabilities = { ...CRM_NO_CAPABILITIES, canWriteOrder: true };
jest.mock('../crm-context', () => ({
  ...jest.requireActual('../crm-context'),
  useCrm: () => ({ capabilities: mockWriter, people: [] }),
}));

const priceList = (id: string, name: string, code: string): PriceListSummary => ({
  id,
  code,
  name,
  listType: 'DERIVED',
  ratioPercent: 100,
  isStandard: false,
  currency: 'VND',
  validFrom: '2026-01-01',
  validTo: null,
  status: 'ACTIVE',
  note: null,
  itemCount: 1,
  usageCount: 0,
  updatedAt: '2026-01-01T00:00:00Z',
});
const LISTS = [priceList('pl-md', 'Bảng giá mặc định', 'BG-MAC-DINH'), priceList('pl-105', 'Bảng giá 105', 'BG-105')];

const order = (patch: Partial<SalesOrderDetail> = {}): SalesOrderDetail =>
  ({
    id: 'o1',
    code: 'DH2600001',
    source: 'DIRECT',
    customerId: 'c1',
    customerCode: 'KH001',
    customerName: 'Công ty A',
    contractId: null,
    contractCode: null,
    quoteId: null,
    quoteCode: null,
    status: 'DRAFT',
    orderDate: '2026-11-01',
    expectedDeliveryDate: null,
    totalAmount: 0,
    ownerUserId: 'u1',
    late: false,
    updatedAt: '2026-11-01T00:00:00Z',
    warehouseCode: null,
    deliveryAddress: null,
    note: null,
    infoNote: null,
    infoNotedBy: null,
    infoNotedAt: null,
    priceDate: '2026-11-01',
    priceListId: null,
    priceListCode: null,
    priceListName: null,
    priceListStatus: null,
    shipping: { amount: 0, vatRate: 0 },
    totals: { netAmount: 0, shippingAmount: 0, vatAmount: 0, totalAmount: 0 },
    revision: 2,
    lines: [],
    deliveries: [],
    reservationExpiresAt: null,
    cancelReason: null,
    closeReason: null,
    history: [],
    createdAt: '2026-11-01T00:00:00Z',
    ...patch,
  }) as SalesOrderDetail;

const priceField = () => screen.getByText('Bảng giá', { selector: 'span' }).closest('label') as HTMLElement;
const addLine = () => screen.getByRole('button', { name: /Thêm dòng/ }) as HTMLButtonElement;

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.listPriceLists.mockResolvedValue(LISTS);
  mockApi.listCustomers.mockResolvedValue({ items: [{ id: 'c1', code: 'KH001', name: 'Công ty A' }] });
  mockApi.listContracts.mockResolvedValue({ items: [] });
  mockApi.loadMaterialStock.mockResolvedValue([]);
});

describe('Bảng giá ở đơn bán (C5.1, C5.2)', () => {
  it('C5.1: lập đơn trực tiếp: ô "Bảng giá" bắt buộc; chưa chọn thì báo tại ô, không gửi; chọn rồi gửi priceListId', async () => {
    mockApi.createOrder.mockResolvedValue({ id: 'o1', code: 'DH2600001' });
    const onCreated = jest.fn();
    render(<CreateOrderDialog onClose={jest.fn()} onCreated={onCreated} />);
    const dialog = screen.getByRole('dialog', { name: 'Lập đơn bán' });
    fireEvent.click(await within(dialog).findByText('chọn Công ty A'));
    expect(priceField().textContent).toContain('*');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lập đơn' }));
    expect(priceField().textContent).toContain('Vui lòng chọn bảng giá.');
    expect(mockApi.createOrder).not.toHaveBeenCalled();
    fireEvent.click(await within(priceField()).findByText('chọn Bảng giá 105'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lập đơn' }));
    await waitFor(() => expect(mockApi.createOrder).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'c1', priceListId: 'pl-105' })));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('o1'));
  });

  it('C5.1: đơn Nháp chưa có bảng giá: "Thêm dòng" khoá kèm nhắc; chọn bảng giá thì lưu và mở khoá', async () => {
    mockApi.getOrder.mockResolvedValue(order());
    mockApi.updateOrder.mockResolvedValue(order({ revision: 3, priceListId: 'pl-105', priceListCode: 'BG-105', priceListName: 'Bảng giá 105', priceListStatus: 'ACTIVE' }));
    render(<OrderDetail orderId="o1" onBack={jest.fn()} onOpenCustomer={jest.fn()} onOpenContract={jest.fn()} onOpenQuote={jest.fn()} />);
    await screen.findByText('Dòng hàng');
    expect(addLine().disabled).toBe(true);
    expect(priceField().textContent).toContain('Chọn bảng giá trước');
    fireEvent.click(await within(priceField()).findByText('chọn Bảng giá 105'));
    await waitFor(() => expect(mockApi.updateOrder).toHaveBeenCalledWith('o1', { revision: 2, priceListId: 'pl-105' }));
    await waitFor(() => expect(addLine().disabled).toBe(false));
  });

  it('C5.1: đơn từ hợp đồng có dòng: đổi bảng giá thì hỏi lại; Huỷ không gửi', async () => {
    mockApi.getOrder.mockResolvedValue(
      order({ source: 'CONTRACT', contractId: 'ct1', contractCode: 'HĐ-01', priceListId: 'pl-105', priceListCode: 'BG-105', priceListName: 'Bảng giá 105', priceListStatus: 'ACTIVE', lines: [{ id: 'l1', materialId: 'm1' } as SalesOrderLine] }),
    );
    render(<OrderDetail orderId="o1" onBack={jest.fn()} onOpenCustomer={jest.fn()} onOpenContract={jest.fn()} onOpenQuote={jest.fn()} />);
    await screen.findByText('Dòng hàng');
    expect(addLine().disabled).toBe(false);
    fireEvent.click(await within(priceField()).findByText('chọn Bảng giá mặc định'));
    const confirm = screen.getByRole('dialog', { name: 'Đổi bảng giá?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Huỷ' }));
    expect(mockApi.updateOrder).not.toHaveBeenCalled();
    expect(priceField().querySelector('[data-select-value]')?.getAttribute('data-select-value')).toBe('pl-105');
  });

  it('thêm dòng đơn gửi overrideVatRate của dòng mới; dòng cũ giữ overrideVatRate đang có', async () => {
    const existing = {
      id: 'l1',
      materialId: 'm1',
      quantity: 1,
      unit: 'Cái',
      overrideUnitPrice: null,
      overrideDiscountPercent: null,
      overrideVatRate: 5,
      warehouseCode: null,
    } as SalesOrderLine;
    const draft = order({ priceListId: 'pl-105', priceListCode: 'BG-105', priceListName: 'Bảng giá 105', priceListStatus: 'ACTIVE', lines: [existing] });
    mockApi.getOrder.mockResolvedValue(draft);
    mockApi.updateOrder.mockResolvedValue({ ...draft, revision: 3 });
    render(<OrderDetail orderId="o1" onBack={jest.fn()} onOpenCustomer={jest.fn()} onOpenContract={jest.fn()} onOpenQuote={jest.fn()} />);
    await screen.findByText('Dòng hàng');
    fireEvent.click(addLine());
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Thêm dòng đơn' })).getByRole('button', { name: 'Chọn VT-09' }));
    await waitFor(() =>
      expect(mockApi.updateOrder).toHaveBeenCalledWith('o1', {
        revision: 2,
        lines: [
          { materialId: 'm1', quantity: 1, unit: 'Cái', overrideUnitPrice: null, overrideDiscountPercent: null, overrideVatRate: 5, warehouseCode: null },
          { materialId: 'm9', quantity: 2, overrideUnitPrice: null, overrideVatRate: 8.5 },
        ],
      }),
    );
  });

  it('C5.2: đơn từ báo giá hiện bảng giá dạng chữ, không có ô chọn', async () => {
    mockApi.getOrder.mockResolvedValue(
      order({ source: 'QUOTE', quoteId: 'q1', quoteCode: 'BG2600001', priceListId: 'pl-105', priceListCode: 'BG-105', priceListName: 'Bảng giá 105', priceListStatus: 'INACTIVE' }),
    );
    render(<OrderDetail orderId="o1" onBack={jest.fn()} onOpenCustomer={jest.fn()} onOpenContract={jest.fn()} onOpenQuote={jest.fn()} />);
    await screen.findByText('Dòng hàng');
    expect(screen.getByText('Bảng giá', { selector: 'dt' }).nextElementSibling?.textContent).toContain('Bảng giá 105 (Ngừng áp dụng)');
    expect(screen.queryByText('chọn Bảng giá 105')).toBeNull();
    expect(screen.queryByRole('button', { name: /Thêm dòng/ })).toBeNull();
  });
});
