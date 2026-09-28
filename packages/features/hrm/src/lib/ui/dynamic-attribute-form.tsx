import React from 'react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { Input } from './input';
import { DatePickerInput } from './date-picker-input';

export interface ProcedureAttributeItem {
  id: string;
  code: string;
  name: string;
  type: string;
  required: boolean;
  options?: Array<{ code: string; label: string }>;
  scope: 'process' | 'step';
  stepName?: string;
}

interface DynamicAttributeFormProps {
  attributes: ProcedureAttributeItem[];
  values: Record<string, unknown>;
  onChange: (code: string, value: unknown) => void;
  /** Danh sách các mã thuộc tính đã được nhập ở các trường cốt lõi của form (để tránh hiển thị trùng lặp) */
  excludeCodes?: string[];
}

export const DynamicAttributeForm: React.FC<DynamicAttributeFormProps> = ({
  attributes,
  values,
  onChange,
  excludeCodes = [],
}) => {
  const visibleAttributes = attributes.filter(
    (attr) => !excludeCodes.includes(attr.code.toLowerCase())
  );

  if (visibleAttributes.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3 pt-2 border-t border-slate-200">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
          Thông tin bổ trợ quy trình (Cấu hình động Node S)
        </span>
        <span className="text-[10px] text-slate-500 font-medium">
          Dùng cho điều kiện xét duyệt & rẽ nhánh
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {visibleAttributes.map((attr) => {
          const val = values[attr.code];
          const isRequired = attr.required;

          if (attr.type === 'boolean') {
            return (
              <div key={attr.id} className="sm:col-span-2 flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id={`attr_${attr.code}`}
                  checked={Boolean(val)}
                  onChange={(e) => onChange(attr.code, e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 size-4 cursor-pointer"
                />
                <label
                  htmlFor={`attr_${attr.code}`}
                  className="text-xs text-slate-700 font-medium cursor-pointer"
                >
                  {attr.name} {isRequired && <span className="text-red-500 font-bold">*</span>}
                </label>
              </div>
            );
          }

          if (attr.type === 'select') {
            const options = (attr.options || []).map((opt) => ({
              value: opt.code,
              label: opt.label,
            }));
            return (
              <div key={attr.id} className="space-y-1">
                <label className="font-semibold text-slate-800 block text-xs">
                  {attr.name} {isRequired && <span className="text-red-500 font-bold">*</span>}
                </label>
                <SearchableSelect
                  options={options}
                  value={typeof val === 'string' ? val : ''}
                  onChange={(next) => onChange(attr.code, next || undefined)}
                  placeholder={`-- Chọn ${attr.name.toLowerCase()} --`}
                  clearable={!isRequired}
                />
              </div>
            );
          }

          if (attr.type === 'date') {
            return (
              <div key={attr.id} className="space-y-1">
                <label className="font-semibold text-slate-800 block text-xs">
                  {attr.name} {isRequired && <span className="text-red-500 font-bold">*</span>}
                </label>
                <DatePickerInput
                  value={typeof val === 'string' ? val : ''}
                  onChange={(next) => onChange(attr.code, next || undefined)}
                  placeholder="dd/mm/yyyy"
                />
              </div>
            );
          }

          if (attr.type === 'money') {
            return (
              <div key={attr.id} className="space-y-1">
                <label className="font-semibold text-slate-800 block text-xs">
                  {attr.name} (VND) {isRequired && <span className="text-red-500 font-bold">*</span>}
                </label>
                <Input
                  type="number"
                  min="0"
                  step="1000"
                  value={val !== undefined && val !== null ? String(val) : ''}
                  onChange={(e) => {
                    const parsed = parseFloat(e.target.value);
                    onChange(attr.code, isNaN(parsed) ? undefined : parsed);
                  }}
                  placeholder="Nhập số tiền..."
                  className="text-xs"
                />
              </div>
            );
          }

          if (attr.type === 'number' || attr.type === 'percent') {
            return (
              <div key={attr.id} className="space-y-1">
                <label className="font-semibold text-slate-800 block text-xs">
                  {attr.name} {attr.type === 'percent' ? '(%)' : ''}{' '}
                  {isRequired && <span className="text-red-500 font-bold">*</span>}
                </label>
                <Input
                  type="number"
                  min="0"
                  value={val !== undefined && val !== null ? String(val) : ''}
                  onChange={(e) => {
                    const parsed = parseFloat(e.target.value);
                    onChange(attr.code, isNaN(parsed) ? undefined : parsed);
                  }}
                  placeholder="Nhập số lượng..."
                  className="text-xs"
                />
              </div>
            );
          }

          // text / default fallback
          return (
            <div key={attr.id} className="space-y-1">
              <label className="font-semibold text-slate-800 block text-xs">
                {attr.name} {isRequired && <span className="text-red-500 font-bold">*</span>}
              </label>
              <Input
                value={typeof val === 'string' ? val : ''}
                onChange={(e) => onChange(attr.code, e.target.value || undefined)}
                placeholder={`Nhập ${attr.name.toLowerCase()}...`}
                className="text-xs"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
