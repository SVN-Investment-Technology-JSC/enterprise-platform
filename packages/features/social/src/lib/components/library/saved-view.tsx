'use client';

import type { SocialPost } from '@enterprise-platform/contracts-social';
import extras from '../../post-extras.module.scss';
import { loadBookmarks } from '../../social-posts-api';
import { PostList } from '../post-list';

/** Bài đã lưu: lưu gần nhất trước; bỏ lưu thì bài rời khỏi danh sách. */
const keepSaved = (post: SocialPost) => post.bookmarked !== false;

export function SavedView() {
  return (
    <section className={extras.view} aria-label="Bài đã lưu">
      <div className={extras.viewHead}>
        <div>
          <h2>Bài đã lưu</h2>
          <p className={extras.viewDesc}>
            Những bài bạn đánh dấu để xem lại sau. Chỉ mình bạn thấy danh sách
            này.
          </p>
        </div>
      </div>
      <PostList
        fetchPage={loadBookmarks}
        keep={keepSaved}
        emptyTitle="Chưa có bài nào được lưu"
        emptyHint="Bấm Lưu bài ở cuối mỗi bài viết để giữ lại tại đây."
      />
    </section>
  );
}
