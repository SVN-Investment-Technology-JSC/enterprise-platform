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
    expect(await screen.findByText('Test Admin')).toBeTruthy();
  });
});
