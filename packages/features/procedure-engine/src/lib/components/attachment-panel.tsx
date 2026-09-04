'use client';

import type {
  ProcedureAttachment,
  ProcedureInstance,
} from '@enterprise-platform/contracts-procedure-engine';
import { Download, ExternalLink, FileText } from 'lucide-react';
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
    () =>
      mine.filter((file) => {
        if (stepFilter === 'all') return true;
        if (stepFilter === 'unassigned') return !file.stepInstanceId;
        return file.stepInstanceId === stepFilter;
      }),
    [mine, stepFilter],
  );

  return (
    <article className={styles.panel}>
      <header className={styles.panelHead}>
        <div>
          <h3 className={styles.panelTitle}>Tệp &amp; Tài liệu đính kèm</h3>
          <p className={styles.panelSubtitle}>
            {/* Toàn bộ tệp nộp ở từng giai đoạn của hồ sơ. Tài liệu tải lên lưu cùng hồ sơ và tải về qua liên kết bảo mật có thời hạn. */}
          </p>
        </div>

        <select
          className={styles.select}
          value={stepFilter}
          aria-label="Lọc theo bước"
          onChange={(event) => setStepFilter(event.target.value)}
        >
          <option value="all">Tất cả giai đoạn ({mine.length})</option>
          <option value="unassigned">Cả hồ sơ / chung</option>
          {instance.steps.map((step) => (
            <option key={step.id} value={step.id}>
              {step.order}. {step.name}
            </option>
          ))}
        </select>
      </header>

      {visible.length === 0 ? (
        <p className={styles.panelHint}>
          {mine.length === 0 ? 'Chưa có tệp nào.' : 'Không có tệp ở giai đoạn đang lọc.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
          {visible.map((file) => (
            <div key={file.id} className={styles.fileCardItem}>
              <div className={styles.fileCardInfo}>
                <div className={styles.fileCardIconWrap}>
                  <FileText size={18} strokeWidth={2} />
                </div>
                <div className={styles.fileCardDetails}>
                  <span className={styles.fileCardName} title={file.fileName}>
                    {file.fileName}
                  </span>
                  <span className={styles.fileCardMeta}>
                    <span>{formatSize(file.sizeBytes)}</span>
                    <span>·</span>
                    <span>
                      {file.stepInstanceId
                        ? stepName.get(file.stepInstanceId) ?? 'Giai đoạn đã đổi'
                        : 'Cả hồ sơ'}
                    </span>
                    <span>·</span>
                    <span>{dateTime.format(new Date(file.createdAt))}</span>
                  </span>
                </div>
              </div>

              <div className={styles.fileCardActions}>
                {file.downloadUrl ? (
                  <>
                    <a
                      href={file.downloadUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={`${styles.fileActionBtn} ${styles.fileActionBtnPrimary}`}
                      title="Xem trực tiếp trong tab mới"
                    >
                      <ExternalLink size={13} strokeWidth={2} />
                      <span>Xem trực tiếp</span>
                    </a>
                    <a
                      href={file.downloadUrl}
                      download={file.fileName}
                      className={styles.fileActionBtn}
                      title="Tải tệp về máy"
                    >
                      <Download size={13} strokeWidth={2} />
                      <span>Tải về</span>
                    </a>
                  </>
                ) : (
                  <span style={{ fontSize: '11.5px', color: '#94a3b8' }}>Đang xử lý link...</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
