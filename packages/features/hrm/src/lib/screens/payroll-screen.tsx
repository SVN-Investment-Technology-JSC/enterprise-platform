'use client';
import { useCallback, useEffect, useState } from 'react';
import { Table, Popconfirm } from 'antd';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import type {
  HrmPayrollPeriod,
  HrmTimesheetPeriod,
  HrmPayrollItem,
} from '@enterprise-platform/contracts-hrm';
import Link from 'next/link';
import { hrmFetch, downloadHrmExport } from '../hrm-api';
import { Button } from '../ui/button';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';
import { useHrmPermissions } from '../hrm-permissions';
type Run = { id: string; run_no: number; status: string };
type Total = {
  id: string;
  employee_id: string;
  full_name: string;
  employee_code: string;
  gross_salary: string;
  net_salary: string;
  total_statutory_deductions: string;
  personal_income_tax: string;
  advance_deductions: string;
  other_deductions: string;
  payment_status: string;
};
const money = (n: unknown) =>
  Number(n || 0).toLocaleString('vi-VN', {
    style: 'currency',
    currency: 'VND',
  });
export default function PayrollScreen() {
  const { can } = useHrmPermissions();
  const mayReadTimesheets = can('hrm.timesheet.read');
  const [periods, setPeriods] = useState<HrmPayrollPeriod[]>([]),
    [timesheets, setTimesheets] = useState<HrmTimesheetPeriod[]>([]),
    [selected, setSelected] = useState('');
  const [runs, setRuns] = useState<Run[]>([]),
    [runId, setRunId] = useState(''),
    [totals, setTotals] = useState<Total[]>([]),
    [items, setItems] = useState<HrmPayrollItem[]>([]);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [action, setAction] = useState<HrmAction | null>(null);
  const run = runs.find((r) => r.id === runId);
  const load = useCallback(async () => {
    const [p, t] = await Promise.all([
      hrmFetch<{ data: HrmPayrollPeriod[] }>('/payroll-periods'),
      mayReadTimesheets
        ? hrmFetch<{ data: HrmTimesheetPeriod[] }>('/timesheet-periods')
        : Promise.resolve({ data: [] as HrmTimesheetPeriod[] }),
    ]);
    setPeriods(p.data);
    setTimesheets(t.data.filter((r) => r.status === 'LOCKED'));
    setSelected((id) => id || p.data[0]?.id || '');
  }, [mayReadTimesheets]);
  const loadRuns = useCallback(async () => {
    if (!selected) return;
    const result = await hrmFetch<{ data: Run[] }>(
      `/payroll-periods/${selected}/runs`,
    );
    setRuns(result.data);
    setRunId((id) =>
      result.data.some((r) => r.id === id) ? id : result.data[0]?.id || '',
    );
  }, [selected]);
  const loadTotals = useCallback(async () => {
    if (!runId) return;
    const [t, i] = await Promise.all([
      hrmFetch<{ data: Total[] }>(`/payroll-runs/${runId}/totals`),
      hrmFetch<{ data: HrmPayrollItem[] }>(`/payroll-runs/${runId}/items`),
    ]);
    setTotals(t.data);
    setItems(i.data);
  }, [runId]);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  useEffect(() => {
    setRuns([]);
    setRunId('');
    setTotals([]);
    void loadRuns().catch((e) => setError(e.message));
  }, [loadRuns]);
  useEffect(() => {
    setTotals([]);
    void loadTotals().catch((e) => setError(e.message));
  }, [loadTotals]);
  async function command(path: string, body: unknown = {}) {
    setBusy(true);
    setError('');
    try {
      await hrmFetch(path, { method: 'POST', body: JSON.stringify(body) });
      await load();
      await loadRuns();
      await loadTotals();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thực hiện được');
      throw e;
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="space-y-5 p-6">
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Tiền lương và chi trả</h1>
          <p className="text-sm text-slate-500">
            Tính từ bảng công đã khóa; lưu công thức và dữ liệu tại lần tính để
            đối soát.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/payroll/settings"
            className="rounded border px-4 py-2 text-sm"
          >
            Cấu hình lương / OT
          </Link>
          <Button
            permission="hrm.payroll.calculate"
            onClick={() =>
              setAction({
                title: 'Tạo kỳ lương',
                fields: [
                  { key: 'periodCode', label: 'Mã kỳ' },
                  {
                    key: 'timesheetPeriodId',
                    label: 'Bảng công đã khóa',
                    options: timesheets.map((t) => ({
                      value: t.id,
                      label: t.periodCode,
                    })),
                  },
                  {
                    key: 'paymentDate',
                    label: 'Ngày trả lương dự kiến',
                    type: 'date',
                  },
                ],
                submit: (v) => {
                  const t = timesheets.find(
                    (t) => t.id === v.timesheetPeriodId,
                  );
                  if (!t) throw new Error('Chọn kỳ công');
                  return command('/payroll-periods', {
                    ...v,
                    fromDate: t.fromDate,
                    toDate: t.toDate,
                  });
                },
              })
            }
          >
            Tạo kỳ
          </Button>
        </div>
      </header>
      {error && (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 p-3 text-red-700"
        >
          {error}
        </p>
      )}
      <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="max-h-[70vh] space-y-2 overflow-auto rounded-xl border bg-white p-3">
          {periods.map((p) => (
            <button
              key={p.id}
              className={`w-full rounded-lg border p-3 text-left ${selected === p.id ? 'border-blue-500 bg-blue-50' : ''}`}
              onClick={() => setSelected(p.id)}
            >
              <strong>{p.periodCode}</strong>
              <p className="text-xs">
                {p.fromDate} → {p.toDate}
              </p>
              <p className="text-xs text-slate-500">{p.status}</p>
            </button>
          ))}
        </aside>
        <section className="min-w-0 space-y-4 rounded-xl border bg-white p-4">
          <div className="flex flex-wrap gap-2">
            <Button
              permission="hrm.payroll.export"
              variant="outline"
              disabled={run?.status !== 'FINALIZED'}
              onClick={() =>
                void downloadHrmExport(
                  `/payroll-runs/${runId}/export?kind=payments`,
                ).catch((e) => setError(e.message))
              }
            >
              Xuất chi trả CSV
            </Button>
            <Button
              permission="hrm.payroll.export"
              variant="outline"
              disabled={run?.status !== 'FINALIZED'}
              onClick={() =>
                void downloadHrmExport(
                  `/payroll-runs/${runId}/export?kind=reconciliation`,
                ).catch((e) => setError(e.message))
              }
            >
              Xuất đối soát khoản lương
            </Button>
            <div className="min-w-56">
              <SearchableSelect
                value={runId}
                options={runs.map((r) => ({
                  value: r.id,
                  label: `Lần ${r.run_no} · ${r.status}`,
                }))}
                clearable={false}
                onChange={(v) => setRunId(v || '')}
              />
            </div>
            <Button
              permission="hrm.payroll.calculate"
              variant="outline"
              disabled={!selected || busy}
              onClick={() =>
                void command(`/payroll-periods/${selected}/runs`).catch(
                  () => undefined,
                )
              }
            >
              Thêm lần tính
            </Button>
            <Button
              permission="hrm.payroll.calculate"
              disabled={!runId || run?.status === 'FINALIZED' || busy}
              onClick={() =>
                void command(`/payroll-runs/${runId}/calculate`).catch(
                  () => undefined,
                )
              }
            >
              Tính lương
            </Button>
            <Popconfirm
              title="Chốt kết quả lương?"
              description="Số liệu sẽ được cố định để phát hành phiếu lương."
              onConfirm={() => command(`/payroll-runs/${runId}/finalize`)}
            >
              <Button
                permission="hrm.payroll.finalize"
                disabled={
                  !['CALCULATED', 'APPROVED'].includes(run?.status || '') ||
                  busy
                }
              >
                Chốt lương
              </Button>
            </Popconfirm>
            <Button
              permission="hrm.payroll.publish"
              disabled={run?.status !== 'FINALIZED' || busy}
              onClick={() =>
                void command(`/payroll-runs/${runId}/payslips/generate`).catch(
                  () => undefined,
                )
              }
            >
              Phát hành phiếu lương
            </Button>
          </div>
          <Table<Total>
            rowKey="id"
            dataSource={totals}
            pagination={{ pageSize: 15 }}
            scroll={{ x: 1300, y: 480 }}
            columns={[
              {
                title: 'Nhân viên',
                render: (_, r) => (
                  <div>
                    <strong>{r.full_name}</strong>
                    <p className="text-xs text-slate-500">{r.employee_code}</p>
                  </div>
                ),
              },
              { title: 'Thu nhập', dataIndex: 'gross_salary', render: money },
              {
                title: 'Bảo hiểm / bắt buộc',
                dataIndex: 'total_statutory_deductions',
                render: money,
              },
              {
                title: 'Thuế',
                dataIndex: 'personal_income_tax',
                render: money,
              },
              {
                title: 'Ứng lương',
                dataIndex: 'advance_deductions',
                render: money,
              },
              {
                title: 'Khấu trừ khác',
                dataIndex: 'other_deductions',
                render: money,
              },
              { title: 'Thực lĩnh', dataIndex: 'net_salary', render: money },
              {
                title: 'Thanh toán',
                render: (_, r) =>
                  r.payment_status === 'PAID' ? (
                    'Đã chi trả'
                  ) : (
                    <Button
                      permission="hrm.payroll.pay"
                      variant="outline"
                      disabled={run?.status !== 'FINALIZED'}
                      onClick={() =>
                        setAction({
                          title: `Đối soát chi trả — ${r.full_name}`,
                          fields: [
                            {
                              key: 'reference',
                              label: 'Mã chứng từ / giao dịch ngân hàng',
                            },
                          ],
                          submit: (v) =>
                            command(
                              `/payroll-totals/${r.id}/record-payment`,
                              v,
                            ),
                        })
                      }
                    >
                      Ghi nhận chi trả
                    </Button>
                  ),
              },
              {
                title: 'Bổ sung',
                render: (_, r) => (
                  <Button
                    permission="hrm.payroll.adjust"
                    variant="outline"
                    disabled={run?.status === 'FINALIZED'}
                    onClick={() =>
                      setAction({
                        title: `Khoản điều chỉnh — ${r.full_name}`,
                        fields: [
                          { key: 'itemCode', label: 'Mã khoản' },
                          {
                            key: 'itemType',
                            label: 'Loại',
                            options: [
                              { value: 'EARNING', label: 'Thu nhập bổ sung' },
                              {
                                value: 'OTHER_DEDUCTION',
                                label: 'Khấu trừ khác',
                              },
                            ],
                          },
                          {
                            key: 'amount',
                            label: 'Số tiền',
                            type: 'number',
                            min: 0,
                            step: '0.01',
                          },
                          { key: 'reason', label: 'Căn cứ nghiệp vụ' },
                        ],
                        submit: (v, operationId) =>
                          command(`/payroll-runs/${runId}/adjustments`, {
                            ...v,
                            operationId,
                            employeeId: r.employee_id,
                            amount: Number(v.amount),
                          }),
                      })
                    }
                  >
                    Điều chỉnh
                  </Button>
                ),
              },
            ]}
            expandable={{
              expandedRowRender: (r) => (
                <div className="space-y-2">
                  {items
                    .filter((i) => i.employeeId === r.employee_id)
                    .map((i) => (
                      <div
                        key={i.id}
                        className="grid grid-cols-[1fr_auto] gap-4 border-b pb-2"
                      >
                        <div>
                          <strong>{i.description}</strong>
                          <p className="text-xs text-slate-500">
                            {String(
                              i.calculationSnapshot?.formula ||
                                'Khoản điều chỉnh',
                            )}
                          </p>
                        </div>
                        <span>{money(i.amount)}</span>
                      </div>
                    ))}
                </div>
              ),
            }}
          />
        </section>
      </div>
      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </main>
  );
}
