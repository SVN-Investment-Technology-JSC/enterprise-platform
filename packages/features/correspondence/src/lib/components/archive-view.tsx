'use client';

import {
  ATTACHMENT_KIND_LABELS,
  type ArchiveDossier,
  type ArchiveFile,
  type ArchiveTree,
  type LetterAttachment,
} from '@enterprise-platform/contracts-correspondence';
import { formatDateTime, toast } from '@enterprise-platform/shared-ui';
import { ChevronDown, ChevronRight, Download, Eye, FileText, Folder, FolderOpen } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { downloadAttachment, errorMessage, loadArchiveTree } from '../correspondence-api';
import { formatBytes, formatDay, normalize, stageTone } from '../correspondence.model';
import styles from '../correspondence.module.scss';
import { FilePreview, type PreviewTarget } from './file-preview';

type Selection = { readonly kind: 'dossier'; readonly dossier: ArchiveDossier } | undefined;

/**
 * Kho lưu trữ ngay trong Văn thư: cây thư mục giống thư mục "Văn thư" bên Hệ dùng chung
 * (năm › công văn đến / đi › hồ sơ › tệp). Tệp vẫn nằm ở Hệ dùng chung; ở đây xem trước,
 * tải về và mở công văn của hồ sơ. Chỉ có hồ sơ người xem được thấy.
 */
