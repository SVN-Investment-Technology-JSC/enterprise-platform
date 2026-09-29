import { Suspense } from 'react';
import { TenantResetPasswordForm } from './tenant-reset-password-form';

export default function TenantResetPasswordPage() {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center bg-slate-50" />}>
      <TenantResetPasswordForm />
    </Suspense>
  );
}
