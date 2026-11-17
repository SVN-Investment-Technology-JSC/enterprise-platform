/**
 * @jest-environment jsdom
 */
import { defaultQuoteLayout, type QuoteLayout } from '@enterprise-platform/contracts-crm';
import { act, renderHook, waitFor } from '@testing-library/react';
import { TEMPLATE_LAYOUT_LOAD_ERROR, clearTemplateLayoutCache, useTemplateLayout } from './use-template-layout';

const mockGetLayout = jest.fn();
jest.mock('../crm-api', () => ({ getQuoteTemplateLayout: (...args: unknown[]) => mockGetLayout(...args) }));

const titled = (text: string): QuoteLayout => {
  const base = defaultQuoteLayout();
  return { ...base, blocks: base.blocks.map((block) => (block.type === 'title' ? { ...block, text } : block)) };
};
const titleOf = (layout: QuoteLayout) => layout.blocks.find((block) => block.type === 'title')?.text;

describe('useTemplateLayout (P3C4-01)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearTemplateLayoutCache();
  });

  it('chưa chọn mẫu: bố cục mặc định, không gọi API', () => {
    const { result } = renderHook(() => useTemplateLayout(''));
    expect(result.current.status).toBe('ready');
    expect(result.current.custom).toBe(false);
    expect(titleOf(result.current.layout)).toBe('BÁO GIÁ');
    expect(mockGetLayout).not.toHaveBeenCalled();
  });

  it('TC-QW-06: danh sách mẫu báo chưa có bố cục thì dùng mặc định, không gọi API', () => {
    const { result } = renderHook(() => useTemplateLayout('t1', false));
    expect(result.current.status).toBe('ready');
    expect(result.current.layout).toEqual(defaultQuoteLayout());
    expect(mockGetLayout).not.toHaveBeenCalled();
  });

  it('TC-QW-06: API trả layout rỗng thì dùng bố cục mặc định, không báo lỗi', async () => {
    mockGetLayout.mockResolvedValue({ layout: null, updatedAt: null, updatedBy: null });
    const { result } = renderHook(() => useTemplateLayout('t1'));
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.custom).toBe(false);
    expect(result.current.error).toBeUndefined();
    expect(result.current.layout).toEqual(defaultQuoteLayout());
  });

  it('tải bố cục theo mẫu; cache trong phiên: mở lại cùng mẫu không gọi lại API, đổi mẫu thì đổi ngay', async () => {
    mockGetLayout.mockImplementation((id: string) => Promise.resolve({ layout: titled(`Mẫu ${id}`), updatedAt: null, updatedBy: null }));
    const { result, rerender } = renderHook(({ id }) => useTemplateLayout(id), { initialProps: { id: 't1' } });
    await waitFor(() => expect(titleOf(result.current.layout)).toBe('Mẫu t1'));
    expect(result.current.custom).toBe(true);

    rerender({ id: 't2' });
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(titleOf(result.current.layout)).toBe('Mẫu t2'));

    rerender({ id: 't1' });
    expect(result.current.status).toBe('ready');
    expect(titleOf(result.current.layout)).toBe('Mẫu t1');
    expect(mockGetLayout).toHaveBeenCalledTimes(2);

    const second = renderHook(() => useTemplateLayout('t1'));
    expect(titleOf(second.result.current.layout)).toBe('Mẫu t1');
    expect(mockGetLayout).toHaveBeenCalledTimes(2);
  });

  it('hai màn cùng mở một mẫu khi đang tải: chỉ gọi API một lần', async () => {
    mockGetLayout.mockResolvedValue({ layout: titled('Chung'), updatedAt: null, updatedBy: null });
    const first = renderHook(() => useTemplateLayout('t1'));
    const second = renderHook(() => useTemplateLayout('t1'));
    await waitFor(() => expect(titleOf(second.result.current.layout)).toBe('Chung'));
    expect(titleOf(first.result.current.layout)).toBe('Chung');
    expect(mockGetLayout).toHaveBeenCalledTimes(1);
  });

  it('TC-QW-07: lỗi tải thì báo lỗi nhưng vẫn trả bố cục mặc định; Thử lại thì tải lại', async () => {
    mockGetLayout.mockRejectedValueOnce({ status: 500, message: 'Lỗi máy chủ' });
    const { result } = renderHook(() => useTemplateLayout('t1'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe(TEMPLATE_LAYOUT_LOAD_ERROR);
    expect(result.current.layout).toEqual(defaultQuoteLayout());

    mockGetLayout.mockResolvedValueOnce({ layout: titled('Đã sửa'), updatedAt: null, updatedBy: null });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(titleOf(result.current.layout)).toBe('Đã sửa');
    expect(mockGetLayout).toHaveBeenCalledTimes(2);
  });
});
