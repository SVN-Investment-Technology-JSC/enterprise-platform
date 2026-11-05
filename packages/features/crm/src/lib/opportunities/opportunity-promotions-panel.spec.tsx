/**
 * @jest-environment jsdom
 */
import type { OpportunityPromotion, PromotionCatalogItem } from '@enterprise-platform/contracts-crm';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OpportunityPromotionsPanel } from './opportunity-promotions-panel';

jest.mock('../sales.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));
jest.mock('../components/crm-ui', () => ({ Field: ({ label, children }: { label: string; children: unknown }) => <div data-label={label}>{children as never}</div> }));
jest.mock('@enterprise-platform/shared-ui', () => ({
  Popconfirm: ({ children, onConfirm }: { children: unknown; onConfirm: () => void }) => <span onClick={() => onConfirm()}>{children as never}</span>,
  SearchableSelect: ({ options, onChange }: { options: { value: string; label: string }[]; onChange: (v: string) => void }) => (
    <div>{options.map((o) => <button key={o.value} type="button" onClick={() => onChange(o.value)}>{`chọn ${o.label}`}</button>)}</div>
  ),
  toast: { success: jest.fn(), error: jest.fn() },
}));
const mockApi = {
  listOpportunityPromotions: jest.fn(),
  listPromotionCatalog: jest.fn(),
  addOpportunityPromotion: jest.fn(),
  removeOpportunityPromotion: jest.fn(),
};
jest.mock('../crm-api', () => ({
  errorMessage: (cause: { message?: string }, fallback: string) => cause?.message ?? fallback,
  listOpportunityPromotions: (...a: unknown[]) => mockApi.listOpportunityPromotions(...a),
  listPromotionCatalog: (...a: unknown[]) => mockApi.listPromotionCatalog(...a),
  addOpportunityPromotion: (...a: unknown[]) => mockApi.addOpportunityPromotion(...a),
  removeOpportunityPromotion: (...a: unknown[]) => mockApi.removeOpportunityPromotion(...a),
}));

const cat = (id: string, patch: Partial<PromotionCatalogItem> = {}): PromotionCatalogItem => ({
  id, kind: 'PROGRAM', code: id.toUpperCase(), name: `KM ${id}`, description: null, discountType: 'PERCENT', value: 5,
  validFrom: null, validTo: null, active: true, effective: true, createdAt: '', updatedAt: '', ...patch,
});
const link = (id: string, catalog: PromotionCatalogItem): OpportunityPromotion => ({ id, opportunityId: 'o1', catalog, note: 'ghi chú 1', createdAt: '', createdBy: null });

describe('OpportunityPromotionsPanel', () => {
  beforeEach(() => jest.clearAllMocks());

  it('không có quyền ghi: chỉ xem, ẩn nút thêm và bỏ, không tải danh mục', async () => {
    mockApi.listOpportunityPromotions.mockResolvedValue([link('l1', cat('a'))]);
    render(<OpportunityPromotionsPanel opportunityId="o1" canEdit={false} />);
    expect(await screen.findByText('KM a')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Thêm khuyến mãi' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bỏ khuyến mãi' })).toBeNull();
    expect(mockApi.listPromotionCatalog).not.toHaveBeenCalled();
  });

  it('ô chọn chỉ liệt kê mục còn hiệu lực và chưa chọn; thêm kèm ghi chú', async () => {
    mockApi.listOpportunityPromotions.mockResolvedValue([link('l1', cat('a'))]);
    mockApi.listPromotionCatalog.mockResolvedValue([cat('a'), cat('b'), cat('c', { effective: false })]);
    mockApi.addOpportunityPromotion.mockResolvedValue([link('l1', cat('a')), link('l2', cat('b'))]);
    render(<OpportunityPromotionsPanel opportunityId="o1" canEdit />);
    await screen.findByText('KM a');
    expect(await screen.findByRole('button', { name: 'chọn KM b' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'chọn KM a' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'chọn KM c' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'chọn KM b' }));
    fireEvent.change(screen.getByLabelText('Ghi chú khuyến mãi'), { target: { value: 'Áp dụng quý 3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm khuyến mãi' }));
    await waitFor(() => expect(mockApi.addOpportunityPromotion).toHaveBeenCalledWith('o1', { catalogId: 'b', note: 'Áp dụng quý 3' }));
    expect(await screen.findByText('KM b')).toBeTruthy();
  });

  it('bỏ khuyến mãi gọi DELETE theo id lựa chọn', async () => {
    mockApi.listOpportunityPromotions.mockResolvedValue([link('l1', cat('a'))]);
    mockApi.listPromotionCatalog.mockResolvedValue([]);
    mockApi.removeOpportunityPromotion.mockResolvedValue([]);
    render(<OpportunityPromotionsPanel opportunityId="o1" canEdit />);
    fireEvent.click(await screen.findByRole('button', { name: 'Bỏ khuyến mãi' }));
    await waitFor(() => expect(mockApi.removeOpportunityPromotion).toHaveBeenCalledWith('o1', 'l1'));
    expect(await screen.findByText('Dự án chưa có khuyến mãi nào.')).toBeTruthy();
  });
});
