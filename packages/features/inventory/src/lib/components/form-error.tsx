'use client';

import { AlertTriangle } from 'lucide-react';
import { useCallback, useState, type CSSProperties } from 'react';

/**
 * Lỗi của lần gửi form, hiện ngay trong form (cuối phần nội dung) để người dùng
 * thấy lý do và sửa tiếp mà không mất dữ liệu đã nhập. Cùng dáng với ghi chú đỏ
 * của HRM; bản thân form quyết định khi nào xoá lỗi (thường là đầu lần gửi sau).
 */
export function FormError({ error, style }: { error?: string; style?: CSSProperties }) {
  if (!error) return null;
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
        padding: '10px 12px',
        border: '1px solid #fecaca',
        borderRadius: '8px',
        background: '#fef2f2',
        color: '#b91c1c',
        fontSize: '13px',
        lineHeight: 1.5,
        ...style,
      }}
    >
      <AlertTriangle aria-hidden="true" size={15} style={{ flexShrink: 0, marginTop: '2px' }} />
      <div style={{ minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}>{error}</div>
    </div>
  );
}

/** Lời lỗi của một ngoại lệ; lỗi server đã là tiếng Việt nên hiện nguyên văn. */
export function submitErrorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

/**
 * Gửi form và giữ lỗi của lần gửi gần nhất. `submit` xoá lỗi cũ rồi chạy; hàm chạy ném lỗi
 * (hoặc trả Promise bị từ chối) thì lỗi hiện trong form, form giữ nguyên dữ liệu đã nhập.
 * Thành công thì form thường đã bị đóng nên không đụng tới state nữa.
 */
export function useFormSubmit(fallback: string) {
  const [error, setError] = useState<string>();
  const submit = useCallback(
    async (run: () => Promise<unknown> | unknown) => {
      setError(undefined);
      try {
        await run();
      } catch (cause) {
        setError(submitErrorMessage(cause, fallback));
      }
    },
    [fallback],
  );
  const clear = useCallback(() => setError(undefined), []);
  return { error, submit, clear };
}
