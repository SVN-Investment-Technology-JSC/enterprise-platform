'use client';

import { useEffect } from 'react';
import type { HrmOrgUnitOption } from '@enterprise-platform/contracts-hrm';
import type { SearchableSelectOption } from '@enterprise-platform/shared-ui';
import { Button } from '../button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../dialog';
import {
  ReleaseConfirmButton,
  ReleaseFields,
  ReleaseStatus,
  useReleaseFlow,
} from './release-flow';

/**
 * Nhả ca (hủy lịch) trong một khoảng ngày dưới dạng hộp thoại, dùng từ chi tiết nhân viên: luôn xem phạm vi ảnh hưởng
 * (dry-run) rồi mới xác nhận. Cùng luồng với tab "Nhả ca" của trang (`useReleaseFlow`).
 */
export function CancelScheduleDialog({
  open,
  onOpenChange,
  units,
  employeeOptions,
  employeesLoading,
  employeesError,
  canBulk,
  canCalendar,
  initial,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  units: readonly HrmOrgUnitOption[];
  employeeOptions: readonly SearchableSelectOption[];
  employeesLoading: boolean;
  employeesError: string;
  canBulk: boolean;
  canCalendar: boolean;
  initial?: { employeeId?: string };
  onDone: () => void;
}) {
  const flow = useReleaseFlow({ canCalendar, initial, onDone });
  const { reset } = flow;

  useEffect(() => {
    if (open) reset();
    // Chỉ khởi tạo lại khi mở hộp thoại.
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="@container h-[min(88dvh,720px)] max-w-3xl" aria-label="Nhả ca">
        <DialogHeader className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-4 pr-12 @lg:px-6">
          <DialogTitle className="text-lg">Nhả ca</DialogTitle>
          <DialogDescription>
            Gỡ lịch đã phân (hủy lịch) trong khoảng ngày. Hệ thống luôn cho xem phạm vi ảnh hưởng trước khi nhả ca.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 @lg:px-6">
          <ReleaseFields
            flow={flow}
            catalog={{ units, employeeOptions, employeesLoading, employeesError, canBulk, canCalendar }}
          />
          <ReleaseStatus flow={flow} />
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-3 @lg:px-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Đóng
          </Button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" disabled={flow.busy} onClick={() => void flow.inspect()}>
              Xem phạm vi ảnh hưởng
            </Button>
            <ReleaseConfirmButton flow={flow} onConfirmed={() => onOpenChange(false)} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
