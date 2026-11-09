'use client';

import type { CreateMaterialRequest, InventoryTradeCatalog } from '@enterprise-platform/contracts-inventory';
import { SearchableSelect, VnNumberInput, CloseGuard } from '@enterprise-platform/shared-ui';
import { useMemo, useState, type FormEvent } from 'react';
import { FormError, submitErrorMessage } from './form-error';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { TRADE_GROUP_LABEL, categoriesOf, withCurrent, type TradeGroup } from '../trade-items.model';

/** Dáng ô nhập của `Input`, cho `VnNumberInput` (không đi qua component `Input`). */
const NUMBER_INPUT_CLASS =
  'h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-sm outline-none placeholder:text-slate-400 focus-visible:border-blue-600 focus-visible:ring-2 focus-visible:ring-blue-100 disabled:bg-slate-100 disabled:opacity-50 aria-invalid:border-red-500';

/**
 * Tạo mới một mặt hàng kinh doanh. Việc sửa làm ngay trên drawer chi tiết (`TradeItemDrawer`).
 * Phân loại, đơn vị và sử dụng chọn từ danh mục khai trong Cài đặt.
 */
export function TradeItemFormDialog({
  catalog,
  units = [],
  busy,
  onCancel,
  onCreate,
}: {
  catalog?: InventoryTradeCatalog;
  /** Danh mục đơn vị tính khai ở Cài đặt; rỗng thì cho gõ tự do để không chặn việc tạo mã. */
  units?: readonly string[];
  busy?: boolean;
  onCancel: () => void;
  /** Gửi lên Kho; từ chối (reject) khi thất bại để form giữ lại dữ liệu và hiện lý do. */
  onCreate: (input: CreateMaterialRequest) => Promise<void> | void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [barcode, setBarcode] = useState('');
  const [group, setGroup] = useState<TradeGroup>('GOODS');
  const [category, setCategory] = useState('');
  const [unit, setUnit] = useState('');
  const [usage, setUsage] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string>();

  const groupOptions = useMemo(
    () => (Object.keys(TRADE_GROUP_LABEL) as TradeGroup[]).map((value) => ({ value, label: TRADE_GROUP_LABEL[value] })),
    [],
  );
  // Mỗi nhóm một danh sách phân loại riêng; đổi nhóm thì đổi danh sách.
  const categoryOptions = useMemo(
    () => withCurrent(categoriesOf(group, catalog), category),
    [group, catalog, category],
  );
  const usageOptions = useMemo(
    () => withCurrent(catalog?.usageModes ?? [], usage),
    [catalog, usage],
  );

  const unitOptions = useMemo(() => withCurrent(units, unit), [units, unit]);

  const priceValue = price.trim() === '' ? undefined : Number(price);
  const priceInvalid = priceValue !== undefined && (!Number.isFinite(priceValue) || priceValue < 0);
  const ready = code.trim() !== '' && name.trim() !== '' && unit.trim() !== '' && !priceInvalid;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready) return;
    setError(undefined);
    try {
      await onCreate({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        unit: unit.trim(),
        category: 'CONSUMABLE',
        kind: group === 'SERVICE' ? 'SERVICE' : 'STOCK',
        barcode: barcode.trim() || undefined,
        tradeCategory: category || undefined,
        tradeMode: usage || undefined,
        salePrice: priceValue,
        currency: priceValue === undefined ? undefined : 'VND',
        description: description.trim() || undefined,
      });
    } catch (cause) {
      setError(submitErrorMessage(cause, 'Không lưu được hàng hóa.'));
    }
  };

  const title = 'Tạo hàng hóa';

  const dirtySnapshot = JSON.stringify([code, name, barcode, group, category, unit, usage, price, description]);
  const [initialSnapshot] = useState(dirtySnapshot);
  const isDirty = dirtySnapshot !== initialSnapshot;

  return (
    <Dialog onEscape={isDirty ? undefined : onCancel}>
      <DialogContent className="max-w-[620px]" aria-label={title}>
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <CloseGuard dirty={isDirty} busy={busy} onClose={onCancel}>
              <DialogCloseButton />
            </CloseGuard>
          </DialogHeader>

          <DialogBody>
            <div className="grid grid-cols-2 gap-x-[1.35rem] gap-y-[1.15rem]">
              <div className="flex flex-col gap-[0.4rem]">
                <Label htmlFor="trade-code" required>Mã</Label>
                <Input
                  id="trade-code"
                  required
                  autoFocus
                  placeholder="VD: VT-001"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-[0.4rem]">
                <Label htmlFor="trade-name" required>Tên</Label>
                <Input
                  id="trade-name"
                  required
                  placeholder="Tên hàng hóa hoặc dịch vụ"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-[0.4rem]">
                <Label htmlFor="trade-barcode">Barcode</Label>
                <Input
                  id="trade-barcode"
                  placeholder="Mã vạch"
                  value={barcode}
                  onChange={(event) => setBarcode(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-[0.4rem]">
                <Label>Nhóm</Label>
                <SearchableSelect
                  options={groupOptions}
                  value={group}
                  placeholder="— Chọn nhóm —"
                  onChange={(value) => {
                    setGroup((value || 'GOODS') as TradeGroup);
                    // Phân loại thuộc danh sách của nhóm cũ, không còn hợp lệ ở nhóm mới.
                    setCategory('');
                  }}
                  clearable={false}
                  height={36}
                  className="w-full"
                />
              </div>
              <div className="flex flex-col gap-[0.4rem]">
                <Label>Phân loại</Label>
                <SearchableSelect
                  options={categoryOptions}
                  value={category}
                  placeholder={
                    categoryOptions.length === 0 ? '— Chưa khai báo trong Cài đặt —' : '— Chọn phân loại —'
                  }
                  onChange={(value) => setCategory(value || '')}
                  clearable
                  height={36}
                  className="w-full"
                />
              </div>
              <div className="flex flex-col gap-[0.4rem]">
                <Label htmlFor="trade-unit" required>Đơn vị</Label>
                {units.length > 0 ? (
                  <SearchableSelect
                    options={unitOptions}
                    value={unit}
                    placeholder="— Chọn đơn vị —"
                    emptyText="Không tìm thấy đơn vị tính"
                    onChange={(value) => setUnit(value || '')}
                    clearable={false}
                    height={36}
                    className="w-full"
                  />
                ) : (
                  <Input
                    id="trade-unit"
                    required
                    placeholder="Cái, Mét, Giờ…"
                    value={unit}
                    onChange={(event) => setUnit(event.target.value)}
                  />
                )}
              </div>
              <div className="flex flex-col gap-[0.4rem]">
                <Label>Sử dụng</Label>
                <SearchableSelect
                  options={usageOptions}
                  value={usage}
                  placeholder="— Chọn cách sử dụng —"
                  onChange={(value) => setUsage(value || '')}
                  clearable
                  height={36}
                  className="w-full"
                />
              </div>
              <div className="flex flex-col gap-[0.4rem]">
                <Label htmlFor="trade-price">Giá bán (VND)</Label>
                <VnNumberInput
                  id="trade-price"
                  className={NUMBER_INPUT_CLASS}
                  placeholder="Bỏ trống nếu chưa khai báo"
                  value={price}
                  onChange={setPrice}
                  aria-invalid={priceInvalid}
                />
                {priceInvalid ? (
                  <span role="alert" className="text-[13px] text-red-600">
                    Giá bán phải là số không âm.
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex flex-col gap-[0.4rem]">
              <Label htmlFor="trade-description">Mô tả</Label>
              <Textarea
                id="trade-description"
                rows={3}
                maxLength={2000}
                placeholder="Thông tin thêm về hàng hóa hoặc dịch vụ"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
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
              {busy ? 'Đang lưu…' : 'Tạo mới'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
