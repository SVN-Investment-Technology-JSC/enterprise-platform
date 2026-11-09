'use client';

import type {
  CreateMaterialRequest,
  InventoryTradeCatalog,
  Material,
  MaterialCategory,
  MaterialKind,
} from '@enterprise-platform/contracts-inventory';
import { SearchableSelect, VnNumberInput, CloseGuard } from '@enterprise-platform/shared-ui';
import { Info, Layers, Package, QrCode } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { currencyLabel } from '../inventory-labels';
import { categoriesOf, withCurrent } from '../trade-items.model';
import { FormError, useFormSubmit } from './form-error';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

/** Nhãn bọc một ô nhập: chữ nhỏ đậm phía trên, ô nhập chữ thường bên dưới. */
const FIELD_CLASS = 'flex flex-col gap-[0.28rem] text-xs font-bold text-slate-500 [&_input]:font-normal';

/** Dáng ô nhập của `Input`, cho `VnNumberInput` (không đi qua component `Input`). */
const NUMBER_INPUT_CLASS =
  'h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-sm font-normal outline-none placeholder:text-slate-400 focus-visible:border-blue-600 focus-visible:ring-2 focus-visible:ring-blue-100 disabled:bg-slate-100 disabled:opacity-50';

const TRACKING_CARDS: readonly {
  mode: MaterialTrackingMode;
  Icon: typeof QrCode;
  title: string;
  description: string;
  active: string;
  icon: string;
  titleActive: string;
}[] = [
  {
    mode: 'SERIAL',
    Icon: QrCode,
    title: 'Theo Sê-ri (SN)',
    description: 'Mỗi chiếc có số SN riêng biệt (thiết bị, rơ-le, máy biến áp, motor...).',
    active: 'border-2 border-blue-600 bg-blue-50',
    icon: 'text-blue-600',
    titleActive: 'text-blue-700',
  },
  {
    mode: 'LOT',
    Icon: Layers,
    title: 'Theo Lô (Lot/Batch)',
    description: 'Quản lý mẻ/kiện, hạn dùng FEFO, kiểm định (dầu, cáp, hoá chất...).',
    active: 'border-2 border-green-600 bg-green-50',
    icon: 'text-green-600',
    titleActive: 'text-green-700',
  },
  {
    mode: 'NONE',
    Icon: Package,
    title: 'Thông thường',
    description: 'Quản lý tồn thuần túy theo số lượng, không cần định danh chi tiết.',
    active: 'border-2 border-slate-600 bg-slate-50',
    icon: 'text-slate-900',
    titleActive: 'text-slate-900',
  },
];

export type MaterialTrackingMode = 'SERIAL' | 'LOT' | 'NONE';

/** Dịch vụ, phần mềm có trong danh mục để bán nhưng không quản lý tồn (D6). */
const KIND_OPTIONS: { value: MaterialKind; label: string }[] = [
  { value: 'STOCK', label: 'Hàng hoá (quản lý tồn kho)' },
  { value: 'SERVICE', label: 'Dịch vụ (không quản lý tồn)' },
];

/**
 * Form Thêm mới / Chỉnh sửa Vật tư (Chuẩn danh mục Master Data ERP/WMS).
 *
 * Chỉ chịu trách nhiệm khai báo định nghĩa vật tư:
 * - Thông tin SKU: Mã, tên, đơn vị tính, ngưỡng tồn min/max, nhóm vật tư, loại vật tư.
 * - Định dạng quản lý định danh: Theo Sê-ri (Serial), Theo Lô (Lot/Batch), hoặc Thông thường.
 *
 * Nghiệp vụ chuẩn: Việc phát sinh số Lô hàng (Lot Number), Hạn sử dụng, CO/CQ hoặc
 * dán mã Sê-ri cá thể sẽ được thực hiện khi làm phiếu NHẬP KHO thực tế (Goods Receipt).
 */
