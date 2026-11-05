'use client';

import { BLOCKED_REASON_MAX_LENGTH } from '@enterprise-platform/contracts-workspace';
import { AlertTriangle } from 'lucide-react';
import { useCallback, useState, type KeyboardEvent, type ReactNode } from 'react';
import styles from '../workspace.module.scss';
import { Dialog, Field } from './dialog';
import { Tooltip } from './tooltip';

/** Phần của công việc (dự án hay việc giao lẻ) mà hộp thoại cần để nêu tên và điền sẵn lý do. */
export interface BlockedReasonTarget {
  readonly code: string;
  readonly title: string;
  readonly blockedReason?: string;
}

/** Từ ngưỡng này (tỉ lệ so với giới hạn) mới hiện bộ đếm ký tự, để ô nhập đỡ rối khi còn rộng. */
const COUNTER_FROM = 0.8;

export interface BlockedReasonDialogProps {
  readonly open: boolean;
  readonly item?: BlockedReasonTarget;
  /**
   * `true`: việc đã ở Vướng mắc, người dùng sửa lý do (tiêu đề "Sửa lý do vướng mắc", điền sẵn lý do cũ). Mặc định suy
   * ra từ việc đã có lý do hay chưa.
   */
  readonly editing?: boolean;
  readonly onClose: () => void;
  /** Nhận lý do đã cắt khoảng trắng; ném lỗi ra để hộp thoại hiện ngay và giữ hộp mở cho người dùng gửi lại. */
  readonly onConfirm: (reason: string) => Promise<void>;
}

/**
 * Hộp ghi lý do khi chuyển một công việc sang Vướng mắc (hoặc sửa lý do khi việc đã vướng mắc).
 *
 * Lý do là bắt buộc: server từ chối `status: 'blocked'` không kèm `note`, nên mọi lối chuyển sang Vướng mắc đều phải
 * qua hộp này (xem `useBlockedReasonPrompt`).
 */
