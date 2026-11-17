'use client';

import type { AssetCategory, CreateAssetRequest } from '@enterprise-platform/contracts-inventory';
import { SearchableSelect, CloseGuard } from '@enterprise-platform/shared-ui';
import { useMemo, useState, type FormEvent } from 'react';
import { FormError, useFormSubmit } from './form-error';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

export const ASSET_CATEGORY_LABEL: Readonly<Record<AssetCategory, string>> = {
  INDUSTRIAL: 'Thiết bị công nghiệp',
  IT_OFFICE: 'Thiết bị CNTT, văn phòng',
  TOOL_PPE: 'Dụng cụ, bảo hộ',
  VEHICLE: 'Phương tiện',
};

/**
 * Form khai báo tài sản mới (thiết bị, dụng cụ, phương tiện) ngay ở tab Tài sản.
 * Tài sản mới vào ở trạng thái hoạt động và chưa có người giữ, tức là tồn kho.
 */
export function CustodyDeclareDialog({
  busy,
  onCancel,
  onSubmit,
}: {
  busy?: boolean;
  onCancel: () => void;
  /** Từ chối (reject) khi Kho báo lỗi để form hiện lý do và giữ dữ liệu. */
  onSubmit: (input: CreateAssetRequest) => Promise<void> | void;
}) {
  const { error, submit: send } = useFormSubmit('Không khai báo được tài sản.');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<AssetCategory>('IT_OFFICE');
  const [serialNumber, setSerialNumber] = useState('');
  const [unit, setUnit] = useState('Cái');
  const [price, setPrice] = useState('');

  const categoryOptions = useMemo(
    () =>
      (Object.keys(ASSET_CATEGORY_LABEL) as AssetCategory[]).map((value) => ({
        value,
        label: ASSET_CATEGORY_LABEL[value],
      })),
    [],
  );

  const priceValue = price.trim() === '' ? undefined : Number(price);
  const priceInvalid = priceValue !== undefined && (!Number.isFinite(priceValue) || priceValue < 0);
  const ready = code.trim() !== '' && name.trim() !== '' && !priceInvalid;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready) return;
    void send(() => onSubmit({
      code: code.trim().toUpperCase(),
      name: name.trim(),
      type: 'EQUIPMENT',
      status: 'OPERATING',
      assetCategory: category,
      serialNumber: serialNumber.trim() || undefined,
      unit: unit.trim() || undefined,
      purchasePrice: priceValue,
      currency: priceValue === undefined ? undefined : 'VND',
    }));
  };

  const dirtySnapshot = JSON.stringify([code, name, category, serialNumber, unit, price]);
  const [initialSnapshot] = useState(dirtySnapshot);
  const isDirty = dirtySnapshot !== initialSnapshot;

  return (
    <Dialog onEscape={isDirty ? undefined : onCancel}>
      <DialogContent className="max-w-[620px]" aria-label="Khai báo tài sản">
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <div>
              <DialogTitle>Khai báo tài sản</DialogTitle>
              <p className="mt-1 mb-0 text-sm text-slate-500">
                Tài sản mới ở trạng thái tồn kho, chưa cấp cho ai.
              </p>
            </div>
            <CloseGuard dirty={isDirty} busy={busy} onClose={onCancel}>
              <DialogCloseButton />
            </CloseGuard>
          </DialogHeader>

          <DialogBody>
            <div className="grid grid-cols-2 gap-x-[1.35rem] gap-y-[1.15rem]">
              <div className="flex flex-col gap-[0.4rem]">
                <Label htmlFor="custody-declare-code" required>Mã tài sản</Label>
                <Input
                  id="custody-declare-code"
                  required
                  autoFocus
                  placeholder="VD: TS-LAP-003"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-[0.4rem]">
                <Label htmlFor="custody-declare-name" required>Tên tài sản</Label>
                <Input
                  id="custody-declare-name"
                  required
                  placeholder="VD: Laptop Dell Latitude 5440"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-[0.4rem]">
                <Label>Nhóm tài sản</Label>
                <SearchableSelect
                  options={categoryOptions}
                  value={category}
                  placeholder="— Chọn nhóm —"
                  onChange={(value) => setCategory((value || 'IT_OFFICE') as AssetCategory)}
                  clearable={false}
                  height={42}
                  style={{ width: '100%' }}
                />
              </div>
              <div className="flex flex-col gap-[0.4rem]">
                <Label htmlFor="custody-declare-serial">Số sê-ri</Label>
                <Input
                  id="custody-declare-serial"
                  placeholder="Số sê-ri của thiết bị"
                  value={serialNumber}
                  onChange={(event) => setSerialNumber(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-[0.4rem]">
                <Label htmlFor="custody-declare-unit">Đơn vị tính</Label>
                <Input
                  id="custody-declare-unit"
                  placeholder="Cái, Bộ…"
                  value={unit}
                  onChange={(event) => setUnit(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-[0.4rem]">
                <Label htmlFor="custody-declare-price">Giá mua (VND)</Label>
                <Input
                  id="custody-declare-price"
                  inputMode="decimal"
                  placeholder="Bỏ trống nếu chưa khai báo"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  aria-invalid={priceInvalid}
                />
                {priceInvalid ? (
                  <span role="alert" className="text-[13px] text-red-600">
                    Giá mua phải là số không âm.
                  </span>
                ) : null}
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
              {busy ? 'Đang lưu…' : 'Khai báo tài sản'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
