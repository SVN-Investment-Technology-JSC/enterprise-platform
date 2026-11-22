/**
 * @jest-environment jsdom
 */
import type { PriceListSyncResult, PriceListSyncStatus } from '@enterprise-platform/contracts-crm';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PRICE_LISTS_CHANGED_EVENT, PriceListSyncBanner } from './price-list-sync-banner';

jest.mock('../sales.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));
jest.mock('./pricing.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));

const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock('@enterprise-platform/shared-ui', () => ({
  toast: { success: (...args: unknown[]) => mockToast.success(...args), error: (...args: unknown[]) => mockToast.error(...args) },
}));

const mockApi = { loadCatalogSyncStatus: jest.fn(), syncCatalog: jest.fn() };
jest.mock('../crm-api', () => ({
  errorMessage: (cause: { message?: string } | undefined, fallback: string) => cause?.message || fallback,
  loadCatalogSyncStatus: (...args: unknown[]) => mockApi.loadCatalogSyncStatus(...args),
  syncCatalog: (...args: unknown[]) => mockApi.syncCatalog(...args),
}));

const status = (patch: Partial<PriceListSyncStatus> = {}): PriceListSyncStatus => ({
  needsSync: true,
  reason: 'CATALOG_CHANGED',
  defaultPriceListId: 'pl-md',
  lastSyncedAt: '2026-11-01T00:00:00Z',
  ...patch,
});

const RESULT: PriceListSyncResult = {
  defaultPriceListId: 'pl-md',
  added: 7,
  updated: 2,
  removed: 1,
  skippedWithoutUnit: 1,
  derivedListsUpdated: 0,
  manualPricesRemoved: 0,
  syncedAt: '2026-11-18T00:00:00Z',
};

/** Lời hứa điều khiển được để giữ trạng thái "đang chạy". */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const syncButton = () => screen.getByRole('button', { name: /Đồng bộ|Đang đồng bộ/ }) as HTMLButtonElement;

beforeEach(() => jest.clearAllMocks());

describe('Thông báo đồng bộ bảng giá (C1)', () => {
  it('C1.1: quản trị, chưa có bảng mặc định: hiện thông báo và nút "Đồng bộ"', async () => {
    mockApi.loadCatalogSyncStatus.mockResolvedValue(status({ reason: 'NO_DEFAULT', defaultPriceListId: null }));
    render(<PriceListSyncBanner canManage />);
    expect(await screen.findByText('Chưa có bảng giá mặc định')).toBeTruthy();
    expect(syncButton().textContent).toContain('Đồng bộ');
  });

  it('C1.2: danh mục Kho đã đổi: "Bảng giá mặc định cần được đồng bộ với Kho"', async () => {
    mockApi.loadCatalogSyncStatus.mockResolvedValue(status());
    render(<PriceListSyncBanner canManage />);
    expect(await screen.findByText('Bảng giá mặc định cần được đồng bộ với Kho')).toBeTruthy();
  });

  it('C1.3: không cần đồng bộ thì không hiện', async () => {
    mockApi.loadCatalogSyncStatus.mockResolvedValue(status({ needsSync: false, reason: null }));
    const { container } = render(<PriceListSyncBanner canManage />);
    await waitFor(() => expect(mockApi.loadCatalogSyncStatus).toHaveBeenCalled());
    await act(async () => undefined);
    expect(container.textContent).toBe('');
  });

  it('C1.4: nhân viên không gọi API trạng thái, không hiện', () => {
    const { container } = render(<PriceListSyncBanner canManage={false} />);
    expect(mockApi.loadCatalogSyncStatus).not.toHaveBeenCalled();
    expect(container.textContent).toBe('');
  });

  it('C1.5: đang tải trạng thái thì không hiện gì (không nhấp nháy)', async () => {
    const pending = deferred<PriceListSyncStatus>();
    mockApi.loadCatalogSyncStatus.mockReturnValue(pending.promise);
    const { container } = render(<PriceListSyncBanner canManage />);
    expect(container.textContent).toBe('');
    await act(async () => pending.resolve(status({ needsSync: false, reason: null })));
    expect(container.textContent).toBe('');
  });

  it('C1.6: API trạng thái lỗi thì không hiện, không vỡ trang', async () => {
    mockApi.loadCatalogSyncStatus.mockRejectedValue({ statusCode: 500, message: 'Lỗi máy chủ' });
    const { container } = render(<PriceListSyncBanner canManage />);
    await waitFor(() => expect(mockApi.loadCatalogSyncStatus).toHaveBeenCalled());
    await act(async () => undefined);
    expect(container.textContent).toBe('');
  });

  it('C1.7: nhấn "Đồng bộ": nút khoá, chuyển "Đang đồng bộ…"; nhấn liên tiếp chỉ gửi một yêu cầu', async () => {
    mockApi.loadCatalogSyncStatus.mockResolvedValue(status());
    const pending = deferred<PriceListSyncResult>();
    mockApi.syncCatalog.mockReturnValue(pending.promise);
    render(<PriceListSyncBanner canManage />);
    await screen.findByText('Bảng giá mặc định cần được đồng bộ với Kho');
    const button = syncButton();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mockApi.syncCatalog).toHaveBeenCalledTimes(1);
    expect(syncButton().disabled).toBe(true);
    expect(syncButton().textContent).toContain('Đang đồng bộ');
    await act(async () => pending.resolve(RESULT));
  });

  it('C1.8: đồng bộ xong báo số dòng thêm, sửa, xoá, số bị bỏ qua; ẩn thông báo; báo trang bảng giá tải lại', async () => {
    mockApi.loadCatalogSyncStatus.mockResolvedValue(status({ reason: 'NO_DEFAULT' }));
    mockApi.syncCatalog.mockResolvedValue(RESULT);
    const changed = jest.fn();
    window.addEventListener(PRICE_LISTS_CHANGED_EVENT, changed);
    const { container } = render(<PriceListSyncBanner canManage />);
    await screen.findByText('Chưa có bảng giá mặc định');
    fireEvent.click(syncButton());
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
    const message = mockToast.success.mock.calls[0][0] as string;
    expect(message).toContain('thêm 7');
    expect(message).toContain('cập nhật 2');
    expect(message).toContain('bỏ 1 dòng');
    expect(message).toContain('Bỏ qua 1 mặt hàng chưa có đơn vị tính');
    expect(container.textContent).toBe('');
    expect(changed).toHaveBeenCalledTimes(1);
    window.removeEventListener(PRICE_LISTS_CHANGED_EVENT, changed);
  });

  it('C1.9: đồng bộ lỗi thì hiện lỗi tiếng Việt, thông báo còn, bấm lại được', async () => {
    mockApi.loadCatalogSyncStatus.mockResolvedValue(status());
    mockApi.syncCatalog.mockRejectedValueOnce({ statusCode: 502, message: 'Không đọc được danh mục Kho. Vui lòng thử lại sau.' }).mockResolvedValueOnce(RESULT);
    render(<PriceListSyncBanner canManage />);
    await screen.findByText('Bảng giá mặc định cần được đồng bộ với Kho');
    fireEvent.click(syncButton());
    expect((await screen.findByRole('alert')).textContent).toBe('Không đọc được danh mục Kho. Vui lòng thử lại sau.');
    expect(screen.getByText('Bảng giá mặc định cần được đồng bộ với Kho')).toBeTruthy();
    expect(syncButton().disabled).toBe(false);
    fireEvent.click(syncButton());
    await waitFor(() => expect(mockApi.syncCatalog).toHaveBeenCalledTimes(2));
  });
});
