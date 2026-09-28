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

  it('displays error message when login fails', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      json: jest.fn().mockResolvedValue({ message: 'Email hoặc mật khẩu không chính xác.' }),
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
      target: { value: 'wrong@savina.com' },
    });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), {
      target: { value: 'wrong-pass' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Email hoặc mật khẩu không chính xác.');
    });
  });

  it('toggles password visibility when toggle button is clicked', () => {
    render(
      <LoginForm
        portal="tenant"
        eyebrow="Đăng nhập doanh nghiệp"
        title="Không gian làm việc"
        description="Đăng nhập"
      />,
    );

    const passwordInput = screen.getByLabelText('Mật khẩu') as HTMLInputElement;
    expect(passwordInput.type).toBe('password');

    const toggleButton = screen.getByRole('button', { name: 'Hiện mật khẩu' });
    fireEvent.click(toggleButton);

    expect(passwordInput.type).toBe('text');
    expect(screen.getByRole('button', { name: 'Ẩn mật khẩu' })).toBeDefined();
  });
});
