import { TenantResetPasswordForm } from './tenant-reset-password-form';

export default async function TenantResetPasswordPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  return <TenantResetPasswordForm tenantSlug={tenantSlug} />;
}
