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
import { ancestry, branchIds, childrenOf, expiryTone } from '../library.model';
import * as api from '../shared-api';
import styles from '../shared.module.scss';
import { ContentsTable, type ContentRow, type Selection } from './contents-table';
import { DocumentDetail, FolderDetail } from './detail-panel';
import { DocumentDialog } from './document-dialog';
import { FolderDialog } from './folder-dialog';
import { FolderTree } from './folder-tree';
import { Preview, type PreviewTarget } from './preview';
import { KIND_OPTIONS } from './record-fields';
import { UploadDialog } from './upload-dialog';
import { VersionDialog } from './version-dialog';

type StatusFilter = 'active' | 'expiring' | 'archived';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Đang dùng' },
  { value: 'expiring', label: 'Sắp hết hiệu lực' },
  { value: 'archived', label: 'Đã lưu trữ' },
];

/** "Sắp hết hiệu lực" tính trong 60 ngày tới, kể cả đã hết. */
const EXPIRING_DAYS = 60;

export interface LibraryRequest {
  readonly kind: 'upload' | 'folder';
  readonly nonce: number;
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
  /** Gọi sau khi tải tệp lên để thanh bên cập nhật dung lượng. */
  readonly onStorageChanged: () => void;
}

export function LibraryView({
  capabilities,
  currentUserId,
  folderId,
  onOpenFolder,
  onPathChange,
  request,
  onStorageChanged,
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

  const current = folderId ? folders.find((folder) => folder.id === folderId) : undefined;
  const folderIdRef = useRef(folderId);
  folderIdRef.current = folderId;
  /** Dòng cần chọn sau khi chuyển sang thư mục khác (vd tài liệu vừa tải lên). */
  const pendingSelection = useRef<Selection | undefined>(undefined);

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
    onPathChange(chain.map((folder) => folder.name));
    if (chain.length) {
      setExpanded((open) => {
        const missing = chain.filter((folder) => !open.has(folder.id));
        if (!missing.length) return open;
        const next = new Set(open);
        for (const folder of missing) next.add(folder.id);
        return next;
      });
    }
  }, [folders, folderId, onPathChange]);

  // Gõ xong 300 ms mới tìm.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  /** Tìm, hay lọc trạng thái khác "đang dùng": danh sách phẳng, không theo cây. */
  const flat = Boolean(query) || status !== 'active';

  useEffect(() => {
    if (!flat && !folderId) {
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
  }, [flat, folderId, query, kind, status, reloadKey]);

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

  // Đổi thư mục, đổi bộ lọc thì bỏ chọn dòng cũ (trừ dòng đã hẹn chọn).
  useEffect(() => {
    setSelection(pendingSelection.current);
    pendingSelection.current = undefined;
  }, [folderId, query, kind, status]);

  /** Chọn một dòng ở thư mục `targetFolderId`, mở thư mục đó trước nếu cần. */
  const selectIn = useCallback(
    (targetFolderId: string, next: Selection) => {
      if (targetFolderId === folderIdRef.current) {
        setSelection(next);
        return;
      }
      pendingSelection.current = next;
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
    else setUploadOpen(true);
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
            placeholder={current ? `Tìm trong ${current.name}` : 'Tìm trong Tài liệu công ty'}
            aria-label="Tìm tài liệu"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
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
      </div>

      <div className={styles.columns}>
        <FolderTreeColumn
          folders={folders}
          currentId={folderId}
          expanded={expanded}
          onExpandedChange={setExpanded}
          onOpen={onOpenFolder}
        />
        <ContentsTable
          rows={rows}
          selection={selection}
          loading={loading || !foldersLoaded}
          showPath={flat}
          label={label}
          onSelect={setSelection}
          onOpenFolder={(id) => onOpenFolder(id)}
          onOpenDocument={openDocument}
        />
        {selectedFolder ? (
          <FolderDetail
            folder={selectedFolder}
            documents={folderDocuments}
            capabilities={capabilities}
            onOpen={() => onOpenFolder(selectedFolder.id)}
            onEdit={() => setFolderTarget({ folder: selectedFolder })}
            onRemove={async () => {
              try {
                await api.removeFolder(selectedFolder.id);
                toast.success('Đã xoá thư mục.');
                setSelection(undefined);
                refresh();
              } catch (cause) {
                toast.error(api.errorMessage(cause, 'Không xoá được thư mục.'));
              }
            }}
            onSelectDocument={(id) => selectIn(selectedFolder.id, { type: 'document', id })}
          />
        ) : detail && selection?.type === 'document' && detail.id === selection.id ? (
          <DocumentDetail
            document={detail}
            capabilities={capabilities}
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
          />
        ) : null}
      </div>

      <FolderDialog
        target={folderTarget}
        folders={folders}
        canManage={capabilities.canManage}
        onClose={() => setFolderTarget(undefined)}
        onSaved={(folder) => {
          toast.success(folderTarget?.folder ? 'Đã lưu thư mục.' : 'Đã tạo thư mục.');
          refresh();
          // Thư mục hiện ở bảng của thư mục cha; tạo ở gốc thì về gốc kho.
          if (folder.parentId) selectIn(folder.parentId, { type: 'folder', id: folder.id });
          else if (folderIdRef.current) {
            pendingSelection.current = { type: 'folder', id: folder.id };
            onOpenFolder(undefined);
          } else setSelection({ type: 'folder', id: folder.id });
        }}
      />
      <UploadDialog
        open={uploadOpen}
        folders={folders}
        defaultFolderId={folderId}
        onClose={() => setUploadOpen(false)}
        onUploaded={(documentId, targetFolderId) => {
          toast.success('Đã tải tài liệu lên.');
          onStorageChanged();
          refresh();
          selectIn(targetFolderId, { type: 'document', id: documentId });
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
      <Preview target={preview} onClose={() => setPreview(undefined)} />
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
}: {
  readonly folders: readonly SharedFolder[];
  readonly currentId?: string;
  readonly expanded: ReadonlySet<string>;
  readonly onExpandedChange: (next: Set<string>) => void;
  readonly onOpen: (folderId: string | undefined) => void;
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
    />
  );
}
