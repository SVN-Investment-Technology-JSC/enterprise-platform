import { LoginForm } from '../../_components/login-form';

export default function TenantLoginPage() {
  return (
    <LoginForm
      portal="tenant"
      eyebrow="Đăng nhập doanh nghiệp"
      title="Tenant Portal"
      description="Dùng tài khoản do quản trị viên nền tảng hoặc tenant của bạn cung cấp."
    />
  );
}
