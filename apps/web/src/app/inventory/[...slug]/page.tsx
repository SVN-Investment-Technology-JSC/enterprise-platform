import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function InventoryCatchAllPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const subpath = Array.isArray(slug) ? slug.join('/') : '';
  const cookieHeader = (await cookies()).toString();
  const api = process.env.API_BASE_URL ?? 'http://localhost:3333';
  const meResponse = await fetch(`${api}/api/auth/v1/me`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });
  if (!meResponse.ok) redirect('/tenant/login');
  const principal = (await meResponse.json()) as AuthenticatedPrincipal;
  if (principal.kind === 'platform-admin') redirect('/platform');
  if (principal.tenantSlug) {
    redirect(`/t/${principal.tenantSlug}/inventory${subpath ? `/${subpath}` : ''}`);
  }
  redirect('/tenant/login');
}
