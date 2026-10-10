'use client';

import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  NAV_COLLAPSED_STORAGE_KEY,
  sectionContainsNav,
  type NavSection,
} from '../hrm-navigation';
import { cn } from '../utils';

function readCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(NAV_COLLAPSED_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeCollapsed(value: Record<string, boolean>) {
  try {
    localStorage.setItem(NAV_COLLAPSED_STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* bỏ qua: không lưu được trạng thái thu gọn */
  }
}

/**
 * Menu bên trái: mỗi nhóm thu gọn/mở rộng được, nhóm chứa trang hiện tại luôn mở,
 * trạng thái thu gọn được nhớ trong localStorage. Khi thanh menu thu hẹp thành cột biểu tượng
 * thì hiển thị phẳng, ngăn cách các nhóm bằng đường kẻ.
 */
export function HrmSidebarNav({
  sections,
  activeNavId,
  railCollapsed,
}: {
  sections: readonly NavSection[];
  activeNavId: string | null;
  railCollapsed: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setCollapsed(readCollapsed());
  }, []);

  // Điều hướng tới một trang trong nhóm đang thu gọn thì mở nhóm đó.
  useEffect(() => {
    const active = sections.find((sec) => sectionContainsNav(sec, activeNavId));
    if (!active) return;
    setCollapsed((current) => {
      if (!current[active.title]) return current;
      const next = { ...current, [active.title]: false };
      writeCollapsed(next);
      return next;
    });
  }, [activeNavId, sections]);

  const toggle = useCallback((title: string) => {
    setCollapsed((current) => {
      const next = { ...current, [title]: !current[title] };
      writeCollapsed(next);
      return next;
    });
  }, []);

  return (
    <nav
      aria-label="Điều hướng HRM"
      className={cn('flex-1 overflow-y-auto px-2.5 py-2', railCollapsed && 'px-2 py-3')}
    >
      {sections.map((sec) => {
        const containsActive = sectionContainsNav(sec, activeNavId);
        const open = railCollapsed || containsActive || !collapsed[sec.title];
        const listId = `hrm-nav-${sec.title.replace(/\s+/g, '-')}`;
        return (
          <div key={sec.title} className={cn('mb-1', railCollapsed && 'mb-2')}>
            {railCollapsed ? (
              <div className="mx-1 my-2 h-px bg-white/10" title={sec.title} />
            ) : (
              <button
                type="button"
                aria-expanded={open}
                aria-controls={listId}
                onClick={() => toggle(sec.title)}
                className="flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-1 text-left text-[10.5px] font-bold tracking-wider text-slate-400/80 uppercase outline-none hover:text-slate-200 focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                <span>{sec.title}</span>
                <ChevronDown
                  aria-hidden
                  className={cn('size-3 transition-transform', !open && '-rotate-90')}
                />
              </button>
            )}
            {open ? (
              <ul id={listId} className="mt-0.5 space-y-px">
                {sec.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeNavId === item.id;
                  return (
                    <li key={item.id}>
                      <Link
                        href={item.href ?? '/'}
                        title={item.label}
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          'group flex items-center rounded-lg text-xs font-medium transition-all',
                          railCollapsed
                            ? 'mx-auto size-9 justify-center'
                            : 'gap-2.5 px-2.5 py-1.5',
                          isActive
                            ? railCollapsed
                              ? 'bg-blue-600 text-white shadow-xs'
                              : 'border-l-4 border-white bg-white/15 font-semibold text-white shadow-xs'
                            : 'text-slate-300/80 hover:bg-white/10 hover:text-white',
                        )}
                      >
                        <Icon
                          aria-hidden
                          className={cn(
                            'size-4 shrink-0 transition-colors',
                            isActive ? 'text-white' : 'text-slate-400 group-hover:text-white',
                          )}
                        />
                        {railCollapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
                        {!railCollapsed && item.badge ? (
                          <span className="ml-auto rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] leading-none font-bold text-white">
                            {item.badge}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
