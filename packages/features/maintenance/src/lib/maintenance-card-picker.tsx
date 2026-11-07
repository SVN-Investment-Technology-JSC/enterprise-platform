'use client';

import type { DashboardCardCatalog } from '@enterprise-platform/feature-module-shell';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { cn } from './utils';

export interface MaintenanceCardPickerProps<TData> {
  readonly catalog: DashboardCardCatalog<TData>;
  readonly selection: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
  /** Trần số thẻ được bật; bỏ trống là không giới hạn. */
  readonly max?: number;
  readonly disabled?: boolean;
}

/**
 * Màn chọn thẻ Tổng quan của Bảo trì: bật/tắt và sắp xếp bằng nút lên/xuống. Cùng luật với `DashboardCardPicker` của
 * module-shell (thẻ đã bật xếp trước theo đúng thứ tự hiển thị), nhưng dựng bằng Checkbox/Button của shadcn + Tailwind
 * để đồng bộ giao diện với các màn khác của phân hệ; bản dùng chung (còn phục vụ Kho, Quy trình) giữ nguyên.
 */
export function MaintenanceCardPicker<TData>({
  catalog,
  selection,
  onChange,
  max,
  disabled,
}: MaintenanceCardPickerProps<TData>) {
  const atLimit = max !== undefined && selection.length >= max;

  const toggle = (id: string) => {
    if (selection.includes(id)) {
      onChange(selection.filter((current) => current !== id));
      return;
    }
    if (atLimit) return;
    onChange([...selection, id]);
  };

  const move = (id: string, delta: number) => {
    const from = selection.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= selection.length) return;
    const next = [...selection];
    [next[from], next[to]] = [next[to], next[from]];
    onChange(next);
  };

  const enabled = selection
    .map((id) => catalog.find((card) => card.id === id))
    .filter((card): card is (typeof catalog)[number] => card !== undefined);
  const rest = catalog.filter((card) => !selection.includes(card.id));

  return (
    <div>
      <div className="flex flex-col gap-2">
        {[...enabled, ...rest].map((card) => {
          const on = selection.includes(card.id);
          const index = selection.indexOf(card.id);
          const blocked = disabled || (!on && atLimit);
          return (
            <div
              key={card.id}
              className={cn(
                'flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                on ? 'border-blue-200 bg-blue-50/60' : 'border-border bg-white',
                blocked && !on && 'opacity-60',
              )}
            >
              <Checkbox
                checked={on}
                disabled={blocked}
                aria-label={card.title}
                onCheckedChange={() => toggle(card.id)}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <strong className="text-sm font-semibold text-slate-900">{card.title}</strong>
                <small className="text-[0.8125rem] text-muted-foreground">{card.description}</small>
              </span>
              {on ? (
                <span className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    disabled={disabled || index === 0}
                    aria-label={`Đưa ${card.title} lên trên`}
                    onClick={() => move(card.id, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    disabled={disabled || index === selection.length - 1}
                    aria-label={`Đưa ${card.title} xuống dưới`}
                    onClick={() => move(card.id, 1)}
                  >
                    <ArrowDown />
                  </Button>
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {max !== undefined ? (
        <p className="mt-3 text-[0.8125rem] text-muted-foreground">
          Đã chọn {selection.length}/{max} thẻ.
        </p>
      ) : null}
    </div>
  );
}
