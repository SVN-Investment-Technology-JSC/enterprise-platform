'use client';
import { Fragment, useRef, useState } from 'react';
import { Popconfirm, SearchableSelect } from '@enterprise-platform/shared-ui';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './dialog';
import { Input } from './input';
import { Button } from './button';

export interface ActionField {
  key: string;
  label: string;
  type?: 'text' | 'date' | 'month' | 'number';
  value?: string | number;
  options?: { value: string; label: string }[];
  /** Danh sách chọn phụ thuộc giá trị các trường khác; giá trị không còn hợp lệ sẽ bị xóa. */
  optionsFor?: (values: Record<string, string>) => { value: string; label: string }[];
  optional?: boolean;
  required?: boolean;
  min?: number;
  max?: number;
  step?: string;
  section?: string;
  colSpan?: 1 | 2 | 3 | 'full';
}
export interface HrmAction {
  title: string;
  confirmTitle?: string;
  description?: string;
  columns?: 1 | 2 | 3;
  fields: ActionField[];
  submit: (
    values: Record<string, string>,
    operationId: string,
  ) => Promise<void>;
}
/** Xóa giá trị của trường phụ thuộc khi lựa chọn không còn nằm trong danh sách mới. */
export function reconcileDependentValues(
  fields: ActionField[],
  values: Record<string, string>,
): Record<string, string> {
  const next = { ...values };
  for (const field of fields) {
    if (!field.optionsFor || !next[field.key]) continue;
    if (!field.optionsFor(next).some((o) => o.value === next[field.key]))
      next[field.key] = '';
  }
  return next;
}

function getColSpanClass(
  colSpan?: 1 | 2 | 3 | 'full',
  columns?: 1 | 2 | 3,
): string {
  if (!colSpan || !columns || columns === 1) return '';
  if (colSpan === 'full') return 'col-span-full';
  if (columns === 3) {
    if (colSpan === 3) return 'col-span-full';
    if (colSpan === 2) return 'col-span-1 sm:col-span-2';
  }
  if (columns === 2) {
    if (colSpan >= 2) return 'col-span-full';
  }
  return '';
}
export function HrmActionDialog({
  action,
  onClose,
}: {
  action: HrmAction;
  onClose: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const confirmedRef = useRef(false);
  const [operationId] = useState(() => crypto.randomUUID());
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      action.fields.map((f) => [f.key, String(f.value ?? '')]),
    ),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className={`${
          action.columns === 3
            ? 'sm:max-w-[960px]'
            : action.columns === 2
            ? 'sm:max-w-[840px]'
            : 'sm:max-w-[640px]'
        } max-h-[90vh] p-0 flex flex-col overflow-hidden bg-white`}
      >
        <DialogHeader className="shrink-0 border-b border-slate-200 bg-slate-50/80 px-5 py-4 pr-12">
          <DialogTitle className="text-base font-bold text-slate-900">{action.title}</DialogTitle>
          {action.description && (
            <p className="text-xs text-slate-500 mt-1">{action.description}</p>
          )}
        </DialogHeader>
        <form
          ref={formRef}
          className="flex flex-col flex-1 min-h-0 overflow-hidden"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            if (action.confirmTitle && !confirmedRef.current) {
              setError(
                'Bấm Xác nhận và xác nhận thao tác tại nút trước khi lưu.',
              );
              return;
            }
            confirmedRef.current = false;
            setBusy(true);
            setError('');
            try {
              for (const f of action.fields) {
                const isRequired = f.required ?? !f.optional;
                if (isRequired && !values[f.key]?.trim())
                  throw new Error(`Cần nhập ${f.label}`);
              }
              await action.submit(values, operationId);
              onClose();
            } catch (err) {
              setError(
                err instanceof Error ? err.message : 'Không lưu được dữ liệu',
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <div
            className={`flex-1 min-h-0 overflow-y-auto p-5 ${
              action.columns === 3
                ? 'grid grid-cols-1 gap-3.5 sm:grid-cols-2 md:grid-cols-3'
                : action.columns === 2
                ? 'grid grid-cols-1 gap-3 sm:grid-cols-2'
                : 'space-y-4'
            }`}
          >
            {action.fields.map((f, index) => {
              const isRequired = f.required ?? !f.optional;
              return (
                <Fragment key={f.key}>
                  {f.section &&
                    f.section !== action.fields[index - 1]?.section && (
                      <h3 className="col-span-full border-b border-slate-200 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {f.section}
                      </h3>
                    )}
                  <label
                    className={`block space-y-1 text-xs font-medium text-slate-700 ${getColSpanClass(f.colSpan, action.columns)}`}
                  >
                    <span>
                      {f.label}
                      {isRequired && (
                        <span className="text-red-500 font-bold ml-1" aria-hidden="true">
                          *
                        </span>
                      )}
                    </span>
                    {f.options || f.optionsFor ? (
                      <SearchableSelect
                        value={values[f.key]}
                        options={f.optionsFor ? f.optionsFor(values) : f.options ?? []}
                        clearable={!isRequired}
                        onChange={(value) =>
                          setValues(
                            reconcileDependentValues(action.fields, {
                              ...values,
                              [f.key]: value || '',
                            }),
                          )
                        }
                      />
                    ) : (
                      <Input
                        type={f.type || 'text'}
                        required={isRequired}
                        min={f.min}
                        max={f.max}
                        step={f.step}
                        value={values[f.key]}
                        className="text-xs h-9"
                        onChange={(e) =>
                          setValues({ ...values, [f.key]: e.target.value })
                        }
                      />
                    )}
                  </label>
                </Fragment>
              );
            })}
          </div>
          {error && (
            <div className="px-5 py-2">
              <p role="alert" className="text-xs text-red-600 font-medium bg-red-50 p-2.5 rounded border border-red-200">
                {error}
              </p>
            </div>
          )}
          <div className="shrink-0 p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
              className="text-xs h-8"
            >
              Hủy
            </Button>
            {action.confirmTitle ? (
              <Popconfirm
                title={action.confirmTitle}
                okText="Xác nhận"
                cancelText="Quay lại"
                okType="danger"
                onConfirm={() => {
                  confirmedRef.current = true;
                  formRef.current?.requestSubmit();
                  confirmedRef.current = false;
                }}
              >
                <Button type="button" disabled={busy} className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 font-semibold shadow-xs">
                  {busy ? 'Đang xử lý…' : 'Xác nhận'}
                </Button>
              </Popconfirm>
            ) : (
              <Button type="submit" disabled={busy} className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 font-semibold shadow-xs">
                {busy ? 'Đang xử lý…' : 'Xác nhận'}
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
