'use client';

import type { Asset, Warehouse } from '@enterprise-platform/contracts-inventory';
import { SearchableSelect, CloseGuard } from '@enterprise-platform/shared-ui';
import { AlertTriangle, Trash2, Warehouse as WarehouseIcon } from 'lucide-react';
import { useState, useMemo } from 'react';
import { FormError, useFormSubmit } from './form-error';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableWrap } from '../ui/table';
import { Dialog, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

export interface BulkReturnItemEntry {
  asset: Asset;
  warehouseCode: string;
  note: string;
}

export interface BulkReturnToStockDialogProps {
  assets: readonly Asset[];
  warehouses: readonly Warehouse[];
  busy?: boolean;
  onCancel: () => void;
  /** Từ chối (reject) khi Kho báo lỗi để hộp thoại hiện lý do và giữ danh sách. */
  onConfirm: (entries: BulkReturnItemEntry[]) => Promise<void> | void;
}

export function BulkReturnToStockDialog({
  assets: initialAssets,
  warehouses,
  busy = false,
  onCancel,
  onConfirm,
}: BulkReturnToStockDialogProps) {
  // Trạng thái danh sách thiết bị trong phiên gỡ hàng loạt
  const [items, setItems] = useState<BulkReturnItemEntry[]>(() => {
    const defaultWh = warehouses.length === 1 ? warehouses[0].code : '';
    return initialAssets.map((asset) => ({
      asset,
      warehouseCode: defaultWh,
      note: '',
    }));
  });

  // Áp dụng kho hàng loạt
  const [globalWarehouse, setGlobalWarehouse] = useState<string>(
    warehouses.length === 1 ? warehouses[0].code : '',
  );

  const warehouseOptions = useMemo(
    () =>
      warehouses.map((wh) => ({
        value: wh.code,
        label: `${wh.name} (${wh.code})`,
      })),
    [warehouses],
  );

  const handleApplyGlobalWarehouse = (whCode: string) => {
    setGlobalWarehouse(whCode);
    if (!whCode) return;
    setItems((prev) =>
      prev.map((item) => ({
        ...item,
        warehouseCode: whCode,
      })),
    );
  };

  const handleUpdateWarehouse = (assetId: string, warehouseCode: string) => {
    setItems((prev) =>
      prev.map((item) => (item.asset.id === assetId ? { ...item, warehouseCode } : item)),
    );
  };

  const handleUpdateNote = (assetId: string, note: string) => {
    setItems((prev) =>
      prev.map((item) => (item.asset.id === assetId ? { ...item, note } : item)),
    );
  };

  const handleRemoveItem = (assetId: string) => {
    setItems((prev) => prev.filter((item) => item.asset.id !== assetId));
  };

  // Kiểm tra điều kiện hoàn tất: tất cả thiết bị đều phải chọn kho
  const hasMissingWarehouse = items.some((item) => !item.warehouseCode);
  const isValid = items.length > 0 && !hasMissingWarehouse;

  const { error, submit: send } = useFormSubmit('Không tháo dỡ được thiết bị.');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || busy) return;
    void send(() => onConfirm(items));
  };

  const dirtySnapshot = JSON.stringify([items.map((item) => [item.asset.code, item.warehouseCode, item.note]), globalWarehouse]);
  const [initialSnapshot] = useState(dirtySnapshot);
  const isDirty = dirtySnapshot !== initialSnapshot;

  return (
    <Dialog onEscape={!busy && !isDirty ? onCancel : undefined}>
      <DialogContent className="max-w-240" aria-label="Tháo dỡ thiết bị hàng loạt">
        {/* Tiêu đề Modal */}
        <DialogHeader>
          <div>
            <DialogTitle>Tháo dỡ / Gỡ thiết bị hàng loạt ({items.length} thiết bị)</DialogTitle>
            <p className="mb-0 mt-1 text-sm text-slate-500">
              Tháo dỡ các thiết bị đã chọn khỏi cây tài sản và nhập về các kho tương ứng. Thao tác này sẽ ghi nhận các bút toán nhập kho thực tế.
            </p>
          </div>
          <CloseGuard dirty={isDirty} busy={busy} onClose={onCancel}>
            <DialogCloseButton disabled={busy} />
          </CloseGuard>
        </DialogHeader>

        {/* Thanh công cụ áp dụng nhanh kho chung */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3">
          <div className="flex min-w-[320px] flex-1 items-center gap-2">
            <WarehouseIcon size={16} className="shrink-0 text-slate-600" />
            <span className="whitespace-nowrap text-[13px] font-semibold text-slate-700">
              Áp dụng kho chung cho tất cả dòng:
            </span>
            <div className="max-w-[280px] flex-1">
              <SearchableSelect
                value={globalWarehouse}
                onChange={handleApplyGlobalWarehouse}
                options={warehouseOptions}
                placeholder="-- Chọn kho áp dụng chung --"
                disabled={busy}
              />
            </div>
          </div>

          <div className="text-[13px] text-slate-500">
            Tổng số: <strong className="text-slate-900">{items.length}</strong> thiết bị
          </div>
        </div>

        {/* Cảnh báo nếu có thiết bị chưa chọn kho */}
        {hasMissingWarehouse && items.length > 0 ? (
          <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50 px-5 py-2 text-[13px] text-amber-700">
            <AlertTriangle size={15} className="shrink-0" />
            <span>Mỗi thiết bị cần được chỉ định rõ kho tiếp nhận để ghi tăng tồn thực tế.</span>
          </div>
        ) : null}

        {/* Bảng danh sách thiết bị cần gỡ */}
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <TableWrap className="max-h-[calc(90vh-240px)] flex-1 px-5">
            {items.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-slate-400">
                Đã xoá hết thiết bị khỏi danh sách gỡ. Vui lòng đóng hộp thoại hoặc quay lại bảng chọn thiết bị.
              </div>
            ) : (
              <Table className="mb-4 mt-3 text-[13px]">
                <TableHead className="text-slate-500">
                  <tr>
                    <TableHeaderCell className="w-10 px-2.5 py-2 text-center">STT</TableHeaderCell>
                    <TableHeaderCell className="w-60 px-3 py-2">Thiết bị / Tài sản</TableHeaderCell>
                    <TableHeaderCell className="w-[260px] px-3 py-2">
                      Kho tiếp nhận <span className="text-red-500">*</span>
                    </TableHeaderCell>
                    <TableHeaderCell className="px-3 py-2">Ghi chú tháo dỡ</TableHeaderCell>
                    <TableHeaderCell className="w-[50px] px-2.5 py-2 text-center">Xoá</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {items.map((item, idx) => {
                    const isMissing = !item.warehouseCode;
                    return (
                      <TableRow key={item.asset.id} className={isMissing ? 'bg-amber-50/40' : 'bg-white'}>
                        <TableCell className="px-2 py-2.5 text-center text-slate-500">{idx + 1}</TableCell>
                        <TableCell className="px-3 py-2.5">
                          <div className="font-semibold text-slate-900">{item.asset.name}</div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            <code className="rounded-[3px] bg-slate-100 px-[5px] py-px">{item.asset.code}</code>
                            {item.asset.serialNumber ? ` · S/N: ${item.asset.serialNumber}` : ''}
                          </div>
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <SearchableSelect
                            value={item.warehouseCode}
                            onChange={(code) => handleUpdateWarehouse(item.asset.id, code)}
                            options={warehouseOptions}
                            placeholder="-- Chọn kho tiếp nhận --"
                            disabled={busy}
                          />
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <Input
                            type="text"
                            value={item.note}
                            onChange={(e) => handleUpdateNote(item.asset.id, e.target.value)}
                            placeholder="Nhập ghi chú hoặc lý do tháo dỡ..."
                            disabled={busy}
                            className="h-8 text-[13px]"
                          />
                        </TableCell>
                        <TableCell className="px-2.5 py-2 text-center">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            title="Loại bỏ thiết bị này khỏi danh sách gỡ"
                            disabled={busy}
                            onClick={() => handleRemoveItem(item.asset.id)}
                            className="text-slate-400 hover:bg-transparent hover:text-red-500"
                          >
                            <Trash2 size={15} />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </TableWrap>

          {/* Modal Footer */}
          <FormError error={error} style={{ margin: '0 20px 12px' }} />
          <DialogFooter className="justify-between">
            <div className="text-[13px] text-slate-500">
              {hasMissingWarehouse && items.length > 0 ? (
                <span className="font-medium text-red-600">
                  Vui lòng chọn kho tiếp nhận cho toàn bộ {items.length} thiết bị trước khi xác nhận.
                </span>
              ) : items.length > 0 ? (
                <span className="font-medium text-green-700">
                  Đã sẵn sàng tháo dỡ {items.length} thiết bị về các kho tương ứng.
                </span>
              ) : null}
            </div>

            <div className="flex gap-2">
              <CloseGuard dirty={isDirty} busy={busy} onClose={onCancel}>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                >
                  Huỷ bỏ
                </Button>
              </CloseGuard>
              <Button type="submit" variant="destructive" disabled={!isValid || busy}>
                {busy ? 'Đang thực hiện...' : `Xác nhận tháo dỡ (${items.length} thiết bị)`}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
