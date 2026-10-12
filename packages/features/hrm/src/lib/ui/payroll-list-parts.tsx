'use client';

import type { ReactNode } from 'react';
import {
  BookOpen,
  Calculator,
  CalendarDays,
  Check,
  ChevronRight,
  Clock,
  FileText,
  Plus,
} from 'lucide-react';
import type { HrmPayrollPeriod } from '@enterprise-platform/contracts-hrm';
import { Button } from './button';

/** Trạng thái lần tính mới nhất (bỏ qua lần đã hủy) của từng kỳ lương; `null` là chưa có lần tính nào, thiếu khóa là chưa biết. */
export type PayrollLatestRunStatus = Record<string, string | null | undefined>;

export interface PayrollListStats {
  /** Kỳ chưa chốt (OPEN, PROCESSING). */
  open: number;
  /** Kỳ chưa chốt và chưa có kết quả tính còn hiệu lực (chưa có lần tính, lần tính bị trả về hoặc đang nháp cần tính lại). */
  waitingCalculation: number;
  /** Kỳ chưa chốt đã có kết quả tính, chờ chốt lương. */
  waitingFinalize: number;
  /** Kỳ đã chốt (LOCKED, PAID): đủ điều kiện phát hành phiếu lương hoặc đã chi trả. */
  released: number;
}

/** Trạng thái lần tính coi là "đã có kết quả tính, chờ chốt". */
const WAITING_FINALIZE_RUN = ['CALCULATED', 'IN_REVIEW', 'APPROVED'];
/** Trạng thái lần tính coi là "cần tính (lại)". */
const WAITING_CALCULATION_RUN = ['DRAFT', 'REJECTED'];

/** Chọn lần tính mới nhất không bị hủy từ danh sách lần tính của một kỳ. */
export function latestRunStatus(
  runs: readonly { run_no: number; status: string }[],
): string | null {
  const live = runs.filter((r) => r.status !== 'CANCELLED');
  if (live.length === 0) return null;
  return live.reduce((a, b) => (b.run_no > a.run_no ? b : a)).status;
}

/** Số kỳ lương theo từng bước của quy trình, tính từ trạng thái kỳ và lần tính mới nhất. */
export function payrollListStats(
  periods: readonly Pick<HrmPayrollPeriod, 'id' | 'status'>[],
  latest: PayrollLatestRunStatus,
): PayrollListStats {
  const stats: PayrollListStats = {
    open: 0,
    waitingCalculation: 0,
    waitingFinalize: 0,
    released: 0,
  };
  for (const p of periods) {
    if (p.status === 'LOCKED' || p.status === 'PAID') {
      stats.released += 1;
      continue;
    }
    stats.open += 1;
    const run = latest[p.id];
    if (run === undefined) continue;
    if (run === null || WAITING_CALCULATION_RUN.includes(run)) stats.waitingCalculation += 1;
    else if (WAITING_FINALIZE_RUN.includes(run)) stats.waitingFinalize += 1;
  }
  return stats;
}

function StatCard({
  testId,
  icon,
  tone,
  label,
  value,
}: {
  testId: string;
  icon: ReactNode;
  tone: string;
  label: string;
  value: number;
}) {
  return (
    <div
      data-testid={testId}
      className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3"
    >
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-slate-600">{label}</p>
        <p className="font-mono text-2xl font-bold leading-tight text-slate-900">{value}</p>
        <p className="truncate text-[11px] text-slate-400">Kỳ lương</p>
      </div>
    </div>
  );
}

