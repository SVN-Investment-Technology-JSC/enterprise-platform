'use client';

import type { TaskAttachmentsBlock } from '@enterprise-platform/contracts-task-approval';
import styles from '../universal-task-drawer.module.scss';

export function TaskAttachmentsView({ block }: { block: TaskAttachmentsBlock }) {
  if (!block || !block.files || block.files.length === 0) return null;

  return (
    <div className={styles.blockCard}>
      <h4 className={styles.blockTitle}>{block.title || 'Tài liệu đính kèm'}</h4>
      <div className={styles.attachmentList}>
        {block.files.map((file) => (
          <div key={file.id} className={styles.attachmentItem}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: '#64748b' }}>
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {file.fileName}
                </span>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>{file.fileSizeLabel}</span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {file.previewUrl && (
                <a
                  href={file.previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.linkDetail}
                  style={{ fontSize: 11 }}
                >
                  Xem trước
                </a>
              )}
              <a
                href={file.downloadUrl}
                download={file.fileName}
                className={styles.linkDetail}
                style={{ fontSize: 11 }}
              >
                Tải xuống ⤓
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
