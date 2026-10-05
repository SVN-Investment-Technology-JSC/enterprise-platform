'use client';
import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { Button } from './button';
import { Input } from './input';
import { type ProcedureActionKind } from '../procedure-progress-view';

export interface ProcedureActionBarProps {
  busy?: boolean;
  /** Gọi action lên Procedure Engine; ném lỗi để thanh này không xoá ô lý do. */
  onAction: (action: ProcedureActionKind, comment: string) => Promise<void>;
}

/** Duyệt / Từ chối / Trả lại cho đơn đi theo quy trình PE; PE là nơi kiểm quyền. */
export function ProcedureActionBar({ busy, onAction }: ProcedureActionBarProps) {
  const [reason, setReason] = useState('');
  const hasReason = reason.trim().length > 0;

  const run = async (action: ProcedureActionKind) => {
    try {
      await onAction(action, reason.trim());
      setReason('');
    } catch {
      /* lỗi đã được màn hình cha hiển thị */
    }
  };

  return (
    <div className="flex flex-col gap-2 w-full" data-testid="procedure-action-bar">
      <Input
        aria-label="Ý kiến / Lý do xử lý"
        placeholder="Ý kiến xử lý (bắt buộc khi từ chối hoặc trả lại)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={busy}
      />
      <div className="flex items-center justify-end gap-2">
        <Popconfirm
          title="Từ chối đơn này?"
          description="Quy trình sẽ kết thúc với kết quả từ chối."
          okText="Từ chối"
          cancelText="Quay lại"
          disabled={busy || !hasReason}
          onConfirm={() => run('REJECT')}
        >
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !hasReason}
            title={hasReason ? undefined : 'Nhập lý do để từ chối'}
            className="text-xs h-8 text-rose-700 border-rose-200 hover:bg-rose-50 font-medium"
          >
            Từ chối
          </Button>
        </Popconfirm>
        <Popconfirm
          title="Trả lại đơn này?"
          description="Đơn được trả về bước trước để chỉnh sửa."
          okText="Trả lại"
          cancelText="Quay lại"
          okType="warning"
          disabled={busy || !hasReason}
          onConfirm={() => run('RETURN')}
        >
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !hasReason}
            title={hasReason ? undefined : 'Nhập lý do để trả lại'}
            className="text-xs h-8 text-amber-700 border-amber-200 hover:bg-amber-50 font-medium"
          >
            Trả lại
          </Button>
        </Popconfirm>
        <Popconfirm
          title="Duyệt bước này?"
          description="Quy trình sẽ chuyển sang bước tiếp theo hoặc hoàn tất."
          okText="Duyệt"
          cancelText="Quay lại"
          okType="primary"
          disabled={busy}
          onConfirm={() => run('APPROVE')}
        >
          <Button
            size="sm"
            disabled={busy}
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8 font-semibold shadow-xs flex items-center gap-1.5"
          >
            <CheckCircle2 className="size-3.5" />
            <span>Duyệt</span>
          </Button>
        </Popconfirm>
      </div>
    </div>
  );
}
