'use client';

import { useEffect } from 'react';
import type { TaskActionResultDto, TaskActionType, UniversalTaskDto } from '@enterprise-platform/contracts-task-approval';
import { TaskSummaryView } from './components/task-summary-view';
import { TaskAttributesView } from './components/task-attributes-view';
import { TaskTableView } from './components/task-table-view';
import { TaskAttachmentsView } from './components/task-attachments-view';
import { TaskTimelineView } from './components/task-timeline-view';
import { TaskActionFooter } from './components/task-action-footer';
import { useUniversalTaskDrawer } from './use-universal-task-drawer';
import styles from './universal-task-drawer.module.scss';

export interface UniversalTaskDrawerProps {
  /** ID của tác vụ cần xem/duyệt */
  taskId?: string | null;

  /** Dữ liệu task truyền sẵn (nếu có) */
  task?: UniversalTaskDto | null;

  /** Trạng thái mở/đóng của Drawer */
  open: boolean;

  /** Hàm đóng Drawer */
  onClose: () => void;

  /** Callback khi thực thi hành động duyệt/từ chối thành công */
  onActionCompleted?: (result: TaskActionResultDto) => void;

  /** Tùy chọn hàm thực thi hành động trực tiếp thay thế REST API mặc định */
  onExecuteAction?: (
    task: UniversalTaskDto,
    action: TaskActionType,
    reason?: string,
  ) => Promise<TaskActionResultDto>;
}

/**
 * Universal Task Drawer - Ngăn kéo xem và phê duyệt công việc đa phân hệ
 * (HRM, Kho, Bảo trì, Quy trình) đặt tại Core Dashboard.
 */
export function UniversalTaskDrawer({
  taskId,
  task: initialTask,
  open,
  onClose,
  onActionCompleted,
  onExecuteAction,
}: UniversalTaskDrawerProps) {
  const {
    task,
    loading,
    submitting,
    error,
    executeAction,
  } = useUniversalTaskDrawer({
    taskId,
    initialTask,
    open,
    onClose,
    onActionCompleted: (result) => {
      if (onActionCompleted) onActionCompleted(result);
      onClose();
    },
    onExecuteAction,
  });

  // Hỗ trợ phím tắt Esc để đóng Drawer
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Lớp nền mờ (Backdrop overlay) */}
      <div className={styles.backdrop} onClick={onClose} aria-hidden />

      {/* Ngăn kéo trượt từ phải sang (Panel) */}
      <aside
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Chi tiết tác vụ phê duyệt"
      >
        {/* Header Drawer */}
        <header className={styles.header}>
          <div className={styles.headerTitleBox}>
            <div className={styles.headerBadgeRow}>
              {task?.sourceModule && (
                <span className={styles.moduleTag}>
                  {task.sourceModule}
                </span>
              )}
              {task?.code && (
                <span className={styles.codeTag}>
                  {task.code}
                </span>
              )}
              {task?.createdOnBehalf && (
                <span className={styles.proxyBadge}>
                  Đơn tạo hộ
                </span>
              )}
              {task?.status === 'APPROVED' ? (
                <span className="shrink-0 rounded-sm bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                  Đã phê duyệt
                </span>
              ) : task?.status === 'REJECTED' ? (
                <span className="shrink-0 rounded-sm bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-600/20">
                  Đã từ chối
                </span>
              ) : task?.status === 'CANCELLED' ? (
                <span className="shrink-0 rounded-sm bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 ring-1 ring-inset ring-slate-600/20">
                  Đã hủy
                </span>
              ) : null}
              {task?.priority && task.priority !== 'NORMAL' && (
                <span
                  className={styles.moduleTag}
                  style={{
                    background: task.priority === 'URGENT' ? '#fee2e2' : '#fef3c7',
                    color: task.priority === 'URGENT' ? '#dc2626' : '#d97706',
                  }}
                >
                  {task.priority === 'URGENT' ? 'Khẩn cấp' : 'Ưu tiên cao'}
                </span>
              )}
            </div>
            <h3 className={styles.title} title={task?.title || 'Tác vụ phê duyệt'}>
              {task?.title || (loading ? 'Đang tải tác vụ…' : 'Chi tiết công việc')}
            </h3>
          </div>

          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Đóng ngăn kéo (Esc)"
            title="Đóng (Esc)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        {/* Thân Drawer (Scrollable Body) */}
        <div className={styles.body}>
          {error && <div className={styles.errorBanner}>{error}</div>}

          {loading ? (
            <div className={styles.loadingPlaceholder}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              <span>Đang tải thông tin chi tiết…</span>
            </div>
          ) : task ? (
            <>
              {/* Thẻ người nộp đơn / yêu cầu */}
              {task.requester && (
                <div className={styles.requesterCardWrapper}>
                  <div className={styles.requesterCard}>
                    <div className={styles.requesterAvatar}>
                      {task.requester.fullName ? task.requester.fullName.charAt(0).toUpperCase() : 'U'}
                    </div>
                    <div className={styles.requesterInfo}>
                      <div className="flex items-center gap-1.5">
                        <span className={styles.requesterName}>{task.requester.fullName}</span>
                        {task.createdOnBehalf && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-normal text-slate-600">
                            Chủ thể đơn
                          </span>
                        )}
                      </div>
                      <span className={styles.requesterMeta}>
                        {[task.requester.positionName, task.requester.departmentName].filter(Boolean).join(' · ') || task.requester.email || '—'}
                      </span>
                    </div>
                  </div>

                  {task.createdOnBehalf && (
                    <div className={styles.proxyBanner}>
                      <div className={styles.proxyBannerHeader}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                        <span>
                          Người tạo hộ: <strong>{task.submitter?.fullName || 'Người được uỷ quyền'}</strong>
                        </span>
                      </div>
                      {task.onBehalfReason && (
                        <div className={styles.proxyReason}>
                          <span>Lý do tạo hộ:</span> &ldquo;{task.onBehalfReason}&rdquo;
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Khối 1: Tóm tắt thông tin */}
              {task.blocks?.summary && <TaskSummaryView block={task.blocks.summary} />}

              {/* Khối 2: Thuộc tính chi tiết */}
              {task.blocks?.attributes && <TaskAttributesView block={task.blocks.attributes} />}

              {/* Khối 3: Bảng kê danh mục (Nhà kho / Mua sắm) */}
              {task.blocks?.table && (
                <TaskTableView block={task.blocks.table} detailUrl={task.detailUrl} />
              )}

              {/* Khối 4: Tài liệu đính kèm */}
              {task.blocks?.attachments && <TaskAttachmentsView block={task.blocks.attachments} />}

              {/* Khối 5: Stepper tiến trình phê duyệt */}
              {task.blocks?.timeline && <TaskTimelineView block={task.blocks.timeline} />}
            </>
          ) : null}
        </div>

        {/* Footer hành động (Cố định ở đáy) */}
        {task && (
          <TaskActionFooter
            task={task}
            onSubmit={executeAction}
            isSubmitting={submitting}
          />
        )}
      </aside>
    </>
  );
}
