'use client';

import type { Material } from '@enterprise-platform/contracts-inventory';
import { CloseGuard, SearchableSelect } from '@enterprise-platform/shared-ui';
import { useMemo, useState, type FormEvent } from 'react';
import { registerSerials } from '../inventory-api';
import { ASSET_STATUS_LABEL } from '../inventory-labels';
import { FormError, useFormSubmit } from './form-error';
import { parseSerialInput } from './serial-assign-dialog';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

/**
 * Khai báo trước các số serial của một mã vật tư. Chỉ ghi danh mục cá thể (trạng thái "chưa vào kho");
 * số lượng tồn chỉ tăng khi có phiếu nhập kèm đúng các serial này.
 */
export function SerialDeclareDialog({
  materials,
  statuses,
  usageStates,
  initialMaterialCode,
  onCancel,
  onDone,
}: {
  materials: readonly Material[];
  statuses: readonly string[];
  usageStates: readonly string[];
  initialMaterialCode?: string;
  onCancel: () => void;
  onDone: (result: { added: number; requested: number }) => void;
}) {
  const { error, submit: send } = useFormSubmit('Không khai được serial.');
  const [materialCode, setMaterialCode] = useState(initialMaterialCode ?? '');
  const [text, setText] = useState('');
  const [status, setStatus] = useState(statuses[0] ?? 'OPERATING');
  const [usage, setUsage] = useState(usageStates[0] ?? '');
  const [busy, setBusy] = useState(false);

  // Dịch vụ không có tồn; hàng đang theo lô loại trừ serial.
  const options = useMemo(
    () =>
      materials
        .filter((m) => m.kind !== 'SERVICE' && m.trackingMode !== 'LOT' && m.isActive !== false)
        .map((m) => ({ value: m.code, label: `${m.code} · ${m.name}` })),
    [materials],
  );
  const serials = parseSerialInput(text);
  const ready = materialCode !== '' && serials.length > 0;
  const isDirty = text.trim() !== '' || (materialCode !== '' && materialCode !== (initialMaterialCode ?? ''));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    void send(async () => {
      try {
        const result = await registerSerials({
          materialCode,
          serialNumbers: serials,
          currentStatus: status,
          locationType: usage || undefined,
        });
        onDone({ added: result.added, requested: serials.length });
      } finally {
        setBusy(false);
      }
    });
  };

  return (
    <Dialog onEscape={isDirty ? undefined : onCancel}>
      <DialogContent className="max-w-[600px]" aria-label="Khai báo serial">
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <div>
              <DialogTitle>Khai báo serial</DialogTitle>
              <p className="mt-1 mb-0 text-sm text-slate-500">
                Chỉ ghi danh mục cá thể, chưa tính vào tồn kho. Muốn vào kho, lập phiếu nhập kèm đúng các serial này.
              </p>
            </div>
            <CloseGuard dirty={isDirty} busy={busy} onClose={onCancel}>
              <DialogCloseButton />
            </CloseGuard>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-col gap-[1.15rem]">
              <div className="flex flex-col gap-[0.4rem]">
                <Label required>Mã vật tư</Label>
                <SearchableSelect
                  options={options}
                  value={materialCode}
                  placeholder="— Chọn vật tư —"
                  onChange={(value) => setMaterialCode(value ?? '')}
                  height={42}
                  style={{ width: '100%' }}
                />
                <span className="text-[13px] text-slate-500">
                  Mã chưa theo dõi serial sẽ được bật theo dõi khi khai.
                </span>
              </div>
              <div className="flex flex-col gap-[0.4rem]">
                <Label htmlFor="serial-declare-text" required>Số serial</Label>
                <Textarea
                  id="serial-declare-text"
                  rows={6}
                  value={text}
                  disabled={busy}
                  placeholder="Mỗi serial một dòng, hoặc ngăn bằng dấu phẩy"
                  onChange={(event) => setText(event.target.value)}
                />
                <span className="text-[13px] text-slate-500">{serials.length} serial</span>
              </div>
              <div className="grid grid-cols-2 gap-x-[1.35rem]">
                <div className="flex flex-col gap-[0.4rem]">
                  <Label>Tình trạng ban đầu</Label>
                  <SearchableSelect
                    options={(statuses.length > 0 ? statuses : ['OPERATING']).map((s) => ({
                      value: s,
                      label: ASSET_STATUS_LABEL[s as keyof typeof ASSET_STATUS_LABEL] ?? s,
                    }))}
                    value={status}
                    onChange={(value) => setStatus(value || 'OPERATING')}
                    clearable={false}
                    height={42}
                    style={{ width: '100%' }}
                  />
                </div>
                <div className="flex flex-col gap-[0.4rem]">
                  <Label>Vị trí sử dụng</Label>
                  <SearchableSelect
                    options={usageStates.map((s) => ({ value: s, label: s }))}
                    value={usage}
                    placeholder="— Chưa xác định —"
                    onChange={(value) => setUsage(value ?? '')}
                    height={42}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
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
              {busy ? 'Đang lưu…' : 'Khai báo'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
