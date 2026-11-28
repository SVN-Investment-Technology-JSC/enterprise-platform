'use client';

import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import boardStyles from '../workspace-board.module.scss';
import styles from './case-layout-a.module.scss';

/** Đánh dấu các khối của cửa sổ; khối lạ gắn vào cửa sổ (hộp xác nhận vẽ bằng portal) là đang có hộp con mở. */
const PART = 'data-case-modal-part';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function cssClass(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const escape = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape : (value: string) => value;
  return `.${escape(name.split(' ')[0] ?? name)}`;
}

/**
 * Có hộp con đang mở trên cửa sổ: hộp thoại khác (xoá đơn, đổi dự án, huỷ hiệu lực, xác nhận duyệt, xem bước, phiếu tài
 * chính...), hộp xác nhận của thư viện (gắn vào cửa sổ), hay ô xác nhận tại chỗ của màn (Huỷ hồ sơ, Hoàn duyệt, Từ chối).
 * Khi đó Esc và bấm nền thuộc về hộp con, không đóng cửa sổ hồ sơ.
 */
function nestedOpen(panel: HTMLElement): boolean {
  const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="alertdialog"]');
  if ([...dialogs].some((element) => element !== panel)) return true;
  if ([...panel.children].some((child) => !child.hasAttribute(PART))) return true;
  const inlineConfirm = cssClass(boardStyles.popconfirmBox);
  return Boolean(inlineConfirm && panel.querySelector(inlineConfirm));
}

/** Đang gõ dở trong ô nhập: Esc không đóng cửa sổ để khỏi mất nội dung (vẫn đóng bằng nút X). */
function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)) return false;
  return target.value.trim().length > 0;
}

export interface CaseModalProps {
  readonly titleId: string;
  readonly onClose: () => void;
  /** Vị trí hồ sơ trong danh sách đang lọc / sắp xếp (đếm từ 1); vắng khi hồ sơ không còn trong danh sách. */
  readonly position?: number;
  readonly total: number;
  readonly onPrev?: () => void;
  readonly onNext?: () => void;
  /** Hồ sơ vừa được xử lý xong ở cửa sổ này: hiện nút "Hồ sơ kế tiếp". */
  readonly onNextCase?: () => void;
  /** Phần tử nhận lại focus khi đóng (dòng của hồ sơ trên bảng). */
  readonly restoreFocus: () => HTMLElement | null | undefined;
  /** Tên hồ sơ (mang `titleId`) kèm chip trạng thái / SLA, nằm trên thanh đầu cửa sổ cạnh ‹ n/N ›. */
  readonly heading?: ReactNode;
  /** Các nút quản trị của hồ sơ (Huỷ hồ sơ, Đổi dự án / công việc, Xoá đơn...), bên phải thanh đầu cửa sổ. */
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}

/**
 * Cửa sổ hồ sơ trên màn Hồ sơ xử lý: rộng tối đa 1440px (96% màn), cao 92% màn. Thanh đầu cố định gồm ‹ n/N ›, tên hồ sơ
 * (tối đa 2 dòng) kèm chip trạng thái / SLA, các nút quản trị và nút đóng; phần còn lại tự cuộn, chỉ hàng nút thao tác
 * ghim đáy; dưới 768px thì toàn màn.
 * Đóng bằng nút X, phím Esc hay bấm nền (trừ khi có hộp con đang mở); giữ focus trong cửa sổ và trả focus về dòng khi đóng.
 * Vẽ bằng portal ra `body` (z-index dưới các hộp thoại con 9999 để chúng nằm trên).
 */
export function CaseModal({
  titleId,
  onClose,
  position,
  total,
  onPrev,
  onNext,
  onNextCase,
  restoreFocus,
  heading,
  actions,
  children,
}: CaseModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const downOnBackdrop = useRef(false);
  const latest = useRef({ onClose, restoreFocus });
  latest.current = { onClose, restoreFocus };

  // Mở: khoá cuộn trang, đưa focus vào cửa sổ. Đóng: trả cuộn trang và focus.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = previousOverflow;
      const target = latest.current.restoreFocus();
      if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const panel = panelRef.current;
      if (!panel || nestedOpen(panel) || typingInto(event.target)) return;
      event.preventDefault();
      latest.current.onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Giữ Tab / Shift+Tab trong cửa sổ (chỉ khi focus đang ở trong cửa sổ, không tính hộp con vẽ ra ngoài).
  const trapFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel || !panel.contains(event.target as Node)) return;
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (element) => !element.closest('[aria-hidden="true"]'),
    );
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className={styles.modalBackdrop}
      onMouseDown={(event) => {
        downOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        const fromBackdrop = downOnBackdrop.current && event.target === event.currentTarget;
        downOnBackdrop.current = false;
        const panel = panelRef.current;
        if (!fromBackdrop || !panel || nestedOpen(panel)) return;
        onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`${boardStyles.workspace} ${styles.modalPanel}`}
        onKeyDown={trapFocus}
      >
        <div className={styles.modalBar} {...{ [PART]: '' }}>
          <div className={styles.modalNav}>
            <button
              type="button"
              className={styles.iconBtn}
              aria-label="Hồ sơ trước"
              title="Hồ sơ trước"
              disabled={!onPrev}
              onClick={onPrev}
            >
              <ChevronLeft size={15} aria-hidden />
            </button>
            <span
              className={styles.modalPosition}
              title={position ? undefined : 'Hồ sơ không còn trong danh sách đang lọc'}
            >
              {position ?? '–'} / {total}
            </span>
            <button
              type="button"
              className={styles.iconBtn}
              aria-label="Hồ sơ sau"
              title="Hồ sơ sau"
              disabled={!onNext}
              onClick={onNext}
            >
              <ChevronRight size={15} aria-hidden />
            </button>
          </div>
          {heading ?? <span className={styles.modalHeading} />}
          {/* Rỗng (không có nút nào theo điều kiện) thì ẩn hẳn bằng `:empty`. */}
          <div className={styles.modalActions}>{actions}</div>
          <div className={styles.modalEnd}>
            {onNextCase ? (
              <button type="button" className={styles.nextCase} onClick={onNextCase}>
                Hồ sơ kế tiếp
                <ChevronRight size={14} aria-hidden />
              </button>
            ) : null}
            <button
              type="button"
              className={styles.iconBtn}
              aria-label="Đóng hồ sơ"
              title="Đóng (Esc)"
              onClick={onClose}
            >
              <X size={15} aria-hidden />
            </button>
          </div>
        </div>
        <div className={styles.modalBody} {...{ [PART]: '' }}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
