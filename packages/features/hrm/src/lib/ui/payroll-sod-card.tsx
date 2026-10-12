'use client';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Loader2, Save, ShieldCheck } from 'lucide-react';
import { hrmFetch } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import { Button } from './button';
import { InfoNote, SettingsSection, SettingsSwitch } from './settings-kit';
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

function FlowStep({ title, note }: { title: string; note: string }) {
  return (
    <div className="min-w-0 flex-1 basis-32 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-xs font-semibold text-slate-900">{title}</p>
      <p className="text-[11px] text-slate-500">{note}</p>
    </div>
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
      const result = await hrmFetch<{ data: PayrollSodSettings }>('/payroll-sod-settings');
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
      const result = await hrmFetch<{ data: PayrollSodSettings }>('/payroll-sod-settings', {
        method: 'PUT',
        body: JSON.stringify({
          separateCalcFinalize: draft.separateCalcFinalize,
          separateFinalizePublish: draft.separateFinalizePublish,
        }),
      });
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
    <SettingsSection
      icon={ShieldCheck}
      tone="green"
      title="Tách nhiệm vụ trong quy trình lương"
      description="Giảm rủi ro một người tự tính, tự chốt và tự chi trả lương. Áp dụng cho toàn bộ kỳ lương của đơn vị."
      actions={
        <>
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
            className="h-9 px-3 text-xs font-semibold"
          >
            Hoàn tác
          </Button>
          <Button
            permission="hrm.payroll.configure"
            type="button"
            disabled={!dirty || saving || notEnforced}
            onClick={() => void save()}
            className="h-9 gap-1.5 px-3 text-xs font-semibold"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-4" />}
            {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
          </Button>
        </>
      }
      bodyClassName="space-y-3"
    >
      {error && (
        <InfoNote tone="red" role="alert">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{error}</span>
            {!saved && (
              <Button type="button" variant="outline" size="sm" onClick={() => void load()} className="text-xs">
                Tải lại
              </Button>
            )}
          </div>
        </InfoNote>
      )}

      {success && (
        <InfoNote tone="green" role="status">
          {success}
        </InfoNote>
      )}

      {notEnforced && (
        <InfoNote tone="amber" role="status">
          Hệ thống chưa áp dụng bảng cấu hình tách nhiệm vụ (cần quản trị viên cập nhật cơ sở dữ liệu), nên chưa thể bật hoặc tắt các tùy chọn này.
        </InfoNote>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-xs text-slate-500">
          <Loader2 className="size-4 animate-spin" />
          <span>Đang tải cấu hình...</span>
        </div>
      ) : (
        <>
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {SWITCHES.map((item) => (
              <div key={item.key} className="flex items-start gap-3 p-3 @xl:items-center @xl:p-4">
                <SettingsSwitch
                  label={item.label}
                  checked={draft[item.key]}
                  disabled={locked}
                  onChange={(next) => {
                    setSuccess('');
                    setDraft((d) => ({ ...d, [item.key]: next }));
                  }}
                />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">{item.label}</div>
                  <p className="mt-0.5 text-xs leading-snug text-slate-500">{item.description}</p>
                </div>
              </div>
            ))}
          </div>

          <div aria-label="Quy trình lương" className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-3">
            <FlowStep title="Tính lương" note="Người A" />
            <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-slate-400" />
            <FlowStep title="Chốt lương" note={draft.separateCalcFinalize ? 'Khác người tính' : 'Có thể cùng người tính'} />
            <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-slate-400" />
            <FlowStep
              title="Phát hành, chi trả"
              note={draft.separateFinalizePublish ? 'Khác người chốt' : 'Có thể cùng người chốt'}
            />
          </div>
        </>
      )}

      {!canEdit && !loading && (
        <p className="text-xs text-slate-500">Bạn chỉ có quyền xem; thay đổi cấu hình cần quyền cấu hình lương.</p>
      )}
    </SettingsSection>
  );
}
