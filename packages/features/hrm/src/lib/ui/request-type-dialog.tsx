'use client';
import { useId, useState } from 'react';
import { Info, Plus, Trash2 } from 'lucide-react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import type {
  HrmRequestFieldType,
  HrmRequestTimeMode,
  HrmRequestType,
  HrmRequestTypeField,
  SaveRequestTypeRequest,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { Button } from './button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './dialog';
import { Input } from './input';
import { LeaveField, LeaveSwitch } from './leave-form-controls';

export const TIME_MODE_OPTIONS: { value: HrmRequestTimeMode; label: string; hint: string }[] = [
  {
    value: 'RANGE_DATETIME',
    label: 'Từ ngày giờ đến ngày giờ',
    hint: 'Người làm đơn chọn ngày và giờ bắt đầu, ngày và giờ kết thúc.',
  },
  {
    value: 'DATE_RANGE',
    label: 'Từ ngày đến ngày (cả ngày)',
    hint: 'Chọn ngày bắt đầu và ngày kết thúc, tính cả ngày.',
  },
  { value: 'SINGLE_DATE', label: 'Một ngày', hint: 'Chọn một ngày duy nhất.' },
  { value: 'NONE', label: 'Không có thời gian', hint: 'Đơn không gắn với thời gian (ví dụ đề xuất, xin cấp).' },
];

export const FIELD_TYPE_OPTIONS: { value: HrmRequestFieldType; label: string }[] = [
  { value: 'text', label: 'Văn bản ngắn' },
  { value: 'textarea', label: 'Văn bản nhiều dòng' },
  { value: 'number', label: 'Số' },
  { value: 'date', label: 'Ngày' },
  { value: 'datetime', label: 'Ngày giờ' },
  { value: 'select', label: 'Chọn một trong danh sách' },
  { value: 'checkbox', label: 'Có / Không' },
];

export const timeModeLabel = (mode: HrmRequestTimeMode) =>
  TIME_MODE_OPTIONS.find((o) => o.value === mode)?.label ?? mode;

interface FieldRow {
  key: string;
  label: string;
  type: HrmRequestFieldType;
  required: boolean;
  /** Các lựa chọn, ngăn cách bằng dấu phẩy (chỉ với kiểu chọn). */
  options: string;
}

/** Mã trường sinh từ tên: bỏ dấu, chữ thường, gạch dưới; bắt đầu bằng chữ cái. */
export function fieldKeyFromLabel(label: string): string {
  const plain = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const key = /^[a-z]/.test(plain) ? plain : `truong_${plain}`;
  return key.slice(0, 40).replace(/_+$/g, '') || 'truong';
}

/** Chuyển các dòng trường trên form thành khai báo gửi lên máy chủ; sinh mã trường khi bỏ trống, tránh trùng mã. */
export function buildFieldDefinitions(rows: readonly FieldRow[]): HrmRequestTypeField[] {
  const taken = new Set<string>();
  return rows.map((row) => {
    let key = row.key.trim() || fieldKeyFromLabel(row.label);
    if (!row.key.trim()) {
      const base = key;
      for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
    }
    taken.add(key);
    return {
      key,
      label: row.label.trim(),
      type: row.type,
      required: row.required,
      ...(row.type === 'select'
        ? {
            options: row.options
              .split(',')
              .map((o) => o.trim())
              .filter(Boolean),
          }
        : {}),
    };
  });
}

const emptyField = (): FieldRow => ({ key: '', label: '', type: 'text', required: false, options: '' });

const toRows = (fields: readonly HrmRequestTypeField[] | undefined): FieldRow[] =>
  (fields ?? []).map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    required: f.required === true,
    options: (f.options ?? []).join(', '),
  }));

/**
 * Hộp thoại thêm / sửa MỘT loại đơn.
 *  - Loại hệ thống: chỉ sửa tên, mô tả và bật/tắt (cách xử lý và thời gian do hệ thống định sẵn).
 *  - Loại tự tạo: tên, mã, mô tả, cách nhập thời gian, chứng từ, các trường bổ sung. Loại tự tạo chỉ ghi nhận và duyệt đơn,
 *    không ảnh hưởng bảng công, phép, lương (nghỉ có lương hay không lương cấu hình ở lý do nghỉ).
 */
