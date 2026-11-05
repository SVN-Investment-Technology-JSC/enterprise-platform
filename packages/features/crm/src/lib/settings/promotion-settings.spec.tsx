/**
 * @jest-environment jsdom
 */
import type { PromotionCatalogItem } from '@enterprise-platform/contracts-crm';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PromotionSettings } from './promotion-settings';

jest.mock('../sales.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));
jest.mock('../components/crm-ui', () => ({
  CrmDialog: ({ title, error, onSubmit, children }: { title: string; error?: string; onSubmit: () => void; children: unknown }) => (
    <div role="dialog" aria-label={title}>
      {children as never}
      {error ? <p>{error}</p> : null}
      <button type="button" onClick={onSubmit}>Lưu</button>
    </div>
  ),
  Field: ({ label, children }: { label: string; children: unknown }) => <div data-label={label}>{children as never}</div>,
}));
jest.mock('@enterprise-platform/shared-ui', () => ({
  SearchableSelect: () => null,
  toast: { success: jest.fn(), error: jest.fn() },
}));
const mockList = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
jest.mock('../crm-api', () => ({
  errorMessage: (cause: { message?: string }, fallback: string) => cause?.message ?? fallback,
  listPromotionCatalog: (...args: unknown[]) => mockList(...args),
  createPromotionCatalog: (...args: unknown[]) => mockCreate(...args),
  updatePromotionCatalog: (...args: unknown[]) => mockUpdate(...args),
}));
// antd Table cần matchMedia và ResizeObserver; jsdom thiếu.
beforeAll(() => {
  globalThis.ResizeObserver = class { observe = jest.fn(); unobserve = jest.fn(); disconnect = jest.fn(); } as never;
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener: jest.fn(), removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn() })) as never;
});

const row = (patch: Partial<PromotionCatalogItem> = {}): PromotionCatalogItem => ({
  id: 'p1', kind: 'PROGRAM', code: 'KM1', name: 'Tặng quà', description: null, discountType: 'PERCENT', value: 5,
  validFrom: null, validTo: null, active: true, effective: true, createdAt: '', updatedAt: '', ...patch,
});

describe('PromotionSettings', () => {
  beforeEach(() => jest.clearAllMocks());

  it('tải cả mục đã tắt và hiện cờ hiệu lực', async () => {
    mockList.mockResolvedValue([row(), row({ id: 'p2', code: 'KM2', name: 'Cũ', active: false, effective: false })]);
    render(<PromotionSettings />);
    expect(await screen.findByText('Tặng quà')).toBeTruthy();
    expect(mockList).toHaveBeenCalledWith({ includeInactive: true });
    expect(screen.getByText('Còn hiệu lực')).toBeTruthy();
    expect(screen.getByText('Đã tắt')).toBeTruthy();
  });

  it('nút Tắt gọi cập nhật active=false', async () => {
    mockList.mockResolvedValue([row()]);
    mockUpdate.mockResolvedValue(row({ active: false }));
    render(<PromotionSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tắt' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('p1', { active: false }));
  });

  it('thêm mới: báo lỗi tiếng Việt khi thiếu mã, không gọi API', async () => {
    mockList.mockResolvedValue([]);
    render(<PromotionSettings />);
    fireEvent.click(await screen.findByRole('button', { name: /Thêm khuyến mãi/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Vui lòng nhập mã.')).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('thêm mới hợp lệ gọi POST với mã in hoa', async () => {
    mockList.mockResolvedValue([]);
    mockCreate.mockResolvedValue(row());
    render(<PromotionSettings />);
    fireEvent.click(await screen.findByRole('button', { name: /Thêm khuyến mãi/ }));
    fireEvent.change(screen.getByLabelText('Mã'), { target: { value: 'km9' } });
    fireEvent.change(screen.getByLabelText('Tên'), { target: { value: 'Giảm hè' } });
    fireEvent.change(screen.getByLabelText('Giá trị'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ code: 'KM9', name: 'Giảm hè', value: 10, kind: 'PROGRAM', discountType: 'PERCENT' })));
  });
});
