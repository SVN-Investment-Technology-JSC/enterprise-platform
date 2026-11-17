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
      className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] leading-normal text-red-700"
      style={style}
    >
      <AlertTriangle aria-hidden="true" size={15} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 wrap-anywhere">{error}</div>
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
