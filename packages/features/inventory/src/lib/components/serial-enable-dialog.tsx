'use client';

import type { SerialCoverage } from '@enterprise-platform/contracts-inventory';
import { CloseGuard } from '@enterprise-platform/shared-ui';
import { useMemo, useState, type FormEvent } from 'react';
import { enableSerialTracking } from '../inventory-api';
import { FormError, useFormSubmit } from './form-error';
import { parseSerialInput } from './serial-assign-dialog';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

/**
 * Bật theo dõi serial cho mặt hàng đang theo dõi thông thường. Mỗi kho đang có tồn là một ô nhập: phải khai đủ
 * đúng bằng số lượng tồn của kho đó, và cả việc đổi cách theo dõi lẫn gắn serial xảy ra trong một lần lưu
 * (lỗi thì không đổi gì). Mặt hàng chưa có tồn thì chỉ cần xác nhận.
 */
export function SerialEnableDialog({
  materialCode,
  materialName,
  coverage,
  onCancel,
  onDone,
  className,
  backdropClassName,
}: {
  materialCode: string;
  materialName?: string;
  /** Mức phủ theo kho của mã; chỉ kho có tồn được liệt kê. */
  coverage: readonly SerialCoverage[];
  onCancel: () => void;
  onDone: (assigned: number) => void;
  /** Lớp z cho hộp thoại mở chồng trên hộp thoại khác. */
  className?: string;
  backdropClassName?: string;
}) {
  const { error, submit: send } = useFormSubmit('Không bật được theo dõi serial.');
  const stocked = useMemo(() => coverage.filter((item) => item.quantity > 0), [coverage]);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const parsed = stocked.map((item) => ({ item, serials: parseSerialInput(texts[item.warehouseCode] ?? '') }));
  const fractional = stocked.find((item) => !Number.isInteger(item.quantity));
  const allSerials = parsed.flatMap((entry) => entry.serials.map((serial) => serial.toUpperCase()));
  const crossDuplicate = allSerials.length !== new Set(allSerials).size;
  const matches = parsed.every((entry) => entry.serials.length === entry.item.quantity);
  const ready = !fractional && !crossDuplicate && matches;
  const isDirty = Object.values(texts).some((value) => value.trim() !== '');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    void send(async () => {
      try {
        const result = await enableSerialTracking({
          materialCode,
          assignments: parsed.map((entry) => ({
            warehouseCode: entry.item.warehouseCode,
            serialNumbers: entry.serials,
          })),
        });
        onDone(result.assigned);
      } finally {
        setBusy(false);
      }
    });
  };

  return (
    <Dialog onEscape={!busy && !isDirty ? onCancel : undefined}>
      <DialogContent className={cn('max-w-[600px]', className)} backdropClassName={backdropClassName} aria-label="Bật theo dõi serial">
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <div>
              <DialogTitle>Bật theo dõi serial</DialogTitle>
              <p className="mt-1 mb-0 text-sm text-slate-500">
                {materialCode}
                {materialName ? ` · ${materialName}` : ''}
              </p>
            </div>
            <CloseGuard dirty={isDirty} busy={busy} onClose={onCancel}>
              <DialogCloseButton />
            </CloseGuard>
          </DialogHeader>
          <DialogBody>
            {stocked.length === 0 ? (
              <p className="m-0 text-sm text-slate-600">
                Mã này chưa có tồn ở kho nào. Bật theo dõi serial thì từ nay hàng nhập kho phải kèm đủ số serial.
              </p>
            ) : (
              <>
                <p className="m-0 mb-3 text-sm text-slate-600">
                  Mã này đang có tồn ở {stocked.length} kho. Khai đủ serial cho từng kho (mỗi serial một dòng, hoặc ngăn
                  bằng dấu phẩy); số serial phải bằng đúng số lượng tồn. Số lượng tồn không đổi.
                </p>
                {fractional ? (
                  <p role="alert" className="m-0 mb-3 text-[13px] text-red-600">
                    Kho {fractional.warehouseCode} tồn {fractional.quantity} không phải số nguyên. Điều chỉnh tồn trước khi
                    bật serial.
                  </p>
                ) : null}
                <div className="flex flex-col gap-4">
                  {parsed.map(({ item, serials }) => {
                    const id = `serial-enable-${item.warehouseCode}`;
                    const wrong = serials.length > 0 && serials.length !== item.quantity;
                    return (
                      <div key={item.warehouseCode} className="flex flex-col gap-[0.4rem]">
                        <Label htmlFor={id} required>
                          Kho {item.warehouseCode}
                          {item.warehouseName ? ` · ${item.warehouseName}` : ''} (tồn {item.quantity})
                        </Label>
                        <Textarea
                          id={id}
                          rows={3}
                          value={texts[item.warehouseCode] ?? ''}
                          disabled={busy}
                          placeholder="Mỗi serial một dòng, hoặc ngăn bằng dấu phẩy"
                          aria-invalid={wrong}
                          onChange={(event) => setTexts((current) => ({ ...current, [item.warehouseCode]: event.target.value }))}
                        />
                        <span
                          className={wrong ? 'text-[13px] text-red-600' : 'text-[13px] text-slate-500'}
                          role={wrong ? 'alert' : undefined}
                        >
                          {serials.length}/{item.quantity} serial
                        </span>
                      </div>
                    );
                  })}
                </div>
                {crossDuplicate ? (
                  <p role="alert" className="m-0 mt-3 text-[13px] text-red-600">
                    Có serial bị khai trùng giữa các kho.
                  </p>
                ) : null}
              </>
            )}
            <FormError error={error} />
          </DialogBody>
          <DialogFooter>
            <CloseGuard dirty={isDirty} busy={busy} onClose={onCancel}>
              <Button type="button" variant="outline" disabled={busy}>
                Huỷ
              </Button>
            </CloseGuard>
            <Button type="submit" disabled={busy || !ready}>
              {busy ? 'Đang lưu…' : 'Bật theo dõi serial'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
