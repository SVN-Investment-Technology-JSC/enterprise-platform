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
  optional?: boolean;
  min?: number;
  max?: number;
  step?: string;
  section?: string;
}
export interface HrmAction {
  title: string;
  confirmTitle?: string;
  description?: string;
  columns?: 1 | 2;
  fields: ActionField[];
  submit: (
    values: Record<string, string>,
    operationId: string,
  ) => Promise<void>;
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
        className={
          action.columns === 2 ? 'sm:max-w-[900px]' : 'sm:max-w-[680px]'
        }
      >
        <DialogHeader className="border-b border-slate-200 bg-slate-50 px-5 py-4 pr-12">
          <DialogTitle>{action.title}</DialogTitle>
          {action.description && (
            <p className="text-xs text-slate-500">{action.description}</p>
          )}
        </DialogHeader>
        <form
          ref={formRef}
          className="space-y-4 p-5"
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
              for (const f of action.fields)
                if (!f.optional && !values[f.key]?.trim())
                  throw new Error(`Cần nhập ${f.label}`);
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
            className={`max-h-[60vh] overflow-auto pr-1 ${action.columns === 2 ? 'grid grid-cols-1 gap-3 sm:grid-cols-2' : 'space-y-4'}`}
          >
            {action.fields.map((f, index) => (
              <Fragment key={f.key}>
                {f.section &&
                  f.section !== action.fields[index - 1]?.section && (
                    <h3 className="col-span-full border-b border-slate-200 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {f.section}
                    </h3>
                  )}
                <label className="block space-y-1 text-sm" key={f.key}>
                  <span>{f.label}</span>
                  {f.options ? (
                    <SearchableSelect
                      value={values[f.key]}
                      options={f.options}
                      clearable={!!f.optional}
                      onChange={(value) =>
                        setValues({ ...values, [f.key]: value || '' })
                      }
                    />
                  ) : (
                    <Input
                      type={f.type || 'text'}
                      required={!f.optional}
                      min={f.min}
                      max={f.max}
                      step={f.step}
                      value={values[f.key]}
                      onChange={(e) =>
                        setValues({ ...values, [f.key]: e.target.value })
                      }
                    />
                  )}
                </label>
              </Fragment>
            ))}
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
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
                <Button type="button" disabled={busy}>
                  {busy ? 'Đang xử lý…' : 'Xác nhận'}
                </Button>
              </Popconfirm>
            ) : (
              <Button type="submit" disabled={busy}>
                {busy ? 'Đang xử lý…' : 'Xác nhận'}
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
