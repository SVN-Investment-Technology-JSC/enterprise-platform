'use client';

import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { HrmOrgUnitOption } from '@enterprise-platform/contracts-hrm';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@enterprise-platform/shared-ui';
import { cn } from '../../utils';
import {
  SCOPE_TYPE_LABELS,
  filterOptionsByText,
  type ScopeDraft,
} from '../../hrm-work-schedule-model';
import { Button } from '../button';
import { Input } from '../input';
import { Checkbox, Field, Notice } from './common';

const MAX_LISTED = 100;

function Chips({
  items,
  onRemove,
  empty,
}: {
  items: { value: string; label: string }[];
  onRemove: (value: string) => void;
  empty: string;
}) {
  if (!items.length) return <span className="text-[11px] text-slate-400">{empty}</span>;
  return (
    <ul className="flex max-h-24 flex-wrap gap-1 overflow-auto">
      {items.map((item) => (
        <li
          key={item.value}
          className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 py-0.5 pr-1 pl-2 text-[11px] text-blue-800"
        >
          <span className="max-w-56 truncate">{item.label}</span>
          <button
            type="button"
            aria-label={`Bỏ ${item.label}`}
            className="cursor-pointer rounded-full px-1 text-blue-500 hover:bg-blue-100 hover:text-blue-800"
            onClick={() => onRemove(item.value)}
          >
            <X className="size-3" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

function EmployeeMultiPicker({
  options,
  selected,
  onChange,
}: {
  options: readonly SearchableSelectOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [text, setText] = useState('');
  const filtered = useMemo(() => filterOptionsByText(options, text), [options, text]);
  const shown = filtered.slice(0, MAX_LISTED);
  const selectedSet = new Set(selected);
  const toggle = (id: string, on: boolean) =>
    onChange(on ? [...selected, id] : selected.filter((x) => x !== id));
  const allShownSelected = shown.length > 0 && shown.every((o) => selectedSet.has(o.value));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          aria-label="Tìm nhân viên theo mã hoặc tên"
          placeholder="Tìm theo mã hoặc tên nhân viên (gõ tiếng Việt không dấu)…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={!shown.length}
          onClick={() =>
            onChange(
              allShownSelected
                ? selected.filter((id) => !shown.some((o) => o.value === id))
                : [...new Set([...selected, ...shown.map((o) => o.value)])],
            )
          }
        >
          {allShownSelected ? 'Bỏ chọn kết quả' : 'Chọn kết quả đang lọc'}
        </Button>
      </div>
      <ul
        className="max-h-44 overflow-auto rounded-lg border border-slate-200 bg-white"
        aria-label="Danh sách nhân viên"
      >
        {shown.length === 0 ? (
          <li className="px-3 py-4 text-center text-xs text-slate-500">Không tìm thấy nhân viên phù hợp.</li>
        ) : (
          shown.map((o) => (
            <li key={o.value} className="border-b border-slate-100 px-3 py-1.5 last:border-b-0">
              <Checkbox
                checked={selectedSet.has(o.value)}
                onChange={(on) => toggle(o.value, on)}
                label={o.label}
                className="w-full"
              />
            </li>
          ))
        )}
      </ul>
      {filtered.length > MAX_LISTED ? (
        <span className="text-[11px] text-slate-500">
          Đang hiển thị {MAX_LISTED}/{filtered.length} kết quả; gõ thêm để thu hẹp.
        </span>
      ) : null}
      <div className="text-[11px] font-semibold text-slate-700">Đã chọn {selected.length} nhân viên</div>
      <Chips
        items={selected.map((id) => ({
          value: id,
          label: options.find((o) => o.value === id)?.label ?? id,
        }))}
        onRemove={(id) => onChange(selected.filter((x) => x !== id))}
        empty="Chưa chọn nhân viên nào."
      />
    </div>
  );
}

export function ScopePicker({
  value,
  onChange,
  allowedTypes,
  employeeOptions,
  employeesLoading,
  employeesError,
  units,
  openEnded = false,
}: {
  value: ScopeDraft;
  onChange: (next: ScopeDraft) => void;
  allowedTypes: ScopeDraft['type'][];
  employeeOptions: readonly SearchableSelectOption[];
  employeesLoading: boolean;
  employeesError: string;
  units: readonly HrmOrgUnitOption[];
  /** Lịch không có ngày kết thúc: ẩn "gồm đơn vị con" và "loại trừ nhân viên" (backend không hỗ trợ). */
  openEnded?: boolean;
}) {
  const unitOptions: SearchableSelectOption[] = useMemo(
    () => units.map((u) => ({ value: u.id, label: `${u.name} (${u.code})` })),
    [units],
  );
  const patch = (next: Partial<ScopeDraft>) => onChange({ ...value, ...next });
  const labelOf = (options: readonly SearchableSelectOption[], id: string) =>
    options.find((o) => o.value === id)?.label ?? id;

  return (
    <div className="flex flex-col gap-4">
      {allowedTypes.length > 1 ? (
        <div role="radiogroup" aria-label="Phạm vi áp dụng" className="flex flex-wrap gap-1.5">
          {allowedTypes.map((type) => (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={value.type === type}
              onClick={() => onChange({ ...value, type })}
              className={cn(
                'cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
                value.type === type
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-blue-400',
              )}
            >
              {SCOPE_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      ) : (
        <div className="text-xs font-semibold text-slate-700">{SCOPE_TYPE_LABELS[allowedTypes[0]]}</div>
      )}

      {employeesError ? <Notice tone="error">{employeesError}</Notice> : null}

      {value.type === 'EMPLOYEE' ? (
        <Field label="Nhân viên">
          <SearchableSelect
            options={employeeOptions}
            value={value.employeeIds[0] ?? ''}
            placeholder={employeesLoading ? 'Đang tải danh sách nhân viên…' : 'Tìm theo mã hoặc tên nhân viên…'}
            emptyText="Không tìm thấy nhân viên phù hợp"
            disabled={employeesLoading}
            onChange={(id) => patch({ employeeIds: id ? [id] : [] })}
            clearable
          />
        </Field>
      ) : null}

      {value.type === 'EMPLOYEES' ? (
        <EmployeeMultiPicker
          options={employeeOptions}
          selected={value.employeeIds}
          onChange={(ids) => patch({ employeeIds: ids })}
        />
      ) : null}

      {value.type === 'UNIT' ? (
        <div className="flex flex-col gap-3">
          <Field label="Thêm đơn vị">
            <SearchableSelect
              options={unitOptions.filter((o) => !value.unitIds.includes(o.value))}
              value=""
              placeholder="Tìm đơn vị theo tên hoặc mã…"
              emptyText="Không tìm thấy đơn vị phù hợp"
              onChange={(id) => id && patch({ unitIds: [...value.unitIds, id] })}
              clearable={false}
            />
          </Field>
          <Chips
            items={value.unitIds.map((id) => ({ value: id, label: labelOf(unitOptions, id) }))}
            onRemove={(id) => patch({ unitIds: value.unitIds.filter((x) => x !== id) })}
            empty="Chưa chọn đơn vị nào."
          />
          {openEnded ? (
            <span className="text-[11px] text-slate-500">
              Lịch định kỳ của đơn vị tự áp dụng cho các đơn vị con.
            </span>
          ) : (
            <Checkbox
              checked={value.includeChildUnits}
              onChange={(on) => patch({ includeChildUnits: on })}
              label="Bao gồm các đơn vị con"
            />
          )}
        </div>
      ) : null}

      {value.type === 'COMPANY' ? (
        <Notice tone="warn" title="Áp dụng cho toàn bộ nhân viên đang làm việc">
          Thao tác này tác động tới tất cả nhân viên của doanh nghiệp. Bạn sẽ cần xác nhận lại ở bước xem trước.
        </Notice>
      ) : null}

      {openEnded && (value.type === 'UNIT' || value.type === 'COMPANY') ? (
        <Notice tone="info">
          Lịch không có ngày kết thúc không loại trừ được nhân viên. Muốn một người khác lịch chung, hãy đặt ngoại lệ
          hoặc gán lịch riêng cho nhân viên đó.
        </Notice>
      ) : null}

      {!openEnded && (value.type === 'UNIT' || value.type === 'COMPANY') ? (
        <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
          <Field label="Loại trừ nhân viên (tuỳ chọn)">
            <SearchableSelect
              options={employeeOptions.filter((o) => !value.excludeEmployeeIds.includes(o.value))}
              value=""
              placeholder="Tìm nhân viên cần loại trừ…"
              emptyText="Không tìm thấy nhân viên phù hợp"
              disabled={employeesLoading}
              onChange={(id) => id && patch({ excludeEmployeeIds: [...value.excludeEmployeeIds, id] })}
              clearable={false}
            />
          </Field>
          <Chips
            items={value.excludeEmployeeIds.map((id) => ({ value: id, label: labelOf(employeeOptions, id) }))}
            onRemove={(id) => patch({ excludeEmployeeIds: value.excludeEmployeeIds.filter((x) => x !== id) })}
            empty="Không loại trừ ai."
          />
        </div>
      ) : null}
    </div>
  );
}
