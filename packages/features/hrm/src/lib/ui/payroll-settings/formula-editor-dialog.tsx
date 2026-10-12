'use client';
/**
 * Hộp thoại soạn phiên bản công thức lương. Màn rộng: soạn công thức ở cột trái; tóm tắt, tính thử và biến hệ thống ở cột
 * phải. Màn hẹp: một cột. Logic (state, kiểm tra, API) giữ nguyên so với bản cũ trong payroll-settings-screen.
 */
import { useId, useState, type ReactNode } from 'react';
import { FileText, Loader2, Plus, Trash2, Variable } from 'lucide-react';
import { Popconfirm, SearchableSelect } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '../date-picker-input';
import { Button } from '../button';
import { Input } from '../input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../dialog';
import { InfoNote, SettingsField } from '../settings-kit';
import { PayrollDryRunPanel } from '../payroll-dry-run-panel';
import {
  PAYROLL_SYSTEM_INPUTS,
  buildPayrollTemplate,
  formatInputs,
  unfilledTemplateInputs,
} from '../../hrm-payroll-config';
import { AutoTextarea } from './data-rows';
import { COMPONENT_TYPES, defaultComponents, parameters, type Component, type Version } from './types';

const standardModeOptions = [
  { value: 'DYNAMIC', label: 'Công chuẩn động: theo ngày công thực tế của tháng (trừ ngày nghỉ)' },
  { value: 'FIXED', label: 'Công chuẩn cố định: số ngày công do cấu hình, tháng nào cũng như nhau' },
];
const standardModeLegacyOption = { value: 'MINUTES', label: 'Định mức phút cố định (cấu hình cũ)' };

const salaryTypeOptions = [
  { value: 'GROSS', label: 'Gross (trước thuế)' },
  { value: 'NET', label: 'Net (thực nhận)' },
];

export type FormulaEditorMode = { kind: 'new' } | { kind: 'edit'; version: Version } | { kind: 'clone'; version: Version };

function SideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      {children}
    </section>
  );
}

