'use client';
import { DatePickerInput } from './date-picker-input';
import { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from './button';
import { Input } from './input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './dialog';
import {
  OT_REFERENCES,
  otReferenceWarnings,
} from '../hrm-payroll-config';

export const otNumberFields = [
  ['dailyLimitMinutes', 'Giới hạn phút / ngày'],
  ['weeklyLimitMinutes', 'Giới hạn phút / tuần'],
  ['monthlyLimitMinutes', 'Giới hạn phút / tháng'],
  ['yearlyLimitMinutes', 'Giới hạn phút / năm'],
] as const;

const referenceByKey = Object.fromEntries(OT_REFERENCES.map((r) => [r.key, r]));

export interface OtDialogProps {
  /** Phiên bản gốc để nạp giá trị (sửa hoặc tạo bản kế tiếp). */
  base?: { config_json: Record<string, unknown>; effective_from: string; updated_at: string; id: string };
  /** true: sửa trực tiếp phiên bản chưa dùng; false: tạo phiên bản mới. */
  editing: boolean;
  onSubmit: (path: string, body: Record<string, unknown>, method: 'POST' | 'PATCH') => Promise<void>;
  onClose: () => void;
}

export function PayrollOtDialog({ base, editing, onSubmit, onClose }: OtDialogProps) {
  const config = base?.config_json ?? {};
  const [numbers, setNumbers] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      otNumberFields.map(([key]) => [key, config[key] === undefined ? '' : String(config[key])]),
    ),
  );
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const warnings = otReferenceWarnings({ ...numbers });
  const warningFor = (key: string) => warnings.find((w) => w.key === key);

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] p-0 flex flex-col overflow-hidden bg-white">
        <DialogHeader className="shrink-0 p-5 border-b border-slate-200 bg-slate-50/80">
          <DialogTitle className="text-base font-bold text-slate-900">
            {editing ? 'Sửa quy định OT' : 'Phiên bản quy định OT'}
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            {editing
              ? 'Chỉ sửa phiên bản chưa được sử dụng. Quy định đã áp dụng cần phiên bản kế tiếp.'
              : 'Giờ ban đêm chọn theo HH:mm. Mức tham chiếu chỉ để đối chiếu, cần HR/pháp chế xác nhận theo văn bản hiện hành.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col flex-1 min-h-0 overflow-hidden"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            if (!reason.trim()) return setError('Cần nhập lý do thay đổi');
            for (const [key, label] of otNumberFields)
              if (key.endsWith('Minutes'))
                if (numbers[key] === '' || !Number.isFinite(Number(numbers[key])))
                  return setError(`Cần nhập ${label}`);
            setBusy(true);
            try {
              const body: Record<string, unknown> = {
                ...Object.fromEntries(
                  otNumberFields
                    .filter(([key]) => numbers[key] !== '')
                    .map(([key]) => [key, Number(numbers[key])]),
                ),
                effectiveFrom: editing ? base!.effective_from.slice(0, 10) : effectiveFrom,
                reason: reason.trim(),
                ...(editing ? { expectedUpdatedAt: base!.updated_at } : {}),
              };
              if (!editing && !effectiveFrom) throw new Error('Cần nhập ngày hiệu lực');
              await onSubmit(editing ? `/payroll-configuration/${base!.id}` : '/ot-configuration', body, editing ? 'PATCH' : 'POST');
              onClose();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Không lưu được');
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
            {!editing && (
              <label className="block space-y-1 text-xs font-medium text-slate-700">
                <span>Ngày hiệu lực *</span>
                <DatePickerInput
  required
  value={effectiveFrom}
  onChange={(v: string) => setEffectiveFrom(v)}
  className="max-w-[240px]"
/>
              </label>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {otNumberFields.map(([key, label]) => {
                const ref = referenceByKey[key];
                const warn = warningFor(key);
                return (
                  <label key={key} className="block space-y-1 text-xs font-medium text-slate-700">
                    <span>{label}</span>
                    <Input
                      type="number"
                      min={0}
                      step={key.endsWith('Minutes') ? '1' : '0.01'}
                      value={numbers[key]}
                      onChange={(e) => setNumbers({ ...numbers, [key]: e.target.value })}
                      placeholder={ref ? `Tham chiếu: ${ref.value}` : undefined}
                      className={`text-xs h-9 ${warn ? 'border-amber-400' : ''}`}
                    />
                    {ref && (
                      <span className="block text-[11px] font-normal text-slate-500">
                        Tham chiếu {ref.value}{ref.kind === 'limit' ? ' phút' : ''}: {ref.note}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
            {warnings.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 space-y-1" role="status">
                <div className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="size-3.5" />
                  Cảnh báo so với mức tham chiếu (không chặn lưu)
                </div>
                <ul className="list-disc pl-5 space-y-0.5">
                  {warnings.map((w) => (
                    <li key={w.key}>{w.message}</li>
                  ))}
                </ul>
              </div>
            )}
            <label className="block space-y-1 text-xs font-medium text-slate-700">
              <span>Lý do thay đổi *</span>
              <Input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Nhập lý do (ghi vào nhật ký kiểm toán)" className="text-xs h-9" />
            </label>
            {error && (
              <p role="alert" className="text-xs text-red-700 font-medium bg-red-50 p-2.5 rounded border border-red-200">
                {error}
              </p>
            )}
          </div>
          <div className="shrink-0 p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={onClose} className="text-xs h-8">
              Hủy
            </Button>
            <Button type="submit" disabled={busy} className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 font-semibold shadow-xs">
              {busy ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : null}
              {busy ? 'Đang lưu…' : 'Lưu quy định OT'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
