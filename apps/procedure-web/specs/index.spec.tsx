import React from 'react';
import { render, screen, within } from '@testing-library/react';
import Page from '../src/app/page';

describe('Page', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should render the tenant workspace', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
          tenantId: 'tenant-test',
          actor: { id: 'user-test', name: 'Test Admin' },
          permissions: {
            canManageDefinitions: true,
            canPublishDefinitions: true,
            canCreateInstances: true,
            canOverrideActions: false,
          },
          definitions: [],
          instances: [],
      }),
    } as Response);

    const { baseElement } = render(<Page />);

    expect(baseElement).toBeTruthy();
    // Trang Tổng quan đã bỏ: module mở thẳng vào Hồ sơ xử lý, tab "Đang xử lý" (việc tới lượt người xem).
    const tabs = await screen.findByRole('tablist', { name: 'Lọc theo trạng thái' });
    expect(within(tabs).getByRole('tab', { selected: true }).textContent).toMatch(/^Đang xử lý/);
  });
});
