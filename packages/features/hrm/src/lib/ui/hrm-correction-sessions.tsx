'use client';
import type { CorrectionSessionRow } from '../hrm-correction-sessions';
import { Button } from './button';
import { Input } from './input';

export function HrmCorrectionSessions({
  rows,
  onChange,
}: {
  rows: CorrectionSessionRow[];
  onChange: (rows: CorrectionSessionRow[]) => void;
}) {
  const update = (index: number, key: 'start' | 'end', value: string) =>
    onChange(rows.map((r, i) => (i === index ? { ...r, [key]: value } : r)));
  return (
    <section className="space-y-2 rounded-lg border bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Các phiên vào–ra đề nghị</h3>
        <Button
          type="button"
          variant="outline"
          disabled={rows.length >= 12}
          onClick={() => onChange([...rows, { start: '', end: '' }])}
        >
          Thêm phiên
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        Nhập toàn bộ phiên cần ghi nhận theo thứ tự; ca qua đêm chọn ngày ra kế
        tiếp. Múi giờ nhập: {Intl.DateTimeFormat().resolvedOptions().timeZone}.
      </p>
      <div className="max-h-64 space-y-2 overflow-y-auto">
        {rows.map((row, index) => (
          <div
            key={index}
            className="grid grid-cols-[1fr_1fr_auto] items-end gap-2"
          >
            <label className="space-y-1 text-xs">
              Vào phiên {index + 1}
              <Input
                type="datetime-local"
                step="1"
                aria-label={`Vào phiên ${index + 1}`}
                value={row.start}
                onChange={(e) => update(index, 'start', e.target.value)}
              />
            </label>
            <label className="space-y-1 text-xs">
              Ra phiên {index + 1}
              <Input
                type="datetime-local"
                step="1"
                aria-label={`Ra phiên ${index + 1}`}
                value={row.end}
                onChange={(e) => update(index, 'end', e.target.value)}
              />
            </label>
            <Button
              type="button"
              variant="outline"
              disabled={rows.length === 1}
              aria-label={`Bỏ phiên ${index + 1}`}
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
            >
              Bỏ
            </Button>
          </div>
        ))}
      </div>
      <a
        className="text-xs text-blue-700"
        href="/modules/hrm/attendance"
        target="_blank"
        rel="noreferrer"
      >
        Mở dữ liệu chấm công để đối chiếu
      </a>
    </section>
  );
}
