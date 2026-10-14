'use client';

import { Plus, Trash2 } from 'lucide-react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import {
  CORRECTION_PUNCH_LABEL,
  nextPunchKind,
  suggestPunchRow,
  type CorrectionPunchKind,
  type CorrectionPunchRow,
} from '../hrm-correction-sessions';
import { Button } from './button';
import { DateTimeInput } from './date-time-input';

const KIND_OPTIONS = [
  { value: 'IN', label: CORRECTION_PUNCH_LABEL.IN },
  { value: 'OUT', label: CORRECTION_PUNCH_LABEL.OUT },
];

/**
 * Giải trình theo từng mốc giờ: mỗi dòng chọn rõ là giờ vào hoặc giờ ra rồi nhập ngày giờ. Quên chấm một chiều thì chỉ
 * khai báo mốc còn thiếu; giờ cùng loại đã chấm trong ngày sẽ được thay bằng giờ này, loại còn lại giữ nguyên.
 */
export function HrmCorrectionPunches({
  rows,
  onChange,
  date,
  disabled,
}: {
  rows: CorrectionPunchRow[];
  onChange: (rows: CorrectionPunchRow[]) => void;
  /** Ngày phát sinh điều chỉnh (YYYY-MM-DD) để gợi ý giờ khi thêm dòng. */
  date: string;
  disabled?: boolean;
}) {
  const kind = nextPunchKind(rows);
  const update = (index: number, patch: Partial<CorrectionPunchRow>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  // Loại đã dùng ở dòng khác không chọn lại được: mỗi ngày chỉ một giờ vào và một giờ ra.
  const optionsFor = (index: number) =>
    KIND_OPTIONS.map((option) => ({
      ...option,
      disabled: rows.some((row, i) => i !== index && row.kind === option.value),
    }));

  return (
    <section
      data-testid="correction-punches"
      className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Giờ chấm công cần bổ sung</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={disabled || !kind}
          onClick={() => kind && onChange([...rows, suggestPunchRow(date, kind as CorrectionPunchKind)])}
        >
          <Plus className="size-3.5" />
          Thêm {kind ? CORRECTION_PUNCH_LABEL[kind].toLowerCase() : 'giờ'}
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        Chọn rõ đây là giờ vào hay giờ ra rồi nhập thời điểm. Quên chấm một chiều thì chỉ cần khai báo mốc còn thiếu; giờ
        cùng loại đã chấm trong ngày sẽ được thay bằng giờ này, loại còn lại giữ nguyên.
      </p>
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div
            key={index}
            data-testid={`correction-punch-${index + 1}`}
            className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[170px_minmax(0,1fr)_auto]"
          >
            <div className="space-y-1">
              <span className="block text-xs font-semibold text-slate-700">Loại giờ</span>
              <SearchableSelect
                height={32}
                options={optionsFor(index)}
                value={row.kind}
                onChange={(value) => update(index, { kind: value === 'IN' || value === 'OUT' ? value : '' })}
                placeholder="Chọn giờ vào / ra"
                clearable={false}
                disabled={disabled}
              />
            </div>
            <div className="space-y-1">
              <span className="block text-xs font-semibold text-slate-700">
                {row.kind ? CORRECTION_PUNCH_LABEL[row.kind] : 'Thời điểm'} <span className="text-rose-500">*</span>
              </span>
              <DateTimeInput
                aria-label={row.kind ? CORRECTION_PUNCH_LABEL[row.kind] : `Giờ chấm công ${index + 1}`}
                value={row.at}
                disabled={disabled}
                onChange={(value) => update(index, { at: value })}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1 px-2 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
              aria-label={`Bỏ dòng ${index + 1}`}
              disabled={disabled || rows.length === 1}
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
            >
              <Trash2 className="size-3.5" />
              Bỏ
            </Button>
          </div>
        ))}
      </div>
      <a
        className="text-xs text-blue-700"
        href="/modules/hrm/my-work"
        target="_blank"
        rel="noreferrer"
      >
        Mở bảng công của tôi để đối chiếu
      </a>
    </section>
  );
}
