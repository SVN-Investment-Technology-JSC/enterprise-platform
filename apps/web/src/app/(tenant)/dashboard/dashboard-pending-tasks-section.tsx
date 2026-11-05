'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardCheck } from 'lucide-react';
import type { UniversalTaskDto } from '@enterprise-platform/contracts-task-approval';
import { CollapsibleGroup } from '../collapsible-group';
import { DashboardPendingTasksTable } from './dashboard-pending-tasks-table';

export interface DashboardPendingTasksSectionProps {
  initialTasks: UniversalTaskDto[];
  initialTotal: number;
  viewAllHref: string;
}

/**
 * Khối hiển thị các đơn từ chờ duyệt trên Bàn làm việc (Dashboard).
 * Quản lý đồng bộ số lượng count hiển thị trên Badge tiêu đề và bảng tác vụ:
 * - Khi duyệt thành công đơn trong UniversalTaskDrawer: cập nhật tức thì (optimistic) count và danh sách.
 * - Khi quay lại bằng nút Back trình duyệt (BFCache): tự động làm mới qua pageshow.
 */
export function DashboardPendingTasksSection({
  initialTasks,
  initialTotal,
  viewAllHref,
}: DashboardPendingTasksSectionProps) {
  const router = useRouter();
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
  }, [initialTasks, initialTotal]);

  // Lắng nghe khi có hành động duyệt/từ chối từ Drawer
  useEffect(() => {
    const handleActionCompleted = (e: Event) => {
      const customEvent = e as CustomEvent<{ taskId?: string }>;
      const actedTaskId = customEvent.detail?.taskId;
      if (actedTaskId) {
        setTasks((prev) => prev.filter((t) => t.taskId !== actedTaskId));
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

  return (
    <CollapsibleGroup
      title="Đơn từ chờ bạn duyệt"
      count={total}
      tone="bg-emerald-100 text-emerald-700"
      icon={<ClipboardCheck className="size-4" />}
    >
      <DashboardPendingTasksTable
        tasks={tasks}
        total={total}
        viewAllHref={viewAllHref}
        viewAllLabel={`Xem đủ ${total} đơn trong Nhân sự`}
      />
    </CollapsibleGroup>
  );
}
