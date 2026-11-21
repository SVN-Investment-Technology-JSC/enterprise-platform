'use client';

import { CloseGuard } from '@enterprise-platform/shared-ui';
import { useState, type FormEvent } from 'react';
import { assignSerials } from '../inventory-api';
import { FormError, useFormSubmit } from './form-error';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

/** Tách một ô nhập thành danh sách serial: nhận xuống dòng, dấu phẩy, chấm phẩy; bỏ trống và trùng. */
export function parseSerialInput(text: string): string[] {
  return [...new Set(text.split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean))];
}

/**
 * Gắn số serial cho hàng ĐÃ có trong tồn của một kho. Không đổi số lượng tồn; số serial nhập
 * không được vượt phần chưa có serial. Hàng mới vào kho phải đi qua phiếu nhập.
 */
export function SerialAssignDialog({
  materialCode,
  materialName,
  warehouseCode,
  unassigned,
  onCancel,
  onDone,
}: {
  materialCode: string;
  materialName?: string;
  warehouseCode: string;
  unassigned: number;
  onCancel: () => void;
  onDone: (assigned: number) => void;
}) {
  const { error, submit: send } = useFormSubmit('Không gắn được serial.');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const serials = parseSerialInput(text);
  const over = serials.length > unassigned;
  const ready = serials.length > 0 && !over;
  const isDirty = text.trim() !== '';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    void send(async () => {
      try {
        const result = await assignSerials({ materialCode, warehouseCode, serialNumbers: serials });
        onDone(result.assigned);
      } finally {
        setBusy(false);
      }
    });
  };

  return (
    <Dialog onEscape={isDirty ? undefined : onCancel}>
      <DialogContent className="max-w-[560px]" aria-label="Gắn serial cho tồn kho">
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <div>
              <DialogTitle>Gắn serial cho hàng trong kho</DialogTitle>
              <p className="mt-1 mb-0 text-sm text-slate-500">
                {materialCode}
                {materialName ? ` · ${materialName}` : ''} · Kho {warehouseCode}
              </p>
            </div>
            <CloseGuard dirty={isDirty} busy={busy} onClose={onCancel}>
              <DialogCloseButton />
            </CloseGuard>
          </DialogHeader>
          <DialogBody>
            <p className="m-0 mb-3 text-sm text-slate-600">
              Còn <strong>{unassigned}</strong> cái chưa có số serial. Mỗi serial một dòng, hoặc ngăn bằng dấu phẩy.
              Việc này không đổi số lượng tồn.
            </p>
            <div className="flex flex-col gap-[0.4rem]">
              <Label htmlFor="serial-assign-text" required>Số serial</Label>
              <Textarea
                id="serial-assign-text"
                rows={6}
                autoFocus
                value={text}
                disabled={busy}
                onChange={(event) => setText(event.target.value)}
                aria-invalid={over}
              />
              <span className={over ? 'text-[13px] text-red-600' : 'text-[13px] text-slate-500'} role={over ? 'alert' : undefined}>
                {over
                  ? `Nhập ${serials.length} serial, vượt ${unassigned} cái chưa có serial.`
                  : `${serials.length}/${unassigned} serial`}
              </span>
            </div>
            <FormError error={error} />
          </DialogBody>
          <DialogFooter>
            <CloseGuard dirty={isDirty} busy={busy} onClose={onCancel}>
              <Button type="button" variant="outline" disabled={busy}>
                Huỷ
              </Button>
            </CloseGuard>
            <Button type="submit" disabled={busy || !ready}>
              {busy ? 'Đang lưu…' : 'Gắn serial'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
