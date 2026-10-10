'use client';
import { Suspense, type ComponentType } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useHrmPermissions } from '../hrm-permissions';
import { resolveHubTab, type HrmHubTabMeta } from '../hrm-hub-tabs';

export interface HrmHubTab extends HrmHubTabMeta {
  Screen: ComponentType;
}

function HubInner({ tabs }: { tabs: readonly HrmHubTab[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { any } = useHrmPermissions();
  const visible = tabs.filter((tab) => any(tab.permissions));
  const active = resolveHubTab(visible, searchParams?.get('view') ?? null);
  if (!active) return null;
  const Screen = active.Screen;
  return (
    <div className="space-y-4">
      {visible.length > 1 && (
        <nav
          role="tablist"
          aria-label="Chức năng"
          className="flex gap-1 overflow-x-auto border-b border-slate-200"
        >
          {visible.map((tab) => {
            const selected = tab.id === active.id;
            return (
              <Link
                key={tab.id}
                role="tab"
                aria-selected={selected}
                href={`${pathname}?view=${tab.id}`}
                scroll={false}
                replace
                className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
                  selected
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      )}
      <div key={active.id}>
        <Screen />
      </div>
    </div>
  );
}

/** Trang gộp nhiều chức năng thành các tab; tab nào người dùng không có quyền thì ẩn. */
export function HrmTabHub({ tabs }: { tabs: readonly HrmHubTab[] }) {
  return (
    <Suspense fallback={null}>
      <HubInner tabs={tabs} />
    </Suspense>
  );
}
