'use client';

import type { ReturnItemToStockRequest, Warehouse } from '@enterprise-platform/contracts-inventory';
import { SearchableSelect, CloseGuard } from '@enterprise-platform/shared-ui';
import { AlertTriangle } from 'lucide-react';
import { useState, useMemo } from 'react';
import type { ProcedureOption } from '../inventory-api';
import { getUnitQuantityConfig } from '../inventory-labels';
import { SerialPickerDrawer } from './stock-document-parts';
import { FormError, useFormSubmit } from './form-error';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

export interface ReturnToStockInput extends ReturnItemToStockRequest {
  readonly procedureDefinitionId?: string;
}

/**
 * Thanh lý hoặc tháo dỡ một vật tư / thiết bị khỏi cây lắp đặt.
 *
 * Thanh lý ở đây KHÔNG phải xoá. Hàng đã vào sổ kho thì chỉ có nhập hoặc xuất —
 * mã vật tư và toàn bộ lịch sử của nó luôn ở lại. Tháo một thiết bị xuống là
 * một lệnh NHẬP: hiện vật rời khỏi vị trí lắp đặt và về nằm trong một kho.
 *
 * Vì vậy kho tiếp nhận là bắt buộc, không có kho mặc định. Đoán một kho thay
 * người bấm nghĩa là ghi tăng tồn ở nơi hiện vật không hề có mặt, và sai lệch
 * đó chỉ lộ ra ở kỳ kiểm kê sau.
 */
