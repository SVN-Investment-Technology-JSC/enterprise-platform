'use client';

import type { WorkItem } from '@enterprise-platform/contracts-workspace';
import { useEffect, useState } from 'react';
import { ConfirmBox } from './confirm-box';

export interface DeleteWorkItemDialogProps {
  readonly item?: WorkItem;
  /** Số việc con trong nhánh sẽ bị xoá theo, để nói trước hậu quả. */
  readonly descendants?: number;
  readonly onClose: () => void;
  /** Ném lỗi ra để hộp thoại hiện ngay, ví dụ khi server từ chối. */
  readonly onConfirm: (item: WorkItem) => Promise<void>;
}

/**
 * Xác nhận xoá hẳn một công việc.
 *
 * Khác với "Huỷ" (chuyển sang Đã huỷ, mở lại được), xoá là mất hẳn công việc cùng toàn bộ nhánh con — câu hỏi nói
 * rõ mã, tên và số việc con sẽ mất theo.
 */
export function DeleteWorkItemDialog({
  item,
  descendants = 0,
  onClose,
  onConfirm,
}: DeleteWorkItemDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => setError(undefined), [item?.id]);

  const submit = async () => {
    if (!item) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await onConfirm(item);
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không xoá được công việc.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ConfirmBox
      open={Boolean(item)}
      title={item ? `Bạn có chắc chắn muốn xoá ${item.code} · ${item.title}?` : ''}
      message={
        descendants > 0
          ? `Công việc cùng ${descendants} việc con trong nhánh bị xoá hẳn, không hoàn tác được. Nếu chỉ muốn dừng việc, hãy dùng "Huỷ công việc".`
          : 'Công việc bị xoá hẳn, không hoàn tác được. Nếu chỉ muốn dừng việc, hãy dùng "Huỷ công việc".'
      }
      confirmLabel="Xoá"
      busy={submitting}
      error={error}
      onConfirm={() => void submit()}
      onCancel={onClose}
    />
  );
}
