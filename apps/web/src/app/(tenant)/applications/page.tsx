import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import type { TenantModuleCatalogItem } from '@enterprise-platform/contracts-tenancy';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { EnterpriseApplications } from './enterprise-applications';

export default async function EnterpriseApplicationsPage() {
  const api = process.env.API_BASE_URL ?? 'http://localhost:3333';
  const cookieHeader = (await cookies()).toString();
  const meResponse = await fetch(`${api}/api/auth/v1/me`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });

  if (!meResponse.ok) redirect('/');
  const principal = (await meResponse.json()) as AuthenticatedPrincipal;
  if (principal.kind === 'platform-admin') redirect('/platform');

  const canRequestActivation = principal.permissions.includes('tenant.manage');
  try {
    const catalogResponse = await fetch(
      `${api}/api/platform/v1/modules/catalog`,
      {
        headers: { cookie: cookieHeader },
        cache: 'no-store',
      },
    );
    if (!catalogResponse.ok) {
      return (
        <EnterpriseApplications
          canRequestActivation={canRequestActivation}
          initialError={`Không thể tải danh sách ứng dụng (HTTP ${catalogResponse.status}).`}
          initialModules={[]}
        />
      );
    }
    const payload = (await catalogResponse.json()) as {
      modules: TenantModuleCatalogItem[];
    };
    return (
      <EnterpriseApplications
        canRequestActivation={canRequestActivation}
        initialModules={payload.modules}
      />
    );
  } catch {
    return (
      <EnterpriseApplications
        canRequestActivation={canRequestActivation}
        initialError="Không thể kết nối API để tải danh sách ứng dụng."
        initialModules={[]}
      />
    );
  }
}
