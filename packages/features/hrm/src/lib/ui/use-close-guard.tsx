'use client';

import { useBeforeUnloadGuard } from '@enterprise-platform/shared-ui';
import { useCallback, useState, type ReactNode } from 'react';
import { Button } from './button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './dialog';

/**
 * Chặn việc mất dữ liệu khi đóng form nhập liệu (hộp thoại hoặc ngăn kéo).
 *
 * - Đang gửi (`busy`): không cho đóng.
 * - Chưa đổi gì: đóng ngay.
 * - Đã đổi (`dirty`): hỏi "Đóng và bỏ thay đổi?" thay vì đóng; đồng thời bật cảnh báo của trình duyệt khi tải
 *   lại hoặc đóng tab.
 * - Bấm nền không bao giờ đóng (tránh bấm nhầm); nút X và phím Esc đi qua cùng đường kiểm tra.
 *
 * Dùng:
 * ```tsx
 * const guard = useCloseGuard({ dirty, busy, onClose });
 * return (
 *   <Dialog {...guard.dialogProps}>
 *     <DialogContent>...</DialogContent>
 *     {guard.confirm}
 *   </Dialog>
 * );
 * ```
 * `guard.requestClose()` dùng cho nút Huỷ tự vẽ (cùng quy tắc với nút X).
 */
export function useCloseGuard({
  dirty,
  busy = false,
  onClose,
}: {
  /** Form đã có thay đổi so với giá trị ban đầu. */
  dirty: boolean;
  /** Đang gửi dữ liệu: không cho đóng. */
  busy?: boolean;
  onClose: () => void;
}) {
  const [asking, setAsking] = useState(false);
  useBeforeUnloadGuard(dirty && !busy);

  const requestClose = useCallback(() => {
    if (busy) return;
    if (dirty) setAsking(true);
    else onClose();
  }, [busy, dirty, onClose]);

  const confirm: ReactNode = asking ? (
    <DiscardConfirm
      onKeep={() => setAsking(false)}
      onDiscard={() => {
        setAsking(false);
        onClose();
      }}
    />
  ) : null;

  return {
    requestClose,
    /** Props cho Dialog/Sheet: luôn mở, mọi đường đóng đi qua `requestClose`, bấm nền không đóng. */
    dialogProps: {
      open: true,
      disablePointerDismissal: true,
      onOpenChange: (open: boolean) => {
        if (!open) requestClose();
      },
    },
    confirm,
  };
}

function DiscardConfirm({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open) onKeep();
      }}
    >
      <DialogContent showCloseButton={false} className="max-w-[420px] gap-0 p-0" role="alertdialog">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>Đóng và bỏ thay đổi?</DialogTitle>
          <DialogDescription>Thông tin vừa nhập chưa được lưu và sẽ bị mất.</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 px-5 py-4">
          <Button type="button" variant="outline" autoFocus onClick={onKeep}>
            Tiếp tục nhập
          </Button>
          <Button type="button" variant="destructive" onClick={onDiscard}>
            Đóng và bỏ
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
