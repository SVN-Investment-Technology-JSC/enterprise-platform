'use client';

import type {
  SocialPoll,
  SocialPollVoter,
} from '@enterprise-platform/contracts-social';
import { Check, EyeOff, Lock } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  pollPercent,
  sameSelection,
  toggleSelection,
  formatVnDateTime,
} from '../../post-extras.model';
import styles from '../../post-extras.module.scss';
import base from '../../social.module.scss';
import { errorMessage } from '../../social-api';
import { closePoll, loadPollVoters, votePoll } from '../../social-posts-api';
import { ConfirmDialog, Dialog, userSubtitle } from '../ui';
import { UserAvatar } from '../user-avatar';

export interface PostPollProps {
  readonly postId: string;
  readonly poll: SocialPoll;
  /** Bài chưa đăng (chờ duyệt, hẹn giờ, bị từ chối) chỉ xem, không bỏ phiếu. */
  readonly readOnly?: boolean;
  /** Người xem đóng sớm được bình chọn (`capabilities.canClosePoll`). */
  readonly canClose: boolean;
  readonly onChange: (poll: SocialPoll) => void;
  readonly onError: (message: string) => void;
}

/** Bình chọn ngay trong bài: thanh kết quả luôn hiện, bỏ/đổi phiếu khi chưa đóng. */
export function PostPoll({
  postId,
  poll,
  readOnly = false,
  canClose,
  onChange,
  onError,
}: PostPollProps) {
  const [draft, setDraft] = useState<readonly string[]>(poll.myOptionIds);
  const [busy, setBusy] = useState(false);
  const [votersOpen, setVotersOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string>();

  // Số liệu từ server (bỏ phiếu, tín hiệu realtime) thắng bản chọn dở.
  useEffect(() => setDraft(poll.myOptionIds), [poll.myOptionIds]);

  const votable = poll.canVote && !poll.isClosed && !readOnly;
  const changed = !sameSelection(draft, poll.myOptionIds);

  const submit = async (optionIds: readonly string[]) => {
    setBusy(true);
    try {
      onChange(await votePoll(postId, optionIds));
    } catch (cause) {
      setDraft(poll.myOptionIds);
      onError(errorMessage(cause, 'Không gửi được lựa chọn.'));
    } finally {
      setBusy(false);
    }
  };

  const pick = (optionId: string) => {
    if (!votable || busy) return;
    const next = toggleSelection(draft, optionId, poll.allowMultiple);
    setDraft(next);
    // Chọn một thì gửi ngay; chọn nhiều thì chờ bấm nút gửi.
    if (!poll.allowMultiple) void submit(next);
  };

  const closeNow = async () => {
    setBusy(true);
    setCloseError(undefined);
    try {
      onChange(await closePoll(postId));
      setClosing(false);
    } catch (cause) {
      setCloseError(errorMessage(cause, 'Không đóng được bình chọn.'));
    } finally {
      setBusy(false);
    }
  };

  const status = poll.isClosed
    ? 'Đã đóng'
    : poll.closesAt
      ? `Đóng lúc ${formatVnDateTime(poll.closesAt)}`
      : 'Không giới hạn thời gian';

  return (
    <section className={styles.poll} aria-label="Bình chọn">
      <div className={styles.pollHead}>
        <h4 className={styles.pollQuestion}>{poll.question}</h4>
        {poll.isClosed ? (
          <span className={styles.statusBadge}>
            <Lock size={11} /> Đã đóng
          </span>
        ) : null}
      </div>
      <div className={styles.pollMeta}>
        <span>
          {poll.allowMultiple ? 'Chọn nhiều đáp án' : 'Chọn một đáp án'}
        </span>
        <span>{status}</span>
        {poll.anonymous ? (
          <span>
            <EyeOff size={11} /> Ẩn danh
          </span>
        ) : null}
      </div>

      <ul className={styles.pollList}>
        {poll.options.map((option) => {
          const selected = draft.includes(option.id);
          const percent = pollPercent(option.voteCount, poll.totalVoters);
          return (
            <li key={option.id}>
              <button
                type="button"
                className={styles.pollOption}
                style={{ width: '100%' }}
                data-votable={votable}
                data-selected={selected}
                disabled={!votable || busy}
                aria-pressed={votable ? selected : undefined}
                onClick={() => pick(option.id)}
              >
                <span
                  className={styles.pollBar}
                  style={{ width: `${percent}%` }}
                  aria-hidden="true"
                />
                {votable ? (
                  <span
                    className={styles.pollMark}
                    data-multiple={poll.allowMultiple}
                    data-checked={selected}
                  >
                    {selected ? <Check size={11} /> : null}
                  </span>
                ) : null}
                <span className={styles.pollText}>{option.text}</span>
                <span className={styles.pollCount}>
                  {option.voteCount.toLocaleString('vi-VN')} ({percent}%)
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className={styles.pollActions}>
        <span className={base.muted}>
          {poll.totalVoters.toLocaleString('vi-VN')} người đã bỏ phiếu
        </span>
        {votable && poll.allowMultiple ? (
          <button
            type="button"
            className={`${base.buttonSmall} ${base.buttonSmallPrimary}`}
            disabled={busy || !changed || draft.length === 0}
            onClick={() => void submit(draft)}
          >
            {poll.myOptionIds.length > 0 ? 'Cập nhật lựa chọn' : 'Gửi lựa chọn'}
          </button>
        ) : null}
        {votable && poll.myOptionIds.length > 0 ? (
          <button
            type="button"
            className={base.linkButton}
            disabled={busy}
            onClick={() => void submit([])}
          >
            Bỏ phiếu của tôi
          </button>
        ) : null}
        {poll.canViewVoters ? (
          <button
            type="button"
            className={base.linkButton}
            onClick={() => setVotersOpen(true)}
          >
            Xem ai đã chọn
          </button>
        ) : null}
        {canClose && !poll.isClosed && !readOnly ? (
          <button
            type="button"
            className={base.linkButton}
            onClick={() => setClosing(true)}
          >
            Đóng bình chọn
          </button>
        ) : null}
      </div>

      {votersOpen ? (
        <VotersDialog
          postId={postId}
          poll={poll}
          onClose={() => setVotersOpen(false)}
        />
      ) : null}
      <ConfirmDialog
        open={closing}
        title="Đóng bình chọn"
        message="Sau khi đóng, không ai bỏ phiếu hay đổi phiếu được nữa. Bạn có chắc chắn?"
        confirmLabel="Đóng bình chọn"
        busy={busy}
        error={closeError}
        onConfirm={() => void closeNow()}
        onClose={() => setClosing(false)}
      />
    </section>
  );
}

/** Danh sách người bỏ phiếu theo từng lựa chọn (chỉ bình chọn công khai). */
function VotersDialog({
  postId,
  poll,
  onClose,
}: {
  readonly postId: string;
  readonly poll: SocialPoll;
  readonly onClose: () => void;
}) {
  const [voters, setVoters] = useState<readonly SocialPollVoter[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(
    async (next?: string) => {
      setLoading(true);
      try {
        const page = await loadPollVoters(postId, undefined, next);
        setVoters((current) =>
          next ? [...current, ...page.items] : page.items,
        );
        setCursor(page.nextCursor);
        setError(undefined);
      } catch (cause) {
        setError(
          errorMessage(cause, 'Không tải được danh sách người bỏ phiếu.'),
        );
      } finally {
        setLoading(false);
      }
    },
    [postId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Dialog open title="Người đã bỏ phiếu" error={error} onClose={onClose}>
      {loading && voters.length === 0 ? (
        <p className={base.muted}>Đang tải…</p>
      ) : null}
      {!loading && voters.length === 0 && !error ? (
        <p className={base.muted}>Chưa có ai bỏ phiếu.</p>
      ) : null}
      {poll.options.map((option) => {
        const items = voters.filter((voter) => voter.optionId === option.id);
        if (items.length === 0) return null;
        return (
          <div key={option.id} className={styles.voterGroup}>
            <h4>
              {option.text} ({option.voteCount.toLocaleString('vi-VN')})
            </h4>
            <ul className={styles.personList} style={{ marginTop: 0 }}>
              {items.map((voter) => (
                <li
                  key={`${voter.user.id}-${voter.optionId}`}
                  className={styles.person}
                >
                  <UserAvatar user={voter.user} size={28} />
                  <span>
                    {voter.user.name}
                    {userSubtitle(voter.user) ? (
                      <span className={base.muted}>
                        {' '}
                        · {userSubtitle(voter.user)}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
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