export function FormulaEditorDialog({
  mode,
  onSubmit,
  onClose,
}: {
  mode: FormulaEditorMode;
  onSubmit: (path: string, body: unknown, method: 'POST' | 'PATCH') => Promise<void>;
  onClose: () => void;
}) {
  const uid = useId();
  const source = mode.kind === 'new' ? null : mode.version;
  const editing = mode.kind === 'edit' ? mode.version : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [templateNote, setTemplateNote] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(
    editing ? editing.effective_from.slice(0, 10) : '',
  );
  const [salaryType, setSalaryType] = useState(source?.config_json.salaryType || 'GROSS');
  const [standardMinutes, setStandardMinutes] = useState(
    source?.config_json.standardMinutes ? String(source.config_json.standardMinutes) : '',
  );
  const [standardMode, setStandardMode] = useState<'DYNAMIC' | 'FIXED' | 'MINUTES'>(
    source
      ? (source.config_json.standardWorkMode ?? (source.config_json.standardMinutes ? 'MINUTES' : 'DYNAMIC'))
      : 'DYNAMIC',
  );
  const [standardWorkdays, setStandardWorkdays] = useState(
    source?.config_json.standardWorkdays ? String(source.config_json.standardWorkdays) : '',
  );
  const [inputs, setInputs] = useState(
    source
      ? Object.entries(source.config_json.inputs || {})
          .map(([k, value]) => `${k}=${value}`)
          .join('; ')
      : '',
  );
  const [components, setComponents] = useState<Component[]>(
    source ? (source.config_json.components || []).map((c) => ({ ...c })) : defaultComponents(),
  );

  function update(index: number, patch: Partial<Component>) {
    setComponents((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  const title = editing
    ? `Sửa phiên bản v${editing.version_no} công thức lương`
    : mode.kind === 'clone'
      ? `Tạo bản kế tiếp từ v${mode.version.version_no}`
      : 'Phiên bản công thức lương';

  const paramCount = inputs.split(/[;\n]/).filter((s) => s.trim()).length;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="@container flex max-h-[90dvh] w-[calc(100%-2rem)] flex-col overflow-hidden bg-white p-0 sm:max-w-[1180px]">
        <DialogHeader className="shrink-0 border-b border-slate-200 bg-slate-50/80 px-4 py-4 pr-12 @xl:px-5">
          <DialogTitle className="text-base font-bold text-slate-900">{title}</DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            Cấu hình chu kỳ hiệu lực, các khoản thu nhập / khấu trừ và công thức tính lương động
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              await onSubmit(
                editing ? `/payroll-configuration/${editing.id}` : '/payroll-configuration',
                {
                  effectiveFrom,
                  salaryType,
                  components,
                  inputs: parameters(inputs),
                  reason,
                  ...(editing ? { expectedUpdatedAt: editing.updated_at } : {}),
                  standardWorkMode: standardMode,
                  ...(standardMode === 'FIXED' ? { standardWorkdays: Number(standardWorkdays) } : {}),
                  ...(standardMode === 'MINUTES' ? { standardMinutes: Number(standardMinutes) } : {}),
                },
                editing ? 'PATCH' : 'POST',
              );
              onClose();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Không lưu được');
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-4 @xl:p-5">
            <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="min-w-0 space-y-4">
                <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2">
                  <SettingsField label="Ngày hiệu lực" required>
                    <DatePickerInput
                      height={36}
                      required
                      disabled={!!editing}
                      value={effectiveFrom}
                      onChange={(v: string) => setEffectiveFrom(v)}
                    />
                  </SettingsField>
                  <SettingsField label="Loại lương mặc định">
                    <SearchableSelect
                      height={36}
                      value={salaryType}
                      clearable={false}
                      options={salaryTypeOptions}
                      onChange={(v) => setSalaryType(v || 'GROSS')}
                    />
                  </SettingsField>
                </div>

                <div
                  className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/50 p-3"
                  data-testid="standard-work-config"
                >
                  <SettingsField label="Công chuẩn của kỳ (mẫu số tính lương theo công)">
                    <SearchableSelect
                      height={36}
                      value={standardMode}
                      clearable={false}
                      options={
                        standardMode === 'MINUTES'
                          ? [...standardModeOptions, standardModeLegacyOption]
                          : standardModeOptions
                      }
                      onChange={(v) => setStandardMode((v as 'DYNAMIC' | 'FIXED' | 'MINUTES') || 'DYNAMIC')}
                    />
                  </SettingsField>
                  {standardMode === 'FIXED' && (
                    <SettingsField label="Số ngày công chuẩn" required htmlFor={`${uid}-days`} className="max-w-xs">
                      <Input
                        id={`${uid}-days`}
                        type="number"
                        min={1}
                        max={31}
                        step={0.5}
                        required
                        value={standardWorkdays}
                        onChange={(e) => setStandardWorkdays(e.target.value)}
                        className="h-9 text-xs"
                        placeholder="Ví dụ 26"
                      />
                    </SettingsField>
                  )}
                  {standardMode === 'MINUTES' && (
                    <SettingsField label="Số phút công chuẩn của toàn kỳ" required htmlFor={`${uid}-minutes`} className="max-w-xs">
                      <Input
                        id={`${uid}-minutes`}
                        type="number"
                        min={1}
                        max={90720}
                        step={1}
                        required
                        value={standardMinutes}
                        onChange={(e) => setStandardMinutes(e.target.value)}
                        className="h-9 text-xs"
                      />
                    </SettingsField>
                  )}
                  <p className="text-[11px] leading-snug text-slate-500">
                    {standardMode === 'FIXED'
                      ? 'Lương theo công = lương tháng x công được trả / công chuẩn cố định, dù tháng có bao nhiêu ngày nghỉ. Công thức mẫu tính đơn giá tăng ca cũng chia theo công chuẩn này (biến STANDARD_PERIOD_MINUTES).'
                      : standardMode === 'MINUTES'
                        ? 'Cấu hình cũ theo số phút. Nên chuyển sang công chuẩn động hoặc cố định theo ngày công.'
                        : 'Công chuẩn bằng số ngày công thực tế của tháng theo phân ca (đã trừ ngày nghỉ hằng tuần). Người vào hoặc nghỉ việc giữa kỳ được trả theo công chuẩn của kỳ.'}
                  </p>
                </div>

                <section aria-label="Thành phần lương" className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-900">
                      Thành phần lương <span className="font-normal text-slate-500">({components.length})</span>
                    </h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <Popconfirm
                        title="Nạp mẫu công thức?"
                        description="Các thành phần và tham số đang soạn sẽ được thay bằng mẫu tham khảo."
                        okText="Nạp mẫu"
                        cancelText="Quay lại"
                        onConfirm={() => {
                          const t = buildPayrollTemplate();
                          setComponents(t.components.map((c) => ({ ...c })));
                          setInputs(formatInputs(t.inputs));
                          setTemplateNote(
                            unfilledTemplateInputs(t.inputs, t).map((k) => `${k}: ${t.inputNotes[k] ?? ''}`),
                          );
                        }}
                      >
                        <Button type="button" variant="outline" className="h-8 gap-1.5 text-xs">
                          <FileText className="size-3.5" />
                          <span>Dùng mẫu</span>
                        </Button>
                      </Popconfirm>
                      <Button
                        variant="outline"
                        type="button"
                        onClick={() => setComponents([...components, { code: '', name: '', type: 'EARNING', formula: '0' }])}
                        className="h-8 gap-1.5 text-xs"
                      >
                        <Plus className="size-3.5" />
                        <span>Thêm thành phần lương</span>
                      </Button>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Mẫu gồm lương theo công, OT, phụ cấp, BHXH/BHYT/BHTN, giảm trừ gia cảnh, thuế TNCN, tạm ứng, thực lĩnh.
                  </p>
                  {templateNote.length > 0 && (
                    <InfoNote tone="amber" role="status">
                      <div className="font-semibold">
                        Tham số mẫu đang bằng 0, HR/kế toán cần nhập và xác nhận theo quy định hiện hành trước khi lưu
                      </div>
                      <ul className="mt-1 list-disc pl-4 @2xl:columns-2">
                        {templateNote.map((n) => (
                          <li key={n}>{n}</li>
                        ))}
                      </ul>
                    </InfoNote>
                  )}
                  <div className="space-y-2">
                    {components.map((c, i) => (
                      <div key={i} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/50 p-2.5">
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 @xl:grid-cols-[130px_minmax(0,1fr)_200px_auto]">
                          <Input
                            aria-label={`Mã khoản ${i + 1}`}
                            required
                            placeholder="MÃ"
                            value={c.code}
                            onChange={(e) => update(i, { code: e.target.value.toUpperCase() })}
                            className="h-9 font-mono text-xs"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            aria-label={`Bỏ khoản ${i + 1}`}
                            title="Bỏ khoản này"
                            onClick={() => setComponents((rows) => rows.filter((_, index) => index !== i))}
                            className="size-9 border-rose-200 text-rose-600 hover:bg-rose-50 @xl:order-last"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                          <Input
                            aria-label={`Tên khoản ${i + 1}`}
                            required
                            placeholder="Tên khoản"
                            value={c.name}
                            onChange={(e) => update(i, { name: e.target.value })}
                            className="col-span-2 h-9 text-xs @xl:col-span-1"
                          />
                          <div className="col-span-2 @xl:col-span-1">
                            <SearchableSelect
                              height={36}
                              value={c.type}
                              options={COMPONENT_TYPES}
                              clearable={false}
                              onChange={(v) => update(i, { type: v || 'EARNING' })}
                            />
                          </div>
                        </div>
                        <AutoTextarea
                          singleLine
                          aria-label={`Công thức ${i + 1}`}
                          required
                          placeholder="Công thức tính"
                          value={c.formula}
                          onChange={(formula) => update(i, { formula })}
                          className="font-mono"
                        />
                      </div>
                    ))}
                  </div>
                </section>

                <SettingsField
                  label="Tham số chung (MA=giá trị; MA_KHAC=giá trị)"
                  htmlFor={`${uid}-params`}
                >
                  <AutoTextarea
                    id={`${uid}-params`}
                    value={inputs}
                    onChange={setInputs}
                    placeholder="VD: PHUCAP_AN=730000; DONG_PHUC=500000"
                    className="font-mono"
                  />
                </SettingsField>

                <SettingsField label="Lý do thay đổi" required htmlFor={`${uid}-reason`}>
                  <Input
                    id={`${uid}-reason`}
                    required
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Nhập lý do (ghi vào nhật ký kiểm toán)"
                    className="h-9 text-xs"
                  />
                </SettingsField>
              </div>

              <aside className="min-w-0 space-y-4">
                <SideCard title="Tóm tắt phiên bản">
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-slate-500">Thành phần</dt>
                    <dd className="text-right font-semibold text-slate-900">{components.length}</dd>
                    <dt className="text-slate-500">Tham số chung</dt>
                    <dd className="text-right font-semibold text-slate-900">{paramCount}</dd>
                    <dt className="text-slate-500">Loại lương</dt>
                    <dd className="text-right font-semibold text-slate-900">{salaryType === 'NET' ? 'Net' : 'Gross'}</dd>
                    <dt className="text-slate-500">Công chuẩn</dt>
                    <dd className="text-right font-semibold text-slate-900">
                      {standardMode === 'FIXED'
                        ? `Cố định${standardWorkdays ? ` ${standardWorkdays} ngày` : ''}`
                        : standardMode === 'MINUTES'
                          ? 'Theo phút (cũ)'
                          : 'Động theo tháng'}
                    </dd>
                  </dl>
                </SideCard>
                <PayrollDryRunPanel components={components} inputs={() => parameters(inputs)} />
                <SideCard title="Biến hệ thống">
                  <p className="text-[11px] leading-snug text-slate-500">
                    Tự tính theo kỳ, không nhập trong tham số.
                  </p>
                  <details className="group rounded-lg border border-slate-200 bg-slate-50/60">
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2 text-xs font-semibold text-slate-700">
                      <Variable aria-hidden="true" className="size-3.5 text-slate-500" />
                      {PAYROLL_SYSTEM_INPUTS.length} biến có thể dùng trong công thức
                    </summary>
                    <dl className="max-h-64 space-y-1.5 overflow-y-auto border-t border-slate-200 p-2.5 text-[11px]">
                      {PAYROLL_SYSTEM_INPUTS.map((item) => (
                        <div key={item.code} className="min-w-0">
                          <dt className="font-mono font-semibold break-all text-slate-800">{item.code}</dt>
                          <dd className="leading-snug text-slate-500">{item.label}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                  <p className="text-[11px] leading-relaxed text-slate-500">
                    Toán tử: <code className="font-mono">+ - * /</code>, so sánh{' '}
                    <code className="font-mono">{'< > <= >= == !='}</code>; hàm <code className="font-mono">MIN(a, b)</code>,{' '}
                    <code className="font-mono">MAX(a, b)</code>, <code className="font-mono">ROUND(x, số chữ số)</code>,{' '}
                    <code className="font-mono">IF(điều kiện, a, b)</code>. Có thể dùng mã thành phần khác và mã tham số chung.
                  </p>
                </SideCard>
              </aside>
            </div>
          </div>
          <div className="shrink-0 space-y-2 border-t border-slate-200 bg-slate-50 p-3 @xl:px-5">
            {error && (
              <InfoNote tone="red" role="alert">
                {error}
              </InfoNote>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose} className="h-9 px-4 text-xs">
                Hủy bỏ
              </Button>
              <Button type="submit" disabled={busy} className="h-9 gap-1.5 px-4 text-xs font-semibold">
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {busy ? 'Đang lưu…' : 'Lưu phiên bản'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
