'use client';

import { SearchableSelect } from '@enterprise-platform/shared-ui';
import {
  CORRECTION_DEFAULT_TIME,
  CORRECTION_PUNCH_LABEL,
  type CorrectionPunchKind,
} from '../hrm-correction-sessions';
import { TimeComboInput } from './time-combo-input';

const KIND_OPTIONS = [
  { value: 'IN', label: CORRECTION_PUNCH_LABEL.IN },
  { value: 'OUT', label: CORRECTION_PUNCH_LABEL.OUT },
];

/**
 * Giải trình công: chỉ một mốc giờ, là giờ vào hoặc giờ ra. Ngày của mốc giờ chính là "Ngày phát sinh điều chỉnh" của đơn
 * (không hiện lại ở đây), nên không thể có hai ngày khác nhau. Giờ gợi ý lấy theo ca được gán của ngày đó. Quên chấm một chiều thì khai báo mốc còn thiếu;
 * giờ cùng loại đã chấm trong ngày sẽ được thay bằng giờ này, loại còn lại giữ nguyên.
 */
export function HrmCorrectionPunches({
  kind,
  time,
  onChange,
  defaults = CORRECTION_DEFAULT_TIME,
  disabled,
}: {
  kind: CorrectionPunchKind | '';
  /** 'HH:mm' */
  time: string;
  onChange: (next: { kind: CorrectionPunchKind | ''; time: string }) => void;
  /** Giờ gợi ý cho từng loại (giờ bắt đầu và kết thúc ca của ngày); thiếu ca thì dùng giờ mặc định. */
  defaults?: Record<CorrectionPunchKind, string>;
  disabled?: boolean;
}) {
  const label = kind ? CORRECTION_PUNCH_LABEL[kind] : 'Giờ';
  return (
    <section
      data-testid="correction-punches"
      className="space-y-2"
    >
      <h3 className="text-sm font-semibold">Giờ chấm công cần bổ sung</h3>
      <p className="text-xs text-slate-500">
        Chọn đây là giờ vào hay giờ ra rồi nhập giờ (gợi ý theo ca được gán). Mỗi đơn chỉ khai báo một mốc; quên chấm cả hai chiều
        thì tạo hai đơn. Giờ cùng loại đã chấm trong ngày sẽ được thay bằng giờ này, loại còn lại giữ nguyên.
      </p>
      <div
        data-testid="correction-punch-1"
        className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[170px_minmax(0,1fr)]"
      >
        <div className="space-y-1">
          <span className="block text-xs font-semibold text-slate-700">Loại giờ</span>
          <SearchableSelect
            height={32}
            options={KIND_OPTIONS}
            value={kind}
            onChange={(value) => {
              const next: CorrectionPunchKind | '' = value === 'IN' || value === 'OUT' ? value : '';
              // Giờ còn là giờ gợi ý của loại cũ thì đổi theo gợi ý của loại mới; giờ người dùng đã sửa thì giữ nguyên.
              const wasSuggested = !time || (kind !== '' && time === defaults[kind]);
              onChange({ kind: next, time: next && wasSuggested ? defaults[next] : time });
            }}
            placeholder="Chọn giờ vào / ra"
            clearable={false}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1">
          <span className="block text-xs font-semibold text-slate-700">
            {label} <span className="text-rose-500">*</span>
          </span>
          <TimeComboInput
            aria-label={`${label} (giờ)`}
            value={time}
            disabled={disabled}
            onChange={(value) => onChange({ kind, time: value })}
          />
        </div>
      </div>
      <a className="text-xs text-blue-700" href="/modules/hrm/my-work" target="_blank" rel="noreferrer">
        Mở bảng công của tôi để đối chiếu
      </a>
    </section>
  );
}
