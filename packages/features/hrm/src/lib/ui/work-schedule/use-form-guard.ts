'use client';

import { useEffect, useState } from 'react';
import { useCloseGuard } from '../use-close-guard';

export type SubFormState = { dirty: boolean; busy: boolean };

/**
 * Bảo vệ biểu mẫu con nằm trong một hộp thoại quản lý (danh sách và biểu mẫu chung một hộp thoại).
 * - Nút "Quay lại danh sách" đi qua `guard.requestClose` (hỏi khi đã sửa, chặn khi đang gửi).
 * - Báo trạng thái (đã sửa, đang gửi) lên hộp thoại cha để Esc và nút X của cha cũng được bảo vệ.
 * `snapshot` là chuỗi mô tả các ô nhập (không gồm trạng thái tải hay lỗi).
 */
export function useSubFormGuard({
  snapshot,
  busy,
  onBack,
  onState,
}: {
  snapshot: string;
  busy: boolean;
  onBack: () => void;
  onState: (state: SubFormState) => void;
}) {
  const [initial] = useState(snapshot);
  const dirty = snapshot !== initial;
  useEffect(() => {
    onState({ dirty, busy });
  }, [dirty, busy, onState]);
  useEffect(
    () => () => {
      onState({ dirty: false, busy: false });
    },
    [onState],
  );
  return useCloseGuard({ dirty, busy, onClose: onBack });
}
