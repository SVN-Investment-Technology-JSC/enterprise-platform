import { PlatformShell } from '@enterprise-platform/shared-ui';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

interface CrmSummary { tenantId: string; customers: { id: string; name: string; email: string }[] }

export default async function CrmPage() {
  const cookieHeader = (await cookies()).toString();
  const api = process.env.API_BASE_URL ?? 'http://localhost:3333';
  const response = await fetch(`${api}/api/crm/v1/summary`, {
    headers: { cookie: cookieHeader }, cache: 'no-store',
  });
  if (response.status === 401) redirect('/tenant/login');
  const summary = response.ok ? await response.json() as CrmSummary : undefined;
  const error = response.ok ? undefined : (await response.json().catch(() => ({})) as { message?: string }).message ?? `CRM HTTP ${response.status}`;
  return (
    <PlatformShell eyebrow="Business Module" title="CRM" subtitle="CRM chỉ truy cập crm_schema trong dedicated database của tenant." logoutPortal="tenant">
      {error ? <p role="alert">{error}</p> : null}
      <div style={{ display: 'grid', gap: '12px' }}>
        {summary?.customers.map((customer) => <article key={customer.id} style={{ padding: '18px', border: '1px solid #dbe3ed', borderRadius: '14px', background: 'white' }}><strong>{customer.name}</strong><p>{customer.email}</p></article>)}
      </div>
    </PlatformShell>
  );
}
