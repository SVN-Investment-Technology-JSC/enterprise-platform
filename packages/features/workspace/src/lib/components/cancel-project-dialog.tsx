'use client';

import type { ProjectSummary } from '@enterprise-platform/contracts-workspace';
import { useEffect, useState } from 'react';
import { Dialog, Field } from './dialog';

export interface CancelProjectDialogProps {
  readonly project?: ProjectSummary;
  readonly onClose: () => void;
  readonly onConfirm: (project: ProjectSummary) => Promise<void>;
}

/**
 * Xác nhận huỷ dự án bằng cách gõ lại mã dự án.
 *
 * Mở từ menu chuột phải nên không dùng được `Popconfirm` — thành phần đó cần
 * một nút kích hoạt để neo vào. Gõ lại mã thay vì bấm "Đồng ý" vì huỷ dự án
 * làm cả cây công việc biến khỏi danh sách đang làm của mọi thành viên, và
 * một cú bấm nhầm trên menu là quá dễ.
 */
export function CancelProjectDialog({ project, onClose, onConfirm }: CancelProjectDialogProps) {
  const [typed, setTyped] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setTyped('');
    setError(undefined);
  }, [project?.id]);

  const submit = async () => {
    if (!project) return;
    if (typed.trim().toUpperCase() !== project.code) {
      setError(`Gõ đúng mã ${project.code} để xác nhận.`);
      return;
    }
    setSubmitting(true);
    try {
      await onConfirm(project);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={Boolean(project)}
      title="Huỷ dự án"
      subtitle={project ? `${project.code} · ${project.name}` : undefined}
      submitLabel="Huỷ dự án"
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field
        label="Gõ lại mã dự án để xác nhận"
        hint="Dự án chuyển sang trạng thái Đã huỷ. Công việc, tài liệu và lịch sử vẫn được giữ lại."
      >
        <input
          value={typed}
          autoFocus
          placeholder={project?.code}
          onChange={(event) => setTyped(event.target.value.toUpperCase())}
        />
      </Field>
    </Dialog>
  );
}
