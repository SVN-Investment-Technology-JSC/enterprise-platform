'use client';

import type {
  StockDocumentStatus,
  Warehouse,
} from '@enterprise-platform/contracts-inventory';
import { formatDate } from '@enterprise-platform/shared-ui';
import { QrCode, Layers } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { loadLots, loadSerials } from '../inventory-api';
import { QUALITY_STATUS_LABEL, formatNumber } from '../inventory-labels';
import {
  STOCK_DOCUMENT_STATUS_BADGE,
  STOCK_DOCUMENT_STATUS_LABEL,
  addScannedSerials,
  allocateFefo,
  lotOptionsForWarehouse,
  parseSerialInput,
  todayIso,
  type LotAllocation,
  type LotOption,
} from '../stock-document.model';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '../ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableWrap } from '../ui/table';
import { Textarea } from '../ui/textarea';
import { Badge } from '../ui/badge';

/** Nhãn trạng thái chứng từ: nền màu và chấm tròn CSS, không dùng emoji. */
export function DocumentStatusBadge({
  status,
}: {
  status: StockDocumentStatus;
}) {
  const badge = STOCK_DOCUMENT_STATUS_BADGE[status];
  return (
    <Badge
      className="h-auto gap-[0.35rem] px-[0.55rem] py-[0.15rem] font-bold tracking-[0.02em]"
      style={{
        background: badge.bg,
        color: badge.text,
        border: `1px solid ${badge.border}`,
      }}
    >
      <span className="inline-block size-1.5 rounded-full" style={{ background: badge.text }} />
      {STOCK_DOCUMENT_STATUS_LABEL[status]}
    </Badge>
  );
}

/** Nội dung lỗi trả về từ server hoặc lỗi bất ngờ, hiện nguyên văn cho người dùng. */
export function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

// ---------------------------------------------------------------- Chọn serial

/**
 * Chọn serial cho một dòng trong Drawer. Dòng xuất: chỉ chọn serial đang ở kho
 * xuất, Trong kho, Đạt (đọc từ server). Dòng nhập: gõ hoặc quét serial mới.
 * Ô quét nhận cả bàn phím lẫn máy quét mã vạch (máy quét gõ chuỗi rồi Enter).
 */
