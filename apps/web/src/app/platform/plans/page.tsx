import type { PlanSummary } from '@enterprise-platform/contracts-tenancy';
import { cookies } from 'next/headers';
import { PlansManagement } from './plans-management';

const DEFAULT_PLANS: PlanSummary[] = [
  {
    id: 'c0000000-0000-4000-8000-000000000001',
    key: 'standard',
    name: 'Gói Tiêu Chuẩn',
    description: 'Gói dịch vụ vận hành cơ bản cho doanh nghiệp vừa và nhỏ',
    version: 1,
    status: 'active',
    modules: ['procedure-engine', 'maintenance', 'inventory'],
    limits: [
      { resourceKey: 'active_users', limitValue: 50, enforcement: 'hard' },
      { resourceKey: 'procedure_definitions', limitValue: 20, enforcement: 'hard' },
    ],
    tenantCount: 12,
  },
  {
    id: 'c0000000-0000-4000-8000-000000000002',
    key: 'enterprise',
    name: 'Gói Doanh Nghiệp',
    description: 'Gói dịch vụ toàn diện quy mô lớn',
    version: 1,
    status: 'active',
    modules: ['procedure-engine', 'maintenance', 'inventory'],
    limits: [
      { resourceKey: 'active_users', limitValue: 500, enforcement: 'hard' },
      { resourceKey: 'procedure_definitions', limitValue: 200, enforcement: 'soft' },
    ],
    tenantCount: 5,
  },
];

export default async function PlatformPlansPage() {
  const cookieHeader = (await cookies()).toString();
  const api = process.env.API_BASE_URL ?? 'http://localhost:3333';

  let plans: PlanSummary[] = DEFAULT_PLANS;
  try {
    const res = await fetch(`${api}/api/platform/v1/plans`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      if (data.plans && data.plans.length > 0) {
        plans = data.plans;
      }
    }
  } catch {
    // Fallback to default plans
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Quản lý gói dịch vụ & Hạn mức
          </h1>
          <p className="text-sm text-slate-500">
            Thiết lập cấu hình phân hệ cấp phép, phiên bản gói và chính sách hạn mức tài nguyên (Quota Policy) cho toàn bộ hệ thống.
          </p>
        </div>
        <PlansManagement initialPlans={plans} />
      </div>
    </>
  );
}
