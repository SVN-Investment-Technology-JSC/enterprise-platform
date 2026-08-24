import { redirect } from 'next/navigation';

export default function CreateTenantPage() {
  redirect('/platform/tenants/create/step-1');
}
