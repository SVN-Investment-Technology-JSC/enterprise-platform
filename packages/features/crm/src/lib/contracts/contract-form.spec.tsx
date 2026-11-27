/**
 * @jest-environment jsdom
 */
import {
  CRM_NO_CAPABILITIES,
  type ContractDetail,
  type ContractQuotePreview,
  type CrmPage,
  type CustomerSummary,
  type QuoteSummary,
} from '@enterprise-platform/contracts-crm';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CrmDataProvider } from '../crm-context';
import * as api from '../crm-api';
import { ContractFormDialog } from './contracts-page';

jest.mock('../crm-api', () => ({
  createContract: jest.fn(),
  updateContract: jest.fn(),
  listContracts: jest.fn(),
  listCustomers: jest.fn(),
  listQuotes: jest.fn(),
  getContractQuotePreview: jest.fn(),
  loadWarehouses: jest.fn().mockResolvedValue([]),
  errorMessage: (cause: { message?: string }, fallback: string) => cause?.message || fallback,
  listGroups: jest.fn().mockResolvedValue([]),
  listKinds: jest.fn().mockResolvedValue([]),
  listPeople: jest.fn().mockResolvedValue([]),
}));
jest.mock('@enterprise-platform/shared-ui', () => ({
  ...jest.requireActual('@enterprise-platform/shared-ui'),
  toast: { success: jest.fn(), error: jest.fn() },
}));

const mocked = api as jest.Mocked<typeof api>;
const CUSTOMER = 'c-1';
const QUOTE = 'q-1';

const page = <T,>(items: T[]): CrmPage<T> => ({ items, nextCursor: null }) as CrmPage<T>;
const customer = { id: CUSTOMER, code: 'KH001', name: 'Công ty Gắn Báo Giá' } as CustomerSummary;
const quote = {
  id: QUOTE,
  code: 'BG2600010',
  customerId: CUSTOMER,
  customerCode: 'KH001',
  customerName: 'Công ty Gắn Báo Giá',
  quoteName: 'Báo giá cáp đồng',
  status: 'ACCEPTED',
  totalAmount: 11_550_000,
} as QuoteSummary;
const preview: ContractQuotePreview = {
  quoteId: QUOTE,
  quoteCode: 'BG2600010',
  quoteName: 'Báo giá cáp đồng',
  customerId: CUSTOMER,
  customerCode: 'KH001',
  customerName: 'Công ty Gắn Báo Giá',
  ownerUserId: 'u-1',
  versionNo: 2,
  totalAmount: 11_550_000,
  lines: [
    {
      id: 'l-1',
      lineNo: 1,
      materialId: 'm-1',
      materialCode: 'QA-KHO-CAP',
      materialName: 'Cáp đồng',
      unit: 'Cái',
      materialKind: 'STOCK',
      quantity: 10,
      unitPrice: 1_000_000,
      vatRate: 10,
      discountPercent: 0,
      lineAmount: 10_000_000,
      note: null,
    },
    {
      id: 'l-2',
      lineNo: 2,
      materialId: 'm-2',
      materialCode: 'QA-KHO-BT',
      materialName: 'Gói bảo trì',
      unit: 'Gói',
      materialKind: 'SERVICE',
      quantity: 1,
      unitPrice: 500_000,
      vatRate: 10,
      discountPercent: 0,
      lineAmount: 500_000,
      note: null,
    },
  ],
};

function renderForm(draft: { validFrom: string; customerId?: string; title?: string }) {
  const onSaved = jest.fn();
  render(
    <CrmDataProvider capabilities={{ ...CRM_NO_CAPABILITIES, canWriteContract: true }}>
      <ContractFormDialog draft={{ type: 'SALE', customerId: '', title: '', ...draft }} onClose={jest.fn()} onSaved={onSaved} />
    </CrmDataProvider>,
  );
  return { onSaved };
}

const quoteInput = () => screen.getByPlaceholderText('Không gắn báo giá');

