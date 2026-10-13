'use client';

import type { WorkItem } from '@enterprise-platform/contracts-workspace';
import { useEffect, useState } from 'react';
import { Dialog, Field } from './dialog';

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
 * Khác với "Huỷ" (chuyển sang Đã huỷ, mở lại được), xoá là mất hẳn công việc
 * cùng toàn bộ nhánh con — nên bắt gõ đúng mã công việc trước khi cho xoá,
 * giống cách huỷ dự án.
 */
export function DeleteWorkItemDialog({
  item,
  descendants = 0,
  onClose,
  onConfirm,
}: DeleteWorkItemDialogProps) {
  const [confirmCode, setConfirmCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setConfirmCode('');
    setError(undefined);
  }, [item?.id]);

  const matches = Boolean(item) && confirmCode.trim().toUpperCase() === item?.code.toUpperCase();

  const submit = async () => {
    if (!item || !matches) return;
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
    <Dialog
      open={Boolean(item)}
      title="Xoá công việc?"
      subtitle={item ? `${item.code} · ${item.title}` : undefined}
      submitLabel="Xoá công việc"
      cancelLabel="Đóng"
      submitting={submitting}
      submitDisabled={!matches}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field
        label={`Gõ lại mã "${item?.code ?? ''}" để xác nhận`}
        hint={
          descendants > 0
            ? `Xoá hẳn công việc này cùng ${descendants} việc con trong nhánh. Không hoàn tác được — nếu chỉ muốn dừng việc, hãy dùng "Huỷ công việc".`
            : 'Xoá hẳn công việc này. Không hoàn tác được — nếu chỉ muốn dừng việc, hãy dùng "Huỷ công việc".'
        }
      >
        <input
          value={confirmCode}
          autoFocus
          placeholder={item?.code}
          onChange={(event) => setConfirmCode(event.target.value)}
        />
      </Field>
    </Dialog>
  );
}
