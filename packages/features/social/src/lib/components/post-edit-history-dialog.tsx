'use client';

import type { SocialPostEditHistory } from '@enterprise-platform/contracts-social';
import { useEffect, useState } from 'react';
import extras from '../post-extras.module.scss';
import { editVersionLabel } from '../post-visibility.model';
import { errorMessage } from '../social-api';
import { loadPostEdits } from '../social-posts-api';
import { formatFullTime } from '../social.model';
import styles from '../social.module.scss';
import { Dialog } from './ui';

/** Hộp xem các bản chỉnh sửa của bài: bản hiện tại rồi các bản cũ, mới nhất trước. */
export function PostEditHistoryDialog({
  postId,
  onClose,
}: {
  readonly postId: string;
  readonly onClose: () => void;
}) {
  const [history, setHistory] = useState<SocialPostEditHistory>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let alive = true;
    loadPostEdits(postId)
      .then((value) => alive && setHistory(value))
      .catch(
        (cause) =>
          alive &&
          setError(errorMessage(cause, 'Không tải được lịch sử chỉnh sửa.')),
      );
    return () => {
      alive = false;
    };
  }, [postId]);

  return (
    <Dialog
      open
      wide
      title="Lịch sử chỉnh sửa"
      error={error}
      onClose={onClose}
    >
      {!history && !error ? <p className={styles.muted}>Đang tải…</p> : null}
      {history ? (
        <ol className={extras.editList}>
          <li className={extras.editItem} data-current="true">
            <div className={extras.editHead}>
              <strong>Bản hiện tại</strong>
              {history.current.editedAt ? (
                <span className={styles.muted}>
                  {formatFullTime(history.current.editedAt)}
                </span>
              ) : null}
            </div>
            {history.current.title ? (
              <p className={extras.editTitle}>{history.current.title}</p>
            ) : null}
            <div
              className={`${styles.richBody} ${extras.editBody}`}
              // HTML đã được server làm sạch.
              dangerouslySetInnerHTML={{ __html: history.current.bodyHtml }}
            />
          </li>
          {history.versions.map((item) => (
            <li key={item.version} className={extras.editItem}>
              <div className={extras.editHead}>
                <strong>{editVersionLabel(item.version)}</strong>
                <span className={styles.muted}>
                  {item.editedBy.name} sửa lúc {formatFullTime(item.editedAt)}
                </span>
              </div>
              {item.title ? (
                <p className={extras.editTitle}>{item.title}</p>
              ) : null}
              <div
                className={`${styles.richBody} ${extras.editBody}`}
                dangerouslySetInnerHTML={{ __html: item.bodyHtml }}
              />
            </li>
          ))}
          {history.versions.length === 0 ? (
            <li className={styles.muted}>Bài chưa có bản chỉnh sửa nào.</li>
          ) : null}
        </ol>
      ) : null}
    </Dialog>
  );
}
