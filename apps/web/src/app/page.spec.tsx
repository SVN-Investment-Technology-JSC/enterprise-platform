import RootPage from './page';

const redirect = jest.fn();
jest.mock('next/navigation', () => ({
  redirect: (path: string) => redirect(path),
}));

const cookieStore = { has: jest.fn(), toString: jest.fn(() => 'ep_access=token') };
jest.mock('next/headers', () => ({
  cookies: async () => cookieStore,
}));

describe('RootPage', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    redirect.mockReset();
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  // SEC-UI023-02
  it('chưa có cookie phiên thì về /login, không hỏi API', async () => {
    cookieStore.has.mockReturnValue(false);
    await RootPage();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith('/login');
  });

  // SEC-UI023-01
  it('đã đăng nhập thì về trang chính của tài khoản', async () => {
    cookieStore.has.mockReturnValue(true);
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ kind: 'tenant-user' }) });
    await RootPage();
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('phiên hết hạn thì về /login', async () => {
    cookieStore.has.mockReturnValue(true);
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    await RootPage();
    expect(redirect).toHaveBeenCalledWith('/login');
  });
});
