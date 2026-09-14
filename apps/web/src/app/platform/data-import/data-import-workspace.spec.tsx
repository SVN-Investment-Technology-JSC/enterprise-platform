import { render } from '@testing-library/react';

import DataImportWorkspace from './data-import-workspace';

describe('DataImportWorkspace', () => {
  it('should render successfully', () => {
    const { getByText, getByRole } = render(
      <DataImportWorkspace
        tenants={[
          {
            id: 'tenant-1',
            slug: 'savina',
            name: 'Savina',
            status: 'active',
            createdAt: '2026-09-05T00:00:00.000Z',
            admin: null,
            database: null,
            modules: [],
          },
        ]}
      />,
    );
    expect(getByText('Data Import')).toBeTruthy();
    expect(getByRole('option', { name: 'Savina (savina)' })).toBeTruthy();
  });
});