export function RequestTypeDialog({
  row,
  onClose,
  onSaved,
}: {
  /** Có `row` là sửa, không có là thêm mới (luôn là loại tự tạo). */
  row?: HrmRequestType;
  onClose: () => void;
  onSaved: (message: string) => void | Promise<void>;
}) {
  const uid = useId();
  const system = Boolean(row?.isSystem);
  const lockedActive = system && row?.code === 'LEAVE';
  const [name, setName] = useState(row?.name ?? '');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState(row?.description ?? '');
  const [timeMode, setTimeMode] = useState<HrmRequestTimeMode>(row?.timeMode ?? 'RANGE_DATETIME');
  const [requiresAttachment, setRequiresAttachment] = useState(row?.requiresAttachment ?? false);
  const [requiresTransport, setRequiresTransport] = useState(row?.requiresTransport ?? false);
  const [active, setActive] = useState(row?.active ?? true);
  const [fields, setFields] = useState<FieldRow[]>(toRows(row?.fields));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const patchField = (index: number, next: Partial<FieldRow>) =>
    setFields((current) => current.map((f, i) => (i === index ? { ...f, ...next } : f)));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (!name.trim()) {
      setError('Cần nhập Tên loại đơn');
      return;
    }
    if (!system) {
      for (const [i, f] of fields.entries()) {
        if (!f.label.trim()) {
          setError(`Trường ${i + 1}: cần nhập tên trường`);
          return;
        }
        if (f.type === 'select' && !f.options.split(',').some((o) => o.trim())) {
          setError(`Trường "${f.label.trim()}": cần nhập các lựa chọn, ngăn cách bằng dấu phẩy`);
          return;
        }
      }
    }
    const common = {
      name: name.trim(),
      description: description.trim() || null,
      active,
    };
    const body: SaveRequestTypeRequest = system
      ? common
      : {
          ...common,
          timeMode,
          requiresAttachment,
          requiresTransport,
          fields: buildFieldDefinitions(fields),
        };
    setBusy(true);
    try {
      if (row) {
        await hrmFetch(`/request-types/${row.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...body, expectedUpdatedAt: row.updatedAt }),
        });
        await onSaved(`Đã cập nhật loại đơn "${name.trim()}".`);
      } else {
        await hrmFetch('/request-types', {
          method: 'POST',
          body: JSON.stringify({ ...body, ...(code.trim() ? { code: code.trim() } : {}) }),
        });
        await onSaved(`Đã thêm loại đơn "${name.trim()}".`);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được loại đơn');
    } finally {
      setBusy(false);
    }
  }

  const modeHint = TIME_MODE_OPTIONS.find((o) => o.value === timeMode)?.hint;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden bg-white p-0 sm:max-w-[720px]">
        <DialogHeader className="shrink-0 border-b border-slate-200 bg-slate-50/80 px-5 py-4 pr-12">
          <DialogTitle className="text-base font-bold text-slate-900">
            {row ? `Sửa loại đơn ${row.name}` : 'Thêm loại đơn'}
          </DialogTitle>
          <p className="mt-1 text-xs text-slate-500">
            Loại đơn là danh mục do quản trị cấu hình; người dùng chọn loại rồi điền thông tin theo cấu hình.
          </p>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            {system ? (
              <p
                role="note"
                className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800"
              >
                <Info className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Đây là loại đơn hệ thống ({timeModeLabel(row!.timeMode)}): đổi được tên, mô tả và bật/tắt; cách xử lý đơn do
                  hệ thống định sẵn.
                  {lockedActive ? ' Loại Nghỉ phép luôn được bật.' : ''}
                </span>
              </p>
            ) : (
              <p
                role="note"
                className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600"
              >
                <Info className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Loại đơn tự tạo chỉ ghi nhận và duyệt, không ảnh hưởng bảng công, phép, lương. Nghỉ có lương hoặc không
                  lương cấu hình ở lý do nghỉ (Phép năm).
                </span>
              </p>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <LeaveField label="Tên loại đơn" required htmlFor={`${uid}-name`} className="sm:col-span-2">
                <Input
                  id={`${uid}-name`}
                  maxLength={255}
                  className="h-9 text-xs"
                  disabled={busy}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </LeaveField>
              {row ? (
                <LeaveField label="Mã">
                  <p className="flex h-9 items-center font-mono text-xs text-slate-700">{row.code}</p>
                </LeaveField>
              ) : (
                <LeaveField
                  label="Mã loại đơn"
                  htmlFor={`${uid}-code`}
                  hint="Bỏ trống để tự sinh từ tên. Không đổi được sau khi tạo."
                >
                  <Input
                    id={`${uid}-code`}
                    maxLength={50}
                    className="h-9 text-xs"
                    disabled={busy}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </LeaveField>
              )}
            </div>
            <LeaveField label="Mô tả" htmlFor={`${uid}-desc`} hint="Hiện cạnh loại đơn khi người dùng chọn loại.">
              <Input
                id={`${uid}-desc`}
                maxLength={1000}
                className="h-9 text-xs"
                disabled={busy}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </LeaveField>

            {!system ? (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <LeaveField label="Thời gian của đơn" required hint={modeHint}>
                    <SearchableSelect
                      height={36}
                      value={timeMode}
                      placeholder="Chọn cách nhập thời gian"
                      disabled={busy}
                      clearable={false}
                      options={TIME_MODE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                      onChange={(value) => setTimeMode((value as HrmRequestTimeMode) || 'RANGE_DATETIME')}
                    />
                  </LeaveField>
                  <div className="flex items-start gap-3 pt-5">
                    <LeaveSwitch
                      label="Cần chứng từ"
                      checked={requiresAttachment}
                      disabled={busy}
                      onChange={setRequiresAttachment}
                    />
                    <div>
                      <p className="text-xs font-medium text-slate-700">Cần chứng từ</p>
                      <p className="text-[12px] leading-snug text-slate-500">Người làm đơn phải đính kèm chứng từ.</p>
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <LeaveSwitch
                    label="Cần phương tiện"
                    checked={requiresTransport}
                    disabled={busy}
                    onChange={setRequiresTransport}
                  />
                  <div>
                    <p className="text-xs font-medium text-slate-700">Cần phương tiện</p>
                    <p className="text-[11px] leading-snug text-slate-500">
                      Form đơn có khối chọn xe công ty hoặc phương tiện tự sắp xếp; xe công ty được giữ chỗ trên Lịch xe.
                    </p>
                  </div>
                </div>

                <section aria-label="Trường bổ sung" className="space-y-2 rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Trường bổ sung</h3>
                      <p className="text-[12px] text-slate-500">
                        Thông tin người làm đơn phải điền thêm (ví dụ Nơi nhận, Mức độ).
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      disabled={busy || fields.length >= 30}
                      onClick={() => setFields((current) => [...current, emptyField()])}
                      className="h-7 text-xs"
                    >
                      <Plus className="mr-1 size-3" />
                      Thêm trường
                    </Button>
                  </div>
                  {fields.length === 0 ? (
                    <p className="text-xs text-slate-500">Chưa có trường bổ sung.</p>
                  ) : null}
                  {fields.map((f, index) => (
                    <div
                      key={index}
                      className="grid grid-cols-1 items-end gap-2 rounded-lg border border-slate-100 bg-slate-50/60 p-2 sm:grid-cols-12"
                    >
                      <LeaveField label={`Tên trường ${index + 1}`} className="sm:col-span-4" htmlFor={`${uid}-f${index}-label`}>
                        <Input
                          id={`${uid}-f${index}-label`}
                          maxLength={100}
                          className="h-9 text-xs"
                          disabled={busy}
                          value={f.label}
                          onChange={(e) => patchField(index, { label: e.target.value })}
                        />
                      </LeaveField>
                      <LeaveField label="Kiểu" className="sm:col-span-3">
                        <SearchableSelect
                          height={36}
                          value={f.type}
                          placeholder="Chọn kiểu"
                          disabled={busy}
                          clearable={false}
                          options={FIELD_TYPE_OPTIONS}
                          onChange={(value) => patchField(index, { type: (value as HrmRequestFieldType) || 'text' })}
                        />
                      </LeaveField>
                      <div className="flex items-center gap-2 pb-1.5 sm:col-span-3">
                        <LeaveSwitch
                          label={`Bắt buộc trường ${index + 1}`}
                          checked={f.required}
                          disabled={busy}
                          onChange={(next) => patchField(index, { required: next })}
                        />
                        <span className="text-xs text-slate-700">Bắt buộc</span>
                      </div>
                      <div className="flex justify-end pb-0.5 sm:col-span-2">
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="outline"
                          aria-label={`Xóa trường ${index + 1}`}
                          disabled={busy}
                          onClick={() => setFields((current) => current.filter((_, i) => i !== index))}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                      {f.type === 'select' ? (
                        <LeaveField
                          label={`Các lựa chọn của trường ${index + 1}`}
                          hint="Ngăn cách bằng dấu phẩy, ví dụ: Gấp, Thường"
                          className="sm:col-span-12"
                          htmlFor={`${uid}-f${index}-options`}
                        >
                          <Input
                            id={`${uid}-f${index}-options`}
                            className="h-9 text-xs"
                            disabled={busy}
                            value={f.options}
                            onChange={(e) => patchField(index, { options: e.target.value })}
                          />
                        </LeaveField>
                      ) : null}
                    </div>
                  ))}
                </section>
              </>
            ) : null}

            <div className="flex items-start gap-3">
              <LeaveSwitch
                label="Đang sử dụng"
                checked={lockedActive ? true : active}
                disabled={busy || lockedActive}
                onChange={setActive}
              />
              <div>
                <p className="text-xs font-medium text-slate-700">Đang sử dụng</p>
                <p className="text-[12px] leading-snug text-slate-500">
                  Tắt thì loại đơn ẩn khỏi danh sách chọn của đơn mới; đơn đã gửi không bị ảnh hưởng.
                </p>
              </div>
            </div>
          </div>
          {error ? (
            <div className="px-5 py-2">
              <p role="alert" className="rounded border border-red-200 bg-red-50 p-2.5 text-xs font-medium text-red-600">
                {error}
              </p>
            </div>
          ) : null}
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 p-4">
            <Button type="button" variant="outline" disabled={busy} onClick={onClose} className="h-8 text-xs">
              Hủy
            </Button>
            <Button
              type="submit"
              disabled={busy}
              className="h-8 bg-blue-600 text-xs font-semibold text-white shadow-xs hover:bg-blue-700"
            >
              {busy ? 'Đang lưu...' : 'Lưu loại đơn'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
