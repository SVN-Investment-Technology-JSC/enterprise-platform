import { LoginForm } from '../../../_components/login-form';

export default async function TenantScopedLoginPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  return (
    <LoginForm
      portal="tenant"
      eyebrow={`Đăng nhập doanh nghiệp · ${tenantSlug}`}
      title="Tenant Portal"
      description="Dùng tài khoản quản trị viên của doanh nghiệp."
      tenantSlug={tenantSlug}
    />
  );
}
