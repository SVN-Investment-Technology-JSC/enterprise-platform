'use client';

import type { WorkItem } from '@enterprise-platform/contracts-workspace';
import { useEffect, useState } from 'react';
import { Dialog, Field } from './dialog';

export interface CancelWorkItemDialogProps {
  readonly item?: WorkItem;
  /** Số việc con còn mở trong nhánh, để nói trước điều gì sẽ xảy ra. */
  readonly openChildren?: number;
  readonly onClose: () => void;
  /** Ném lỗi ra để hộp thoại hiện ngay, ví dụ khi server chặn vì còn việc con. */
  readonly onConfirm: (item: WorkItem, note: string) => Promise<void>;
}

/**
 * Xác nhận huỷ một công việc, kèm lý do ghi vào nhật ký.
 *
 * Huỷ được mở từ menu chuột phải và từ ô trạng thái của bảng hay cột Kanban —
 * những chỗ một cú bấm nhầm là quá dễ — nên luôn hỏi lại trước khi gửi.
 */
export function CancelWorkItemDialog({
  item,
  openChildren = 0,
  onClose,
  onConfirm,
}: CancelWorkItemDialogProps) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setNote('');
    setError(undefined);
  }, [item?.id]);

  const submit = async () => {
    if (!item) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await onConfirm(item, note.trim());
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không huỷ được công việc.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={Boolean(item)}
      title="Huỷ công việc?"
      subtitle={item ? `${item.code} · ${item.title}` : undefined}
      submitLabel="Huỷ công việc"
      // "Huỷ" ở đây dễ hiểu nhầm là xác nhận huỷ công việc.
      cancelLabel="Đóng"
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field
        label="Lý do huỷ"
        hint={
          openChildren > 0
            ? `Nhánh này còn ${openChildren} việc con đang mở. Công việc chuyển sang Đã huỷ và rời khỏi danh sách đang làm; mở lại được từ trạng thái Đã huỷ.`
            : 'Công việc chuyển sang Đã huỷ và rời khỏi danh sách đang làm; mở lại được từ trạng thái Đã huỷ.'
        }
      >
        <textarea
          rows={3}
          value={note}
          autoFocus
          placeholder="Ghi lý do để người khác hiểu vì sao việc bị huỷ (không bắt buộc)"
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
    </Dialog>
  );
}
