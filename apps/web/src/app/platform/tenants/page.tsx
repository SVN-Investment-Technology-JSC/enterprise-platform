import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import type { TenantSummary } from '@enterprise-platform/contracts-tenancy';
import { SessionLogoutButton } from '@enterprise-platform/shared-ui';
import {
  Building2,
  Menu,
} from 'lucide-react';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { TopNavHeaderActions } from '@/components/top-nav-header-actions';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { PlatformNavigation } from '@/components/platform-navigation';
import { TenantManagement } from '../tenant-management';
function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export default async function PlatformTenantsPage() {
  const cookieHeader = (await cookies()).toString();
  const api = process.env.API_BASE_URL ?? 'http://localhost:3333';
  const [meResponse, tenantsResponse] = await Promise.all([
    fetch(`${api}/api/auth/v1/me`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    }),
    fetch(`${api}/api/platform/v1/tenants`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    }),
  ]);
  if (!meResponse.ok || !tenantsResponse.ok) redirect('/admin');
  const principal = (await meResponse.json()) as AuthenticatedPrincipal;
  if (principal.kind !== 'platform-admin')
    redirect('/dashboard');
  const { tenants } = (await tenantsResponse.json()) as {
    tenants: TenantSummary[];
  };
  const displayName = principal.displayName || 'Admin User';

  return (
    <div className="min-h-screen bg-[#f8f9ff] text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col bg-[#091426] px-2 py-4 text-slate-200 lg:flex">
        <div className="mb-7 flex items-center gap-2 px-2">
          <div className="grid size-8 place-items-center rounded-md bg-white text-[#091426]">
            <Building2 className="size-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">SaaS Platform</p>
            <p className="text-xs text-slate-400">Quản trị hệ thống</p>
          </div>
        </div>
        <PlatformNavigation active="tenants" />
        <div className="mt-auto border-t border-slate-800 px-2 pt-4">
          <SessionLogoutButton portal="platform" tone="dark" />
        </div>
      </aside>
      <div className="lg:pl-60">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b bg-white/90 px-4 backdrop-blur lg:px-8">
          <Sheet>
            <SheetTrigger
              render={
                <Button
                  className="lg:hidden"
                  size="icon"
                  variant="ghost"
                  aria-label="Mở điều hướng"
                />
              }
            >
              <Menu />
            </SheetTrigger>
            <SheetContent side="left" className="w-72 bg-[#091426] text-white">
              <SheetHeader>
                <SheetTitle className="text-white">SaaS Platform</SheetTitle>
                <SheetDescription className="text-slate-400">
                  Quản trị hệ thống
                </SheetDescription>
              </SheetHeader>
              <PlatformNavigation active="tenants" mobile />
            </SheetContent>
          </Sheet>
          <TopNavHeaderActions
            displayName={displayName}
            role="Platform Admin"
            avatarText={initials(displayName)}
          />
        </header>
        <main className="p-4 sm:p-6 lg:p-8">
          <nav
            className="mb-5 flex items-center gap-2 text-sm text-muted-foreground"
            aria-label="Breadcrumb"
          >
            <Link className="hover:text-[#091426]" href="/platform">
              Quản trị hệ thống
            </Link>
            <span>/</span>
            <span className="font-medium text-[#091426]">Quản lý Tenant</span>
          </nav>
          <TenantManagement initialTenants={tenants} canDelete={principal.permissions.includes('platform.tenants.delete')} />
        </main>
      </div>
    </div>
  );
}
