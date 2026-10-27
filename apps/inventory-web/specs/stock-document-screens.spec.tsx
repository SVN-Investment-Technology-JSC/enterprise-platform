import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Page from '../src/app/page';

// Màn duyệt chứng từ (T1-29) và bốn loại tồn (T1-30) trên trang Kho thật, fetch giả lập.
const PENDING = {
  id: 'doc-1',
  code: 'PK-0001',
  docType: 'ISSUE_OTHER',
  status: 'PENDING',
  warehouseId: 'w1',
  warehouseCode: 'QA-KHO-HN',
  documentDate: '2026-10-27',
  createdBy: 'u-tk',
  createdAt: '2026-10-27T01:00:00Z',
  updatedAt: '2026-10-27T01:00:00Z',
  note: 'Xuất mẫu kiểm tra',
  lines: [
    {
      id: 'l1',
      lineNo: 1,
      materialId: 'm1',
      materialCode: 'QA-KHO-MUC',
      materialName: 'QA Mực in',
      quantity: 2,
      direction: 'OUT',
      unitCost: 0,
    },
  ],
};

function mockFetch(capabilities: Record<string, boolean>, overrides: Record<string, () => Response> = {}) {
  const calls: string[] = [];
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    for (const [key, respond] of Object.entries(overrides)) if (path.includes(key)) return respond();
    const body = path.endsWith('/capabilities')
      ? capabilities
      : path.includes('/stock-documents')
        ? { items: [PENDING], total: 1, limit: 100, offset: 0 }
        : path.endsWith('/warehouses')
          ? [{ id: 'w1', code: 'QA-KHO-HN', name: 'Kho chính', type: 'PHYSICAL', isActive: true }]
          : path.includes('/warehouses/QA-KHO-HN/stock')
            ? [
                {
                  id: 's1',
                  warehouseId: 'w1',
                  materialId: 'm1',
                  quantity: 100,
                  quantityReserved: 10,
                  quantityBlocked: 15,
                  available: 75,
                  createdBy: 'u',
                  createdAt: '',
                },
              ]
            : path.includes('/materials')
              ? [
                  {
                    id: 'm1',
                    code: 'QA-KHO-MUC',
                    name: 'QA Mực in',
                    category: 'CONSUMABLE',
                    unit: 'Hộp',
                    minStock: 0,
                    maxStock: 0,
                    isSerialized: false,
                    isActive: true,
                    kind: 'STOCK',
                  },
                ]
              : path.includes('/procedure/')
                ? { instances: [], definitions: [] }
                : path.endsWith('/settings')
                  ? {
                      'dashboard.cards': { value: { cardIds: [] }, version: 0 },
                      'catalog.asset': { value: { types: [], statuses: [], usageStates: [] }, version: 0 },
                      'catalog.unit': { value: { units: [] }, version: 0 },
                    }
                  : [];
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as typeof fetch;
  return calls;
}

describe('Duyệt chứng từ kho và bốn loại tồn', () => {
  const originalFetch = global.fetch;
  beforeAll(() => {
    // Bảng antd đọc breakpoint qua matchMedia; jsdom không có.
    window.matchMedia ??= ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    // Bảng antd đo kích thước cột bằng ResizeObserver; jsdom cũng không có.
    globalThis.ResizeObserver ??= class {
      observe() {
        return undefined;
      }
      unobserve() {
        return undefined;
      }
      disconnect() {
        return undefined;
      }
    } as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    window.history.replaceState(null, '', '/');
  });

  it.each([
    [true, true],
    [false, false],
  ])('canApproveDocuments=%s thì nút Duyệt, Từ chối hiện=%s', async (canApproveDocuments, visible) => {
    window.history.replaceState(null, '', '/#approvals');
    const calls = mockFetch({ canManage: false, canWriteTransactions: false, canApproveDocuments });
    render(<Page />);
    await waitFor(() => expect(screen.getAllByText('PK-0001').length).toBeGreaterThan(0));
    expect(calls.some((call) => call.includes('/stock-documents?status=PENDING'))).toBe(true);
    expect(Boolean(screen.queryByRole('button', { name: 'Duyệt' }))).toBe(visible);
    expect(Boolean(screen.queryByRole('button', { name: 'Từ chối' }))).toBe(visible);
    if (!visible) expect(screen.getByText(/duyệt hoặc từ chối cần quyền/)).toBeTruthy();
  });

  it('lỗi server khi duyệt hiện nguyên văn', async () => {
    window.history.replaceState(null, '', '/#approvals');
    mockFetch(
      { canManage: false, canWriteTransactions: false, canApproveDocuments: true },
      {
        '/approve': () =>
          ({
            ok: false,
            status: 403,
            json: async () => ({ message: 'Không được tự duyệt chứng từ do mình lập.' }),
          }) as Response,
      },
    );
    render(<Page />);
    const approve = await screen.findByRole('button', { name: 'Duyệt' });
    fireEvent.click(approve);
    expect(await screen.findByText('Không được tự duyệt chứng từ do mình lập.')).toBeTruthy();
  });

  it('màn tồn có cột thực tế, đã giữ, chờ kiểm định/không đạt, khả dụng và không có cột đang vận chuyển', async () => {
    window.history.replaceState(null, '', '/#stock');
    mockFetch({ canManage: false, canWriteTransactions: false });
    render(<Page />);
    await waitFor(() => expect(screen.getByText('Chờ kiểm định/không đạt')).toBeTruthy());
    expect(screen.getByText('Thực tế').getAttribute('title')).toMatch(/Tồn thực tế/);
    expect(screen.getByText('Đã giữ')).toBeTruthy();
    expect(screen.getByText('Khả dụng').getAttribute('title')).toMatch(/thực tế − đã giữ − chờ kiểm định/);
    expect(screen.queryByText(/đang vận chuyển/i)).toBeNull();
  });
});
