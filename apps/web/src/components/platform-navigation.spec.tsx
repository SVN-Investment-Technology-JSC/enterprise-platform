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

  it('renders Brand Studio navigation item in primary navigation', () => {
    const { getByRole } = render(
      <PlatformNavigation active="brand-studio" />,
    );

    const brandLink = getByRole('link', { name: 'Thư viện icon' });
    expect(brandLink.getAttribute('href')).toBe('/platform/brand-studio');
    expect(brandLink.getAttribute('aria-current')).toBe('page');
  });
});
