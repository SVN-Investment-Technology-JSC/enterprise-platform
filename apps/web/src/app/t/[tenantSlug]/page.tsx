import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import { CardGrid, ModuleCard, PlatformShell } from '@enterprise-platform/shared-ui';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

interface ModuleInfo { key: string; name: string; description: string; launchUrl: string; icon?: string; version: string; status: string }

export default async function TenantPortalPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const cookieHeader = (await cookies()).toString();
  const api = process.env.API_BASE_URL ?? 'http://localhost:3333';
  const [meResponse, modulesResponse] = await Promise.all([
    fetch(`${api}/api/auth/v1/me`, { headers: { cookie: cookieHeader }, cache: 'no-store' }),
    fetch(`${api}/api/platform/v1/modules`, { headers: { cookie: cookieHeader }, cache: 'no-store' }),
  ]);
  if (!meResponse.ok || !modulesResponse.ok) redirect('/tenant/login');
  const principal = await meResponse.json() as AuthenticatedPrincipal;
  if (principal.kind === 'platform-admin') redirect('/platform');
  if (principal.tenantSlug !== tenantSlug) redirect(`/t/${principal.tenantSlug}`);
  const modules = await modulesResponse.json() as ModuleInfo[];

  return (
    <PlatformShell eyebrow={`Tenant Portal · ${tenantSlug}`} title="Ứng dụng của doanh nghiệp" subtitle="Danh sách này do entitlement của Platform Core cung cấp. Module bị tắt vẫn giữ nguyên schema và dữ liệu." actor={principal.displayName} logoutPortal="tenant">
      <CardGrid>
        {modules.map((module) => (
          <ModuleCard key={module.key} name={module.name} description={`${module.description} · v${module.version}`} status={module.status} icon={module.icon} href={module.key === 'crm' ? `/t/${tenantSlug}/crm` : module.launchUrl} />
        ))}
      </CardGrid>
      {modules.length === 0 ? <p>Tenant chưa có module đang hoạt động.</p> : null}
    </PlatformShell>
  );
}
