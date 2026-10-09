'use client';

import type { DocumentFolder, DocumentSummary } from '@enterprise-platform/contracts-workspace';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  HardDrive,
  Link2,
  Plus,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import styles from '../workspace.module.scss';

/** Nơi người dùng đang đứng trong kho tài liệu. */
export type FolderTarget =
  | { readonly kind: 'root' }
  | { readonly kind: 'folder'; readonly id: string }
  /** Một dự án: các thư mục cấp dự án của nó, dù nằm ở gốc hay trong kho đơn vị. */
  | { readonly kind: 'project'; readonly projectId: string };

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
  /** Có thì mỗi thư mục có nút "+" tạo thư mục con, hiện khi rê chuột. */
  readonly onAddChild?: (folder: DocumentFolder) => void;
  /** Có thì bấm chuột phải vào thư mục mở menu Đổi tên / Chuyển / Xoá. */
  readonly onFolderMenu?: (folder: DocumentFolder, x: number, y: number) => void;
  /**
   * Tài liệu để hiện thành dòng tệp dưới thư mục của phần "Theo dự án": chọn
   * dự án là thấy ngay thư mục và tệp của nó. Vắng thì cây chỉ có thư mục.
   */
  readonly documents?: readonly DocumentSummary[];
  /** Tài liệu đang mở ở khung chi tiết, để tô dòng tệp tương ứng. */
  readonly selectedDocumentId?: string;
  readonly onOpenDocument?: (document: DocumentSummary, folderId: string) => void;
}

/** Số dòng tệp tối đa dưới một thư mục; còn lại xem ở danh sách bên phải. */
const FILES_PER_FOLDER = 30;

/**
 * Cây thư mục tài liệu, cột trái của màn Tài liệu.
 *
 * Hai phần:
 * - **Kho đơn vị**: các thư mục không thuộc dự án nào, đủ cả nhánh con — kể cả
 *   thư mục dự án mà luồng tải lên tự xếp vào (`Hợp đồng / DA-001 · … /
 *   CV-007 · …`).
 * - **Theo dự án**: mỗi dự án một mục, bên dưới là các thư mục cấp dự án của nó
 *   — gốc kho riêng của dự án, và cả thư mục dự án nằm trong kho đơn vị (khi
 *   đó hiện bằng tên thư mục đơn vị chứa nó, vì tên thư mục đã là tên dự án).
 *   Đây chỉ là một cách nhìn khác vào cùng các thư mục, không phải bản sao.
 */
