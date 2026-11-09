'use client';

import type {
  Asset,
  AssetCriticality,
  AssetType,
  CreateAssetRequest,
  Material,
} from '@enterprise-platform/contracts-inventory';
import { SearchableSelect, CloseGuard } from '@enterprise-platform/shared-ui';
import { useState, useMemo, type FormEvent } from 'react';
import { ASSET_CRITICALITY_LABEL } from '../inventory-labels';
import { FormError, useFormSubmit } from './form-error';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

export function AssetForm({
  assets,
  materials = [],
  defaultParentCode,
  isRootOnly = false,
  busy,
  onCancel,
  onSubmit,
}: {
  assets: readonly Asset[];
  materials?: readonly Material[];
  defaultParentCode?: string;
  isRootOnly?: boolean;
  busy: boolean;
  onCancel: () => void;
  /** Từ chối (reject) khi Kho báo lỗi để form hiện lý do và giữ dữ liệu. */
  onSubmit: (input: CreateAssetRequest) => Promise<void> | void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [isCustomCode, setIsCustomCode] = useState(false);
  const type: AssetType = 'EQUIPMENT';
  const [criticality, setCriticality] = useState<AssetCriticality>('HIGH');
  const [parentCode, setParentCode] = useState(isRootOnly ? '' : defaultParentCode ?? '');
  const [serialNumber, setSerialNumber] = useState('');

  const materialOptions = useMemo(
    () =>
      materials.map((mat) => ({
        value: mat.code,
        label: `${mat.code} — ${mat.name}`,
        badge: mat.tradeCategory,
      })),
    [materials],
  );

  const parentOptions = useMemo(
    () => [
      { value: '', label: '— Là node gốc (Cấp cao nhất) —' },
      ...assets.map((a) => ({
        value: a.code,
        label: `${a.code} — ${a.name}`,
        badge: a.code,
      })),
    ],
    [assets],
  );

  const criticalityOptions = useMemo(
    () =>
      (Object.keys(ASSET_CRITICALITY_LABEL) as AssetCriticality[]).map((c) => ({
        value: c,
        label: ASSET_CRITICALITY_LABEL[c],
      })),
    [],
  );

  const { error, submit: send } = useFormSubmit('Không lưu được thiết bị.');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!code.trim() || !name.trim()) return;
    void send(() => onSubmit({
      code: code.trim().toUpperCase(),
      name: name.trim(),
      type,
      criticality,
      parentCode: isRootOnly ? undefined : parentCode || undefined,
      serialNumber: serialNumber.trim() || undefined,
    }));
  };

  const dirtySnapshot = JSON.stringify([code, name, isCustomCode, criticality, parentCode, serialNumber]);
  const [initialSnapshot] = useState(dirtySnapshot);
  const isDirty = dirtySnapshot !== initialSnapshot;

  return (
    <Dialog onEscape={isDirty ? undefined : onCancel}>
      <DialogContent
        className="max-w-[520px]"
        aria-label={isRootOnly ? 'Tạo Thiết bị / Cụm gốc' : 'Thêm vật tư lắp đặt'}
      >
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <div>
              <DialogTitle>{isRootOnly ? 'Tạo Thiết bị / Cụm gốc' : 'Thêm vật tư lắp đặt'}</DialogTitle>
              <p className="mt-1 mb-0 text-sm leading-snug text-slate-500">
                {isRootOnly
                  ? 'Thiết bị hoặc công trình cấp cao nhất (Root Node) trên cây tài sản 360.'
                  : 'Khai báo thiết bị và phân bổ vào cây cấu trúc tài sản.'}
              </p>
            </div>
            <CloseGuard dirty={isDirty} busy={busy} onClose={onCancel}>
              <DialogCloseButton />
            </CloseGuard>
          </DialogHeader>

          <DialogBody className="flex flex-col gap-4">
          {/* Trường Thiết bị / Mã thiết bị */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-sm text-slate-700" required>
                Thiết bị / Vật tư trong kho
              </Label>
              {materials.length > 0 && (
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-[13px]"
                  onClick={() => {
                    setIsCustomCode((prev) => !prev);
                  }}
                >
                  {isCustomCode ? 'Chọn từ danh mục kho' : 'Nhập mã tuỳ biến'}
                </Button>
              )}
            </div>

            {materials.length > 0 && !isCustomCode ? (
              <SearchableSelect
                options={materialOptions}
                value={code}
                placeholder="Tìm mã hoặc tên vật tư / thiết bị từ kho…"
                emptyText="Không tìm thấy vật tư phù hợp"
                onChange={(selectedCode) => {
                  setCode(selectedCode);
                  const selectedMat = materials.find((m) => m.code === selectedCode);
                  if (selectedMat) {
                    setName(selectedMat.name);
                  }
                }}
                clearable
                style={{ width: '100%' }}
              />
            ) : (
              <Input
                required
                placeholder="VD: TBA-220, NM-SAVINA, TR-01…"
                value={code}
                autoFocus
                onChange={(event) => setCode(event.target.value)}
              />
            )}
            <span className="text-[13px] text-slate-500">
              {materials.length > 0 && !isCustomCode
                ? 'Chọn thiết bị/vật tư đã được khai báo trong danh mục vật tư kho.'
                : 'Mã định danh viết hoa duy nhất dùng trong quản trị và vận hành.'}
            </span>
          </div>

          {/* Tên thiết bị */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-slate-700" required>
              Tên thiết bị / Cụm tài sản
            </Label>
            <Input
              required
              placeholder="VD: Trạm biến áp 220kV Savina, Dây chuyền sản xuất 1…"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          {/* Vị trí phân cấp / Node cha */}
          {!isRootOnly ? (
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm text-slate-700">
                Thuộc thiết bị cha
              </Label>
              <SearchableSelect
                options={parentOptions}
                value={parentCode}
                placeholder="— Là node gốc (Cấp cao nhất) —"
                emptyText="Không tìm thấy thiết bị cha phù hợp"
                onChange={(val) => setParentCode(val)}
                clearable
                style={{ width: '100%' }}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm text-slate-700">
                Vị trí phân cấp
              </Label>
              <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-[9px] text-sm text-slate-800">
                <span className="text-base"></span>
                <span>
                  <strong>Cấp 0 (Node gốc)</strong> — Cụm tài sản độc lập cao nhất trên cây
                </span>
              </div>
            </div>
          )}

          {/* Hàng 2 cột: Mức độ quan trọng & Serial */}
          <div className="grid grid-cols-2 gap-3.5">
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm text-slate-700">
                Mức độ quan trọng
              </Label>
              <SearchableSelect
                options={criticalityOptions}
                value={criticality}
                placeholder="Chọn mức độ quan trọng…"
                emptyText="Không tìm thấy mức độ phù hợp"
                clearable={false}
                onChange={(val) => setCriticality(val as AssetCriticality)}
                style={{ width: '100%' }}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-sm text-slate-700">
                Số Serial / Khung
              </Label>
              <Input
                placeholder="Tùy chọn"
                value={serialNumber}
                onChange={(event) => setSerialNumber(event.target.value)}
              />
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
            <Button type="submit" disabled={busy || !code.trim() || !name.trim()}>
              {busy ? 'Đang tạo…' : isRootOnly ? 'Xác nhận tạo gốc' : 'Lưu thiết bị'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
