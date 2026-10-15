'use client';

import { useRef } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  MAX_REQUEST_RANGES,
  nextRange,
  rangeLabel,
  type ExtraRange,
  type TimeRangeInput,
} from '../request-ranges';
import { Button } from './button';
import { RequestTimeRange } from './request-time-range';

/**
 * Các khoảng thời gian bổ sung của một đơn nghỉ, làm thêm giờ hoặc công tác: mỗi khoảng là một cặp "từ ngày giờ đến
 * ngày giờ" có máy chủ tính riêng và báo lỗi riêng. Khoảng chính nằm ở form chính; mỗi khoảng được gửi thành một đơn
 * với cùng lý do, mô tả và chứng từ.
 */
export function ExtraTimeRanges({
  kind,
  employeeId,
  leaveTypeId,
  main,
  ranges,
  onChange,
  disabled,
}: {
  kind: 'leave' | 'ot' | 'trip';
  employeeId: string;
  leaveTypeId?: string;
  /** Khoảng chính (để gợi ý khoảng kế tiếp). */
  main: TimeRangeInput;
  ranges: readonly ExtraRange[];
  onChange: (ranges: ExtraRange[]) => void;
  disabled?: boolean;
}) {
  const noun = kind === 'leave' ? 'nghỉ' : kind === 'ot' ? 'làm thêm' : 'công tác';
  const total = ranges.length + 1;
  // Kết quả tính của máy chủ về sau thời điểm render: luôn cập nhật trên danh sách mới nhất, không ghi đè khoảng khác.
  const latest = useRef(ranges);
  latest.current = ranges;

  function patch(id: string, next: Partial<ExtraRange>) {
    const updated = latest.current.map((r) => (r.id === id ? { ...r, ...next } : r));
    latest.current = updated;
    onChange(updated);
  }

  function add() {
    const last = ranges.length ? ranges[ranges.length - 1] : main;
    const suggestion = nextRange(last);
    onChange([...ranges, { id: `${Date.now()}-${ranges.length}`, ...suggestion, preview: null }]);
  }

  return (
    <div data-testid={`extra-ranges-${kind}`} className="space-y-2">
      {ranges.map((range, index) => (
        <div
          key={range.id}
          data-testid={`extra-range-${index + 2}`}
          className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800">{rangeLabel(index + 1, kind)}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Xoá ${rangeLabel(index + 1, kind).toLowerCase()}`}
              className="h-7 gap-1 px-2 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
              disabled={disabled}
              onClick={() => onChange(ranges.filter((r) => r.id !== range.id))}
            >
              <Trash2 className="size-3.5" />
              Xoá
            </Button>
          </div>
          <RequestTimeRange
            employeeId={employeeId}
            kind={kind}
            leaveTypeId={leaveTypeId}
            fromAt={range.fromAt}
            toAt={range.toAt}
            fromLabel={`Từ ngày giờ ${noun}`}
            toLabel={`Đến ngày giờ ${noun}`}
            disabled={disabled}
            onChange={(next) => patch(range.id, { fromAt: next.fromAt, toAt: next.toAt })}
            onPreview={(preview) => patch(range.id, { preview })}
          />
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={disabled || total >= MAX_REQUEST_RANGES}
          onClick={add}
        >
          <Plus className="size-3.5" />
          Thêm khoảng {noun}
        </Button>
        {ranges.length > 0 && (
          <span className="text-[12px] text-slate-500">
            Gửi thành {total} đơn {noun}, cùng lý do, mô tả và chứng từ.
          </span>
        )}
      </div>
    </div>
  );
}
