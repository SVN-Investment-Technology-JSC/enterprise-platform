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
    <PlatformShell eyebrow="Doanh nghiệp" title="Không gian làm việc" subtitle="Chọn phân hệ để bắt đầu. Sơ đồ tổ chức luôn sẵn có, không phụ thuộc phân hệ nào." actor={principal.displayName} logoutPortal="tenant">
      {/* Sơ đồ tổ chức thuộc phần lõi nên đứng riêng, không nằm trong lưới phân hệ. */}
      <a
        href={`/t/${tenantSlug}/to-chuc`}
        style={{
          display: 'block', marginBottom: '1.25rem', padding: '1.15rem 1.35rem',
          border: '1px solid #dbe3ed', borderLeft: '4px solid #1556d4', borderRadius: '1rem',
          color: 'inherit', textDecoration: 'none', background: '#fff',
          boxShadow: '0 14px 35px #17335d0a',
        }}
      >
        <strong style={{ display: 'block', fontSize: '1.05rem' }}>Sơ đồ tổ chức</strong>
        <span style={{ color: '#66768a', fontSize: '.9rem' }}>
          Các đơn vị, chức danh và nhân sự của doanh nghiệp.
        </span>
      </a>
      <CardGrid>
        {modules.map((module) => (
          <ModuleCard key={module.key} name={module.name} description={`${module.description} · v${module.version}`} status={module.status} icon={module.icon} href={module.key === 'crm' ? `/t/${tenantSlug}/crm` : module.launchUrl} />
        ))}
      </CardGrid>
      {modules.length === 0 ? <p>Tenant chưa có module đang hoạt động.</p> : null}
    </PlatformShell>
  );
}
