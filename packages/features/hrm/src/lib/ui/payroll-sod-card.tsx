'use client';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { hrmFetch } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import { Button } from './button';
import { toast } from './toast';

export interface PayrollSodSettings {
  separateCalcFinalize: boolean;
  separateFinalizePublish: boolean;
  /** false khi hệ thống chưa áp dụng bảng cấu hình (chưa chạy migration). */
  enforced: boolean;
}

type SodKey = 'separateCalcFinalize' | 'separateFinalizePublish';

const SWITCHES: { key: SodKey; label: string; description: string }[] = [
  {
    key: 'separateCalcFinalize',
    label: 'Người chốt lương phải khác người tính lương',
    description:
      'Khi bật, người đã bấm tính lương cho một kỳ không được tự chốt chính kỳ đó. Cần một người khác có quyền chốt lương xác nhận.',
  },
  {
    key: 'separateFinalizePublish',
    label: 'Người phát hành và chi trả phải khác người chốt lương',
    description:
      'Khi bật, người đã chốt lương không được tự phát hành phiếu lương hoặc tự ghi nhận chi trả cho kỳ đó. Cần một người khác thực hiện.',
  },
];

function Switch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-slate-200'
      }`}
    >
      <span
        className={`inline-block size-4.5 rounded-full bg-white shadow-xs transition-transform ${
          checked ? 'translate-x-5.5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export function PayrollSodCard() {
  const { can } = useHrmPermissions();
  const canEdit = can('hrm.payroll.configure');
  const [saved, setSaved] = useState<PayrollSodSettings | null>(null);
  const [draft, setDraft] = useState<Pick<PayrollSodSettings, SodKey>>({
    separateCalcFinalize: false,
    separateFinalizePublish: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await hrmFetch<{ data: PayrollSodSettings }>(
        '/payroll-sod-settings',
      );
      setSaved(result.data);
      setDraft({
        separateCalcFinalize: !!result.data.separateCalcFinalize,
        separateFinalizePublish: !!result.data.separateFinalizePublish,
      });
    } catch (e) {
      setSaved(null);
      setError(
        e instanceof Error
          ? `Không tải được cấu hình tách nhiệm vụ: ${e.message}`
          : 'Không tải được cấu hình tách nhiệm vụ',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty =
    !!saved &&
    (draft.separateCalcFinalize !== saved.separateCalcFinalize ||
      draft.separateFinalizePublish !== saved.separateFinalizePublish);
  const notEnforced = !!saved && saved.enforced === false;
  const locked = !canEdit || saving || !saved || notEnforced;

  async function save() {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await hrmFetch<{ data: PayrollSodSettings }>(
        '/payroll-sod-settings',
        {
          method: 'PUT',
          body: JSON.stringify({
            separateCalcFinalize: draft.separateCalcFinalize,
            separateFinalizePublish: draft.separateFinalizePublish,
          }),
        },
      );
      setSaved(result.data);
      setDraft({
        separateCalcFinalize: !!result.data.separateCalcFinalize,
        separateFinalizePublish: !!result.data.separateFinalizePublish,
      });
      setSuccess('Đã lưu cấu hình tách nhiệm vụ');
      toast.success('Đã lưu cấu hình tách nhiệm vụ');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không lưu được cấu hình');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <div className="flex items-start gap-2.5 border-b border-slate-100 pb-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
          <ShieldCheck className="size-4" />
        </div>
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
            Tách nhiệm vụ trong quy trình lương
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Giảm rủi ro một người tự tính, tự chốt và tự chi trả lương. Cấu hình áp dụng cho toàn bộ kỳ lương của đơn vị.
          </p>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700"
        >
          <AlertTriangle className="size-4 shrink-0" />
          <span className="flex-1">{error}</span>
          {!saved && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void load()}
              className="text-xs"
            >
              Tải lại
            </Button>
          )}
        </div>
      )}

      {success && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-700"
        >
          <CheckCircle2 className="size-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {notEnforced && (
        <div
          role="status"
          className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800"
        >
          Hệ thống chưa áp dụng bảng cấu hình tách nhiệm vụ (cần quản trị viên cập nhật cơ sở dữ liệu), nên chưa thể bật hoặc tắt các tùy chọn này.
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-xs text-slate-500">
          <Loader2 className="size-4 animate-spin" />
          <span>Đang tải cấu hình...</span>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {SWITCHES.map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between gap-4 p-4"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">
                  {item.label}
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {item.description}
                </p>
              </div>
              <Switch
                label={item.label}
                checked={draft[item.key]}
                disabled={locked}
                onChange={(next) => {
                  setSuccess('');
                  setDraft((d) => ({ ...d, [item.key]: next }));
                }}
              />
            </div>
          ))}
        </div>
      )}

      {!canEdit && !loading && (
        <p className="text-xs text-slate-500">
          Bạn chỉ có quyền xem; thay đổi cấu hình cần quyền cấu hình lương.
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          permission="hrm.payroll.configure"
          type="button"
          variant="outline"
          disabled={!dirty || saving}
          onClick={() => {
            if (!saved) return;
            setDraft({
              separateCalcFinalize: saved.separateCalcFinalize,
              separateFinalizePublish: saved.separateFinalizePublish,
            });
          }}
          className="text-xs"
        >
          Hoàn tác
        </Button>
        <Button
          permission="hrm.payroll.configure"
          type="button"
          disabled={!dirty || saving || notEnforced}
          onClick={() => void save()}
          className="bg-blue-600 text-xs text-white hover:bg-blue-700"
        >
          {saving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
          {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
        </Button>
      </div>
    </section>
  );
}
