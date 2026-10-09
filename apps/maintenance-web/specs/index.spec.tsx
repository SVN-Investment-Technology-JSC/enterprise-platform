import React from 'react';
import { render, screen } from '@testing-library/react';
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
          canManageAssets: true,
          canManageJobPlans: true,
          canManageSchedules: true,
        },
        assets: [],
        jobPlans: [],
        schedules: [],
        occurrences: [],
        procedureCatalog: [],
        metrics: {
          activeSchedules: 0,
          upcomingOccurrences: 0,
          generatedOccurrences: 0,
          completedOccurrences: 0,
        },
      }),
    } as Response);

    const { baseElement } = render(<Page />);

    expect(baseElement).toBeTruthy();
    // Tên người dùng hiện ở cả thanh tiêu đề của shell lẫn nội dung trang.
    expect((await screen.findAllByText('Test Admin')).length).toBeGreaterThan(0);
  });
});