export function SerialPickerDrawer({
  open,
  materialCode,
  materialName,
  warehouse,
  quantity,
  value,
  inbound,
  readOnly,
  zIndex,
  onApply,
  onClose,
}: {
  open: boolean;
  materialCode: string;
  materialName?: string;
  warehouse?: Pick<Warehouse, 'id' | 'code'>;
  quantity: number;
  value: readonly string[];
  inbound: boolean;
  readOnly?: boolean;
  /** Mở chồng lên hộp thoại khác (lắp, tháo vật tư) thì cần nổi cao hơn hộp thoại đó. */
  zIndex?: number;
  onApply: (serials: string[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([...value]);
  const [available, setAvailable] = useState<string[]>();
  const [scan, setScan] = useState('');
  const [filter, setFilter] = useState('');
  const [feedback, setFeedback] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  const limit = Math.max(Math.trunc(quantity) || 0, 0);

  useEffect(() => {
    if (!open) return;
    setSelected([...value]);
    setFeedback(undefined);
    setScan('');
    setFilter('');
  }, [open, value]);

  useEffect(() => {
    if (!open || inbound || !materialCode) return;
    let cancelled = false;
    setAvailable(undefined);
    setLoadError(undefined);
    loadSerials(materialCode)
      .then((rows) => {
        if (cancelled) return;
        setAvailable(
          rows
            .filter(
              (row) =>
                (!warehouse || row.currentWarehouseId === warehouse.id) &&
                (row.stockState ?? 'IN_STOCK') === 'IN_STOCK' &&
                (row.qualityStatus ?? 'PASSED') === 'PASSED',
            )
            .map((row) => row.serialNumber)
            .sort((left, right) => left.localeCompare(right)),
        );
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setLoadError(errorMessage(cause, 'Không tải được danh sách serial.'));
      });
    return () => {
      cancelled = true;
    };
  }, [open, inbound, materialCode, warehouse]);

  /** Serial đã có sẵn trên dòng (ví dụ Bán hàng gợi ý) vẫn được giữ trong danh sách cho phép. */
  const allowed = useMemo(
    () =>
      inbound || !available
        ? undefined
        : [...new Set([...available, ...value])],
    [inbound, available, value],
  );

  const applyScan = () => {
    const scanned = parseSerialInput(scan);
    if (scanned.length === 0) return;
    const result = addScannedSerials(selected, scanned, { limit, allowed });
    setSelected(result.serials);
    setScan('');
    setFeedback(
      result.rejected.length
        ? `Không thêm: ${result.rejected.map((item) => `${item.serial} (${item.reason})`).join('; ')}.`
        : `Đã thêm ${result.serials.length - selected.length} serial.`,
    );
  };

  const toggle = (serial: string) => {
    if (readOnly) return;
    if (selected.includes(serial))
      setSelected(selected.filter((item) => item !== serial));
    else if (selected.length < limit) setSelected([...selected, serial]);
    else setFeedback(`Dòng chỉ cần ${limit} serial.`);
  };

  const visible = (allowed ?? []).filter((serial) =>
    serial.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  if (!open) return null;

  return (
    <Sheet onEscape={onClose} onBackdropClick={onClose}>
      <SheetContent
        className="max-w-[520px]"
        style={zIndex ? { zIndex } : undefined}
        aria-label={`Serial ${materialCode}`}
      >
        <SheetHeader>
          <SheetTitle>
            <span className="inline-flex items-center gap-2">
              <QrCode size={18} /> Serial {materialCode}
            </span>
          </SheetTitle>
          <DialogCloseButton onClick={onClose} />
        </SheetHeader>
        <SheetBody className="bg-white">
          {materialName ? (
            <p className="my-[0.35rem] text-[13px] text-slate-500">{materialName}</p>
          ) : null}
          {readOnly ? null : (
            <Label className="flex min-w-44 flex-col gap-1 text-xs font-bold text-slate-600">
              <span>
                Quét hoặc gõ serial rồi nhấn Enter (nhiều serial cách nhau bằng
                dấu phẩy hoặc xuống dòng)
              </span>
              <Input
                className="font-normal"
                autoFocus
                value={scan}
                aria-label="Quét serial"
                placeholder="Ví dụ SN001"
                onChange={(event) => setScan(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    applyScan();
                  }
                }}
                onPaste={(event) => {
                  const text = event.clipboardData.getData('text');
                  if (/[\s,;]/.test(text.trim())) {
                    event.preventDefault();
                    const result = addScannedSerials(
                      selected,
                      parseSerialInput(text),
                      { limit, allowed },
                    );
                    setSelected(result.serials);
                    setFeedback(
                      result.rejected.length
                        ? `Không thêm: ${result.rejected.map((item) => `${item.serial} (${item.reason})`).join('; ')}.`
                        : undefined,
                    );
                  }
                }}
              />
            </Label>
          )}
          {feedback ? <p className="my-[0.35rem] text-[13px] text-slate-500">{feedback}</p> : null}

          <h4 className="mb-2 mt-4 text-sm font-bold text-slate-900">Đã chọn</h4>
          {selected.length === 0 ? (
            <p className="my-[0.35rem] text-[13px] text-slate-500">Chưa chọn serial nào.</p>
          ) : (
            <div className="flex flex-wrap gap-[0.35rem]">
              {selected.map((serial) => (
                <span key={serial} className="inline-flex items-center gap-[0.35rem] rounded-full border border-blue-200 bg-blue-50 px-2 py-[0.2rem] font-mono text-[13px] text-blue-800">
                  {serial}
                  {readOnly ? null : (
                    <button
                      type="button"
                      className="cursor-pointer border-0 bg-transparent p-0 text-inherit"
                      aria-label={`Bỏ ${serial}`}
                      onClick={() =>
                        setSelected(selected.filter((item) => item !== serial))
                      }
                    >
                      ✕
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}

          {inbound ? (
            <p className="my-[0.35rem] text-[13px] text-slate-500">
              Dòng nhập: serial mới được tạo khi ghi sổ; serial đã có của mặt
              hàng bị từ chối.
            </p>
          ) : (
            <>
              <h4 className="mb-2 mt-4 text-sm font-bold text-slate-900">
                Serial sẵn có ở kho {warehouse?.code ?? ''} (Trong kho, Đạt)
              </h4>
              {loadError ? <p className="mb-4 rounded-[0.65rem] border border-red-200 bg-red-50 px-4 py-[0.8rem] text-red-800">{loadError}</p> : null}
              {!available && !loadError ? (
                <p className="my-[0.35rem] text-[13px] text-slate-500">Đang tải serial…</p>
              ) : null}
              {available ? (
                <>
                  <Label className="flex min-w-44 flex-col gap-1 text-xs font-bold text-slate-600">
                    <span>Lọc</span>
                    <Input
                      className="font-normal"
                      value={filter}
                      onChange={(event) => setFilter(event.target.value)}
                      placeholder="Tìm serial"
                    />
                  </Label>
                  <div className="mt-2 grid max-h-88 grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-[0.35rem] overflow-y-auto">
                    {visible.map((serial) => (
                      <label key={serial} className="flex cursor-pointer items-center gap-[0.4rem] rounded-[0.4rem] border border-slate-200 px-[0.45rem] py-[0.3rem] font-mono text-[13px]">
                        <input
                          type="checkbox"
                          checked={selected.includes(serial)}
                          disabled={readOnly}
                          onChange={() => toggle(serial)}
                        />
                        {serial}
                      </label>
                    ))}
                    {visible.length === 0 ? (
                      <p className="my-[0.35rem] text-[13px] text-slate-500">Không có serial phù hợp.</p>
                    ) : null}
                  </div>
                </>
              ) : null}
            </>
          )}
        </SheetBody>
        <SheetFooter className="[&>div]:w-full">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[13px] tabular-nums text-slate-500">
              Đã chọn {selected.length}/{limit}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Đóng
              </Button>
              {readOnly ? null : (
                <Button type="button" onClick={() => onApply(selected)}>
                  Áp dụng
                </Button>
              )}
            </div>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------- Chọn lô

/**
 * Chọn lô cho dòng xuất theo FEFO. Lô hết hạn, không Đạt hiện mờ kèm lý do.
 * "Gợi ý FEFO" chia số lượng cho lô hạn gần nhất trước; áp dụng xong một dòng có
 * thể tách thành nhiều dòng, mỗi dòng một lô.
 */
export function LotPickerDrawer({
  open,
  materialCode,
  warehouseCode,
  quantity,
  unit,
  current,
  zIndex,
  onApply,
  onClose,
}: {
  open: boolean;
  materialCode: string;
  warehouseCode: string;
  quantity: number;
  unit?: string;
  current?: string;
  /** Xem `SerialPickerDrawer`. */
  zIndex?: number;
  onApply: (allocations: LotAllocation[]) => void;
  onClose: () => void;
}) {
  const [options, setOptions] = useState<LotOption[]>();
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [loadError, setLoadError] = useState<string>();

  useEffect(() => {
    if (!open || !materialCode) return;
    let cancelled = false;
    setOptions(undefined);
    setLoadError(undefined);
    loadLots(materialCode)
      .then((lots) => {
        if (cancelled) return;
        const next = lotOptionsForWarehouse(lots, warehouseCode, todayIso());
        setOptions(next);
        if (current && next.some((option) => option.lotNo === current))
          setAmounts({ [current]: quantity });
        else {
          const fefo = allocateFefo(next, quantity);
          setAmounts(
            Object.fromEntries(
              fefo.allocations.map((item) => [item.lotNo, item.quantity]),
            ),
          );
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setLoadError(errorMessage(cause, 'Không tải được danh sách lô.'));
      });
    return () => {
      cancelled = true;
    };
  }, [open, materialCode, warehouseCode, quantity, current]);

  const total = Object.values(amounts).reduce(
    (sum, value) => sum + (Number(value) || 0),
    0,
  );
  const overLot = (options ?? []).find(
    (option) => (amounts[option.lotNo] ?? 0) > option.available,
  );
  const suggest = () => {
    const fefo = allocateFefo(options ?? [], quantity);
    setAmounts(
      Object.fromEntries(
        fefo.allocations.map((item) => [item.lotNo, item.quantity]),
      ),
    );
  };

  const apply = () => {
    const allocations = (options ?? [])
      .filter((option) => (amounts[option.lotNo] ?? 0) > 0)
      .map((option) => ({
        lotNo: option.lotNo,
        expiresOn: option.expiresOn,
        quantity: amounts[option.lotNo],
      }));
    onApply(allocations);
  };

  const problem =
    overLot !== undefined
      ? `Lô ${overLot.lotNo} chỉ còn khả dụng ${formatNumber(overLot.available)}.`
      : total !== quantity && total > 0
        ? `Tổng theo lô ${formatNumber(total)} khác số lượng dòng ${formatNumber(quantity)}; áp dụng sẽ đổi số lượng theo lô.`
        : undefined;

  if (!open) return null;

  return (
    <Sheet onEscape={onClose} onBackdropClick={onClose}>
      <SheetContent
        className="max-w-[560px]"
        style={zIndex ? { zIndex } : undefined}
        aria-label={`Chọn lô ${materialCode}`}
      >
        <SheetHeader>
          <SheetTitle>
            <span className="inline-flex items-center gap-2">
              <Layers size={18} /> Chọn lô {materialCode} tại {warehouseCode}
            </span>
          </SheetTitle>
          <DialogCloseButton onClick={onClose} />
        </SheetHeader>
        <SheetBody className="bg-white">
          <p className="my-[0.35rem] text-[13px] text-slate-500">
            Xếp theo hạn dùng gần nhất trước (FEFO). Lô hết hạn hoặc không ở
            trạng thái Đạt không xuất được.
          </p>
          {loadError ? <p className="mb-4 rounded-[0.65rem] border border-red-200 bg-red-50 px-4 py-[0.8rem] text-red-800">{loadError}</p> : null}
          {!options && !loadError ? (
            <p className="my-[0.35rem] text-[13px] text-slate-500">Đang tải lô…</p>
          ) : null}
          {options && options.length === 0 ? (
            <p className="my-[0.35rem] text-[13px] text-slate-500">
              Mặt hàng chưa có lô nào ở kho {warehouseCode}.
            </p>
          ) : null}
          {options && options.length > 0 ? (
            <TableWrap>
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Số lô</TableHeaderCell>
                    <TableHeaderCell>Hạn dùng</TableHeaderCell>
                    <TableHeaderCell className="text-right">Khả dụng</TableHeaderCell>
                    <TableHeaderCell className="text-right">Lấy</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {options.map((option) => (
                    <TableRow
                      key={option.lotNo}
                      style={{ opacity: option.blockedReason ? 0.55 : 1 }}
                    >
                      <TableCell>
                        <strong>{option.lotNo}</strong>
                        {option.blockedReason ? (
                          <span className="mt-[0.2rem] block text-[13px] font-normal text-slate-500">
                            {option.blockedReason}
                            {option.qualityStatus !== 'PASSED'
                              ? ` (${QUALITY_STATUS_LABEL[option.qualityStatus]})`
                              : ''}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {option.expiresOn
                          ? formatDate(option.expiresOn)
                          : 'Không thời hạn'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(option.available)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          aria-label={`Số lượng lấy từ lô ${option.lotNo}`}
                          className="h-8 text-right text-[13px] tabular-nums"
                          disabled={Boolean(option.blockedReason)}
                          value={amounts[option.lotNo] ?? ''}
                          onChange={(event) =>
                            setAmounts({
                              ...amounts,
                              [option.lotNo]: Math.max(
                                Number(event.target.value) || 0,
                                0,
                              ),
                            })
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrap>
          ) : null}
          {problem ? <p className="my-[0.6rem] rounded-[0.55rem] border border-amber-200 bg-amber-50 px-[0.8rem] py-[0.6rem] text-[13px] text-amber-800">{problem}</p> : null}
        </SheetBody>
        <SheetFooter className="[&>div]:w-full">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[13px] tabular-nums text-slate-500">
              Cần {formatNumber(quantity)} {unit ?? ''}, đã chia{' '}
              {formatNumber(total)}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={suggest}
                disabled={!options}
              >
                Gợi ý FEFO
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onApply([])}
              >
                Không chọn lô
              </Button>
              <Button
                type="button"
                onClick={apply}
                disabled={!options || overLot !== undefined || total <= 0}
              >
                Áp dụng
              </Button>
            </div>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------- Lý do từ chối

/** Hộp nhập lý do từ chối; lý do bắt buộc (server cũng kiểm). */
export function RejectReasonDialog({
  open,
  documentCode,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  documentCode?: string;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  return open ? (
    <Dialog onEscape={busy ? undefined : onCancel}>
      <DialogContent
        className="max-w-[520px]"
        aria-label={`Từ chối chứng từ ${documentCode ?? ''}`}
      >
        <DialogHeader>
          <DialogTitle>{`Từ chối chứng từ ${documentCode ?? ''}`}</DialogTitle>
          <DialogCloseButton onClick={onCancel} disabled={busy} />
        </DialogHeader>
        <DialogBody>
          <Label className="flex min-w-44 flex-col gap-1 text-xs font-bold text-slate-600">
            <span>Lý do từ chối (bắt buộc, người lập sẽ thấy để sửa lại)</span>
            <Textarea
              className="font-normal"
              autoFocus
              rows={4}
              value={reason}
              aria-label="Lý do từ chối"
              onChange={(event) => setReason(event.target.value)}
            />
          </Label>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={busy}
          >
            Huỷ
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy || !reason.trim()}
            onClick={() => onConfirm(reason.trim())}
          >
            Từ chối
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;
}
