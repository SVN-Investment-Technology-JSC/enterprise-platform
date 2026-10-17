import { LoginForm } from '../../_components/login-form';

export default function PlatformLoginPage() {
  return (
    <LoginForm
      portal="platform"
      eyebrow="Đăng nhập"
      title="Cổng quản trị hệ thống"
      description="Chỉ dành cho người vận hành hệ thống."
    />
  );
}
