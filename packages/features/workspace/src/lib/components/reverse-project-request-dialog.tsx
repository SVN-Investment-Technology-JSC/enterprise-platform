'use client';

import type { ProjectRequest } from '@enterprise-platform/contracts-workspace';
import { useEffect, useState } from 'react';
import { ConfirmBox } from './confirm-box';
import { Field } from './dialog';

export interface ReverseProjectRequestDialogProps {
  readonly request?: ProjectRequest;
  readonly onClose: () => void;
  /** Ném lỗi ra để hộp thoại hiện ngay, ví dụ khi kỳ lương đã chốt. */
  readonly onConfirm: (
    request: ProjectRequest,
    reason: string,
    createAdjustment: boolean,
  ) => Promise<void>;
}

/**
 * Xác nhận huỷ hiệu lực đơn từ của dự án. Workspace không sửa đơn: nó gửi yêu
 * cầu sang module nguồn (HRM, hoặc Quy trình nếu đơn chạy qua quy trình), và
 * trạng thái đổi khi module đó báo về.
 */
export function ReverseProjectRequestDialog({
  request,
  onClose,
  onConfirm,
}: ReverseProjectRequestDialogProps) {
  const [reason, setReason] = useState('');
  const [adjust, setAdjust] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setReason('');
    setAdjust(true);
    setError(undefined);
  }, [request?.id]);

  const submit = async () => {
    if (!request) return;
    if (reason.trim().length < 3) {
      setError('Cần ghi lý do huỷ hiệu lực (ít nhất 3 ký tự).');
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await onConfirm(request, reason.trim(), adjust);
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không huỷ hiệu lực được đơn.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ConfirmBox
      open={Boolean(request)}
      title={request ? `Bạn có chắc chắn muốn huỷ hiệu lực đơn ${request.code} · ${request.requestTypeLabel}?` : ''}
      confirmLabel="Huỷ hiệu lực"
      busy={submitting}
      confirmDisabled={reason.trim().length < 3}
      error={error}
      onConfirm={() => void submit()}
      onCancel={onClose}
    >
      <Field
        label="Lý do huỷ hiệu lực"
        required
        hint={
          'Đơn không mở lại: chuyển sang "Đã huỷ hiệu lực", công/phép/tạm ứng của đơn được hoàn lại ở HRM.' +
          (request?.procedureInstanceCode
            ? ` Hồ sơ quy trình ${request.procedureInstanceCode} bị huỷ hiệu lực theo.`
            : '') +
          ' Bị chặn nếu kỳ công/kỳ lương đã chốt hoặc tạm ứng đã giải ngân. Chỉ chủ nhiệm dự án, người duyệt đơn hoặc quản trị được huỷ.'
        }
      >
        <textarea
          rows={3}
          value={reason}
          autoFocus
          maxLength={1000}
          placeholder="VD: Sai ngày công tác, cần gửi lại đơn"
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={adjust} onChange={(event) => setAdjust(event.target.checked)} />
        <span>
          <strong>Lập hồ sơ điều chỉnh</strong>
          <br />
          <span style={{ color: 'var(--muted, #64748b)' }}>
            Người gửi đơn nhận thông báo kèm form đơn mới điền sẵn ở HRM.
          </span>
        </span>
      </label>
    </ConfirmBox>
  );
}
