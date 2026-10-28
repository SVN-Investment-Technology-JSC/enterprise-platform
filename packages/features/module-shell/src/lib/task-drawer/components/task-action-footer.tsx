'use client';

import { useState } from 'react';
import type { TaskActionType, UniversalTaskDto } from '@enterprise-platform/contracts-task-approval';
import styles from '../universal-task-drawer.module.scss';

export interface TaskActionFooterProps {
  task: UniversalTaskDto;
  onSubmit: (action: TaskActionType, reason?: string) => Promise<void>;
  isSubmitting: boolean;
}

export function TaskActionFooter({
  task,
  onSubmit,
  isSubmitting,
}: TaskActionFooterProps) {
  const [activeAction, setActiveAction] = useState<TaskActionType | null>(null);
  const [reason, setReason] = useState('');

  const canConfirm = reason.trim().length > 0;
  const isReject = activeAction === 'REJECT';
  const isReturn = activeAction === 'RETURN';

  const handleConfirmAction = async () => {
    if (!activeAction) return;
    if ((isReject || isReturn) && !canConfirm) return;
    await onSubmit(activeAction, reason.trim() ? reason.trim() : undefined);
    setActiveAction(null);
    setReason('');
  };

  return (
    <footer className={styles.footer}>
      {activeAction ? (
        <div className={styles.reasonBox}>
          <label className={styles.reasonLabel} style={{ color: isReject ? '#be123c' : '#c2410c' }}>
            {isReject
              ? 'Lý do từ chối (Bắt buộc nhập):'
              : 'Lý do yêu cầu bổ sung / chỉnh sửa (Bắt buộc nhập):'}
          </label>
          <textarea
            className={styles.reasonTextarea}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              isReject
                ? 'Ghi rõ căn cứ và lý do từ chối yêu cầu này...'
                : 'Mô tả thông tin hoặc chứng từ cần bổ sung...'
            }
            maxLength={2000}
            rows={3}
            autoFocus
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>
              {reason.trim().length} / 2000 ký tự
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnCancel}`}
                disabled={isSubmitting}
                onClick={() => {
                  setActiveAction(null);
                  setReason('');
                }}
              >
                Hủy
              </button>
              <button
                type="button"
                className={`${styles.btn} ${isReject ? styles.btnReject : styles.btnReturn}`}
                style={{
                  background: isReject ? '#e11d48' : '#ea580c',
                  color: '#ffffff',
                  borderColor: 'transparent',
                }}
                disabled={!canConfirm || isSubmitting}
                onClick={handleConfirmAction}
              >
                {isSubmitting
                  ? 'Đang gửi...'
                  : isReject
                  ? 'Xác nhận Từ chối'
                  : 'Xác nhận Yêu cầu sửa'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.footerBar}>
          <a
            href={task.detailUrl}
            target="_blank"
            rel="noreferrer"
            className={styles.linkDetail}
          >
            Mở toàn màn hình trong module ↗
          </a>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {task.status === 'APPROVED' ? (
              <span className="text-[12px] font-semibold text-emerald-700">
                Đơn đã được phê duyệt
              </span>
            ) : task.status === 'REJECTED' ? (
              <span className="text-[12px] font-semibold text-rose-700">
                Đơn đã bị từ chối
              </span>
            ) : task.status === 'CANCELLED' ? (
              <span className="text-[12px] font-semibold text-slate-600">
                Đơn đã hủy hiệu lực
              </span>
            ) : null}
            {/* Chỉ render các nút có trong task.availableActions */}
            {task.availableActions && task.availableActions.includes('RETURN') && (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnReturn}`}
                disabled={isSubmitting}
                onClick={() => setActiveAction('RETURN')}
              >
                Yêu cầu bổ sung...
              </button>
            )}

            {task.availableActions && task.availableActions.includes('REJECT') && (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnReject}`}
                disabled={isSubmitting}
                onClick={() => setActiveAction('REJECT')}
              >
                Từ chối...
              </button>
            )}

            {task.availableActions && task.availableActions.includes('APPROVE') && (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnApprove}`}
                disabled={isSubmitting}
                onClick={() => void onSubmit('APPROVE')}
              >
                {isSubmitting ? 'Đang duyệt...' : 'Phê duyệt'}
              </button>
            )}
          </div>
        </div>
      )}
    </footer>
  );
}
