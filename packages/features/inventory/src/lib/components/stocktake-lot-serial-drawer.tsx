'use client';

import type { StocktakeLotAllocation, StocktakeSerialAllocation } from '@enterprise-platform/contracts-inventory';
import { formatDate } from '@enterprise-platform/shared-ui';
import { useState } from 'react';
import { X, Plus, Trash2, Layers, QrCode } from 'lucide-react';
import { Button, Input, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../ui';
import { cn } from '../ui/cn';

export interface StocktakeLotSerialDrawerProps {
  materialCode: string;
  materialName: string;
  unit: string;
  systemQuantity: number;
  actualQuantity?: number;
  isSerialized?: boolean;
  isLotTracked?: boolean;
  lotAllocations?: readonly StocktakeLotAllocation[];
  serialAllocations?: readonly StocktakeSerialAllocation[];
  readOnly?: boolean;
  onClose: () => void;
  onSave: (data: {
    actualQuantity: number;
    lotAllocations?: StocktakeLotAllocation[];
    serialAllocations?: StocktakeSerialAllocation[];
  }) => void;
}

export function StocktakeLotSerialDrawer({
  materialCode,
  materialName,
  unit,
  systemQuantity,
  actualQuantity,
  isSerialized,
  isLotTracked,
  lotAllocations = [],
  serialAllocations = [],
  readOnly = false,
  onClose,
  onSave,
}: StocktakeLotSerialDrawerProps) {
  // Quản lý tab bên trong drawer nếu vừa theo dõi lô vừa có sê-ri
  const [tab, setTab] = useState<'lots' | 'serials'>(isLotTracked ? 'lots' : 'serials');

  // Local state cho Lô
  const [lots, setLots] = useState<StocktakeLotAllocation[]>(() => {
    if (lotAllocations.length > 0) return [...lotAllocations];
    return [
      {
        lotNumber: 'LOT-2026-Q1',
        systemQty: systemQuantity,
        actualQty: actualQuantity ?? systemQuantity,
        expiryDate: '2027-12-31',
      },
    ];
  });

  // Local state cho Sê-ri
  const [serials, setSerials] = useState<StocktakeSerialAllocation[]>(() => {
    if (serialAllocations.length > 0) return [...serialAllocations];
    // Giả lập danh sách sê-ri từ số tồn sổ sách
    const initialSerials: StocktakeSerialAllocation[] = [];
    const count = Math.min(Math.max(systemQuantity, 1), 10);
    for (let i = 1; i <= count; i++) {
      initialSerials.push({
        serialNumber: `SN-${materialCode}-${String(i).padStart(4, '0')}`,
        status: 'FOUND',
      });
    }
    return initialSerials;
  });

  const [newSerialInput, setNewSerialInput] = useState('');
  const [newLotNumber, setNewLotNumber] = useState('');
  const [newLotQty, setNewLotQty] = useState<number>(0);

  // Tính tổng thực đếm từ Lô hoặc Sê-ri
  const totalLotActual = lots.reduce((sum, l) => sum + (Number(l.actualQty) || 0), 0);
  const totalFoundSerials = serials.filter((s) => s.status === 'FOUND' || s.status === 'EXTRA').length;

  const handleAddLot = () => {
    if (!newLotNumber.trim() || newLotQty <= 0) return;
    setLots((prev) => [
      ...prev,
      {
        lotNumber: newLotNumber.trim().toUpperCase(),
        systemQty: 0,
        actualQty: newLotQty,
      },
    ]);
    setNewLotNumber('');
    setNewLotQty(0);
  };

  const handleAddSerial = () => {
    if (!newSerialInput.trim()) return;
    const sn = newSerialInput.trim().toUpperCase();
    if (serials.some((s) => s.serialNumber === sn)) return;
    setSerials((prev) => [
      ...prev,
      {
        serialNumber: sn,
        status: 'EXTRA', // Quét thêm được ngoài danh sách sổ sách
      },
    ]);
    setNewSerialInput('');
  };

  const handleApply = () => {
    if (isLotTracked) {
      onSave({
        actualQuantity: totalLotActual,
        lotAllocations: lots,
        serialAllocations: isSerialized ? serials : undefined,
      });
    } else if (isSerialized) {
      onSave({
        actualQuantity: totalFoundSerials,
        serialAllocations: serials,
      });
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[1050] flex justify-end bg-black/45 backdrop-blur-[4px]"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex h-full w-[640px] max-w-[100vw] flex-col bg-white shadow-[-4px_0_20px_rgba(0,0,0,0.15)]">
        {/* Header Drawer */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-bold text-indigo-700">
                {materialCode}
              </span>
              <h3 className="m-0 text-base font-bold text-slate-900">
                Đối soát chi tiết {isLotTracked && isSerialized ? 'Lô & Sê-ri' : isLotTracked ? 'Theo Lô hàng' : 'Cá thể Sê-ri'}
              </h3>
            </div>
            <p className="mb-0 mt-[3px] text-[13px] text-slate-500">
              {materialName} · Sổ sách: <strong>{systemQuantity} {unit}</strong>
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} className="text-slate-500">
            <X size={18} />
          </Button>
        </div>

        {/* Sub-Tabs nếu cả 2 */}
        {isLotTracked && isSerialized ? (
          <div className="flex border-b border-slate-200 bg-white px-5">
            <button
              type="button"
              onClick={() => setTab('lots')}
              className={cn(
                'cursor-pointer border-0 border-b-2 bg-transparent px-[14px] py-[10px] text-sm font-semibold',
                tab === 'lots' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500',
              )}
            >
              Kiểm đếm theo Lô ({lots.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('serials')}
              className={cn(
                'cursor-pointer border-0 border-b-2 bg-transparent px-[14px] py-[10px] text-sm font-semibold',
                tab === 'serials' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500',
              )}
            >
              Quét mã Sê-ri ({serials.length})
            </button>
          </div>
        ) : null}

        {/* Drawer Body Scrollable */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* TAB LÔ */}
          {tab === 'lots' && isLotTracked ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between rounded-md border border-green-200 bg-green-50 px-[14px] py-3">
                <div>
                  <span className="text-[13px] text-green-800">Tổng thực đếm các Lô:</span>
                  <div className="text-xl font-extrabold text-green-700">
                    {totalLotActual} {unit}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[13px] text-green-800">Chênh lệch sổ sách:</span>
                  <div
                    className={cn(
                      'text-base font-bold',
                      totalLotActual === systemQuantity
                        ? 'text-green-700'
                        : totalLotActual > systemQuantity
                          ? 'text-blue-600'
                          : 'text-red-600',
                    )}
                  >
                    {totalLotActual - systemQuantity > 0 ? `+${totalLotActual - systemQuantity}` : totalLotActual - systemQuantity} {unit}
                  </div>
                </div>
              </div>

              {!readOnly ? (
                <div className="flex gap-2 rounded-md border border-slate-200 bg-slate-50 p-[10px]">
                  <Input
                    type="text"
                    placeholder="Mã số Lô mới..."
                    value={newLotNumber}
                    onChange={(e) => setNewLotNumber(e.target.value)}
                    className="h-8 flex-[2] text-[13px]"
                  />
                  <Input
                    type="number"
                    placeholder="SL thực đếm"
                    value={newLotQty || ''}
                    onChange={(e) => setNewLotQty(Number(e.target.value) || 0)}
                    className="h-8 flex-1 text-[13px]"
                  />
                  <Button type="button" onClick={handleAddLot} className="text-[13px] font-semibold">
                    <Plus size={14} /> Thêm Lô
                  </Button>
                </div>
              ) : null}

              <Table className="text-[13px]">
                <TableHead>
                  <tr className="border-b border-slate-200">
                    <TableHeaderCell className="px-[10px] py-2">Số Lô</TableHeaderCell>
                    <TableHeaderCell className="p-2 text-center">Tồn sổ</TableHeaderCell>
                    <TableHeaderCell className="p-2 text-center">Thực đếm</TableHeaderCell>
                    <TableHeaderCell className="p-2 text-center">Lệch</TableHeaderCell>
                    {!readOnly ? <TableHeaderCell className="px-[10px] py-2 text-right">Thao tác</TableHeaderCell> : null}
                  </tr>
                </TableHead>
                <TableBody>
                  {lots.map((lot, idx) => {
                    const diff = (Number(lot.actualQty) || 0) - (Number(lot.systemQty) || 0);
                    return (
                      <TableRow key={idx}>
                        <TableCell className="px-[10px] py-2 font-semibold text-slate-800">
                          <div className="flex items-center gap-1.5">
                            <Layers size={13} color="#64748b" />
                            {lot.lotNumber}
                          </div>
                          {lot.expiryDate ? (
                            <span className="text-xs text-slate-500">HSD: {formatDate(lot.expiryDate)}</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="p-2 text-center text-slate-600">{lot.systemQty}</TableCell>
                        <TableCell className="p-2 text-center">
                          {readOnly ? (
                            <strong>{lot.actualQty}</strong>
                          ) : (
                            <Input
                              type="number"
                              value={lot.actualQty}
                              onChange={(e) => {
                                const val = Number(e.target.value) || 0;
                                setLots((prev) =>
                                  prev.map((item, i) => (i === idx ? { ...item, actualQty: val } : item)),
                                );
                              }}
                              className="mx-auto h-8 w-[70px] px-1.5 text-center text-[13px] font-bold"
                            />
                          )}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'p-2 text-center font-bold',
                            diff === 0 ? 'text-green-600' : diff > 0 ? 'text-blue-600' : 'text-red-600',
                          )}
                        >
                          {diff > 0 ? `+${diff}` : diff}
                        </TableCell>
                        {!readOnly ? (
                          <TableCell className="px-[10px] py-2 text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => setLots((prev) => prev.filter((_, i) => i !== idx))}
                              className="text-slate-400"
                              title="Xóa dòng lô này"
                            >
                              <Trash2 size={13} />
                            </Button>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : null}

          {/* TAB SÊ-RI */}
          {(tab === 'serials' || !isLotTracked) && isSerialized ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-[14px] py-3">
                <div>
                  <span className="text-[13px] text-slate-500">Tổng sê-ri xác nhận có mặt:</span>
                  <div className="text-xl font-extrabold text-blue-600">
                    {totalFoundSerials} / {serials.length} chiếc
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[13px] text-slate-500">So với sổ sách:</span>
                  <div
                    className={cn(
                      'text-base font-bold',
                      totalFoundSerials === systemQuantity ? 'text-green-700' : 'text-red-600',
                    )}
                  >
                    {totalFoundSerials === systemQuantity ? 'Đủ 100%' : `Lệch ${totalFoundSerials - systemQuantity} chiếc`}
                  </div>
                </div>
              </div>

              {!readOnly ? (
                <div className="flex gap-2 rounded-md border border-green-200 bg-green-50 p-[10px]">
                  <Input
                    type="text"
                    placeholder="Quét mã vạch hoặc gõ số Sê-ri..."
                    value={newSerialInput}
                    onChange={(e) => setNewSerialInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddSerial();
                    }}
                    className="h-8 flex-1 text-[13px]"
                  />
                  <Button
                    type="button"
                    onClick={handleAddSerial}
                    className="bg-green-600 text-[13px] font-semibold text-white hover:bg-green-700"
                  >
                    <QrCode size={14} /> Quét / Thêm
                  </Button>
                </div>
              ) : null}

              <div className="flex flex-col gap-1.5">
                {serials.map((serial, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      'flex items-center justify-between rounded-md border border-slate-200 px-3 py-2',
                      serial.status === 'FOUND' ? 'bg-white' : serial.status === 'EXTRA' ? 'bg-blue-50' : 'bg-red-50',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[13px] font-bold text-slate-800">{serial.serialNumber}</span>
                      {serial.status === 'EXTRA' ? (
                        <span className="rounded bg-blue-100 px-[5px] py-px text-xs font-semibold text-blue-700">
                          Phát hiện thừa
                        </span>
                      ) : serial.status === 'MISSING' ? (
                        <span className="rounded bg-red-100 px-[5px] py-px text-xs font-semibold text-red-700">
                          Không tìm thấy
                        </span>
                      ) : (
                        <span className="rounded bg-green-100 px-[5px] py-px text-xs font-semibold text-green-700">
                          Khớp sổ sách
                        </span>
                      )}
                    </div>

                    {!readOnly ? (
                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          onClick={() => {
                            setSerials((prev) =>
                              prev.map((item, i) =>
                                i === idx ? { ...item, status: item.status === 'FOUND' ? 'MISSING' : 'FOUND' } : item,
                              ),
                            );
                          }}
                        >
                          {serial.status === 'FOUND' ? 'Báo mất' : 'Đã tìm thấy'}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => setSerials((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-slate-400"
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer Actions */}
        <div className="flex justify-end gap-[10px] border-t border-slate-200 bg-white px-5 py-[14px]">
          <Button type="button" variant="outline" onClick={onClose}>
            Đóng
          </Button>
          {!readOnly ? (
            <Button type="button" onClick={handleApply} className="font-bold">
              Áp dụng số thực đếm ({isLotTracked ? totalLotActual : totalFoundSerials} {unit})
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
