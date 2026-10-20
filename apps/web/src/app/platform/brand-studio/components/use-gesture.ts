'use client';

import type { EditorAction } from '@enterprise-platform/shared-brand-icon';
import { useCallback, useEffect, useMemo, useRef, type Dispatch } from 'react';

export interface Gesture {
  /** Bắt đầu một thao tác liên tục (kéo thanh trượt, gõ chữ): các thay đổi sau đó gộp thành một bước hoàn tác. */
  readonly start: () => void;
  /** Kết thúc thao tác; gọi nhiều lần cũng chỉ có tác dụng một lần. */
  readonly end: () => void;
}

/**
 * Bọc `gestureStart`/`gestureEnd` của editorReducer. Tự kết thúc khi thành phần bị gỡ giữa chừng
 * để trình thiết kế không bị kẹt ở chế độ "đang kéo".
 */
export function useGesture(dispatch: Dispatch<EditorAction>): Gesture {
  const active = useRef(false);

  const start = useCallback(() => {
    if (active.current) return;
    active.current = true;
    dispatch({ type: 'gestureStart' });
  }, [dispatch]);

  const end = useCallback(() => {
    if (!active.current) return;
    active.current = false;
    dispatch({ type: 'gestureEnd' });
  }, [dispatch]);

  useEffect(() => end, [end]);

  return useMemo(() => ({ start, end }), [start, end]);
}
