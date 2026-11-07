'use client';

import { cloneElement, useEffect, type ReactElement } from 'react';
import { Popconfirm } from './popconfirm';

/**
 * Khi `dirty`, trình duyệt hiện hộp cảnh báo của riêng nó lúc tải lại, đóng tab hay rời trang.
 * Nội dung câu cảnh báo do trình duyệt quyết định, không đổi được.
 */
export function useBeforeUnloadGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
}

export interface CloseGuardProps {
  /** Form đã có thay đổi so với giá trị ban đầu. */
  readonly dirty: boolean;
  /** Đang gửi dữ liệu: không cho đóng. */
  readonly busy?: boolean;
  readonly onClose: () => void;
  readonly title?: string;
  readonly description?: string;
  readonly okText?: string;
  readonly cancelText?: string;
  /** Nút Huỷ hoặc nút X (một phần tử button). */
  readonly children: ReactElement<{ onClick?: unknown; disabled?: boolean }>;
}

/**
 * Bọc nút Huỷ hoặc nút X của form nhập liệu. Chưa thay đổi thì đóng ngay; đã thay đổi thì hỏi
 * bằng Popconfirm ("Tiếp tục nhập" / "Đóng và bỏ"). Đồng thời bật cảnh báo của trình duyệt khi dirty.
 */
export function CloseGuard({
  dirty,
  busy = false,
  onClose,
  title = 'Đóng và bỏ thay đổi?',
  description = 'Thông tin vừa nhập chưa được lưu và sẽ bị mất.',
  okText = 'Đóng và bỏ',
  cancelText = 'Tiếp tục nhập',
  children,
}: CloseGuardProps) {
  useBeforeUnloadGuard(dirty && !busy);
  if (busy) return cloneElement(children, { disabled: true });
  if (!dirty) return cloneElement(children, { onClick: onClose });
  return (
    <Popconfirm
      title={title}
      description={description}
      okText={okText}
      cancelText={cancelText}
      okType="warning"
      placement="top-end"
      onConfirm={onClose}
    >
      {children}
    </Popconfirm>
  );
}
