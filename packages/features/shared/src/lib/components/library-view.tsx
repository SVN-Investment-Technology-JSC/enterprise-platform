'use client';

import type {
  SharedCapabilities,
  SharedDocumentDetail,
  SharedDocumentKind,
  SharedDocumentSummary,
  SharedFolder,
} from '@enterprise-platform/contracts-shared';
import { SHARED_PREVIEWABLE_CONTENT_TYPES } from '@enterprise-platform/contracts-shared';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildMenu, rightsOf, type MenuActionId, type MenuEntry, type MenuTarget } from '../context-menu.model';
import { accessMap, ancestry, branchIds, childrenOf, expiryTone } from '../library.model';
import * as api from '../shared-api';
import styles from '../shared.module.scss';
import { ConfirmDialog, type ConfirmRequest } from './confirm-dialog';
import { ContentsTable, type ContentRow, type Selection } from './contents-table';
import { ContextMenu, type MenuAnchor } from './context-menu';
import { DocumentDetail, FolderDetail } from './detail-panel';
import { DocumentDialog } from './document-dialog';
import { FolderDialog } from './folder-dialog';
import { FolderTree } from './folder-tree';
import { MoveDialog, type MoveTarget } from './move-dialog';
import { Preview, type PreviewTarget } from './preview';
import { QuickEditDialog, type QuickEditField, type QuickEditTarget } from './quick-edit-dialog';
import { KIND_OPTIONS } from './record-fields';
import { ShareDialog } from './share-dialog';
import { TrashPanel } from './trash-panel';
import { UploadDialog, type UploadMode, type UploadSummary } from './upload-dialog';
import { VersionDialog } from './version-dialog';

type StatusFilter = 'active' | 'expiring' | 'archived';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Đang dùng' },
  { value: 'expiring', label: 'Sắp hết hiệu lực' },
  { value: 'archived', label: 'Đã lưu trữ' },
];

/** "Sắp hết hiệu lực" tính trong 60 ngày tới, kể cả đã hết. */
const EXPIRING_DAYS = 60;

/** Dòng hẹn chọn sau khi mở thư mục `folderId`; quá hạn mà thư mục chưa mở thì bỏ. */
interface PendingSelection {
  readonly folderId: string | undefined;
  readonly selection: Selection;
  readonly at: number;
}

const PENDING_SELECTION_TTL_MS = 5000;

/** Lời báo sau một lượt tải: số tệp đã lên, số tệp bỏ qua vì đã có trong thư mục. */
function uploadMessage({ uploaded, skipped }: UploadSummary): string {
  if (uploaded === 0) return `Các tệp đã có, bỏ qua ${skipped} tệp.`;
  return skipped > 0 ? `Đã tải lên ${uploaded} tệp, bỏ qua ${skipped} tệp đã có.` : `Đã tải lên ${uploaded} tệp.`;
}

export interface LibraryRequest {
  readonly kind: 'upload' | 'folder';
  readonly nonce: number;
}

/** Hai nút đầu trang hiện được không, theo quyền ở thư mục đang mở. */
export interface LibraryAbilities {
  /** Tạo thư mục trong thư mục đang mở; ở gốc kho là tạo thư mục gốc. */
  readonly createFolder: boolean;
  /** Có ít nhất một thư mục tải lên được. */
  readonly upload: boolean;
}

export interface LibraryViewProps {
  readonly capabilities: SharedCapabilities;
  readonly currentUserId: string;
  /** Thư mục đang mở (đoạn hash sau `library/`); rỗng là gốc kho. */
  readonly folderId?: string;
  readonly onOpenFolder: (folderId: string | undefined) => void;
  readonly onPathChange: (names: readonly string[]) => void;
  /** Lệnh từ hai nút đầu trang. */
  readonly request?: LibraryRequest;
  /** Gọi sau khi tải tệp lên hay dọn Thùng rác để thanh bên cập nhật dung lượng. */
  readonly onStorageChanged: () => void;
  /** Đang xem Thùng rác (đoạn hash `library/trash`): bảng và khung chi tiết nhường chỗ cho Thùng rác. */
  readonly trash: boolean;
  readonly onOpenTrash: () => void;
  /** Báo lên đầu trang nút nào hiện được, mỗi khi cây thư mục hay thư mục đang mở đổi. */
  readonly onAbilitiesChange: (abilities: LibraryAbilities) => void;
}

