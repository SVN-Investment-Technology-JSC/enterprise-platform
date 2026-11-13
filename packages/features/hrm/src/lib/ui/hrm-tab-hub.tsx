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
  inactive,
}: {
  tabs: readonly HrmHubTab[];
  tabsInHeader: boolean;
  inactive?: Readonly<Record<string, string>>;
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
          const note = inactive?.[tab.id];
          return (
            <Link
              key={tab.id}
              role="tab"
              aria-selected={selected}
              href={`${pathname}?view=${tab.id}`}
              title={note}
              scroll={false}
              replace
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-1.5 text-xs font-semibold transition-colors ${
                selected
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {tab.label}
              {note ? (
                <span className="ml-1.5 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                  Đang tắt
                </span>
              ) : null}
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
  inactive,
}: {
  tabs: readonly HrmHubTab[];
  tabsInHeader?: boolean;
  /** Tab đang tắt theo cấu hình: id tab → lý do. Tab vẫn mở được (xem dữ liệu cũ) nhưng có nhãn "Đang tắt". */
  inactive?: Readonly<Record<string, string>>;
}) {
  return (
    <Suspense fallback={null}>
      <HubInner tabs={tabs} tabsInHeader={tabsInHeader} inactive={inactive} />
    </Suspense>
  );
}