export function ArchiveView({ refreshKey, onOpenLetter }: { readonly refreshKey: number; readonly onOpenLetter: (letterId: string) => void }) {
  const [tree, setTree] = useState<ArchiveTree>();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Selection>();
  const [search, setSearch] = useState('');
  const [onlyArchived, setOnlyArchived] = useState(false);
  const [preview, setPreview] = useState<PreviewTarget>();

  useEffect(() => {
    let active = true;
    loadArchiveTree()
      .then((next) => {
        if (!active) return;
        setTree(next);
        setError(undefined);
        // Mở sẵn năm mới nhất và hai nhánh đến / đi của năm đó.
        setOpen((current) => {
          if (current.size > 0 || next.years.length === 0) return current;
          const year = next.years[0];
          return new Set([`y-${year.year}`, ...year.groups.map((group) => `g-${year.year}-${group.direction}`)]);
        });
      })
      .catch((cause) => active && setError(errorMessage(cause, 'Không tải được kho lưu trữ.')));
    return () => {
      active = false;
    };
  }, [refreshKey]);

  const filtered = useMemo(() => {
    if (!tree) return undefined;
    const needle = normalize(search.trim());
    const keep = (dossier: ArchiveDossier) =>
      (!onlyArchived || dossier.stage === 'archived') &&
      (!needle ||
        [dossier.folderName, dossier.displayNo, dossier.partner, dossier.archiveCode, ...dossier.files.map((file) => file.fileName)]
          .filter((value): value is string => Boolean(value))
          .some((value) => normalize(value).includes(needle)));
    return tree.years
      .map((year) => ({
        ...year,
        groups: year.groups.map((group) => ({ ...group, dossiers: group.dossiers.filter(keep) })).filter((group) => group.dossiers.length > 0),
      }))
      .filter((year) => year.groups.length > 0);
  }, [tree, search, onlyArchived]);

  const searching = search.trim() !== '';
  const isOpen = (key: string) => searching || open.has(key);
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const dossier = selected?.dossier;
  const total = filtered?.reduce((sum, year) => sum + year.groups.reduce((count, group) => count + group.dossiers.length, 0), 0) ?? 0;

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <input
          className={styles.search}
          type="search"
          value={search}
          placeholder="Tìm hồ sơ, số công văn, số hồ sơ, tên tệp"
          aria-label="Tìm trong kho lưu trữ"
          onChange={(event) => setSearch(event.target.value)}
        />
        <label className={styles.checkRow}>
          <input type="checkbox" checked={onlyArchived} onChange={(event) => setOnlyArchived(event.target.checked)} /> Chỉ hồ sơ đã lưu trữ
        </label>
      </div>
      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}
      <div className={styles.archive}>
        <nav className={styles.archiveTree} aria-label="Cây lưu trữ">
          <div className={styles.treeRoot}>
            <FolderOpen size={15} /> {tree?.rootName ?? 'Văn thư'}
            <span className={styles.hint}>{total} hồ sơ</span>
          </div>
          {!filtered ? (
            <p className={styles.muted}>Đang tải…</p>
          ) : filtered.length === 0 ? (
            <p className={styles.muted}>{searching ? 'Không có hồ sơ nào khớp.' : 'Chưa có hồ sơ nào.'}</p>
          ) : (
            <ul className={styles.tree}>
              {filtered.map((year) => {
                const yearKey = `y-${year.year}`;
                return (
                  <li key={yearKey}>
                    <button type="button" className={styles.treeRow} aria-expanded={isOpen(yearKey)} onClick={() => toggle(yearKey)}>
                      {isOpen(yearKey) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      {isOpen(yearKey) ? <FolderOpen size={15} /> : <Folder size={15} />} {year.year}
                    </button>
                    {isOpen(yearKey) ? (
                      <ul>
                        {year.groups.map((group) => {
                          const groupKey = `g-${year.year}-${group.direction}`;
                          return (
                            <li key={groupKey}>
                              <button type="button" className={styles.treeRow} aria-expanded={isOpen(groupKey)} onClick={() => toggle(groupKey)}>
                                {isOpen(groupKey) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                {isOpen(groupKey) ? <FolderOpen size={15} /> : <Folder size={15} />} {group.label}
                                <span className={styles.treeCount}>{group.dossiers.length}</span>
                              </button>
                              {isOpen(groupKey) ? (
                                <ul>
                                  {group.dossiers.map((item) => (
                                    <li key={item.letterId}>
                                      <button
                                        type="button"
                                        className={`${styles.treeRow} ${dossier?.letterId === item.letterId ? styles.treeRowActive : ''}`}
                                        title={item.folderName}
                                        onClick={() => setSelected({ kind: 'dossier', dossier: item })}
                                      >
                                        <Folder size={15} className={item.stage === 'archived' ? styles.treeArchived : undefined} />
                                        <span className={styles.treeLabel}>{item.folderName}</span>
                                        {item.files.length > 0 ? <span className={styles.treeCount}>{item.files.length}</span> : null}
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </nav>
        <section className={styles.archiveDetail}>
          {dossier ? (
            <DossierView dossier={dossier} onOpenLetter={onOpenLetter} onPreview={setPreview} />
          ) : (
            <div className={styles.archiveEmpty}>
              <FolderOpen size={28} />
              <p>Chọn một hồ sơ bên trái để xem tệp. Tệp lưu tại kho tài liệu của Hệ dùng chung, thư mục Văn thư.</p>
            </div>
          )}
        </section>
      </div>
      <FilePreview target={preview} onClose={() => setPreview(undefined)} />
    </div>
  );
}

function DossierView({
  dossier,
  onOpenLetter,
  onPreview,
}: {
  readonly dossier: ArchiveDossier;
  readonly onOpenLetter: (letterId: string) => void;
  readonly onPreview: (target: PreviewTarget) => void;
}) {
  const asAttachment = (file: ArchiveFile): LetterAttachment => ({
    ...file,
    uploadedBy: '',
    canDelete: false,
    canVersion: false,
  });
  return (
    <>
      <div className={styles.dossierHead}>
        <div className={styles.listMain}>
          <b>{dossier.folderName}</b>
          <span className={styles.hint}>
            {dossier.direction === 'incoming' ? 'Công văn đến' : 'Công văn đi'} {dossier.displayNo}
            {dossier.partner ? ` · ${dossier.partner}` : ''} · {formatDay(dossier.receivedOn)}
          </span>
        </div>
        <span className={`${styles.tag} ${styles[`tone-${stageTone(dossier.stage)}`]}`}>
          {dossier.archiveCode ? `Hồ sơ ${dossier.archiveCode}` : dossier.stageLabel}
        </span>
      </div>
      <div className={styles.formActions} style={{ borderTop: 0, paddingTop: 0, justifyContent: 'flex-start' }}>
        <button type="button" className={styles.buttonGhost} onClick={() => onOpenLetter(dossier.letterId)}>
          Mở công văn
        </button>
      </div>
      {dossier.files.length === 0 ? (
        <p className={styles.muted}>Hồ sơ chưa có tệp nào.</p>
      ) : (
        <div className={styles.list}>
          {dossier.files.map((file) => {
            const ready = file.sizeBytes !== undefined;
            return (
              <div key={file.id} className={styles.listRow}>
                <FileText size={18} className={styles.fileIcon} />
                <div className={styles.listMain}>
                  {ready ? (
                    <button type="button" className={styles.fileName} onClick={() => onPreview({ letterId: dossier.letterId, file: asAttachment(file) })}>
                      {file.fileName}
                    </button>
                  ) : (
                    <b>{file.fileName}</b>
                  )}
                  <span className={styles.hint}>
                    {ATTACHMENT_KIND_LABELS[file.kind]}
                    {file.unitName ? ` · ${file.unitName}` : ''} · {file.versionNo > 1 ? `Phiên bản ${file.versionNo} · ` : ''}
                    {formatBytes(file.sizeBytes)} · {formatDateTime(file.createdAt)}
                  </span>
                </div>
                {ready ? (
                  <div className={styles.listActions}>
                    <button type="button" className={styles.buttonSmall} onClick={() => onPreview({ letterId: dossier.letterId, file: asAttachment(file) })}>
                      <Eye size={13} /> Xem
                    </button>
                    <button
                      type="button"
                      className={styles.buttonSmall}
                      aria-label={`Tải ${file.fileName}`}
                      onClick={() =>
                        void downloadAttachment(dossier.letterId, file.id).catch((cause) => toast.error(errorMessage(cause, 'Không tải được tệp.')))
                      }
                    >
                      <Download size={13} />
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
