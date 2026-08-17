import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SessionLogoutButton } from './session-logout-button';

function response(status: number): Response {
  return { ok: status >= 200 && status < 300, status } as Response;
}

describe('SessionLogoutButton', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    document.cookie = 'ep_csrf=csrf-initial; path=/';
  });

  afterEach(() => {
    document.cookie = 'ep_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    globalThis.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('revokes the session and redirects a tenant to its login page', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValue(response(204));
    globalThis.fetch = fetchMock;
    const onLoggedOut = jest.fn();
    render(<SessionLogoutButton portal="tenant" onLoggedOut={onLoggedOut} />);

    fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất khỏi hệ thống' }));

    await waitFor(() => expect(onLoggedOut).toHaveBeenCalledWith('/tenant/login'));
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/v1/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-csrf-token': 'csrf-initial' },
    });
  });

  it('refreshes an expired access token before revoking the session', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    fetchMock
      .mockResolvedValueOnce(response(401))
      .mockImplementationOnce(async () => {
        document.cookie = 'ep_csrf=csrf-rotated; path=/';
        return response(200);
      })
      .mockResolvedValueOnce(response(204));
    globalThis.fetch = fetchMock;
    const onLoggedOut = jest.fn();
    render(<SessionLogoutButton portal="platform" onLoggedOut={onLoggedOut} />);

    fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất khỏi hệ thống' }));

    await waitFor(() => expect(onLoggedOut).toHaveBeenCalledWith('/platform/login'));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/auth/v1/refresh', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-csrf-token': 'csrf-initial' },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/auth/v1/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-csrf-token': 'csrf-rotated' },
    });
  });
});
