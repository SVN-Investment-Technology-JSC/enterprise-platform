'use client';

import type {
  Asset,
  InstallItemRequest,
  Material,
  MaterialInventory,
  Warehouse,
} from '@enterprise-platform/contracts-inventory';
import { SearchableSelect, CloseGuard } from '@enterprise-platform/shared-ui';
import { useMemo, useState, useRef, useEffect } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { getUnitQuantityConfig } from '../inventory-labels';
import type { LotAllocation } from '../stock-document.model';
import { LotPickerDrawer, SerialPickerDrawer } from './stock-document-parts';
import { FormError, useFormSubmit } from './form-error';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

/** Drawer chọn serial, lô mở chồng lên hộp thoại (`modalOverlay` z-index 1000). */
const PICKER_Z_INDEX = 1100;

/**
 * Lắp vật tư từ kho vào một thiết bị.
 *
 * Đây là một lệnh XUẤT, nên phải biết xuất từ kho nào và bao nhiêu. Mã vật tư
 * không rời khỏi danh mục: lắp 1 mét cáp thì kho còn 2999 mét, vì mét là đơn vị
 * tính chứ không phải một khối cố định.
 *
 * Tồn hiện theo ĐÚNG kho đang chọn, không phải tổng mọi kho. Tổng thì luôn nhìn
 * có vẻ đủ, còn thứ quyết định lệnh xuất có đi được hay không là số nằm trong
 * kho cụ thể đó.
 */
