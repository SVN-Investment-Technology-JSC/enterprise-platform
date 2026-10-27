'use client';

import type {
  SocialBookmarkFolderList,
  SocialPost,
} from '@enterprise-platform/contracts-social';
import { Bookmark, Folder, FolderPlus, Inbox, Layers, Pencil, Trash2 } from 'lucide-react';
import { toast } from '@enterprise-platform/shared-ui';
import { useCallback, useEffect, useState } from 'react';
import extras from '../../post-extras.module.scss';
import { errorMessage } from '../../social-api';
import { deleteBookmarkFolder, loadBookmarkFolders, loadBookmarks, setBookmark } from '../../social-posts-api';
import { BOOKMARK_DRAG_TYPE, isBookmarkDrag } from './bookmark-dnd';
import { Button } from '../../ui/button';
import { Tabs, TabsList, TabsTrigger } from '../../ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip';
import { PostList } from '../post-list';
import { ConfirmDialog } from '../ui';
import { UNFILED_LABEL } from './bookmark-dialog';
import { NewFolderDialog } from './new-folder-dialog';
import styles from './saved-view.module.scss';

/** Kiểu viên thuốc cho hàng thư mục (ghi đè kiểu thanh phân đoạn mặc định của `ui/tabs`). */
const FOLDER_LIST = 'h-auto max-w-full flex-wrap justify-start gap-2 bg-transparent p-0';
const FOLDER_TAB =
  'h-8 gap-1.5 rounded-[8px] border-slate-200 bg-white px-3 data-[drop-over=true]:border-blue-500 data-[drop-over=true]:bg-blue-50 data-[drop-over=true]:ring-2 data-[drop-over=true]:ring-blue-200 text-[13px] text-slate-600 hover:border-slate-300 data-active:border-amber-400 data-active:bg-amber-100 data-active:text-slate-900 data-active:shadow-none';
const FOLDER_COUNT =
  'rounded-[5px] bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-500 tabular-nums ';

/** Giá trị tab: tất cả, chưa phân loại, hoặc mã thư mục. */
const ALL = 'all';
const NONE = 'none';

/**
 * Bài đã lưu: lưu gần nhất trước; bỏ lưu hoặc chuyển sang thư mục khác (khi đang lọc một thư mục) thì bài rời
 * khỏi danh sách.
 */
