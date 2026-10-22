'use client';

import type { BrandRules } from '@enterprise-platform/shared-brand-icon';
import { Plus, X } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { IconButton } from '../library/library-ui';
import { CommitField } from './commit-field';
import {
  NUMERIC_RULES,
  addStrokeWidth,
  formatDecimal,
  parseDecimal,
  removeStrokeWidth,
  setNumericRule,
  setRequirePalette,
  type RulesEdit,
} from './rules-model';

function Row({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-slate-100 py-3',
        wide && 'items-start',
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-900">{label}</p>
        {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

/** Công tắc bật/tắt dựng bằng nút (role switch) để dùng được bằng bàn phím và trình đọc màn hình. */
function Switch({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40',
        checked ? 'bg-blue-600' : 'bg-slate-300',
      )}
      onClick={() => onChange(!checked)}
      role="switch"
      title={label}
      type="button"
    >
      <span
        aria-hidden
        className={cn('absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-all', checked ? 'left-[1.125rem]' : 'left-0.5')}
      />
    </button>
  );
}

/** Quy chuẩn: độ dày nét cho phép, bốn ngưỡng dạng số và công tắc bắt buộc dùng màu trong bảng. Sửa là lưu ngay. */
export function RulesEditor({ rules, onChange }: { rules: BrandRules; onChange: (rules: BrandRules) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState('');

  const apply = (edit: RulesEdit): boolean => {
    if (edit.ok) {
      setError(null);
      onChange(edit.rules);
      return true;
    }
    setError(edit.error);
    return false;
  };

  const submitWidth = (event: FormEvent) => {
    event.preventDefault();
    const value = parseDecimal(width);
    if (value === null) {
      setError('Hãy nhập một số, ví dụ 1,75.');
      return;
    }
    if (apply(addStrokeWidth(rules, value))) setWidth('');
  };

  return (
    <div>
      <Row hint="Nét ngoài danh sách này bị nhắc khi kiểm tra" label="Độ dày nét cho phép" wide>
        <div className="flex flex-wrap items-center gap-1.5">
          {rules.allowedStrokeWidths.map((value) => (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 text-xs font-medium tabular-nums text-slate-700"
              data-testid="stroke-chip"
              key={value}
            >
              {formatDecimal(value)}
              <button
                aria-label={`Bỏ độ dày ${formatDecimal(value)}`}
                className="grid size-4 place-items-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-40"
                disabled={rules.allowedStrokeWidths.length <= 1}
                onClick={() => apply(removeStrokeWidth(rules, value))}
                title="Bỏ độ dày này"
                type="button"
              >
                <X aria-hidden className="size-3" />
              </button>
            </span>
          ))}
          <form className="flex items-center gap-1" onSubmit={submitWidth}>
            <Input
              aria-label="Độ dày nét mới"
              className="h-7 w-16 rounded-md px-2 text-center text-xs"
              inputMode="decimal"
              onChange={(event) => setWidth(event.target.value)}
              placeholder="1,25"
              value={width}
            />
            <IconButton label="Thêm độ dày" tone="primary" type="submit">
              <Plus aria-hidden className="size-4" />
            </IconButton>
          </form>
        </div>
      </Row>

      {NUMERIC_RULES.map((field) => (
        <Row hint={field.hint} key={field.key} label={field.label}>
          <CommitField
            aria-label={field.label}
            className="w-20 text-right tabular-nums"
            inputMode="decimal"
            onCommit={(text) => {
              const value = parseDecimal(text);
              if (value === null) {
                setError(`${field.label}: hãy nhập một số.`);
                return;
              }
              setError(null);
              onChange(setNumericRule(rules, field.key, value));
            }}
            value={formatDecimal(rules[field.key])}
          />
        </Row>
      ))}

      <Row hint="Màu ngoài bảng màu bị nhắc khi kiểm tra" label="Bắt buộc dùng màu trong bảng">
        <Switch
          checked={rules.requirePaletteColors}
          label="Bắt buộc dùng màu trong bảng"
          onChange={(checked) => onChange(setRequirePalette(rules, checked))}
        />
      </Row>

      {error ? (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
