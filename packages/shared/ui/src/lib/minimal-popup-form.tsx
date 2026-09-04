'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import styles from './minimal-popup-form.module.css';

export interface MinimalFormData {
  readonly fullName: string;
  readonly email: string;
  readonly phone: string;
}

export interface MinimalPopupFormProps {
  readonly isOpen: boolean;
  readonly title?: string;
  readonly subtitle?: string;
  readonly initialValues?: Partial<MinimalFormData>;
  readonly submitText?: string;
  readonly cancelText?: string;
  readonly isSubmitting?: boolean;
  readonly onClose: () => void;
  readonly onSubmit?: (data: MinimalFormData) => void | Promise<void>;
  readonly children?: React.ReactNode;
}

export function MinimalPopupForm({
  isOpen,
  title = 'Thông tin liên hệ',
  subtitle,
  initialValues,
  submitText = 'Xác nhận',
  cancelText = 'Hủy',
  isSubmitting = false,
  onClose,
  onSubmit,
  children,
}: MinimalPopupFormProps) {
  const [mounted, setMounted] = useState(false);
  const [fullName, setFullName] = useState(initialValues?.fullName ?? '');
  const [email, setEmail] = useState(initialValues?.email ?? '');
  const [phone, setPhone] = useState(initialValues?.phone ?? '');
  const [errors, setErrors] = useState<{ fullName?: string; email?: string; phone?: string }>({});
  const [internalLoading, setInternalLoading] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset form state whenever opened
  useEffect(() => {
    if (isOpen) {
      setFullName(initialValues?.fullName ?? '');
      setEmail(initialValues?.email ?? '');
      setPhone(initialValues?.phone ?? '');
      setErrors({});
      setInternalLoading(false);
    }
  }, [isOpen, initialValues]);

  // Close on ESC key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !mounted) {
    return null;
  }

  const validate = (): boolean => {
    const newErrors: { fullName?: string; email?: string; phone?: string } = {};

    if (!fullName.trim()) {
      newErrors.fullName = 'Vui lòng nhập họ và tên';
    }

    if (!email.trim()) {
      newErrors.email = 'Vui lòng nhập địa chỉ email';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      newErrors.email = 'Địa chỉ email không đúng định dạng';
    }

    if (!phone.trim()) {
      newErrors.phone = 'Vui lòng nhập số điện thoại';
    } else if (!/^(0|\+84)[3|5|7|8|9][0-9]{8}$/.test(phone.trim().replace(/\s+/g, ''))) {
      newErrors.phone = 'Số điện thoại không hợp lệ (10 chữ số)';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || internalLoading) return;

    if (!validate()) {
      return;
    }

    const payload: MinimalFormData = {
      fullName: fullName.trim(),
      email: email.trim(),
      phone: phone.trim(),
    };

    try {
      setInternalLoading(true);
      if (onSubmit) {
        await onSubmit(payload);
      }
    } finally {
      setInternalLoading(false);
    }
  };

  const loading = isSubmitting || internalLoading;

  const content = (
    <div
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="minimal-popup-title"
    >
      <div className={styles.popup}>
        <header className={styles.header}>
          <div>
            <h2 id="minimal-popup-title" className={styles.title}>
              {title}
            </h2>
            {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            disabled={loading}
            aria-label="Đóng"
            title="Đóng (ESC)"
          >
            ✕
          </button>
        </header>

        {children ? (
          children
        ) : (
          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="minimal-form-fullname">
                Họ và tên <span className={styles.required}>*</span>
              </label>
              <input
                id="minimal-form-fullname"
                className={`${styles.input} ${errors.fullName ? styles.inputError : ''}`}
                type="text"
                placeholder="Nguyễn Văn A"
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  if (errors.fullName) setErrors((prev) => ({ ...prev, fullName: undefined }));
                }}
                disabled={loading}
                autoFocus
              />
              {errors.fullName ? <span className={styles.errorText}>{errors.fullName}</span> : null}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="minimal-form-email">
                Email <span className={styles.required}>*</span>
              </label>
              <input
                id="minimal-form-email"
                className={`${styles.input} ${errors.email ? styles.inputError : ''}`}
                type="email"
                placeholder="example@domain.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
                }}
                disabled={loading}
              />
              {errors.email ? <span className={styles.errorText}>{errors.email}</span> : null}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="minimal-form-phone">
                Số điện thoại <span className={styles.required}>*</span>
              </label>
              <input
                id="minimal-form-phone"
                className={`${styles.input} ${errors.phone ? styles.inputError : ''}`}
                type="tel"
                placeholder="0912345678"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (errors.phone) setErrors((prev) => ({ ...prev, phone: undefined }));
                }}
                disabled={loading}
              />
              {errors.phone ? <span className={styles.errorText}>{errors.phone}</span> : null}
            </div>

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.cancelButton}
                onClick={onClose}
                disabled={loading}
              >
                {cancelText}
              </button>
              <button
                type="submit"
                className={styles.submitButton}
                disabled={loading}
              >
                {loading ? <span className={styles.spinner} aria-hidden="true" /> : null}
                <span>{loading ? 'Đang xử lý…' : submitText}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
