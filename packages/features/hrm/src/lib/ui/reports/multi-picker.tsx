'use client';
import { useMemo, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { Check, ChevronDown } from 'lucide-react';
import { normalizeSearchText } from '../../hrm-employee-view';
import { cn } from '../../utils';

export interface MultiPickerOption {
  readonly value: string;
  readonly label: string;
  /** Dòng phụ (mã nhân viên, phòng ban...). */
  readonly hint?: string;
}

/**
 * Ô chọn nhiều giá trị bằng hộp tích. `selected` rỗng nghĩa là "tất cả" (bộ lọc không áp dụng). Có ô tìm khi danh sách dài.
 * `minSelected` dùng cho danh sách cột: không cho bỏ tích hết.
 */
export function MultiPicker({
  label,
  options,
  selected,
  onChange,
  emptyLabel = 'Tất cả',
  searchable = false,
  minSelected = 0,
  width = 'w-56',
}: {
  label: string;
  options: readonly MultiPickerOption[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
  emptyLabel?: string;
  searchable?: boolean;
  minSelected?: number;
  width?: string;
}) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const q = normalizeSearchText(query);
    if (!q) return options;
    return options.filter((o) => normalizeSearchText(`${o.label} ${o.hint ?? ''}`).includes(q));
  }, [options, query]);
  const chosen = new Set(selected);
  const summary =
    selected.length === 0 ? emptyLabel : selected.length === options.length ? 'Tất cả' : `${selected.length} đã chọn`;

  function toggle(value: string) {
    if (chosen.has(value)) {
      if (selected.length <= minSelected) return;
      onChange(selected.filter((v) => v !== value));
    } else onChange([...selected, value]);
  }

  return (
    <div className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
      <span>{label}</span>
      <Popover.Root>
        <Popover.Trigger
          aria-label={`${label}: ${summary}`}
          className={cn(
            'inline-flex h-9 items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-normal text-slate-800 shadow-xs outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-400',
            width,
          )}
        >
          <span className="truncate">{summary}</span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-slate-400" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="start" sideOffset={4} className="z-[100]">
            <Popover.Popup className="w-72 rounded-lg border border-slate-200 bg-white p-2 text-xs shadow-xl outline-none">
              {searchable ? (
                <input
                  aria-label={`Tìm ${label.toLowerCase()}`}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Tìm..."
                  className="mb-2 h-8 w-full rounded-md border border-slate-200 px-2 text-xs outline-none focus:border-blue-400"
                />
              ) : null}
              <div className="mb-1 flex items-center justify-between px-1 text-[11px] font-semibold text-blue-700">
                <button type="button" className="hover:underline" onClick={() => onChange([...new Set([...selected, ...visible.map((o) => o.value)])])}>
                  Chọn tất cả{query ? ' kết quả' : ''}
                </button>
                <button
                  type="button"
                  className="hover:underline"
                  onClick={() => onChange(minSelected > 0 ? options.slice(0, minSelected).map((o) => o.value) : [])}
                >
                  {minSelected > 0 ? 'Chỉ giữ mặc định' : 'Bỏ chọn'}
                </button>
              </div>
              <ul role="listbox" aria-multiselectable="true" aria-label={label} className="max-h-64 space-y-0.5 overflow-y-auto">
                {visible.length === 0 ? <li className="px-2 py-3 text-center text-slate-500">Không có kết quả</li> : null}
                {visible.map((o) => {
                  const on = chosen.has(o.value);
                  return (
                    <li key={o.value} role="option" aria-selected={on}>
                      <button
                        type="button"
                        onClick={() => toggle(o.value)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-50"
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            'flex size-4 shrink-0 items-center justify-center rounded border',
                            on ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white',
                          )}
                        >
                          {on ? <Check className="size-3" /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-slate-800">{o.label}</span>
                          {o.hint ? <span className="block truncate text-[11px] text-slate-500">{o.hint}</span> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
