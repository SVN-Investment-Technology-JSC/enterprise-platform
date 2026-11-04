'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GitFork } from 'lucide-react';
import { CollapsibleGroup } from '../collapsible-group';
import { openTaskDrawer } from './dashboard-task-drawer-host';

export interface DashboardProcedureItem {
  id: string;
  code: string;
  title: string;
  definitionName?: string;
  currentStepName?: string;
}

export interface DashboardPendingProcedureSectionProps {
  initialItems: DashboardProcedureItem[];
  initialTotal: number;
  viewAllHref: string;
}

/**
 * Khối hiển thị các hồ sơ Quy trình chờ xử lý trên Bàn làm việc (Dashboard).
 * Quản lý đồng bộ số lượng count hiển thị trên Badge tiêu đề và danh sách:
 * - Khi xử lý thành công trong UniversalTaskDrawer: cập nhật tức thì (optimistic) count và danh sách.
 * - Khi quay lại bằng nút Back trình duyệt (BFCache): tự động làm mới qua pageshow.
 */
export function DashboardPendingProcedureSection({
  initialItems,
  initialTotal,
  viewAllHref,
}: DashboardPendingProcedureSectionProps) {
  const router = useRouter();
  const [items, setItems] = useState<DashboardProcedureItem[]>(initialItems);
  const [total, setTotal] = useState<number>(initialTotal);

  const fetchPending = useCallback(async () => {
    try {
      const res = await fetch('/api/procedure/v1/workspace', {
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (res.ok) {
        const json = await res.json();
        const instances = json.instances || [];
        const actionable = instances.filter(
          (item: any) =>
            item.status === 'running' &&
            item.authorization?.availableActions?.some((a: string) => a !== 'comment'),
        );
        const mapped: DashboardProcedureItem[] = actionable.map((item: any) => {
          const currentStep = item.steps?.find((s: any) => s.id === item.currentStepId);
          return {
            id: item.id,
            code: item.code,
            title: item.title,
            definitionName: item.definitionName,
            currentStepName: currentStep?.name,
          };
        });
        setItems(mapped.slice(0, 5));
        setTotal(actionable.length);
      }
    } catch {
      // Bỏ qua lỗi mạng
    }
  }, []);

  useEffect(() => {
    setItems(initialItems);
    setTotal(initialTotal);
  }, [initialItems, initialTotal]);

  // Lắng nghe sự kiện xử lý hoàn thành từ Universal Task Drawer
  useEffect(() => {
    const handleActionCompleted = (e: Event) => {
      const customEvent = e as CustomEvent<{ taskId?: string }>;
      const actedTaskId = customEvent.detail?.taskId;
      if (actedTaskId) {
        setItems((prev) =>
          prev.filter(
            (item) =>
              item.id !== actedTaskId &&
              `procedure:${item.id}` !== actedTaskId &&
              actedTaskId !== `procedure:${item.id}`,
          ),
        );
        setTotal((prev) => Math.max(0, prev - 1));
      }
      void fetchPending();
      router.refresh();
    };

    window.addEventListener('ep:task-action-completed', handleActionCompleted);
    return () => {
      window.removeEventListener('ep:task-action-completed', handleActionCompleted);
    };
  }, [fetchPending, router]);

  // Khôi phục đồng bộ khi người dùng bấm nút Quay lại từ phân hệ khác (BFCache)
  useEffect(() => {
    const handlePageShow = () => {
      void fetchPending();
      router.refresh();
    };

    window.addEventListener('pageshow', handlePageShow);
    return () => {
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [fetchPending, router]);

  const columns = '22px minmax(200px,1.2fr) 150px 140px 160px 100px 90px';

  return (
    <CollapsibleGroup
      title="Hồ sơ cần bạn xử lý"
      count={total}
      tone="bg-violet-100 text-violet-700"
      icon={<GitFork className="size-4" />}
    >
      {items.length > 0 ? (
        <div className="overflow-x-auto">
          <div className="min-w-[760px] py-1">
            <div
              className="grid items-center gap-x-3 px-5 py-2 text-[12px] font-semibold tracking-[0.4px] text-slate-500"
              style={{ gridTemplateColumns: columns }}
            >
              <span />
              <span>HỒ SƠ</span>
              <span>MÃ HỒ SƠ</span>
              <span>QUY TRÌNH</span>
              <span>BƯỚC HIỆN TẠI</span>
              <span>TRẠNG THÁI</span>
              <span className="text-right">THAO TÁC</span>
            </div>

            {items.map((item) => (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => openTaskDrawer(`procedure:${item.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openTaskDrawer(`procedure:${item.id}`);
                  }
                }}
                className="grid cursor-pointer items-center gap-x-3 border-t border-[#f1f3f6] px-5 py-[11px] text-[14px] text-[#18181b] transition-colors hover:bg-[#f4f6f9]"
                style={{ gridTemplateColumns: columns }}
              >
                <span aria-hidden className="size-2.5 rounded-full bg-amber-500 shadow-[0_0_0_4px_rgba(245,158,11,.12)]" />
                <span className="truncate font-medium text-slate-900" title={item.title}>
                  {item.title}
                </span>
                <span className="truncate text-[13px] tabular-nums text-slate-600" title={item.code}>
                  {item.code || '—'}
                </span>
                <span className="truncate text-[13px] text-slate-700">
                  {item.definitionName ? (
                    <span className="rounded-md bg-violet-50 px-2 py-0.5 text-violet-800">
                      {item.definitionName}
                    </span>
                  ) : (
                    '—'
                  )}
                </span>
                <span className="truncate text-[13px] text-slate-700" title={item.currentStepName}>
                  {item.currentStepName ?? '—'}
                </span>
                <span>
                  <span className="whitespace-nowrap rounded-full bg-[#fff6d6] px-2.5 py-0.5 text-xs font-semibold text-[#8a6400]">
                    Cần xử lý
                  </span>
                </span>
                <div className="text-right">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openTaskDrawer(`procedure:${item.id}`);
                    }}
                    className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[13px] font-semibold text-blue-700 shadow-xs transition hover:bg-slate-50 hover:text-blue-800"
                  >
                    Xử lý
                  </button>
                </div>
              </div>
            ))}

            {total > items.length ? (
              <div className="border-t border-[#f1f3f6] px-5 py-2.5 text-[14px]">
                <a href={viewAllHref} className="font-semibold text-blue-700 hover:text-blue-800">
                  Xem đủ {total} hồ sơ trong Quy trình
                </a>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="m-0 px-5 py-[18px] text-center text-[14px] text-slate-500">
          Không có hồ sơ nào chờ bạn thao tác.
        </p>
      )}
    </CollapsibleGroup>
  );
}
