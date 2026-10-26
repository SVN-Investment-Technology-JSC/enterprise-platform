'use client';

import type {
  SocialBookmarkFolderList,
  SocialPost,
} from '@enterprise-platform/contracts-social';
import { Bookmark, Folder, Inbox, Layers } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import extras from '../../post-extras.module.scss';
import { loadBookmarkFolders, loadBookmarks } from '../../social-posts-api';
import { Tabs, TabsList, TabsTrigger } from '../../ui/tabs';
import { PostList } from '../post-list';
import { UNFILED_LABEL } from './bookmark-dialog';
import styles from './saved-view.module.scss';

/** Kiểu viên thuốc cho hàng thư mục (ghi đè kiểu thanh phân đoạn mặc định của `ui/tabs`). */
const FOLDER_LIST = 'h-auto max-w-full flex-wrap justify-start gap-2 bg-transparent p-0';
const FOLDER_TAB =
  'h-8 gap-1.5 rounded-[8px] border-slate-200 bg-white px-3 text-[13px] text-slate-600 hover:border-slate-300 data-active:border-amber-400 data-active:bg-amber-100 data-active:text-slate-900 data-active:shadow-none';
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

  const refreshFolders = useCallback(() => {
    loadBookmarkFolders()
      .then(setFolders)
      .catch(() => undefined);
  }, []);
  useEffect(() => refreshFolders(), [refreshFolders]);

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

  const fetchPage = useCallback(
    (cursor?: string) =>
      loadBookmarks(cursor, 20, folderTab === ALL ? undefined : folderTab),
    [folderTab],
  );

  return (
    <section className={extras.view} aria-label="Bài đã lưu">
      <header className={styles.head}>
        <div className={styles.titleRow}>
          <span className={styles.icon} aria-hidden="true">
            <Bookmark size={20} />
          </span>
          <div className={styles.text}>
            <h2>Bài đã lưu</h2>
            <p>Những bài bạn đánh dấu để xem lại sau. Chỉ mình bạn thấy danh sách này.</p>
          </div>
          {folders ? (
            <span className={styles.total}>
              <strong>{folders.total}</strong> bài
            </span>
          ) : null}
        </div>
        {folders ? (
          <>
            <div className={styles.divider} />
            <Tabs value={folderTab} onValueChange={(value) => setFolderTab(String(value))}>
              <TabsList aria-label="Lọc theo thư mục" className={FOLDER_LIST}>
                <TabsTrigger value={ALL} className={FOLDER_TAB}>
                  <Layers className="size-3.5" aria-hidden="true" />
                  Tất cả
                  <span className={FOLDER_COUNT}>{folders.total}</span>
                </TabsTrigger>
                <TabsTrigger value={NONE} className={FOLDER_TAB}>
                  <Inbox className="size-3.5" aria-hidden="true" />
                  {UNFILED_LABEL}
                  <span className={FOLDER_COUNT}>{folders.unfiledCount}</span>
                </TabsTrigger>
                {folders.items.map((folder) => (
                  <TabsTrigger key={folder.id} value={folder.id} className={FOLDER_TAB}>
                    <Folder className="size-3.5" aria-hidden="true" />
                    <span className="max-w-[160px] truncate">{folder.name}</span>
                    <span className={FOLDER_COUNT}>{folder.count}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </>
        ) : null}
      </header>
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
