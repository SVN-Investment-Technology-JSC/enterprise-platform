import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
    await waitFor(() => expect(screen.getAllByRole('table').length).toBeGreaterThan(0));
    expect(Boolean(screen.queryByRole('button', { name: /Thêm vật tư/ }))).toBe(canManage);
    expect(Boolean(screen.queryByRole('button', { name: /Xuất\/nhập kho/ }))).toBe(canWriteTransactions);
  });
});
