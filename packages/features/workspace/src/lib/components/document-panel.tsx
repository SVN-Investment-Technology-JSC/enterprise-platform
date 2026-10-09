'use client';

import {
  ALLOWED_DOCUMENT_CONTENT_TYPES,
  DOCUMENT_MAX_BYTES,
  type DocumentDetail,
  type DocumentFolder,
  type DocumentLinkEntityType,
  type DocumentSummary,
  type DocumentVersion,
  type ProjectSummary,
  type WorkItem,
} from '@enterprise-platform/contracts-workspace';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import {
  Download,
  Eye,
  FilePlus2,
  Folder,
  FolderKanban,
  House,
  Link2,
  Lock,
  LockOpen,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../workspace-api';
import { formatDate, formatDateTime } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { ContextMenu, type ContextAction } from './project-tree';
import { Dialog, Field } from './dialog';
import { DocumentPreview, isPreviewable, type PreviewTarget } from './document-preview';
import {
  FolderTree,
  isProjectLevelFolder,
  projectFolderGroups,
  projectNameOf,
  topLabel,
} from './folder-tree';
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
  /** Mở sẵn khối thông tin của tài liệu này, ví dụ khi chọn từ ô Tìm nhanh. */
  readonly focusDocumentId?: string;
  /**
   * Lệnh từ nút ở đầu trang (Tải lên, Thư mục). Trang Tài liệu đặt hai nút
   * này cạnh breadcrumb của khung module, nên chúng báo vào đây bằng một
   * `nonce` mới mỗi lần bấm.
   */
  readonly request?: { readonly kind: 'upload' | 'folder'; readonly nonce: number };
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
  focusDocumentId,
  request,
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
  /** Cha mặc định của "Thư mục mới": thư mục bấm "+" trên cây, hay thư mục đang mở. */
  const [folderParent, setFolderParent] = useState<string>();
  /** Menu chuột phải trên cây thư mục. */
  const [folderMenu, setFolderMenu] = useState<{ folder: DocumentFolder; x: number; y: number }>();
  /** Thư mục đang đổi tên, chuyển chỗ hay xoá. */
  const [folderEdit, setFolderEdit] = useState<FolderEdit>();
  /** Hộp thoại "Thêm vào thư mục…" của tài liệu đang mở. */
  const [refOpen, setRefOpen] = useState(false);
  const [newVersionFor, setNewVersionFor] = useState<DocumentDetail>();
  const [attachOpen, setAttachOpen] = useState(false);
  const [linkTarget, setLinkTarget] = useState('');
  /** Nhóm dự án đang mở (thư mục gốc trùng tên của nhiều dự án). */
  /** Dự án đang mở ở gốc kho (chọn dòng dự án có nhiều thư mục). */
  const [projectScope, setProjectScope] = useState<string>();
  /** Số tài liệu theo thư mục, hiện cạnh tên trên cây bên trái. */
  const [folderCounts, setFolderCounts] = useState<Record<string, number>>({});
  /** Mọi tài liệu của kho (không lọc theo thư mục), để cây hiện dòng tệp. */
  const [treeDocuments, setTreeDocuments] = useState<readonly DocumentSummary[]>([]);
  /**
   * Chỉ tài liệu **gốc** theo thư mục. Xoá thư mục chỉ bị chặn bởi tài liệu
   * gốc; tham chiếu thì tự gỡ theo thư mục.
   */
  const [ownFolderCounts, setOwnFolderCounts] = useState<Record<string, number>>({});
  /* --- Bộ lọc của trang Tài liệu tổng quan (bản đủ, không dùng ở tab dự án) --- */
  const [projectList, setProjectList] = useState<readonly ProjectSummary[]>([]);
  const [filterProjectId, setFilterProjectId] = useState('');
  const [projectItems, setProjectItems] = useState<readonly WorkItem[]>([]);
  const [filterWorkItemId, setFilterWorkItemId] = useState('');
  const [filterKind, setFilterKind] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  /**
   * Gắn tài liệu vào công việc từ trang Tài liệu chung.
   *
   * Tab trong trang Dự án được truyền sẵn `workItems`; trang chung thì không,
   * nên phải tự nạp công việc của dự án chứa tài liệu đang mở — tài liệu ở
   * kho dùng chung (không thuộc dự án nào) thì chọn dự án trước.
   */
  const [linkProjectId, setLinkProjectId] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkItems, setLinkItems] = useState<readonly WorkItem[]>([]);
  const linkCandidates = workItems ?? linkItems;
  const workItemById = useMemo(
    () => new Map([...(workItems ?? []), ...linkItems].map((item) => [item.id, item])),
    [workItems, linkItems],
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
          const own: Record<string, number> = {};
          for (const document of all.items) {
            counts[document.folderId] = (counts[document.folderId] ?? 0) + 1;
            own[document.folderId] = (own[document.folderId] ?? 0) + 1;
            // Tài liệu tham chiếu cũng hiện ở thư mục đó, nên cũng được đếm.
            for (const refFolderId of document.refFolderIds ?? []) {
              counts[refFolderId] = (counts[refFolderId] ?? 0) + 1;
            }
          }
          setFolderCounts(counts);
          setOwnFolderCounts(own);
          setTreeDocuments(all.items);
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
  }, [folderId, projectScope, filterProjectId, filterWorkItemId]);

  const open = async (documentId: string) => {
    try {
      setSelected(await api.getDocument(documentId));
      setError(undefined);
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không mở được tài liệu.');
    }
  };

  // Đặt sau hiệu ứng đóng khối ở trên, để lần chạy đầu không bị nó xoá mất.
  useEffect(() => {
    if (focusDocumentId) void open(focusDocumentId);
  }, [focusDocumentId]);

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

  /** Tệp đang mở trong khung xem trước. */
  const [preview, setPreview] = useState<PreviewTarget>();

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
      .listAllProjects()
      .then(setProjectList)
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

  useEffect(() => {
    setLinkTarget('');
    setLinkOpen(false);
    setLinkProjectId(selected?.projectId ?? '');
  }, [selected?.id, selected?.projectId]);

  useEffect(() => {
    if (workItems || !linkProjectId) {
      setLinkItems([]);
      return;
    }
    let alive = true;
    api
      .listWorkItems(linkProjectId)
      .then((tree) => alive && setLinkItems(tree.items))
      .catch(() => alive && setLinkItems([]));
    return () => {
      alive = false;
    };
  }, [workItems, linkProjectId]);

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

  // Lệnh đã xử lý; lấy giá trị lúc mở trang để quay lại trang này không tự
  // bật lại hộp thoại của lần bấm trước.
  const handledRequest = useRef(request?.nonce);
  useEffect(() => {
    if (!request || request.nonce === handledRequest.current) return;
    handledRequest.current = request.nonce;
    if (request.kind === 'folder') {
      setFolderParent(folderId);
      setFolderOpen(true);
    } else if (visibleFolders.length === 0) {
      setError('Cần có ít nhất một thư mục trước khi tải tài liệu lên.');
    } else {
      setUploadOpen(true);
    }
  }, [request, visibleFolders.length]);

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
   * liệt kê ổ đĩa chứ không đổ hết tệp trong máy ra. Đứng ở một dự án thì
   * thấy các thư mục cấp dự án của nó.
   */
  const folderById = useMemo(
    () => new Map(visibleFolders.map((folder) => [folder.id, folder])),
    [visibleFolders],
  );
  const projectGroups = useMemo(
    () => projectFolderGroups(visibleFolders, folderById, projectTitles),
    [visibleFolders, folderById, projectTitles],
  );
  const subFolders = useMemo(() => {
    const sorted = (list: readonly DocumentFolder[]) =>
      [...list].sort((left, right) => left.name.localeCompare(right.name, 'vi'));
    if (projectScope) {
      return projectGroups.find((entry) => entry.projectId === projectScope)?.tops ?? [];
    }
    return sorted(visibleFolders.filter((folder) => (folder.parentId ?? undefined) === folderId));
  }, [visibleFolders, folderId, projectScope, projectGroups]);

  /**
   * Các dòng thư mục ở khung bên phải.
   *
   * Ở gốc: thư mục của kho đơn vị, rồi mỗi dự án một dòng — đúng hai phần của
   * cây bên trái, để hai khung bày cùng một kho theo cùng một hình dạng.
   */
  const folderRows = useMemo((): readonly (
    | { readonly kind: 'folder'; readonly folder: DocumentFolder }
    | { readonly kind: 'project'; readonly projectId: string; readonly tops: readonly DocumentFolder[] }
  )[] => {
    if (compact || folderId || projectScope) {
      return subFolders.map((folder) => ({ kind: 'folder' as const, folder }));
    }
    return [
      ...subFolders
        .filter((folder) => !folder.projectId)
        .map((folder) => ({ kind: 'folder' as const, folder })),
      ...projectGroups.map((entry) => ({ kind: 'project' as const, ...entry })),
    ];
  }, [compact, folderId, projectScope, subFolders, projectGroups]);

  /**
   * Dự án hiện trên thanh vị trí: dự án đang mở ở gốc, hoặc dự án sở hữu gốc
   * kho của thư mục đang mở. Thư mục dự án nằm trong kho đơn vị thì đường dẫn
   * đã đi qua thư mục đơn vị, không chèn thêm.
   */
  const projectAt = path.findIndex((folder) => isProjectLevelFolder(folder, folderById));
  const crumbProject = projectScope ?? (projectAt >= 0 ? path[projectAt].projectId : undefined);
  /**
   * Các cấp thư mục hiện sau tên dự án. Thư mục cấp dự án mang chính tên dự án
   * nên bỏ, cùng với các thư mục đơn vị đứng trước nó: "SCADA nhà máy Tân Ân ›
   * Thiết kế" thay vì "Kỹ thuật › DA-024 · SCADA nhà máy Tân Ân › Thiết kế".
   */
  const crumbFolders = (() => {
    if (projectAt < 0) return path;
    const top = path[projectAt];
    const rest = path.slice(projectAt + 1);
    // Thư mục gốc riêng của dự án (vd "Hồ sơ dự án") vẫn là một ngăn có tên.
    return top.parentId ? rest : [top, ...rest];
  })();

  /** Mở một dòng dự án: chỉ một thư mục thì vào thẳng thư mục đó. */
  const openProject = (projectId: string, tops: readonly DocumentFolder[]) => {
    if (tops.length === 1) {
      setProjectScope(undefined);
      setFolderId(tops[0].id);
    } else {
      setFolderId(undefined);
      setProjectScope(projectId);
    }
  };

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
    return visibleDocuments.filter(
      (document) =>
        document.folderId === folderId || Boolean(document.refFolderIds?.includes(folderId)),
    );
  }, [compact, flatSearch, folderId, visibleDocuments]);

  /**
   * Bên trong thư mục còn bao nhiêu mục — thư mục con cộng tài liệu.
   *
   * Xoá chỉ chạy với thư mục rỗng, nên con số này quyết định nút xoá có bấm
   * được hay không, và hiện thẳng trong chú thích của nút.
   */
  const countInside = (folder: DocumentFolder): number =>
    visibleFolders.filter((item) => item.parentId === folder.id).length +
    (ownFolderCounts[folder.id] ?? 0);

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

  /**
   * Nhãn của một thư mục theo đúng hai phần của cây: thư mục dự án ghi theo
   * dự án ("SCADA nhà máy Tân Ân / Thiết kế"), thư mục đơn vị ghi đường dẫn.
   * Dùng cho "Có mặt trong" và hộp "Thêm vào thư mục", để hai thư mục cùng tên
   * của hai dự án không thành hai dòng giống hệt.
   */
  const placeOf = useMemo(() => {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    return (targetId: string): string => {
      const chain: DocumentFolder[] = [];
      const seen = new Set<string>();
      for (let cursor = byId.get(targetId); cursor && !seen.has(cursor.id); ) {
        seen.add(cursor.id);
        chain.unshift(cursor);
        cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
      }
      const at = chain.findIndex((item) => isProjectLevelFolder(item, byId));
      if (at < 0) return pathOf(targetId);
      const top = chain[at];
      const project = projectNameOf(projectTitles[top.projectId ?? '']) ?? 'Dự án';
      const rest = chain.slice(at + 1).map((item) => item.name);
      // Như thanh vị trí: thư mục dự án nằm trong kho đơn vị mang chính tên dự
      // án nên bỏ, trừ khi chính nó là thư mục cần ghi ("ERP giai đoạn 2 /
      // Hợp đồng").
      const names = top.parentId
        ? rest.length > 0
          ? rest
          : [topLabel(top, byId)]
        : [top.name, ...rest];
      return [project, ...names].join(' / ');
    };
  }, [folders, pathOf, projectTitles]);

  /** Phiên bản hiện hành của tài liệu đang mở: bản trỏ tới, hoặc bản mới nhất. */
  const currentVersion = selected
    ? (selected.versions.find((version) => version.id === selected.currentVersionId) ??
      selected.versions.reduce<DocumentVersion | undefined>(
        (best, version) => (!best || version.versionNo > best.versionNo ? version : best),
        undefined,
      ))
    : undefined;

  const detailPanel = selected ? (
        <aside className={styles.documentDetail} aria-label={`Chi tiết ${selected.name}`}>
          <div className={styles.documentHead}>
            <FileTile fileName={currentVersion?.fileName ?? selected.name} large />
            <div className={styles.documentHeadText}>
              <h3>{selected.name}</h3>
              <p className={styles.muted}>
                {[
                  currentVersion ? `Bản ${currentVersion.versionNo}` : null,
                  currentVersion?.sizeBytes == null
                    ? 'Chưa tải lên xong'
                    : formatBytes(currentVersion.sizeBytes),
                  pathOf(selected.folderId).split(' / ').pop(),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Đóng chi tiết tài liệu"
              title="Đóng"
              onClick={() => setSelected(undefined)}
            >
              <X size={15} />
            </button>
          </div>

          {selected.description ? (
            <p className={styles.documentDesc}>{selected.description}</p>
          ) : null}

          {/* Ba việc người dùng tới đây để làm, nằm ngay dưới tên tệp. */}
          <div className={styles.documentActions}>
            <button
              type="button"
              className={styles.buttonPrimary}
              disabled={currentVersion?.sizeBytes == null}
              title={currentVersion?.sizeBytes == null ? 'Phiên bản này chưa tải lên xong' : undefined}
              onClick={() => void download(selected.id)}
            >
              <Download size={14} /> Tải xuống
            </button>
            {currentVersion && currentVersion.sizeBytes != null && isPreviewable(currentVersion.contentType) ? (
              <button
                type="button"
                className={styles.buttonGhost}
                onClick={() =>
                  setPreview({
                    documentId: selected.id,
                    title: selected.name,
                    subtitle: `Bản ${currentVersion.versionNo}`,
                  })
                }
              >
                <Eye size={14} /> Xem trước
              </button>
            ) : null}
            {canWrite ? (
              <>
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
                  <FilePlus2 size={14} /> Bản mới
                </button>
                {selected.lockedByUserId ? (
                  <button
                    type="button"
                    className={styles.buttonGhost}
                    onClick={() =>
                      void act(() => api.unlockDocument(selected.id), 'Không mở khoá được.')
                    }
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
              </>
            ) : null}
          </div>
          {selected.lockedByUserId ? (
            <p className={styles.documentLockNote}>
              <Lock size={12} /> Đang khoá để sửa bởi {directory.nameOf(selected.lockedByUserId)}
              {selected.lockedAt ? ` từ ${formatDateTime(selected.lockedAt)}` : ''}
            </p>
          ) : null}

          {/* Thư mục gốc và các thư mục tham chiếu: cùng một tài liệu, không
              nhân bản tệp, nên bản mới hay khoá ở đâu cũng là một. */}
          <h4 className={styles.detailHeading}>Có mặt trong</h4>
          <ul className={styles.placeList}>
            <li>
              <Folder size={14} className={styles.placeIcon} aria-hidden />
              <button
                type="button"
                className={styles.placeName}
                title={`Mở ${placeOf(selected.folderId)}`}
                onClick={() => {
                  setProjectScope(undefined);
                  setFolderId(selected.folderId);
                }}
              >
                {placeOf(selected.folderId)}
              </button>
              <span className={styles.muted}>Thư mục gốc</span>
            </li>
            {(selected.folderRefs ?? []).map((ref) => (
              <li key={ref.id}>
                <Link2 size={14} className={styles.placeIcon} aria-hidden />
                <button
                  type="button"
                  className={styles.placeName}
                  title={`Mở ${placeOf(ref.folderId)}`}
                  onClick={() => {
                    setProjectScope(undefined);
                    setFolderId(ref.folderId);
                  }}
                >
                  {placeOf(ref.folderId)}
                </button>
                {canWrite ? (
                  <Popconfirm
                    title="Gỡ khỏi thư mục này?"
                    description="Tài liệu vẫn ở thư mục gốc; chỉ không hiện ở thư mục này nữa."
                    okText="Gỡ"
                    okType="danger"
                    onConfirm={() =>
                      act(
                        () => api.removeFolderRef(selected.id, ref.id),
                        'Không gỡ được khỏi thư mục.',
                      )
                    }
                  >
                    <button type="button" className={styles.linkButton}>
                      Gỡ
                    </button>
                  </Popconfirm>
                ) : null}
              </li>
            ))}
          </ul>
          {canWrite && selected.status === 'active' ? (
            <button type="button" className={styles.addLinkButton} onClick={() => setRefOpen(true)}>
              + Thêm vào thư mục…
            </button>
          ) : null}

          <h4 className={styles.detailHeading}>Gắn với</h4>
          <div className={styles.linkChips}>
            {selected.links.length === 0 ? (
              <span className={styles.muted}>Chưa gắn với dự án, công việc hay sự kiện nào.</span>
            ) : null}
            {selected.links.map((link) => (
              <span
                key={link.id}
                className={styles.linkChip}
                title={`Gắn lúc ${formatDateTime(link.createdAt)}`}
              >
                {linkLabel(link.entityType, link.entityId, workItemById)}
                {canWrite ? (
                  <Popconfirm
                    title="Gỡ liên kết này?"
                    description="Tài liệu vẫn còn trong kho; chỉ bỏ liên kết với nơi này."
                    okText="Gỡ"
                    okType="danger"
                    onConfirm={() =>
                      act(() => api.unlinkDocument(selected.id, link.id), 'Không gỡ được liên kết.')
                    }
                  >
                    <button type="button" aria-label="Gỡ liên kết" title="Gỡ liên kết">
                      <X size={12} />
                    </button>
                  </Popconfirm>
                ) : null}
              </span>
            ))}
            {canWrite && !linkOpen ? (
              <button type="button" className={styles.addLinkButton} onClick={() => setLinkOpen(true)}>
                + Gắn việc
              </button>
            ) : null}
          </div>
          {canWrite && linkOpen ? (
            <div className={styles.linkForm}>
              {!workItems && !selected.projectId ? (
                <Choice
                  label="Dự án của công việc cần gắn"
                  value={linkProjectId}
                  placeholder="Chọn dự án trước"
                  options={projectList.map((project) => ({
                    value: project.id,
                    label: `${project.code} · ${project.name}`,
                  }))}
                  onChange={(value) => {
                    setLinkProjectId(value);
                    setLinkTarget('');
                  }}
                />
              ) : null}
              {linkCandidates.length > 0 ? (
                <Choice
                  label="Gắn vào công việc"
                  value={linkTarget}
                  emptyOption="— Chọn công việc —"
                  options={linkCandidates
                    .filter(
                      (item) =>
                        !selected.links.some(
                          (link) => link.entityType === 'work_item' && link.entityId === item.id,
                        ),
                    )
                    .map((item) => ({ value: item.id, label: `${item.code} · ${item.title}` }))}
                  onChange={setLinkTarget}
                />
              ) : linkProjectId || selected.projectId || workItems ? (
                <span className={styles.muted}>Dự án này chưa có công việc nào để gắn.</span>
              ) : null}
              <div className={styles.linkFormActions}>
                <button type="button" className={styles.buttonGhost} onClick={() => setLinkOpen(false)}>
                  Đóng
                </button>
                <button
                  type="button"
                  className={styles.buttonPrimary}
                  disabled={!linkTarget}
                  onClick={() =>
                    void act(async () => {
                      await api.linkDocument(selected.id, {
                        entityType: 'work_item',
                        entityId: linkTarget,
                      });
                      setLinkTarget('');
                      setLinkOpen(false);
                    }, 'Không gắn được tài liệu.')
                  }
                >
                  <Link2 size={14} /> Gắn
                </button>
              </div>
            </div>
          ) : null}

          <h4 className={styles.detailHeading}>Các bản</h4>
          <ul className={styles.versionList}>
            {selected.versions.map((version) => (
              <li key={version.id}>
                <b className={styles.versionNo}>v{version.versionNo}</b>
                <span className={styles.versionText}>
                  <span>{version.changeNote || version.fileName}</span>
                  <span className={styles.muted}>
                    {directory.nameOf(version.uploadedBy)} · {formatDateTime(version.createdAt)}
                  </span>
                </span>
                {version.sizeBytes != null && isPreviewable(version.contentType) ? (
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Xem trước phiên bản ${version.versionNo}`}
                    title="Xem trước"
                    onClick={() =>
                      setPreview({
                        documentId: selected.id,
                        versionId: version.id,
                        title: selected.name,
                        subtitle: `Bản ${version.versionNo}`,
                      })
                    }
                  >
                    <Eye size={14} />
                  </button>
                ) : null}
                {version.sizeBytes == null ? (
                  <span className={styles.badgeWarn}>Chưa tải lên xong</span>
                ) : (
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Tải xuống phiên bản ${version.versionNo}`}
                    title={`Tải ${version.fileName}`}
                    onClick={() => void download(selected.id, version.id)}
                  >
                    <Download size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>

          {/* Gõ lại tên để xác nhận: tài liệu lưu trữ biến khỏi mọi danh sách
              đang dùng. Chỉ người có quyền xoá mới thấy nút này. */}
          {canWrite && canDelete ? (
            <Popconfirm
              title={`Lưu trữ ${selected.name}?`}
              description="Tài liệu sẽ được đưa vào lưu trữ. Tệp gốc vẫn được giữ trên kho lưu trữ."
              okText="Lưu trữ"
              okType="danger"
              confirmInput={{ requiredText: selected.name, label: 'Gõ lại tên tài liệu' }}
              onConfirm={() => act(() => api.archiveDocument(selected.id), 'Không lưu trữ được.')}
            >
              <button type="button" className={styles.dangerLink}>
                Lưu trữ tài liệu
              </button>
            </Popconfirm>
          ) : null}
        </aside>
  ) : null;

  const body = (
    <>
      {/* Thẻ lọc, thông báo và danh sách chung một cột; khung chi tiết đứng
          riêng cột bên phải từ trên xuống, để bảng giữ đủ bề ngang. */}
      <div className={selected ? styles.documentSplit : undefined}>
      <div className={styles.documentColumn}>
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

        <label className={styles.searchField}>
          <Search size={14} aria-hidden />
          <input
            type="search"
            value={search}
            placeholder={compact ? 'Tìm theo tên tài liệu' : 'Tìm tài liệu trong mọi thư mục…'}
            aria-label="Tìm tài liệu"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        <div role="group" aria-label="Loại tệp" className={styles.kindChips}>
          {KIND_CHIPS.map((kind) => (
            <button
              key={kind.value || 'all'}
              type="button"
              aria-pressed={filterKind === kind.value}
              title={kind.title}
              className={filterKind === kind.value ? styles.kindChipActive : styles.kindChip}
              onClick={() => setFilterKind(kind.value)}
            >
              {kind.label}
            </button>
          ))}
        </div>

        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={onlyMine}
            onChange={(event) => setOnlyMine(event.target.checked)}
          />
          Chỉ của tôi
        </label>

        {/* Kho của trang tổng quan gom mọi dự án nên cần thu hẹp nhanh theo dự
            án và công việc; tab trong trang Dự án thì phạm vi đã cố định. */}
        {compact ? null : (
          <>
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
          </>
        )}

        {/* Trang Tài liệu đặt Tải lên và Thư mục ở đầu trang; tab trong trang
            Dự án không có đầu trang riêng nên giữ nút ở đây. */}
        {compact && canWrite ? (
          <>
            <span className={styles.filterSpacer} />
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
          </>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}

      <div className={styles.documentList}>
        <div className={styles.documentListHead}>
          {/* Đang đứng ở đâu trong kho; bấm một cấp để quay lại cấp đó. */}
          {compact ? (
            <span className={styles.documentListTitle}>
              {folderId ? pathOf(folderId) : 'Tất cả thư mục'}
            </span>
          ) : (
            <nav className={styles.explorerPath} aria-label="Vị trí trong kho tài liệu">
              <button
                type="button"
                className={styles.explorerPathHome}
                aria-label="Tất cả tài liệu"
                title="Tất cả tài liệu"
                onClick={() => {
                  setProjectScope(undefined);
                  setFolderId(undefined);
                }}
              >
                <House size={14} />
                {crumbProject || crumbFolders.length > 0 ? null : <span>Tất cả tài liệu</span>}
              </button>
              {crumbProject ? (
                <span>
                  <span className={styles.explorerPathSep} aria-hidden>
                    ›
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      openProject(
                        crumbProject,
                        projectGroups.find((entry) => entry.projectId === crumbProject)?.tops ?? [],
                      )
                    }
                  >
                    {projectNameOf(projectTitles[crumbProject]) ?? projectLabels[crumbProject] ?? 'Dự án'}
                  </button>
                </span>
              ) : null}
              {/* Sâu hơn hai cấp thì gộp các cấp giữa thành "…", để thư mục
                  đang mở luôn còn chỗ hiện đủ tên. */}
              {crumbFolders.length > 2 ? (
                <span title={crumbFolders.map((folder) => folder.name).join(' › ')}>
                  <span className={styles.explorerPathSep} aria-hidden>
                    ›
                  </span>
                  <span className={styles.explorerPathMore}>…</span>
                </span>
              ) : null}
              {crumbFolders.slice(-2).map((folder) => (
                <span key={folder.id}>
                  <span className={styles.explorerPathSep} aria-hidden>
                    ›
                  </span>
                  <button type="button" onClick={() => setFolderId(folder.id)}>
                    {folder.name}
                  </button>
                </span>
              ))}
            </nav>
          )}
          <span className={styles.documentListCount}>{listedDocuments.length} tài liệu</span>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Tải lại"
            title="Tải lại"
            onClick={() => void reload()}
          >
            <RefreshCw size={14} />
          </button>
        </div>

      {listedDocuments.length === 0 && (compact || flatSearch || subFolders.length === 0) ? (
        <p className={styles.muted}>
          {loading
            ? 'Đang tải…'
            : flatSearch
              ? 'Không có tài liệu nào khớp bộ lọc.'
              : 'Thư mục này chưa có gì.'}
        </p>
      ) : (
        <div className={styles.tableScroll}>
        <table className={`${styles.table} ${styles.docTable}`}>
          <thead>
            <tr>
              <th>Tên</th>
              {flatSearch ? <th>Nơi lưu</th> : null}
              <th className={styles.docColVersion}>Bản</th>
              <th className={styles.docColLinks}>Gắn với</th>
              <th className={styles.docColUpdated}>Cập nhật</th>
              <th className={styles.docColActions} aria-label="Thao tác" />
            </tr>
          </thead>
          <tbody>
            {/* Thư mục con đứng trước tệp, đúng thói quen của trình quản lý tệp. */}
            {compact || flatSearch
              ? null
              : folderRows.map((row) =>
                  row.kind === 'project' ? (
                    <tr key={`project:${row.projectId}`} className={styles.explorerFolderRow}>
                      <td>
                        <button
                          type="button"
                          className={styles.docName}
                          data-folder-row={`project:${row.projectId}`}
                          onClick={() => openProject(row.projectId, row.tops)}
                        >
                          <span className={styles.folderTile} aria-hidden>
                            <FolderKanban size={15} />
                          </span>
                          <span className={styles.docNameText}>
                            {projectTitles[row.projectId] ?? projectLabels[row.projectId] ?? 'Dự án'}
                          </span>
                        </button>
                      </td>
                      <td colSpan={3} className={styles.muted}>
                        Dự án · {row.tops.length} thư mục
                      </td>
                      <td />
                    </tr>
                  ) : (
                    ((folder) => (
                  <tr key={folder.id} className={styles.explorerFolderRow}>
                    <td>
                      <button
                        type="button"
                        className={styles.docName}
                        data-folder-row={folder.id}
                        onClick={() => {
                          setProjectScope(undefined);
                          setFolderId(folder.id);
                        }}
                      >
                        <span className={styles.folderTile} aria-hidden>
                          <Folder size={15} />
                        </span>
                        <span className={styles.docNameText}>
                          {projectScope ? topLabel(folder, folderById) : folder.name}
                        </span>
                      </button>
                    </td>
                    <td colSpan={3} className={styles.muted}>
                      {folder.projectId
                        ? `Thư mục · ${projectLabels[folder.projectId] ?? 'dự án'}`
                        : 'Thư mục cấp đơn vị'}
                    </td>
                    <td>
                      {(folder.projectId ? canWrite : canDelete) && countInside(folder) > 0 ? (
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
                      ) : (folder.projectId ? canWrite : canDelete) ? (
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
                <tr
                  key={document.id}
                  className={selected?.id === document.id ? styles.rowSelected : undefined}
                >
                  <td>
                    <button
                      type="button"
                      className={styles.docName}
                      title={document.currentVersion?.fileName ?? document.name}
                      onClick={() => void open(document.id)}
                    >
                      <FileTile fileName={document.currentVersion?.fileName ?? document.name} />
                      <span className={styles.docNameText}>{document.name}</span>
                      {!flatSearch && folderId && document.folderId !== folderId ? (
                        <span
                          className={styles.refMark}
                          title={`Tham chiếu — bản gốc ở ${pathOf(document.folderId)}`}
                        >
                          <Link2 size={12} aria-label="Tham chiếu" />
                        </span>
                      ) : null}
                      {pending ? (
                        <span className={styles.badgeWarn}>Chưa tải lên xong</span>
                      ) : document.lockedByUserId ? (
                        <span
                          className={styles.badgeLocked}
                          title={`Đang khoá để sửa bởi ${directory.nameOf(document.lockedByUserId)}`}
                        >
                          <Lock size={11} /> {shortName(directory.nameOf(document.lockedByUserId))}
                        </span>
                      ) : null}
                    </button>
                  </td>
                  {flatSearch ? (
                    <td className={styles.muted}>
                      {pathOf(document.folderId)}
                      {document.projectId ? ` · ${projectLabels[document.projectId] ?? ''}` : ''}
                    </td>
                  ) : null}
                  <td className={styles.docVersion} title={`${document.versionCount} phiên bản`}>
                    v{document.currentVersion?.versionNo ?? 1}
                  </td>
                  <td className={styles.docLinks}>
                    {(document.linkedWorkItems ?? []).slice(0, 1).map((item) => (
                      <span key={item.id} className={styles.docLinkChip} title={`${item.code} · ${item.title}`}>
                        {item.code}
                      </span>
                    ))}
                    {(document.linkedWorkItems?.length ?? 0) > 1 ? (
                      <span
                        className={styles.muted}
                        title={(document.linkedWorkItems ?? [])
                          .slice(1)
                          .map((item) => `${item.code} · ${item.title}`)
                          .join('\n')}
                      >
                        +{(document.linkedWorkItems?.length ?? 0) - 1}
                      </span>
                    ) : null}
                  </td>
                  <td
                    className={styles.docUpdated}
                    title={`${directory.nameOf(document.currentVersion?.uploadedBy ?? document.createdBy)} · ${formatDateTime(document.updatedAt)}`}
                  >
                    {directory.nameOf(document.currentVersion?.uploadedBy ?? document.createdBy)} ·{' '}
                    {formatDate(document.updatedAt).slice(0, 5)}
                  </td>
                  <td className={styles.docRowActions}>
                    {!pending && isPreviewable(document.currentVersion?.contentType) ? (
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={`Xem trước ${document.name}`}
                        title="Xem trước"
                        onClick={() =>
                          setPreview({
                            documentId: document.id,
                            title: document.name,
                            subtitle: `Bản ${document.currentVersion?.versionNo ?? 1}`,
                          })
                        }
                      >
                        <Eye size={14} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label={`Tải xuống ${document.name}`}
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
        </div>
      )}
      </div>
      </div>
      {detailPanel}
      </div>

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

      <DocumentPreview
        target={preview}
        onClose={() => setPreview(undefined)}
        onDownload={(documentId, versionId) => void download(documentId, versionId)}
      />

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
        projects={projectList}
        defaultParentId={folderParent}
        projectTitles={projectTitles}
        onClose={() => setFolderOpen(false)}
        onDone={() => void reload()}
      />

      <FolderEditDialog
        edit={folderEdit}
        folders={visibleFolders}
        pathOf={pathOf}
        onClose={() => setFolderEdit(undefined)}
        onDone={(removedId) => {
          if (removedId && removedId === folderId) setFolderId(undefined);
          void reload();
        }}
      />

      <AddToFolderDialog
        document={refOpen ? selected : undefined}
        folders={visibleFolders}
        placeOf={placeOf}
        onClose={() => setRefOpen(false)}
        onDone={() => {
          void reload();
          if (selected) void open(selected.id);
        }}
      />

      {folderMenu ? (
        <ContextMenu
          x={folderMenu.x}
          y={folderMenu.y}
          actions={folderActions(folderMenu.folder, countInside(folderMenu.folder))}
          onClose={() => setFolderMenu(undefined)}
          onPick={(actionId) => {
            const target = folderMenu.folder;
            setFolderMenu(undefined);
            if (actionId === 'new-child') {
              setFolderParent(target.id);
              setFolderOpen(true);
            } else {
              setFolderEdit({ mode: actionId as FolderEdit['mode'], folder: target });
            }
          }}
        />
      ) : null}
    </>
  );

  // Tab Tài liệu trong trang Dự án không có cây thư mục: cây dự án đã chiếm
  // cột trái, thư mục chọn bằng ô lọc ngay trên danh sách.
  if (compact) return <div className={styles.tabBody}>{body}</div>;

  return (
    <div className={styles.explorer}>
      <aside className={styles.explorerTree} aria-label="Cây thư mục">
        <FolderTree
          folders={visibleFolders}
          selected={
            folderId
              ? { kind: 'folder', id: folderId }
              : projectScope
                ? { kind: 'project', projectId: projectScope }
                : { kind: 'root' }
          }
          onSelect={(target) => {
            setProjectScope(target.kind === 'project' ? target.projectId : undefined);
            setFolderId(target.kind === 'folder' ? target.id : undefined);
          }}
          counts={folderCounts}
          projectLabels={projectLabels}
          projectTitles={projectTitles}
          onAddChild={
            canWrite
              ? (folder) => {
                  setFolderParent(folder.id);
                  setFolderOpen(true);
                }
              : undefined
          }
          onFolderMenu={canWrite ? (folder, x, y) => setFolderMenu({ folder, x, y }) : undefined}
          documents={treeDocuments}
          selectedDocumentId={selected?.id}
          onOpenDocument={(document, inFolderId) => {
            setProjectScope(undefined);
            setFolderId(inFolderId);
            void open(document.id);
          }}
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
    if (!autoPath && !folderId) {
      setError('Hãy chọn thư mục.');
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
              // Rỗng: thư mục riêng của dự án ở cấp gốc kho.
              rootFolderId: folderId || undefined,
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
          // Tự xếp đường dẫn thì luôn có lựa chọn "thư mục riêng của dự án":
          // tenant chưa dựng kho chung nào vẫn tải tệp lên được.
          emptyOption={autoPath ? 'Thư mục riêng của dự án' : undefined}
          required={!autoPath}
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
  projects = [],
  projectTitles = {},
  defaultParentId,
  onClose,
  onDone,
}: {
  open: boolean;
  /** Tab Tài liệu của một dự án: thư mục mới luôn thuộc dự án này. */
  projectId?: string;
  folders: readonly DocumentFolder[];
  /** Trang Tài liệu chung: chọn dự án khi tạo ở gốc hay trong kho đơn vị. */
  projects?: readonly ProjectSummary[];
  projectTitles?: Readonly<Record<string, string>>;
  defaultParentId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [scopeProjectId, setScopeProjectId] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setParentId(defaultParentId ?? '');
    setScopeProjectId(projectId ?? '');
    setError(undefined);
    setSubmitting(false);
  }, [open, defaultParentId, projectId]);

  const parent = folders.find((folder) => folder.id === parentId);
  // Thư mục con theo dự án của cha. Cha là kho đơn vị hoặc là gốc thì chọn
  // được dự án: thư mục chung của dự án được nằm trong kho đơn vị.
  const effectiveProjectId = parent?.projectId ?? (scopeProjectId || undefined);

  const submit = async () => {
    setError(undefined);
    setSubmitting(true);
    try {
      await api.createFolder({
        projectId: effectiveProjectId,
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

  // Cây tối đa 5 cấp; thư mục ở cấp sâu nhất không còn chỗ cho con. Trong tab
  // của một dự án chỉ chọn được thư mục của dự án đó hoặc kho đơn vị.
  const eligibleParents = folders.filter(
    (folder) =>
      folder.depth < 4 && (!projectId || !folder.projectId || folder.projectId === projectId),
  );

  return (
    <Dialog
      open={open}
      title="Thư mục mới"
      subtitle={
        effectiveProjectId
          ? `Thư mục chung của dự án ${projectTitles[effectiveProjectId] ?? 'đã chọn'} — mọi thành viên dự án đều tự tạo và quản lý được.`
          : 'Thư mục cấp đơn vị, dùng chung cả đơn vị.'
      }
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
      {!projectId && !parent?.projectId ? (
        <Field label="Thuộc dự án" hint="Bỏ trống là thư mục cấp đơn vị.">
          <Choice
            label="Thuộc dự án"
            value={scopeProjectId}
            emptyOption="Kho cấp đơn vị — dùng chung"
            options={projects.map((project) => ({
              value: project.id,
              label: `${project.code} · ${project.name}`,
            }))}
            onChange={setScopeProjectId}
          />
        </Field>
      ) : null}
    </Dialog>
  );
}

/** Thao tác trên một thư mục, mở từ menu chuột phải của cây. */
interface FolderEdit {
  readonly mode: 'rename' | 'move' | 'delete';
  readonly folder: DocumentFolder;
}

/** Các mục của menu chuột phải trên một thư mục. */
function folderActions(folder: DocumentFolder, itemsInside: number): readonly ContextAction[] {
  return [
    { id: 'new-child', label: 'Thư mục con mới', disabled: folder.depth >= 4 },
    { id: 'rename', label: 'Đổi tên' },
    { id: 'move', label: 'Chuyển đến…' },
    {
      id: 'delete',
      // Chỉ xoá được thư mục rỗng; nói luôn lý do trên nhãn thay vì để báo lỗi.
      label: itemsInside > 0 ? `Xoá thư mục (còn ${itemsInside} mục bên trong)` : 'Xoá thư mục',
      danger: true,
      disabled: itemsInside > 0,
      separatorBefore: true,
    },
  ];
}

/**
 * Đổi tên, chuyển chỗ hoặc xoá một thư mục.
 *
 * Chuyển chỗ chỉ liệt kê những cha hợp lệ — cùng phạm vi (thư mục dự án được
 * vào kho đơn vị, không ngược lại), không phải chính nó hay con cháu của nó,
 * và cả nhánh đi theo vẫn trong giới hạn 5 cấp. Server kiểm lại đủ cả.
 */
function FolderEditDialog({
  edit,
  folders,
  pathOf,
  onClose,
  onDone,
}: {
  edit?: FolderEdit;
  folders: readonly DocumentFolder[];
  pathOf: (folderId: string) => string;
  onClose: () => void;
  /** Báo id thư mục vừa xoá, để khung bên phải không còn đứng trong nó. */
  onDone: (removedId?: string) => void;
}) {
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!edit) return;
    setName(edit.folder.name);
    setParentId(edit.folder.parentId ?? '');
    setError(undefined);
    setSubmitting(false);
  }, [edit]);

  const targets = useMemo(() => {
    if (!edit || edit.mode !== 'move') return [];
    const moving = edit.folder;
    const branch = new Set([moving.id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const folder of folders) {
        if (folder.parentId && branch.has(folder.parentId) && !branch.has(folder.id)) {
          branch.add(folder.id);
          grew = true;
        }
      }
    }
    const height =
      Math.max(
        moving.depth,
        ...folders.filter((folder) => branch.has(folder.id)).map((folder) => folder.depth),
      ) - moving.depth;
    return folders.filter((folder) => {
      if (branch.has(folder.id)) return false;
      if (folder.depth + 1 + height > 4) return false;
      const parentScope = folder.projectId ?? null;
      const childScope = moving.projectId ?? null;
      return parentScope === childScope || (parentScope === null && childScope !== null);
    });
  }, [edit, folders]);

  if (!edit) return null;
  const { mode, folder } = edit;

  const submit = async () => {
    setError(undefined);
    setSubmitting(true);
    try {
      if (mode === 'rename') await api.updateFolder(folder.id, { name: name.trim() });
      else if (mode === 'move') await api.updateFolder(folder.id, { parentId: parentId || null });
      else await api.removeFolder(folder.id);
      onDone(mode === 'delete' ? folder.id : undefined);
      onClose();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không lưu được thư mục.');
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      title={mode === 'rename' ? 'Đổi tên thư mục' : mode === 'move' ? 'Chuyển thư mục' : 'Xoá thư mục?'}
      subtitle={pathOf(folder.id)}
      submitLabel={mode === 'rename' ? 'Lưu' : mode === 'move' ? 'Chuyển' : 'Xoá thư mục'}
      cancelLabel={mode === 'delete' ? 'Giữ lại' : undefined}
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      {mode === 'rename' ? (
        <Field label="Tên thư mục">
          <input
            value={name}
            required
            maxLength={180}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
      ) : mode === 'move' ? (
        <Field label="Chuyển vào" hint="Cả các thư mục con đi theo. Cây tối đa 5 cấp.">
          <Choice
            label="Chuyển vào"
            value={parentId}
            emptyOption="Gốc của kho"
            options={targets.map((target) => ({ value: target.id, label: pathOf(target.id) }))}
            onChange={setParentId}
          />
        </Field>
      ) : (
        <p className={styles.muted}>
          Thư mục biến khỏi cây. Chỉ xoá được thư mục rỗng; tài liệu chỉ được tham chiếu vào đây
          vẫn còn nguyên ở thư mục gốc của chúng.
        </p>
      )}
    </Dialog>
  );
}

/**
 * Cho tài liệu hiện thêm ở một thư mục khác — không tải lại, không nhân bản
 * tệp. Liệt kê mọi thư mục trừ thư mục gốc, các thư mục cha của nó (tài liệu
 * đã nằm trong nhánh đó rồi) và những nơi đã có tham chiếu.
 */
function AddToFolderDialog({
  document,
  folders,
  placeOf,
  onClose,
  onDone,
}: {
  document?: DocumentDetail;
  folders: readonly DocumentFolder[];
  placeOf: (folderId: string) => string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [folderId, setFolderId] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setFolderId('');
    setError(undefined);
    setSubmitting(false);
  }, [document?.id]);

  if (!document) return null;
  const taken = new Set([
    document.folderId,
    ...(document.folderRefs ?? []).map((ref) => ref.folderId),
  ]);
  // Thư mục cha của thư mục gốc: "TÂN ÂN" khi tài liệu nằm ở "TÂN ÂN / ASTRO
  // CHUNG". Thêm tham chiếu vào đó chỉ làm tài liệu hiện hai lần trong một nhánh.
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const seen = new Set<string>();
  for (
    let cursor = byId.get(document.folderId)?.parentId;
    cursor && !seen.has(cursor);
    cursor = byId.get(cursor)?.parentId
  ) {
    seen.add(cursor);
    taken.add(cursor);
  }
  // Tài liệu của một dự án chỉ thêm vào thư mục của chính dự án đó hoặc kho
  // đơn vị; tài liệu dùng chung thì vào đâu cũng được.
  const options = folders
    .filter((folder) => !taken.has(folder.id))
    .filter(
      (folder) =>
        !document.projectId || !folder.projectId || folder.projectId === document.projectId,
    )
    .map((folder) => ({ value: folder.id, label: placeOf(folder.id) }))
    .sort((left, right) => left.label.localeCompare(right.label, 'vi'));

  const submit = async () => {
    setError(undefined);
    setSubmitting(true);
    try {
      await api.addFolderRef(document.id, { folderId });
      onDone();
      onClose();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không thêm được vào thư mục.');
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      title="Thêm vào thư mục"
      subtitle={`"${document.name}" sẽ hiện thêm ở thư mục được chọn. Vẫn là một tài liệu: bản mới, khoá hay lưu trữ ở đâu cũng áp cho mọi nơi.`}
      submitLabel="Thêm"
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => {
        if (!folderId) {
          setError('Chọn một thư mục.');
          return;
        }
        void submit();
      }}
    >
      <Field label="Thư mục">
        <Choice
          label="Thư mục"
          value={folderId}
          placeholder="Chọn thư mục"
          options={options}
          onChange={setFolderId}
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
/** Nút lọc loại tệp; giá trị rỗng là "Tất cả". */
const KIND_CHIPS: readonly { value: string; label: string; title?: string }[] = [
  { value: '', label: 'Tất cả' },
  { value: 'pdf', label: 'PDF' },
  { value: 'office', label: 'Office', title: 'Word, Excel, PowerPoint' },
  { value: 'image', label: 'Ảnh' },
  { value: 'archive', label: 'Nén, văn bản', title: 'Văn bản, CSV, tệp nén' },
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

/** Màu ô loại tệp theo đuôi: bảng tính xanh lá, văn bản xanh dương, PDF đỏ… */
const TILE_TONE: Readonly<Record<string, string>> = {
  xls: 'green', xlsx: 'green', csv: 'green', ods: 'green',
  doc: 'blue', docx: 'blue', odt: 'blue', txt: 'blue',
  pdf: 'red',
  ppt: 'orange', pptx: 'orange', odp: 'orange',
  dwg: 'purple', dxf: 'purple',
  png: 'pink', jpg: 'pink', jpeg: 'pink', gif: 'pink', webp: 'pink', svg: 'pink',
};

/** Ô vuông nhỏ ghi đuôi tệp, đứng trước tên tài liệu. */
function FileTile({ fileName, large = false }: { fileName: string; large?: boolean }) {
  const dot = fileName.lastIndexOf('.');
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
  return (
    <span
      className={large ? `${styles.fileTile} ${styles.fileTileLarge}` : styles.fileTile}
      data-tone={TILE_TONE[ext] ?? 'gray'}
      aria-hidden
    >
      {(ext || 'tệp').slice(0, 4).toUpperCase()}
    </span>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} MB`;
}

/**
 * Tên ngắn cho nhãn khoá trên dòng: "Phạm Văn Dũng" → "Phạm D". Tên đầy đủ nằm
 * trong chú thích của nhãn.
 */
function shortName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return name;
  return `${words[0]} ${words[words.length - 1].charAt(0)}`;
}
