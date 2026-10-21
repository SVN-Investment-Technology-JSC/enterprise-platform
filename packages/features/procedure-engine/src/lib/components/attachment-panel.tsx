'use client';

import type {
  ProcedureAttachment,
  ProcedureInstance,
} from '@enterprise-platform/contracts-procedure-engine';
import { SearchableSelect, formatDateTime } from '@enterprise-platform/shared-ui';
import { Download, ExternalLink, FilePlus, FileText } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import styles from './workspace-board.module.scss';

function formatSize(bytes?: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Thẻ nguồn của tệp: tải ở bước nào, bổ sung ngoài bước, hay do hệ thống sinh. */
export function attachmentOriginTag(
  file: ProcedureAttachment,
  steps: ProcedureInstance['steps'],
): { label: string; title: string; kind: 'step' | 'supplement' | 'system' } {
  if (file.stepInstanceId) {
    const step = steps.find((candidate) => candidate.id === file.stepInstanceId);
    return {
      kind: 'step',
      label: step ? `Bước ${step.order}` : 'Bước',
      title: step ? `Tải lên ở bước ${step.order}: ${step.name}` : 'Tải lên ở một bước đã đổi',
    };
  }
  if (file.origin === 'system') {
    return { kind: 'system', label: 'Hệ thống', title: 'Hệ thống tự sinh (bảng kê…)' };
  }
  return { kind: 'supplement', label: 'Bổ sung', title: 'Tài liệu bổ sung, không thuộc bước nào' };
}

export function AttachmentPanel({
  instance,
  attachments,
  busy,
  onSupplement,
}: {
  instance: ProcedureInstance;
  attachments: readonly ProcedureAttachment[];
  busy?: string;
  onUpload?: (file: File) => void;
  /** Bổ sung tài liệu ngoài bước; chỉ hiện khi người này được bổ sung (`canSupplement`). */
  onSupplement?: (file: File) => void;
}) {
  const [stepFilter, setStepFilter] = useState('all');
  const picker = useRef<HTMLInputElement>(null);
  const canSupplement = Boolean(onSupplement && instance.authorization?.canSupplement);
  const supplementing = busy === `supplement:${instance.id}`;

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

        {canSupplement ? (
          <>
            <input
              ref={picker}
              type="file"
              hidden
              multiple
              accept=".jpg,.jpeg,.png,.pdf,.docx,.xlsx,.txt,.csv"
              onChange={(event) => {
                for (const file of Array.from(event.target.files ?? [])) onSupplement?.(file);
                event.target.value = '';
              }}
            />
            <button
              type="button"
              className={styles.fileActionBtn}
              disabled={supplementing}
              title="Bổ sung tài liệu cho đơn; tài liệu hiện thẻ Bổ sung"
              onClick={() => picker.current?.click()}
            >
              <FilePlus size={13} strokeWidth={2} />
              <span>{supplementing ? 'Đang tải…' : 'Bổ sung tài liệu'}</span>
            </button>
          </>
        ) : null}

        <SearchableSelect
          className={styles.filterCombo}
          clearable={false}
          value={stepFilter}
          options={[
            { value: 'all', label: `Tất cả giai đoạn (${mine.length})` },
            { value: 'unassigned', label: 'Bổ sung / chung' },
            ...instance.steps.map((step) => ({
              value: step.id,
              label: `${step.order}. ${step.name}`,
            })),
          ]}
          onChange={(value) => setStepFilter(value || 'all')}
        />
      </header>

      {visible.length === 0 ? (
        <p className={styles.panelHint}>
          {mine.length === 0 ? 'Chưa có tệp nào.' : 'Không có tệp ở giai đoạn đang lọc.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
          {visible.map((file) => {
            const origin = attachmentOriginTag(file, instance.steps);
            return (
            <div key={file.id} className={styles.fileCardItem}>
              <div className={styles.fileCardInfo}>
                <div className={styles.fileCardIconWrap}>
                  <FileText size={18} strokeWidth={2} />
                </div>
                <div className={styles.fileCardDetails}>
                  <span className={styles.fileCardName} title={file.fileName}>
                    {file.fileName}
                    <span
                      className={
                        origin.kind === 'supplement'
                          ? `${styles.fileOriginTag} ${styles.fileOriginTagSupplement}`
                          : styles.fileOriginTag
                      }
                      title={origin.title}
                    >
                      {origin.label}
                    </span>
                  </span>
                  <span className={styles.fileCardMeta}>
                    <span>{formatSize(file.sizeBytes)}</span>
                    <span>·</span>
                    <span>{formatDateTime(file.createdAt)}</span>
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
                  <span style={{ fontSize: '12px', color: '#94a3b8' }}>Đang xử lý link...</span>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}
    </article>
  );
}
