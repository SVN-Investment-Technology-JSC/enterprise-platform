'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  type ExecuteTaskActionDto,
  type TaskActionResultDto,
  type TaskActionType,
  type UniversalTaskDto,
  resolveTaskApiEndpoint,
} from '@enterprise-platform/contracts-task-approval';
import { authFetch } from '@enterprise-platform/shared-ui';

export { resolveTaskApiEndpoint };

export interface UseUniversalTaskDrawerProps {
  taskId?: string | null;
  initialTask?: UniversalTaskDto | null;
  open: boolean;
  onClose: () => void;
  onActionCompleted?: (result: TaskActionResultDto) => void;
  /** Tùy chọn hàm thực thi hành động trực tiếp thay thế REST API mặc định */
  onExecuteAction?: (
    task: UniversalTaskDto,
    action: TaskActionType,
    reason?: string,
  ) => Promise<TaskActionResultDto>;
}

export function useUniversalTaskDrawer({
  taskId,
  initialTask,
  open,
  onActionCompleted,
  onExecuteAction,
}: UseUniversalTaskDrawerProps) {
  const [task, setTask] = useState<UniversalTaskDto | null>(initialTask || null);
  const [loading, setLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Nạp dữ liệu chi tiết Task
  const loadTask = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    setError(null);

    try {
      const url = resolveTaskApiEndpoint(taskId);
      const res = await authFetch(url, {
        cache: 'no-store',
      });

      if (!res.ok) {
        if (res.status === 404) {
          setError('Không tìm thấy tác vụ này hoặc đơn đã bị hủy trước đó.');
          return;
        }
        if (res.status === 403) {
          setError('Bạn không có quyền xem hoặc duyệt tác vụ này.');
          return;
        }
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message || `Lỗi tải tác vụ (Mã ${res.status})`);
        return;
      }

      const body = (await res.json()) as { data?: UniversalTaskDto } | UniversalTaskDto;
      const data = (body && typeof body === 'object' && 'data' in body && body.data ? body.data : body) as UniversalTaskDto;
      setTask(data);
    } catch (e: unknown) {
      setError((e as Error).message || 'Không thể kết nối đến máy chủ.');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    if (open) {
      if (initialTask) {
        setTask(initialTask);
      } else if (taskId) {
        void loadTask();
      }
    } else {
      setError(null);
    }
  }, [open, taskId, initialTask, loadTask]);

  // Thực thi hành động duyệt / từ chối / trả lại
  const executeAction = useCallback(
    async (action: TaskActionType, reason?: string) => {
      if (!task) return;
      setSubmitting(true);
      setError(null);

      const idempotencyKey =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      const payload: ExecuteTaskActionDto = {
        action,
        reason,
        idempotencyKey,
        expectedVersion: task.version,
      };

      try {
        let result: TaskActionResultDto;

        if (onExecuteAction) {
          result = await onExecuteAction(task, action, reason);
        } else {
          const actionUrl = resolveTaskApiEndpoint(task.taskId, '/actions');
          const res = await authFetch(
            actionUrl,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            },
          );

          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as {
              error?: string;
              message?: string;
            };
            const errCode = body.error;

            if (errCode === 'PROCEDURE_IN_PROGRESS') {
              setError(
                'Đơn này đã được chuyển sang Quy trình phê duyệt (PE). Vui lòng xử lý qua luồng Quy trình.',
              );
              void loadTask();
              return;
            }

            if (
              errCode === 'HRM_REQUEST_NOT_PENDING' ||
              errCode === 'TASK_NOT_PENDING'
            ) {
              setError(
                'Đơn này đã được xử lý bởi người khác hoặc đã bị hủy trước đó.',
              );
              void loadTask();
              return;
            }

            if (errCode === 'SELF_APPROVAL_FORBIDDEN') {
              setError('Quy định không cho phép bạn tự duyệt đơn của chính mình.');
              return;
            }

            if (errCode === 'APPROVAL_OUT_OF_SCOPE') {
              setError('Đơn này không nằm trong phạm vi phê duyệt của bạn.');
              return;
            }

            setError(
              body.message ||
                `Không thể thực hiện hành động (Mã lỗi ${res.status}).`,
            );
            return;
          }

          const body = (await res.json().catch(() => ({}))) as { data?: TaskActionResultDto } | TaskActionResultDto;
          result = (body && typeof body === 'object' && 'data' in body && body.data ? body.data : body) as TaskActionResultDto;
        }

        if (onActionCompleted) {
          onActionCompleted(result);
        }
      } catch (e: unknown) {
        const errObj = e as {
          response?: { data?: { error?: string; message?: string } };
          code?: string;
          message?: string;
        };
        const errCode = errObj?.response?.data?.error || errObj?.code;

        if (errCode === 'PROCEDURE_IN_PROGRESS') {
          setError(
            'Đơn này đã được chuyển sang Quy trình phê duyệt (PE). Vui lòng xử lý qua luồng Quy trình.',
          );
          void loadTask();
          return;
        }

        if (
          errCode === 'HRM_REQUEST_NOT_PENDING' ||
          errCode === 'TASK_NOT_PENDING'
        ) {
          setError(
            'Đơn này đã được xử lý bởi người khác hoặc đã bị hủy trước đó.',
          );
          void loadTask();
          return;
        }

        if (errCode === 'SELF_APPROVAL_FORBIDDEN') {
          setError('Quy định không cho phép bạn tự duyệt đơn của chính mình.');
          return;
        }

        if (errCode === 'APPROVAL_OUT_OF_SCOPE') {
          setError('Đơn này không nằm trong phạm vi phê duyệt của bạn.');
          return;
        }

        setError(
          errObj?.message || 'Có lỗi kết nối mạng khi gửi hành động.',
        );
      } finally {
        setSubmitting(false);
      }
    },
    [task, loadTask, onActionCompleted, onExecuteAction],
  );

  return {
    task,
    loading,
    submitting,
    error,
    reloadTask: loadTask,
    executeAction,
  };
}
