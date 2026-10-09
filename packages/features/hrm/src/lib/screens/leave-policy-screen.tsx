'use client';
import { useCallback, useEffect, useState } from 'react';
import { Tabs } from 'antd';
import {
  Calendar,
  Clock,
  ArrowRightLeft,
  CheckCircle2,
  AlertTriangle,
  Settings2,
  // Hourglass, // dùng lại cùng nút "Hết hạn phép chuyển" khi bỏ comment
} from 'lucide-react';
import type { HrmLeaveType } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { Button } from '../ui/button';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';
import { useHrmPermissions } from '../hrm-permissions';
import { HrmLeaveSchedules } from '../ui/hrm-leave-schedules';
import { LeaveScheduleDialog } from '../ui/leave-schedule-dialog';
import LeaveReasonsScreen from './leave-reasons-screen';

/**
 * Cấu hình phép: danh mục lý do nghỉ phép (độc lập) và lịch cộng phép, mốc thâm niên, cộng phép tháng và chốt phép
 * cuối năm. Toàn bộ thiết lập cách tính phép năm quản lý tại đây, không để ở màn Quỹ phép.
 */
export default function LeavePolicyScreen() {
  const { can } = useHrmPermissions();
  const [types, setTypes] = useState<HrmLeaveType[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [action, setAction] = useState<HrmAction | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [tab, setTab] = useState('reasons');

  const load = useCallback(async () => {
    const t = await hrmFetch<{ data: HrmLeaveType[] }>('/leave-types');
    setTypes(t.data);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);

  async function save(path: string, body: unknown) {
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
    setMessage(
      credited !== undefined
        ? `Đã cộng phép cho ${credited} dòng; lượt đã xử lý được bỏ qua.${
            missingContract?.length
              ? ` ${missingContract.length} nhân viên chưa có HĐLĐ chính thức đã ký nên chưa được cộng phép theo HĐ.`
              : ''
          }`
        : reset !== undefined
          ? `Đã chốt phép cuối năm: reset ${reset} quỹ về 0.${
              blocked?.length
                ? ` ${blocked.length} quỹ chưa chốt vì còn đơn nghỉ chờ duyệt; xử lý đơn rồi chạy lại.`
                : ''
            }`
          : count !== undefined
            ? `Đã xử lý ${count} dòng.`
            : 'Đã ghi nhận dữ liệu.',
    );
    await load();
  }

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Settings2 className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Cấu hình phép
            </h1>
            <p className="text-xs text-slate-500 max-w-[85ch]">
              Danh mục lý do nghỉ, định mức phép năm, lịch cộng phép, mốc thâm niên và chốt phép cuối năm. Hết năm phép còn dư được reset về 0, không chuyển sang năm sau.
            </p>
          </div>
        </div>
        {tab === 'accrual' && (
        <div className="flex flex-wrap items-center gap-2 xl:justify-end">
          <Button
            permission="hrm.leave.manage"
            variant="outline"
            onClick={() => setScheduleOpen(true)}
            className="text-xs flex items-center gap-1.5"
          >
            <Calendar className="size-3.5" />
            <span>Lịch cộng phép</span>
          </Button>
          <Button
            permission="hrm.leave.manage"
            variant="outline"
            onClick={() =>
              setAction({
                title: 'Cộng phép tháng',
                fields: [
                  { key: 'month', label: 'Tháng cần cộng phép', type: 'month' },
                ],
                submit: (v) => save('/leave-accruals/run', v),
              })
            }
            className="text-xs flex items-center gap-1.5"
          >
            <Clock className="size-3.5" />
            <span>Cộng phép tháng</span>
          </Button>
          <Button
            permission="hrm.leave.manage"
            variant="outline"
            onClick={() =>
              setAction({
                title: 'Chốt phép cuối năm',
                description:
                  'Reset toàn bộ phép còn dư về 0, không chuyển sang năm sau. Mọi bút toán được ghi vào sổ giao dịch.',
                fields: [
                  {
                    key: 'year',
                    label: 'Năm nhận phép chuyển',
                    type: 'number',
                    min: 2000,
                    max: new Date().getFullYear(),
                    value: new Date().getFullYear(),
                  },
                ],
                submit: (v) =>
                  save('/leave-carryovers/run', { year: Number(v.year) }),
              })
            }
            className="text-xs flex items-center gap-1.5"
          >
            <ArrowRightLeft className="size-3.5" />
            <span>Chốt phép cuối năm</span>
          </Button>
          {/* Ẩn theo yêu cầu: không còn phép chuyển nên không có phép hết hạn (bỏ comment để dùng lại).
          <Button
            permission="hrm.leave.manage"
            variant="outline"
            onClick={() =>
              setAction({
                title: 'Xử lý phép hết hạn',
                fields: [
                  {
                    key: 'date',
                    label: 'Đối soát đến ngày',
                    type: 'date',
                    value: new Date().toLocaleDateString('en-CA'),
                  },
                ],
                submit: (v) => save('/leave-carryovers/expire', v),
              })
            }
            className="text-xs flex items-center gap-1.5"
          >
            <Hourglass className="size-3.5" />
            <span>Hết hạn phép chuyển</span>
          </Button>
          */}
        </div>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700 shadow-xs flex items-center gap-2"
        >
          <AlertTriangle className="size-4 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      {message && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-semibold text-emerald-700 shadow-xs flex items-center gap-2"
        >
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
          <span>{message}</span>
        </div>
      )}

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'reasons',
            label: 'Lý do nghỉ phép',
            children: (
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                <LeaveReasonsScreen embedded onChanged={load} />
              </section>
            ),
          },
          {
            key: 'accrual',
            label: 'Lịch cộng phép năm',
            children: can('hrm.leave.read') ? (
              <HrmLeaveSchedules types={types} />
            ) : null,
          },
        ]}
      />

      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
      {scheduleOpen && (
        <LeaveScheduleDialog
          mode="create"
          types={types}
          onClose={() => setScheduleOpen(false)}
          onSaved={async (text) => {
            setMessage(text);
            await load();
          }}
        />
      )}
    </div>
  );
}
