import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AccountWorkspace } from './account-workspace';

export default async function MyAccountPage() {
  const api = process.env.API_BASE_URL ?? 'http://localhost:3333';
  const cookieHeader = (await cookies()).toString();
  const me = await fetch(`${api}/api/auth/v1/me`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });
  if (!me.ok) redirect('/');
  const principal = (await me.json()) as AuthenticatedPrincipal;
  return <AccountWorkspace principal={principal} />;
}