export function ReturnToStockDialog({
  title,
  description,
  unit,
  maxQuantity,
  isAsset = false,
  warehouses,
  procedures = [],
  hasChildren = false,
  serialMaterialCode,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  /** Đơn vị tính, để hiện cạnh ô số lượng. */
  unit?: string;
  /** Trần cho ô số lượng: số đang lắp trên thiết bị. Bỏ trống là không chặn. */
  maxQuantity?: number;
  /** Là cá thể thiết bị tài sản (số lượng cố định là 1) */
  isAsset?: boolean;
  warehouses: readonly Warehouse[];
  procedures?: readonly ProcedureOption[];
  hasChildren?: boolean;
  /**
   * Mã vật tư theo dõi theo serial đang nhập về: bắt buộc ghi đủ serial (số
   * serial bằng số lượng), máy chủ kiểm serial đúng là serial đã lắp.
   */
  serialMaterialCode?: string;
  busy?: boolean;
  onCancel: () => void;
  /** Từ chối (reject) khi Kho báo lỗi để form hiện lý do và giữ dữ liệu. */
  onConfirm: (input: ReturnToStockInput) => Promise<void> | void;
}) {
  // Một kho thì chọn sẵn — vẫn là lựa chọn có ý thức vì nó hiện rõ trên màn
  // hình, chỉ là không bắt bấm thêm một lần cho một phương án duy nhất.
  const [warehouseCode, setWarehouse] = useState(
    warehouses.length === 1 ? warehouses[0].code : '',
  );
  // Khởi tạo số lượng: nếu là thiết bị cá thể thì là 1, nếu có maxQuantity thì mặc định dỡ toàn bộ số lượng đang lắp
  const [quantity, setQuantity] = useState(() =>
    isAsset ? '1' : maxQuantity !== undefined ? String(maxQuantity) : '1',
  );
  const [note, setNote] = useState('');
  const [procedureDefinitionId, setProcedureDefinitionId] = useState('');
  const { error, submit: send } = useFormSubmit('Không nhập về kho được.');
  const [serials, setSerials] = useState<string[]>([]);
  const [serialPickerOpen, setSerialPickerOpen] = useState(false);

  const warehouseOptions = useMemo(
    () =>
      warehouses.map((w) => ({
        value: w.code,
        label: w.name,
        badge: w.code,
      })),
    [warehouses],
  );

  const procedureOptions = useMemo(
    () =>
      procedures.map((p) => ({
        value: p.id,
        label: `${p.code} · ${p.name}`,
        badge: p.code,
      })),
    [procedures],
  );

  const unitConfig = getUnitQuantityConfig(unit);
  const amount = Number(quantity);
  const valid = Number.isFinite(amount) && amount > 0;
  const over = maxQuantity !== undefined && valid && amount > maxQuantity;
  const serialsMissing = Boolean(serialMaterialCode) && serials.length !== amount;
  const ready = warehouseCode !== '' && valid && !over && !serialsMissing;

  const dirtySnapshot = JSON.stringify([warehouseCode, quantity, note, procedureDefinitionId, serials]);
  const [initialSnapshot] = useState(dirtySnapshot);
  const isDirty = dirtySnapshot !== initialSnapshot;

  return (
    <Dialog onEscape={!busy && !isDirty ? onCancel : undefined}>
      <DialogContent className="max-w-[560px]" aria-label={title}>
        <DialogHeader>
          <div>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </div>
          <CloseGuard dirty={isDirty} busy={busy} onClose={onCancel}>
            <DialogCloseButton />
          </CloseGuard>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!ready) return;
            void send(() => onConfirm({
              warehouseCode,
              quantity: amount,
              note: note.trim() || undefined,
              procedureDefinitionId: procedureDefinitionId || undefined,
              serials: serialMaterialCode ? serials : undefined,
            }));
          }}
          className="flex min-h-0 flex-col"
        >
          <DialogBody className="flex flex-col gap-3.5">
          {/* Cảnh báo khi tháo gỡ cụm thiết bị có nhánh con */}
          {hasChildren ? (
            <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-700">
              <AlertTriangle size={18} color="#b45309" className="shrink-0" />
              <span>
                <strong>Cảnh báo gỡ cụm thiết bị:</strong> Thiết bị này đang chứa các thiết bị/chi tiết con. Việc tháo dỡ sẽ gỡ toàn bộ cấu trúc nhánh con bên dưới khỏi cây vận hành.
              </span>
            </div>
          ) : null}

          {/* Serial nhập về: vật tư theo serial phải ghi đủ serial */}
          {serialMaterialCode ? (
            <div className="flex flex-col gap-[5px]">
              <Label required>Serial nhập về</Label>
              <div className="flex flex-wrap items-center gap-2.5">
                <Button type="button" variant="outline" onClick={() => setSerialPickerOpen(true)}>
                  {`Ghi serial (${serials.length}/${valid ? amount : 0})`}
                </Button>
                <span className={cn('text-[13px]', serialsMissing ? 'text-red-700' : 'text-slate-600')}>
                  {serials.length > 0
                    ? serials.join(', ')
                    : `${serialMaterialCode} theo dõi theo serial: quét hoặc gõ đủ serial của hàng nhập về.`}
                </span>
              </div>
            </div>
          ) : null}

          {/* Hàng 2 cột: Kho tiếp nhận & Số lượng */}
          <div className="grid grid-cols-[1.15fr_0.85fr] items-start gap-3.5">
            <div className="flex flex-col gap-1.5">
              <Label required className="flex min-h-5 items-center whitespace-nowrap">
                Kho tiếp nhận
              </Label>
              <SearchableSelect
                options={warehouseOptions}
                value={warehouseCode}
                placeholder="— Chọn kho tiếp nhận —"
                searchPlaceholder="Tìm mã hoặc tên kho…"
                emptyText="Không tìm thấy kho phù hợp"
                onChange={(val) => setWarehouse(val)}
                clearable
                style={{ width: '100%' }}
              />
            </div>

            {isAsset ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex min-h-5 items-center justify-between gap-1.5">
                  <Label className="whitespace-nowrap">Số lượng tháo dỡ</Label>
                  <span className="whitespace-nowrap rounded bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">
                    1 cá thể trên cây
                  </span>
                </div>
                <div className="box-border flex h-[38px] items-center justify-between rounded-md border border-slate-300 bg-slate-50 px-3 text-sm font-semibold text-slate-900">
                  <span>1 {unit || 'thiết bị'}</span>
                  <span className="text-[13px] font-medium text-slate-500">Cố định</span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <div className="flex min-h-5 items-center justify-between gap-1.5">
                  <Label required className="whitespace-nowrap">
                    Số lượng {unit ? `(${unit})` : ''}
                  </Label>
                  {maxQuantity !== undefined ? (
                    <span className="whitespace-nowrap text-[13px] font-semibold text-sky-700">
                      (Đang lắp: {maxQuantity} {unit ?? ''})
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min={unitConfig.min}
                    max={maxQuantity}
                    step={unitConfig.step}
                    className={cn('flex-1', over && 'border-red-500')}
                    required
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                  />
                  {maxQuantity !== undefined && Number(quantity) !== maxQuantity ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-9 whitespace-nowrap px-2.5 text-[13px] font-semibold"
                      onClick={() => setQuantity(String(maxQuantity))}
                      title="Dỡ toàn bộ số lượng đang lắp đặt"
                    >
                      Dỡ hết ({maxQuantity})
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          {/* Cảnh báo số lượng vượt quá đang lắp */}
          {over ? (
            <div className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] leading-[1.4] text-red-700">
              <span></span>
              <span>
                Chỉ đang lắp <strong>{maxQuantity} {unit ?? ''}</strong> trên thiết bị — không thể tháo/gỡ {amount} {unit ?? ''}.
              </span>
            </div>
          ) : null}

          {/* Quy trình liên kết mở Work Order */}
          <div className="flex flex-col gap-[5px]">
            <Label>Quy trình liên kết mở Work Order</Label>
            <SearchableSelect
              options={procedureOptions}
              value={procedureDefinitionId}
              placeholder={
                procedures.length === 0
                  ? '— Không có quy trình —'
                  : 'Tìm hoặc chọn quy trình mở Work Order (không bắt buộc)…'
              }
              emptyText="Không tìm thấy quy trình phù hợp"
              disabled={procedures.length === 0}
              onChange={(val) => setProcedureDefinitionId(val)}
              clearable
              style={{ width: '100%' }}
            />
            <span className="text-[13px] text-slate-500">
              Tự động khởi tạo Work Order bên module Quy trình khi hoàn tất lệnh tháo dỡ / hoàn kho.
            </span>
          </div>

          {/* Ghi chú */}
          <div className="flex flex-col gap-1.5">
            <Label>Ghi chú hoàn kho</Label>
            <Input
              value={note}
              placeholder="Lý do tháo gỡ, tình trạng thiết bị khi nhập về kho…"
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
            <Button type="submit" variant="destructive" disabled={busy || !ready}>
              {busy ? 'Đang hoàn kho…' : 'Xác nhận nhập về kho'}
            </Button>
          </DialogFooter>
        </form>
      {serialPickerOpen && serialMaterialCode ? (
        <div onClick={(event) => event.stopPropagation()}>
          <SerialPickerDrawer
            open
            materialCode={serialMaterialCode}
            quantity={valid ? amount : 0}
            value={serials}
            inbound
            zIndex={1100}
            onApply={(next) => {
              setSerials(next);
              setSerialPickerOpen(false);
            }}
            onClose={() => setSerialPickerOpen(false)}
          />
        </div>
      ) : null}
      </DialogContent>
    </Dialog>
  );
}