export function SavedView() {
  const [folderTab, setFolderTab] = useState<string>(ALL);
  const [folders, setFolders] = useState<SocialBookmarkFolderList>();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  /** Tăng sau khi chuyển bài bằng kéo thả để tải lại danh sách. */
  const [reloadKey, setReloadKey] = useState(0);
  /** Chip đang được rê bài kéo qua (NONE hoặc mã thư mục). */
  const [dropOver, setDropOver] = useState<string>();
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();

  const refreshFolders = useCallback(() => {
    loadBookmarkFolders()
      .then(setFolders)
      .catch(() => undefined);
  }, []);
  useEffect(() => refreshFolders(), [refreshFolders]);

  // Thư mục đang chọn (không phải "Tất cả" hay "Chưa phân loại"): chỉ thư mục thật mới sửa và xoá được.
  const currentFolder = folders?.items.find((folder) => folder.id === folderTab);

  const removeFolder = async () => {
    if (!currentFolder) return;
    setDeleteBusy(true);
    setDeleteError(undefined);
    try {
      await deleteBookmarkFolder(currentFolder.id);
      toast.success(`Đã xoá thư mục "${currentFolder.name}"`);
      setDeleting(false);
      setFolderTab(ALL);
      refreshFolders();
    } catch (cause) {
      setDeleteError(errorMessage(cause, 'Không xoá được thư mục.'));
    } finally {
      setDeleteBusy(false);
    }
  };

  // Đang lọc thư mục: bài chuyển sang thư mục khác rời danh sách; "Tất cả" chỉ cần còn được lưu.
  const keep = useCallback(
    (post: SocialPost) => {
      if (post.bookmarked === false) return false;
      if (folderTab === ALL) return true;
      if (folderTab === NONE) return !post.bookmarkFolderId;
      return post.bookmarkFolderId === folderTab;
    },
    [folderTab],
  );

  // `reloadKey` đổi thì hàm đổi và danh sách tải lại.
  const fetchPage = useCallback(
    (cursor?: string) => {
      void reloadKey;
      return loadBookmarks(cursor, 20, folderTab === ALL ? undefined : folderTab);
    },
    [folderTab, reloadKey],
  );

  /** Thả bài vào chip: chuyển sang thư mục đó (NONE là chưa phân loại). */
  const moveByDrop = async (postId: string, target: string, label: string) => {
    try {
      await setBookmark(postId, true, target === NONE ? null : target);
      toast.success(target === NONE ? 'Đã chuyển về Chưa phân loại' : `Đã chuyển sang thư mục "${label}"`);
      refreshFolders();
      setReloadKey((key) => key + 1);
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không chuyển được bài.'));
    }
  };
  const dropProps = (target: string, label: string) => ({
    'data-drop-over': dropOver === target ? 'true' : undefined,
    onDragOver: (event: React.DragEvent) => {
      if (!isBookmarkDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropOver(target);
    },
    onDragLeave: () => setDropOver((current) => (current === target ? undefined : current)),
    onDrop: (event: React.DragEvent) => {
      if (!isBookmarkDrag(event)) return;
      event.preventDefault();
      setDropOver(undefined);
      const postId = event.dataTransfer.getData(BOOKMARK_DRAG_TYPE);
      if (postId) void moveByDrop(postId, target, label);
    },
  });

  return (
    <section className={extras.view} aria-label="Bài đã lưu">
      <header className={styles.head}>
        <div className={styles.titleRow}>
          <span className={styles.icon} aria-hidden="true">
            <Bookmark size={20} />
          </span>
          <div className={styles.text}>
            <h2>
              Bài đã lưu
              {folders ? (
                <span className={styles.total}>
                  <strong>{folders.total}</strong> bài
                </span>
              ) : null}
            </h2>
            <p>Những bài bạn đánh dấu để xem lại sau. Chỉ mình bạn thấy danh sách này.</p>
          </div>
          {folders ? (
            <Button
              type="button"
              variant="outline"
              className="h-[34px] rounded-md px-3 text-[13px]! font-semibold"
              onClick={() => setCreating(true)}
            >
              <FolderPlus className="size-4" aria-hidden="true" />
              Thư mục mới
            </Button>
          ) : null}
        </div>
        {folders ? (
          <>
            <div className={styles.divider} />
            <div className={styles.folderBar}>
            <Tabs
              className="min-w-0 flex-1"
              value={folderTab}
              onValueChange={(value) => setFolderTab(String(value))}
            >
              <TabsList aria-label="Lọc theo thư mục" className={FOLDER_LIST}>
                <TabsTrigger value={ALL} className={FOLDER_TAB}>
                  <Layers className="size-3.5" aria-hidden="true" />
                  Tất cả
                  <span className={FOLDER_COUNT}>{folders.total}</span>
                </TabsTrigger>
                <TabsTrigger value={NONE} className={FOLDER_TAB} {...dropProps(NONE, UNFILED_LABEL)}>
                  <Inbox className="size-3.5" aria-hidden="true" />
                  {UNFILED_LABEL}
                  <span className={FOLDER_COUNT}>{folders.unfiledCount}</span>
                </TabsTrigger>
                {folders.items.map((folder) => (
                  <TabsTrigger key={folder.id} value={folder.id} className={FOLDER_TAB} {...dropProps(folder.id, folder.name)}>
                    <Folder className="size-3.5" aria-hidden="true" />
                    <span className="max-w-[160px] truncate">{folder.name}</span>
                    <span className={FOLDER_COUNT}>{folder.count}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {currentFolder ? (
              <div className={styles.folderActions} role="group" aria-label={`Thao tác với thư mục ${currentFolder.name}`}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-slate-500 hover:bg-blue-50 hover:text-blue-600"
                        aria-label="Đổi tên thư mục"
                        onClick={() => setRenaming(true)}
                      />
                    }
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </TooltipTrigger>
                  <TooltipContent>Đổi tên thư mục</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-slate-500 hover:bg-red-50 hover:text-red-600"
                        aria-label="Xoá thư mục"
                        onClick={() => {
                          setDeleteError(undefined);
                          setDeleting(true);
                        }}
                      />
                    }
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </TooltipTrigger>
                  <TooltipContent>Xoá thư mục</TooltipContent>
                </Tooltip>
              </div>
            ) : null}
            </div>
          </>
        ) : null}
      </header>
      {creating && folders ? (
        <NewFolderDialog
          folderCount={folders.items.length}
          onClose={() => setCreating(false)}
          onCreated={(folder) => {
            setCreating(false);
            refreshFolders();
            setFolderTab(folder.id);
            toast.success(`Đã tạo thư mục "${folder.name}"`);
          }}
        />
      ) : null}
      {renaming && currentFolder ? (
        <NewFolderDialog
          folderCount={folders?.items.length ?? 0}
          folder={currentFolder}
          onClose={() => setRenaming(false)}
          onCreated={(folder) => {
            setRenaming(false);
            refreshFolders();
            toast.success(`Đã đổi tên thư mục thành "${folder.name}"`);
          }}
        />
      ) : null}
      <ConfirmDialog
        open={deleting && Boolean(currentFolder)}
        title="Xoá thư mục"
        message={[
          `Xoá thư mục "${currentFolder?.name ?? ''}"?`,
          'Các bài trong thư mục sẽ chuyển về "Chưa phân loại", không bị xoá khỏi danh sách đã lưu.',
        ]}
        confirmLabel="Xoá thư mục"
        busy={deleteBusy}
        error={deleteError}
        onConfirm={() => void removeFolder()}
        onClose={() => setDeleting(false)}
      />
      <PostList
        fetchPage={fetchPage}
        keep={keep}
        bookmarkFolders
        onBookmarkChanged={refreshFolders}
        emptyTitle="Chưa có bài nào được lưu"
        emptyHint="Bấm Lưu bài ở cuối mỗi bài viết để giữ lại tại đây."
      />
    </section>
  );
}
