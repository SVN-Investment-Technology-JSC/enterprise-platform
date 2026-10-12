'use client';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import type {
  HrmRequestType,
  HrmRequestTypeField,
} from '@enterprise-platform/contracts-hrm';
import { DateTimeInput } from './date-time-input';
import { DatePickerInput } from './date-picker-input';
import { Input } from './input';
import { RequestTimeRange } from './request-time-range';

/** Giá trị trống của một trường động: chuỗi rỗng, checkbox bỏ chọn hoặc chưa nhập. */
export function isFieldBlank(field: HrmRequestTypeField, value: unknown): boolean {
  if (field.type === 'checkbox') return false;
  return value === undefined || value === null || String(value).trim() === '';
}

/** Trường bắt buộc còn trống, theo thứ tự khai báo của loại đơn. */
export function missingRequiredFields(
  fields: readonly HrmRequestTypeField[],
  values: Record<string, unknown>,
): HrmRequestTypeField[] {
  return fields.filter((f) => f.required && isFieldBlank(f, values[f.key]));
}

/**
 * Kiểm tra thời gian theo chế độ của loại đơn; trả về lỗi đầu tiên hoặc chuỗi rỗng.
 * RANGE_DATETIME cần ngày giờ đủ hai đầu; DATE_RANGE cần khoảng ngày; SINGLE_DATE cần một ngày; NONE không có thời gian.
 */
export function customTimeError(
  mode: HrmRequestType['timeMode'],
  fromAt: string,
  toAt: string,
): string {
  if (mode === 'NONE') return '';
  if (mode === 'SINGLE_DATE') return fromAt ? '' : 'Vui lòng chọn ngày.';
  if (!fromAt || !toAt)
    return mode === 'RANGE_DATETIME'
      ? 'Vui lòng chọn từ ngày giờ và đến ngày giờ.'
      : 'Vui lòng chọn từ ngày và đến ngày.';
  if (toAt < fromAt)
    return mode === 'RANGE_DATETIME'
      ? 'Thời điểm kết thúc phải sau thời điểm bắt đầu.'
      : 'Đến ngày phải từ ngày bắt đầu trở đi.';
  if (mode === 'RANGE_DATETIME' && toAt === fromAt)
    return 'Thời điểm kết thúc phải sau thời điểm bắt đầu.';
  return '';
}

/**
 * Form của loại đơn do quản trị tạo: khoảng thời gian theo `timeMode` của loại và các trường động khai báo trong loại.
 * Lý do (nếu loại có danh mục) và tệp đính kèm do form cha hiển thị.
 */
export function GenericRequestForm({
  type,
  employeeId,
  fromAt,
  toAt,
  onTimeChange,
  values,
  onValuesChange,
  disabled,
}: {
  type: HrmRequestType;
  employeeId: string;
  fromAt: string;
  toAt: string;
  onTimeChange: (next: { fromAt: string; toAt: string }) => void;
  values: Record<string, unknown>;
  onValuesChange: (next: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const setValue = (key: string, value: unknown) => onValuesChange({ ...values, [key]: value });

  return (
    <div className="space-y-4" data-testid="generic-request-form">
      {type.timeMode === 'RANGE_DATETIME' && (
        <RequestTimeRange
          employeeId={employeeId}
          fromAt={fromAt}
          toAt={toAt}
          onChange={onTimeChange}
          showPreview={false}
          disabled={disabled}
        />
      )}
      {type.timeMode === 'DATE_RANGE' && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700">
              Từ ngày <span className="text-rose-500">*</span>
            </span>
            <DatePickerInput
              value={fromAt}
              disabled={disabled}
              aria-label="Từ ngày"
              onChange={(value) => onTimeChange({ fromAt: value, toAt })}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700">
              Đến ngày <span className="text-rose-500">*</span>
            </span>
            <DatePickerInput
              value={toAt}
              disabled={disabled}
              aria-label="Đến ngày"
              onChange={(value) => onTimeChange({ fromAt, toAt: value })}
            />
          </label>
        </div>
      )}
      {type.timeMode === 'SINGLE_DATE' && (
        <label className="block max-w-xs space-y-1.5">
          <span className="text-xs font-semibold text-slate-700">
            Ngày <span className="text-rose-500">*</span>
          </span>
          <DatePickerInput
            value={fromAt}
            disabled={disabled}
            aria-label="Ngày"
            onChange={(value) => onTimeChange({ fromAt: value, toAt: value })}
          />
        </label>
      )}

      {type.fields.map((field) => (
        <div key={field.key} className="space-y-1.5">
          {field.type === 'checkbox' ? (
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={values[field.key] === true}
                disabled={disabled}
                onChange={(e) => setValue(field.key, e.target.checked)}
                className="size-4 rounded border-slate-300"
              />
              {field.label}
              {field.required && <span className="text-rose-500">*</span>}
            </label>
          ) : (
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-700">
                {field.label}
                {field.required && <span className="text-rose-500"> *</span>}
              </span>
              {field.type === 'textarea' ? (
                <textarea
                  value={String(values[field.key] ?? '')}
                  disabled={disabled}
                  rows={3}
                  onChange={(e) => setValue(field.key, e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus-visible:border-blue-600 focus-visible:ring-2 focus-visible:ring-blue-100"
                />
              ) : field.type === 'select' ? (
                <SearchableSelect
                  options={(field.options ?? []).map((o) => ({ value: o, label: o }))}
                  value={String(values[field.key] ?? '')}
                  onChange={(value) => setValue(field.key, value)}
                  placeholder="Chọn..."
                  clearable={!field.required}
                />
              ) : field.type === 'date' ? (
                <DatePickerInput
                  value={String(values[field.key] ?? '')}
                  disabled={disabled}
                  onChange={(value) => setValue(field.key, value)}
                />
              ) : field.type === 'datetime' ? (
                <DateTimeInput
                  value={String(values[field.key] ?? '')}
                  disabled={disabled}
                  onChange={(value) => setValue(field.key, value)}
                />
              ) : (
                <Input
                  type={field.type === 'number' ? 'number' : 'text'}
                  value={String(values[field.key] ?? '')}
                  disabled={disabled}
                  onChange={(e) =>
                    setValue(
                      field.key,
                      field.type === 'number' && e.target.value !== ''
                        ? Number(e.target.value)
                        : e.target.value,
                    )
                  }
                  className="text-xs"
                />
              )}
            </label>
          )}
        </div>
      ))}
    </div>
  );
}
