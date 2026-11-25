'use client';

import { toast } from '@enterprise-platform/shared-ui';
import { useEffect } from 'react';

/**
 * Báo lỗi bằng toast thay cho khung đỏ chèn vào bố cục. Không vẽ gì ra màn; đặt đúng chỗ khung lỗi cũ.
 * Mỗi lần `message` đổi sang một chuỗi có chữ thì hiện một toast (lỗi bị xoá rồi đặt lại cùng nội dung vẫn hiện lại).
 */
export function ErrorToast({ message }: { readonly message?: string | null }) {
  useEffect(() => {
    if (message) toast.error(message);
  }, [message]);
  return null;
}
