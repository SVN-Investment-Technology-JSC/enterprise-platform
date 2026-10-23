/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import { ChatLauncher } from './chat-launcher';

const ME = 'aaaaaaaa-0000-4000-8000-000000000001';

/** Mọi API trả cùng một nội dung (như test của các phân hệ giả `fetch`), trừ những đường dẫn được chỉ định. */
function mockFetch(byPath: Record<string, unknown>, fallback: unknown) {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const match = Object.keys(byPath).find((path) => url.includes(path));
    const body = match ? byPath[match] : fallback;
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as typeof fetch;
}

describe('ChatLauncher', () => {
  const originalFetch = global.fetch;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    consoleError.mockRestore();
  });

  it('API trả dữ liệu không phải hồ sơ người dùng thì không hiện chat và không làm hỏng trang', async () => {
    mockFetch({}, { tenantId: 'tenant-test', definitions: [], instances: [] });
    const { container } = render(<ChatLauncher />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.innerHTML).toBe('');
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('có hồ sơ nhưng danh sách trò chuyện, danh bạ, trạng thái trả dữ liệu lạ thì nút chat vẫn hiện', async () => {
    mockFetch({ '/profile': { userId: ME, fullName: 'Hồ Thọ', email: 'tho@test.local', avatarVersion: null } }, { unexpected: true });
    render(<ChatLauncher />);
    expect(await screen.findByRole('button', { name: 'Mở chat nội bộ' })).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByRole('button', { name: 'Mở chat nội bộ' })).toBeTruthy();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
