import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import { SessionLogoutButton } from '@enterprise-platform/shared-ui';
import { Menu } from 'lucide-react';
import { cookies } from 'next/headers';
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
import { PageBreadcrumb } from '@/components/ui/page-breadcrumb';
import { BrandStudioConsole } from './brand-studio-console';

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export default async function PlatformBrandStudioPage() {
  const cookieHeader = (await cookies()).toString();
  const api = process.env.API_BASE_URL ?? 'http://localhost:3333';

  let principal: AuthenticatedPrincipal | undefined;
  try {
    const meResponse = await fetch(`${api}/api/auth/v1/me`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (meResponse.ok) {
      principal = (await meResponse.json()) as AuthenticatedPrincipal;
      if (principal.kind !== 'platform-admin') {
        redirect('/dashboard');
      }
    }
  } catch {
    // Development fallback without auth service
  }

  const displayName = principal?.displayName ?? 'Admin';

  return (
    <div className="min-h-screen bg-[#071322] text-slate-100">
      {/* Sidebar trái */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col bg-[#091426] px-2 py-4 text-slate-200 lg:flex">
        <div className="mb-7 flex items-center gap-2 px-2">
          <div className="grid size-8 place-items-center rounded-md bg-blue-600 text-white font-bold text-sm">
            S
          </div>
          <div>
            <p className="text-sm font-semibold text-white">SVNDTS Platform</p>
            <p className="text-xs text-slate-400">Quản trị hệ thống</p>
          </div>
        </div>
        <PlatformNavigation active="brand-studio" />
        <div className="mt-auto border-t border-slate-800 px-2 pt-4">
          <SessionLogoutButton portal="platform" tone="dark" />
        </div>
      </aside>

      {/* Vùng nội dung chính */}
      <div className="lg:pl-60">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-slate-800 bg-[#091426]/90 px-4 backdrop-blur lg:px-8">
          <Sheet>
            <SheetTrigger
              render={
                <Button
                  aria-label="Mở điều hướng"
                  className="lg:hidden text-slate-300"
                  size="icon"
                  variant="ghost"
                />
              }
            >
              <Menu />
            </SheetTrigger>
            <SheetContent className="w-72 bg-[#091426] text-white" side="left">
              <SheetHeader>
                <SheetTitle className="text-white">SVNDTS Platform</SheetTitle>
                <SheetDescription className="text-slate-400">
                  Quản trị hệ thống
                </SheetDescription>
              </SheetHeader>
              <PlatformNavigation active="brand-studio" mobile />
            </SheetContent>
          </Sheet>
          <TopNavHeaderActions
            avatarText={initials(displayName)}
            displayName={displayName}
            role="Platform Admin"
          />
        </header>

        <main className="p-4 sm:p-6 lg:p-8">
          <PageBreadcrumb
            className="mb-5 text-slate-400"
            items={[
              { label: 'Quản trị hệ thống', href: '/platform' },
              { label: 'Thương hiệu SVNDTS (Brand Studio)' },
            ]}
          />

          <div className="space-y-6">
            <BrandStudioConsole />
          </div>
        </main>
      </div>
    </div>
  );
}
