import RootPage from './page';

const redirect = jest.fn();
jest.mock('next/navigation', () => ({
  redirect: (path: string) => redirect(path),
}));

describe('RootPage', () => {
  it('sends visitors straight to the tenant login', () => {
    RootPage();
    expect(redirect).toHaveBeenCalledWith('/login');
  });
});
