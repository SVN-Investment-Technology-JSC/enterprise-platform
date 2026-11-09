'use client';

import type { Material } from '@enterprise-platform/contracts-inventory';
import { SearchableSelect, CloseGuard } from '@enterprise-platform/shared-ui';
import { useMemo, useState, type FormEvent } from 'react';
import type { AuditorCandidate } from '../inventory-api';
import { FormError, useFormSubmit } from './form-error';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

/**
 * Form cấp phát tài sản cho nhân viên. Hai trường nằm trong form, không để ngoài màn hình:
 * chỉ tài sản đang tồn kho (chưa có người nhận, không bảo trì) mới chọn được.
 */
export function CustodyAssignDialog({
  assets,
  employees,
  initialCode,
  busy,
  onCancel,
  onSubmit,
}: {
  /** Tài sản chưa cấp phát. */
  assets: readonly Material[];
  employees: readonly AuditorCandidate[];
  initialCode?: string;
  busy?: boolean;
  onCancel: () => void;
  /** Từ chối (reject) khi Kho báo lỗi để form hiện lý do và giữ lựa chọn. */
  onSubmit: (asset: Material, employeeId: string) => Promise<void> | void;
}) {
  const [assetCode, setAssetCode] = useState(initialCode ?? '');
  const [employeeId, setEmployeeId] = useState('');
  const { error, submit: send } = useFormSubmit('Không cấp phát được tài sản.');

  const assetOptions = useMemo(
    () => assets.map((a) => ({ value: a.code, label: a.name, badge: a.code })),
    [assets],
  );
  const employeeOptions = useMemo(
    () => employees.map((e) => ({ value: e.id, label: e.name, badge: e.code })),
    [employees],
  );

  const target = assets.find((a) => a.code === assetCode);
  const ready = Boolean(target) && employeeId !== '';

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!target || !employeeId) return;
    void send(() => onSubmit(target, employeeId));
  };

  const dirtySnapshot = JSON.stringify([assetCode, employeeId]);
  const [initialSnapshot] = useState(dirtySnapshot);
  const isDirty = dirtySnapshot !== initialSnapshot;

  return (
    <Dialog onEscape={isDirty ? undefined : onCancel}>
      <DialogContent className="max-w-[520px]" aria-label="Cấp phát tài sản">
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <div>
              <DialogTitle>Cấp phát tài sản</DialogTitle>
              <p className="mt-1 mb-0 text-sm text-slate-500">
                Chọn tài sản đang tồn kho và nhân viên nhận.
              </p>
            </div>
            <CloseGuard dirty={isDirty} busy={busy} onClose={onCancel}>
              <DialogCloseButton />
            </CloseGuard>
          </DialogHeader>

          <DialogBody className="flex flex-col gap-[1.15rem]">
            <div className="flex flex-col gap-[0.4rem]">
              <Label required>Tài sản chưa cấp phát</Label>
              <SearchableSelect
                options={assetOptions}
                value={assetCode}
                placeholder="— Chọn tài sản —"
                searchPlaceholder="Tìm mã hoặc tên tài sản…"
                emptyText="Không còn tài sản chưa cấp phát"
                onChange={setAssetCode}
                clearable
                height={42}
                style={{ width: '100%' }}
              />
            </div>
            <div className="flex flex-col gap-[0.4rem]">
              <Label required>Nhân viên nhận</Label>
              <SearchableSelect
                options={employeeOptions}
                value={employeeId}
                placeholder="— Chọn nhân viên —"
                searchPlaceholder="Tìm tên hoặc mã nhân viên…"
                emptyText="Không tìm thấy nhân viên"
                onChange={setEmployeeId}
                clearable
                height={42}
                style={{ width: '100%' }}
              />
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
              {busy ? 'Đang lưu…' : 'Cấp phát'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
