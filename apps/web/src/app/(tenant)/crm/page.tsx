import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

interface CrmSummary {
  tenantId: string;
  customers: { id: string; name: string; email: string }[];
}

export default async function CrmPage() {
  const cookieHeader = (await cookies()).toString();
  const api = process.env.API_BASE_URL ?? 'http://localhost:3333';
  const [meResponse, response] = await Promise.all([
    fetch(`${api}/api/auth/v1/me`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    }),
    fetch(`${api}/api/crm/v1/summary`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    }),
  ]);
  if (!meResponse.ok) redirect('/');
  const principal = (await meResponse.json()) as AuthenticatedPrincipal;
  if (principal.kind === 'platform-admin') redirect('/platform');
  const summary = response.ok
    ? ((await response.json()) as CrmSummary)
    : undefined;
  const error = response.ok
    ? undefined
    : (((await response.json().catch(() => ({}))) as { message?: string })
        .message ?? `CRM HTTP ${response.status}`);
  return (
    <main className="mx-auto max-w-[1440px] p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Business Module
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">CRM</h1>
        <p className="mt-1 text-sm text-slate-500">
          CRM chỉ truy cập crm_schema trong dedicated database của tenant.
        </p>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <div style={{ display: 'grid', gap: '12px' }}>
        {summary?.customers.map((customer) => (
          <article
            key={customer.id}
            style={{
              padding: '18px',
              border: '1px solid #dbe3ed',
              borderRadius: '14px',
              background: 'white',
            }}
          >
            <strong>{customer.name}</strong>
            <p>{customer.email}</p>
          </article>
        ))}
      </div>
    </main>
  );
}
