'use client';

import type { TransactionType } from '@enterprise-platform/contracts-inventory';
import { useState, useMemo } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRightLeft,
  RotateCcw,
  SlidersHorizontal,
  Search,
  Filter,
  Warehouse as WarehouseIcon,
  Calendar,
  Layers,
} from 'lucide-react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { formatDateTime, formatNoteDates, formatNumber } from '../inventory-labels';
import type { InventoryLedgerRow } from '../inventory-api';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { Input } from '../ui/input';

const METRIC_CARD = 'flex flex-col gap-[0.35rem] rounded-[7px] border border-slate-200 bg-white px-[0.85rem] py-[0.65rem]';
const METRIC_NUMBER = 'text-xl font-bold tabular-nums text-slate-900';

/** Nhãn loại bút toán, nói theo việc thủ kho làm chứ không theo tên enum. */
const TYPE_LABEL: Readonly<Record<TransactionType, string>> = {
  IMPORT: 'Nhập kho',
  EXPORT: 'Xuất kho',
  TRANSFER_IN: 'Nhập kho luân chuyển',
  TRANSFER_OUT: 'Xuất kho luân chuyển',
  BORROW: 'Mượn kho',
  RETURN: 'Trả lại kho',
  ADJUST: 'Điều chỉnh kiểm kê',
};

