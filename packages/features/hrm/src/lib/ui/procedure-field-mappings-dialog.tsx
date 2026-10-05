'use client';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { hrmFetch } from '../hrm-api';
import {
  MODE_OPTIONS,
  buildMappingRows,
  fieldOptions,
  mappingWarnings,
  toSavePayload,
  type CatalogField,
  type DefinitionAttribute,
  type MappingMode,
  type MappingRow,
  type SavedMapping,
} from '../procedure-field-mappings-view';
import { Button } from './button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './dialog';

interface Props {
  bindingId: string;
  definitionId: string;
  onClose: () => void;
}

interface Loaded {
  attributes: DefinitionAttribute[];
  catalog: CatalogField[];
  isDefault: boolean;
  rows: MappingRow[];
}

/**
 * Ánh xạ trường HRM -> thuộc tính của quy trình (cấp quy trình và bước S) cho một binding.
 * Quy ước: OVERWRITE = giá trị hệ thống thắng và thuộc tính ẩn khỏi form tạo đơn;
 * PREFILL = giá trị người nộp thắng, hệ thống chỉ điền khi để trống.
 */
export function ProcedureFieldMappingsDialog({
  bindingId,
  definitionId,
  onClose,
}: Props) {
  const [state, setState] = useState<Loaded | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [attributes, mappings] = await Promise.all([
          hrmFetch<{ data: DefinitionAttribute[] }>(
            `/operations/procedure-definitions/${definitionId}/attributes`,
          ),
          hrmFetch<{
            data: {
              isDefault: boolean;
              mappings: SavedMapping[];
              catalog: CatalogField[];
            };
          }>(`/operations/workflow-rules/${bindingId}/field-mappings`),
        ]);
        if (!active) return;
        setState({
          attributes: attributes.data,
          catalog: mappings.data.catalog,
          isDefault: mappings.data.isDefault,
          rows: buildMappingRows(attributes.data, mappings.data.mappings),
        });
      } catch (e) {
        if (active)
          setError(
            e instanceof Error ? e.message : 'Không tải được thuộc tính quy trình',
          );
      }
    })();
    return () => {
      active = false;
    };
  }, [bindingId, definitionId]);

  const options = useMemo(
    () => (state ? fieldOptions(state.catalog) : []),
    [state],
  );
  const warnings = useMemo(
    () => (state ? mappingWarnings(state.rows, state.catalog) : []),
    [state],
  );

  const update = (index: number, patch: Partial<MappingRow>) => {
    setSaved(false);
    setState((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((row, i) =>
              i === index ? { ...row, ...patch } : row,
            ),
          }
        : current,
    );
  };

  async function save() {
    if (!state) return;
    setSaving(true);
    setError('');
    try {
      await hrmFetch(`/operations/workflow-rules/${bindingId}/field-mappings`, {
        method: 'PUT',
        body: JSON.stringify({ mappings: toSavePayload(state.rows) }),
      });
      setSaved(true);
      setState({ ...state, isDefault: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không lưu được ánh xạ');
    } finally {
      setSaving(false);
    }
  }

  const sections: { title: string; rows: { row: MappingRow; index: number }[] }[] =
    [];
  if (state) {
    const indexed = state.rows.map((row, index) => ({ row, index }));
    const processRows = indexed.filter((r) => r.row.attribute.scope === 'process');
    const stepRows = indexed.filter((r) => r.row.attribute.scope === 'step');
    if (processRows.length)
      sections.push({ title: 'Thuộc tính cấp quy trình', rows: processRows });
    if (stepRows.length)
      sections.push({
        title: `Thuộc tính bước S${stepRows[0].row.attribute.stepName ? ` (${stepRows[0].row.attribute.stepName})` : ''}`,
        rows: stepRows,
      });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[820px] max-h-[88vh] overflow-y-auto bg-white">
        <DialogHeader>
          <DialogTitle>Ánh xạ trường HRM vào thuộc tính quy trình</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-slate-600 leading-relaxed">
          Chọn trường HRM cấp giá trị cho từng thuộc tính để cổng điều kiện ở bước S
          dùng được (ví dụ số ngày nghỉ, phòng ban). Thuộc tính đã ánh xạ chế độ ghi đè
          sẽ ẩn khỏi form tạo đơn.
        </p>
        {error && (
          <div role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
            {error}
          </div>
        )}
        {!state && !error && (
          <p className="py-6 text-center text-xs text-slate-500">Đang tải thuộc tính...</p>
        )}
        {state && state.isDefault && (
          <p className="text-[11px] text-slate-500">
            Đang dùng ánh xạ mặc định (tương thích cấu hình cũ). Lưu để xác nhận cấu hình.
          </p>
        )}
        {state && sections.length === 0 && (
          <p className="py-4 text-center text-xs text-slate-500">
            Quy trình này không có thuộc tính cấp quy trình hoặc ở bước S.
          </p>
        )}
        {sections.map((section) => (
          <div key={section.title} className="space-y-2">
            <span className="block text-xs font-bold uppercase tracking-wider text-slate-500">
              {section.title}
            </span>
            {section.rows.map(({ row, index }) => (
              <div
                key={row.attribute.valueKey}
                className="grid items-end gap-2 rounded-lg border border-slate-200 p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)]"
              >
                <div className="text-xs">
                  <div className="font-semibold text-slate-800">
                    {row.attribute.name}
                    {row.attribute.required && (
                      <span className="ml-1 font-bold text-red-500">*</span>
                    )}
                  </div>
                  <div className="font-mono text-[11px] text-slate-500">
                    {row.attribute.code} · {row.attribute.type}
                  </div>
                </div>
                <SearchableSelect
                  options={options}
                  value={row.hrmField}
                  onChange={(value) => update(index, { hrmField: value })}
                  placeholder="Không ánh xạ (người nộp tự nhập)"
                  clearable
                />
                <SearchableSelect
                  options={MODE_OPTIONS}
                  value={row.mode}
                  disabled={!row.hrmField}
                  onChange={(value) =>
                    update(index, { mode: (value || 'OVERWRITE') as MappingMode })
                  }
                  clearable={false}
                />
              </div>
            ))}
          </div>
        ))}
        {warnings.length > 0 && (
          <div
            role="alert"
            className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
          >
            {warnings.map((warning) => (
              <div key={warning} className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 pt-2">
          {saved && <span className="text-xs text-emerald-700">Đã lưu ánh xạ.</span>}
          <Button variant="outline" onClick={onClose} className="h-8 text-xs">
            Đóng
          </Button>
          <Button
            disabled={!state || saving}
            onClick={() => void save()}
            className="h-8 text-xs"
          >
            {saving ? 'Đang lưu...' : 'Lưu ánh xạ'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
