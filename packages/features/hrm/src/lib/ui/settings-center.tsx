'use client';
import { createContext, Suspense, useContext, useEffect, useMemo, useState, type ComponentType } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  Calendar,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  FileText,
  GitBranch,
  History,
  LayoutGrid,
  MapPin,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Search,
  Settings,
  ShieldCheck,
  Smartphone,
  Tag,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useHrmPermissions } from '../hrm-permissions';
import { HRM_HUBS } from '../hrm-hub-tabs';
import { useHrmCrumbs } from '../hrm-crumbs';
import {
  SETTINGS_GROUPS,
  filterSettingsEntries,
  resolveSettingsEntry,
  settingsEntryQuery,
  type SettingsEntry,
  type SettingsGroup,
  type SettingsIcon,
} from '../hrm-settings-nav';
import { Button } from './button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './sheet';
import { IconTile, type KitTone } from './settings-kit';

const ICONS: Record<SettingsIcon, LucideIcon> = {
  leave: CalendarDays,
  reason: Tag,
  rules: Settings,
  calendar: Calendar,
  gps: MapPin,
  device: Smartphone,
  schedule: Users,
  shift: CalendarRange,
  request: FileText,
  approval: GitBranch,
  payroll: Wallet,
  integration: Plug,
  permission: ShieldCheck,
};

const GROUP_TONE: Record<string, KitTone> = {
  leave: 'blue',
  time: 'green',
  schedule: 'violet',
  request: 'amber',
  payroll: 'orange',
  system: 'slate',
};

/** Màn hình cấu hình đang nằm trong trung tâm cấu hình: tab con đã có trong thanh bên nên màn hình có thể ẩn thanh tab riêng. */
const SettingsEmbeddedContext = createContext(false);
export function useSettingsEmbedded(): boolean {
  return useContext(SettingsEmbeddedContext);
}

type VisibleEntry = SettingsEntry;
interface VisibleGroup extends Omit<SettingsGroup, 'entries'> {
  entries: VisibleEntry[];
}

const HIDE_KEY = 'hrm_settings_nav_hidden';

function EntryIcon({ icon, className = 'size-4' }: { icon: SettingsIcon; className?: string }) {
  const Icon = ICONS[icon];
  return <Icon aria-hidden="true" className={className} />;
}

/**
 * Danh mục các mục cấu hình theo nhóm chức năng: ô tìm không dấu, nhóm thu gọn được (nhóm đang mở luôn mở), mục đang mở
 * được tô. Dùng cả trong thanh bên (màn rộng) lẫn trong ngăn kéo menu (màn hẹp).
 */
function SettingsNav({
  groups,
  activeId,
  pathname,
  onNavigate,
}: {
  groups: VisibleGroup[];
  activeId: string | undefined;
  pathname: string;
  /** Gọi khi bấm một mục (ngăn kéo menu tự đóng). */
  onNavigate?: () => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const searching = keyword.trim() !== '';
  const filtered = useMemo(
    () =>
      groups
        .map((g) => ({ ...g, entries: filterSettingsEntries(g.entries, keyword) }))
        .filter((g) => g.entries.length > 0),
    [groups, keyword],
  );
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const link = (selected: boolean) =>
    `flex items-center gap-2.5 rounded-lg border-l-2 px-3 py-2 text-xs font-semibold transition-colors ${
      selected
        ? 'border-blue-600 bg-blue-50 text-blue-700'
        : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'
    }`;
  return (
    <>
      <div className="relative mb-2">
        <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          aria-label="Tìm cấu hình"
          placeholder="Tìm cấu hình..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-400"
        />
      </div>
      <nav aria-label="Mục cấu hình" className="space-y-0.5">
        {!searching && (
          <Link
            href={pathname}
            scroll={false}
            replace
            onClick={onNavigate}
            aria-current={activeId === undefined ? 'page' : undefined}
            className={link(activeId === undefined)}
          >
            <LayoutGrid aria-hidden="true" className="size-4" />
            Tổng quan cấu hình
          </Link>
        )}
        {filtered.map((group) => {
          const open = searching || !collapsed.has(group.id) || group.entries.some((e) => e.id === activeId);
          return (
            <div key={group.id} className="pt-2">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => toggle(group.id)}
                className="flex w-full cursor-pointer items-center justify-between rounded-md px-3 py-1 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-600"
              >
                {group.navLabel}
                <ChevronDown aria-hidden="true" className={`size-3 transition-transform ${open ? '' : '-rotate-90'}`} />
              </button>
              {open
                ? group.entries.map((entry) => (
                    <Link
                      key={entry.id}
                      href={`${pathname}${settingsEntryQuery(entry)}`}
                      scroll={false}
                      replace
                      onClick={onNavigate}
                      aria-current={entry.id === activeId ? 'page' : undefined}
                      className={link(entry.id === activeId)}
                    >
                      <EntryIcon icon={entry.icon} />
                      {entry.label}
                    </Link>
                  ))
                : null}
            </div>
          );
        })}
        {filtered.length === 0 && <p className="px-3 py-4 text-center text-xs text-slate-500">Không có mục nào khớp.</p>}
      </nav>
    </>
  );
}