export function MaterialForm({
  editing,
  units = [],
  types = [],
  catalog,
  busy,
  onCancel,
  onSubmit,
}: {
  editing?: Material;
  /** Danh mục đơn vị tính do admin cấu hình; rỗng thì rơi về ô nhập tự do. */
  units?: readonly string[];
  /** Danh mục loại vật tư / thiết bị do admin cấu hình; tuỳ chọn. */
  types?: readonly string[];
  /** Danh mục phân loại khai trong Cài đặt: nguồn duy nhất của ô Phân loại (hàng hóa và dịch vụ có danh sách riêng). */
  catalog?: InventoryTradeCatalog;
  busy: boolean;
  onCancel: () => void;
  /** Từ chối (reject) khi Kho báo lỗi để form hiện lý do và giữ dữ liệu. */
  onSubmit: (input: CreateMaterialRequest) => Promise<void> | void;
}) {
  const [code, setCode] = useState(editing?.code ?? '');
  const [name, setName] = useState(editing?.name ?? '');
  const [tradeCategory, setTradeCategory] = useState(editing?.tradeCategory ?? '');
  const [type, setType] = useState(editing?.type ?? '');
  const [unit, setUnit] = useState(editing?.unit ?? '');
  const [minStock, setMinStock] = useState(String(editing?.minStock ?? 0));
  const [maxStock, setMaxStock] = useState(String(editing?.maxStock ?? 100));
  const [kind, setKind] = useState<MaterialKind>(editing?.kind ?? 'STOCK');
  const [warrantyMonths, setWarrantyMonths] = useState(
    editing?.warrantyMonths === undefined ? '' : String(editing.warrantyMonths),
  );
  const isService = kind === 'SERVICE';
  // Chuỗi rỗng là chưa khai báo giá, khác hẳn với 0.
  const [purchasePrice, setPurchasePrice] = useState(
    editing?.purchasePrice === undefined ? '' : String(editing.purchasePrice),
  );

  // Xác định phương thức quản lý ban đầu khi sửa hoặc tạo mới
  const initialMode: MaterialTrackingMode = editing?.isSerialized
    ? 'SERIAL'
    : editing?.category === 'CONSUMABLE'
    ? 'LOT'
    : 'NONE';
  const [trackingMode, setTrackingMode] = useState<MaterialTrackingMode>(initialMode);

  // Mỗi nhóm (hàng hóa, dịch vụ) một danh sách phân loại riêng, lấy từ Cài đặt.
  const categoryOptions = useMemo(
    () => withCurrent(categoriesOf(isService ? 'SERVICE' : 'GOODS', catalog), tradeCategory),
    [isService, catalog, tradeCategory],
  );

  const unitOptions = (units.includes(unit) || !unit ? units : [...units, unit]).map((u) => ({
    value: u,
    label: u,
  }));

  const typeOptions = (types.includes(type) || !type ? types : [...types, type]).map((t) => ({
    value: t,
    label: t,
  }));

  const { error, submit: send } = useFormSubmit('Không lưu được vật tư.');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanCode = code.trim().toUpperCase();
    const cleanName = name.trim();
    const cleanUnit = unit.trim();

    if (!cleanCode || !cleanName || !cleanUnit) return;

    // `category` là trường kỹ thuật (theo lô hay không) để thỏa ràng buộc database; không hiện cho người dùng.
    // Phân loại người dùng thấy và chọn là `tradeCategory`, lấy từ Cài đặt.
    const category: MaterialCategory =
      trackingMode === 'LOT' ? 'CONSUMABLE' : 'SPARE_PART';
    const isSerialized = !isService && trackingMode === 'SERIAL';
    const warranty = warrantyMonths.trim();
    const price = purchasePrice.trim() === '' ? undefined : Number(purchasePrice);
    if (price !== undefined && (!Number.isFinite(price) || price < 0)) return;

    void send(() => onSubmit({
      code: cleanCode,
      name: cleanName,
      category,
      tradeCategory: tradeCategory || undefined,
      type: type.trim() || undefined,
      unit: cleanUnit,
      minStock: isService ? 0 : Number(minStock) || 0,
      maxStock: isService ? 0 : Number(maxStock) || 0,
      purchasePrice: price,
      isSerialized,
      kind,
      // Ô trống khi sửa là xoá số tháng đã khai.
      warrantyMonths: warranty ? Math.max(Math.trunc(Number(warranty)) || 0, 0) : editing ? null : undefined,
    }));
  };

  const isDisabled = busy;

  const dirtySnapshot = JSON.stringify([code, name, tradeCategory, type, unit, minStock, maxStock, kind, warrantyMonths, purchasePrice, trackingMode]);
  const [initialSnapshot] = useState(dirtySnapshot);
  const isDirty = dirtySnapshot !== initialSnapshot;

  return (
    <Dialog onEscape={!busy && !isDirty ? onCancel : undefined}>
      <DialogContent className="max-w-[620px]" aria-label={editing ? `Sửa vật tư ${editing.code}` : 'Thêm vật tư mới'}>
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          {/* Header Dialog */}
          <DialogHeader>
            <div>
              <DialogTitle>{editing ? `Sửa vật tư ${editing.code}` : 'Thêm vật tư mới'}</DialogTitle>
              <DialogDescription>
                Khai báo mã SKU, định mức tồn và phương thức quản lý định danh (Sê-ri hoặc Lô).
              </DialogDescription>
            </div>
            <CloseGuard dirty={isDirty} busy={busy} onClose={onCancel}>
              <DialogCloseButton />
            </CloseGuard>
          </DialogHeader>

          {/* Thân Form Dialog */}
          <DialogBody>
            {/* 1. Nhóm thông tin cơ bản của SKU */}
            <div className="mb-[0.6rem] mt-[0.9rem] grid grid-cols-2 gap-x-[1.35rem] gap-y-[1.15rem]">
              <Label className={FIELD_CLASS}>
                Mã SKU / Mã vật tư *
                <Input
                  required
                  readOnly={Boolean(editing)}
                  className="read-only:bg-slate-50 read-only:text-slate-500"
                  placeholder="VD: VT-RO-LE-01, VT-DAU-02…"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
                {editing ? <small className="text-xs font-normal text-slate-500">Mã đã dùng trong sổ cái nên không đổi được.</small> : null}
              </Label>

              <Label className={FIELD_CLASS}>
                Tên vật tư *
                <Input
                  required
                  placeholder="VD: Rơ-le bảo vệ so lệch, Dầu biến áp…"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Label>

              <Label className={FIELD_CLASS}>
                Phân loại
                <SearchableSelect
                  options={categoryOptions}
                  value={tradeCategory}
                  placeholder={
                    categoryOptions.length === 0 ? '— Chưa khai báo trong Cài đặt —' : '— Chọn phân loại —'
                  }
                  emptyText="Chưa khai báo trong Cài đặt"
                  onChange={(val) => setTradeCategory(val || '')}
                  clearable
                  className="w-full"
                />
              </Label>

              <Label className={FIELD_CLASS}>
                Loại vật tư
                {types.length > 0 ? (
                  <SearchableSelect
                    options={typeOptions}
                    value={type}
                    placeholder="— Chọn loại vật tư —"
                    emptyText="Không tìm thấy loại vật tư"
                    onChange={(val) => setType(val)}
                    clearable
                    className="w-full"
                  />
                ) : (
                  <Input
                    placeholder="VD: Thiết bị, Chi tiết, Linh kiện..."
                    value={type}
                    onChange={(event) => setType(event.target.value)}
                  />
                )}
              </Label>

              <Label className={FIELD_CLASS}>
                Đơn vị tính *
                {units.length > 0 ? (
                  <SearchableSelect
                    options={unitOptions}
                    value={unit}
                    placeholder="— Chọn đơn vị —"
                    emptyText="Không tìm thấy đơn vị tính"
                    onChange={(val) => setUnit(val)}
                    clearable
                    className="w-full"
                  />
                ) : (
                  <Input
                    required
                    placeholder="VD: Cái, Bộ, Lít, Cuộn…"
                    value={unit}
                    onChange={(event) => setUnit(event.target.value)}
                  />
                )}
              </Label>

              <Label className={FIELD_CLASS}>
                Loại mặt hàng *
                <SearchableSelect
                  options={KIND_OPTIONS}
                  value={kind}
                  placeholder="Chọn loại mặt hàng"
                  emptyText="Không có loại phù hợp"
                  onChange={(value) => {
                    setKind(value === 'SERVICE' ? 'SERVICE' : 'STOCK');
                    // Hàng hóa và dịch vụ có danh sách phân loại riêng: đổi nhóm thì bỏ phân loại đã chọn.
                    setTradeCategory('');
                  }}
                  className="w-full"
                />
                {isService ? (
                  <small className="text-xs font-normal text-slate-500">Dịch vụ không nhập, xuất kho và không giữ hàng.</small>
                ) : null}
              </Label>

              <Label className={FIELD_CLASS}>
                Bảo hành (tháng)
                <Input
                  type="number"
                  min={0}
                  step={1}
                  placeholder="Bỏ trống nếu chưa khai"
                  value={warrantyMonths}
                  onChange={(event) => setWarrantyMonths(event.target.value)}
                />
              </Label>

              {!isService ? (
                <>
                  <Label className={FIELD_CLASS}>
                    Tồn tối thiểu (Min stock)
                    <Input
                      type="number"
                      min={0}
                      value={minStock}
                      onChange={(event) => setMinStock(event.target.value)}
                    />
                  </Label>

                  <Label className={FIELD_CLASS}>
                    Tồn tối đa (Max stock)
                    <Input
                      type="number"
                      min={0}
                      value={maxStock}
                      onChange={(event) => setMaxStock(event.target.value)}
                    />
                  </Label>
                </>
              ) : null}
              <Label className={FIELD_CLASS}>
                Đơn giá ({currencyLabel(editing?.currency)})
                <VnNumberInput
                  className={NUMBER_INPUT_CLASS}
                  placeholder="Chưa khai báo"
                  value={purchasePrice}
                  onChange={setPurchasePrice}
                />
                {editing?.purchasePrice !== undefined ? (
                  <small className="text-xs font-normal text-slate-500">Đổi sang giá khác được; để trống thì giữ giá hiện tại.</small>
                ) : null}
              </Label>
            </div>

            {/* 2. CHỌN DUY NHẤT 1 PHƯƠNG THỨC QUẢN LÝ (MUTUALLY EXCLUSIVE) */}
            {!isService ? (
            <div className="mt-5">
              <span className="mb-2 block text-sm font-bold text-slate-900">
                Phương thức quản lý định danh vật tư *
              </span>

              <div className="grid grid-cols-3 gap-2.5">
                {TRACKING_CARDS.map(({ mode, Icon, title, description, active, icon, titleActive }) => {
                  const selected = trackingMode === mode;
                  return (
                    <label
                      key={mode}
                      className={cn(
                        'flex flex-col gap-1.5 rounded-lg p-3 transition-all',
                        selected ? active : 'border border-slate-200 bg-white',
                        editing ? 'cursor-not-allowed' : 'cursor-pointer',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="trackingMode"
                          className="accent-primary"
                          disabled={Boolean(editing)}
                          checked={selected}
                          onChange={() => setTrackingMode(mode)}
                        />
                        <Icon size={16} className={selected ? icon : 'text-slate-500'} />
                        <span className={cn('text-sm font-bold', selected ? titleActive : 'text-slate-700')}>
                          {title}
                        </span>
                      </div>
                      <span className="text-xs leading-[1.4] text-slate-500">{description}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            ) : null}

            {/* Thông báo chuẩn nghiệp vụ kho */}
            <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3">
              <Info size={18} className="mt-0.5 shrink-0 text-slate-500" />
              <div className="text-[13px] leading-normal text-slate-600">
                {trackingMode === 'SERIAL' && (
                  <span>
                    Các số Sê-ri (SN) cụ thể của từng cá thể sẽ được ghi nhận và quét mã khi thực hiện{' '}
                    <strong>Phiếu Nhập kho</strong> hoặc cập nhật trong chi tiết vật tư sau này.
                  </span>
                )}
                {trackingMode === 'LOT' && (
                  <span>
                    Chi tiết từng lô hàng (Số lô, Hạn sử dụng, CO/CQ, Nhà cung cấp...) sẽ được khai báo
                    chính xác khi lập <strong>Phiếu Nhập kho</strong> vào kho thực tế.
                  </span>
                )}
                {trackingMode === 'NONE' && (
                  <span>
                    Số lượng nhập, kho lưu trữ và giá trị sẽ được ghi nhận qua các{' '}
                    <strong>Phiếu Nhập kho</strong> thông thường.
                  </span>
                )}
              </div>
            </div>
            <FormError error={error} />
          </DialogBody>

          {/* Footer Dialog Actions */}
          <DialogFooter>
            <CloseGuard dirty={isDirty} busy={busy} onClose={onCancel}>
              <Button type="button" variant="outline" disabled={isDisabled}>
                Huỷ
              </Button>
            </CloseGuard>
            <Button
              type="submit"
              disabled={isDisabled || !code.trim() || !name.trim() || !unit.trim()}
            >
              {isDisabled ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Thêm vật tư'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
