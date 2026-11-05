'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TaskActionResultDto, UniversalTaskDto } from '@enterprise-platform/contracts-task-approval';
import { UniversalTaskDrawer, useDashboardTaskDeepLink } from '@enterprise-platform/feature-module-shell';

const OPEN_DRAWER_EVENT = 'ep:open-task-drawer';

/**
 * Hàm tiện ích mở Universal Task Drawer từ bất kỳ đâu trên Dashboard
 */
export function openTaskDrawer(taskId: string, task?: UniversalTaskDto): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(OPEN_DRAWER_EVENT, {
      detail: { taskId, task },
    }),
  );
}

/**
 * Host component quản lý Universal Task Drawer trên Dashboard Core:
 * - Hỗ trợ nạp lười (Dynamic Import).
 * - Tự động mở khi phát hiện deep link URL ?task=<id> hoặc ?request=<id>.
 * - Lắng nghe sự kiện ep:open-task-drawer khi người dùng click vào tác vụ.
 */
export function DashboardTaskDrawerHost() {
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<UniversalTaskDto | null>(null);
  const { deepLinkTaskId, clearDeepLink } = useDashboardTaskDeepLink();

  // Mở khi có Deep Link từ NotificationBell hoặc tin nhắn chat
  useEffect(() => {
    if (deepLinkTaskId) {
      setActiveTaskId(deepLinkTaskId);
      setActiveTask(null);
    }
  }, [deepLinkTaskId]);

  // Lắng nghe sự kiện mở drawer theo yêu cầu từ các thẻ Dashboard
  useEffect(() => {
    const handleOpen = (e: Event) => {
      const customEvent = e as CustomEvent<{ taskId?: string; task?: UniversalTaskDto }>;
      if (customEvent.detail?.taskId) {
        setActiveTaskId(customEvent.detail.taskId);
        setActiveTask(customEvent.detail.task || null);
      }
    };

    window.addEventListener(OPEN_DRAWER_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_DRAWER_EVENT, handleOpen);
  }, []);

  const handleClose = useCallback(() => {
    setActiveTaskId(null);
    setActiveTask(null);
    clearDeepLink();
  }, [clearDeepLink]);

  const handleActionCompleted = useCallback((result: TaskActionResultDto) => {
    // Tự động làm mới dữ liệu Dashboard nếu cần
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('ep:task-action-completed', {
          detail: { taskId: result.taskId },
        }),
      );
    }
  }, []);

  // Khi người dùng bấm nút Quay lại của trình duyệt từ phân hệ khác (BFCache khôi phục trang)
  useEffect(() => {
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        setActiveTaskId(null);
        setActiveTask(null);
        clearDeepLink();
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, [clearDeepLink]);

  if (!activeTaskId && !activeTask) return null;

  return (
    <UniversalTaskDrawer
      taskId={activeTaskId}
      task={activeTask}
      open={Boolean(activeTaskId || activeTask)}
      onClose={handleClose}
      onActionCompleted={handleActionCompleted}
    />
  );
}
