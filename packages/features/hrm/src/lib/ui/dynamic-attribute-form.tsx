import React, { useState } from 'react';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@enterprise-platform/shared-ui';
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
  /** Ánh xạ trường HRM của thuộc tính (FIX-E-05); null/undefined = người nộp tự nhập. */
  mapping?: {
    hrmField: string;
    mode: 'OVERWRITE' | 'PREFILL';
    group?: 'form' | 'employee' | 'business';
    label?: string;
  } | null;
}

interface DynamicAttributeFormProps {
  attributes: ProcedureAttributeItem[];
  values: Record<string, unknown>;
  onChange: (code: string, value: unknown) => void;
  /** Danh sách các mã thuộc tính đã được nhập ở các trường cốt lõi của form (để tránh hiển thị trùng lặp) */
  excludeCodes?: readonly string[];
  /** Danh sách nhân viên cho thuộc tính kiểu `user` (giá trị lưu là id nhân viên). */
  userOptions?: SearchableSelectOption[];
  /** Tải tệp cho thuộc tính kiểu `file`; trả về id đính kèm lưu làm giá trị. */
  onUploadFile?: (file: File) => Promise<{ id: string; name: string }>;
}

export const DynamicAttributeForm: React.FC<DynamicAttributeFormProps> = ({
  attributes,
  values,
  onChange,
  excludeCodes = [],
  userOptions = [],
  onUploadFile,
}) => {
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
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

          if (attr.type === 'user') {
            return (
              <div key={attr.id} className="space-y-1">
                <label className="font-semibold text-slate-800 block text-xs">
                  {attr.name} {isRequired && <span className="text-red-500 font-bold">*</span>}
                </label>
                <SearchableSelect
                  options={userOptions}
                  value={typeof val === 'string' ? val : ''}
                  onChange={(next) => onChange(attr.code, next || undefined)}
                  placeholder="-- Chọn nhân viên --"
                  clearable={!isRequired}
                />
              </div>
            );
          }

          if (attr.type === 'file') {
            const fileId = typeof val === 'string' ? val : '';
            return (
              <div key={attr.id} className="space-y-1">
                <label className="font-semibold text-slate-800 block text-xs">
                  {attr.name} {isRequired && <span className="text-red-500 font-bold">*</span>}
                </label>
                {onUploadFile ? (
                  <input
                    type="file"
                    disabled={uploading[attr.code]}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      setUploading((prev) => ({ ...prev, [attr.code]: true }));
                      setFileErrors((prev) => ({ ...prev, [attr.code]: '' }));
                      try {
                        const uploaded = await onUploadFile(file);
                        setFileNames((prev) => ({
                          ...prev,
                          [attr.code]: uploaded.name,
                        }));
                        onChange(attr.code, uploaded.id);
                      } catch (error) {
                        setFileErrors((prev) => ({
                          ...prev,
                          [attr.code]:
                            error instanceof Error
                              ? error.message
                              : 'Không tải được tệp',
                        }));
                      } finally {
                        setUploading((prev) => ({
                          ...prev,
                          [attr.code]: false,
                        }));
                      }
                    }}
                    className="block w-full text-xs text-slate-600 file:mr-2 file:rounded-md file:border file:border-slate-200 file:bg-white file:px-2 file:py-1 file:text-xs"
                  />
                ) : (
                  <p className="text-[11px] text-slate-500">
                    Chưa thể tải tệp ở màn hình này.
                  </p>
                )}
                {uploading[attr.code] && (
                  <p className="text-[11px] text-slate-500">Đang tải tệp lên...</p>
                )}
                {fileErrors[attr.code] && (
                  <p className="text-[11px] text-red-600">{fileErrors[attr.code]}</p>
                )}
                {fileId && !uploading[attr.code] && (
                  <div className="flex items-center justify-between text-[11px] text-slate-600">
                    <span>
                      Đã đính kèm: {fileNames[attr.code] || 'tệp đã tải lên'}
                    </span>
                    <button
                      type="button"
                      className="text-red-600 hover:underline"
                      onClick={() => {
                        setFileNames((prev) => ({ ...prev, [attr.code]: '' }));
                        onChange(attr.code, undefined);
                      }}
                    >
                      Gỡ tệp
                    </button>
                  </div>
                )}
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
