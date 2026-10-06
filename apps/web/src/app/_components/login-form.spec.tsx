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
      text: jest.fn().mockResolvedValue(JSON.stringify({ redirectTo: '/dashboard' })),
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
      text: jest.fn().mockResolvedValue(JSON.stringify({ message: 'Email hoặc mật khẩu không chính xác.' })),
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

  it.each([502, 503, 504])('shows a service error for an HTML gateway response (%s)', async (status) => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status,
      text: jest.fn().mockResolvedValue('<html><body>Bad Gateway</body></html>'),
    });
    render(<LoginForm portal="tenant" eyebrow="Đăng nhập" title="Đăng nhập" description="Đăng nhập" />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@savina.com' } });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(
      'Dịch vụ đăng nhập tạm thời chưa sẵn sàng. Vui lòng thử lại sau.',
    ));
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Đăng nhập' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows an invalid-response error when a successful reply is not login JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue('<html><body>captive portal</body></html>'),
    });
    render(<LoginForm portal="tenant" eyebrow="Đăng nhập" title="Đăng nhập" description="Đăng nhập" />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@savina.com' } });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(
      'Phản hồi đăng nhập không hợp lệ. Vui lòng thử lại sau.',
    ));
    expect(replace).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Đăng nhập' }) as HTMLButtonElement).disabled).toBe(false);
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
