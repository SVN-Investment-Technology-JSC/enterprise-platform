import { render } from '@testing-library/react';

import { PlatformNavigation } from './platform-navigation';

describe('PlatformNavigation', () => {
  it('renders Data Import as the active child of Settings', () => {
    const { getByRole, getByText } = render(
      <PlatformNavigation active="data-import" />,
    );

    const settingsGroup = getByText('Cài đặt').closest('details');
    const importLink = getByRole('link', { name: 'Nhập dữ liệu' });

    expect(settingsGroup?.contains(importLink)).toBe(true);
    expect(importLink.getAttribute('href')).toBe('/platform/data-import');
    expect(importLink.getAttribute('aria-current')).toBe('page');
  });
});