export function LibraryView({
  capabilities,
  currentUserId,
  folderId,
  onOpenFolder,
  onPathChange,
  request,
  onStorageChanged,
  trash,
  onOpenTrash,
  onAbilitiesChange,
}: LibraryViewProps) {
  const [folders, setFolders] = useState<SharedFolder[]>([]);
  const [foldersLoaded, setFoldersLoaded] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [documents, setDocuments] = useState<SharedDocumentSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<SharedDocumentKind | ''>('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [selection, setSelection] = useState<Selection>();
  const [detail, setDetail] = useState<SharedDocumentDetail>();
  const [folderDocuments, setFolderDocuments] = useState<SharedDocumentSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [folderTarget, setFolderTarget] = useState<{ folder?: SharedFolder; parentId?: string }>();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [versionTarget, setVersionTarget] = useState<SharedDocumentSummary>();
  const [editTarget, setEditTarget] = useState<SharedDocumentSummary>();
  const [preview, setPreview] = useState<PreviewTarget>();
  const [menu, setMenu] = useState<{ id: number; anchor: MenuAnchor; entries: MenuEntry[]; target: MenuTarget }>();
  const [quickEdit, setQuickEdit] = useState<QuickEditTarget>();
  const [moveTarget, setMoveTarget] = useState<MoveTarget>();
  const [confirm, setConfirm] = useState<ConfirmRequest>();
  const [shareTarget, setShareTarget] = useState<SharedFolder>();
  /** Thư mục mà hộp thoại Tải lên mở sẵn khi chọn từ menu; rỗng là thư mục đang xem. */
  const [uploadFolderId, setUploadFolderId] = useState<string>();
  /** Mở từ "Tải thư mục lên" thì hộp thoại bật ngay hộp chọn thư mục của máy. */
  const [uploadMode, setUploadMode] = useState<UploadMode>('files');
  const menuId = useRef(0);

  const current = folderId ? folders.find((folder) => folder.id === folderId) : undefined;

  // Quyền theo thư mục: server trả `access` trên từng thư mục người dùng được vào.
  const roleOf = useMemo(() => accessMap(folders), [folders]);
  const rightsIn = useCallback(
    (targetFolderId: string | undefined) => rightsOf(capabilities, roleOf(targetFolderId)),
    [capabilities, roleOf],
  );
  const writable = useCallback((folder: SharedFolder) => rightsOf(capabilities, folder.access).write, [capabilities]);
  const canUploadSomewhere = useMemo(() => folders.some(writable), [folders, writable]);

  useEffect(() => {
    onAbilitiesChange({
      createFolder: current ? rightsOf(capabilities, current.access).write : capabilities.canManage,
      upload: canUploadSomewhere,
    });
  }, [current, capabilities, canUploadSomewhere, onAbilitiesChange]);
  const folderIdRef = useRef(folderId);
  folderIdRef.current = folderId;
  /** Dòng cần chọn sau khi mở xong thư mục `folderId` (vd tài liệu vừa tải lên, dòng vừa "đến vị trí"). */
  const pendingSelection = useRef<PendingSelection | undefined>(undefined);

  const reloadFolders = useCallback(() => {
    api
      .listFolders()
      .then((items) => {
        setFolders(items);
        setFoldersLoaded(true);
      })
      .catch((cause) => setError(api.errorMessage(cause, 'Không tải được cây thư mục.')));
  }, []);

  useEffect(() => reloadFolders(), [reloadFolders]);

  // Thư mục trong link không còn (đã xoá, không có quyền) thì về gốc kho.
  useEffect(() => {
    if (foldersLoaded && folderId && !current) onOpenFolder(undefined);
  }, [foldersLoaded, folderId, current, onOpenFolder]);

  // Bung nhánh dẫn tới thư mục đang xem (kể cả chính nó), và báo đường dẫn lên đầu trang.
  useEffect(() => {
    const chain = ancestry(folders, folderId);
    onPathChange(trash ? ['Thùng rác'] : chain.map((folder) => folder.name));
    if (chain.length) {
      setExpanded((open) => {
        const missing = chain.filter((folder) => !open.has(folder.id));
        if (!missing.length) return open;
        const next = new Set(open);
        for (const folder of missing) next.add(folder.id);
        return next;
      });
    }
  }, [folders, folderId, trash, onPathChange]);

  // Gõ xong 300 ms mới tìm.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  /** Tìm, hay lọc trạng thái khác "đang dùng": danh sách phẳng, không theo cây. */
  const flat = Boolean(query) || status !== 'active';

  useEffect(() => {
    if (trash || (!flat && !folderId)) {
      setDocuments([]);
      return;
    }
    let alive = true;
    setLoading(true);
    api
      .listDocuments({
        // Tìm và lọc thì hỏi cả kho rồi giữ phần thuộc nhánh đang mở.
        folderId: flat ? undefined : folderId,
        search: query || undefined,
        kind: kind || undefined,
        status: status === 'archived' ? 'archived' : 'active',
        expiringWithinDays: status === 'expiring' ? EXPIRING_DAYS : undefined,
      })
      .then((items) => {
        if (!alive) return;
        setDocuments(items);
        setError(undefined);
      })
      .catch((cause) => alive && setError(api.errorMessage(cause, 'Không tải được tài liệu.')))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [trash, flat, folderId, query, kind, status, reloadKey]);

  const rows = useMemo<ContentRow[]>(() => {
    const branch = folderId ? branchIds(folders, folderId) : undefined;
    const inBranch = (id: string) => !branch || branch.has(id);
    const matchKind = (folder: SharedFolder) => !kind || folder.docKind === kind;
    const needle = query.toLowerCase();

    let folderRows: SharedFolder[];
    if (status === 'archived') folderRows = [];
    else if (status === 'expiring') {
      folderRows = folders.filter(
        (folder) =>
          folder.id !== folderId &&
          inBranch(folder.id) &&
          matchKind(folder) &&
          expiryTone(folder.effectiveTo) !== 'normal',
      );
    } else if (query) {
      folderRows = folders.filter(
        (folder) =>
          folder.id !== folderId &&
          inBranch(folder.id) &&
          matchKind(folder) &&
          [folder.name, folder.docNumber, folder.partner]
            .filter(Boolean)
            .some((text) => String(text).toLowerCase().includes(needle)),
      );
    } else {
      folderRows = childrenOf(folders, folderId).filter(matchKind);
    }

    const documentRows = flat ? documents.filter((document) => inBranch(document.folderId)) : documents;
    return [
      ...folderRows.map((folder): ContentRow => ({ type: 'folder', folder })),
      ...documentRows.map((document): ContentRow => ({ type: 'document', document })),
    ];
  }, [folders, folderId, documents, kind, query, status, flat]);

  // Đổi thư mục, đổi bộ lọc thì bỏ chọn dòng cũ, trừ dòng đã hẹn chọn ở thư mục vừa mở.
  useEffect(() => {
    const pending = pendingSelection.current;
    const fresh = Boolean(pending) && Date.now() - (pending?.at ?? 0) < PENDING_SELECTION_TTL_MS;
    if (pending && fresh && pending.folderId === folderId) {
      pendingSelection.current = undefined;
      setSelection(pending.selection);
      return;
    }
    // Hẹn cho thư mục khác thì giữ lại tới khi thư mục đó mở xong (bỏ bộ lọc và đổi thư mục
    // chạy hiệu ứng này hai lần); quá hạn thì bỏ, để không chọn nhầm về sau.
    if (!fresh) pendingSelection.current = undefined;
    setSelection(undefined);
  }, [trash, folderId, query, kind, status]);

  /** Chọn một dòng ở thư mục `targetFolderId`, mở thư mục đó trước nếu cần. */
  const selectIn = useCallback(
    (targetFolderId: string, next: Selection) => {
      if (targetFolderId === folderIdRef.current) {
        setSelection(next);
        return;
      }
      pendingSelection.current = { folderId: targetFolderId, selection: next, at: Date.now() };
      onOpenFolder(targetFolderId);
    },
    [onOpenFolder],
  );

  const selectedFolder =
    selection?.type === 'folder' ? folders.find((folder) => folder.id === selection.id) : undefined;

  useEffect(() => {
    if (selection?.type !== 'document') {
      setDetail(undefined);
      return;
    }
    let alive = true;
    api
      .loadDocument(selection.id)
      .then((next) => alive && setDetail(next))
      .catch((cause) => alive && setError(api.errorMessage(cause, 'Không mở được tài liệu.')));
    return () => {
      alive = false;
    };
  }, [selection, reloadKey]);

  useEffect(() => {
    if (!selectedFolder) {
      setFolderDocuments([]);
      return;
    }
    let alive = true;
    api
      .listDocuments({ folderId: selectedFolder.id })
      .then((items) => alive && setFolderDocuments(items))
      .catch(() => alive && setFolderDocuments([]));
    return () => {
      alive = false;
    };
  }, [selectedFolder]);

  // Hai nút đầu trang: Thư mục mới, Tải lên. Chạy theo lượt bấm (nonce), không theo thư mục.
  useEffect(() => {
    if (!request) return;
    if (request.kind === 'folder') setFolderTarget({ parentId: folderIdRef.current });
    else {
      setUploadFolderId(undefined);
      setUploadMode('files');
      setUploadOpen(true);
    }
  }, [request]);

  const refresh = useCallback(() => {
    reloadFolders();
    setReloadKey((key) => key + 1);
  }, [reloadFolders]);

  const act = async (action: () => Promise<unknown>, done: string, failed: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(done);
      refresh();
    } catch (cause) {
      toast.error(api.errorMessage(cause, failed));
    } finally {
      setBusy(false);
    }
  };

  const openDocument = (document: SharedDocumentSummary) => {
    const version = document.currentVersion;
    if (version?.sizeBytes !== undefined && SHARED_PREVIEWABLE_CONTENT_TYPES.includes(version.contentType)) {
      setPreview({ documentId: document.id, title: document.name });
    } else {
      setSelection({ type: 'document', id: document.id });
    }
  };

  const download = (documentId: string, versionId?: string) =>
    void api
      .openDocumentFile(documentId, versionId)
      .then(() => setReloadKey((key) => key + 1))
      .catch((cause) => toast.error(api.errorMessage(cause, 'Không tải xuống được.')));

  const label = current ? `Nội dung thư mục ${current.name}` : 'Tài liệu công ty';
  // Thùng rác theo quyền xoá của phân hệ; server chỉ trả mục ở thư mục người dùng có quyền Sửa.
  const canOpenTrash = capabilities.canDeleteDocuments || capabilities.isTenantAdmin;

  /* ------------------------------------------------- xoá, nhân bản, đến vị trí */

  /** Chuyển cả nhánh vào Thùng rác. Ném lỗi để nơi gọi hiện cho người dùng. */
  const removeFolder = async (folder: SharedFolder) => {
    const result = await api.deleteFolder(folder.id);
    const inside = [
      result.folders ? `${result.folders.toLocaleString('vi-VN')} thư mục con` : '',
      result.documents ? `${result.documents.toLocaleString('vi-VN')} tài liệu` : '',
    ]
      .filter(Boolean)
      .join(', ');
    toast.success(
      inside
        ? `Đã chuyển “${folder.name}” cùng ${inside} vào Thùng rác.`
        : `Đã chuyển “${folder.name}” vào Thùng rác.`,
    );
    // Đang đứng trong nhánh vừa xoá thì lui về thư mục cha của nó.
    if (folderIdRef.current && branchIds(folders, folder.id).has(folderIdRef.current)) onOpenFolder(folder.parentId);
    setSelection(undefined);
    refresh();
  };

  const removeDocument = async (document: SharedDocumentSummary) => {
    await api.deleteDocument(document.id);
    toast.success(`Đã chuyển “${document.name}” vào Thùng rác.`);
    setSelection((selected) => (selected?.id === document.id ? undefined : selected));
    refresh();
  };

  const askDeleteDocument = (document: SharedDocumentSummary) =>
    setConfirm({
      title: 'Xoá tài liệu',
      message: `Chuyển “${document.name}” vào Thùng rác?`,
      confirmLabel: 'Xoá',
      pendingLabel: 'Đang xoá…',
      danger: true,
      onConfirm: () => removeDocument(document),
    });

  const askDeleteFolder = (folder: SharedFolder) => {
    const subfolders = branchIds(folders, folder.id).size - 1;
    const inside = [
      subfolders ? `${subfolders.toLocaleString('vi-VN')} thư mục con` : '',
      folder.totalDocumentCount ? `${folder.totalDocumentCount.toLocaleString('vi-VN')} tài liệu` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    setConfirm({
      title: 'Xoá thư mục',
      message: `Chuyển thư mục “${folder.name}” vào Thùng rác?`,
      detail: inside || undefined,
      confirmLabel: 'Xoá',
      pendingLabel: 'Đang xoá…',
      danger: true,
      onConfirm: () => removeFolder(folder),
    });
  };

  const askArchive = (document: SharedDocumentSummary) =>
    setConfirm({
      title: 'Lưu trữ tài liệu',
      message: `Lưu trữ “${document.name}”?`,
      confirmLabel: 'Lưu trữ',
      onConfirm: async () => {
        await api.archiveDocument(document.id);
        toast.success('Đã lưu trữ tài liệu.');
        refresh();
      },
    });

  const duplicate = async (document: SharedDocumentSummary) => {
    setBusy(true);
    try {
      const copy = await api.duplicateDocument(document.id);
      toast.success(`Đã nhân bản thành “${copy.name}”.`);
      onStorageChanged();
      refresh();
      selectIn(copy.folderId, { type: 'document', id: copy.id });
    } catch (cause) {
      toast.error(api.errorMessage(cause, 'Không nhân bản được.'));
    } finally {
      setBusy(false);
    }
  };

  /** "Đến vị trí thư mục": bỏ tìm kiếm, bộ lọc rồi mở thư mục chứa dòng và chọn nó. */
  const locate = (targetFolderId: string | undefined, next: Selection) => {
    const filtered = Boolean(query) || Boolean(kind) || status !== 'active';
    setSearch('');
    setQuery('');
    setKind('');
    setStatus('active');
    if (targetFolderId === folderIdRef.current && !filtered) {
      setSelection(next);
      return;
    }
    // Đổi thư mục hay bộ lọc sẽ chạy hiệu ứng bỏ chọn; dòng hẹn trước được chọn lại sau đó.
    pendingSelection.current = { folderId: targetFolderId, selection: next, at: Date.now() };
    if (targetFolderId !== folderIdRef.current) onOpenFolder(targetFolderId);
  };

  const editDocument = (field: QuickEditField, document: SharedDocumentSummary) =>
    setQuickEdit({ kind: 'document', field, document });

  const editFolder = (field: 'name' | 'description', folder: SharedFolder) =>
    setQuickEdit({ kind: 'folder', field, folder });

  /* ------------------------------------------------------------ menu chuột phải */

  /** Dựng menu rồi mở; trả `false` khi người dùng không có thao tác nào để hiện. */
  const openMenu = (target: MenuTarget, anchor: MenuAnchor, listFlat = flat): boolean => {
    const entries = buildMenu(target, { capabilities, currentUserId, flat: listFlat, roleOf, canUploadSomewhere });
    if (!entries.some((entry) => entry.kind === 'item')) return false;
    menuId.current += 1;
    setMenu({ id: menuId.current, anchor, entries, target });
    return true;
  };

  const openRowMenu = (row: ContentRow, anchor: MenuAnchor) => {
    if (row.type === 'folder') {
      setSelection({ type: 'folder', id: row.folder.id });
      openMenu({ kind: 'folder', folder: row.folder }, anchor);
    } else {
      setSelection({ type: 'document', id: row.document.id });
      openMenu({ kind: 'document', document: row.document }, anchor);
    }
  };

  /** Chỗ trống của bảng là thư mục đang mở; kết quả tìm kiếm không thuộc thư mục nào nên không có menu. */
  const openBlankMenu = (anchor: MenuAnchor): boolean => !flat && openMenu({ kind: 'blank', folder: current }, anchor);

  const openTreeMenu = (folder: SharedFolder | undefined, anchor: MenuAnchor) => {
    openMenu(folder ? { kind: 'folder', folder } : { kind: 'blank' }, anchor, false);
  };

  const runDocumentAction = (id: MenuActionId, document: SharedDocumentSummary) => {
    switch (id) {
      case 'view':
        return openDocument(document);
      case 'download':
        return download(document.id);
      case 'locate':
        return locate(document.folderId, { type: 'document', id: document.id });
      case 'edit-description':
        return editDocument('description', document);
      case 'rename':
        return editDocument('name', document);
      case 'tags':
        return editDocument('tags', document);
      case 'validity':
        return editDocument('validity', document);
      case 'move':
        return setMoveTarget({ kind: 'document', document });
      case 'record-info':
        return setEditTarget(document);
      case 'new-version':
        return setVersionTarget(document);
      case 'duplicate':
        return void duplicate(document);
      case 'lock':
        return void act(() => api.lockDocument(document.id), 'Đã khoá tài liệu.', 'Không khoá được.');
      case 'unlock':
        return void act(() => api.unlockDocument(document.id), 'Đã mở khoá.', 'Không mở khoá được.');
      case 'archive':
        return askArchive(document);
      case 'unarchive':
        return void act(() => api.restoreDocument(document.id), 'Đã khôi phục tài liệu.', 'Không khôi phục được.');
      case 'delete':
        return askDeleteDocument(document);
      default:
    }
  };

  const runFolderAction = (id: MenuActionId, folder: SharedFolder) => {
    switch (id) {
      case 'open':
        return onOpenFolder(folder.id);
      case 'new-folder':
        return setFolderTarget({ parentId: folder.id });
      case 'upload':
      case 'upload-folder':
        setUploadFolderId(folder.id);
        setUploadMode(id === 'upload-folder' ? 'folder' : 'files');
        return setUploadOpen(true);
      case 'share':
        return setShareTarget(folder);
      case 'locate':
        // Thư mục cha không hiện với người dùng thì thư mục này đứng ở gốc cây của họ.
        return locate(folder.parentId && roleOf(folder.parentId) ? folder.parentId : undefined, {
          type: 'folder',
          id: folder.id,
        });
      case 'edit-description':
        return editFolder('description', folder);
      case 'rename':
        return editFolder('name', folder);
      case 'move':
        return setMoveTarget({ kind: 'folder', folder });
      case 'record-info':
        return setFolderTarget({ folder });
      case 'delete':
        return askDeleteFolder(folder);
      default:
    }
  };

  const runRootAction = (id: MenuActionId) => {
    if (id === 'new-folder') setFolderTarget({ parentId: undefined });
    else if (id === 'upload' || id === 'upload-folder') {
      setUploadFolderId(undefined);
      setUploadMode(id === 'upload-folder' ? 'folder' : 'files');
      setUploadOpen(true);
    }
  };

  const runAction = (id: MenuActionId, target: MenuTarget) => {
    setMenu(undefined);
    if (target.kind === 'document') runDocumentAction(id, target.document);
    else if (target.kind === 'folder') runFolderAction(id, target.folder);
    else if (target.kind === 'blank') {
      if (target.folder) runFolderAction(id, target.folder);
      else runRootAction(id);
    }
  };

  return (
    <div className={styles.library}>
      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}

      <div className={styles.toolbar}>
        <label className={styles.search}>
          <Search size={15} aria-hidden />
          <input
            type="search"
            value={search}
            placeholder={
              trash ? 'Tìm trong Thùng rác' : current ? `Tìm trong ${current.name}` : 'Tìm trong Tài liệu công ty'
            }
            aria-label="Tìm tài liệu"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {trash ? null : (
          <>
            <div className={styles.filter}>
              <SearchableSelect
                options={KIND_OPTIONS}
                value={kind}
                placeholder="Mọi loại hồ sơ"
                clearable
                onChange={(value) => setKind(value as SharedDocumentKind | '')}
              />
            </div>
            <div className={styles.filter}>
              <SearchableSelect
                options={STATUS_OPTIONS}
                value={status}
                clearable={false}
                onChange={(value) => setStatus((value || 'active') as StatusFilter)}
              />
            </div>
          </>
        )}
      </div>

      <div className={styles.columns}>
        <FolderTreeColumn
          folders={folders}
          currentId={folderId}
          expanded={expanded}
          onExpandedChange={setExpanded}
          onOpen={onOpenFolder}
          onMenu={openTreeMenu}
          trash={canOpenTrash ? { active: trash, onOpen: onOpenTrash } : undefined}
        />
        {trash ? (
          <TrashPanel
            folders={folders}
            capabilities={capabilities}
            restorable={(folder) => rightsOf(capabilities, folder.access).remove}
            query={query}
            onChanged={() => {
              refresh();
              onStorageChanged();
            }}
          />
        ) : (
          <>
            <ContentsTable
              rows={rows}
              selection={selection}
              loading={loading || !foldersLoaded}
              showPath={flat}
              label={label}
              onSelect={setSelection}
              onOpenFolder={(id) => onOpenFolder(id)}
              onOpenDocument={openDocument}
              onRowMenu={openRowMenu}
              onBlankMenu={openBlankMenu}
            />
            {selectedFolder ? (
              <FolderDetail
                folder={selectedFolder}
                documents={folderDocuments}
                rights={rightsOf(capabilities, selectedFolder.access)}
                onOpen={() => onOpenFolder(selectedFolder.id)}
                onEdit={() => setFolderTarget({ folder: selectedFolder })}
                onShare={() => setShareTarget(selectedFolder)}
                onRemove={async () => {
                  try {
                    await removeFolder(selectedFolder);
                  } catch (cause) {
                    toast.error(api.errorMessage(cause, 'Không xoá được thư mục.'));
                  }
                }}
                onSelectDocument={(id) => selectIn(selectedFolder.id, { type: 'document', id })}
              />
            ) : detail && selection?.type === 'document' && detail.id === selection.id ? (
              <DocumentDetail
                document={detail}
                rights={rightsIn(detail.folderId)}
                currentUserId={currentUserId}
                busy={busy}
                onPreview={(versionId) => setPreview({ documentId: detail.id, versionId, title: detail.name })}
                onDownload={(versionId) => download(detail.id, versionId)}
                onNewVersion={() => setVersionTarget(detail)}
                onEdit={() => setEditTarget(detail)}
                onLock={() => void act(() => api.lockDocument(detail.id), 'Đã khoá tài liệu.', 'Không khoá được.')}
                onUnlock={() => void act(() => api.unlockDocument(detail.id), 'Đã mở khoá.', 'Không mở khoá được.')}
                onArchive={() => act(() => api.archiveDocument(detail.id), 'Đã lưu trữ tài liệu.', 'Không lưu trữ được.')}
                onRestore={() => void act(() => api.restoreDocument(detail.id), 'Đã khôi phục tài liệu.', 'Không khôi phục được.')}
                onDelete={async () => {
                  try {
                    await removeDocument(detail);
                  } catch (cause) {
                    toast.error(api.errorMessage(cause, 'Không xoá được tài liệu.'));
                  }
                }}
              />
            ) : null}
          </>
        )}
      </div>

      <FolderDialog
        target={folderTarget}
        folders={folders}
        canManage={capabilities.canManage}
        writable={writable}
        onClose={() => setFolderTarget(undefined)}
        onSaved={(folder) => {
          toast.success(folderTarget?.folder ? 'Đã lưu thư mục.' : 'Đã tạo thư mục.');
          refresh();
          // Thư mục hiện ở bảng của thư mục cha; tạo ở gốc thì về gốc kho.
          if (folder.parentId) selectIn(folder.parentId, { type: 'folder', id: folder.id });
          else if (folderIdRef.current) {
            pendingSelection.current = {
              folderId: undefined,
              selection: { type: 'folder', id: folder.id },
              at: Date.now(),
            };
            onOpenFolder(undefined);
          } else setSelection({ type: 'folder', id: folder.id });
        }}
      />
      <UploadDialog
        open={uploadOpen}
        mode={uploadMode}
        folders={folders}
        writable={writable}
        defaultFolderId={uploadFolderId ?? folderId}
        onClose={() => {
          setUploadOpen(false);
          setUploadFolderId(undefined);
        }}
        onUploaded={(summary) => {
          toast.success(uploadMessage(summary));
          onStorageChanged();
          refresh();
          if (summary.select) selectIn(summary.folderId, summary.select);
        }}
      />
      <VersionDialog
        target={versionTarget}
        onClose={() => setVersionTarget(undefined)}
        onUploaded={() => {
          toast.success('Đã tải phiên bản mới.');
          onStorageChanged();
          refresh();
        }}
      />
      <DocumentDialog
        target={editTarget}
        folders={folders}
        onClose={() => setEditTarget(undefined)}
        onSaved={() => {
          toast.success('Đã lưu thông tin tài liệu.');
          refresh();
        }}
      />
      <QuickEditDialog
        target={quickEdit}
        onClose={() => setQuickEdit(undefined)}
        onSaved={() => {
          toast.success('Đã lưu thay đổi.');
          refresh();
        }}
      />
      <MoveDialog
        target={moveTarget}
        folders={folders}
        canManage={capabilities.canManage}
        allowed={writable}
        onClose={() => setMoveTarget(undefined)}
        onDone={() => {
          toast.success(moveTarget?.kind === 'folder' ? 'Đã chuyển thư mục.' : 'Đã chuyển tài liệu.');
          refresh();
        }}
      />
      <ShareDialog
        folder={shareTarget}
        onClose={() => setShareTarget(undefined)}
        onSaved={() => {
          toast.success('Đã cập nhật chia sẻ.');
          refresh();
        }}
      />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(undefined)} />
      <Preview target={preview} onClose={() => setPreview(undefined)} />
      {menu ? (
        <ContextMenu
          key={menu.id}
          anchor={menu.anchor}
          entries={menu.entries}
          label="Thao tác"
          onClose={() => setMenu(undefined)}
          onPick={(id) => runAction(id, menu.target)}
        />
      ) : null}
    </div>
  );
}

/** Cột cây: giữ trạng thái mở/đóng ở LibraryView để đổi thư mục không mất. */
function FolderTreeColumn({
  folders,
  currentId,
  expanded,
  onExpandedChange,
  onOpen,
  onMenu,
  trash,
}: {
  readonly folders: readonly SharedFolder[];
  readonly currentId?: string;
  readonly expanded: ReadonlySet<string>;
  readonly onExpandedChange: (next: Set<string>) => void;
  readonly onOpen: (folderId: string | undefined) => void;
  readonly onMenu: (folder: SharedFolder | undefined, anchor: MenuAnchor) => void;
  readonly trash?: { readonly active: boolean; readonly onOpen: () => void };
}) {
  return (
    <FolderTree
      folders={folders}
      currentId={currentId}
      expanded={expanded}
      onToggle={(id) => {
        const next = new Set(expanded);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        onExpandedChange(next);
      }}
      onCollapseAll={() => onExpandedChange(new Set())}
      onOpen={onOpen}
      onMenu={onMenu}
      trash={trash}
    />
  );
}
