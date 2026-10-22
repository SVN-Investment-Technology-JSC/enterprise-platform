'use client';

import type { SocialPost } from '@enterprise-platform/contracts-social';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Clock, Send, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import {
  formatVnDateTime,
  isoToVnParts,
  validateSchedule,
  vnPartsToIso,
  vnToday,
} from '../../post-extras.model';
import extras from '../../post-extras.module.scss';
import { deletePost, errorMessage, updatePost } from '../../social-api';
import { loadMyPosts, publishPostNow } from '../../social-posts-api';
import styles from '../../social.module.scss';
import { PostList, type PostListActions } from '../post-list';
import { TimeSelect } from '../time-select';
import { ConfirmDialog, Dialog } from '../ui';

const isScheduled = (post: SocialPost) => post.status === 'scheduled';

/** Bài hẹn giờ của tôi: đổi giờ, đăng ngay, huỷ hẹn (xoá bài). */
export function ScheduledView() {
  const fetchPage = useCallback(
    (cursor?: string) => loadMyPosts('scheduled', cursor),
    [],
  );

  return (
    <section className={extras.view} aria-label="Bài hẹn giờ">
      <div className={extras.viewHead}>
        <div>
          <h2>Bài hẹn giờ</h2>
          <p className={extras.viewDesc}>
            Bài của bạn sẽ tự đăng đúng giờ hẹn (giờ Việt Nam). Chỉ mình bạn
            thấy các bài này.
          </p>
        </div>
      </div>
      <PostList
        fetchPage={fetchPage}
        keep={isScheduled}
        emptyTitle="Không có bài nào đang hẹn giờ"
        emptyHint="Khi soạn bài, chọn Hẹn giờ đăng để bài tự lên đúng lúc."
        renderActions={(post, actions) => (
          <ScheduledActions post={post} actions={actions} />
        )}
      />
    </section>
  );
}

function ScheduledActions({
  post,
  actions,
}: {
  readonly post: SocialPost;
  readonly actions: PostListActions;
}) {
  const { capabilities } = post;
  const [rescheduling, setRescheduling] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string>();

  const publishNow = async () => {
    setBusy(true);
    try {
      // Bài sang đã đăng hoặc chờ duyệt đều rời danh sách hẹn giờ (bộ lọc keep).
      actions.update(await publishPostNow(post.id));
    } catch (cause) {
      actions.fail(errorMessage(cause, 'Không đăng được bài.'));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    setCancelError(undefined);
    try {
      await deletePost(post.id);
      setCancelling(false);
      actions.remove(post.id);
    } catch (cause) {
      setCancelError(errorMessage(cause, 'Không huỷ được lịch hẹn.'));
    } finally {
      setBusy(false);
    }
  };

  if (
    !capabilities.canReschedule &&
    !capabilities.canPublishNow &&
    !capabilities.canDelete
  )
    return null;

  return (
    <div className={extras.itemActions}>
      <span className={styles.muted}>
        <Clock size={13} style={{ verticalAlign: '-2px' }} />{' '}
        {post.scheduledAt
          ? `Đăng lúc ${formatVnDateTime(post.scheduledAt)}`
          : 'Đang hẹn giờ'}
      </span>
      <span style={{ flex: 1 }} />
      {capabilities.canReschedule ? (
        <button
          type="button"
          className={styles.buttonSmall}
          disabled={busy}
          onClick={() => setRescheduling(true)}
        >
          Đổi giờ
        </button>
      ) : null}
      {capabilities.canPublishNow ? (
        <button
          type="button"
          className={`${styles.buttonSmall} ${styles.buttonSmallPrimary}`}
          disabled={busy}
          onClick={() => void publishNow()}
        >
          <Send size={13} /> Đăng ngay
        </button>
      ) : null}
      {capabilities.canDelete ? (
        <button
          type="button"
          className={styles.buttonSmall}
          disabled={busy}
          onClick={() => setCancelling(true)}
        >
          <Trash2 size={13} /> Huỷ hẹn
        </button>
      ) : null}

      {rescheduling ? (
        <RescheduleDialog
          post={post}
          onClose={() => setRescheduling(false)}
          onSaved={(saved) => {
            setRescheduling(false);
            actions.update(saved);
          }}
        />
      ) : null}
      <ConfirmDialog
        open={cancelling}
        title="Huỷ hẹn giờ"
        message="Bài hẹn giờ sẽ bị xoá và không được đăng. Bạn có chắc chắn?"
        confirmLabel="Huỷ hẹn"
        busy={busy}
        error={cancelError}
        onConfirm={() => void cancel()}
        onClose={() => setCancelling(false)}
      />
    </div>
  );
}

function RescheduleDialog({
  post,
  onClose,
  onSaved,
}: {
  readonly post: SocialPost;
  readonly onClose: () => void;
  readonly onSaved: (post: SocialPost) => void;
}) {
  const initial = post.scheduledAt ? isoToVnParts(post.scheduledAt) : undefined;
  const [date, setDate] = useState(initial?.date ?? '');
  const [time, setTime] = useState(initial?.time ?? '08:00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async () => {
    const problem = validateSchedule(date, time);
    const scheduledAt = vnPartsToIso(date, time);
    if (problem || !scheduledAt) {
      setError(problem ?? 'Ngày giờ hẹn không hợp lệ.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      onSaved(await updatePost(post.id, { scheduledAt }));
    } catch (cause) {
      setError(errorMessage(cause, 'Không đổi được giờ hẹn.'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title="Đổi giờ đăng"
      submitLabel="Lưu giờ hẹn"
      submittingLabel="Đang lưu…"
      submitting={busy}
      error={error}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <div className={extras.dateTimeRow}>
        <div className={styles.field} role="group" aria-label="Ngày đăng">
          <span className={styles.fieldLabel}>Ngày đăng (giờ Việt Nam)</span>
          <DatePickerInput
            value={date}
            min={vnToday()}
            height={38}
            aria-label="Ngày đăng"
            onChange={setDate}
          />
        </div>
        <TimeSelect value={time} label="Giờ đăng" onChange={setTime} />
      </div>
    </Dialog>
  );
}
