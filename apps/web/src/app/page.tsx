import { LoginForm } from './_components/login-form';

export default function TenantLoginPage() {
  return (
    <LoginForm
      portal="tenant"
      eyebrow="Đăng nhập doanh nghiệp"
      title="Không gian làm việc"
      description="Nhập email công ty để hệ thống tự động nhận diện doanh nghiệp của bạn."
    />
  );
}
