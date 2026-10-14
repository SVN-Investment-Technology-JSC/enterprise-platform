'use client';
import { createContext, Suspense, useContext, type ComponentType, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useHrmPermissions } from '../hrm-permissions';
import { resolveHubTab, type HrmHubTabMeta } from '../hrm-hub-tabs';

export interface HrmHubTab extends HrmHubTabMeta {
  Screen: ComponentType;
}

/** Thanh tab do trang gộp dựng sẵn; màn hình con đặt nó vào tiêu đề của mình bằng `HubTabsSlot`. */
const HubTabsContext = createContext<ReactNode>(null);

/** Vị trí của thanh tab trong tiêu đề màn hình con (chỉ có khi trang gộp đặt `tabsInHeader`); không có thì không vẽ gì. */
export function HubTabsSlot() {
  return <>{useContext(HubTabsContext)}</>;
}

function HubInner({
  tabs,
  tabsInHeader,
}: {
  tabs: readonly HrmHubTab[];
  tabsInHeader: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { any } = useHrmPermissions();
  const visible = tabs.filter((tab) => any(tab.permissions));
  const active = resolveHubTab(visible, searchParams?.get('view') ?? null);
  if (!active) return null;
  const Screen = active.Screen;
  const nav =
    visible.length > 1 ? (
      <nav
        role="tablist"
        aria-label="Chức năng"
        className={
          tabsInHeader
            ? // shrink-0: tab trên tiêu đề ít và ngắn, không để bị bóp hẹp (bóp hẹp làm hiện thanh cuộn nhỏ có mũi tên lên/xuống cạnh tab).
              'flex shrink-0 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
            : 'flex gap-1 overflow-x-auto border-b border-slate-200'
        }
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
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-1.5 text-xs font-semibold transition-colors ${
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
    ) : null;
  return (
    <div className="space-y-3">
      {!tabsInHeader && nav}
      <div key={active.id}>
        <HubTabsContext.Provider value={tabsInHeader ? nav : null}>
          <Screen />
        </HubTabsContext.Provider>
      </div>
    </div>
  );
}

/**
 * Trang gộp nhiều chức năng thành các tab; tab nào người dùng không có quyền thì ẩn.
 * `tabsInHeader`: thanh tab nằm trong tiêu đề của từng màn hình con (cạnh nút thao tác) thay vì một hàng riêng.
 */
export function HrmTabHub({
  tabs,
  tabsInHeader = false,
}: {
  tabs: readonly HrmHubTab[];
  tabsInHeader?: boolean;
}) {
  return (
    <Suspense fallback={null}>
      <HubInner tabs={tabs} tabsInHeader={tabsInHeader} />
    </Suspense>
  );
}
