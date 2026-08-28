'use client';

import type {
  ProcedureAttachment,
  ProcedureInstance,
} from '@enterprise-platform/contracts-procedure-engine';
import { useMemo, useState } from 'react';
import styles from './workspace-board.module.scss';

const dateTime = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function formatSize(bytes?: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentPanel({
  instance,
  attachments,
}: {
  instance: ProcedureInstance;
  attachments: readonly ProcedureAttachment[];
  busy?: string;
  onUpload?: (file: File) => void;
}) {
  const [stepFilter, setStepFilter] = useState('all');

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

  return (
    <article className={styles.panel}>
      <header className={styles.actionHead}>
        <h3 className={styles.panelTitle}>
          Tệp đính kèm
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
                      📄 {file.fileName}
                    </a>
                  ) : (
                    <>📄 {file.fileName}</>
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
