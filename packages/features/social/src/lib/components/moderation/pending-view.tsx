'use client';

import {
  SOCIAL_REJECT_REASON_MAX,
  type SocialInboxCounts,
  type SocialMe,
  type SocialPost,
} from '@enterprise-platform/contracts-social';
import { Check, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import extras from '../../post-extras.module.scss';
import { errorMessage, loadMe } from '../../social-api';
import {
  approvePost,
  loadInbox,
  loadMyPosts,
  loadModerationPosts,
  loadSettings,
  rejectPost,
  updateSettings,
} from '../../social-posts-api';
import styles from '../../social.module.scss';
import { PostList, type PostListActions } from '../post-list';
import { Dialog } from '../ui';

type Tab = 'review' | 'pending' | 'rejected';

const isPending = (post: SocialPost) => post.status === 'pending';
const isRejected = (post: SocialPost) => post.status === 'rejected';
const isAwaiting = (post: SocialPost) => post.status === 'pending';

/**
 * Chờ duyệt. Moderator thấy hàng chờ duyệt (duyệt/từ chối) và công tắc cài đặt cho `social.manage`;
 * mọi người thấy bài của mình đang chờ hoặc bị từ chối.
 */
export function PendingView() {
  const [me, setMe] = useState<SocialMe>();
  const [counts, setCounts] = useState<SocialInboxCounts>();
  const [tab, setTab] = useState<Tab>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let alive = true;
    Promise.all([loadMe(), loadInbox().catch(() => undefined)])
      .then(([value, inbox]) => {
        if (!alive) return;
        setMe(value);
        setCounts(inbox);
        setTab(
          value.permissions.includes('social.post.moderate')
            ? 'review'
            : 'pending',
        );
      })
      .catch(
        (cause) =>
          alive && setError(errorMessage(cause, 'Không tải được dữ liệu.')),
      );
    return () => {
      alive = false;
    };
  }, []);

  const refreshCounts = useCallback(() => {
    loadInbox()
      .then(setCounts)
      .catch(() => undefined);
  }, []);

  if (!me || !tab) {
    return error ? (
      <p role="alert" className={styles.alert}>
        {error}
      </p>
    ) : (
      <p className={styles.muted}>Đang tải…</p>
    );
  }

  const canModerate = me.permissions.includes('social.post.moderate');
  const canManage = me.permissions.includes('social.manage');
  const tabs: readonly {
    readonly value: Tab;
    readonly label: string;
    readonly count?: number;
  }[] = [
    ...(canModerate
      ? [
          {
            value: 'review' as const,
            label: 'Cần duyệt',
            count: counts?.toModerate,
          },
        ]
      : []),
    {
      value: 'pending',
      label: 'Bài của tôi đang chờ',
      count: counts?.myPending,
    },
    { value: 'rejected', label: 'Bài bị từ chối', count: counts?.myRejected },
  ];

  return (
    <section className={extras.view} aria-label="Chờ duyệt">
      <div className={extras.viewHead}>
        <div>
          <h2>Chờ duyệt</h2>
          <p className={extras.viewDesc}>
            {canModerate
              ? 'Duyệt hoặc từ chối bài đăng trên Tường công ty, và theo dõi bài của chính bạn.'
              : 'Theo dõi bài của bạn đang chờ duyệt hoặc bị từ chối.'}
          </p>
        </div>
        <div className={extras.segmented} role="tablist" aria-label="Loại bài">
          {tabs.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={tab === item.value}
              data-active={tab === item.value}
              onClick={() => setTab(item.value)}
            >
              {item.label}
              {item.count ? (
                <span className={extras.countPill}>{item.count}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {tab === 'review' && canManage ? <ApprovalSetting /> : null}

      {tab === 'review' ? (
        <ReviewList onDecided={refreshCounts} />
      ) : tab === 'pending' ? (
        <MineList status="pending" onChanged={refreshCounts} />
      ) : (
        <MineList status="rejected" onChanged={refreshCounts} />
      )}
    </section>
  );
}

/** Công tắc "Bài trên Tường công ty cần duyệt" (chỉ `social.manage`). */
function ApprovalSetting() {
  const [value, setValue] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let alive = true;
    loadSettings()
      .then((settings) => alive && setValue(settings.wallRequireApproval))
      .catch(
        (cause) =>
          alive && setError(errorMessage(cause, 'Không tải được cài đặt.')),
      );
    return () => {
      alive = false;
    };
  }, []);

  const toggle = async () => {
    if (value === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      const next = await updateSettings({ wallRequireApproval: !value });
      setValue(next.wallRequireApproval);
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được cài đặt.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={extras.settingBox}>
      <div className={extras.settingText}>
        <strong>Bài trên Tường công ty cần duyệt</strong>
        <span>
          Khi bật, bài của người không phải kiểm duyệt viên sẽ vào hàng chờ
          duyệt trước khi hiện. Bài trong nhóm không bị ảnh hưởng.
        </span>
        {error ? (
          <span role="alert" style={{ color: 'var(--ep-danger)' }}>
            {error}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        className={extras.switch}
        aria-checked={value === true}
        aria-label="Bài trên Tường công ty cần duyệt"
        disabled={busy || value === undefined}
        onClick={() => void toggle()}
      />
    </div>
  );
}

function ReviewList({ onDecided }: { readonly onDecided: () => void }) {
  const fetchPage = useCallback(
    (cursor?: string) => loadModerationPosts(cursor),
    [],
  );
  return (
    <PostList
      fetchPage={fetchPage}
      keep={isAwaiting}
      emptyTitle="Không có bài nào chờ duyệt"
      emptyHint="Bài mới cần duyệt sẽ xuất hiện tại đây."
      renderActions={(post, actions) => (
        <ReviewActions post={post} actions={actions} onDecided={onDecided} />
      )}
    />
  );
}

function MineList({
  status,
  onChanged,
}: {
  readonly status: 'pending' | 'rejected';
  readonly onChanged: () => void;
}) {
  const fetchPage = useCallback(
    (cursor?: string) => loadMyPosts(status, cursor),
    [status],
  );
  return (
    <PostList
      key={status}
      fetchPage={fetchPage}
      keep={status === 'pending' ? isPending : isRejected}
      onCountChange={onChanged}
      emptyTitle={
        status === 'pending'
          ? 'Bạn không có bài nào đang chờ duyệt'
          : 'Bạn không có bài nào bị từ chối'
      }
      renderActions={
        status === 'rejected'
          ? (post, actions) =>
              post.capabilities.canEdit ? (
                <div className={extras.itemActions}>
                  <span className={styles.muted}>
                    Sửa bài theo góp ý rồi gửi duyệt lại.
                  </span>
                  <span style={{ flex: 1 }} />
                  <button
                    type="button"
                    className={`${styles.buttonSmall} ${styles.buttonSmallPrimary}`}
                    onClick={() => actions.edit(post)}
                  >
                    Sửa và gửi lại
                  </button>
                </div>
              ) : null
          : undefined
      }
    />
  );
}

function ReviewActions({
  post,
  actions,
  onDecided,
}: {
  readonly post: SocialPost;
  readonly actions: PostListActions;
  readonly onDecided: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  if (!post.capabilities.canModerate) return null;

  const approve = async () => {
    setBusy(true);
    try {
      actions.update(await approvePost(post.id));
      onDecided();
    } catch (cause) {
      actions.fail(errorMessage(cause, 'Không duyệt được bài.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={extras.itemActions}>
      <span className={styles.muted}>
        Bài của {post.author.name} đang chờ quyết định.
      </span>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        className={styles.buttonSmall}
        disabled={busy}
        onClick={() => setRejecting(true)}
      >
        <X size={13} /> Từ chối
      </button>
      <button
        type="button"
        className={`${styles.buttonSmall} ${styles.buttonSmallPrimary}`}
        disabled={busy}
        onClick={() => void approve()}
      >
        <Check size={13} /> {busy ? 'Đang duyệt…' : 'Duyệt bài'}
      </button>
      {rejecting ? (
        <RejectDialog
          post={post}
          onClose={() => setRejecting(false)}
          onRejected={(saved) => {
            setRejecting(false);
            actions.update(saved);
            onDecided();
          }}
        />
      ) : null}
    </div>
  );
}

function RejectDialog({
  post,
  onClose,
  onRejected,
}: {
  readonly post: SocialPost;
  readonly onClose: () => void;
  readonly onRejected: (post: SocialPost) => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async () => {
    const text = reason.trim();
    if (!text) {
      setError('Hãy nhập lý do từ chối để tác giả biết cách chỉnh sửa.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      onRejected(await rejectPost(post.id, text));
    } catch (cause) {
      setError(errorMessage(cause, 'Không từ chối được bài.'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      danger
      title="Từ chối bài viết"
      submitLabel="Từ chối bài"
      submittingLabel="Đang gửi…"
      submitting={busy}
      submitDisabled={!reason.trim()}
      error={error}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <label className={styles.field}>
        <span className={styles.fieldLabel}>
          Lý do từ chối<span className={styles.fieldRequired}> *</span>
        </span>
        <textarea
          className={extras.textArea}
          value={reason}
          maxLength={SOCIAL_REJECT_REASON_MAX}
          placeholder={`Giải thích cho ${post.author.name} vì sao bài chưa được đăng`}
          onChange={(event) => setReason(event.target.value)}
        />
        <span className={styles.fieldHint}>
          {reason.length}/{SOCIAL_REJECT_REASON_MAX} ký tự. Tác giả nhận được lý
          do này và có thể sửa rồi gửi lại.
        </span>
      </label>
    </Dialog>
  );
}