export function FolderTree({
  folders,
  selected,
  onSelect,
  counts = {},
  projectLabels = {},
  projectTitles = {},
  onAddChild,
  onFolderMenu,
  documents,
  selectedDocumentId,
  onOpenDocument,
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

  const byId = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);

  /** Tài liệu theo thư mục, gồm cả tài liệu được tham chiếu vào thư mục đó. */
  const filesOf = useMemo(() => {
    const map = new Map<string, { document: DocumentSummary; isRef: boolean }[]>();
    const push = (folderId: string, document: DocumentSummary, isRef: boolean) => {
      const list = map.get(folderId);
      if (list) list.push({ document, isRef });
      else map.set(folderId, [{ document, isRef }]);
    };
    for (const document of documents ?? []) {
      push(document.folderId, document, false);
      for (const refFolderId of document.refFolderIds ?? []) push(refFolderId, document, true);
    }
    for (const list of map.values()) {
      list.sort((left, right) => left.document.name.localeCompare(right.document.name, 'vi'));
    }
    return map;
  }, [documents]);

  /** Thư mục gốc của kho đơn vị. */
  const shared = useMemo(
    () => (childrenOf.get('') ?? []).filter((folder) => !folder.projectId),
    [childrenOf],
  );

  /** Mỗi dự án có thư mục, kèm các thư mục cấp dự án của nó. */
  const projects = useMemo(
    () => projectFolderGroups(folders, byId, projectTitles),
    [folders, byId, projectTitles],
  );

  /**
   * Thư mục mang tên một dự án: thuộc dự án mà cha không thuộc dự án nào (đứng
   * dưới kho đơn vị), hoặc là gốc kho của dự án. Mục này hiện ô viết tắt màu
   * của dự án thay cho biểu tượng thư mục, để mắt tìm dự án nhanh.
   */
  const isProjectLevel = (folder: DocumentFolder) => isProjectLevelFolder(folder, byId);

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
      readonly icon: 'drive' | 'folder' | 'project';
      readonly projectId?: string;
      /** Thư mục thật (không phải mục "Tất cả" hay nhóm), để mở menu và nút "+". */
      readonly folder?: DocumentFolder;
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
          onContextMenu={
            options.folder && onFolderMenu
              ? (event) => {
                  event.preventDefault();
                  onFolderMenu(options.folder as DocumentFolder, event.clientX, event.clientY);
                }
              : undefined
          }
        >
          {options.icon === 'drive' ? (
            <HardDrive size={14} aria-hidden />
          ) : options.icon === 'project' ? (
            <span
              className={styles.treeProjectBadge}
              style={{ background: projectColor(options.projectId ?? '') }}
              aria-hidden
            >
              {initialsOf(projectTitles[options.projectId ?? ''] ?? options.label)}
            </span>
          ) : options.active ? (
            <FolderOpen size={14} className={styles.treeFolderIcon} aria-hidden />
          ) : (
            <Folder size={14} className={styles.treeFolderIcon} aria-hidden />
          )}
          <span className={styles.treeTitle}>{options.label}</span>
          {options.badge ? <span className={styles.folderScope}>{options.badge}</span> : null}
          {options.count ? <span className={styles.treeCount}>{options.count}</span> : null}
        </button>
        {options.folder && onAddChild && options.folder.depth < 4 ? (
          <button
            type="button"
            className={styles.treeAdd}
            aria-label={`Thư mục con mới trong ${options.label}`}
            title="Thư mục con mới"
            onClick={() => onAddChild(options.folder as DocumentFolder)}
          >
            <Plus size={13} />
          </button>
        ) : null}
      </div>
      {options.hasChildren && isOpen(key) ? (
        <ul className={styles.treeList}>{options.children}</ul>
      ) : null}
    </li>
  );

  /** Các dòng tệp của một thư mục trong phần "Theo dự án". */
  const fileRows = (folder: DocumentFolder, depth: number, keyPrefix: string): ReactNode[] => {
    if (!keyPrefix || !onOpenDocument) return [];
    const files = filesOf.get(folder.id) ?? [];
    const rows: ReactNode[] = files.slice(0, FILES_PER_FOLDER).map(({ document, isRef }) => (
      <li key={`${keyPrefix}file:${folder.id}:${document.id}`}>
        <div className={styles.treeRow} style={{ paddingLeft: `${depth * 0.9 + 0.4}rem` }}>
          <span className={styles.treeToggleSpacer} aria-hidden />
          <button
            type="button"
            className={
              selectedDocumentId === document.id ? styles.treeNodeActive : styles.treeNode
            }
            title={isRef ? `${document.name} (tham chiếu)` : document.name}
            data-document={document.id}
            onClick={() => onOpenDocument(document, folder.id)}
          >
            {isRef ? (
              <Link2 size={14} className={styles.treeFileIcon} aria-hidden />
            ) : (
              <FileText size={14} className={styles.treeFileIcon} aria-hidden />
            )}
            <span className={styles.treeTitle}>{document.name}</span>
          </button>
        </div>
      </li>
    ));
    if (files.length > FILES_PER_FOLDER) {
      rows.push(
        <li key={`${keyPrefix}more:${folder.id}`} className={styles.treeMore}>
          <button
            type="button"
            className={styles.linkButton}
            style={{ paddingLeft: `${depth * 0.9 + 0.4 + 1.6}rem` }}
            onClick={() => onSelect({ kind: 'folder', id: folder.id })}
          >
            … {files.length - FILES_PER_FOLDER} tài liệu khác
          </button>
        </li>,
      );
    }
    return rows;
  };

  /** Vẽ một thư mục thật và cả nhánh con của nó. */
  const renderFolder = (
    folder: DocumentFolder,
    depth: number,
    labelOverride?: string,
    keyPrefix = '',
  ): ReactNode => {
    // Trong kho đơn vị bỏ qua thư mục cấp dự án: nó đã hiện dưới dự án của
    // nó ở phần "Theo dự án", bày hai nơi chỉ làm cây dài gấp đôi.
    const kids = (childrenOf.get(folder.id) ?? []).filter(
      (child) => Boolean(keyPrefix) || !isProjectLevel(child),
    );
    // Trong phần "Theo dự án" dòng dự án phía trên đã có ô viết tắt màu.
    const project = !keyPrefix && isProjectLevel(folder);
    return row(`${keyPrefix}${folder.id}`, depth, {
      label: labelOverride ?? folder.name,
      // Thư mục của dự án nằm dưới mục cấp dự án đã có ô viết tắt màu, nên
      // không lặp mã dự án trên từng thư mục con nữa.
      badge: undefined,
      count: counts[folder.id],
      active: selected.kind === 'folder' && selected.id === folder.id,
      hasChildren: kids.length > 0 || (Boolean(keyPrefix) && (filesOf.get(folder.id)?.length ?? 0) > 0),
      icon: project ? 'project' : 'folder',
      projectId: folder.projectId,
      folder,
      dataFolder: folder.id,
      onClick: () => onSelect({ kind: 'folder', id: folder.id }),
      children: [
        ...kids.map((child) => renderFolder(child, depth + 1, undefined, keyPrefix)),
        ...fileRows(folder, depth + 1, keyPrefix),
      ],
    });
  };

  return (
    <div className={styles.tree}>
      <ul className={styles.treeList}>
        {shared.length > 0 ? (
          <li className={styles.treeHeading} aria-hidden>
            Kho đơn vị
          </li>
        ) : null}
        {shared.map((folder) => renderFolder(folder, 0))}
        {projects.length > 0 ? (
          <li className={styles.treeHeading} aria-hidden>
            Theo dự án
          </li>
        ) : null}
        {projects.map(({ projectId, tops }) => {
          const title = projectNameOf(projectTitles[projectId]) ?? projectLabels[projectId] ?? 'Dự án';
          const total = folders.reduce(
            (sum, folder) => sum + (folder.projectId === projectId ? (counts[folder.id] ?? 0) : 0),
            0,
          );
          // Dự án chỉ có một thư mục: dòng dự án chính là thư mục đó, các thư
          // mục con đưa thẳng lên dưới dự án thay vì lồng thêm một cấp.
          const only = tops.length === 1 ? tops[0] : undefined;
          const children = only
            ? [
                ...(childrenOf.get(only.id) ?? []).map((child) =>
                  renderFolder(child, 1, undefined, 'p:'),
                ),
                ...fileRows(only, 1, 'p:'),
              ]
            : tops.map((folder) => renderFolder(folder, 1, topLabel(folder, byId), 'p:'));
          return row(`project:${projectId}`, 0, {
            label: title,
            count: total || undefined,
            active: only
              ? selected.kind === 'folder' && selected.id === only.id
              : selected.kind === 'project' && selected.projectId === projectId,
            hasChildren: children.length > 0,
            icon: 'project',
            projectId,
            folder: only,
            dataFolder: `project:${projectId}`,
            onClick: () =>
              onSelect(only ? { kind: 'folder', id: only.id } : { kind: 'project', projectId }),
            children,
          });
        })}
      </ul>
      {folders.length === 0 ? <p className={styles.treeEmpty}>Chưa có thư mục nào.</p> : null}
    </div>
  );
}

