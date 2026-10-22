'use client';

import type { ProjectSummary } from '@enterprise-platform/contracts-workspace';
import { useEffect, useState } from 'react';
import { ConfirmBox } from './confirm-box';

export interface CancelProjectDialogProps {
  readonly project?: ProjectSummary;
  readonly onClose: () => void;
  readonly onConfirm: (project: ProjectSummary) => Promise<void>;
}

/**
 * Xác nhận huỷ dự án. Mở từ menu chuột phải nên dùng hộp xác nhận riêng thay cho nút có `Confirm` bọc ngoài.
 */
export function CancelProjectDialog({ project, onClose, onConfirm }: CancelProjectDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => setError(undefined), [project?.id]);

  const submit = async () => {
    if (!project) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await onConfirm(project);
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không huỷ được dự án.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ConfirmBox
      open={Boolean(project)}
      title={project ? `Bạn có chắc chắn muốn huỷ dự án ${project.code} · ${project.name}?` : ''}
      message="Dự án chuyển sang trạng thái Đã huỷ. Công việc, tài liệu và lịch sử vẫn được giữ lại."
      confirmLabel="Huỷ dự án"
      busy={submitting}
      error={error}
      onConfirm={() => void submit()}
      onCancel={onClose}
    />
  );
}
