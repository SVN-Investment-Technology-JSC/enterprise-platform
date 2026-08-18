import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { CreateTenantWizard } from '../create-tenant-wizard';

const validSteps = new Set([
  'step-1',
  'step-2',
  'progress',
  'step-3',
  'step-4',
]);

export default async function CreateTenantStepPage({
  params,
}: {
  params: Promise<{ step: string }>;
}) {
  const { step } = await params;
  if (!validSteps.has(step)) notFound();
  const cookieHeader = (await cookies()).toString();
  const api = process.env.API_BASE_URL ?? 'http://localhost:3333';
  const meResponse = await fetch(`${api}/api/auth/v1/me`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });
  if (!meResponse.ok) redirect('/platform/login');
  const principal = (await meResponse.json()) as AuthenticatedPrincipal;
  if (principal.kind !== 'platform-admin')
    redirect(`/t/${principal.tenantSlug}`);

  return (
    <CreateTenantWizard
      step={step}
      actor={principal.displayName || 'Admin User'}
    />
  );
}
