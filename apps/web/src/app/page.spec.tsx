import { render, screen } from '@testing-library/react';
import PortalChooserPage from './page';

jest.mock('./_components/session-recovery', () => ({
  SessionRecovery: () => null,
}));

describe('PortalChooserPage', () => {
  it('keeps both account portal choices available', () => {
    render(<PortalChooserPage />);

    expect(screen.getByRole('link', { name: /vào cổng quản trị/i }).getAttribute('href')).toBe('/admin');
    expect(screen.getByRole('link', { name: /vào cổng tenant/i }).getAttribute('href')).toBe('/tenant/login');
  });
});
