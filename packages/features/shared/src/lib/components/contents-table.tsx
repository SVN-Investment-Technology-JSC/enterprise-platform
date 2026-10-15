'use client';

import {
  formatBytes,
  type SharedDocumentSummary,
  type SharedFolder,
} from '@enterprise-platform/contracts-shared';
import { expiryTone, fileBadge, formatDate, formatDateTime } from '../library.model';
import styles from '../shared.module.scss';

export type ContentRow =
  | { readonly type: 'folder'; readonly folder: SharedFolder }
  | { readonly type: 'document'; readonly document: SharedDocumentSummary };

export type Selection = { readonly type: 'folder' | 'document'; readonly id: string };

export interface ContentsTableProps {
  readonly rows: readonly ContentRow[];
  readonly selection?: Selection;
  readonly loading: boolean;
  /** Đang tìm hay lọc toàn kho: dòng tài liệu hiện đường dẫn thư mục. */
  readonly showPath: boolean;
  readonly label: string;
  readonly onSelect: (selection: Selection) => void;
  readonly onOpenFolder: (folderId: string) => void;
  readonly onOpenDocument: (document: SharedDocumentSummary) => void;
}

function Expiry({ value }: { readonly value?: string }) {
  if (!value) return <span className={`${styles.cellDate} ${styles.cellEmpty}`}>—</span>;
  const tone = expiryTone(value);
  const className =
    tone === 'expired' ? styles.expired : tone === 'soon' ? styles.soon : undefined;
  return <span className={`${styles.cellNumber} ${className ?? ''}`}>{formatDate(value)}</span>;
}

export function ContentsTable({
  rows,
  selection,
  loading,
  showPath,
  label,
  onSelect,
  onOpenFolder,
  onOpenDocument,
}: ContentsTableProps) {
  const folderCount = rows.filter((row) => row.type === 'folder').length;
  const documentCount = rows.length - folderCount;

  return (
    <section className={`${styles.panel} ${styles.contents}`} aria-label={label}>
      <div className={styles.tableScroll}>
        <div className={styles.table} role="table">
          <div className={styles.tableHead} role="row">
            <span aria-hidden />
            <span>Tên · Đối tác</span>
            <span>Số hiệu</span>
            <span>Hiệu lực đến</span>
            <span>Cập nhật</span>
            <span>Tệp</span>
          </div>
          {rows.length === 0 ? (
            <div className={styles.empty}>{loading ? 'Đang tải…' : 'Không có tài liệu.'}</div>
          ) : (
            rows.map((row) => {
              if (row.type === 'folder') {
                const { folder } = row;
                const current = selection?.type === 'folder' && selection.id === folder.id;
                return (
                  <button
                    key={`f-${folder.id}`}
                    type="button"
                    role="row"
                    aria-current={current ? 'true' : 'false'}
                    className={styles.tableRow}
                    onClick={() => onSelect({ type: 'folder', id: folder.id })}
                    onDoubleClick={() => onOpenFolder(folder.id)}
                  >
                    <span className={styles.fileIcon} data-kind="TM" aria-hidden>
                      TM
                    </span>
                    <span className={styles.cellName}>
                      <strong title={folder.name}>{folder.name}</strong>
                      {folder.partner ? <small>{folder.partner}</small> : null}
                    </span>
                    <span className={`${styles.cellNumber} ${folder.docNumber ? '' : styles.cellEmpty}`}>
                      {folder.docNumber ?? '—'}
                    </span>
                    <Expiry value={folder.effectiveTo} />
                    <span className={styles.cellDate}>{formatDateTime(folder.updatedAt).slice(0, 5)}</span>
                    <span className={styles.cellCount}>
                      {folder.totalDocumentCount.toLocaleString('vi-VN')}
                    </span>
                  </button>
                );
              }
              const { document } = row;
              const version = document.currentVersion;
              const current = selection?.type === 'document' && selection.id === document.id;
              const badge = fileBadge(version?.contentType, version?.fileName);
              const sub = showPath ? document.folderPath : document.partner ?? version?.fileName;
              return (
                <button
                  key={`d-${document.id}`}
                  type="button"
                  role="row"
                  aria-current={current ? 'true' : 'false'}
                  className={styles.tableRow}
                  onClick={() => onSelect({ type: 'document', id: document.id })}
                  onDoubleClick={() => onOpenDocument(document)}
                >
                  <span className={styles.fileIcon} data-kind={badge} aria-hidden>
                    {badge}
                  </span>
                  <span className={styles.cellName}>
                    <strong title={document.name}>{document.name}</strong>
                    {sub ? <small title={sub}>{sub}</small> : null}
                  </span>
                  <span className={`${styles.cellNumber} ${document.docNumber ? '' : styles.cellEmpty}`}>
                    {document.docNumber ?? '—'}
                  </span>
                  <Expiry value={document.effectiveTo} />
                  <span className={styles.cellDate}>{formatDateTime(document.updatedAt).slice(0, 5)}</span>
                  <span className={styles.cellCount}>
                    {version?.sizeBytes === undefined ? '—' : formatBytes(version.sizeBytes)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
      <div className={styles.tableFoot}>
        <span>
          {[
            folderCount ? `${folderCount.toLocaleString('vi-VN')} thư mục` : '',
            `${documentCount.toLocaleString('vi-VN')} tài liệu`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>
    </section>
  );
}
