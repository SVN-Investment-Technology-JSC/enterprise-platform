'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  RotateCcw,
  Save,
} from 'lucide-react';
import type { AnnualLeavePolicyResponse } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  AnnualLeavePolicyCard,
  policyStatus,
  useAnnualLeavePolicyForm,
} from '../ui/annual-leave-policy-card';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';
import { PageTitle } from '../ui/page-title';

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/** Tháng hiện tại (YYYY-MM): phép được +1 từ ngày 01 nên chạy cộng phép tháng này được ngay (không cần chờ hết tháng). */
function currentMonth() {
  return new Date().toLocaleDateString('en-CA').slice(0, 7);
}

// Quy tắc cũ: chỉ cộng tháng đã kết thúc, mặc định tháng liền trước (bỏ comment để dùng lại):
// function previousMonth() {
//   const date = new Date();
//   date.setDate(1);
//   date.setMonth(date.getMonth() - 1);
//   return date.toLocaleDateString('en-CA').slice(0, 7);
// }

/**
 * Chính sách phép năm: MỘT biểu mẫu cho cả hệ thống (cách tính phép, phép thâm niên, hiệu lực và ghi chú) kèm thẻ tóm tắt;
 * nút Lưu thay đổi ở tiêu đề. Cuối trang là hai tác vụ chạy thủ công (cộng phép tháng, chốt phép cuối năm).
 * Danh mục lý do nghỉ là chức năng riêng (màn Lý do nghỉ).
 */
