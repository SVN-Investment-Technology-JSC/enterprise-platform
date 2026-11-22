import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import Page from '../src/app/page';
import {
  movementHashTarget,
  movementMaterialLabel,
  movementTypeLabel,
  movementWarehouseLabel,
  sourceTypeLabel,
} from '@enterprise-platform/feature-inventory';

// Tab "Xuất/nhập kho" trên trang Kho thật, fetch giả lập: danh sách gộp do server
// trả, link cũ chuyển hướng, ẩn hiện nút theo quyền.
const DOCUMENT_ROW = {
  kind: 'document',
  id: 'doc-1',
  code: 'PK-0001',
  type: 'ISSUE_OTHER',
  status: 'PENDING',
  warehouseCode: 'QA-KHO-HN',
  occurredAt: '2026-10-27T01:00:00Z',
  movementDate: '2026-10-27',
  sourceType: 'stocktake',
  lineCount: 2,
  quantityTotal: 5,
  materialCode: 'QA-KHO-MUC',
  materialName: 'QA Mực in',
  createdBy: 'u-tk',
};

const LEGACY_ROW = {
  kind: 'legacy',
  id: 'tx-1',
  code: 'OLD-0001',
  type: 'IMPORT',
  status: 'POSTED',
  warehouseCode: 'QA-KHO-HN',
  occurredAt: '2020-01-10T03:00:00Z',
  movementDate: '2020-01-10',
  sourceType: 'manual',
  lineCount: 1,
  quantityTotal: 25,
  materialCode: 'QA-KHO-MUC',
  materialName: 'QA Mực in',
  createdBy: 'u-cu',
  note: 'Nhập tồn đầu kỳ',
};

const DOCUMENT = {
  id: 'doc-1',
  code: 'PK-0001',
  docType: 'ISSUE_OTHER',
  status: 'PENDING',
  warehouseId: 'w1',
  warehouseCode: 'QA-KHO-HN',
  sourceType: 'stocktake',
  documentDate: '2026-10-27',
  createdBy: 'u-tk',
  createdAt: '2026-10-27T01:00:00Z',
  updatedAt: '2026-10-27T01:00:00Z',
  lines: [
    {
      id: 'l1',
      lineNo: 1,
      materialId: 'm1',
      materialCode: 'QA-KHO-MUC',
      materialName: 'QA Mực in',
      quantity: 5,
      direction: 'OUT',
      unitCost: 0,
    },
  ],
};

