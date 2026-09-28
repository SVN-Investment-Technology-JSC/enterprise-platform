'use client';

import type { DocumentFolder } from '@enterprise-platform/contracts-workspace';
import { ChevronDown, ChevronRight, Folder, FolderOpen, HardDrive, Layers } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import styles from '../workspace.module.scss';

/** Nơi người dùng đang đứng trong kho tài liệu. */
export type FolderTarget =
  | { readonly kind: 'root' }
  | { readonly kind: 'folder'; readonly id: string }
  /** Nhóm ảo gom các thư mục gốc trùng tên của nhiều dự án. */
  | { readonly kind: 'group'; readonly name: string };

export interface FolderTreeProps {
  readonly folders: readonly DocumentFolder[];
  readonly selected: FolderTarget;
  readonly onSelect: (target: FolderTarget) => void;
  /** Số tài liệu theo từng thư mục, để hiện ngay cạnh tên. */
  readonly counts?: Readonly<Record<string, number>>;
  /** Nhãn dự án theo id, hiện thay cho tên thư mục ở cấp dự án. */
  readonly projectLabels?: Readonly<Record<string, string>>;
  /** Tên đầy đủ của dự án (mã · tên), dùng cho mục cấp dự án trong nhóm. */
  readonly projectTitles?: Readonly<Record<string, string>>;
}

/**
 * Cây thư mục tài liệu, cột trái của màn Tài liệu.
 *
 * Kho của mỗi dự án là một nhánh riêng trong cơ sở dữ liệu, nên ba dự án cùng
 * có thư mục "Hồ sơ dự án" sẽ ra ba thư mục gốc trùng tên nằm cạnh nhau. Cây
 * này **gom chúng theo tên**: một nút "Hồ sơ dự án", bên trong mỗi dự án một
 * mục — đúng hình dạng mà kho dùng chung đang có (`Hợp đồng / DA-001 · … /
 * CV-007 · …`), nên người dùng chỉ phải học một quy tắc.
 */
export function FolderTree({
  folders,
  selected,
  onSelect,
  counts = {},
  projectLabels = {},
  projectTitles = {},
}: FolderTreeProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const childrenOf = useMemo(() => {
    const map = new Map<string, DocumentFolder[]>();
    for (const folder of folders) {
      const key = folder.parentId ?? '';
      const list = map.get(key);
      if (list) list.push(folder);
      else map.set(key, [folder]);
    }
    for (const list of map.values()) {
      list.sort((left, right) => left.name.localeCompare(right.name, 'vi'));
    }
    return map;
  }, [folders]);

  /** Thư mục gốc, tách làm hai: kho dùng chung và kho của từng dự án. */
  const { shared, groups } = useMemo(() => {
    const roots = childrenOf.get('') ?? [];
    const sharedRoots = roots.filter((folder) => !folder.projectId);
    const byName = new Map<string, DocumentFolder[]>();
    for (const folder of roots.filter((item) => item.projectId)) {
      const key = folder.name.trim().toLowerCase();
      const list = byName.get(key);
      if (list) list.push(folder);
      else byName.set(key, [folder]);
    }
    return {
      shared: sharedRoots,
      groups: [...byName.values()].sort((left, right) =>
        left[0].name.localeCompare(right[0].name, 'vi'),
      ),
    };
  }, [childrenOf]);

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const isOpen = (key: string) => !collapsed.has(key);

  const row = (
    key: string,
    depth: number,
    options: {
      readonly label: string;
      readonly badge?: string;
      readonly count?: number;
      readonly active: boolean;
      readonly hasChildren: boolean;
      readonly icon: 'drive' | 'folder' | 'group';
      readonly dataFolder?: string;
      readonly onClick: () => void;
      readonly children?: ReactNode;
    },
  ) => (
    <li key={key}>
      <div className={styles.treeRow} style={{ paddingLeft: `${depth * 0.9 + 0.4}rem` }}>
        {options.hasChildren ? (
          <button
            type="button"
            className={styles.treeToggle}
            aria-label={isOpen(key) ? 'Thu gọn thư mục' : 'Mở thư mục'}
            aria-expanded={isOpen(key)}
            onClick={() => toggle(key)}
          >
            {isOpen(key) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className={styles.treeToggleSpacer} aria-hidden />
        )}
        <button
          type="button"
          className={options.active ? styles.treeNodeActive : styles.treeNode}
          title={options.label}
          data-folder={options.dataFolder}
          onClick={options.onClick}
        >
          {options.icon === 'drive' ? (
            <HardDrive size={14} aria-hidden />
          ) : options.icon === 'group' ? (
            <Layers size={14} aria-hidden />
          ) : options.active ? (
            <FolderOpen size={14} aria-hidden />
          ) : (
            <Folder size={14} aria-hidden />
          )}
          <span className={styles.treeTitle}>{options.label}</span>
          {options.badge ? <span className={styles.folderScope}>{options.badge}</span> : null}
          {options.count ? <span className={styles.treePercent}>{options.count}</span> : null}
        </button>
      </div>
      {options.hasChildren && isOpen(key) ? (
        <ul className={styles.treeList}>{options.children}</ul>
      ) : null}
    </li>
  );

  /** Vẽ một thư mục thật và cả nhánh con của nó. */
  const renderFolder = (
    folder: DocumentFolder,
    depth: number,
    labelOverride?: string,
  ): ReactNode => {
    const kids = childrenOf.get(folder.id) ?? [];
    return row(folder.id, depth, {
      label: labelOverride ?? folder.name,
      badge: labelOverride ? undefined : projectLabels[folder.projectId ?? ''],
      count: counts[folder.id],
      active: selected.kind === 'folder' && selected.id === folder.id,
      hasChildren: kids.length > 0,
      icon: 'folder',
      dataFolder: folder.id,
      onClick: () => onSelect({ kind: 'folder', id: folder.id }),
      children: kids.map((child) => renderFolder(child, depth + 1)),
    });
  };

  return (
    <div className={styles.tree}>
      <ul className={styles.treeList}>
        {row('all', 0, {
          label: 'Tất cả tài liệu',
          active: selected.kind === 'root',
          hasChildren: false,
          icon: 'drive',
          dataFolder: 'all',
          onClick: () => onSelect({ kind: 'root' }),
        })}

        {shared.map((folder) => renderFolder(folder, 0))}

        {groups.map((members) =>
          row(`group:${members[0].name}`, 0, {
            label: members[0].name,
            badge: `${members.length} dự án`,
            active: selected.kind === 'group' && selected.name === members[0].name,
            hasChildren: true,
            icon: 'group',
            dataFolder: `group:${members[0].name}`,
            onClick: () => onSelect({ kind: 'group', name: members[0].name }),
            // Mỗi dự án một mục, mang tên dự án thay cho tên thư mục — tên thư
            // mục đã nằm ở nút cha, lặp lại ba lần không nói thêm điều gì.
            children: members.map((folder) =>
              renderFolder(
                folder,
                1,
                projectTitles[folder.projectId ?? ''] ??
                  projectLabels[folder.projectId ?? ''] ??
                  folder.name,
              ),
            ),
          }),
        )}
      </ul>
      {folders.length === 0 ? <p className={styles.treeEmpty}>Chưa có thư mục nào.</p> : null}
    </div>
  );
}
