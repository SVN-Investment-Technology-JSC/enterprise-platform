'use client';
import { useState } from 'react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
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
}
export interface HrmAction {
  title: string;
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
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader className="border-b border-slate-200 bg-slate-50 px-5 py-4 pr-12">
          <DialogTitle>{action.title}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4 p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
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
          <div className="max-h-[65vh] space-y-4 overflow-auto">
            {action.fields.map((f) => (
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
            <Button type="submit" disabled={busy}>
              {busy ? 'Đang xử lý…' : 'Xác nhận'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
