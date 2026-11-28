'use client';

import { ChevronDown, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadSerials } from '../inventory-api';
import { Input } from '../ui/input';
import { cn } from '../ui/cn';

/**
 * Hộp chọn nhiều serial bằng ô tích: mỗi serial đang Trong kho, Đạt ở đúng kho xuất là một dòng.
 * Danh sách mở ngay dưới nút (không nổi lên trên) để không bị khung cuộn của hộp thoại cắt.
 * Chọn tối đa `limit` serial; đủ rồi thì các ô còn lại bị khoá cho tới khi bỏ bớt.
 */
export function SerialCheckboxSelect({
  materialCode,
  warehouse,
  limit,
  value,
  onChange,
}: {
  materialCode: string;
  warehouse?: { id: string; code: string };
  limit: number;
  value: readonly string[];
  onChange: (serials: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<string[]>();
  const [loadError, setLoadError] = useState<string>();
  const [filter, setFilter] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const warehouseId = warehouse?.id;
  const max = Math.max(Math.trunc(limit) || 0, 0);

  useEffect(() => {
    let cancelled = false;
    setOptions(undefined);
    setLoadError(undefined);
    loadSerials(materialCode)
      .then((rows) => {
        if (cancelled) return;
        setOptions(
          rows
            .filter(
              (row) =>
                (!warehouseId || row.currentWarehouseId === warehouseId) &&
                (row.stockState ?? 'IN_STOCK') === 'IN_STOCK' &&
                (row.qualityStatus ?? 'PASSED') === 'PASSED',
            )
            .map((row) => row.serialNumber)
            .sort((left, right) => left.localeCompare(right)),
        );
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(cause instanceof Error ? cause.message : 'Không tải được danh sách serial.');
      });
    return () => {
      cancelled = true;
    };
  }, [materialCode, warehouseId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (options ?? []).filter((serial) => serial.toLowerCase().includes(needle));
  }, [options, filter]);

  const full = value.length >= max;
  const toggle = (serial: string) => {
    if (value.includes(serial)) onChange(value.filter((item) => item !== serial));
    else if (!full) onChange([...value, serial]);
  };
  const selectAllVisible = () => {
    const next = [...value];
    for (const serial of visible) {
      if (next.length >= max) break;
      if (!next.includes(serial)) next.push(serial);
    }
    onChange(next);
  };

  return (
    <div ref={rootRef} className="flex flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex min-h-[42px] w-full cursor-pointer items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 text-left text-sm',
          open ? 'border-primary' : 'border-slate-200 hover:border-slate-300',
        )}
      >
        <span className={cn('min-w-0 flex-1 [overflow-wrap:anywhere]', value.length === 0 && 'text-slate-400')}>
          {value.length === 0 ? '— Chọn serial —' : value.join(', ')}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[13px] font-semibold text-slate-600">
          {value.length}/{max}
          <ChevronDown size={16} className={cn('transition-transform', open && 'rotate-180')} />
        </span>
      </button>

      {open ? (
        <div className="rounded-lg border border-slate-200 bg-white p-2">
          {loadError ? <p className="m-0 px-1 py-2 text-[13px] text-red-700">{loadError}</p> : null}
          {!options && !loadError ? <p className="m-0 px-1 py-2 text-[13px] text-slate-500">Đang tải serial…</p> : null}
          {options ? (
            options.length === 0 ? (
              <p className="m-0 px-1 py-2 text-[13px] text-slate-500">
                Kho {warehouse?.code ?? ''} không có serial nào đang Trong kho và Đạt.
              </p>
            ) : (
              <>
                <div className="relative flex items-center">
                  <Search size={14} className="pointer-events-none absolute left-[0.65rem] text-slate-400" />
                  <Input
                    className="h-8 pl-8 text-[13px]"
                    value={filter}
                    placeholder="Tìm serial…"
                    aria-label="Tìm serial"
                    onChange={(event) => setFilter(event.target.value)}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between px-1 text-[12px] text-slate-500">
                  <span>{options.length} serial sẵn có</span>
                  <span className="flex items-center gap-3">
                    <button
                      type="button"
                      className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-blue-600 hover:underline disabled:cursor-default disabled:text-slate-400 disabled:no-underline"
                      disabled={full || visible.length === 0}
                      onClick={selectAllVisible}
                    >
                      Chọn đủ
                    </button>
                    <button
                      type="button"
                      className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-slate-600 hover:underline disabled:cursor-default disabled:text-slate-400 disabled:no-underline"
                      disabled={value.length === 0}
                      onClick={() => onChange([])}
                    >
                      Bỏ chọn
                    </button>
                  </span>
                </div>
                <div className="mt-1.5 max-h-56 overflow-y-auto">
                  {visible.length === 0 ? (
                    <p className="m-0 px-1 py-2 text-[13px] text-slate-500">Không có serial khớp.</p>
                  ) : (
                    visible.map((serial) => {
                      const checked = value.includes(serial);
                      const blocked = !checked && full;
                      return (
                        <label
                          key={serial}
                          className={cn(
                            'flex items-center gap-2 rounded-md px-2 py-1.5 font-mono text-[13px]',
                            blocked ? 'cursor-not-allowed text-slate-400' : 'cursor-pointer hover:bg-slate-50',
                            checked && 'bg-blue-50 text-blue-800',
                          )}
                        >
                          <input
                            type="checkbox"
                            className="size-4 accent-primary"
                            checked={checked}
                            disabled={blocked}
                            onChange={() => toggle(serial)}
                          />
                          {serial}
                        </label>
                      );
                    })
                  )}
                </div>
              </>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
