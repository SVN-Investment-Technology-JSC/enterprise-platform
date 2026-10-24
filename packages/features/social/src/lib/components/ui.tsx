'use client';

import { userAvatarUrl } from '@enterprise-platform/contracts-chat';
import type { SocialReactionType, SocialUserRef } from '@enterprise-platform/contracts-social';
import { usePerson } from '@enterprise-platform/feature-chat';
import { Heart, Lightbulb, PartyPopper, ThumbsUp, X, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { initials } from '../social.model';
import styles from '../social.module.scss';

/** Biểu tượng cho từng loại phản ứng (không dùng emoji). */
export const REACTION_ICONS: Readonly<Record<SocialReactionType, LucideIcon>> = {
  like: ThumbsUp,
  love: Heart,
  celebrate: PartyPopper,
  insightful: Lightbulb,
};

export function Avatar({ user, size = 40 }: { readonly user: SocialUserRef; readonly size?: number }) {
  const [broken, setBroken] = useState(false);
  // Ảnh đại diện của core (người dùng tự tải lên ở "Tài khoản của tôi"), dùng chung danh bạ với cả hệ thống.
  const person = usePerson(user.id);
  const avatarUrl = user.avatarUrl ?? (person?.avatarVersion != null ? userAvatarUrl(user.id, person.avatarVersion) : undefined);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (avatarUrl && !broken) {
    return (
      <img
        className={styles.avatar}
        style={style}
        src={avatarUrl}
        alt=""
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className={styles.avatar} style={style} aria-hidden="true">
      {initials(user.name)}
    </span>
  );
}

export function userSubtitle(user: SocialUserRef): string {
  return [user.position, user.unitName].filter(Boolean).join(' · ');
}

export interface DialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly submitLabel?: string;
  readonly submittingLabel?: string;
  readonly submitting?: boolean;
  readonly submitDisabled?: boolean;
  readonly danger?: boolean;
  readonly wide?: boolean;
  readonly error?: string;
  /** Không có `onSubmit` thì chân hộp thoại chỉ có nút Đóng. */
  readonly onSubmit?: () => void;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/** Hộp thoại dựng qua portal vào `document.body`; Esc và bấm ra ngoài để đóng. */
export function Dialog({
  open,
  title,
  submitLabel = 'Lưu',
  submittingLabel = 'Đang lưu…',
  submitting = false,
  submitDisabled = false,
  danger = false,
  wide = false,
  error,
  onSubmit,
  onClose,
  children,
}: DialogProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submitting, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className={styles.overlay}
      role="presentation"
      onMouseDown={() => {
        if (!submitting) onClose();
      }}
    >
      <div
        className={wide ? `${styles.dialog} ${styles.dialogWide}` : styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.dialogHead}>
          <h3>{title}</h3>
          <button type="button" className={styles.iconButton} aria-label="Đóng" onClick={onClose}>
            <X size={15} />
          </button>
        </header>
        <form
          className={styles.dialogForm}
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit?.();
          }}
        >
          <div className={styles.dialogBody}>
            {children}
            {error ? (
              <p role="alert" className={styles.alert}>
                {error}
              </p>
            ) : null}
          </div>
          <footer className={styles.dialogFoot}>
            <button type="button" className={styles.buttonGhost} onClick={onClose} disabled={submitting}>
              {onSubmit ? 'Huỷ' : 'Đóng'}
            </button>
            {onSubmit ? (
              <button
                type="submit"
                className={danger ? styles.buttonDanger : styles.buttonPrimary}
                disabled={submitting || submitDisabled}
              >
                {submitting ? submittingLabel : submitLabel}
              </button>
            ) : null}
          </footer>
        </form>
      </div>
    </div>,
    document.body,
  );
}

/** Nhãn cho ô chọn tự dựng (`SearchableSelect`); không bọc `<label>` để bấm vào danh sách không mở lại ô. */
export function SelectField({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className={styles.field} role="group" aria-label={label}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
      {hint ? <span className={styles.fieldHint}>{hint}</span> : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  required = false,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly required?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>
        {label}
        {required ? <span className={styles.fieldRequired}> *</span> : null}
      </span>
      {children}
      {hint ? <span className={styles.fieldHint}>{hint}</span> : null}
    </label>
  );
}

/** Hộp thoại xác nhận cho thao tác phá huỷ (xoá bài, xoá bình luận). */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly busy: boolean;
  readonly error?: string;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      title={title}
      danger
      submitLabel={confirmLabel}
      submittingLabel="Đang xoá…"
      submitting={busy}
      error={error}
      onSubmit={onConfirm}
      onClose={onClose}
    >
      <p className={styles.confirmText}>{message}</p>
    </Dialog>
  );
}