/**
 * Thư mục cấp dự án: thuộc một dự án mà cha không thuộc dự án nào (nằm trong
 * kho đơn vị), hoặc là gốc kho riêng của dự án.
 */
export function isProjectLevelFolder(
  folder: DocumentFolder,
  byId: ReadonlyMap<string, DocumentFolder>,
): boolean {
  return Boolean(folder.projectId) && (!folder.parentId || !byId.get(folder.parentId)?.projectId);
}

/**
 * Tên hiện cho một thư mục cấp dự án đứng dưới dòng dự án.
 *
 * Thư mục nằm trong kho đơn vị thường mang chính tên dự án ("DA-001 · …"), lặp
 * lại dưới dòng dự án thì vô nghĩa; tên thư mục đơn vị chứa nó ("Hợp đồng")
 * mới cho biết nó là ngăn nào.
 */
export function topLabel(
  folder: DocumentFolder,
  byId: ReadonlyMap<string, DocumentFolder>,
): string {
  const parent = folder.parentId ? byId.get(folder.parentId) : undefined;
  return parent && !parent.projectId ? parent.name : folder.name;
}

/** Các dự án có thư mục, xếp theo tên, mỗi dự án kèm thư mục cấp dự án của nó. */
export function projectFolderGroups(
  folders: readonly DocumentFolder[],
  byId: ReadonlyMap<string, DocumentFolder>,
  projectTitles: Readonly<Record<string, string>>,
): readonly { readonly projectId: string; readonly tops: readonly DocumentFolder[] }[] {
  const byProject = new Map<string, DocumentFolder[]>();
  for (const folder of folders) {
    if (!folder.projectId || !isProjectLevelFolder(folder, byId)) continue;
    const list = byProject.get(folder.projectId);
    if (list) list.push(folder);
    else byProject.set(folder.projectId, [folder]);
  }
  return [...byProject.entries()]
    .map(([projectId, tops]) => ({
      projectId,
      tops: [...tops].sort((left, right) =>
        topLabel(left, byId).localeCompare(topLabel(right, byId), 'vi'),
      ),
    }))
    .sort((left, right) =>
      (projectTitles[left.projectId] ?? '').localeCompare(
        projectTitles[right.projectId] ?? '',
        'vi',
      ),
    );
}

/** "DA-024 · SCADA nhà máy Tân Ân" → "SCADA nhà máy Tân Ân". */
export function projectNameOf(title: string | undefined): string | undefined {
  if (!title) return undefined;
  const at = title.indexOf(' · ');
  return at >= 0 ? title.slice(at + 3) : title;
}

/** Màu ô viết tắt của dự án, cố định theo id để lần nào mở cũng cùng màu. */
const PROJECT_COLORS = ['#2563eb', '#db2777', '#b45309', '#047857', '#7c3aed', '#0e7490'];

function projectColor(projectId: string): string {
  let hash = 0;
  for (const char of projectId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PROJECT_COLORS[hash % PROJECT_COLORS.length];
}

/** Hai chữ đầu của tên dự án: "DA-024 · SCADA nhà máy Tân Ân" → "SÂ". */
function initialsOf(title: string): string {
  const name = title.includes(' · ') ? title.slice(title.indexOf(' · ') + 3) : title;
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0].charAt(0);
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : words[0].charAt(1);
  return `${first}${last}`.toUpperCase();
}
