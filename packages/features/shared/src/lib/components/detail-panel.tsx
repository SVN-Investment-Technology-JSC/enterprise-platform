'use client';

import {
  formatBytes,
  SHARED_CONFIDENTIALITY_LABELS,
  SHARED_DOCUMENT_KIND_LABELS,
  SHARED_PREVIEWABLE_CONTENT_TYPES,
  type SharedAccessAction,
  type SharedCapabilities,
  type SharedDocumentDetail,
  type SharedDocumentSummary,
  type SharedFolder,
} from '@enterprise-platform/contracts-shared';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { Download } from 'lucide-react';
import type { ReactNode } from 'react';
import { expiryTone, fileBadge, formatDate, formatDateTime } from '../library.model';
import styles from '../shared.module.scss';

const ACTION_LABELS: Readonly<Record<SharedAccessAction, string>> = {
  view: 'xem',
  download: 'tải xuống',
  upload: 'tải lên',
  update: 'sửa thông tin',
  move: 'chuyển thư mục',
  lock: 'khoá',
  unlock: 'mở khoá',
  archive: 'lưu trữ',
  restore: 'khôi phục',
  delete: 'xoá',
};

function Fact({ label, wide, children }: { readonly label: string; readonly wide?: boolean; readonly children: ReactNode }) {
  return (
    <div className={wide ? styles.factWide : undefined}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function ExpiryBadge({ value }: { readonly value?: string }) {
  const tone = expiryTone(value);
  if (tone === 'expired') return <span className={`${styles.badge} ${styles.badgeDanger}`}>Hết hiệu lực</span>;
  if (tone === 'soon') return <span className={`${styles.badge} ${styles.badgeWarn}`}>Sắp hết hiệu lực</span>;
  return null;
}

/* ------------------------------------------------------------ thư mục */

export interface FolderDetailProps {
  readonly folder: SharedFolder;
  readonly documents: readonly SharedDocumentSummary[];
  readonly capabilities: SharedCapabilities;
  readonly onOpen: () => void;
  readonly onEdit: () => void;
  readonly onRemove: () => Promise<void>;
  readonly onSelectDocument: (documentId: string) => void;
}

export function FolderDetail({
  folder,
  documents,
  capabilities,
  onOpen,
  onEdit,
  onRemove,
  onSelectDocument,
}: FolderDetailProps) {
  // Thư mục gốc là khung của kho: chỉ quản trị kho xoá, như chỉ họ dựng.
  const canDelete =
    (capabilities.canDeleteDocuments || capabilities.isTenantAdmin) && (Boolean(folder.parentId) || capabilities.canManage);
  return (
    <aside className={`${styles.panel} ${styles.detail}`} aria-label={`Chi tiết thư mục ${folder.name}`}>
      <div className={styles.detailHead}>
        <div className={styles.badgeRow}>
          <span className={`${styles.badge} ${styles.badgeKind}`}>
            {folder.docKind ? SHARED_DOCUMENT_KIND_LABELS[folder.docKind] : 'Thư mục'}
          </span>
          <ExpiryBadge value={folder.effectiveTo} />
        </div>
        <h2>{folder.name}</h2>
        <dl className={styles.facts}>
          {folder.docNumber ? <Fact label="Số hiệu" wide>{folder.docNumber}</Fact> : null}
          {folder.partner ? <Fact label="Đối tác" wide>{folder.partner}</Fact> : null}
          {folder.issuedOn ? <Fact label="Ngày ký">{formatDate(folder.issuedOn)}</Fact> : null}
          {folder.effectiveTo ? <Fact label="Hiệu lực đến">{formatDate(folder.effectiveTo)}</Fact> : null}
          <Fact label="Tài liệu">{folder.totalDocumentCount.toLocaleString('vi-VN')}</Fact>
          <Fact label="Dung lượng">{formatBytes(folder.totalBytes)}</Fact>
          {folder.note ? <Fact label="Ghi chú" wide>{folder.note}</Fact> : null}
        </dl>
      </div>

      <div className={styles.detailSection}>
        <div className={styles.sectionTitle}>
          <h3>Tệp trong thư mục · {folder.documentCount.toLocaleString('vi-VN')}</h3>
        </div>
        {documents.slice(0, 6).map((document) => {
          const badge = fileBadge(document.currentVersion?.contentType, document.currentVersion?.fileName);
          return (
            <button
              key={document.id}
              type="button"
              className={`${styles.versionRow} ${styles.linkRow}`}
              onClick={() => onSelectDocument(document.id)}
            >
              <span className={styles.fileIcon} data-kind={badge} aria-hidden>
                {badge}
              </span>
              <span className={styles.versionBody}>
                <span>{document.name}</span>
                <small>
                  v{document.currentVersion?.versionNo ?? 1} · {formatDate(document.createdAt)}
                </small>
              </span>
            </button>
          );
        })}
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.buttonPrimary} onClick={onOpen}>
          Mở thư mục
        </button>
        {capabilities.canWriteDocuments ? (
          <button type="button" className={styles.buttonGhost} onClick={onEdit}>
            Sửa thông tin
          </button>
        ) : null}
        {canDelete ? (
          <Popconfirm
            title={`Chuyển thư mục ${folder.name} vào Thùng rác?`}
            okText="Xoá"
            okType="danger"
            onConfirm={onRemove}
          >
            <button type="button" className={`${styles.buttonGhost} ${styles.pushRight}`}>
              Xoá
            </button>
          </Popconfirm>
        ) : null}
      </div>
    </aside>
  );
}

/* ----------------------------------------------------------- tài liệu */

export interface DocumentDetailProps {
  readonly document: SharedDocumentDetail;
  readonly capabilities: SharedCapabilities;
  readonly currentUserId: string;
  readonly busy: boolean;
  readonly onPreview: (versionId?: string) => void;
  readonly onDownload: (versionId?: string) => void;
  readonly onNewVersion: () => void;
  readonly onEdit: () => void;
  readonly onLock: () => void;
  readonly onUnlock: () => void;
  readonly onArchive: () => Promise<void>;
  readonly onRestore: () => void;
  readonly onDelete: () => Promise<void>;
}

export function DocumentDetail({
  document,
  capabilities,
  currentUserId,
  busy,
  onPreview,
  onDownload,
  onNewVersion,
  onEdit,
  onLock,
  onUnlock,
  onArchive,
  onRestore,
  onDelete,
}: DocumentDetailProps) {
  const current = document.currentVersion;
  const active = document.status === 'active';
  const lockedByOther = Boolean(document.lockedByUserId && document.lockedByUserId !== currentUserId);
  const canEdit = capabilities.canWriteDocuments && active && !lockedByOther;
  const canUnlock =
    Boolean(document.lockedByUserId) && (!lockedByOther || capabilities.canManage);
  const canArchive = capabilities.canDeleteDocuments || capabilities.isTenantAdmin;
  const uploaded = current?.sizeBytes !== undefined;
  const previewable = uploaded && SHARED_PREVIEWABLE_CONTENT_TYPES.includes(current?.contentType ?? '');

  return (
    <aside className={`${styles.panel} ${styles.detail}`} aria-label={`Chi tiết ${document.name}`}>
      <div className={styles.detailHead}>
        <div className={styles.badgeRow}>
          {document.docKind ? (
            <span className={`${styles.badge} ${styles.badgeKind}`}>
              {SHARED_DOCUMENT_KIND_LABELS[document.docKind]}
            </span>
          ) : null}
          <span className={styles.badge}>{SHARED_CONFIDENTIALITY_LABELS[document.confidentiality]}</span>
          {document.lockedByUserId ? (
            <span className={`${styles.badge} ${styles.badgeWarn}`}>
              {lockedByOther ? 'Người khác đang khoá' : 'Bạn đang khoá'}
            </span>
          ) : null}
          {active ? null : <span className={`${styles.badge} ${styles.badgeDanger}`}>Đã lưu trữ</span>}
          <ExpiryBadge value={document.effectiveTo} />
        </div>
        <h2>{document.name}</h2>
        <dl className={styles.facts}>
          {document.docNumber ? <Fact label="Số hiệu" wide>{document.docNumber}</Fact> : null}
          {document.partner ? <Fact label="Đối tác, nơi ban hành" wide>{document.partner}</Fact> : null}
          {document.issuedOn ? <Fact label="Ngày ban hành">{formatDate(document.issuedOn)}</Fact> : null}
          {document.effectiveFrom || document.effectiveTo ? (
            <Fact label="Hiệu lực">
              {[formatDate(document.effectiveFrom), formatDate(document.effectiveTo)].filter(Boolean).join(' – ')}
            </Fact>
          ) : null}
          <Fact label="Người tải lên">{document.createdByName ?? '—'}</Fact>
          <Fact label="Lưu vào kho">{formatDate(document.createdAt)}</Fact>
          <Fact label="Vị trí" wide>{document.folderPath || '—'}</Fact>
          {document.sourceLabel ? <Fact label="Nguồn" wide>{document.sourceLabel}</Fact> : null}
          {document.tags.length ? (
            <Fact label="Thẻ" wide>
              <span className={styles.tags}>
                {document.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </span>
            </Fact>
          ) : null}
          {document.description ? <Fact label="Mô tả" wide>{document.description}</Fact> : null}
        </dl>
      </div>

      <div className={styles.detailSection}>
        <div className={styles.sectionTitle}>
          <h3>Phiên bản · {document.versions.length}</h3>
        </div>
        {document.versions.map((version) => {
          const done = version.sizeBytes !== undefined;
          const isCurrent = version.id === document.currentVersionId;
          return (
            <div key={version.id} className={styles.versionRow}>
              <span className={styles.versionNo}>v{version.versionNo}</span>
              <span className={styles.versionBody}>
                <span>{version.changeNote || version.fileName}</span>
                <small>
                  {[version.uploadedByName, formatDateTime(version.createdAt), done ? formatBytes(version.sizeBytes ?? 0) : '']
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </span>
              {!done ? (
                <span className={`${styles.badge} ${styles.badgeWarn}`}>Chưa tải lên xong</span>
              ) : isCurrent ? (
                <span className={`${styles.badge} ${styles.badgeSuccess}`}>Hiện hành</span>
              ) : null}
              <button
                type="button"
                className={styles.iconButton}
                aria-label={`Tải xuống v${version.versionNo}`}
                disabled={!done}
                onClick={() => onDownload(version.id)}
              >
                <Download size={13} />
              </button>
            </div>
          );
        })}
      </div>

      <div className={styles.detailSection}>
        <div className={styles.sectionTitle}>
          <h3>Nhật ký truy cập</h3>
        </div>
        {document.accessLog.slice(0, 10).map((entry) => (
          <div key={entry.id} className={styles.logRow}>
            <span className={styles.logAt}>{formatDateTime(entry.createdAt)}</span>
            <span>
              {entry.userName ?? '—'} · {ACTION_LABELS[entry.action]}
              {entry.versionNo ? ` v${entry.versionNo}` : ''}
            </span>
          </div>
        ))}
      </div>

      <div className={styles.actions}>
        {previewable ? (
          <button type="button" className={styles.buttonPrimary} onClick={() => onPreview()}>
            Xem
          </button>
        ) : null}
        <button type="button" className={styles.buttonGhost} disabled={!uploaded} onClick={() => onDownload()}>
          Tải xuống
        </button>
        {canEdit ? (
          <>
            <button type="button" className={styles.buttonGhost} disabled={busy} onClick={onNewVersion}>
              Phiên bản mới
            </button>
            <button type="button" className={styles.buttonGhost} disabled={busy} onClick={onEdit}>
              Sửa thông tin
            </button>
          </>
        ) : null}
        {capabilities.canWriteDocuments && active && !document.lockedByUserId ? (
          <button type="button" className={styles.buttonGhost} disabled={busy} onClick={onLock}>
            Khoá
          </button>
        ) : null}
        {active && canUnlock ? (
          <button type="button" className={styles.buttonGhost} disabled={busy} onClick={onUnlock}>
            Mở khoá
          </button>
        ) : null}
        {canArchive ? (
          active ? (
            <Popconfirm
              title={`Lưu trữ ${document.name}?`}
              okText="Lưu trữ"
              okType="danger"
              disabled={busy}
              onConfirm={onArchive}
            >
              <button type="button" className={`${styles.buttonGhost} ${styles.pushRight}`} disabled={busy}>
                Lưu trữ
              </button>
            </Popconfirm>
          ) : (
            <button
              type="button"
              className={`${styles.buttonGhost} ${styles.pushRight}`}
              disabled={busy}
              onClick={onRestore}
            >
              Khôi phục
            </button>
          )
        ) : null}
        {canArchive ? (
          <Popconfirm
            title={`Chuyển ${document.name} vào Thùng rác?`}
            okText="Xoá"
            okType="danger"
            disabled={busy || lockedByOther}
            onConfirm={onDelete}
          >
            <button type="button" className={styles.buttonGhost} disabled={busy || lockedByOther}>
              Xoá
            </button>
          </Popconfirm>
        ) : null}
      </div>
    </aside>
  );
}
