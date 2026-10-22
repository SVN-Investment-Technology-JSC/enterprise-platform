'use client';

import type {
  SocialPost,
  SocialReadConfirmationEntry,
  SocialReadConfirmationFilter,
  SocialReadConfirmationSummary,
} from '@enterprise-platform/contracts-social';
import { CheckCircle2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { readConfirmationProgress } from '../post-extras.model';
import styles from '../post-extras.module.scss';
import base from '../social.module.scss';
import { errorMessage } from '../social-api';
import { confirmRead, loadReadConfirmations } from '../social-posts-api';
import { formatFullTime } from '../social.model';
import { Avatar, Dialog, userSubtitle } from './ui';

export interface ReadConfirmationBlockProps {
  readonly post: SocialPost;
  readonly summary: SocialReadConfirmationSummary;
  /** Chỉ bài đã đăng mới xác nhận được. */
  readonly published: boolean;
  readonly onChange: (summary: SocialReadConfirmationSummary) => void;
  readonly onError: (message: string) => void;
}

/** Khối "Xác nhận đã đọc": nút xác nhận, tiến độ, và danh sách đã/chưa cho người có quyền xem. */
export function ReadConfirmationBlock({
  post,
  summary,
  published,
  onChange,
  onError,
}: ReadConfirmationBlockProps) {
  const [busy, setBusy] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const canView = Boolean(post.capabilities.canViewReadConfirmations);
  const progress = readConfirmationProgress(
    summary.confirmedCount,
    summary.audienceCount,
  );

  const confirm = async () => {
    setBusy(true);
    try {
      const next = await confirmRead(post.id);
      // Số liệu chỉ có với người xem được danh sách; giữ số cũ nếu bản trả về không có.
      onChange({ ...summary, ...next });
    } catch (cause) {
      onError(errorMessage(cause, 'Không xác nhận được.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.readBox} data-done={summary.confirmedByMe}>
      <div className={styles.readRow}>
        <span className={styles.readTitle}>Yêu cầu xác nhận đã đọc</span>
        {summary.confirmedByMe ? (
          <span
            style={{
              color: 'var(--ep-success)',
              display: 'inline-flex',
              gap: 5,
              alignItems: 'center',
            }}
          >
            <CheckCircle2 size={15} />
            Bạn đã xác nhận
            {summary.confirmedAt
              ? ` lúc ${formatFullTime(summary.confirmedAt)}`
              : ''}
          </span>
        ) : published && summary.canConfirm ? (
          <button
            type="button"
            className={`${base.buttonSmall} ${base.buttonSmallPrimary}`}
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy ? 'Đang gửi…' : 'Tôi đã đọc và hiểu'}
          </button>
        ) : (
          <span className={base.muted}>
            {published
              ? 'Bài này không yêu cầu bạn xác nhận.'
              : 'Mở sau khi bài được đăng.'}
          </span>
        )}
      </div>
      {progress !== undefined ? (
        <>
          <div
            className={styles.progress}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            aria-label="Tiến độ xác nhận đã đọc"
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className={styles.readRow}>
            <span className={base.muted}>
              {(summary.confirmedCount ?? 0).toLocaleString('vi-VN')}/
              {(summary.audienceCount ?? 0).toLocaleString('vi-VN')} người đã
              xác nhận ({progress}%)
            </span>
            {canView ? (
              <button
                type="button"
                className={base.linkButton}
                onClick={() => setListOpen(true)}
              >
                Xem danh sách
              </button>
            ) : null}
          </div>
        </>
      ) : null}
      {listOpen ? (
        <ConfirmationsDialog
          postId={post.id}
          onClose={() => setListOpen(false)}
        />
      ) : null}
    </div>
  );
}

const FILTERS: readonly {
  readonly value: SocialReadConfirmationFilter;
  readonly label: string;
}[] = [
  { value: 'confirmed', label: 'Đã xác nhận' },
  { value: 'pending', label: 'Chưa xác nhận' },
];

function ConfirmationsDialog({
  postId,
  onClose,
}: {
  readonly postId: string;
  readonly onClose: () => void;
}) {
  const [filter, setFilter] = useState<SocialReadConfirmationFilter>('pending');
  const [items, setItems] = useState<readonly SocialReadConfirmationEntry[]>(
    [],
  );
  const [counts, setCounts] = useState<{
    readonly confirmed: number;
    readonly audience: number;
  }>();
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(
    async (next?: string) => {
      setLoading(true);
      try {
        const page = await loadReadConfirmations(postId, filter, next);
        setItems((current) =>
          next ? [...current, ...page.items] : page.items,
        );
        setCursor(page.nextCursor);
        setCounts({
          confirmed: page.confirmedCount,
          audience: page.audienceCount,
        });
        setError(undefined);
      } catch (cause) {
        setError(errorMessage(cause, 'Không tải được danh sách xác nhận.'));
      } finally {
        setLoading(false);
      }
    },
    [postId, filter],
  );

  useEffect(() => {
    setItems([]);
    void load();
  }, [load]);

  return (
    <Dialog open title="Xác nhận đã đọc" error={error} onClose={onClose}>
      <div className={styles.readRow}>
        <div
          className={styles.segmented}
          role="tablist"
          aria-label="Lọc theo trạng thái"
        >
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={filter === item.value}
              data-active={filter === item.value}
              onClick={() => setFilter(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {counts ? (
          <span className={base.muted}>
            {counts.confirmed.toLocaleString('vi-VN')}/
            {counts.audience.toLocaleString('vi-VN')} người
          </span>
        ) : null}
      </div>
      {loading && items.length === 0 ? (
        <p className={base.muted}>Đang tải…</p>
      ) : null}
      {!loading && items.length === 0 && !error ? (
        <p className={base.muted}>
          {filter === 'pending'
            ? 'Mọi người đã xác nhận.'
            : 'Chưa có ai xác nhận.'}
        </p>
      ) : null}
      <ul className={styles.personList}>
        {items.map((entry) => (
          <li key={entry.user.id} className={styles.person}>
            <Avatar user={entry.user} size={30} />
            <span>
              {entry.user.name}
              {userSubtitle(entry.user) ? (
                <span className={base.muted}>
                  {' '}
                  · {userSubtitle(entry.user)}
                </span>
              ) : null}
            </span>
            {entry.confirmedAt ? (
              <span className={styles.personMeta}>
                {formatFullTime(entry.confirmedAt)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {cursor ? (
        <button
          type="button"
          className={base.buttonGhost}
          disabled={loading}
          onClick={() => void load(cursor)}
        >
          {loading ? 'Đang tải…' : 'Xem thêm'}
        </button>
      ) : null}
    </Dialog>
  );
}