describe('Lập hợp đồng gắn báo giá', () => {
  // antd Table cần ResizeObserver, matchMedia và getComputedStyle một tham số; jsdom thiếu.
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn();
    globalThis.ResizeObserver = class {
      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = jest.fn();
    } as unknown as typeof ResizeObserver;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
    })) as unknown as typeof window.matchMedia;
    const original = window.getComputedStyle.bind(window);
    window.getComputedStyle = ((element: Element) => original(element)) as typeof window.getComputedStyle;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mocked.listCustomers.mockResolvedValue(page([]));
    mocked.listQuotes.mockResolvedValue(page([quote]));
    mocked.getContractQuotePreview.mockResolvedValue(preview);
    mocked.createContract.mockResolvedValue({ id: 'k-1', code: 'HD2600001' } as ContractDetail);
  });

  it('chọn báo giá: điền khách, tên, hiện dòng sẽ gắn; lưu gửi quoteId và để trống giá trị', async () => {
    const { onSaved } = renderForm({ validFrom: '2026-11-27' });
    // Chỉ tìm báo giá gắn được; chưa chọn khách thì không lọc theo khách.
    await waitFor(() => expect(mocked.listQuotes).toHaveBeenCalledWith(expect.objectContaining({ contractLinkable: true, customerId: undefined })));

    fireEvent.click(quoteInput());
    fireEvent.click(await screen.findByRole('option', { name: /Báo giá cáp đồng/ }));

    await waitFor(() => expect(mocked.getContractQuotePreview).toHaveBeenCalledWith(QUOTE));
    const table = await screen.findByRole('region', { name: 'Dòng hàng từ báo giá' });
    expect(within(table).getByText('QA-KHO-CAP')).toBeTruthy();
    expect(within(table).getByText('QA-KHO-BT')).toBeTruthy();
    expect(within(table).getByText(/phiên bản 2/)).toBeTruthy();
    // Khách lấy theo báo giá (kể cả khi chưa có trong danh sách khách đã tải), tên hợp đồng đặt theo mã báo giá.
    await waitFor(() => expect((screen.getByPlaceholderText('Chọn khách hàng') as HTMLInputElement).value).toBe('Công ty Gắn Báo Giá'));
    expect((screen.getByLabelText(/Tên hợp đồng/) as HTMLInputElement).value).toBe('Hợp đồng theo báo giá BG2600010');
    expect(screen.getByText(/Bỏ trống: lấy tổng báo giá/)).toBeTruthy();
    // Đã chọn khách: danh sách báo giá lọc theo khách đó.
    await waitFor(() => expect(mocked.listQuotes).toHaveBeenLastCalledWith(expect.objectContaining({ contractLinkable: true, customerId: CUSTOMER })));

    fireEvent.click(screen.getByRole('button', { name: 'Lập hợp đồng' }));
    await waitFor(() =>
      expect(mocked.createContract).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: CUSTOMER, quoteId: QUOTE, value: null, title: 'Hợp đồng theo báo giá BG2600010', validFrom: '2026-11-27' }),
      ),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('bỏ chọn báo giá thì bỏ gắn: không còn bảng dòng, lưu không gửi quoteId', async () => {
    mocked.listCustomers.mockResolvedValue(page([customer]));
    renderForm({ validFrom: '2026-11-27', customerId: CUSTOMER, title: 'HĐ tay' });
    await waitFor(() => expect(mocked.listQuotes).toHaveBeenCalledWith(expect.objectContaining({ contractLinkable: true, customerId: CUSTOMER })));
    fireEvent.click(quoteInput());
    fireEvent.click(await screen.findByRole('option', { name: /Báo giá cáp đồng/ }));
    await screen.findByRole('region', { name: 'Dòng hàng từ báo giá' });
    // Tên đã nhập thì giữ.
    expect((screen.getByLabelText(/Tên hợp đồng/) as HTMLInputElement).value).toBe('HĐ tay');

    fireEvent.click(within(quoteInput().closest('label') as HTMLElement).getByRole('button', { name: 'Xoá tìm kiếm' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Dòng hàng từ báo giá' })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Lập hợp đồng' }));
    await waitFor(() => expect(mocked.createContract).toHaveBeenCalledWith(expect.objectContaining({ customerId: CUSTOMER, quoteId: null })));
  });

  it('báo giá không gắn được nữa (máy chủ báo 409): hiện lỗi, bỏ chọn', async () => {
    mocked.getContractQuotePreview.mockRejectedValue(new Error('Báo giá BG2600010 đã chuyển hoặc gắn vào một hợp đồng khác.'));
    renderForm({ validFrom: '2026-11-27' });
    fireEvent.click(quoteInput());
    fireEvent.click(await screen.findByRole('option', { name: /Báo giá cáp đồng/ }));
    expect(await screen.findByText('Báo giá BG2600010 đã chuyển hoặc gắn vào một hợp đồng khác.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Dòng hàng từ báo giá' })).toBeNull();
    await waitFor(() => expect((quoteInput() as HTMLInputElement).value).toBe(''));
  });
});
