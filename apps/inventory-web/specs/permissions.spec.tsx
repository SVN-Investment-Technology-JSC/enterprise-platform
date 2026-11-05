import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Page from '../src/app/page';

describe('Inventory capability-driven controls', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    window.history.replaceState(null, '', '/');
  });

  it.each([
    [false, false], [false, true], [true, true],
  ])('management=%s and transactions=%s control separate buttons', async (canManage, canWriteTransactions) => {
    window.history.replaceState(null, '', '/#stock');
    global.fetch = jest.fn(async (url) => {
      const path = String(url);
      const body = path.endsWith('/capabilities') ? { canManage, canWriteTransactions }
        : path.includes('/procedure/') ? { instances: [], definitions: [] }
        : path.endsWith('/settings') ? {
          'dashboard.cards': { value: { cardIds: [] }, version: 0 },
          'catalog.asset': { value: { types: [], statuses: [], usageStates: [] }, version: 0 },
          'catalog.unit': { value: { units: [] }, version: 0 },
        }
        : [];
      return { ok: true, status: 200, json: async () => body } as Response;
    });
    render(<Page />);
    // Trang Kho hàng: tab Hàng hóa (quyền quản lý danh mục) rồi tab Nhà kho (quyền ghi giao dịch).
    const warehouseTab = await screen.findByRole('button', { name: 'Nhà kho' });
    expect(Boolean(screen.queryByRole('button', { name: /Tạo mới/ }))).toBe(canManage);
    fireEvent.click(warehouseTab);
    expect(Boolean(screen.queryByRole('button', { name: /Nhập kho/ }))).toBe(canWriteTransactions);
    expect(Boolean(screen.queryByRole('button', { name: /Xuất kho/ }))).toBe(canWriteTransactions);
  });
});
