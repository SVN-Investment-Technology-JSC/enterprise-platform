'use client';

import type { StandaloneTask } from '@enterprise-platform/contracts-workspace';
import { useEffect, useState } from 'react';
import styles from '../workspace.module.scss';
import { Dialog, Field } from './dialog';

export interface ReverseStandaloneTaskDialogProps {
  readonly task?: StandaloneTask;
  readonly onClose: () => void;
  /** Ném lỗi ra để hộp thoại hiện ngay, ví dụ khi Quy trình chặn huỷ hồ sơ. */
  readonly onConfirm: (task: StandaloneTask, reason: string, createAdjustment: boolean) => Promise<void>;
}

/**
 * Xác nhận huỷ hiệu lực việc ngoài dự án đã hoàn thành.
 *
 * Dùng hộp thoại thay cho Popconfirm vì có thêm lựa chọn lập công việc điều
 * chỉnh — cùng cách làm với công việc dự án (`ReverseWorkItemDialog`).
 */
export function ReverseStandaloneTaskDialog({ task, onClose, onConfirm }: ReverseStandaloneTaskDialogProps) {
  const [reason, setReason] = useState('');
  const [adjust, setAdjust] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setReason('');
    setAdjust(true);
    setError(undefined);
  }, [task?.id]);

  const submit = async () => {
    if (!task) return;
    if (reason.trim().length < 3) {
      setError('Cần ghi lý do huỷ hiệu lực (ít nhất 3 ký tự).');
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await onConfirm(task, reason.trim(), adjust);
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không huỷ hiệu lực được công việc.');
    } finally {
      setSubmitting(false);
    }
  };

  const instanceCode = task?.procedure?.status === 'completed' ? task.procedure.instanceCode : undefined;

  return (
    <Dialog
      open={Boolean(task)}
      title="Huỷ hiệu lực công việc?"
      subtitle={task ? `${task.code} · ${task.title}` : undefined}
      submitLabel="Huỷ hiệu lực"
      cancelLabel="Đóng"
      submitting={submitting}
      submitDisabled={reason.trim().length < 3}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field
        label="Lý do huỷ hiệu lực"
        required
        hint={
          'Công việc chuyển sang "Đã huỷ hiệu lực", không mở lại được và được giữ lại làm vết.' +
          (instanceCode ? ` Hồ sơ quy trình ${instanceCode} bị huỷ hiệu lực theo.` : '')
        }
      >
        <textarea
          rows={3}
          value={reason}
          autoFocus
          maxLength={1000}
          placeholder="VD: Số liệu báo giá sai, cần làm lại"
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      <label className={styles.checkbox} style={{ alignItems: 'flex-start' }}>
        <input type="checkbox" checked={adjust} onChange={(event) => setAdjust(event.target.checked)} />
        <span>
          <strong>Lập công việc điều chỉnh</strong>
          <br />
          <span className={styles.muted}>
            Mở form giao việc điền sẵn từ việc này, liên kết với việc đã huỷ hiệu lực
            {task?.executionType === 'procedure' ? '; việc điều chỉnh theo quy trình sẽ mở hồ sơ mới' : ''}.
          </span>
        </span>
      </label>
    </Dialog>
  );
}
