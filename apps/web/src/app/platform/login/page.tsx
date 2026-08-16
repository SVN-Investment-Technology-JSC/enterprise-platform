import { LoginForm } from '../../_components/login-form';

export default function PlatformLoginPage() {
  return (
    <LoginForm
      portal="platform"
      eyebrow="Đăng nhập bảo mật"
      title="Platform Superadmin"
      description="Quản trị tenant và toàn bộ năng lực của Platform Core."
    />
  );
}