export function MaterialHistory(props: {
  state: InventoryLedgerRow[] | 'loading' | 'error' | undefined;
  unit?: string;
  warehouseCodeById: ReadonlyMap<string, string>;
}) {
  const [filterType, setFilterType] = useState<string>('ALL');
  const [filterWarehouse, setFilterWarehouse] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const rows = useMemo(() => {
    if (!props.state || props.state === 'loading' || props.state === 'error') {
      return [];
    }
    return props.state;
  }, [props.state]);

  // Thống kê nhanh Tổng nhập, Tổng xuất, Tồn ròng phát sinh
  const stats = useMemo(() => {
    let totalIn = 0;
    let totalOut = 0;
    for (const item of rows) {
      if (item.quantity > 0) {
        totalIn += item.quantity;
      } else {
        totalOut += Math.abs(item.quantity);
      }
    }
    return {
      totalIn,
      totalOut,
      net: totalIn - totalOut,
      count: rows.length,
    };
  }, [rows]);

  // Bộ lọc kho duy nhất xuất hiện trong lịch sử
  const warehouseOptions = useMemo(() => {
    const list: { value: string; label: string }[] = [{ value: 'ALL', label: 'Tất cả kho' }];
    const seen = new Set<string>();
    for (const r of rows) {
      const wCode = props.warehouseCodeById.get(r.warehouseId) ?? r.warehouseId;
      if (wCode && !seen.has(wCode)) {
        seen.add(wCode);
        list.push({ value: wCode, label: `Kho ${wCode}` });
      }
    }
    return list;
  }, [rows, props.warehouseCodeById]);

  // Tùy chọn loại giao dịch
  const typeOptions = useMemo(() => [
    { value: 'ALL', label: 'Tất cả giao dịch' },
    { value: 'IN', label: 'Nhập kho (+)' },
    { value: 'OUT', label: 'Xuất kho (−)' },
    { value: 'ADJUST', label: 'Cân kho / Kiểm kê' },
  ], []);

  // Lọc danh sách giao dịch
  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return rows.filter((entry) => {
      // Lọc theo hướng luân chuyển
      if (filterType === 'IN' && entry.quantity <= 0) return false;
      if (filterType === 'OUT' && entry.quantity >= 0) return false;
      if (filterType === 'ADJUST' && entry.type !== 'ADJUST') return false;

      // Lọc theo kho
      if (filterWarehouse !== 'ALL') {
        const wCode = props.warehouseCodeById.get(entry.warehouseId) ?? entry.warehouseId;
        if (wCode !== filterWarehouse) return false;
      }

      // Lọc theo từ khóa (ghi chú, mã phiếu, sê-ri)
      if (query) {
        const noteMatch = (entry.note ?? '').toLowerCase().includes(query);
        const codeMatch = (entry.transactionCode ?? '').toLowerCase().includes(query);
        const refMatch = (entry.referenceId ?? '').toLowerCase().includes(query);
        const serialMatch = (entry.serialNumber ?? '').toLowerCase().includes(query);
        if (!noteMatch && !codeMatch && !refMatch && !serialMatch) return false;
      }

      return true;
    });
  }, [rows, filterType, filterWarehouse, searchQuery, props.warehouseCodeById]);

  if (props.state === undefined || props.state === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center gap-[0.6rem] rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-9 text-center">
        <div className="size-6 animate-spin rounded-full border-[2.5px] border-slate-200 border-t-primary" />
        <span>Đang nạp dữ liệu lịch sử xuất nhập...</span>
      </div>
    );
  }

  if (props.state === 'error') {
    return (
      <div className="flex flex-col items-center justify-center gap-[0.6rem] rounded-lg border border-dashed border-red-200 bg-red-50 px-6 py-9 text-center text-sm font-medium text-red-700">
        <span>Không thể truy vấn lịch sử nhập/xuất của vật tư này từ sổ cái.</span>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-[0.6rem] rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-9 text-center">
        <Layers size={36} strokeWidth={1.5} color="#94a3b8" />
        <span className="font-semibold text-slate-600">Chưa có phát sinh giao dịch</span>
        <span className="text-[13px] text-slate-400">
          Vật tư này chưa từng được nhập, xuất hoặc điều chỉnh kiểm kê nào trong hệ thống.
        </span>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-[0.85rem]">
      {/* 1. THANH TỔNG HỢP NHANH (KPI METRICS) */}
      <div className="grid grid-cols-2 gap-[0.65rem] sm:grid-cols-4">
        <div className={METRIC_CARD}>
          <div className="flex items-center gap-[0.35rem] text-xs font-semibold uppercase tracking-[0.02em] text-slate-500">
            <Calendar size={13} color="#64748b" />
            <span>Tổng phát sinh</span>
          </div>
          <div className="flex items-baseline gap-[0.35rem]">
            <strong className={METRIC_NUMBER}>{formatNumber(stats.count)}</strong> <small className="text-xs font-medium text-slate-500">bút toán</small>
          </div>
        </div>

        <div className={cn(METRIC_CARD, 'border-green-200 bg-green-50')}>
          <div className="flex items-center gap-[0.35rem] text-xs font-semibold uppercase tracking-[0.02em] text-slate-500">
            <ArrowDownLeft size={13} color="#15803d" />
            <span>Tổng nhập vào</span>
          </div>
          <div className="flex items-baseline gap-[0.35rem] text-green-700">
            <strong className={cn(METRIC_NUMBER, 'text-green-700')}>+{formatNumber(stats.totalIn)}</strong> <small className="text-xs font-medium text-slate-500">{props.unit ?? ''}</small>
          </div>
        </div>

        <div className={cn(METRIC_CARD, 'border-red-200 bg-red-50')}>
          <div className="flex items-center gap-[0.35rem] text-xs font-semibold uppercase tracking-[0.02em] text-slate-500">
            <ArrowUpRight size={13} color="#b91c1c" />
            <span>Tổng xuất ra</span>
          </div>
          <div className="flex items-baseline gap-[0.35rem] text-red-700">
            <strong className={cn(METRIC_NUMBER, 'text-red-700')}>−{formatNumber(stats.totalOut)}</strong> <small className="text-xs font-medium text-slate-500">{props.unit ?? ''}</small>
          </div>
        </div>

        <div className={METRIC_CARD}>
          <div className="flex items-center gap-[0.35rem] text-xs font-semibold uppercase tracking-[0.02em] text-slate-500">
            <SlidersHorizontal size={13} color="#2563eb" />
            <span>Biến động ròng</span>
          </div>
          <div className="flex items-baseline gap-[0.35rem]">
            <strong className={cn(METRIC_NUMBER, stats.net >= 0 ? 'text-green-700' : 'text-red-700')}>
              {stats.net > 0 ? `+${formatNumber(stats.net)}` : formatNumber(stats.net)}
            </strong>{' '}
            <small className="text-xs font-medium text-slate-500">{props.unit ?? ''}</small>
          </div>
        </div>
      </div>

      {/* 2. THANH CÔNG CỤ TÌM KIẾM & BỘ LỌC */}
      <div className="flex flex-wrap items-center justify-between gap-[0.65rem] rounded-lg border border-slate-200 bg-slate-50 px-3 py-[0.55rem]">
        <div className="relative flex min-w-[220px] flex-1 items-center">
          <Search size={14} className="pointer-events-none absolute left-[0.65rem] text-slate-400" />
          <Input
            type="text"
            className="h-8 pl-8 text-[13px]"
            placeholder="Tìm theo nội dung, mã kiểm kê, phiếu xuất/lắp..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[155px]">
            <SearchableSelect
              options={typeOptions}
              value={filterType}
              onChange={(val) => setFilterType(val || 'ALL')}
              placeholder="Loại giao dịch"
            />
          </div>

          {warehouseOptions.length > 2 ? (
            <div className="min-w-[145px]">
              <SearchableSelect
                options={warehouseOptions}
                value={filterWarehouse}
                onChange={(val) => setFilterWarehouse(val || 'ALL')}
                placeholder="Chọn kho"
              />
            </div>
          ) : null}

          {(filterType !== 'ALL' || filterWarehouse !== 'ALL' || searchQuery) ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setFilterType('ALL');
                setFilterWarehouse('ALL');
                setSearchQuery('');
              }}
              title="Đặt lại bộ lọc"
            >
              <RotateCcw size={12} />
              <span>Xóa lọc</span>
            </Button>
          ) : null}
        </div>
      </div>

      {/* 3. DANH SÁCH GIAO DỊCH DẠNG THẺ DÒNG THỜI GIAN HIỆN ĐẠI */}
      <div className="flex max-h-[480px] flex-col gap-[0.55rem] overflow-y-auto pr-0.5">
        {filteredRows.map((entry) => {
          const isPositive = entry.quantity > 0;
          const warehouseCode = props.warehouseCodeById.get(entry.warehouseId) ?? entry.warehouseId;
          const typeText = TYPE_LABEL[entry.type] ?? entry.type;

          return (
            <div
              key={entry.id}
              className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-[0.95rem] py-3 transition-[border-color,box-shadow] hover:border-blue-200 hover:shadow-[0_2px_6px_rgba(37,99,235,0.05)]"
            >
              {/* Cột trái: Biểu tượng & Trực quan luồng */}
              <div
                className={cn(
                  'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border',
                  isPositive ? 'border-green-200 bg-green-100 text-green-700' : 'border-red-200 bg-red-100 text-red-700',
                )}
                title={isPositive ? 'Nhập / Tăng tồn kho' : 'Xuất / Giảm tồn kho'}
              >
                {entry.type === 'ADJUST' ? (
                  <SlidersHorizontal size={15} />
                ) : entry.type === 'TRANSFER_IN' || entry.type === 'TRANSFER_OUT' ? (
                  <ArrowRightLeft size={15} />
                ) : isPositive ? (
                  <ArrowDownLeft size={15} />
                ) : (
                  <ArrowUpRight size={15} />
                )}
              </div>

              {/* Cột giữa: Nội dung chi tiết */}
              <div className="flex min-w-0 flex-1 flex-col gap-[0.35rem]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-[0.45rem]">
                    <span
                      className={cn(
                        'inline-flex items-center rounded border px-[7px] py-px text-xs font-bold',
                        isPositive ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-rose-200 bg-rose-50 text-rose-700',
                      )}
                    >
                      {typeText}
                    </span>

                    {warehouseCode ? (
                      <span className="inline-flex items-center gap-[3px] rounded border border-slate-300 bg-slate-100 px-1.5 py-px text-xs font-semibold text-slate-700">
                        <WarehouseIcon size={11} />
                        <span>{warehouseCode}</span>
                      </span>
                    ) : null}

                    {entry.transactionCode ? (
                      <span className="rounded border border-slate-200 bg-slate-50 px-[5px] py-px font-mono text-xs text-slate-500" title="Mã bút toán sổ cái">
                        {entry.transactionCode}
                      </span>
                    ) : null}
                  </div>

                  <div className="inline-flex items-center gap-1 text-xs font-medium tabular-nums text-slate-500">
                    <Calendar size={12} />
                    <span>{formatDateTime(entry.createdAt)}</span>
                  </div>
                </div>

                {/* Diễn giải chi tiết hoặc lý do giao dịch */}
                {entry.note ? (
                  <div className="rounded-r border-l-[2.5px] border-primary bg-slate-50 px-[0.65rem] py-[0.35rem]">
                    <p className="m-0 text-[13px] leading-[1.45] text-slate-800 [word-break:break-word]">{formatNoteDates(entry.note)}</p>
                  </div>
                ) : (
                  <div className="text-xs italic text-slate-400">
                    <small className="text-xs font-medium text-slate-500">Không có ghi chú diễn giải</small>
                  </div>
                )}

                {/* Phụ lục: Sê-ri hoặc Tham chiếu */}
                {entry.serialNumber || entry.referenceId ? (
                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    {entry.serialNumber ? (
                      <span className="rounded bg-slate-100 px-1.5 py-px text-xs text-slate-600 [&_strong]:font-semibold [&_strong]:text-slate-900">
                        Sê-ri: <strong>{entry.serialNumber}</strong>
                      </span>
                    ) : null}
                    {entry.referenceId ? (
                      <span className="rounded bg-slate-100 px-1.5 py-px text-xs text-slate-600 [&_strong]:font-semibold [&_strong]:text-slate-900">
                        Mã tham chiếu: <strong>{entry.referenceId}</strong>
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/* Cột phải: Số lượng biến động */}
              <div className="flex min-w-[90px] shrink-0 flex-col items-end justify-center">
                <div
                  className={cn(
                    'inline-flex items-baseline gap-0.5 tabular-nums',
                    isPositive ? 'text-green-700' : 'text-red-700',
                  )}
                >
                  <span className="text-sm font-extrabold">{isPositive ? '+' : '−'}</span>
                  <span className="text-xl font-extrabold">{formatNumber(Math.abs(entry.quantity))}</span>
                  <span className="ml-0.5 text-xs font-semibold text-slate-500">{props.unit ?? ''}</span>
                </div>
              </div>
            </div>
          );
        })}

        {filteredRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-[13px] text-slate-500">
            <Filter size={24} strokeWidth={1.5} color="#94a3b8" />
            <span>Không tìm thấy giao dịch nào khớp với điều kiện lọc hiện tại.</span>
          </div>
        ) : null}
      </div>

      {/* 4. FOOTER ĐẾM SỐ DÒNG */}
      <div className="flex items-center justify-end pt-1 text-xs text-slate-500 [&_strong]:text-slate-900">
        <span>
          Hiển thị <strong>{filteredRows.length}</strong> / <strong>{rows.length}</strong> giao dịch
        </span>
      </div>
    </div>
  );
}
