'use client';

import {
  PROCEDURE_ATTACHMENT_TYPES,
  PROCEDURE_ATTACHMENT_MAX_BYTES,
  type ProcedureAttachment,
  type ProcedureInstance,
} from '@enterprise-platform/contracts-procedure-engine';
import { useMemo, useRef, useState } from 'react';
import styles from './workspace-board.module.scss';

const dateTime = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const ACCEPT = [...new Set(Object.keys(PROCEDURE_ATTACHMENT_TYPES))]
  .map((extension) => `.${extension}`)
  .join(',');

function formatSize(bytes?: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Kiểm ngay ở client để báo lỗi tức thì (AC-ATT-02); server vẫn kiểm lại. */
function rejectionReason(file: File): string | undefined {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!PROCEDURE_ATTACHMENT_TYPES[extension]) {
    return `Định dạng .${extension || '?'} không được phép. Chấp nhận: ${ACCEPT}.`;
  }
  if (file.size > PROCEDURE_ATTACHMENT_MAX_BYTES) {
    return `Tệp ${formatSize(file.size)} vượt giới hạn 50 MB.`;
  }
  return undefined;
}

export function AttachmentPanel({
  instance,
  attachments,
  busy,
  onUpload,
}: {
  instance: ProcedureInstance;
  attachments: readonly ProcedureAttachment[];
  busy?: string;
  onUpload: (file: File) => void;
}) {
  const [stepFilter, setStepFilter] = useState('all');
  const [error, setError] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);

  const stepName = useMemo(() => {
    const map = new Map<string, string>();
    for (const step of instance.steps) map.set(step.id, `${step.order}-${step.name}`);
    return map;
  }, [instance.steps]);

  const mine = useMemo(
    () => attachments.filter((item) => item.instanceId === instance.id),
    [attachments, instance.id],
  );

  const visible = useMemo(
    () => (stepFilter === 'all' ? mine : mine.filter((item) => item.stepInstanceId === stepFilter)),
    [mine, stepFilter],
  );

  // Chỉ người đang có phần việc ở bước hiện tại mới nộp được tài liệu (AC-ATT-01).
  const canUpload =
    instance.status === 'running' &&
    ((instance.authorization?.availableActions.length ?? 0) > 0 ||
      (instance.authorization?.canManageSubtasks ?? false));

  return (
    <article className={styles.panel}>
      <header className={styles.actionHead}>
        <h3 className={styles.panelTitle}>
          <span aria-hidden="true">📎</span> Tệp đính kèm
        </h3>
        <select
          className={styles.stepFilter}
          value={stepFilter}
          onChange={(event) => setStepFilter(event.target.value)}
          aria-label="Lọc theo giai đoạn"
        >
          <option value="all">Tất cả giai đoạn</option>
          {instance.steps.map((step) => (
            <option key={step.id} value={step.id}>
              {step.order}-{step.name}
            </option>
          ))}
        </select>
      </header>

      {error ? (
        <p role="alert" className={styles.attachmentError}>
          {error}
        </p>
      ) : null}

      {canUpload ? (
        <div className={styles.actionRow}>
          <input
            type="file"
            hidden
            accept={ACCEPT}
            ref={fileInput}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              const reason = rejectionReason(file);
              setError(reason);
              if (!reason) onUpload(file);
            }}
          />
          <button
            type="button"
            className={styles.primary}
            disabled={busy === 'upload'}
            onClick={() => fileInput.current?.click()}
          >
            {busy === 'upload' ? 'Đang tải lên…' : '+ Tải lên tệp'}
          </button>
        </div>
      ) : (
        <p className={styles.panelHint}>
          {instance.status === 'running'
            ? 'Bạn không có phần việc ở bước hiện tại nên chỉ xem được tài liệu.'
            : 'Hồ sơ đã kết thúc — tài liệu vẫn tra cứu và tải về được.'}
        </p>
      )}

      {visible.length === 0 ? (
        <p className={styles.panelHint}>
          {mine.length === 0 ? 'Chưa có tệp nào.' : 'Không có tệp ở giai đoạn đang lọc.'}
        </p>
      ) : (
        <ul className={styles.fileList}>
          {visible.map((file) => (
            <li key={file.id}>
              <div className={styles.fileHead}>
                <strong>
                  {file.downloadUrl ? (
                    <a href={file.downloadUrl} target="_blank" rel="noreferrer">
                      {file.fileName}
                    </a>
                  ) : (
                    file.fileName
                  )}
                </strong>
                <span className={styles.fileSize}>{formatSize(file.sizeBytes)}</span>
              </div>
              <small>
                {file.stepInstanceId ? stepName.get(file.stepInstanceId) ?? 'Giai đoạn đã đổi' : 'Cả hồ sơ'}
                {' · '}
                {dateTime.format(new Date(file.createdAt))}
              </small>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
