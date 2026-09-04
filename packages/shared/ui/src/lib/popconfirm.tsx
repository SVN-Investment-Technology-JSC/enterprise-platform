'use client';

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import styles from './popconfirm.module.css';

export type PopconfirmPlacement =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-start'
  | 'top-end'
  | 'bottom-start'
  | 'bottom-end';

export interface PopconfirmProps {
  readonly title: string;
  readonly description?: string;
  readonly icon?: ReactNode;
  readonly okText?: string;
  readonly cancelText?: string;
  readonly okType?: 'danger' | 'primary' | 'warning';
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly placement?: PopconfirmPlacement;
  /** Chuỗi văn bản người dùng bắt buộc phải nhập khớp để mở khóa nút Xác nhận */
  readonly confirmInput?: {
    readonly requiredText: string;
    readonly placeholder?: string;
    readonly label?: string;
  };
  readonly onConfirm?: () => void | Promise<void>;
  readonly onCancel?: () => void;
  readonly children: ReactElement;
}

export function Popconfirm({
  title,
  description,
  icon = '',
  okText = 'Xác nhận',
  cancelText = 'Hủy',
  okType = 'danger',
  disabled = false,
  loading = false,
  placement = 'top',
  confirmInput,
  onConfirm,
  onCancel,
  children,
}: PopconfirmProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [busy, setBusy] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const triggerRef = useRef<HTMLElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current || !popupRef.current) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const popupRect = popupRef.current.getBoundingClientRect();

    let top = 0;
    let left = 0;

    switch (placement) {
      case 'bottom':
      case 'bottom-start':
        top = triggerRect.bottom + 8;
        left =
          placement === 'bottom-start'
            ? triggerRect.left
            : triggerRect.left + (triggerRect.width - popupRect.width) / 2;
        break;
      case 'bottom-end':
        top = triggerRect.bottom + 8;
        left = triggerRect.right - popupRect.width;
        break;
      case 'left':
        top = triggerRect.top + (triggerRect.height - popupRect.height) / 2;
        left = triggerRect.left - popupRect.width - 8;
        break;
      case 'right':
        top = triggerRect.top + (triggerRect.height - popupRect.height) / 2;
        left = triggerRect.right + 8;
        break;
      case 'top-start':
        top = triggerRect.top - popupRect.height - 8;
        left = triggerRect.left;
        break;
      case 'top-end':
        top = triggerRect.top - popupRect.height - 8;
        left = triggerRect.right - popupRect.width;
        break;
      case 'top':
      default:
        top = triggerRect.top - popupRect.height - 8;
        left = triggerRect.left + (triggerRect.width - popupRect.width) / 2;
        break;
    }

    // Giữ trong khung nhìn màn hình
    const padding = 8;
    left = Math.max(padding, Math.min(left, window.innerWidth - popupRect.width - padding));
    top = Math.max(padding, Math.min(top, window.innerHeight - popupRect.height - padding));

    setCoords({ top: top + window.scrollY, left: left + window.scrollX });
  }, [placement]);

  useEffect(() => {
    if (!open) return;
    updatePosition();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        onCancel?.();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popupRef.current &&
        !popupRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setOpen(false);
        onCancel?.();
      }
    };

    const handleScroll = () => {
      updatePosition();
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open, updatePosition, onCancel]);

  const isConfirmDisabled =
    disabled ||
    busy ||
    loading ||
    (confirmInput ? inputValue.trim() !== confirmInput.requiredText.trim() : false);

  const handleOpen = () => {
    setInputValue('');
    setOpen(true);
  };

  const handleTriggerClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    if (!open) {
      handleOpen();
    } else {
      setOpen(false);
      onCancel?.();
    }
  };

  const handleConfirm = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isConfirmDisabled) return;
    if (onConfirm) {
      try {
        setBusy(true);
        await onConfirm();
        setOpen(false);
      } finally {
        setBusy(false);
      }
    } else {
      setOpen(false);
    }
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    onCancel?.();
  };

  const trigger = isValidElement(children)
    ? cloneElement(children as ReactElement<{ ref?: unknown; onClick?: unknown }>, {
        ref: (node: HTMLElement | null) => {
          triggerRef.current = node;
          const originalRef = (children as unknown as { ref?: unknown }).ref;
          if (typeof originalRef === 'function') originalRef(node);
          else if (originalRef && typeof originalRef === 'object' && 'current' in originalRef) {
            (originalRef as { current: HTMLElement | null }).current = node;
          }
        },
        onClick: (e: React.MouseEvent) => {
          const originalOnClick = (
            children.props as { onClick?: (e: React.MouseEvent) => void }
          ).onClick;
          if (originalOnClick) originalOnClick(e);
          handleTriggerClick(e);
        },
      })
    : children;

  return (
    <>
      {trigger}
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popupRef}
              className={styles.popconfirmPopup}
              style={{
                top: `${coords.top}px`,
                left: `${coords.left}px`,
                width: confirmInput ? '310px' : '280px',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className={`${styles.popconfirmArrow} ${
                  placement.startsWith('bottom')
                    ? styles.arrowBottom
                    : placement.startsWith('left')
                    ? styles.arrowLeft
                    : placement.startsWith('right')
                    ? styles.arrowRight
                    : styles.arrowTop
                }`}
              />
              <div className={styles.popconfirmContent}>
                <div className={styles.popconfirmHeader}>
                  {icon ? <span className={styles.popconfirmIcon}>{icon}</span> : null}
                  <div className={styles.popconfirmTitleGroup}>
                    <div className={styles.popconfirmTitle}>{title}</div>
                    {description ? (
                      <div className={styles.popconfirmDesc}>{description}</div>
                    ) : null}
                  </div>
                </div>

                {confirmInput ? (
                  <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ fontSize: '11.5px', color: '#475569', lineHeight: 1.35 }}>
                      {confirmInput.label ?? 'Nhập mã sau để xác nhận:'}{' '}
                      <strong style={{ color: '#dc2626', fontFamily: 'monospace' }}>
                        {confirmInput.requiredText}
                      </strong>
                    </div>
                    <input
                      type="text"
                      autoFocus
                      style={{
                        padding: '5px 8px',
                        fontSize: '12px',
                        border: '1px solid #cbd5e1',
                        borderRadius: '4px',
                        outline: 'none',
                        width: '100%',
                        boxSizing: 'border-box',
                        background: '#ffffff',
                      }}
                      placeholder={confirmInput.placeholder ?? confirmInput.requiredText}
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !isConfirmDisabled) {
                          void handleConfirm(e as unknown as React.MouseEvent);
                        }
                      }}
                    />
                  </div>
                ) : null}

                <div className={styles.popconfirmButtons}>
                  <button
                    type="button"
                    className={styles.popconfirmBtnCancel}
                    disabled={busy || loading}
                    onClick={handleCancel}
                  >
                    {cancelText}
                  </button>
                  <button
                    type="button"
                    className={`${styles.popconfirmBtnOk} ${
                      okType === 'danger'
                        ? styles.btnDanger
                        : okType === 'warning'
                        ? styles.btnWarning
                        : styles.btnPrimary
                    }`}
                    disabled={isConfirmDisabled}
                    onClick={handleConfirm}
                  >
                    {busy || loading ? '...' : okText}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
