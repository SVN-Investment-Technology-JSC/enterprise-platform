'use client';

import { useEffect, useState } from 'react';
import * as api from '../shared-api';
import styles from '../shared.module.scss';
import { Dialog } from './dialog';

/** Một việc cần người dùng xác nhận trước khi chạy: xoá, xoá vĩnh viễn, lưu trữ. */
export interface ConfirmRequest {
  readonly title: string;
  readonly message: string;
  /** Dòng phụ: số lượng và dung lượng đi kèm. */
  readonly detail?: string;
  readonly confirmLabel: string;
  readonly pendingLabel?: string;
  readonly danger?: boolean;
  /** Ném lỗi để hộp thoại hiện lỗi và ở lại; xong thì hộp thoại tự đóng. */
  readonly onConfirm: () => Promise<void>;
}

export interface ConfirmDialogProps {
  readonly request?: ConfirmRequest;
  readonly onClose: () => void;
}

export function ConfirmDialog({ request, onClose }: ConfirmDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setSubmitting(false);
    setError(undefined);
  }, [request]);

  if (!request) return null;

  const run = async () => {
    setSubmitting(true);
    setError(undefined);
    try {
      await request.onConfirm();
      onClose();
    } catch (cause) {
      setError(api.errorMessage(cause, 'Không thực hiện được.'));
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      title={request.title}
      submitLabel={request.confirmLabel}
      submittingLabel={request.pendingLabel ?? 'Đang xử lý…'}
      danger={request.danger}
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void run()}
    >
      <p className={styles.confirmText}>{request.message}</p>
      {request.detail ? <p className={styles.confirmDetail}>{request.detail}</p> : null}
    </Dialog>
  );
}
