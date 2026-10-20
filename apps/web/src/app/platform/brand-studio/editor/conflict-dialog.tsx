'use client';

import { MinimalPopupForm } from '@enterprise-platform/shared-ui';
import { Button } from '@/components/ui/button';

export interface ConflictDialogProps {
  readonly open: boolean;
  /** Phiên bản mới nhất trên máy chủ, nếu máy chủ cho biết. */
  readonly currentVersion: number | null;
  /** Đang tải bản mới hoặc đang lưu bản sao: khoá các nút. */
  readonly busy: boolean;
  /** Tải bản mới nhất từ máy chủ và bỏ thay đổi đang sửa. */
  readonly onReload: () => void;
  /** Giữ bản đang sửa bằng cách lưu thành icon mới. */
  readonly onKeepMine: () => void;
  /** Đóng hộp mà chưa chọn: icon vẫn chưa lưu, bấm Lưu để chọn lại. */
  readonly onClose: () => void;
}

/** Hộp báo icon đã có phiên bản mới hơn trên máy chủ (409). Không bao giờ ghi đè: người dùng chọn một trong hai hướng. */
export function ConflictDialog({ open, currentVersion, busy, onReload, onKeepMine, onClose }: ConflictDialogProps) {
  return (
    <MinimalPopupForm
      isOpen={open}
      isSubmitting={busy}
      maxWidth={440}
      onClose={onClose}
      subtitle={currentVersion ? `Máy chủ đang giữ phiên bản ${currentVersion}` : undefined}
      title="Icon đã có bản mới hơn"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-700">Người khác vừa lưu icon này. Thay đổi của bạn chưa được lưu và không ghi đè bản trên máy chủ.</p>
        <div className="flex flex-col gap-2">
          <Button className="h-auto justify-start rounded-md px-3 py-2 text-left" disabled={busy} onClick={onReload} variant="outline">
            <span className="flex flex-col items-start gap-0.5">
              <span className="text-sm font-medium">Tải bản mới nhất</span>
              <span className="text-xs font-normal text-slate-500">Bỏ thay đổi của bạn trên icon này.</span>
            </span>
          </Button>
          <Button className="h-auto justify-start rounded-md px-3 py-2 text-left" disabled={busy} onClick={onKeepMine} variant="outline">
            <span className="flex flex-col items-start gap-0.5">
              <span className="text-sm font-medium">Giữ bản của tôi</span>
              <span className="text-xs font-normal text-slate-500">Lưu thành icon mới, bản trên máy chủ giữ nguyên.</span>
            </span>
          </Button>
        </div>
      </div>
    </MinimalPopupForm>
  );
}
