'use client';

import { useId, useState, useMemo } from 'react';
import { Search, X, Check, CheckSquare, Square } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { searchText } from './authorization-client';

interface PermissionPickerProps {
  readonly label: string;
  readonly options: readonly {
    id: string;
    label: string;
    description?: string;
    disabled?: boolean;
    group?: string;
  }[];
  readonly values: readonly string[];
  readonly onChange: (values: string[]) => void;
}

export function PermissionPicker({
  label,
  options,
  values,
  onChange,
}: PermissionPickerProps) {
  const baseId = useId();
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const q = searchText(query);
    if (!q) return options;
    return options.filter((o) =>
      searchText(`${o.label} ${o.description ?? ''} ${o.group ?? ''}`).includes(q),
    );
  }, [options, query]);

  const enabledMatches = useMemo(
    () => matches.filter((o) => !o.disabled),
    [matches],
  );

  const allSelected =
    enabledMatches.length > 0 &&
    enabledMatches.every((o) => values.includes(o.id));

  const handleToggleAll = () => {
    if (allSelected) {
      const matchIds = new Set(enabledMatches.map((o) => o.id));
      onChange(values.filter((v) => !matchIds.has(v)));
    } else {
      const newValues = new Set([...values, ...enabledMatches.map((o) => o.id)]);
      onChange(Array.from(newValues));
    }
  };

  return (
    <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-800">{label}</span>
          <Badge variant="secondary" className="px-2 py-0.5 text-xs font-semibold">
            {values.length} / {options.length}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleToggleAll}
            disabled={!enabledMatches.length}
            className="h-7 px-2 text-xs font-medium text-slate-600 hover:text-blue-600"
          >
            {allSelected ? (
              <>
                <Square className="mr-1 size-3.5" />
                Bỏ chọn lọc
              </>
            ) : (
              <>
                <CheckSquare className="mr-1 size-3.5" />
                Chọn tất cả ({enabledMatches.length})
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <Input
          aria-label={`Tìm ${label.toLowerCase()}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Tìm kiếm trong ${options.length} ${label.toLowerCase()}...`}
          className="h-9 bg-white pl-9 pr-8 text-sm"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Xóa từ khóa tìm kiếm"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1">
        {matches.map((option) => {
          const isChecked = values.includes(option.id);
          const inputId = `${baseId}-${option.id}`;

          return (
            <label
              key={option.id}
              htmlFor={inputId}
              className={`group flex cursor-pointer items-start gap-3 rounded-lg border p-2.5 text-sm transition-all ${
                isChecked
                  ? 'border-blue-300 bg-blue-50/70 text-blue-950 shadow-2xs'
                  : 'border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50 text-slate-700'
              } ${option.disabled ? 'cursor-not-allowed opacity-60' : ''}`}
            >
              <div className="pt-0.5">
                <input
                  id={inputId}
                  type="checkbox"
                  className="sr-only"
                  checked={isChecked}
                  disabled={option.disabled}
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? [...values, option.id]
                        : values.filter((v) => v !== option.id),
                    )
                  }
                />
                <div
                  className={`flex size-4.5 items-center justify-center rounded-sm border transition-colors ${
                    isChecked
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-300 bg-white group-hover:border-slate-400'
                  }`}
                >
                  {isChecked && <Check className="size-3.5 stroke-[3]" />}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-900 leading-tight">
                    {option.label}
                  </span>
                  {option.group && (
                    <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                      {option.group}
                    </span>
                  )}
                </div>
                {option.description && (
                  <p className="mt-0.5 text-xs text-slate-500 leading-normal line-clamp-2">
                    {option.description}
                  </p>
                )}
              </div>
            </label>
          );
        })}

        {!matches.length && (
          <div className="flex flex-col items-center justify-center py-6 text-center text-slate-400">
            <Search className="mb-1.5 size-6 opacity-40" />
            <p className="text-sm">Không tìm thấy mục nào phù hợp với từ khóa.</p>
          </div>
        )}
      </div>
    </div>
  );
}