/** Bốn thẻ số liệu: kỳ đang mở, chờ tính lương, chờ chốt lương, đã phát hành. */
export function PayrollStatCards({ stats }: { stats: PayrollListStats }) {
  return (
    <div aria-label="Tổng quan kỳ lương" className="grid grid-cols-2 gap-2 xl:grid-cols-4">
      <StatCard
        testId="payroll-stat-open"
        icon={<CalendarDays className="size-5" />}
        tone="bg-blue-50 text-blue-600"
        label="Kỳ lương đang mở"
        value={stats.open}
      />
      <StatCard
        testId="payroll-stat-waiting-calculation"
        icon={<FileText className="size-5" />}
        tone="bg-amber-50 text-amber-600"
        label="Chờ tính lương"
        value={stats.waitingCalculation}
      />
      <StatCard
        testId="payroll-stat-waiting-finalize"
        icon={<Clock className="size-5" />}
        tone="bg-violet-50 text-violet-600"
        label="Chờ chốt lương"
        value={stats.waitingFinalize}
      />
      <StatCard
        testId="payroll-stat-released"
        icon={<Check className="size-5" />}
        tone="bg-emerald-50 text-emerald-600"
        label="Đã phát hành"
        value={stats.released}
      />
    </div>
  );
}

const STEPS = [
  {
    title: 'Chọn kỳ công đã khóa',
    description: 'Chọn tháng và dữ liệu bảng công đã được khóa.',
  },
  {
    title: 'Tính và kiểm tra lương',
    description: 'Hệ thống tự động tính lương theo cấu hình. Kiểm tra và điều chỉnh (nếu có).',
  },
  {
    title: 'Chốt và phát hành phiếu lương',
    description: 'Chốt kỳ lương và phát hành phiếu lương cho nhân viên.',
  },
] as const;

/** Dải "Quy trình tạo kỳ lương" 3 bước. */
export function PayrollProcessSteps() {
  return (
    <section
      aria-label="Quy trình tạo kỳ lương"
      className="flex flex-col gap-3 rounded-xl border border-blue-100 bg-blue-50/40 p-3.5 lg:flex-row lg:items-center"
    >
      <div className="flex shrink-0 items-center gap-3 lg:w-64">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-blue-600 ring-1 ring-blue-100">
          <BookOpen className="size-5" />
        </span>
        <div>
          <h2 className="text-sm font-bold text-slate-900">Quy trình tạo kỳ lương</h2>
          <p className="text-[11px] text-slate-500">Thực hiện theo 3 bước đơn giản để tạo và phát hành kỳ lương.</p>
        </div>
      </div>
      <ol className="grid min-w-0 flex-1 gap-3 md:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title} data-testid={`payroll-step-${index + 1}`} className="flex min-w-0 items-start gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-blue-600 ring-1 ring-blue-200">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-slate-900">{step.title}</p>
              <p className="text-[11px] leading-snug text-slate-500">{step.description}</p>
            </div>
            {index < STEPS.length - 1 ? (
              <ChevronRight aria-hidden="true" className="mt-1 hidden size-4 shrink-0 text-slate-400 md:block" />
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Trạng thái chưa có kỳ lương: minh họa, mô tả và nút tạo kỳ lương đầu tiên (chỉ hiện khi có quyền tính lương). */
export function PayrollEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div data-testid="payroll-empty" className="flex flex-col items-center px-4 py-8 text-center">
      <div aria-hidden="true" className="relative mb-4 flex size-24 items-center justify-center rounded-2xl bg-blue-50">
        <FileText className="size-12 text-blue-300" strokeWidth={1.5} />
        <span className="absolute -bottom-2 -right-2 flex size-10 items-center justify-center rounded-xl bg-blue-500 text-white shadow-sm">
          <Calculator className="size-5" />
        </span>
      </div>
      <h2 className="text-lg font-bold text-slate-900">Chưa có kỳ lương</h2>
      <p className="mt-1 max-w-[60ch] text-xs text-slate-500">
        Tạo kỳ lương để tổng hợp dữ liệu từ bảng công đã khóa, tính lương và phát hành phiếu lương.
      </p>
      <Button permission="hrm.payroll.calculate" onClick={onCreate} className="mt-4 h-9 px-4 text-sm font-semibold">
        <Plus className="size-4" />
        Tạo kỳ lương đầu tiên
      </Button>
    </div>
  );
}