export default function LeaveSettingsScreen() {
  const { can, loading: permissionsLoading } = useHrmPermissions();
  const canManage = can('hrm.leave.manage');
  const canRead = canManage || can('hrm.leave.read');

  const [policy, setPolicy] = useState<AnnualLeavePolicyResponse | null>(null);
  const [policyError, setPolicyError] = useState('');
  const [periodicMessage, setPeriodicMessage] = useState('');
  const [action, setAction] = useState<HrmAction | null>(null);

  const loadPolicy = useCallback(async () => {
    setPolicyError('');
    try {
      const result = await hrmFetch<{ data: AnnualLeavePolicyResponse }>(
        '/annual-leave-policy',
      );
      setPolicy(result.data);
    } catch (error) {
      setPolicyError(errorText(error, 'Không tải được chính sách phép năm'));
    }
  }, []);

  const policyForm = useAnnualLeavePolicyForm({
    data: policy,
    canManage,
    onSaved: (next) => setPolicy(next),
  });

  useEffect(() => {
    if (canRead) void loadPolicy();
  }, [canRead, loadPolicy]);

  async function runPeriodic(path: string, body: unknown) {
    const result = await hrmFetch<{
      data: {
        credited?: number;
        count?: number;
        reset?: number;
        missingContract?: string[];
        blocked?: unknown[];
      };
    }>(path, { method: 'POST', body: JSON.stringify(body) });
    const { credited, count, reset, missingContract, blocked } = result.data;
    setPeriodicMessage(
      credited !== undefined
        ? `Đã cộng phép cho ${credited} dòng; lượt đã xử lý được bỏ qua.${
            missingContract?.length
              ? ` ${missingContract.length} nhân viên chưa có HĐLĐ chính thức đã ký nên chưa được cộng phép theo HĐ.`
              : ''
          }`
        : reset !== undefined
          ? `Đã chốt cuối năm: reset ${reset} quỹ (phép năm không chuyển sang năm sau).${
              blocked?.length
                ? ` ${blocked.length} quỹ chưa chốt vì còn đơn nghỉ chờ duyệt; xử lý đơn rồi chạy lại.`
                : ''
            }`
          : count !== undefined
            ? `Đã xử lý ${count} dòng.`
            : 'Đã ghi nhận dữ liệu.',
    );
  }

  if (!permissionsLoading && !canRead) {
    return (
      <div
        role="alert"
        className="mx-auto max-w-[1200px] rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500"
      >
        Bạn không có quyền xem chính sách phép năm.
      </div>
    );
  }

  const status = policyStatus(policy);

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      {!canManage && policy ? (
        <Badge
          variant="outline"
          className="h-7 border-slate-200 bg-slate-100 px-3 text-xs text-slate-600"
        >
          Chỉ xem
        </Badge>
      ) : null}
      {policy ? (
        <Badge
          variant="outline"
          data-testid="policy-status"
          className={`h-7 px-3 text-xs ${
            status === 'active'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-amber-200 bg-amber-50 text-amber-700'
          }`}
        >
          <span
            aria-hidden="true"
            className={`mr-1.5 inline-block size-1.5 rounded-full ${
              status === 'active' ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
          />
          {status === 'active' ? 'Đang áp dụng' : 'Sắp áp dụng'}
        </Badge>
      ) : null}
      <Button
        permission="hrm.leave.manage"
        type="button"
        disabled={!policyForm.canSave}
        onClick={() => void policyForm.save()}
        className="h-9 gap-1.5 px-4 text-xs font-semibold"
      >
        <Save className="size-4" />
        {policyForm.busy ? 'Đang lưu...' : 'Lưu thay đổi'}
      </Button>
    </div>
  );

  const periodicTasks = [
    {
      key: 'accrual',
      title: 'Cộng phép tháng',
      icon: <Clock className="size-4" />,
      description:
        'Cộng phép của một tháng (kể cả tháng hiện tại) cho mọi nhân viên đủ điều kiện.',
      run: () =>
        setAction({
          title: 'Cộng phép tháng',
          description:
            'Cộng phép cho một tháng đã bắt đầu theo Chính sách phép năm (+1 từ ngày 01 hàng tháng). Lượt đã xử lý được bỏ qua nên chạy lại không bị cộng trùng.',
          fields: [
            {
              key: 'month',
              label: 'Tháng cần cộng',
              type: 'month',
              value: currentMonth(),
            },
          ],
          submit: (v) => runPeriodic('/leave-accruals/run', { month: v.month }),
        }),
    },
    {
      key: 'carryover',
      title: 'Chốt phép cuối năm',
      icon: <RotateCcw className="size-4" />,
      description:
        'Chốt phép cuối năm: reset phần còn lại về 0, không chuyển phép sang năm sau.',
      run: () =>
        setAction({
          title: 'Chốt phép cuối năm',
          description:
            'Phép năm không chuyển sang năm sau: reset phần còn lại của năm cũ về 0. Mọi bút toán được ghi vào sổ giao dịch.',
          fields: [
            {
              key: 'year',
              label: 'Năm nhận quỹ mới',
              type: 'number',
              min: 2000,
              max: new Date().getFullYear(),
              value: new Date().getFullYear(),
            },
          ],
          submit: (v) =>
            runPeriodic('/leave-carryovers/run', { year: Number(v.year) }),
        }),
    },
  ];

  return (
    <div className="@container mx-auto max-w-[1400px] space-y-4">
      <PageTitle
        title="Chính sách phép năm"
        description="Thiết lập nguyên tắc tính và tích lũy phép năm áp dụng cho nhân viên."
        badge={headerActions}
      />

      <AnnualLeavePolicyCard
        controller={policyForm}
        loadError={policyError}
        onReload={() => void loadPolicy()}
      />

      {canManage ? (
        <section
          aria-label="Tác vụ định kỳ"
          className="rounded-xl border border-slate-200 bg-white p-4"
        >
          <div className="mb-3 flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <CalendarClock className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight text-slate-900">
                Tác vụ định kỳ
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Chạy thủ công khi cần. Mọi bút toán được ghi vào sổ giao dịch.
              </p>
            </div>
          </div>
          {periodicMessage ? (
            <p
              role="status"
              className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700"
            >
              <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
              {periodicMessage}
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
            {periodicTasks.map((task) => (
              <div
                key={task.key}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-slate-600 ring-1 ring-slate-200">
                  {task.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-900">
                    {task.title}
                  </p>
                  <p className="text-[12px] leading-snug text-slate-500">
                    {task.description}
                  </p>
                </div>
                <Button
                  variant="outline"
                  aria-label={task.title}
                  className="h-8 shrink-0 px-3 text-xs font-semibold"
                  onClick={() => {
                    setPeriodicMessage('');
                    task.run();
                  }}
                >
                  Chạy
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {action ? (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      ) : null}
    </div>
  );
}