export function InstallMaterialDialog({
  parent,
  materials,
  warehouses,
  stock,
  busy,
  onCancel,
  onConfirm,
}: {
  /** Node cha tiếp nhận. Bỏ trống nếu lắp làm Cụm/Thiết bị gốc trên cây (Root Asset). */
  parent?: Asset;
  materials: readonly Material[];
  warehouses: readonly Warehouse[];
  stock: readonly MaterialInventory[];
  busy?: boolean;
  onCancel: () => void;
  /** Từ chối (reject) khi Kho báo lỗi để form hiện lý do và giữ dữ liệu. */
  onConfirm: (code: string, input: InstallItemRequest) => Promise<void> | void;
}) {
  const { error, submit: send } = useFormSubmit('Không xuất kho và lắp được.');
  const [materialCode, setMaterial] = useState('');
  const [materialSearchTerm, setMaterialSearchTerm] = useState('');
  const [warehouseCode, setWarehouse] = useState(
    warehouses.length === 1 ? warehouses[0].code : '',
  );
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  // Vật tư theo serial phải chỉ đủ serial; vật tư theo lô chọn lô hoặc để máy chủ
  // tự chọn theo FEFO. Đổi vật tư, kho hay số lượng thì chọn lại.
  const [serials, setSerials] = useState<string[]>([]);
  const [lots, setLots] = useState<LotAllocation[]>([]);
  const [picker, setPicker] = useState<'serial' | 'lot'>();
  useEffect(() => {
    setSerials([]);
    setLots([]);
  }, [materialCode, warehouseCode, quantity]);

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  /** Lọc vật tư theo từ khoá nhập (mã hoặc tên) */
  const filteredMaterials = useMemo(() => {
    const term = materialSearchTerm.trim().toLowerCase();
    if (!term) return materials;
    return materials.filter(
      (item) =>
        item.code.toLowerCase().includes(term) ||
        item.name.toLowerCase().includes(term) ||
        (item.unit ?? '').toLowerCase().includes(term),
    );
  }, [materials, materialSearchTerm]);

  // Đóng dropdown khi click ra ngoài
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /** Tồn khả dụng theo cặp (mã vật tư, mã kho). */
  const onHand = useMemo(() => {
    const materialById = new Map(materials.map((item) => [item.id, item.code]));
    const warehouseById = new Map(warehouses.map((item) => [item.id, item.code]));
    const map = new Map<string, number>();
    for (const row of stock) {
      const code = materialById.get(row.materialId);
      const warehouse = warehouseById.get(row.warehouseId);
      if (!code || !warehouse) continue;
      const key = `${code}@${warehouse}`;
      map.set(key, (map.get(key) ?? 0) + row.available);
    }
    return map;
  }, [materials, warehouses, stock]);

  const picked = materials.find((item) => item.code === materialCode);
  const unitConfig = getUnitQuantityConfig(picked?.unit);

  /** Danh sách kho khả dụng (tồn khả dụng > 0 đối với vật tư đã chọn) */
  const availableWarehouses = useMemo(() => {
    if (!materialCode) return warehouses;
    return warehouses
      .map((w) => ({
        ...w,
        availableStock: onHand.get(`${materialCode}@${w.code}`) ?? 0,
      }))
      .filter((w) => w.availableStock > 0);
  }, [warehouses, materialCode, onHand]);

  const warehouseOptions = useMemo(() => {
    return availableWarehouses.map((w) => {
      const stockQty = 'availableStock' in w ? (w.availableStock as number) : undefined;
      return {
        value: w.code,
        label: w.name,
        badge: w.code,
        description:
          stockQty !== undefined
            ? `Tồn khả dụng: ${stockQty} ${picked?.unit ?? ''}`
            : undefined,
      };
    });
  }, [availableWarehouses, picked?.unit]);

  const available =
    materialCode && warehouseCode ? (onHand.get(`${materialCode}@${warehouseCode}`) ?? 0) : undefined;

  const handleSelectMaterial = (code: string) => {
    setMaterial(code);
    if (!code) {
      setWarehouse('');
      return;
    }
    // Tự động chọn kho đầu tiên còn hàng khả dụng
    const validWh = warehouses
      .map((w) => ({ code: w.code, stock: onHand.get(`${code}@${w.code}`) ?? 0 }))
      .filter((w) => w.stock > 0);
    if (validWh.length > 0) {
      setWarehouse(validWh[0].code);
    } else {
      setWarehouse('');
    }
  };

  const amount = Number(quantity);
  const valid = Number.isFinite(amount) && amount > 0;
  const short = available !== undefined && valid && amount > available;
  const serialized = Boolean(picked?.isSerialized);
  const serialsMissing = serialized && serials.length !== amount;
  const ready = materialCode !== '' && warehouseCode !== '' && valid && !short && !serialsMissing;
  const pickedWarehouse = warehouses.find((item) => item.code === warehouseCode);

  const dirtySnapshot = JSON.stringify([materialCode, warehouseCode, quantity, note, serials, lots]);
  const [initialSnapshot] = useState(dirtySnapshot);
  const isDirty = dirtySnapshot !== initialSnapshot;

  const dialogTitle = parent ? 'Lắp vật tư vào thiết bị' : 'Xuất kho thiết bị / Cụm gốc';

  return (
    <Dialog onEscape={!busy && !isDirty ? onCancel : undefined}>
      <DialogContent className="max-w-[580px]" aria-label={dialogTitle}>
        <DialogHeader>
          <div>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>
              {parent ? (
                <>Xuất vật tư từ kho và lắp ráp trực tiếp vào cụm <strong>{parent.name}</strong> ({parent.code}).</>
              ) : (
                <>Xuất vật tư/thiết bị từ kho và đưa lên làm <strong>Thiết bị / Cụm gốc cấp cao nhất</strong> trên cây tài sản.</>
              )}
            </DialogDescription>
          </div>
          <CloseGuard dirty={isDirty} busy={busy} onClose={onCancel}>
            <DialogCloseButton />
          </CloseGuard>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!ready) return;
            void send(() => onConfirm(materialCode, {
              parentCode: parent?.code,
              warehouseCode,
              quantity: amount,
              note: note.trim() || undefined,
              serials: serialized ? serials : undefined,
              lots: !serialized && lots.length > 0
                ? lots.map((lot) => ({ lotNo: lot.lotNo, quantity: lot.quantity }))
                : undefined,
            }));
          }}
          className="flex min-h-0 flex-col"
        >
          <DialogBody className="flex flex-col gap-3.5">
          {/* Thiết bị đích nhận lắp đặt */}
          <div className="flex flex-col gap-[5px]">
            <Label>Vị trí tiếp nhận trên cây</Label>
            <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900">
              {parent ? (
                <span>
                  <strong>{parent.name}</strong> <code className="text-blue-600">({parent.code})</code>
                </span>
              ) : (
                <span className="font-semibold text-emerald-700">
                  Là Thiết bị / Cụm gốc (Root Node - Cấp cao nhất)
                </span>
              )}
            </div>
          </div>

          {/* Chọn Vật tư từ kho — Searchable Combobox (Input & Dropdown kết hợp chung 1 element) */}
          <div className="flex flex-col gap-1.5" ref={dropdownRef}>
            <div className="flex items-center justify-between">
              <Label required>Vật tư cần lắp</Label>
              <span className="text-[13px] text-slate-500">
                {filteredMaterials.length} / {materials.length} vật tư
              </span>
            </div>

            {/* Khung Combobox duy nhất kết hợp Input tìm kiếm và Dropdown lựa chọn */}
            <div className="relative">
              <div
                className={cn(
                  'flex items-center rounded-md border bg-white py-0.5 pl-2.5 pr-2 transition-all',
                  isDropdownOpen ? 'border-blue-600 ring-2 ring-blue-100' : 'border-slate-300',
                )}
              >
                <Search size={15} className="mr-1.5 shrink-0 text-slate-400" />
                <Input
                  type="text"
                  className="h-auto rounded-none border-0 bg-transparent px-0 py-1.5 focus-visible:border-0 focus-visible:ring-0"
                  placeholder={picked ? `${picked.name} (${picked.code})` : 'Gõ mã hoặc tên vật tư để tìm & chọn…'}
                  value={materialSearchTerm}
                  onFocus={() => setIsDropdownOpen(true)}
                  onChange={(e) => {
                    setMaterialSearchTerm(e.target.value);
                    if (!isDropdownOpen) setIsDropdownOpen(true);
                  }}
                />
                {materialSearchTerm || materialCode ? (
                  <button
                    type="button"
                    className="flex cursor-pointer items-center border-0 bg-transparent p-1 text-slate-400"
                    onClick={() => {
                      setMaterialSearchTerm('');
                      handleSelectMaterial('');
                    }}
                  >
                    <X size={14} />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="flex cursor-pointer items-center border-0 bg-transparent p-1 text-slate-500"
                  onClick={() => setIsDropdownOpen((prev) => !prev)}
                >
                  <ChevronDown
                    size={16}
                    className={cn('transition-transform duration-200', isDropdownOpen && 'rotate-180')}
                  />
                </button>
              </div>

              {/* Danh sách dropdown kết quả thả xuống */}
              {isDropdownOpen ? (
                <div className="absolute inset-x-0 top-[calc(100%+4px)] z-50 max-h-[220px] overflow-y-auto rounded-md border border-slate-300 bg-white shadow-lg">
                  {filteredMaterials.length === 0 ? (
                    <div className="px-3.5 py-3 text-center text-sm text-slate-400">
                      Không tìm thấy vật tư khớp với từ khóa
                    </div>
                  ) : (
                    filteredMaterials.map((item) => {
                      const isSelected = item.code === materialCode;
                      return (
                        <div
                          key={item.code}
                          className={cn(
                            'flex cursor-pointer items-center justify-between border-b border-slate-100 px-3 py-2 text-sm transition-colors',
                            isSelected ? 'bg-blue-50 text-blue-700' : 'bg-white text-slate-900 hover:bg-slate-50',
                          )}
                          onClick={() => {
                            handleSelectMaterial(item.code);
                            setMaterialSearchTerm(`${item.name} (${item.code})`);
                            setIsDropdownOpen(false);
                          }}
                        >
                          <div>
                            <span className="font-semibold">{item.name}</span>
                            <span className="ml-1.5 text-[13px] text-blue-600">
                              ({item.code})
                            </span>
                          </div>
                          <span className="text-xs text-slate-500">ĐVT: {item.unit}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : null}
            </div>

            {/* Input ẩn để đảm bảo form validation HTML5 required */}
            <Input
              type="text"
              required
              value={materialCode}
              onChange={() => undefined}
              className="pointer-events-none absolute size-0 border-0 p-0 opacity-0"
            />
          </div>

          {/* Hàng 2 cột: Kho xuất & Số lượng */}
          <div className="grid grid-cols-2 gap-3.5">
            <div className="flex flex-col gap-[5px]">
              <Label required className="whitespace-nowrap">Xuất từ kho</Label>
              <SearchableSelect
                options={warehouseOptions}
                value={warehouseCode}
                placeholder={
                  availableWarehouses.length === 0 && materialCode
                    ? '— Hết hàng ở tất cả các kho —'
                    : 'Tìm mã hoặc tên kho xuất…'
                }
                emptyText="Không tìm thấy kho phù hợp"
                disabled={availableWarehouses.length === 0}
                onChange={(val) => setWarehouse(val)}
                clearable
                style={{ width: '100%' }}
              />
            </div>

            <div className="flex flex-col gap-[5px]">
              <div className="flex min-h-5 items-center justify-between gap-1.5">
                <Label required className="whitespace-nowrap">
                  Số lượng {picked?.unit ? `(${picked.unit})` : ''}
                </Label>
                {available !== undefined ? (
                  <span
                    className={cn(
                      'whitespace-nowrap text-[13px] font-semibold',
                      short ? 'text-red-600' : 'text-green-800',
                    )}
                  >
                    (Khả dụng: {available} {picked?.unit ?? ''})
                  </span>
                ) : null}
              </div>
              <Input
                type="number"
                min={unitConfig.min}
                step={unitConfig.step}
                className={cn(short && 'border-red-500')}
                required
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </div>
          </div>

          {/* Serial hoặc lô xuất lắp: theo đúng sổ kho, như chứng từ xuất */}
          {materialCode && warehouseCode && valid ? (
            <div className="flex flex-col gap-[5px]">
              <Label required={serialized}>{serialized ? 'Serial lắp' : 'Lô xuất'}</Label>
              <div className="flex flex-wrap items-center gap-2.5">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPicker(serialized ? 'serial' : 'lot')}
                >
                  {serialized ? `Chọn serial (${serials.length}/${amount})` : 'Chọn lô'}
                </Button>
                <span className={cn('text-[13px]', serialsMissing ? 'text-red-700' : 'text-slate-600')}>
                  {serialized
                    ? serials.length > 0
                      ? serials.join(', ')
                      : `Vật tư theo dõi theo serial: chọn đủ ${amount} serial đang trong kho ${warehouseCode}.`
                    : lots.length > 0
                      ? lots.map((lot) => `${lot.lotNo}: ${lot.quantity}`).join('; ')
                      : 'Không chọn lô: nếu vật tư quản lý theo lô, hệ thống tự lấy lô hạn dùng gần nhất trước (FEFO).'}
                </span>
              </div>
            </div>
          ) : null}

          {/* Cảnh báo thiếu tồn (Chỉ hiện khi vượt quá khả dụng) */}
          {short ? (
            <div className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] leading-[1.4] text-red-700">
              <span></span>
              <span>
                Kho <strong>{warehouseCode}</strong> chỉ còn khả dụng <strong>{available} {picked?.unit ?? ''}</strong> (Không đủ xuất {amount} {picked?.unit ?? ''}).
              </span>
            </div>
          ) : null}

          {/* Ghi chú */}
          <div className="flex flex-col gap-[5px]">
            <Label>Ghi chú lắp đặt</Label>
            <Input
              value={note}
              placeholder="VD: Lắp vào ngăn xuất tuyến 110kV, bảo dưỡng thay mới định kỳ…"
              onChange={(event) => setNote(event.target.value)}
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
              {busy ? 'Đang xuất kho…' : 'Xác nhận xuất kho & lắp'}
            </Button>
          </DialogFooter>
        </form>
      {picker === 'serial' && picked ? (
        <div onClick={(event) => event.stopPropagation()}>
          <SerialPickerDrawer
            open
            materialCode={picked.code}
            materialName={picked.name}
            warehouse={pickedWarehouse}
            quantity={amount}
            value={serials}
            inbound={false}
            zIndex={PICKER_Z_INDEX}
            onApply={(next) => {
              setSerials(next);
              setPicker(undefined);
            }}
            onClose={() => setPicker(undefined)}
          />
        </div>
      ) : null}
      {picker === 'lot' && picked ? (
        <div onClick={(event) => event.stopPropagation()}>
          <LotPickerDrawer
            open
            materialCode={picked.code}
            warehouseCode={warehouseCode}
            quantity={amount}
            unit={picked.unit}
            current={lots.length === 1 ? lots[0].lotNo : undefined}
            zIndex={PICKER_Z_INDEX}
            onApply={(allocations) => {
              setLots(allocations);
              setPicker(undefined);
            }}
            onClose={() => setPicker(undefined)}
          />
        </div>
      ) : null}
      </DialogContent>
    </Dialog>
  );
}
