'use client';
import { useState } from 'react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { compOffApi } from '../../hrm-comp-off-api';
import { Button } from '../button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../dialog';
import { Input } from '../input';
import { toast } from '../toast';
import { errorText, Field, Notice } from './comp-off-kit';

export interface AdjustEmployeeOption {
  readonly value: string;
  readonly label: string;
}

/** Điều chỉnh tay quỹ nghỉ bù: dương mở lô mới, âm trừ vào lô gần hết hạn trước; bắt buộc có lý do. */
export function CompOffAdjustDialog({
  employees,
  employeeId: initialEmployeeId,
  onClose,
  onDone,
}: {
  employees: readonly AdjustEmployeeOption[];
  employeeId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [employeeId, setEmployeeId] = useState(initialEmployeeId ?? '');
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const amount = Number(days.replace(',', '.'));
  const problem = !employeeId
    ? 'Chọn nhân viên'
    : !Number.isFinite(amount) || amount === 0
      ? 'Nhập số ngày khác 0 (dương để cộng, âm để trừ)'
      : Math.abs(amount * 10 - Math.round(amount * 10)) > 1e-9
        ? 'Số ngày chỉ có tối đa 1 chữ số thập phân'
        : !reason.trim()
          ? 'Cần nhập lý do điều chỉnh'
          : '';

  async function submit() {
    if (problem || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await compOffApi.adjust({ employeeId, days: amount, reason: reason.trim() });
      toast.success(`Đã điều chỉnh. Số dư khả dụng còn ${result.available} ngày.`);
      onDone();
      onClose();
    } catch (e) {
      setError(errorText(e, 'Không điều chỉnh được quỹ nghỉ bù'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-lg gap-4 p-5">
        <DialogHeader>
          <DialogTitle>Điều chỉnh quỹ nghỉ bù</DialogTitle>
          <DialogDescription>Số dương mở một lô mới; số âm trừ vào các lô gần hết hạn trước và không để quỹ âm.</DialogDescription>
        </DialogHeader>
        <Field label="Nhân viên">
          <SearchableSelect
            height={36}
            value={employeeId}
            onChange={(v) => setEmployeeId(v || '')}
            options={employees}
            placeholder="Chọn nhân viên"
            disabled={Boolean(initialEmployeeId)}
          />
        </Field>
        <Field label="Số ngày (+ cộng, - trừ)">
          <Input inputMode="decimal" value={days} onChange={(e) => setDays(e.target.value)} placeholder="Ví dụ 1 hoặc -0,5" />
        </Field>
        <Field label="Lý do">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} placeholder="Bắt buộc" />
        </Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Hủy
          </Button>
          <Button onClick={() => void submit()} disabled={Boolean(problem) || busy} title={problem || undefined}>
            {busy ? 'Đang lưu…' : 'Lưu điều chỉnh'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
