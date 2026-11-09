'use client';

import { useState, useMemo } from 'react';
import { CheckCircle2, AlertTriangle, Layers, PackageCheck } from 'lucide-react';
import { VnNumberInput, CloseGuard, SearchableSelect } from '@enterprise-platform/shared-ui';
import type { InventoryWorkspace, ProcedureRequisition } from '../inventory-api';
import { issueStock, installItem, markRequisitionFulfilled } from '../inventory-api';
import { formatNumber, getUnitQuantityConfig } from '../inventory-labels';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { Label } from '../ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../ui/table';
import { Textarea } from '../ui/textarea';
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

export interface BatchItemState {
  materialCode: string;
  materialName: string;
  quantity: number;
  unit: string;
  warehouseCode: string;
}

export function BatchRequisitionModal({
  req,
  workspace,
  busy = false,
  onClose,
  onSuccess,
}: {
  req: ProcedureRequisition;
  workspace: InventoryWorkspace;
  busy?: boolean;
  onClose: () => void;
  onSuccess: (message: string, reqCode?: string) => void;
}) {
  const defaultWarehouse = workspace.warehouses[0]?.code ?? '';
  const initialAssetCode = req.assetCode || '';
  const [isAssignToAsset, setIsAssignToAsset] = useState<boolean>(true);
  const [selectedAssetCode, setSelectedAssetCode] = useState<string>(initialAssetCode);

  /**
   * Tính toán tình trạng đáp ứng 3 màu cho toàn phiếu:
   * 1. singleCount (Xanh): có 1 kho đơn lẻ đủ xuất ngay toàn bộ.
   * 2. transferCount (Vàng): tổng tồn các kho gộp lại đủ, nhưng cần gom/chuyển kho.
   * 3. shortageCount (Đỏ): tổng tồn toàn hệ thống không đủ (thiếu hàng, cần mua bổ sung).
   */
  const stockSummary = useMemo(() => {
    let singleCount = 0;
    let transferCount = 0;
    let shortageCount = 0;

    for (const line of req.lines) {
      const matchingStocks = workspace.stock.filter((s) => s.materialCode === line.materialCode);
      const totalAvail = matchingStocks.reduce((sum, s) => sum + s.available, 0);
      const singleWh = matchingStocks.some((s) => s.available >= line.quantity);

      if (totalAvail >= line.quantity) {
        if (singleWh) singleCount++;
        else transferCount++;
      } else {
        shortageCount++;
      }
    }

    return {
      singleCount,
      transferCount,
      shortageCount,
      totalLines: req.lines.length,
      allReady: singleCount === req.lines.length && req.lines.length > 0,
    };
  }, [req.lines, workspace.stock]);

  // Khởi tạo danh sách vật tư kèm kho xuất tối ưu nhất
  const [items, setItems] = useState<BatchItemState[]>(() => {
    return req.lines.map((line) => {
      // Ưu tiên chọn kho có tồn khả dụng >= số lượng yêu cầu
      let initialWh = defaultWarehouse;
      const whWithEnoughStock = workspace.stock.find(
        (s) => s.materialCode === line.materialCode && s.available >= line.quantity,
      );
      const whWithAnyStock = workspace.stock.find(
        (s) => s.materialCode === line.materialCode && s.available > 0,
      );

      if (whWithEnoughStock?.warehouseCode) {
        initialWh = whWithEnoughStock.warehouseCode;
      } else if (whWithAnyStock?.warehouseCode) {
        initialWh = whWithAnyStock.warehouseCode;
      }

      return {
        materialCode: line.materialCode,
        materialName: line.materialName || line.materialCode,
        quantity: line.quantity,
        unit: line.unit || '',
        warehouseCode: initialWh,
      };
    });
  });

  const [note, setNote] = useState<string>(
    `Xuất cấp phát vật tư theo bảng kê ${req.csvFileName} cho hồ sơ ${req.code}${
      req.assetCode ? ` (Thiết bị: ${req.assetCode})` : ''
    }`,
  );
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Cập nhật từng dòng
  const handleItemChange = (index: number, patch: Partial<BatchItemState>) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  // Kiểm tra tồn kho và phân loại 3 màu cho từng dòng
  const itemStatuses = useMemo(() => {
    return items.map((item) => {
      const matchingStocks = workspace.stock.filter((s) => s.materialCode === item.materialCode);
      const totalAvail = matchingStocks.reduce((sum, s) => sum + s.available, 0);

      const stockRow = matchingStocks.find((s) => s.warehouseCode === item.warehouseCode);
      const onHand = stockRow?.quantity ?? 0;
      const available = stockRow?.available ?? 0;

      let tier: 'single_ready' | 'transfer_needed' | 'shortage' = 'shortage';
      if (totalAvail >= item.quantity) {
        tier = available >= item.quantity ? 'single_ready' : 'transfer_needed';
      } else {
        tier = 'shortage';
      }

      const overdraw = item.quantity > onHand;
      const valid = item.quantity >= 0 && !!item.warehouseCode && !overdraw;

      return { valid, onHand, available, totalAvail, overdraw, tier };
    });
  }, [items, workspace.stock]);

  const hasInvalid = itemStatuses.some((v) => !v.valid);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (hasInvalid || submitting || busy) return;

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const results: string[] = [];
      const targetAsset = req.assetCode || selectedAssetCode;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.quantity <= 0) continue; // Bỏ qua nếu người dùng đặt = 0

        const itemNote = `${note} [Vật tư ${item.materialCode} × ${item.quantity} ${item.unit}]`;
        if (targetAsset && isAssignToAsset) {
          // Xuất cho bảo trì/thay thế thiết bị: gọi installItem để liên kết cây tài sản và cộng vào 'Đang sử dụng'
          const res = await installItem(item.materialCode, {
            warehouseCode: item.warehouseCode,
            parentCode: targetAsset,
            quantity: item.quantity,
            note: itemNote,
          });
          results.push(`${item.materialCode}: ${res.transactionCode}`);
        } else {
          // Xuất tiêu hao
          const res = await issueStock({
            warehouseCode: item.warehouseCode,
            materialCode: item.materialCode,
            quantity: item.quantity,
            note: itemNote,
          });
          results.push(`${item.materialCode}: ${res.transactionCode}`);
        }
      }

      markRequisitionFulfilled(req.code);
      if (req.id && req.id !== req.code) {
        try {
          const csrfToken =
            document.cookie.split('; ').find((p) => p.startsWith('ep_csrf='))?.split('=')[1] ?? '';
          void fetch(`/api/procedure/v1/instances/${encodeURIComponent(req.id)}/comments`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
            body: JSON.stringify({
              comment: `[Thủ kho] Đã xuất kho thành công cấp phát theo phiếu yêu cầu ${req.code} (chứng từ: ${results.join(', ')}).`,
            }),
          }).catch((err) => {
            void err;
          });
        } catch {
          // Bỏ qua nếu không thể gửi comment về quy trình
        }
      }

      onSuccess(
        `Đã xuất kho thành công cấp phát vật tư theo phiếu yêu cầu ${req.code} (${results.join(', ')}).`,
        req.code,
      );
      onClose();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Có lỗi xảy ra khi thực hiện xuất kho theo phiếu yêu cầu.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const dirtySnapshot = JSON.stringify([isAssignToAsset, selectedAssetCode, items, note]);
  const [initialSnapshot] = useState(dirtySnapshot);
  const isDirty = dirtySnapshot !== initialSnapshot;

  return (
    <Dialog onEscape={!submitting && !busy && !isDirty ? onClose : undefined}>
      <DialogContent className="max-w-212" aria-label="Xử lý phiếu yêu cầu cấp phát vật tư">
        {/* Modal Header */}
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div
              className="p-2 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center"
            >
              <Layers size={20} strokeWidth={2.2} />
            </div>
            <div>
              <DialogTitle>Xử lý Phiếu yêu cầu cấp phát vật tư ({req.lines.length} hạng mục)</DialogTitle>
              <p className="mt-0.5 mx-0 mb-0 text-[13px] text-slate-500">
                Hồ sơ <strong>{req.code}</strong> • Bảng kê: <code>{req.csvFileName}</code>
                {req.assetCode ? ` • Thiết bị nhận: ${req.assetCode}` : ''}
              </p>
            </div>
          </div>
          <CloseGuard dirty={isDirty} busy={submitting || busy} onClose={onClose}>
            <DialogCloseButton />
          </CloseGuard>
        </DialogHeader>

        {/* Modal Body */}
        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogBody className="flex flex-col gap-4">
            {errorMessage ? (
              <div
                className="py-2.5 px-3.5 rounded-md bg-red-50 border border-red-200 text-red-700 text-[14px] flex items-center gap-2"
              >
                <AlertTriangle size={16} />
                <span>{errorMessage}</span>
              </div>
            ) : null}

            {/* BANNER 3 MÀU TỔNG QUAN TÌNH TRẠNG ĐÁP ỨNG CỦA PHIẾU YÊU CẦU */}
            <div
              className={cn(
                'flex flex-wrap items-center justify-between gap-3.5 rounded-lg border px-4 py-3',
                stockSummary.allReady ? 'border-green-300 bg-green-50' : 'border-slate-200 bg-slate-50',
              )}
            >
              <div className="flex items-center gap-2.5">
                <PackageCheck
                  size={22}
                  className={cn('shrink-0', stockSummary.allReady ? 'text-green-600' : 'text-blue-600')}
                />
                <div>
                  <div
                    className={cn('text-[14px] font-bold', stockSummary.allReady ? 'text-green-700' : 'text-slate-900')}
                  >
                    {stockSummary.allReady
                      ? 'Kho đã có đủ hàng sẵn sàng xuất cho toàn bộ danh sách!'
                      : 'Tình trạng đáp ứng tồn kho của Phiếu yêu cầu:'}
                  </div>
                  <div className="text-[13px] text-slate-500 mt-0.5">
                    Thủ kho kiểm tra kho xuất và xác nhận cấp phát cho quy trình bảo dưỡng.
                  </div>
                </div>
              </div>

              {/* 3 Huy hiệu màu trạng thái */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {stockSummary.singleCount > 0 ? (
                  <span
                    className="py-0.5 px-2 rounded-xl text-[12px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200"
                    title="Vật tư có đủ hàng tại 1 kho đơn lẻ"
                  >
                    ● {stockSummary.singleCount} sẵn sàng
                  </span>
                ) : null}

                {stockSummary.transferCount > 0 ? (
                  <span
                    className="py-0.5 px-2 rounded-xl text-[12px] font-semibold bg-amber-50 text-amber-700 border border-amber-200"
                    title="Vật tư đủ nếu gom hoặc điều chuyển giữa các kho"
                  >
                    ▲ {stockSummary.transferCount} cần gom kho
                  </span>
                ) : null}

                {stockSummary.shortageCount > 0 ? (
                  <span
                    className="py-0.5 px-2 rounded-xl text-[12px] font-semibold bg-red-50 text-red-700 border border-red-200"
                    title="Vật tư thiếu trên toàn bộ hệ thống kho"
                  >
                    ✕ {stockSummary.shortageCount} thiếu hàng
                  </span>
                ) : null}
              </div>
            </div>

            {/* Phân loại & Gán thiết bị cho toàn bộ bảng kê xuất bảo dưỡng */}
            <div
              className="py-3 px-3.5 rounded-lg bg-green-50 border border-green-200 flex flex-col gap-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-bold text-green-800">
                  Phân loại hạch toán & Gán thiết bị bảo trì:
                </span>
              </div>
              <div className="flex items-center gap-5">
                <Label className="inline-flex cursor-pointer items-center gap-1.5 text-[14px] font-semibold text-slate-800">
                  <input
                    type="radio"
                    name="batch_purpose"
                    checked={isAssignToAsset}
                    onChange={() => setIsAssignToAsset(true)}
                  />
                  Lắp đặt / Thay thế cho thiết bị <span className="text-green-600">(Cộng vào "Đang sử dụng")</span>
                </Label>
                <Label className="inline-flex cursor-pointer items-center gap-1.5 text-[14px] font-semibold text-slate-500">
                  <input
                    type="radio"
                    name="batch_purpose"
                    checked={!isAssignToAsset}
                    onChange={() => setIsAssignToAsset(false)}
                  />
                  Xuất tiêu hao / tiêu hủy (Trừ hẳn sở hữu)
                </Label>
              </div>

              {isAssignToAsset ? (
                <div className="flex items-center gap-2.5 mt-1">
                  <span className="text-[13px] font-semibold text-slate-700 whitespace-nowrap">
                    Thiết bị tiếp nhận:
                  </span>
                  <SearchableSelect
                    className="max-w-95 flex-1"
                    height={32}
                    placeholder="— Chọn thiết bị nhận lắp đặt trên Cây tài sản —"
                    options={workspace.assets.map((asset) => ({
                      value: asset.code,
                      label: `${asset.code} — ${asset.name}`,
                    }))}
                    value={selectedAssetCode}
                    onChange={setSelectedAssetCode}
                  />
                  <span className="text-[12px] text-green-700">
                    Các vật tư xuất ra sẽ được tự động cộng vào cột <strong>"Đang sử dụng"</strong>.
                  </span>
                </div>
              ) : null}
            </div>

            {/* Bảng danh sách vật tư */}
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <Table className="bg-white text-[13px]">
                <TableHead>
                  <TableRow className="bg-slate-100 text-left text-slate-600 hover:bg-slate-100">
                    <TableHeaderCell className="px-3 py-2 border-b border-b-slate-200 w-[35px]">
                      STT
                    </TableHeaderCell>
                    <TableHeaderCell className="px-3 py-2 border-b border-b-slate-200">Vật tư</TableHeaderCell>
                    <TableHeaderCell className="px-3 py-2 border-b border-b-slate-200 w-[125px] text-right">
                      Số lượng xuất
                    </TableHeaderCell>
                    <TableHeaderCell className="px-3 py-2 border-b border-b-slate-200 w-57.5">
                      Kho chỉ định xuất
                    </TableHeaderCell>
                    <TableHeaderCell className="px-3 py-2 border-b border-b-slate-200 w-52.5 text-right">
                      Tồn kho & Trạng thái
                    </TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.map((item, idx) => {
                    const status = itemStatuses[idx];
                    return (
                      <TableRow
                        key={`${item.materialCode}-${idx}`}
                        className={cn(
                          'border-b border-b-slate-100',
                          status.overdraw ? 'bg-rose-50 hover:bg-rose-50' : idx % 2 === 1 ? 'bg-slate-50/60' : 'bg-white',
                        )}
                      >
                        <TableCell className="px-3 py-2 text-slate-500 text-center">
                          {idx + 1}
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <div className="font-semibold text-blue-600">{item.materialCode}</div>
                          <div className="text-[12px] text-slate-600">{item.materialName}</div>
                        </TableCell>
                        <TableCell className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <VnNumberInput
                              maxDecimals={getUnitQuantityConfig(item.unit).step === '1' ? 0 : 2}
                              value={String(item.quantity)}
                              onChange={(value) => handleItemChange(idx, { quantity: Number(value) || 0 })}
                              className={cn(
                                'w-[75px] rounded-sm border px-2 py-[5px] text-right text-[13px] font-bold',
                                status.overdraw ? 'border-red-500' : 'border-slate-300',
                              )}
                            />
                            <span className="text-[12px] text-slate-500 min-w-[25px]">
                              {item.unit}
                            </span>
                          </div>
                          {status.overdraw && status.onHand > 0 ? (
                            <div className="mt-[3px]">
                              <Button
                                type="button"
                                variant="link"
                                size="xs"
                                className="h-auto p-0 text-[12px] underline"
                                onClick={() => handleItemChange(idx, { quantity: status.onHand })}
                              >
                                Lấy tồn ({status.onHand})
                              </Button>
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <SearchableSelect
                            height={32}
                            value={item.warehouseCode}
                            onChange={(value) => handleItemChange(idx, { warehouseCode: value })}
                            options={workspace.warehouses.map((w) => {
                              const wStock = workspace.stock.find(
                                (stock) => stock.materialCode === item.materialCode && stock.warehouseCode === w.code,
                              );
                              const wAvail = wStock?.available ?? 0;
                              return { value: w.code, label: `${w.name} (khả dụng: ${formatNumber(wAvail)})` };
                            })}
                          />
                        </TableCell>
                        <TableCell className="px-3 py-2 text-right">
                          {status.tier === 'single_ready' ? (
                            <Badge variant="outline"
                              className="h-auto gap-[3px] py-0.5 px-[7px] text-[12px] font-semibold bg-emerald-50 text-emerald-700 border-emerald-200"
                            >
                              ● Sẵn sàng (tồn {formatNumber(status.onHand)})
                            </Badge>
                          ) : status.tier === 'transfer_needed' ? (
                            <Badge variant="outline"
                              className="h-auto gap-[3px] py-0.5 px-[7px] text-[12px] font-semibold bg-amber-50 text-amber-700 border-amber-200"
                              title={`Kho chọn có ${formatNumber(status.onHand)}, tổng liên kho có ${formatNumber(status.totalAvail)}`}
                            >
                              ▲ Gom kho (kho {formatNumber(status.onHand)} / gom {formatNumber(status.totalAvail)})
                            </Badge>
                          ) : (
                            <Badge variant="outline"
                              className="h-auto gap-[3px] py-0.5 px-[7px] text-[12px] font-semibold bg-red-50 text-red-700 border-red-200"
                              title={`Toàn hệ thống chỉ còn ${formatNumber(status.totalAvail)}`}
                            >
                              ✕ Thiếu hàng (tổng còn {formatNumber(status.totalAvail)})
                            </Badge>
                          )}
                          {status.overdraw ? (
                            <div className="text-[12px] text-red-600 mt-0.5 font-medium">
                              Kho chọn chỉ còn {formatNumber(status.onHand)}!
                            </div>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Ghi chú chứng từ chung */}
            <div className="flex flex-col gap-[5px]">
              <Label className="text-[14px] text-slate-700">
                Ghi chú chứng từ xuất / tham chiếu quy trình:
              </Label>
              <Textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="text-[13px]"
              />
            </div>
          </DialogBody>

          {/* Modal Footer */}
          <DialogFooter className="justify-between">
            <div className="flex items-center gap-1.5 text-[13px] text-slate-500">
              <CheckCircle2 size={15} color="#16a34a" />
              <span>
                Sẽ ghi đồng thời <strong>{items.filter(i => i.quantity > 0).length} bút toán xuất kho</strong> vào sổ cái.
              </span>
            </div>

            <div className="flex items-center gap-2">
              <CloseGuard dirty={isDirty} busy={submitting || busy} onClose={onClose}>
                <Button type="button" variant="outline" disabled={submitting}>
                  Huỷ
                </Button>
              </CloseGuard>
              <Button
                type="submit"
                disabled={hasInvalid || submitting || busy}
                className="min-w-45"
              >
                {submitting
                  ? 'Đang ghi sổ giao dịch…'
                  : `Xác nhận xuất ${items.filter(i => i.quantity > 0).length} vật tư`}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