function mockFetch(capabilities: Record<string, boolean>, movementsFail = false) {
  const calls: string[] = [];
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (path.includes('/stock-movements') && movementsFail) {
      return { ok: false, status: 500, json: async () => ({ message: 'Máy chủ đang bận.' }) } as Response;
    }
    const body = path.endsWith('/capabilities')
      ? capabilities
      : path.includes('/stock-movements')
        ? { rows: [DOCUMENT_ROW, LEGACY_ROW], total: 2, limit: 20, offset: 0, pendingCount: 3 }
        : /\/stock-documents\/[^/?]+$/.test(path)
          ? DOCUMENT
          : path.includes('/stock-documents')
            ? { items: [DOCUMENT], total: 1, limit: 100, offset: 0 }
            : path.endsWith('/warehouses')
              ? [{ id: 'w1', code: 'QA-KHO-HN', name: 'Kho chính', type: 'PHYSICAL', isActive: true }]
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

describe('stock-movement.model', () => {
  it('phân giải hash mới và hash của ba màn cũ', () => {
    expect(movementHashTarget('#stock/movements')).toEqual({ view: 'all', documentKey: undefined });
    expect(movementHashTarget('#stock/movements/PK-0001')).toEqual({ view: 'all', documentKey: 'PK-0001' });
    expect(movementHashTarget('#documents')).toEqual({ view: 'all', documentKey: undefined });
    expect(movementHashTarget('#vouchers/doc%2D1')).toEqual({ view: 'all', documentKey: 'doc-1' });
    expect(movementHashTarget('#approvals')).toEqual({ view: 'pending' });
    expect(movementHashTarget('#issue-requests')).toEqual({ view: 'requests' });
  });

  it('hash không thuộc tab thì không chuyển hướng', () => {
    expect(movementHashTarget('')).toBeUndefined();
    expect(movementHashTarget('#stock')).toBeUndefined();
    expect(movementHashTarget('#stock/VT-1')).toBeUndefined();
    expect(movementHashTarget('#assets/A-1')).toBeUndefined();
  });

  it('nhãn nguồn phát sinh: trống là Thủ công, mã lạ hiện nguyên văn', () => {
    expect(sourceTypeLabel(undefined)).toBe('Thủ công');
    expect(sourceTypeLabel('manual')).toBe('Thủ công');
    expect(sourceTypeLabel('crm_sales_order')).toBe('Đơn bán');
    expect(sourceTypeLabel('STOCKTAKE')).toBe('Kiểm kê');
    expect(sourceTypeLabel('asset')).toBe('Thiết bị vận hành');
    expect(sourceTypeLabel('procedure')).toBe('Quy trình');
    expect(sourceTypeLabel('nguon_moi')).toBe('nguon_moi');
  });

  it('nhãn loại, kho và mặt hàng của một dòng', () => {
    expect(movementTypeLabel({ kind: 'document', type: 'TRANSFER' })).toBe('Điều chuyển kho');
    expect(movementTypeLabel({ kind: 'legacy', type: 'IMPORT' })).toBe('Nhập kho');
    expect(movementTypeLabel({ kind: 'legacy', type: 'LOAI_LA' })).toBe('LOAI_LA');
    expect(movementWarehouseLabel({ warehouseCode: 'A', targetWarehouseCode: 'B' })).toBe('A → B');
    expect(movementWarehouseLabel({ warehouseCode: 'A' })).toBe('A');
    expect(movementMaterialLabel({ materialCode: 'VT-1', materialName: 'Dây', lineCount: 3 })).toBe(
      'VT-1 - Dây và 2 dòng khác',
    );
    expect(movementMaterialLabel({ lineCount: 0 })).toBe('—');
  });
});

describe('Tab Xuất/nhập kho', () => {
  const originalFetch = global.fetch;
  beforeAll(() => {
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

  it('thanh bên không còn ba mục chứng từ; Kho hàng có tab con Xuất/nhập kho', async () => {
    window.history.replaceState(null, '', '/#stock');
    mockFetch({ canManage: false, canWriteTransactions: false });
    render(<Page />);
    expect(await screen.findByRole('button', { name: 'Xuất/nhập kho' })).toBeTruthy();
    expect(screen.queryByText('Chứng từ kho')).toBeNull();
    expect(screen.queryByText('Duyệt chứng từ')).toBeNull();
    expect(screen.queryByText('Yêu cầu xuất từ đơn bán')).toBeNull();
  });

  it('link cũ #documents mở danh sách gộp: gọi một endpoint, có nguồn phát sinh và bút toán cũ', async () => {
    window.history.replaceState(null, '', '/#documents');
    const calls = mockFetch({ canManage: false, canWriteTransactions: false });
    render(<Page />);
    await waitFor(() => expect(screen.getAllByText('PK-0001').length).toBeGreaterThan(0));
    expect(calls.some((call) => call.includes('/stock-movements?'))).toBe(true);
    // Giao diện không tự ghép danh sách chứng từ với sổ giao dịch.
    expect(calls.some((call) => /\/stock-documents\?/.test(call))).toBe(false);
    expect(screen.getByRole('columnheader', { name: 'Nguồn phát sinh' })).toBeTruthy();
    expect(screen.getAllByText('Kiểm kê').length).toBeGreaterThan(0);
    expect(screen.getByText('Bút toán cũ')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Chờ duyệt (3)' })).toBeTruthy();
  });

  it('nút Lập chứng từ chỉ hiện khi có quyền ghi phát sinh', async () => {
    window.history.replaceState(null, '', '/#documents');
    mockFetch({ canManage: false, canWriteTransactions: false });
    render(<Page />);
    await waitFor(() => expect(screen.getAllByText('PK-0001').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: /Lập chứng từ/ })).toBeNull();
    cleanup();

    window.history.replaceState(null, '', '/#documents');
    mockFetch({ canManage: false, canWriteTransactions: true });
    render(<Page />);
    expect(await screen.findByRole('button', { name: /Lập chứng từ/ })).toBeTruthy();
  });

  it('bút toán cũ mở ra chỉ đọc, không có nút thao tác', async () => {
    window.history.replaceState(null, '', '/#documents');
    mockFetch({ canManage: true, canWriteTransactions: true, canApproveDocuments: true });
    render(<Page />);
    fireEvent.click(await screen.findByText('OLD-0001'));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText(/không có chứng từ kèm theo/)).toBeTruthy();
    expect(within(drawer).getByText('Ghi chú: Nhập tồn đầu kỳ')).toBeTruthy();
    for (const name of ['Duyệt', 'Từ chối', 'Ghi sổ', 'Huỷ', 'Sửa']) {
      expect(within(drawer).queryByRole('button', { name })).toBeNull();
    }
  });

  it('link #vouchers/<id> mở thẳng chi tiết chứng từ; nút duyệt theo quyền', async () => {
    window.history.replaceState(null, '', '/#vouchers/doc-1');
    const calls = mockFetch({ canManage: false, canWriteTransactions: false, canApproveDocuments: true });
    render(<Page />);
    const drawer = await screen.findByRole('dialog');
    await waitFor(() => expect(within(drawer).getByText(/Chứng từ PK-0001/)).toBeTruthy());
    expect(calls.some((call) => call.endsWith('/stock-documents/doc-1'))).toBe(true);
    expect(within(drawer).getByRole('button', { name: 'Duyệt' })).toBeTruthy();
    cleanup();

    window.history.replaceState(null, '', '/#vouchers/doc-1');
    mockFetch({ canManage: false, canWriteTransactions: false, canApproveDocuments: false });
    render(<Page />);
    const readOnly = await screen.findByRole('dialog');
    await waitFor(() => expect(within(readOnly).getByText(/Chứng từ PK-0001/)).toBeTruthy());
    expect(within(readOnly).queryByRole('button', { name: 'Duyệt' })).toBeNull();
  });

  it('endpoint lỗi thì báo lỗi kèm nút Thử lại, không quay về gọi API cũ', async () => {
    window.history.replaceState(null, '', '/#documents');
    const calls = mockFetch({ canManage: false, canWriteTransactions: false }, true);
    render(<Page />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Máy chủ đang bận.');
    expect(within(alert).getByRole('button', { name: 'Thử lại' })).toBeTruthy();
    expect(calls.some((call) => /\/stock-documents\?/.test(call))).toBe(false);
  });
});
