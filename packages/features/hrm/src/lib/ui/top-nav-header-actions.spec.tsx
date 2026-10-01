/** @jest-environment jsdom */
import type { NotificationClient } from '@enterprise-platform/shared-ui';
import { NotificationProvider } from '@enterprise-platform/shared-ui';
import { render, screen, waitFor } from '@testing-library/react';
import { TopNavHeaderActions } from './top-nav-header-actions';

function notificationClient(): NotificationClient {
  return {
    list: jest.fn().mockResolvedValue({ items: [] }),
    summary: jest.fn().mockResolvedValue({ unreadCount: 3, lastSequence: 4 }),
    sync: jest.fn().mockResolvedValue({
      resetRequired: false,
      events: [],
      summary: { unreadCount: 3, lastSequence: 4 },
    }),
    setRead: jest.fn(),
    readAll: jest.fn(),
    preferences: jest.fn().mockResolvedValue([]),
    setPreferences: jest.fn().mockResolvedValue([]),
    connect: jest.fn().mockReturnValue({ disconnect: jest.fn() }),
  };
}

it('renders only the shared notification counter in the HRM header', async () => {
  render(
    <NotificationProvider client={notificationClient()}>
      <TopNavHeaderActions displayName="HR User" />
    </NotificationProvider>,
  );

  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Thông báo, 3 chưa đọc' })).toBeTruthy(),
  );
  expect(screen.getAllByRole('button', { name: /Thông báo/ })).toHaveLength(1);
});
