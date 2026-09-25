'use client';

import {
  ALLOWED_DOCUMENT_CONTENT_TYPES,
  DOCUMENT_MAX_BYTES,
  type DocumentDetail,
  type DocumentFolder,
  type DocumentLinkEntityType,
  type DocumentSummary,
  type ProjectSummary,
  type WorkItem,
} from '@enterprise-platform/contracts-workspace';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import {
  Download,
  FilePlus2,
  Folder,
  FolderPlus,
  Layers,
  History,
  Link2,
  Lock,
  LockOpen,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../workspace-api';
import { formatDateTime } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { Dialog, Field } from './dialog';
import { FolderTree } from './folder-tree';
import { useDirectory } from './use-directory';

export interface DocumentPanelProps {
  /** Rỗng nghĩa là trang Tài liệu chung: cả tài liệu dự án lẫn cấp đơn vị. */
  readonly projectId?: string;
  /** Có giá trị thì chỉ hiện tài liệu đã gắn vào thực thể đó. */
  readonly linkedTo?: { entityType: DocumentLinkEntityType; entityId: string };
  readonly canWrite: boolean;
  /**
   * Được xoá tài liệu và thư mục.
   *
   * Mặc định tắt: chỉ quản trị tenant, hoặc người được Platform cấp
   * `workspace.document.delete`, mới thấy nút xoá. Server vẫn kiểm lại — đây
   * chỉ là chuyện ẩn hiện.
   */
  readonly canDelete?: boolean;
  readonly currentUserId: string;
  /** Ẩn cây thư mục khi nhúng làm tab trong trang Dự án. */
  readonly compact?: boolean;
  /**
   * Công việc của dự án, để hiện tên nơi tài liệu đang gắn và cho gắn thêm.
   * Vắng (trang Tài liệu chung) thì chỉ hiện mã thực thể, không cho gắn.
   */
  readonly workItems?: readonly WorkItem[];
}

/**
 * Kho tài liệu.
 *
 * Dùng chung cho trang Tài liệu và tab Tài liệu trong trang Dự án — cùng dữ
 * liệu, chỉ khác phạm vi lọc, nên không có lý do dựng hai component.
 *
 * **Tệp không bao giờ đi qua API server.** Tạo tài liệu trả về một URL ký
 * trước; trình duyệt tự `PUT` thẳng lên kho lưu trữ.
 */
export function DocumentPanel({
  projectId,
  linkedTo,
  canWrite,
  canDelete = false,
  currentUserId,
  compact = false,
  workItems,
}: DocumentPanelProps) {
  const directory = useDirectory();
  const [folders, setFolders] = useState<readonly DocumentFolder[]>([]);
  const [documents, setDocuments] = useState<readonly DocumentSummary[]>([]);
  const [folderId, setFolderId] = useState<string>();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<DocumentDetail>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [newVersionFor, setNewVersionFor] = useState<DocumentDetail>();
  const [attachOpen, setAttachOpen] = useState(false);
  const [linkTarget, setLinkTarget] = useState('');
  /** Nhóm dự án đang mở (thư mục gốc trùng tên của nhiều dự án). */
  const [group, setGroup] = useState<string>();
  /** Số tài liệu theo thư mục, hiện cạnh tên trên cây bên trái. */
  const [folderCounts, setFolderCounts] = useState<Record<string, number>>({});
  /* --- Bộ lọc của trang Tài liệu tổng quan (bản đủ, không dùng ở tab dự án) --- */
  const [projectList, setProjectList] = useState<readonly ProjectSummary[]>([]);
  const [filterProjectId, setFilterProjectId] = useState('');
  const [projectItems, setProjectItems] = useState<readonly WorkItem[]>([]);
  const [filterWorkItemId, setFilterWorkItemId] = useState('');
  const [filterKind, setFilterKind] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const workItemById = useMemo(
    () => new Map((workItems ?? []).map((item) => [item.id, item])),
    [workItems],
  );
  // Đang xem tài liệu của một công việc: cho gắn tài liệu đã có sẵn trong dự án.
  const attachTo = linkedTo?.entityType === 'work_item' && projectId ? linkedTo : undefined;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      // Trang tổng quan có thêm bộ lọc dự án và công việc; tab trong trang Dự
      // án thì phạm vi đã cố định từ props.
      const scopeProjectId = projectId ?? (compact ? undefined : filterProjectId || undefined);
      const linked = linkedTo ?? (filterWorkItemId
        ? { entityType: 'work_item' as DocumentLinkEntityType, entityId: filterWorkItemId }
        : undefined);
      const [folderList, documentList] = await Promise.all([
        api.listFolders(projectId),
        api.listDocuments({
          projectId: scopeProjectId,
          folderId,
          search: search.trim() || undefined,
          linkedType: linked?.entityType,
          linkedId: linked?.entityId,
        }),
      ]);
      setFolders(folderList.items);
      setDocuments(documentList.items);
      setError(undefined);

      // Số tài liệu của từng thư mục cho cây bên trái. Phải hỏi riêng: danh
      // sách trên đã lọc theo thư mục đang mở nên không đếm được cho cây.
      if (!compact) {
        const all = await api
          .listDocuments({
            projectId,
            linkedType: linkedTo?.entityType,
            linkedId: linkedTo?.entityId,
          })
          .catch(() => undefined);
        if (all) {
          const counts: Record<string, number> = {};
          for (const document of all.items) {
            counts[document.folderId] = (counts[document.folderId] ?? 0) + 1;
          }
          setFolderCounts(counts);
        }
      }
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không tải được tài liệu.');
    } finally {
      setLoading(false);
    }
  }, [projectId, folderId, search, linkedTo?.entityType, linkedTo?.entityId, compact, filterProjectId, filterWorkItemId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * Đổi chỗ đứng thì đóng khối thông tin tài liệu.
   *
   * Khối đó mô tả một tệp cụ thể; sang thư mục khác mà nó còn nằm đó thì người
   * dùng tưởng tệp ấy thuộc thư mục mới.
   */
  useEffect(() => {
    setSelected(undefined);
  }, [folderId, group, filterProjectId, filterWorkItemId]);

  const open = async (documentId: string) => {
    try {
      setSelected(await api.getDocument(documentId));
      setError(undefined);
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không mở được tài liệu.');
    }
  };

  const act = async (operation: () => Promise<unknown>, fallback: string) => {
    setError(undefined);
    try {
      await operation();
      await reload();
      if (selected) await open(selected.id);
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? fallback);
    }
  };

  const download = async (documentId: string, versionId?: string) => {
    setError(undefined);
    try {
      const ticket = await api.getDownloadTicket(documentId, versionId);
      // URL đã ký tự mang quyền; mở tab mới thay vì điều hướng trang hiện tại.
      window.open(ticket.downloadUrl, '_blank', 'noopener');
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không tải xuống được.');
    }
  };

  /* ------------------------------------------------- Bộ lọc trang tổng quan */

  // Danh sách dự án cho ô lọc; chỉ trang tổng quan mới cần.
  useEffect(() => {
    if (compact) return;
    api
      .listProjects({ pageSize: 100 })
      .then((page) => setProjectList(page.items))
      .catch(() => setProjectList([]));
  }, [compact]);

  // Công việc của dự án đang lọc, để lọc tiếp theo công việc.
  useEffect(() => {
    if (compact || !filterProjectId) {
      setProjectItems([]);
      setFilterWorkItemId('');
      return;
    }
    api
      .listWorkItems(filterProjectId)
      .then((tree) => setProjectItems(tree.items))
      .catch(() => setProjectItems([]));
  }, [compact, filterProjectId]);

  /** Tên đầy đủ "mã · tên" của dự án, dùng cho cấp dự án trong nhóm thư mục. */
  const projectTitles = useMemo(() => {
    const map: Record<string, string> = {};
    for (const project of projectList) map[project.id] = `${project.code} · ${project.name}`;
    return map;
  }, [projectList]);

  const projectLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const project of projectList) map[project.id] = project.code;
    return map;
  }, [projectList]);

  const visibleFolders = useMemo(() => {
    const active = folders.filter((folder) => folder.isActive);
    if (!filterProjectId) return active;
    // Lọc theo dự án: giữ thư mục của dự án đó, bỏ kho của dự án khác. Thư mục
    // cấp đơn vị vẫn giữ vì nó là đường đi tới thư mục con của dự án.
    const keep = new Set(
      active.filter((folder) => folder.projectId === filterProjectId).map((folder) => folder.id),
    );
    let grew = true;
    while (grew) {
      grew = false;
      for (const folder of active) {
        if (folder.parentId && keep.has(folder.id) && !keep.has(folder.parentId)) {
          keep.add(folder.parentId);
          grew = true;
        }
      }
    }
    return active.filter((folder) => keep.has(folder.id));
  }, [folders, filterProjectId]);

  /**
   * Lọc nốt hai tiêu chí mà API không nhận: loại tệp và "chỉ của tôi".
   *
   * Hai thứ này đọc thẳng từ dữ liệu đã tải nên lọc tại chỗ, không cần thêm
   * tham số mới cho endpoint.
   */
  const visibleDocuments = useMemo(() => {
    let rows = documents;
    if (filterKind) {
      rows = rows.filter((document) => kindOf(document) === filterKind);
    }
    if (onlyMine) {
      rows = rows.filter(
        (document) =>
          document.createdBy === currentUserId || document.lockedByUserId === currentUserId,
      );
    }
    return rows;
  }, [documents, filterKind, onlyMine, currentUserId]);

  /** Đường dẫn từ gốc tới thư mục đang mở, để hiện thanh vị trí kiểu Explorer. */
  const path = useMemo(() => {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const chain: DocumentFolder[] = [];
    let current = folderId ? byId.get(folderId) : undefined;
    while (current) {
      chain.unshift(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return chain;
  }, [folders, folderId]);

  /**
   * Thư mục hiện ở khung bên phải.
   *
   * Đứng ở gốc thì chỉ thấy các thư mục gốc — như "This PC" của Windows chỉ
   * liệt kê ổ đĩa chứ không đổ hết tệp trong máy ra. Đứng trong một nhóm dự án
   * thì thấy các dự án của nhóm đó.
   */
  const subFolders = useMemo(() => {
    const sorted = (list: readonly DocumentFolder[]) =>
      [...list].sort((left, right) => left.name.localeCompare(right.name, 'vi'));
    if (group) {
      return sorted(
        visibleFolders.filter(
          (folder) =>
            !folder.parentId && folder.name.trim().toLowerCase() === group.trim().toLowerCase(),
        ),
      );
    }
    return sorted(visibleFolders.filter((folder) => (folder.parentId ?? undefined) === folderId));
  }, [visibleFolders, folderId, group]);

  /**
   * Các dòng thư mục ở khung bên phải.
   *
   * Ở gốc, ba thư mục cùng tên của ba dự án được gom thành **một** dòng nhóm,
   * đúng như cây bên trái — hai khung bày cùng một kho thì phải cùng một hình
   * dạng, nếu không người dùng tưởng mình nhìn hai thứ khác nhau.
   */
  const folderRows = useMemo((): readonly (
    | { readonly kind: 'folder'; readonly folder: DocumentFolder }
    | { readonly kind: 'group'; readonly name: string; readonly count: number }
  )[] => {
    if (compact || folderId || group) {
      return subFolders.map((folder) => ({ kind: 'folder' as const, folder }));
    }
    const rows: (
      | { kind: 'folder'; folder: DocumentFolder }
      | { kind: 'group'; name: string; count: number }
    )[] = [];
    const groups = new Map<string, { name: string; count: number }>();
    for (const folder of subFolders) {
      if (!folder.projectId) {
        rows.push({ kind: 'folder', folder });
        continue;
      }
      const key = folder.name.trim().toLowerCase();
      const existing = groups.get(key);
      if (existing) existing.count += 1;
      else groups.set(key, { name: folder.name, count: 1 });
    }
    for (const entry of groups.values()) rows.push({ kind: 'group', ...entry });
    return rows;
  }, [compact, folderId, group, subFolders]);

  /**
   * Danh sách phẳng chỉ xuất hiện khi **đang tìm kiếm**.
   *
   * Ngoài lúc tìm, khung bên phải luôn là nội dung của đúng một thư mục; gốc
   * thì chỉ có thư mục, không có tệp.
   */
  /*
   * Lọc là câu hỏi về **tài liệu**, không phải về thư mục, nên hễ có bộ lọc
   * nào đang bật thì khung bên phải chuyển sang danh sách phẳng — đúng như khi
   * tìm kiếm. Trước đây chỉ ô tìm mới làm vậy, nên đứng ở gốc mà chọn "lọc
   * theo công việc" thì màn hình vẫn chỉ có thư mục và trông như bộ lọc hỏng.
   */
  const flatSearch =
    !compact &&
    (search.trim().length > 0 ||
      filterWorkItemId.length > 0 ||
      filterKind.length > 0 ||
      onlyMine);
  const listedDocuments = useMemo(() => {
    if (compact || flatSearch) return visibleDocuments;
    if (!folderId) return [];
    return visibleDocuments.filter((document) => document.folderId === folderId);
  }, [compact, flatSearch, folderId, visibleDocuments]);

  /**
   * Bên trong thư mục còn bao nhiêu mục — thư mục con cộng tài liệu.
   *
   * Xoá chỉ chạy với thư mục rỗng, nên con số này quyết định nút xoá có bấm
   * được hay không, và hiện thẳng trong chú thích của nút.
   */
  const countInside = (folder: DocumentFolder): number =>
    visibleFolders.filter((item) => item.parentId === folder.id).length +
    (folderCounts[folder.id] ?? 0);

  /** Đường dẫn đầy đủ của một thư mục, để cột "Nơi lưu" khi tìm kiếm. */
  const pathOf = useMemo(() => {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    return (targetId: string): string => {
      const names: string[] = [];
      let cursor = byId.get(targetId);
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor.id)) {
        seen.add(cursor.id);
        names.unshift(cursor.name);
        cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
      }
      return names.join(' / ') || '—';
    };
  }, [folders]);

  const body = (
    <>
      <div className={styles.filterBar}>
        {compact ? (
          <Choice
            label="Lọc theo thư mục"
            value={folderId ?? ''}
            emptyOption="Tất cả thư mục"
            options={visibleFolders.map((folder) => ({
              value: folder.id,
              label: `${'— '.repeat(folder.depth)}${folder.name}${
                folder.projectId ? '' : ' (cấp đơn vị)'
              }`,
            }))}
            onChange={(value) => setFolderId(value || undefined)}
          />
        ) : null}

        <input
          type="search"
          value={search}
          placeholder="Tìm theo tên tài liệu"
          onChange={(event) => setSearch(event.target.value)}
        />

        {canWrite ? (
          <>
            <button
              type="button"
              className={styles.buttonPrimary}
              disabled={visibleFolders.length === 0}
              title={
                visibleFolders.length === 0
                  ? 'Cần có ít nhất một thư mục trước khi tải tài liệu lên.'
                  : undefined
              }
              onClick={() => setUploadOpen(true)}
            >
              <FilePlus2 size={14} /> Tải lên
            </button>
            {attachTo ? (
              <button
                type="button"
                className={styles.buttonGhost}
                onClick={() => setAttachOpen(true)}
              >
                <Link2 size={14} /> Gắn tài liệu có sẵn
              </button>
            ) : null}
            {/* Bản đủ có nút Thư mục mới ngay trên đầu cây bên trái. */}
          </>
        ) : null}

        <button
          type="button"
          className={styles.iconButton}
          aria-label="Tải lại"
          onClick={() => void reload()}
        >
          <RefreshCw size={15} />
        </button>

        <span className={styles.muted}>{visibleDocuments.length} tài liệu</span>
      </div>

      {/* Bộ lọc của trang tổng quan: kho gom mọi dự án nên cần thu hẹp nhanh. */}
      {compact ? null : (
        <div className={styles.filterBar}>
          <Choice
            label="Lọc theo dự án"
            value={filterProjectId}
            emptyOption="Mọi dự án"
            options={projectList.map((project) => ({
              value: project.id,
              label: `${project.code} · ${project.name}`,
            }))}
            onChange={(value) => {
              setFilterProjectId(value);
              setFolderId(undefined);
            }}
          />
          <Choice
            label="Lọc theo công việc"
            value={filterWorkItemId}
            emptyOption={filterProjectId ? 'Mọi công việc' : 'Chọn dự án trước'}
            disabled={!filterProjectId}
            options={projectItems.map((item) => ({
              value: item.id,
              label: `${item.code} · ${item.title}`,
            }))}
            onChange={setFilterWorkItemId}
          />
          <Choice
            label="Lọc theo loại tệp"
            value={filterKind}
            emptyOption="Mọi loại tệp"
            options={FILE_KINDS.map((kind) => ({ value: kind.value, label: kind.label }))}
            onChange={setFilterKind}
          />
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={onlyMine}
              onChange={(event) => setOnlyMine(event.target.checked)}
            />
            Chỉ tệp của tôi
          </label>
        </div>
      )}

      {/* Thanh vị trí: đang đứng ở đâu trong kho, bấm để quay lại cấp trên. */}
      {compact ? null : (
        <nav className={styles.explorerPath} aria-label="Vị trí trong kho tài liệu">
          <button
            type="button"
            onClick={() => {
              setGroup(undefined);
              setFolderId(undefined);
            }}
          >
            Tất cả tài liệu
          </button>
          {group ? (
            <span>
              <span className={styles.explorerPathSep} aria-hidden>
                /
              </span>
              <button type="button" onClick={() => setFolderId(undefined)}>
                {group}
              </button>
            </span>
          ) : null}
          {path.map((folder, index) => (
            <span key={folder.id}>
              <span className={styles.explorerPathSep} aria-hidden>
                /
              </span>
              <button
                type="button"
                onClick={() => {
                  setFolderId(folder.id);
                }}
              >
                {/* Trong một nhóm, cấp đầu tiên mang tên dự án chứ không phải
                    tên thư mục — tên thư mục đã là tên nhóm đứng trước rồi. */}
                {group && index === 0
                  ? (projectTitles[folder.projectId ?? ''] ?? folder.name)
                  : folder.name}
              </button>
            </span>
          ))}
        </nav>
      )}

      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}

      {listedDocuments.length === 0 && (compact || subFolders.length === 0) ? (
        <p className={styles.muted}>
          {loading
            ? 'Đang tải…'
            : flatSearch
              ? 'Không có tài liệu nào khớp bộ lọc.'
              : 'Thư mục này chưa có gì.'}
        </p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Tên tài liệu</th>
              {flatSearch ? <th>Nơi lưu</th> : null}
              <th>Phiên bản</th>
              <th>Tệp</th>
              <th>Cập nhật</th>
              <th>Trạng thái</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {/* Thư mục con đứng trước tệp, đúng thói quen của trình quản lý tệp. */}
            {compact || flatSearch
              ? null
              : folderRows.map((row) =>
                  row.kind === 'group' ? (
                    <tr key={`group:${row.name}`} className={styles.explorerFolderRow}>
                      <td>
                        <button
                          type="button"
                          className={styles.linkButton}
                          data-folder-row={`group:${row.name}`}
                          onClick={() => {
                            setFolderId(undefined);
                            setGroup(row.name);
                          }}
                        >
                          <Layers size={14} /> {row.name}
                        </button>
                      </td>
                      <td colSpan={4} className={styles.muted}>
                        Nhóm thư mục · {row.count} dự án
                      </td>
                      <td />
                    </tr>
                  ) : (
                    ((folder) => (
                  <tr key={folder.id} className={styles.explorerFolderRow}>
                    <td>
                      <button
                        type="button"
                        className={styles.linkButton}
                        data-folder-row={folder.id}
                        onClick={() => {
                          setGroup(undefined);
                          setFolderId(folder.id);
                        }}
                      >
                        <Folder size={14} />{' '}
                        {group ? (projectTitles[folder.projectId ?? ''] ?? folder.name) : folder.name}
                      </button>
                    </td>
                    <td colSpan={4} className={styles.muted}>
                      {folder.projectId
                        ? `Thư mục · ${projectLabels[folder.projectId] ?? 'dự án'}`
                        : 'Thư mục cấp đơn vị'}
                    </td>
                    <td>
                      {canDelete && countInside(folder) > 0 ? (
                        // Nói trước lý do thay vì để người dùng bấm rồi nhận lỗi.
                        <button
                          type="button"
                          className={styles.iconButton}
                          aria-label={`Không xoá được thư mục ${folder.name}`}
                          title={`Thư mục còn ${countInside(folder)} mục bên trong. Dọn hết rồi mới xoá được.`}
                          disabled
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : canDelete ? (
                        <Popconfirm
                          title={`Xoá thư mục "${folder.name}"?`}
                          description="Chỉ xoá được thư mục rỗng. Thư mục biến khỏi cây, tài liệu đã lưu trữ vẫn tra ngược được."
                          okText="Xoá thư mục"
                          okType="danger"
                          onConfirm={() =>
                            act(() => api.removeFolder(folder.id), 'Không xoá được thư mục.')
                          }
                        >
                          <button
                            type="button"
                            className={styles.iconButton}
                            aria-label={`Xoá thư mục ${folder.name}`}
                            title="Xoá thư mục"
                          >
                            <Trash2 size={14} />
                          </button>
                        </Popconfirm>
                      ) : null}
                    </td>
                  </tr>
                    ))(row.folder)
                  ),
                )}

            {listedDocuments.map((document) => {
              // `sizeBytes` rỗng nghĩa là chặng 2 chưa hoàn tất: server không
              // bao giờ được kho lưu trữ báo lại, nên đây là tín hiệu duy nhất.
              const pending = document.currentVersion?.sizeBytes == null;
              return (
                <tr key={document.id}>
                  <td>
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => void open(document.id)}
                    >
                      {document.name}
                    </button>
                  </td>
                  {flatSearch ? (
                    <td className={styles.muted}>
                      {pathOf(document.folderId)}
                      {document.projectId ? ` · ${projectLabels[document.projectId] ?? ''}` : ''}
                    </td>
                  ) : null}
                  <td>
                    v{document.currentVersion?.versionNo ?? 1}
                    <span className={styles.muted}> / {document.versionCount}</span>
                  </td>
                  <td>{document.currentVersion?.fileName ?? '—'}</td>
                  <td>{formatDateTime(document.updatedAt)}</td>
                  <td>
                    {pending ? (
                      <span className={styles.treeOverdue}>Chưa tải lên xong</span>
                    ) : document.lockedByUserId ? (
                      <span className={styles.badgeLocked}>
                        <Lock size={11} /> {directory.nameOf(document.lockedByUserId)}
                      </span>
                    ) : (
                      <span className={styles.muted}>Sẵn sàng</span>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label="Tải xuống"
                      title={pending ? 'Phiên bản này chưa tải lên xong' : 'Tải xuống'}
                      disabled={pending}
                      onClick={() => void download(document.id)}
                    >
                      <Download size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {selected ? (
        <section className={styles.panel}>
          {/* Tiêu đề bên trái, thao tác bên phải: ba nút này là việc người dùng
              tới đây để làm, không nên nằm lẫn vào phần mô tả. */}
          <div className={styles.documentHead}>
            <div className={styles.documentHeadText}>
              <h3>
                <History size={15} /> {selected.name}
              </h3>
              <p className={styles.muted}>{selected.description ?? 'Không có mô tả.'}</p>
            </div>

            {canWrite ? (
            <div className={styles.documentActions}>
              {selected.lockedByUserId ? (
                <button
                  type="button"
                  className={styles.buttonGhost}
                  onClick={() => void act(() => api.unlockDocument(selected.id), 'Không mở khoá được.')}
                >
                  <LockOpen size={14} /> Mở khoá
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.buttonGhost}
                  onClick={() => void act(() => api.lockDocument(selected.id), 'Không khoá được.')}
                >
                  <Lock size={14} /> Khoá để sửa
                </button>
              )}
              <button
                type="button"
                className={styles.buttonGhost}
                disabled={selected.lockedByUserId !== currentUserId}
                title={
                  selected.lockedByUserId === currentUserId
                    ? undefined
                    : 'Phải đang giữ khoá mới tạo được phiên bản mới.'
                }
                onClick={() => setNewVersionFor(selected)}
              >
                <FilePlus2 size={14} /> Phiên bản mới
              </button>
              {/* Gõ lại tên để xác nhận: tài liệu lưu trữ biến khỏi mọi danh
                  sách đang dùng, và nút này nằm sát các nút thao tác thường.
                  Chỉ người có quyền xoá mới thấy nút này. */}
              {!canDelete ? null : (
              <Popconfirm
                title={`Lưu trữ ${selected.name}?`}
                description="Tài liệu sẽ được đưa vào lưu trữ. Tệp gốc vẫn được giữ trên kho lưu trữ."
                okText="Lưu trữ"
                okType="danger"
                confirmInput={{ requiredText: selected.name, label: 'Gõ lại tên tài liệu' }}
                onConfirm={() => act(() => api.archiveDocument(selected.id), 'Không lưu trữ được.')}
              >
                <button type="button" className={styles.buttonDanger}>
                  <Trash2 size={14} /> Lưu trữ
                </button>
              </Popconfirm>
              )}
            </div>
            ) : null}
          </div>

          <h4 className={styles.subHeading}>Đang gắn với</h4>
          {selected.links.length === 0 ? (
            <p className={styles.muted}>Chưa gắn với dự án, công việc hay sự kiện nào.</p>
          ) : (
            <ul className={styles.memberList}>
              {selected.links.map((link) => (
                <li key={link.id}>
                  <span className={styles.memberName}>{linkLabel(link.entityType, link.entityId, workItemById)}</span>
                  <span className={styles.memberRole}>
                    {formatDateTime(link.createdAt)}
                    {canWrite ? (
                      <>
                        {' · '}
                        <Popconfirm
                          title="Gỡ liên kết này?"
                          description="Tài liệu vẫn còn trong kho; chỉ bỏ liên kết với nơi này."
                          okText="Gỡ"
                          okType="danger"
                          onConfirm={() =>
                            act(() => api.unlinkDocument(selected.id, link.id), 'Không gỡ được liên kết.')
                          }
                        >
                          <button type="button" className={styles.linkButton}>
                            Gỡ
                          </button>
                        </Popconfirm>
                      </>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canWrite && workItems && workItems.length > 0 ? (
            <div className={styles.filterBar}>
              <Choice
                label="Gắn vào công việc"
                value={linkTarget}
                emptyOption="— Gắn thêm vào công việc —"
                options={workItems
                  .filter(
                    (item) =>
                      !selected.links.some(
                        (link) => link.entityType === 'work_item' && link.entityId === item.id,
                      ),
                  )
                  .map((item) => ({ value: item.id, label: `${item.code} · ${item.title}` }))}
                onChange={setLinkTarget}
              />
              <button
                type="button"
                className={styles.buttonGhost}
                disabled={!linkTarget}
                onClick={() =>
                  void act(async () => {
                    await api.linkDocument(selected.id, { entityType: 'work_item', entityId: linkTarget });
                    setLinkTarget('');
                  }, 'Không gắn được tài liệu.')
                }
              >
                <Link2 size={14} /> Gắn
              </button>
            </div>
          ) : null}

          <h4 className={styles.subHeading}>Phiên bản</h4>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Phiên bản</th>
                <th>Tệp</th>
                <th>Ghi chú thay đổi</th>
                <th>Người tải</th>
                <th>Lúc</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {selected.versions.map((version) => (
                <tr key={version.id}>
                  <td>v{version.versionNo}</td>
                  <td>{version.fileName}</td>
                  <td>{version.changeNote ?? '—'}</td>
                  <td>{directory.nameOf(version.uploadedBy)}</td>
                  <td>{formatDateTime(version.createdAt)}</td>
                  <td>
                    {version.sizeBytes == null ? (
                      <span className={styles.treeOverdue}>Chưa tải lên xong</span>
                    ) : (
                      <button
                        type="button"
                        className={styles.linkButton}
                        onClick={() => void download(selected.id, version.id)}
                      >
                        Tải xuống
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <UploadDialog
        open={uploadOpen}
        folders={visibleFolders}
        defaultFolderId={folderId}
        linkedTo={linkedTo}
        // Đang xem tài liệu của một công việc: xếp tệp theo dự án và công việc.
        autoPath={
          projectId
            ? {
                projectId,
                workItemId:
                  linkedTo?.entityType === 'work_item' ? linkedTo.entityId : undefined,
              }
            : undefined
        }
        onClose={() => setUploadOpen(false)}
        onDone={() => void reload()}
      />

      {attachTo ? (
        <AttachDialog
          open={attachOpen}
          projectId={projectId as string}
          entityId={attachTo.entityId}
          alreadyLinked={documents.map((document) => document.id)}
          onClose={() => setAttachOpen(false)}
          onDone={() => void reload()}
        />
      ) : null}

      <NewVersionDialog
        document={newVersionFor}
        onClose={() => setNewVersionFor(undefined)}
        onDone={() => {
          void reload();
          if (newVersionFor) void open(newVersionFor.id);
        }}
      />

      <FolderDialog
        open={folderOpen}
        projectId={projectId}
        folders={visibleFolders}
        onClose={() => setFolderOpen(false)}
        onDone={() => void reload()}
      />
    </>
  );

  // Tab Tài liệu trong trang Dự án giữ một cột: cột đó đã hẹp sẵn vì còn chỗ
  // cho cây dự án và khung trao đổi.
  if (compact) return <div className={styles.tabBody}>{body}</div>;

  return (
    <div className={styles.explorer}>
      <aside className={styles.explorerTree}>
        <div className={styles.sidebarHead}>
          <span className={styles.sidebarHeadTitle}>Thư mục</span>
          {canWrite ? (
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Thư mục mới"
              title="Thư mục mới"
              onClick={() => setFolderOpen(true)}
            >
              <FolderPlus size={15} />
            </button>
          ) : null}
        </div>
        <FolderTree
          folders={visibleFolders}
          selected={
            folderId ? { kind: 'folder', id: folderId } : group ? { kind: 'group', name: group } : { kind: 'root' }
          }
          onSelect={(target) => {
            setGroup(target.kind === 'group' ? target.name : undefined);
            setFolderId(target.kind === 'folder' ? target.id : undefined);
          }}
          counts={folderCounts}
          projectLabels={projectLabels}
          projectTitles={projectTitles}
        />
      </aside>
      <div className={styles.explorerMain}>{body}</div>
    </div>
  );
}

/**
 * Luồng tải lên hai bước nhìn từ phía người dùng.
 *
 * Bước 1 gọi API để ghi siêu dữ liệu và lấy URL ký trước; bước 2 đẩy tệp
 * thẳng lên kho. Bước 2 hỏng thì bản ghi phiên bản vẫn tồn tại với
 * `sizeBytes` rỗng, và danh sách hiện nhãn "Chưa tải lên xong".
 */
export function UploadDialog({
  open,
  folders,
  defaultFolderId,
  linkedTo,
  autoPath,
  onClose,
  onDone,
}: {
  open: boolean;
  folders: readonly DocumentFolder[];
  defaultFolderId?: string;
  linkedTo?: { entityType: DocumentLinkEntityType; entityId: string };
  /**
   * Tự xếp tệp vào `<thư mục đã chọn>/<dự án>/<công việc>`.
   *
   * Người dùng chỉ chọn thư mục gốc — thường là một thư mục dùng chung như
   * "Hợp đồng" — còn hai cấp phân loại do server tạo nếu thiếu. Vắng prop này
   * thì tệp nằm thẳng trong thư mục đã chọn, như trước.
   */
  autoPath?: { projectId: string; workItemId?: string };
  onClose: () => void;
  onDone: (documentId?: string) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [folderId, setFolderId] = useState('');
  const [file, setFile] = useState<File>();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  /**
   * Thư mục được phép chọn.
   *
   * Khi hệ thống tự xếp đường dẫn, người dùng chỉ chọn **kho gốc dùng chung**
   * ("Hợp đồng", "Hồ sơ pháp lý"…) — hai cấp sau là dự án và công việc, do
   * server tạo. Bày cả thư mục con ở đây là mời người dùng chọn một chỗ mà
   * đằng nào cũng bị thay bằng đường dẫn tự sinh.
   */
  const targets = useMemo(
    () => (autoPath ? folders.filter((folder) => !folder.parentId && !folder.projectId) : folders),
    [autoPath, folders],
  );

  useEffect(() => {
    if (!open) return;
    setName('');
    setDescription('');
    // Chỉ điền sẵn thư mục đang mở khi nó nằm trong danh sách chọn được; với
    // đường dẫn tự sinh thì danh sách chỉ có kho gốc.
    const preset = targets.some((folder) => folder.id === defaultFolderId)
      ? defaultFolderId
      : undefined;
    setFolderId(preset ?? targets[0]?.id ?? '');
    setFile(undefined);
    setError(undefined);
    setSubmitting(false);
  }, [open, defaultFolderId, targets]);

  const submit = async () => {
    if (!file) {
      setError('Hãy chọn một tệp.');
      return;
    }
    setError(undefined);
    setSubmitting(true);
    try {
      // Dọn đường dẫn trước khi ghi: server trả về thư mục lá đã sẵn sàng, và
      // gọi lại cho cùng công việc thì vẫn ra đúng thư mục cũ.
      const target = autoPath
        ? (
            await api.ensureFolderPath({
              rootFolderId: folderId,
              projectId: autoPath.projectId,
              workItemId: autoPath.workItemId,
            })
          ).id
        : folderId;
      const created = await api.createDocument({
        folderId: target,
        name: name.trim() || file.name,
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        description: description.trim() || undefined,
        linkTo: linkedTo,
      });
      await api.uploadToStorage(created.uploadUrl, file, file.type);
      // Chỉ báo xong SAU khi PUT thành công; PUT hỏng thì phiên bản ở lại
      // trạng thái "Chưa tải lên xong" và không ai tải xuống được một tệp rỗng.
      await api.completeUpload(created.document.id, created.version.id, { sizeBytes: file.size });
      onDone(created.document.id);
      onClose();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không tải tài liệu lên được.');
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Tải tài liệu lên"
      subtitle="Tệp đi thẳng từ trình duyệt lên kho lưu trữ, không qua máy chủ."
      submitLabel="Tải lên"
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field
        label={autoPath ? 'Thư mục gốc' : 'Thư mục'}
        hint={
          autoPath
            ? 'Tệp được xếp vào <thư mục gốc>/<dự án>/<công việc>; thiếu cấp nào hệ thống tự tạo.'
            : undefined
        }
      >
        <Choice
          label={autoPath ? 'Thư mục gốc' : 'Thư mục'}
          value={folderId}
          required
          options={targets.map((folder) => ({
            value: folder.id,
            label: `${'— '.repeat(autoPath ? 0 : folder.depth)}${folder.name}`,
          }))}
          onChange={setFolderId}
        />
      </Field>

      <Field
        label="Tệp"
        hint={`Tối đa ${Math.round(DOCUMENT_MAX_BYTES / 1024 / 1024)} MB. Hỗ trợ PDF, Office, ảnh, CSV, ZIP.`}
      >
        <input
          type="file"
          accept={ALLOWED_DOCUMENT_CONTENT_TYPES.join(',')}
          onChange={(event) => setFile(event.target.files?.[0])}
        />
      </Field>

      <Field label="Tên hiển thị" hint="Để trống thì lấy theo tên tệp.">
        <input value={name} maxLength={255} onChange={(event) => setName(event.target.value)} />
      </Field>

      <Field label="Mô tả">
        <textarea
          rows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
    </Dialog>
  );
}

/** Phiên bản mới. Ghi chú thay đổi bắt buộc từ phiên bản 2 trở đi. */
function NewVersionDialog({
  document: target,
  onClose,
  onDone,
}: {
  document?: DocumentDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File>();
  const [changeNote, setChangeNote] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!target) return;
    setFile(undefined);
    setChangeNote('');
    setError(undefined);
    setSubmitting(false);
  }, [target]);

  const submit = async () => {
    if (!target) return;
    if (!file) {
      setError('Hãy chọn một tệp.');
      return;
    }
    setError(undefined);
    setSubmitting(true);
    try {
      const ticket = await api.createDocumentVersion(target.id, {
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        changeNote: changeNote.trim(),
      });
      await api.uploadToStorage(ticket.uploadUrl, file, file.type);
      await api.completeUpload(target.id, ticket.version.id, { sizeBytes: file.size });
      onDone();
      onClose();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không tạo được phiên bản mới.');
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={Boolean(target)}
      title={`Phiên bản mới — ${target?.name ?? ''}`}
      subtitle="Phiên bản cũ vẫn giữ nguyên; bảng phiên bản là bất biến."
      submitLabel="Tải lên phiên bản"
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field label="Tệp">
        <input
          type="file"
          accept={ALLOWED_DOCUMENT_CONTENT_TYPES.join(',')}
          onChange={(event) => setFile(event.target.files?.[0])}
        />
      </Field>
      <Field label="Ghi chú thay đổi" hint="Bắt buộc: người đọc sau cần biết đã đổi những gì.">
        <textarea
          rows={2}
          value={changeNote}
          required
          maxLength={500}
          onChange={(event) => setChangeNote(event.target.value)}
        />
      </Field>
    </Dialog>
  );
}

function FolderDialog({
  open,
  projectId,
  folders,
  onClose,
  onDone,
}: {
  open: boolean;
  projectId?: string;
  folders: readonly DocumentFolder[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setParentId('');
    setError(undefined);
    setSubmitting(false);
  }, [open]);

  const submit = async () => {
    setError(undefined);
    setSubmitting(true);
    try {
      await api.createFolder({
        projectId,
        parentId: parentId || undefined,
        name: name.trim(),
      });
      onDone();
      onClose();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không tạo được thư mục.');
      setSubmitting(false);
    }
  };

  // Cây tối đa 5 cấp; thư mục ở cấp sâu nhất không còn chỗ cho con.
  const eligibleParents = folders.filter(
    (folder) => folder.depth < 4 && (folder.projectId ?? undefined) === projectId,
  );

  return (
    <Dialog
      open={open}
      title="Thư mục mới"
      subtitle={projectId ? 'Thư mục thuộc dự án đang mở.' : 'Thư mục cấp đơn vị, dùng chung.'}
      submitLabel="Tạo thư mục"
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field label="Tên thư mục">
        <input
          value={name}
          required
          maxLength={180}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field label="Thư mục cha" hint="Cây tối đa 5 cấp.">
        <Choice
          label="Thư mục cha"
          value={parentId}
          emptyOption="Không có — thư mục gốc"
          options={eligibleParents.map((folder) => ({
            value: folder.id,
            label: `${'— '.repeat(folder.depth)}${folder.name}`,
          }))}
          onChange={setParentId}
        />
      </Field>
    </Dialog>
  );
}

/** Tên dễ đọc của nơi tài liệu đang gắn; công việc lạ thì rơi về mã thô. */
function linkLabel(
  entityType: DocumentLinkEntityType,
  entityId: string,
  workItems: ReadonlyMap<string, WorkItem>,
): string {
  if (entityType === 'project') return 'Cả dự án';
  if (entityType === 'calendar_event') return `Sự kiện lịch · ${entityId.slice(0, 8)}`;
  const item = workItems.get(entityId);
  return item ? `Công việc ${item.code} · ${item.title}` : `Công việc · ${entityId.slice(0, 8)}`;
}

/**
 * Gắn một tài liệu đã có trong dự án vào công việc đang chọn.
 *
 * Không tải lại tệp: cùng một tài liệu gắn được vào nhiều công việc, và mọi
 * phiên bản vẫn chỉ nằm một chỗ.
 */
function AttachDialog({
  open,
  projectId,
  entityId,
  alreadyLinked,
  onClose,
  onDone,
}: {
  open: boolean;
  projectId: string;
  entityId: string;
  alreadyLinked: readonly string[];
  onClose: () => void;
  onDone: () => void;
}) {
  // Mảng dựng mới mỗi lần render; so theo chuỗi để effect không chạy lại vô cớ.
  const linkedKey = alreadyLinked.join(',');
  const [candidates, setCandidates] = useState<readonly DocumentSummary[]>();
  const [documentId, setDocumentId] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDocumentId('');
    setError(undefined);
    setSubmitting(false);
    setCandidates(undefined);
    const skip = new Set(linkedKey ? linkedKey.split(',') : []);
    api
      .listDocuments({ projectId })
      .then((response) => setCandidates(response.items.filter((document) => !skip.has(document.id))))
      .catch((cause) => {
        setCandidates([]);
        setError((cause as { message?: string })?.message ?? 'Không tải được tài liệu của dự án.');
      });
  }, [open, projectId, linkedKey]);

  const submit = async () => {
    if (!documentId) {
      setError('Hãy chọn một tài liệu.');
      return;
    }
    setSubmitting(true);
    try {
      await api.linkDocument(documentId, { entityType: 'work_item', entityId });
      onDone();
      onClose();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không gắn được tài liệu.');
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Gắn tài liệu có sẵn"
      subtitle="Chọn từ tài liệu đã tải lên trong dự án."
      submitLabel="Gắn"
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field label="Tài liệu">
        <Choice
          label="Tài liệu"
          value={documentId}
          emptyOption={
            candidates === undefined
              ? 'Đang tải…'
              : candidates.length === 0
                ? 'Không còn tài liệu nào chưa gắn'
                : '— Chọn —'
          }
          options={(candidates ?? []).map((document) => ({
            value: document.id,
            label: `${document.name}${
              document.currentVersion ? ` (${document.currentVersion.fileName})` : ''
            }`,
          }))}
          onChange={setDocumentId}
        />
      </Field>
    </Dialog>
  );
}

/** Nhóm loại tệp cho bộ lọc: đọc từ content-type của phiên bản hiện hành. */
const FILE_KINDS: readonly { value: string; label: string }[] = [
  { value: 'pdf', label: 'PDF' },
  { value: 'office', label: 'Word, Excel, PowerPoint' },
  { value: 'image', label: 'Ảnh' },
  { value: 'archive', label: 'Văn bản, CSV, nén' },
  { value: 'other', label: 'Khác' },
];

function kindOf(document: DocumentSummary): string {
  const type = document.currentVersion?.contentType ?? '';
  const name = document.currentVersion?.fileName ?? '';
  if (type.includes('pdf') || name.endsWith('.pdf')) return 'pdf';
  if (type.startsWith('image/')) return 'image';
  if (/word|excel|powerpoint|officedocument|opendocument|msword/.test(type)) return 'office';
  if (/zip|compressed|csv|json|xml|text\/plain/.test(type)) return 'archive';
  return 'other';
}
