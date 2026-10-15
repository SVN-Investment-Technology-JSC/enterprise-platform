'use client';

import { formatBytes, type SharedFolder } from '@enterprise-platform/contracts-shared';
import { ChevronRight, ChevronsDownUp, Folder, Library } from 'lucide-react';
import { useMemo } from 'react';
import { flattenTree } from '../library.model';
import styles from '../shared.module.scss';

export interface FolderTreeProps {
  readonly folders: readonly SharedFolder[];
  readonly currentId?: string;
  readonly expanded: ReadonlySet<string>;
  readonly onToggle: (folderId: string) => void;
  readonly onCollapseAll: () => void;
  readonly onOpen: (folderId: string | undefined) => void;
}

export function FolderTree({ folders, currentId, expanded, onToggle, onCollapseAll, onOpen }: FolderTreeProps) {
  const rows = useMemo(() => flattenTree(folders, expanded), [folders, expanded]);
  const totalBytes = useMemo(
    () => folders.filter((folder) => !folder.parentId).reduce((sum, folder) => sum + folder.totalBytes, 0),
    [folders],
  );

  return (
    <aside className={`${styles.panel} ${styles.tree}`} aria-label="Cây thư mục">
      <div className={styles.panelHead}>
        <h2>Cây thư mục</h2>
        <button type="button" className={styles.iconButton} aria-label="Thu gọn tất cả" onClick={onCollapseAll}>
          <ChevronsDownUp size={13} />
        </button>
      </div>
      <div className={styles.treeBody} role="tree">
        <button
          type="button"
          role="treeitem"
          aria-current={currentId ? 'false' : 'true'}
          className={`${styles.treeRow} ${styles.treeRoot}`}
          onClick={() => onOpen(undefined)}
        >
          <Library size={14} className={styles.treeIcon} aria-hidden />
          <span className={styles.treeName}>Tài liệu công ty</span>
          <span className={styles.treeMeta}>{formatBytes(totalBytes)}</span>
        </button>
        {rows.map(({ folder, level, hasChildren, expanded: open }) => (
          <div
            key={folder.id}
            role="treeitem"
            aria-expanded={hasChildren ? open : undefined}
            aria-current={folder.id === currentId ? 'true' : 'false'}
            className={styles.treeRow}
            style={{ paddingLeft: 10 + (level + 1) * 14 }}
            tabIndex={0}
            onClick={() => onOpen(folder.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onOpen(folder.id);
              if (event.key === 'ArrowRight' && hasChildren && !open) onToggle(folder.id);
              if (event.key === 'ArrowLeft' && open) onToggle(folder.id);
            }}
          >
            <button
              type="button"
              className={styles.treeChevron}
              data-open={open}
              data-leaf={!hasChildren}
              aria-label={open ? 'Thu gọn' : 'Mở rộng'}
              tabIndex={-1}
              onClick={(event) => {
                event.stopPropagation();
                onToggle(folder.id);
              }}
            >
              <ChevronRight size={13} />
            </button>
            <Folder size={14} className={styles.treeIcon} aria-hidden />
            <span className={styles.treeName} title={folder.name}>
              {folder.name}
            </span>
            {folder.totalDocumentCount ? (
              <span className={styles.treeMeta}>{folder.totalDocumentCount.toLocaleString('vi-VN')}</span>
            ) : null}
          </div>
        ))}
      </div>
    </aside>
  );
}
