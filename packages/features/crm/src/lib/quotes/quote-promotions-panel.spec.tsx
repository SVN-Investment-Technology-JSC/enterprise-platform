/**
 * @jest-environment jsdom
 */
import type { OpportunityPromotion, PromotionCatalogItem, QuotePromotionSnapshot } from '@enterprise-platform/contracts-crm';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QuotePromotionsPanel } from './quote-promotions-panel';

jest.mock('../sales.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));
jest.mock('@enterprise-platform/shared-ui', () => ({
  SearchableSelect: ({ options, onChange }: { options: { value: string; label: string }[]; onChange: (v: string) => void }) => (
    <div>{options.map((o) => <button key={o.value} type="button" onClick={() => onChange(o.value)}>{`chọn ${o.label}`}</button>)}</div>
  ),
  toast: { success: jest.fn(), error: jest.fn() },
}));
const mockProject = jest.fn();
const mockSave = jest.fn();
jest.mock('../crm-api', () => ({
  errorMessage: (cause: { message?: string }, fallback: string) => cause?.message ?? fallback,
  listOpportunityPromotions: (...a: unknown[]) => mockProject(...a),
  saveQuotePromotions: (...a: unknown[]) => mockSave(...a),
}));

const cat = (id: string, patch: Partial<PromotionCatalogItem> = {}): PromotionCatalogItem => ({
  id, kind: 'PROGRAM', code: id.toUpperCase(), name: `KM ${id}`, description: null, discountType: 'PERCENT', value: 5,
  validFrom: null, validTo: null, active: true, effective: true, createdAt: '', updatedAt: '', ...patch,
});
const link = (catalog: PromotionCatalogItem): OpportunityPromotion => ({ id: `l-${catalog.id}`, opportunityId: 'o1', catalog, note: null, createdAt: '', createdBy: null });
const snap = (id: string): QuotePromotionSnapshot => ({ catalogId: id, kind: 'PROGRAM', code: id.toUpperCase(), name: `KM ${id}`, discountType: 'PERCENT', value: 5 });

function renderPanel(patch: Partial<Parameters<typeof QuotePromotionsPanel>[0]> = {}) {
  const onSaved = jest.fn();
  render(<QuotePromotionsPanel quoteId="q1" opportunityId="o1" versionNo={2} revision={7} applied={[]} editable onSaved={onSaved} {...patch} />);
  return onSaved;
}

describe('QuotePromotionsPanel', () => {
  beforeEach(() => jest.clearAllMocks());

  it('luôn ghi chú khuyến mãi không tự trừ vào tổng', () => {
    mockProject.mockResolvedValue([]);
    renderPanel();
    expect(screen.getByText('Khuyến mãi chỉ là thông tin kèm theo, không tự trừ vào tổng báo giá.')).toBeTruthy();
  });

  it('báo giá chưa có dự án: hướng dẫn gắn dự án, không gọi API', () => {
    renderPanel({ opportunityId: null });
    expect(screen.getByText(/chưa thuộc dự án nào/)).toBeTruthy();
    expect(mockProject).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Lưu khuyến mãi' })).toBeNull();
  });

  it('chọn nhiều, lưu một lần với revision hiện tại rồi báo màn cha tải lại', async () => {
    mockProject.mockResolvedValue([link(cat('a')), link(cat('b')), link(cat('c', { effective: false }))]);
    mockSave.mockResolvedValue({ versionNo: 2, revision: 8, promotions: [] });
    const onSaved = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'chọn KM a' }));
    expect(screen.queryByRole('button', { name: 'chọn KM c' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'chọn KM b' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu khuyến mãi' }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('q1', 2, { catalogIds: ['a', 'b'], revision: 7 }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('hiện lỗi tiếng Việt của server và không tải lại', async () => {
    mockProject.mockResolvedValue([link(cat('a'))]);
    mockSave.mockRejectedValue({ message: 'Phiên bản đã thay đổi, hãy tải lại.' });
    const onSaved = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'chọn KM a' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu khuyến mãi' }));
    expect(await screen.findByText('Phiên bản đã thay đổi, hãy tải lại.')).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('khoá khi không sửa được: chỉ hiện ảnh chụp đã áp, không có nút lưu', () => {
    renderPanel({ editable: false, applied: [snap('a')] });
    expect(screen.getByText('A - KM a (5%)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Lưu khuyến mãi' })).toBeNull();
    expect(mockProject).not.toHaveBeenCalled();
  });
});
