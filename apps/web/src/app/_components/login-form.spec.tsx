import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LoginForm } from './login-form';

const replace = jest.fn();
const refresh = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
}));

jest.mock('./session-recovery', () => ({ SessionRecovery: () => null }));

describe('LoginForm', () => {
  beforeEach(() => {
    replace.mockReset();
    refresh.mockReset();
  });

  it('submits tenant credentials without requiring a tenant slug in the URL', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ redirectTo: '/dashboard' }),
    });
    global.fetch = fetchMock;
    render(
      <LoginForm
        portal="tenant"
        eyebrow="Đăng nhập doanh nghiệp"
        title="Không gian làm việc"
        description="Đăng nhập"
      />,
    );

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'admin@savina.com' },
    });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), {
      target: { value: 'valid-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      email: 'admin@savina.com',
      password: 'valid-password',
      portal: 'tenant',
    });
    expect(refresh).toHaveBeenCalled();
  });
});