export function BlockedReasonDialog({ open, item, editing, onClose, onConfirm }: BlockedReasonDialogProps) {
  // Phần ruột chỉ dựng khi mở, nên state (lý do đang gõ, lỗi) luôn mới cho mỗi lần mở.
  if (!open || !item) return null;
  return (
    <BlockedReasonForm
      item={item}
      editing={editing ?? Boolean(item.blockedReason)}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}

function BlockedReasonForm({
  item,
  editing,
  onClose,
  onConfirm,
}: {
  item: BlockedReasonTarget;
  editing: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState(item.blockedReason ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const trimmed = reason.trim();

  const submit = async () => {
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await onConfirm(trimmed);
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không ghi được lý do vướng mắc.');
    } finally {
      setSubmitting(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Đang gõ dở bằng bộ gõ tiếng Việt (Telex, VNI): Enter chốt chữ, không phải lệnh gửi.
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void submit();
    }
  };

  const counter =
    reason.length >= BLOCKED_REASON_MAX_LENGTH * COUNTER_FROM
      ? `${reason.length}/${BLOCKED_REASON_MAX_LENGTH} ký tự`
      : undefined;

  return (
    <Dialog
      open
      centered
      title={editing ? 'Sửa lý do vướng mắc' : 'Báo vướng mắc'}
      subtitle={`${item.code} · ${item.title}`}
      submitLabel="Xác nhận"
      submitting={submitting}
      submitDisabled={!trimmed}
      error={error}
      // Đang gửi thì không đóng được (Huỷ, X, Esc): đóng giữa chừng trông như đã huỷ trong khi việc vẫn chuyển sang Vướng mắc.
      onClose={() => {
        if (!submitting) onClose();
      }}
      onSubmit={() => void submit()}
    >
      <Field label="Lý do vướng mắc" required hint={counter ?? 'Nhấn Ctrl+Enter để gửi.'}>
        <textarea
          rows={5}
          autoFocus
          value={reason}
          maxLength={BLOCKED_REASON_MAX_LENGTH}
          placeholder="Ghi rõ điều đang cản trở công việc để người giao và cả nhóm nắm được"
          aria-label="Lý do vướng mắc"
          onChange={(event) => setReason(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </Field>
    </Dialog>
  );
}

interface PendingPrompt {
  readonly item: BlockedReasonTarget;
  readonly editing: boolean;
  readonly submit: (reason: string) => Promise<void>;
}

/**
 * Gom việc "hỏi lý do rồi mới chuyển sang Vướng mắc" để các màn không lặp code.
 *
 * `ask(item, submit)` mở hộp; người dùng xác nhận thì hộp gọi `submit(reason)` (màn tự gọi API với
 * `{ status: 'blocked', note: reason }` rồi tải lại dữ liệu), thành công thì hộp tự đóng, lỗi thì hộp hiện lỗi và ở lại.
 * Màn chỉ cần đặt `dialog` vào cây giao diện một lần.
 */
export function useBlockedReasonPrompt(): {
  readonly ask: (
    item: BlockedReasonTarget,
    submit: (reason: string) => Promise<void>,
    options?: { readonly editing?: boolean },
  ) => void;
  readonly dialog: ReactNode;
} {
  const [pending, setPending] = useState<PendingPrompt>();
  const ask = useCallback(
    (
      item: BlockedReasonTarget,
      submit: (reason: string) => Promise<void>,
      options?: { readonly editing?: boolean },
    ) => setPending({ item, submit, editing: options?.editing ?? Boolean(item.blockedReason) }),
    [],
  );
  const close = useCallback(() => setPending(undefined), []);
  const dialog = (
    <BlockedReasonDialog
      open={Boolean(pending)}
      item={pending?.item}
      editing={pending?.editing}
      onClose={close}
      onConfirm={async (reason) => {
        if (!pending) return;
        await pending.submit(reason);
        setPending(undefined);
      }}
    />
  );
  return { ask, dialog };
}

/**
 * Chỉ báo nhỏ cạnh nhãn trạng thái Vướng mắc: rê chuột hay focus bằng bàn phím thì hiện lý do trong tooltip. Cố ý chỉ
 * là biểu tượng một dòng nên không làm đổi chiều cao hàng.
 */
export function BlockedReasonMark({ reason }: { reason?: string }) {
  const text = reason?.trim();
  return (
    <Tooltip content={<span className={styles.blockedTip}>{text || 'Chưa ghi lý do vướng mắc'}</span>}>
      <span
        className={text ? styles.blockedMark : `${styles.blockedMark} ${styles.blockedMarkEmpty}`}
        tabIndex={0}
        role="img"
        aria-label={text ? `Lý do vướng mắc: ${text}` : 'Chưa ghi lý do vướng mắc'}
      >
        <AlertTriangle size={13} aria-hidden />
      </span>
    </Tooltip>
  );
}

/**
 * Khối nổi bật trong chi tiết công việc đang Vướng mắc: lý do người thực hiện đã ghi (giữ xuống dòng). Dữ liệu cũ chưa có
 * lý do thì báo "Chưa ghi lý do". `onEdit` chỉ truyền cho người có quyền đổi trạng thái việc đó.
 */
export function BlockedReasonNotice({ reason, onEdit }: { reason?: string; onEdit?: () => void }) {
  const text = reason?.trim();
  return (
    <section className={styles.blockedNotice} aria-label="Vướng mắc">
      <AlertTriangle size={16} aria-hidden className={styles.blockedNoticeIcon} />
      <div className={styles.blockedNoticeBody}>
        <b className={styles.blockedNoticeLabel}>Vướng mắc</b>
        {text ? (
          <p className={styles.blockedNoticeText}>{text}</p>
        ) : (
          <p className={`${styles.blockedNoticeText} ${styles.muted}`}>Chưa ghi lý do</p>
        )}
      </div>
      {onEdit ? (
        <button type="button" className={styles.buttonGhost} onClick={onEdit}>
          {text ? 'Sửa lý do' : 'Ghi lý do'}
        </button>
      ) : null}
    </section>
  );
}
