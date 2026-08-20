import { LoginForm } from '../../_components/login-form';

export default function TenantLoginPage() {
  return (
    <LoginForm
      portal="tenant"
      eyebrow="Đăng nhập"
      title="Cổng doanh nghiệp"
      description="Dùng tài khoản do doanh nghiệp của bạn cấp."
    />
  );
}
