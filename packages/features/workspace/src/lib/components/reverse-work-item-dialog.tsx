'use client';

import type { WorkItem } from '@enterprise-platform/contracts-workspace';
import { useEffect, useState } from 'react';
import { Dialog, Field } from './dialog';

export interface ReverseWorkItemDialogProps {
  readonly item?: WorkItem;
  /** Mã hồ sơ Quy trình gắn công việc, nếu có — hồ sơ bị huỷ hiệu lực theo. */
  readonly linkedInstanceCode?: string;
  /** Việc đang phụ thuộc (FS) vào việc này: cảnh báo trước khi huỷ. */
  readonly dependents?: readonly WorkItem[];
  readonly onClose: () => void;
  /** Ném lỗi ra để hộp thoại hiện ngay, ví dụ khi Quy trình chặn vì vật tư đã xuất kho. */
  readonly onConfirm: (item: WorkItem, reason: string, createAdjustment: boolean) => Promise<void>;
}

/**
 * Xác nhận huỷ hiệu lực công việc đã hoàn thành.
 *
 * Khác "Huỷ công việc": công việc đã xong không mở lại, chỉ chuyển sang "Đã
 * huỷ hiệu lực" kèm lý do, và nếu cần thì lập công việc điều chỉnh mới.
 */
export function ReverseWorkItemDialog({
  item,
  linkedInstanceCode,
  dependents = [],
  onClose,
  onConfirm,
}: ReverseWorkItemDialogProps) {
  const [reason, setReason] = useState('');
  const [adjust, setAdjust] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setReason('');
    setAdjust(true);
    setError(undefined);
  }, [item?.id]);

  const submit = async () => {
    if (!item) return;
    if (reason.trim().length < 3) {
      setError('Cần ghi lý do huỷ hiệu lực (ít nhất 3 ký tự).');
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await onConfirm(item, reason.trim(), adjust);
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không huỷ hiệu lực được công việc.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={Boolean(item)}
      title="Huỷ hiệu lực công việc?"
      subtitle={item ? `${item.code} · ${item.title}` : undefined}
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
          'Công việc không mở lại: chuyển sang "Đã huỷ hiệu lực", giữ lịch sử, không còn tính vào tiến độ và chi phí dự toán.' +
          (linkedInstanceCode
            ? ` Hồ sơ quy trình ${linkedInstanceCode} bị huỷ hiệu lực theo; bị chặn nếu vật tư đã xuất kho hoặc kỳ công/lương đã chốt.`
            : '')
        }
      >
        <textarea
          rows={3}
          value={reason}
          autoFocus
          maxLength={1000}
          placeholder="VD: Nghiệm thu sai khối lượng, cần làm lại"
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      {dependents.length > 0 ? (
        <p
          role="alert"
          style={{
            margin: '0 0 10px',
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid #fed7aa',
            background: '#fff7ed',
            color: '#7c2d12',
            fontSize: 12.5,
          }}
        >
          Có {dependents.length} việc phải chờ việc này xong (phụ thuộc FS):{' '}
          {dependents
            .slice(0, 5)
            .map((item) => `${item.code} (${item.title})`)
            .join(', ')}
          {dependents.length > 5 ? '…' : ''}. Huỷ hiệu lực không đổi các việc đó; hãy rà lại lịch
          hoặc nối chúng vào công việc điều chỉnh.
        </p>
      ) : null}
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, cursor: 'pointer' }}>
        <input type="checkbox" checked={adjust} onChange={(event) => setAdjust(event.target.checked)} />
        <span>
          <strong>Lập hồ sơ điều chỉnh</strong>
          <br />
          <span style={{ color: 'var(--muted, #64748b)' }}>
            {linkedInstanceCode
              ? 'Người khởi tạo (vai S) của hồ sơ nhận thông báo kèm form điền sẵn; hồ sơ mới tạo công việc điều chỉnh trong dự án.'
              : 'Mở form công việc mới điền sẵn từ công việc này, liên kết với công việc đã huỷ hiệu lực.'}
          </span>
        </span>
      </label>
    </Dialog>
  );
}
