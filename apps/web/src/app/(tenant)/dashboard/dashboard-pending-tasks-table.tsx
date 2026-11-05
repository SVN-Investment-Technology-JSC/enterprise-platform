'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { UniversalTaskDto } from '@enterprise-platform/contracts-task-approval';
import { openTaskDrawer } from './dashboard-task-drawer-host';

export interface DashboardPendingTasksTableProps {
  tasks: UniversalTaskDto[];
  total: number;
  viewAllHref: string;
  viewAllLabel?: string;
}

const VN_DATE = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Ho_Chi_Minh',
});

function formatCreatedAt(dateStr?: string): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return Number.isNaN(d.getTime()) ? '—' : VN_DATE.format(d);
  } catch {
    return '—';
  }
}

export function DashboardPendingTasksTable({
  tasks: initialTasks,
  total: initialTotal,
  viewAllHref,
  viewAllLabel,
}: DashboardPendingTasksTableProps) {
  const [tasks, setTasks] = useState<UniversalTaskDto[]>(initialTasks);
  const [total, setTotal] = useState<number>(initialTotal);

  const fetchPending = useCallback(async () => {
    try {
      const res = await fetch('/api/hrm/v1/tasks/pending?limit=5', {
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.data)) {
          setTasks(json.data);
          setTotal(json.total ?? json.data.length);
        }
      }
    } catch {
      // Bỏ qua lỗi mạng
    }
  }, []);

  useEffect(() => {
    setTasks(initialTasks);
    setTotal(initialTotal);
    if (initialTasks.length === 0) {
      void fetchPending();
    }
  }, [initialTasks, initialTotal, fetchPending]);

  // Lắng nghe khi có hành động duyệt/từ chối hoàn thành từ Drawer để tự động cập nhật
  useEffect(() => {
    const handleActionCompleted = (e: Event) => {
      const customEvent = e as CustomEvent<{ taskId?: string }>;
      const actedTaskId = customEvent.detail?.taskId;
      if (actedTaskId) {
        setTasks((prev) => prev.filter((t) => t.taskId !== actedTaskId));
        setTotal((prev) => Math.max(0, prev - 1));
      }
      void fetchPending();
    };
    window.addEventListener('ep:task-action-completed', handleActionCompleted);
    return () => {
      window.removeEventListener('ep:task-action-completed', handleActionCompleted);
    };
  }, [fetchPending]);

  // Khôi phục đồng bộ khi người dùng bấm nút Quay lại từ phân hệ khác (BFCache)
  useEffect(() => {
    const handlePageShow = () => {
      void fetchPending();
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [fetchPending]);

  if (tasks.length === 0) {
    return (
      <div className="px-5 py-6 text-center">
        <p className="m-0 text-[14px] text-slate-500">
          Không có đơn từ nào chờ bạn duyệt.
        </p>
        <div className="mt-2">
          <a
            href={viewAllHref}
            className="text-[13px] font-semibold text-blue-700 hover:text-blue-800"
          >
            Mở trang Quản lý đơn từ trong Nhân sự
          </a>
        </div>
      </div>
    );
  }

  const columns = '22px minmax(220px,1.2fr) minmax(180px,1fr) 130px 110px 100px';

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[760px] py-1">
        <div
          className="grid items-center gap-x-3 px-5 py-2 text-[12px] font-semibold tracking-[0.4px] text-slate-500"
          style={{ gridTemplateColumns: columns }}
        >
          <span />
          <span>TIÊU ĐỀ ĐƠN</span>
          <span>NGƯỜI NỘP</span>
          <span>NGÀY NỘP</span>
          <span>TRẠNG THÁI</span>
          <span className="text-right">THAO TÁC</span>
        </div>

        {tasks.map((task) => {
          const isUrgent = task.priority === 'URGENT';
          const isHigh = task.priority === 'HIGH';
          const dotClass = isUrgent
            ? 'bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,.12)]'
            : isHigh
            ? 'bg-amber-500 shadow-[0_0_0_4px_rgba(245,158,11,.12)]'
            : 'bg-emerald-500';

          return (
            <div
              key={task.taskId}
              role="button"
              tabIndex={0}
              onClick={() => openTaskDrawer(task.taskId, task)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openTaskDrawer(task.taskId, task);
                }
              }}
              className="grid cursor-pointer items-center gap-x-3 border-t border-[#f1f3f6] px-5 py-[11px] text-[14px] text-[#18181b] transition-colors hover:bg-[#f4f6f9]"
              style={{ gridTemplateColumns: columns }}
            >
              <span aria-hidden className={`size-2.5 rounded-full ${dotClass}`} />

              <div className="min-w-0 pr-2">
                <div className="flex items-center gap-1.5 truncate font-medium text-slate-900" title={task.title}>
                  <span className="truncate">{task.title}</span>
                  {task.createdOnBehalf ? (
                    <span className="shrink-0 rounded-sm bg-purple-50 px-1.5 py-0.2 text-[10.5px] font-semibold text-purple-700 ring-1 ring-inset ring-purple-600/20">
                      Tạo hộ
                    </span>
                  ) : null}
                </div>
                {task.code ? (
                  <div className="truncate text-[12px] text-slate-500" title={task.code}>
                    {task.code}
                  </div>
                ) : null}
              </div>

              <div className="min-w-0 pr-2">
                <div
                  className="truncate text-[13px] font-medium text-slate-800"
                  title={task.requester?.fullName}
                >
                  {task.requester?.fullName || '—'}
                </div>
                {task.createdOnBehalf && task.submitter?.fullName ? (
                  <div
                    className="truncate text-[11px] font-medium text-purple-600"
                    title={`Tạo hộ bởi: ${task.submitter.fullName}${task.onBehalfReason ? ` (${task.onBehalfReason})` : ''}`}
                  >
                    Tạo hộ bởi: {task.submitter.fullName}
                  </div>
                ) : task.requester?.departmentName ? (
                  <div className="truncate text-[12px] text-slate-500" title={task.requester.departmentName}>
                    {task.requester.departmentName}
                  </div>
                ) : null}
              </div>

              <span className="text-[13px] tabular-nums text-slate-600">
                {formatCreatedAt(task.createdAt)}
              </span>

              <span>
                <span className="whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                  Chờ duyệt
                </span>
              </span>

              <div className="text-right">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openTaskDrawer(task.taskId, task);
                  }}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[13px] font-semibold text-blue-700 shadow-xs transition hover:bg-slate-50 hover:text-blue-800"
                >
                  Xử lý
                </button>
              </div>
            </div>
          );
        })}

        {total > tasks.length ? (
          <div className="border-t border-[#f1f3f6] px-5 py-2.5 text-[14px]">
            <a href={viewAllHref} className="font-semibold text-blue-700 hover:text-blue-800">
              {viewAllLabel || `Xem đủ ${total} đơn trong Nhân sự`}
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}
