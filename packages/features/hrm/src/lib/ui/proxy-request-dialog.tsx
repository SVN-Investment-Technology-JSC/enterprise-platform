'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, UserRoundPlus } from 'lucide-react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { hrmFetch } from '../hrm-api';
import { leaveBalancesOf, type LeaveTypeItem, type ShiftItem } from '../request-form-model';
import type { LinkableProject } from '../workspace-projects';
import { Button } from './button';
import { CreateRequestForm, type RequestFormResult, type RequestKind } from './create-request-form';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './dialog';

/** Các loại đơn được tạo hộ. Khớp danh sách cho phép ở máy chủ (nghỉ phép, tăng ca, công tác, giải trình công). */
export const PROXY_KIND_OPTIONS: readonly { value: ProxyKind; label: string; title: string }[] = [
  { value: 'leave', label: 'Nghỉ phép', title: 'Đơn nghỉ phép' },
  { value: 'ot', label: 'Tăng ca', title: 'Đơn làm thêm giờ' },
  { value: 'business_trip', label: 'Công tác', title: 'Đơn công tác' },
  { value: 'correction', label: 'Giải trình công', title: 'Đơn giải trình công' },
];
export type ProxyKind = 'leave' | 'ot' | 'business_trip' | 'correction';

export const MAX_PROXY_REASON = 500;

interface Candidate {
  readonly employeeId: string;
  readonly employeeCode: string;
  readonly fullName: string;
}

export interface ProxyRequestDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly leaveTypes: LeaveTypeItem[];
  readonly shifts: ShiftItem[];
  readonly projects: LinkableProject[];
  readonly onSubmitted: (result: RequestFormResult) => void | Promise<void>;
  readonly onAbandoned: (message: string) => void | Promise<void>;
}

/**
 * Tạo đơn nghỉ phép, tăng ca, công tác, giải trình công hộ nhân viên. Bước 1 chọn loại đơn, nhân viên (trong phạm vi được cấu hình) và
 * lý do tạo hộ; bước 2 là chính form tạo đơn, chạy theo dữ liệu của nhân viên được chọn. Máy chủ kiểm lại quyền, phạm vi
 * và lý do khi gửi nên giao diện chỉ là lớp dẫn đường.
 */
export function ProxyRequestDialog(props: ProxyRequestDialogProps) {
  const { open, onOpenChange } = props;
  const [kind, setKind] = useState<ProxyKind>('leave');
  const [employeeId, setEmployeeId] = useState('');
  const [reason, setReason] = useState('');
  const [step, setStep] = useState<'pick' | 'form'>('pick');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [balances, setBalances] = useState<ReturnType<typeof leaveBalancesOf>>({});
  const [balancesLoading, setBalancesLoading] = useState(false);

  // Mỗi lần mở là một lần làm mới: không giữ nhân viên và lý do của lần trước.
  useEffect(() => {
    if (!open) return;
    setStep('pick');
    setEmployeeId('');
    setReason('');
    setError('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    setError('');
    setEmployeeId('');
    hrmFetch<{ data: Candidate[] }>(`/request-proxy/candidates?${new URLSearchParams({ kind, q: '' })}`)
      .then((res) => live && setCandidates(res.data))
      .catch((e: unknown) => {
        if (!live) return;
        setCandidates([]);
        setError(e instanceof Error ? e.message : 'Không tải được danh sách nhân viên.');
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [open, kind]);

  const options = useMemo(
    () => candidates.map((c) => ({ value: c.employeeId, label: `${c.employeeCode} · ${c.fullName}` })),
    [candidates],
  );
  const selected = candidates.find((c) => c.employeeId === employeeId);
  const kindOption = PROXY_KIND_OPTIONS.find((o) => o.value === kind) ?? PROXY_KIND_OPTIONS[0];
  const trimmed = reason.trim();
  const canContinue = Boolean(selected) && trimmed.length > 0 && !loading;

  async function goToForm() {
    if (!selected) return;
    setStep('form');
    if (kind !== 'leave') return;
    setBalancesLoading(true);
    try {
      const res = await hrmFetch<{ data: Parameters<typeof leaveBalancesOf>[0] }>(`/employees/${selected.employeeId}/leave-balances`);
      setBalances(leaveBalancesOf(res.data ?? []));
    } catch {
      setBalances({});
    } finally {
      setBalancesLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl overflow-hidden bg-white p-0">
        {step === 'pick' || !selected ? (
          <div className="flex flex-col">
            <DialogHeader className="border-b border-slate-200 bg-slate-50 p-5">
              <DialogTitle className="flex items-center gap-2 text-base font-bold text-slate-900">
                <UserRoundPlus className="size-4 text-[#021E73]" />
                Tạo đơn hộ nhân viên
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Chỉ chọn được nhân viên trong phạm vi bạn được tạo hộ. Đơn được gửi duyệt như đơn của nhân viên và ghi nhận bạn
                là người tạo.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 p-6 text-xs">
              <label className="block space-y-1">
                <span className="font-semibold text-slate-700">Loại đơn</span>
                <SearchableSelect
                  height={36}
                  options={PROXY_KIND_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                  value={kind}
                  onChange={(v) => v && setKind(v as ProxyKind)}
                  clearable={false}
                />
              </label>
              <label className="block space-y-1">
                <span className="font-semibold text-slate-700">Tạo cho</span>
                <SearchableSelect
                  height={36}
                  options={options}
                  value={employeeId}
                  onChange={(v) => setEmployeeId(v || '')}
                  placeholder={loading ? 'Đang tải danh sách…' : 'Tìm nhân viên theo tên hoặc mã…'}
                  emptyText="Không có nhân viên nào trong phạm vi tạo hộ của bạn"
                />
              </label>
              <label className="block space-y-1">
                <span className="font-semibold text-slate-700">
                  Lý do tạo hộ <span className="text-red-600">*</span>
                </span>
                <textarea
                  aria-label="Lý do tạo hộ"
                  rows={3}
                  maxLength={MAX_PROXY_REASON}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ví dụ: nhân viên báo ốm qua điện thoại, đang công tác ngoài, chưa có máy tính…"
                  className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-[#d9ab00] focus:ring-2 focus:ring-[#d9ab00]/30"
                />
                <span className="block text-right text-[11px] text-slate-400">
                  {reason.length}/{MAX_PROXY_REASON}
                </span>
              </label>
              {error ? (
                <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2.5 font-semibold text-red-700">
                  {error}
                </p>
              ) : null}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 p-4">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onOpenChange(false)}>
                Hủy
              </Button>
              <Button
                size="sm"
                className="h-8 gap-1 bg-[#021E73] text-xs font-semibold text-white hover:bg-blue-900"
                disabled={!canContinue}
                onClick={() => void goToForm()}
              >
                {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Tiếp tục
              </Button>
            </div>
          </div>
        ) : (
          <CreateRequestForm
            key={`${kind}:${selected.employeeId}`}
            kind={kind as RequestKind}
            title={`${kindOption.title} hộ ${selected.fullName}`}
            customType={null}
            data={{
              employeeId: selected.employeeId,
              profile: { fullName: selected.fullName },
              leaveTypes: props.leaveTypes,
              shifts: props.shifts,
              projects: props.projects,
              leaveBalances: balances,
              loading: balancesLoading,
              onBehalf: { reason: trimmed, employeeName: `${selected.fullName} (${selected.employeeCode})` },
            }}
            onCancel={() => onOpenChange(false)}
            onSubmitted={props.onSubmitted}
            onAbandoned={props.onAbandoned}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
