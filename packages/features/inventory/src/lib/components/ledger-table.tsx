'use client';

import type { Material, TransactionType } from '@enterprise-platform/contracts-inventory';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { InventoryLedgerRow } from '../inventory-api';
import { exportLedgerToExcel } from '../inventory-export';
import {
  TRANSACTION_TYPE_LABEL,
  formatDateTime,
  formatNoteDates,
  formatNumber,
  referenceLabel,
} from '../inventory-labels';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle } from '../ui/card';
import { cn } from '../ui/cn';
import { Label } from '../ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableWrap } from '../ui/table';

export function LedgerTable({
  rows,
  materialById,
  warehouseById,
}: {
  rows?: readonly InventoryLedgerRow[];
  materialById: ReadonlyMap<string, Material>;
  warehouseById: ReadonlyMap<string, string>;
}) {
  const [type, setType] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const all = rows ?? [];

  const typeOptions = useMemo(
    () => [
      { value: '', label: 'Tất cả loại giao dịch' },
      ...Object.entries(TRANSACTION_TYPE_LABEL).map(([val, lbl]) => ({ value: val, label: lbl })),
    ],
    [],
  );

  const warehouseOptions = useMemo(
    () => [
      { value: '', label: 'Tất cả kho' },
      ...[...warehouseById].map(([id, code]) => ({ value: id, label: code })),
    ],
    [warehouseById],
  );

  const visible = useMemo(
    () =>
      all.filter((entry) => {
        if (type && entry.type !== type) return false;
        if (warehouseId && entry.warehouseId !== warehouseId) return false;
        // Ngày "đến" tính hết cả ngày, nếu không người dùng chọn cùng một ngày
        // cho cả hai ô sẽ không thấy giao dịch nào.
        if (from && entry.createdAt < from) return false;
        if (to && entry.createdAt > `${to}T23:59:59.999Z`) return false;
        return true;
      }),
    [all, type, warehouseId, from, to],
  );

  const filtered = Boolean(type || warehouseId || from || to);

  const handleExport = () => {
    exportLedgerToExcel({
      rows: visible,
      materialById,
      warehouseById,
    });
  };

  return (
    <Card className="gap-0">
      <CardHeader className="mb-4 flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="m-0 text-base font-bold tracking-[-0.02em] text-slate-900">Nhật ký giao dịch</CardTitle>
        <div className="flex items-center gap-3">
          <span className="text-[0.8125rem] tabular-nums text-slate-500">
            {formatNumber(visible.length)}
            {filtered ? ` / ${formatNumber(all.length)}` : ''} giao dịch
          </span>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="gap-1.5"
            onClick={handleExport}
            title="Xuất nhật ký giao dịch ra tệp Excel"
          >
            <Download size={15} />
            <span>Xuất Excel</span>
          </Button>
        </div>
      </CardHeader>

      <div className="mb-[0.35rem] mt-[0.9rem] flex flex-wrap items-end gap-[0.7rem]">
        <div className="flex min-w-[13rem] flex-col gap-1">
          <Label className="text-xs font-bold text-slate-500">Loại giao dịch</Label>
          <SearchableSelect
            options={typeOptions}
            value={type}
            placeholder="Tất cả"
            onChange={(val) => setType(val)}
            clearable
          />
        </div>
        <div className="flex min-w-[11rem] flex-col gap-1">
          <Label className="text-xs font-bold text-slate-500">Kho</Label>
          <SearchableSelect
            options={warehouseOptions}
            value={warehouseId}
            placeholder="Tất cả"
            onChange={(val) => setWarehouseId(val)}
            clearable
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-bold text-slate-500">Từ ngày</Label>
          <div className="min-w-[9.5rem]">
            <DatePickerInput value={from} onChange={setFrom} height={34} />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-bold text-slate-500">Đến ngày</Label>
          <div className="min-w-[9.5rem]">
            <DatePickerInput value={to} onChange={setTo} height={34} />
          </div>
        </div>
        {filtered ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() => {
              setType('');
              setWarehouseId('');
              setFrom('');
              setTo('');
            }}
          >
            Xoá lọc
          </Button>
        ) : null}
      </div>

      <TableWrap className="rounded-[0.85rem] border border-slate-200 bg-white">
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Chứng từ</TableHeaderCell>
              <TableHeaderCell>Thời gian</TableHeaderCell>
              <TableHeaderCell>Loại</TableHeaderCell>
              <TableHeaderCell>Vật tư</TableHeaderCell>
              <TableHeaderCell>Kho</TableHeaderCell>
              <TableHeaderCell className="text-center">Biến động</TableHeaderCell>
              <TableHeaderCell>Nguồn</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {visible.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="font-bold text-slate-900">{entry.transactionCode}</TableCell>
                <TableCell>{formatDateTime(entry.createdAt)}</TableCell>
                <TableCell>{TRANSACTION_TYPE_LABEL[entry.type as TransactionType] ?? entry.type}</TableCell>
                <TableCell className="font-bold text-slate-900">
                  <div className="flex items-center gap-[6px]">
                    <span>{materialById.get(entry.materialId)?.code ?? '—'}</span>
                    {materialById.get(entry.materialId)?.isActive === false ? (
                      <Badge variant="outline" className="h-auto rounded px-[5px] py-px text-[12px] font-medium text-slate-500">
                        Ngừng dùng
                      </Badge>
                    ) : null}
                  </div>
                  <span className="mt-[0.2rem] block text-[0.8125rem] font-normal text-slate-500">{materialById.get(entry.materialId)?.name}</span>
                </TableCell>
                <TableCell>{warehouseById.get(entry.warehouseId) ?? '—'}</TableCell>
                <TableCell
                  className={cn(
                    'text-center font-bold tabular-nums',
                    entry.quantity < 0 ? 'text-red-700' : 'text-green-700',
                  )}
                >
                  {entry.quantity > 0 ? '+' : ''}
                  {formatNumber(entry.quantity)}
                </TableCell>
                <TableCell>
                  {referenceLabel(entry.referenceType)}
                  {entry.note ? <span className="mt-[0.2rem] block text-[0.8125rem] font-normal text-slate-500">{formatNoteDates(entry.note)}</span> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {visible.length === 0 ? (
          <p className="m-0 py-8 text-center text-slate-500">
            {all.length === 0 ? 'Chưa có giao dịch.' : 'Không có giao dịch nào khớp bộ lọc.'}
          </p>
        ) : null}
      </TableWrap>
    </Card>
  );
}
