/**
 * @jest-environment jsdom
 */
import type { PriceListDetail, PriceListSummary } from '@enterprise-platform/contracts-crm';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QuotePreviewPanel } from './quote-preview-panel';

jest.mock('../sales.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));
jest.mock('./pricing.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));
jest.mock('antd', () => ({ Table: () => null }));
jest.mock('@enterprise-platform/shared-ui', () => ({
  SearchableSelect: ({
    options,
    value,
    disabled,
    placeholder,
    onChange,
  }: {
    options: { value: string; label: string }[];
    value: string;
    disabled?: boolean;
    placeholder?: string;
    onChange: (value: string) => void;
  }) => (
    <div data-select-value={value} data-disabled={disabled ? 'true' : 'false'} data-placeholder={placeholder}>
      {options.map((option) => (
        <span key={option.value} role="option" aria-selected={option.value === value} onClick={() => !disabled && onChange(option.value)}>
          {`chọn ${option.label}`}
        </span>
      ))}
    </div>
  ),
}));
jest.mock('@enterprise-platform/shared-ui/date-picker', () => ({
  DatePickerInput: ({ value, onChange, 'aria-label': label }: { value?: string; onChange: (v: string) => void; 'aria-label'?: string }) => (
    <input aria-label={label} value={value ?? ''} onChange={(event) => onChange(event.target.value)} />
  ),
}));

const mockApi = { listCustomers: jest.fn(), listPriceLists: jest.fn(), getPriceList: jest.fn(), previewQuote: jest.fn() };
jest.mock('../crm-api', () => ({
  errorMessage: (cause: { message?: string } | undefined, fallback: string) => cause?.message || fallback,
  ...Object.fromEntries(
    ['listCustomers', 'listPriceLists', 'getPriceList', 'previewQuote'].map((name) => [
      name,
      (...args: unknown[]) => mockApi[name as keyof typeof mockApi](...args),
    ]),
  ),
}));
jest.mock('../crm-context', () => ({
  groupOptions: () => [],
  useCrm: () => ({ groups: [] }),
}));

const LIST: PriceListSummary = {
  id: 'pl-105',
  code: 'BG-105',
  name: 'Bảng giá 105',
  listType: 'DERIVED',
  ratioPercent: 105,
  isStandard: false,
  currency: 'VND',
  validFrom: '2026-01-01',
  validTo: null,
  status: 'ACTIVE',
  note: null,
  itemCount: 1,
  usageCount: 0,
  updatedAt: '2026-01-01T00:00:00Z',
};
const DETAIL: PriceListDetail = {
  ...LIST,
  items: [{ id: 'i1', materialId: 'm1', materialCode: 'M1', materialName: 'Máy bơm', unit: 'Cái', price: 12_962, vatRate: 8, priceMode: 'RATIO', sourceActive: true }],
};

const priceSelect = () =>
  (screen.getByText('Bảng giá', { selector: 'span' }).closest('label') as HTMLElement).querySelector('[data-select-value]') as HTMLElement;
const runButton = () => screen.getByRole('button', { name: /Tính giá/ }) as HTMLButtonElement;

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.listCustomers.mockResolvedValue({ items: [{ id: 'c1', code: 'KH001', name: 'Công ty A' }] });
  mockApi.listPriceLists.mockResolvedValue([LIST]);
  mockApi.getPriceList.mockResolvedValue(DETAIL);
  mockApi.previewQuote.mockResolvedValue({
    date: '2026-11-18',
    customerId: 'c1',
    customerGroupId: null,
    discountCapPercent: 10,
    lines: [],
    shipping: null,
    totals: { grossAmount: 0, discountAmount: 0, netAmount: 0, shippingAmount: 0, vatAmount: 0, totalAmount: 0 },
  });
});

describe('Thử tính giá (C5.3, C5.4)', () => {
  it('C5.4: chưa chọn bảng giá thì nút "Tính giá" khoá, ô mặt hàng khoá', async () => {
    render(<QuotePreviewPanel />);
    await screen.findByText('chọn Bảng giá 105');
    expect(runButton().disabled).toBe(true);
    expect(screen.getByText('Bảng giá', { selector: 'span' }).closest('label')?.textContent).toContain('Chọn bảng giá trước');
    expect(mockApi.getPriceList).not.toHaveBeenCalled();
  });

  it('C5.3: chọn khách không khoá, không ghi đè bảng giá; tính giá gửi đúng bảng đã chọn', async () => {
    render(<QuotePreviewPanel />);
    fireEvent.click(await screen.findByText('chọn Bảng giá 105'));
    fireEvent.click(await screen.findByText('chọn Công ty A'));
    expect(priceSelect().getAttribute('data-disabled')).toBe('false');
    expect(priceSelect().getAttribute('data-select-value')).toBe('pl-105');
    expect(runButton().disabled).toBe(false);
    await waitFor(() => expect(mockApi.getPriceList).toHaveBeenCalledWith('pl-105'));
    fireEvent.click(await screen.findByText('chọn Máy bơm'));
    fireEvent.click(runButton());
    await waitFor(() =>
      expect(mockApi.previewQuote).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'c1', priceListId: 'pl-105', lines: [expect.objectContaining({ materialId: 'm1', unit: 'Cái' })] }),
      ),
    );
  });

  it('không có bảng giá nào thì nhắc liên hệ quản trị CRM', async () => {
    mockApi.listPriceLists.mockResolvedValue([]);
    render(<QuotePreviewPanel />);
    await waitFor(() =>
      expect(within(screen.getByText('Bảng giá', { selector: 'span' }).closest('label') as HTMLElement).getAllByText(/Chưa có bảng giá. Liên hệ quản trị CRM./).length).toBeGreaterThan(0),
    );
  });
});