function Overview({
  groups,
  pathname,
  auditHref,
}: {
  groups: VisibleGroup[];
  pathname: string;
  auditHref: string | null;
}) {
  const [keyword, setKeyword] = useState('');
  const total = groups.reduce((sum, g) => sum + g.entries.length, 0);
  const shown = useMemo(
    () =>
      groups
        .map((g) => ({ ...g, entries: filterSettingsEntries(g.entries, keyword) }))
        .filter((g) => g.entries.length > 0),
    [groups, keyword],
  );
  return (
    <div className="@container space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">Trung tâm cấu hình HRM</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Quản lý chính sách và danh mục dùng chung cho toàn bộ phân hệ nhân sự.
          </p>
        </div>
        {auditHref && (
          <Link
            href={auditHref}
            scroll={false}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <History aria-hidden="true" className="size-3.5" />
            Lịch sử thay đổi
          </Link>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            aria-label="Tìm nhanh cấu hình"
            placeholder="Tìm nhanh chức năng hoặc chính sách..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-2 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-400"
          />
        </div>
        <span
          data-testid="settings-count"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-800"
        >
          <Settings aria-hidden="true" className="size-3.5" />
          {total} mục cấu hình
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          Không có cấu hình nào khớp.
        </p>
      ) : (
        <div className="grid grid-cols-1 items-start gap-3 @4xl:grid-cols-2">
          {shown.map((group) => {
            const first = group.entries[0];
            return (
              <section
                key={group.id}
                aria-label={group.title}
                data-testid={`settings-group-${group.id}`}
                className="min-w-0 rounded-xl border border-slate-200 bg-white p-4"
              >
                <Link
                  href={`${pathname}${settingsEntryQuery(first)}`}
                  scroll={false}
                  className="mb-2 flex items-center gap-3"
                >
                  <IconTile icon={ICONS[group.icon]} tone={GROUP_TONE[group.id] ?? 'slate'} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-slate-900">{group.title}</span>
                    <span className="block text-[11px] leading-snug text-slate-500">{group.description}</span>
                  </span>
                  <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-slate-400" />
                </Link>
                <ul className="space-y-1">
                  {group.entries.map((entry) => (
                    <li key={entry.id}>
                      <Link
                        href={`${pathname}${settingsEntryQuery(entry)}`}
                        scroll={false}
                        className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2 transition-colors hover:border-blue-200 hover:bg-blue-50/40"
                      >
                        <IconTile icon={ICONS[entry.icon]} tone="slate" size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-semibold text-slate-900">{entry.label}</span>
                          <span className="block truncate text-[11px] text-slate-500">{entry.description}</span>
                        </span>
                        <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-slate-400" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CenterInner({ screens }: { screens: Record<string, ComponentType> }) {
  const pathname = usePathname() ?? '/settings';
  const searchParams = useSearchParams();
  const { any, can } = useHrmPermissions();
  const [menuOpen, setMenuOpen] = useState(false);
  // Màn rộng (>= xl) có thanh bên cố định; người dùng có thể ẩn để nhường chỗ cho nội dung (nhớ lựa chọn).
  const [navHidden, setNavHidden] = useState(false);
  useEffect(() => {
    try {
      setNavHidden(localStorage.getItem(HIDE_KEY) === 'true');
    } catch {
      /* không có localStorage thì giữ mặc định */
    }
  }, []);
  const changeNavHidden = (next: boolean) => {
    setNavHidden(next);
    try {
      localStorage.setItem(HIDE_KEY, String(next));
    } catch {
      /* bỏ qua */
    }
  };

  const groups = useMemo<VisibleGroup[]>(() => {
    const viewAllowed = (view: string) =>
      HRM_HUBS['/settings'].some((tab) => tab.id === view && any(tab.permissions)) && Boolean(screens[view]);
    return SETTINGS_GROUPS.map((g) => ({
      ...g,
      entries: g.entries.filter(
        (e) => viewAllowed(e.view) && (!e.permissions || e.permissions.some((p) => can(p))),
      ),
    })).filter((g) => g.entries.length > 0);
  }, [any, can, screens]);

  const entries = useMemo(() => groups.flatMap((g) => g.entries), [groups]);
  const active = resolveSettingsEntry(entries, searchParams?.get('view') ?? null, searchParams?.get('tab') ?? null);
  const activeGroup = active ? groups.find((g) => g.entries.some((e) => e.id === active.id)) : undefined;
  // Breadcrumb của khung: Nhân sự › Cấu hình › <nhóm> › <mục>.
  useHrmCrumbs(active && activeGroup ? [activeGroup.navLabel, active.label] : []);
  if (entries.length === 0) return null;
  const Screen = active ? screens[active.view] : null;
  const auditHref = entries.some((e) => e.view === 'operations') ? `${pathname}?view=operations&tab=audit` : null;

  return (
    <div className="flex items-start gap-4">
      {!navHidden && (
        <aside
          aria-label="Danh mục cấu hình"
          className="hidden w-60 shrink-0 self-start rounded-xl border border-slate-200 bg-white p-3 xl:sticky xl:top-0 xl:block xl:max-h-[calc(100dvh-7rem)] xl:overflow-y-auto"
        >
          <div className="flex items-start justify-between gap-2 px-2 pb-3">
            <div className="min-w-0">
              <h2 className="text-base font-bold tracking-tight text-slate-900">Cấu hình HRM</h2>
              <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                Quản lý chính sách, danh mục và các quy trình dùng chung cho hệ thống nhân sự.
              </p>
            </div>
            <button
              type="button"
              aria-label="Ẩn danh mục cấu hình"
              title="Ẩn danh mục để có thêm chỗ cho nội dung"
              onClick={() => changeNavHidden(true)}
              className="mt-0.5 shrink-0 cursor-pointer rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <PanelLeftClose aria-hidden="true" className="size-4" />
            </button>
          </div>
          <SettingsNav groups={groups} activeId={active?.id} pathname={pathname} />
        </aside>
      )}
      <div className="min-w-0 flex-1 space-y-3">
        <div
          data-testid="settings-menu-bar"
          className={`flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 ${navHidden ? '' : 'xl:hidden'}`}
        >
          <Button variant="outline" size="sm" aria-label="Mở danh mục cấu hình" onClick={() => setMenuOpen(true)}>
            <Menu aria-hidden="true" className="size-4" />
            <span>Danh mục</span>
          </Button>
          <p className="min-w-0 flex-1 truncate text-xs text-slate-500">
            {active && activeGroup ? (
              <>
                {activeGroup.navLabel} <span aria-hidden="true">›</span>{' '}
                <strong className="font-semibold text-slate-800">{active.label}</strong>
              </>
            ) : (
              <strong className="font-semibold text-slate-800">Tổng quan cấu hình</strong>
            )}
          </p>
          {navHidden && (
            <button
              type="button"
              aria-label="Hiện danh mục cấu hình"
              title="Hiện lại danh mục ở bên trái"
              onClick={() => changeNavHidden(false)}
              className="hidden shrink-0 cursor-pointer rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 xl:block"
            >
              <PanelLeftOpen aria-hidden="true" className="size-4" />
            </button>
          )}
        </div>
        {Screen && active ? (
          <SettingsEmbeddedContext.Provider value>
            <div key={`${active.view}:${active.tab ?? ''}`}>
              <Screen />
            </div>
          </SettingsEmbeddedContext.Provider>
        ) : (
          <Overview groups={groups} pathname={pathname} auditHref={auditHref} />
        )}
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent className="flex h-full max-h-screen w-full flex-col overflow-hidden bg-white p-0 sm:max-w-[360px]">
          <SheetHeader className="shrink-0 border-b border-slate-200">
            <SheetTitle>Cấu hình HRM</SheetTitle>
            <SheetDescription>Chọn mục cấu hình cần mở.</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <SettingsNav groups={groups} activeId={active?.id} pathname={pathname} onNavigate={() => setMenuOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/**
 * Trung tâm cấu hình HRM: thanh bên liệt kê các mục cấu hình theo nhóm chức năng, bên phải là trang tổng quan (thẻ theo nhóm)
 * hoặc màn hình của mục đang mở. Mục nào người dùng không có quyền thì ẩn. Màn hình con không đổi logic.
 * Màn hẹp (< xl) thay thanh bên bằng nút "Danh mục" mở ngăn kéo; breadcrumb của khung hiện nhóm và mục đang mở.
 */
export function SettingsCenter({ screens }: { screens: Record<string, ComponentType> }) {
  return (
    <Suspense fallback={null}>
      <CenterInner screens={screens} />
    </Suspense>
  );
}
