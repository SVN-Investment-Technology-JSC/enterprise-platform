'use client';
import { useCallback, useEffect, useState } from 'react';
import { Table } from 'antd';
import type {
  HrmLeaveType,
  HrmSalaryAdvanceRequest,
  HrmPayrollPeriod,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch, hrmEmployeeOptions } from '../hrm-api';
import { Button } from '../ui/button';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';
import { useHrmPermissions } from '../hrm-permissions';
import { LeaveLedger } from '../ui/leave-ledger';
const yesNo = [
  { value: 'true', label: 'Có' },
  { value: 'false', label: 'Không' },
];
export default function LeaveSettingsScreen() {
  const { can } = useHrmPermissions();
  const mayReadAdvances = can('hrm.advance.read'),
    mayDisburse = can('hrm.advance.disburse');
  const [types, setTypes] = useState<HrmLeaveType[]>([]),
    [advances, setAdvances] = useState<HrmSalaryAdvanceRequest[]>([]),
    [periods, setPeriods] = useState<HrmPayrollPeriod[]>([]),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [action, setAction] = useState<HrmAction | null>(null);
  const [employees, setEmployees] = useState<
    { value: string; label: string }[]
  >([]);
  const load = useCallback(async () => {
    const [t, a, p, e] = await Promise.all([
      hrmFetch<{ data: HrmLeaveType[] }>('/leave-types'),
      mayReadAdvances
        ? hrmFetch<{ data: HrmSalaryAdvanceRequest[] }>(
            '/salary-advance-requests',
          )
        : Promise.resolve({ data: [] as HrmSalaryAdvanceRequest[] }),
      mayDisburse
        ? hrmFetch<{ data: HrmPayrollPeriod[] }>('/payroll-period-options')
        : Promise.resolve({ data: [] as HrmPayrollPeriod[] }),
      hrmEmployeeOptions(),
    ]);
    setTypes(t.data);
    setEmployees(e);
    setAdvances(a.data);
    setPeriods(p.data.filter((p) => !['LOCKED', 'PAID'].includes(p.status)));
  }, [mayReadAdvances, mayDisburse]);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  async function save(path: string, body: unknown) {
    const result = await hrmFetch<{
      data: { credited?: number; count?: number };
    }>(path, { method: 'POST', body: JSON.stringify(body) });
    setMessage(
      result.data.credited !== undefined
        ? `Đã cộng phép cho ${result.data.credited} dòng; lượt đã xử lý được bỏ qua.`
        : result.data.count !== undefined
          ? `Đã xử lý ${result.data.count} dòng.`
          : 'Đã ghi nhận dữ liệu.',
    );
    await load();
  }
  return (
    <main className="space-y-5 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Quỹ phép và ứng lương</h1>
        <p className="text-sm text-slate-500">
          Định mức, thâm niên, hạn mức âm phép, chuyển phép và thu hồi ứng
          lương.
        </p>
      </header>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-green-700">
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          permission="hrm.leave.manage"
          onClick={() =>
            setAction({
              title: 'Thêm loại nghỉ',
              fields: [
                { key: 'code', label: 'Mã loại' },
                { key: 'name', label: 'Tên loại nghỉ' },
                {
                  key: 'unit',
                  label: 'Đơn vị',
                  options: [
                    { value: 'DAYS', label: 'Ngày' },
                    { value: 'HOURS', label: 'Giờ' },
                  ],
                  value: 'DAYS',
                },
                {
                  key: 'paid',
                  label: 'Hưởng lương',
                  options: yesNo,
                  value: 'true',
                },
                {
                  key: 'deductBalance',
                  label: 'Trừ quỹ phép',
                  options: yesNo,
                  value: 'true',
                },
                {
                  key: 'requiresAttachment',
                  label: 'Yêu cầu chứng từ',
                  options: yesNo,
                  value: 'false',
                },
                {
                  key: 'negativeLimit',
                  label: 'Hạn mức ứng / âm phép',
                  type: 'number',
                  min: 0,
                  value: 0,
                  step: '0.5',
                },
                {
                  key: 'carryoverAllowed',
                  label: 'Cho phép chuyển năm',
                  options: yesNo,
                  value: 'false',
                },
                {
                  key: 'maxCarryoverDays',
                  label: 'Số lượng chuyển tối đa',
                  type: 'number',
                  min: 0,
                  value: 0,
                  step: '0.5',
                },
                {
                  key: 'carryoverExpiryMonth',
                  label: 'Hết hạn cuối tháng',
                  type: 'number',
                  min: 1,
                  max: 12,
                  value: 3,
                },
              ],
              submit: (v) =>
                save('/leave-types', {
                  ...v,
                  paid: v.paid === 'true',
                  deductBalance: v.deductBalance === 'true',
                  requiresAttachment: v.requiresAttachment === 'true',
                  carryoverAllowed: v.carryoverAllowed === 'true',
                  negativeLimit: Number(v.negativeLimit),
                  maxCarryoverDays: Number(v.maxCarryoverDays),
                  carryoverExpiryMonth: Number(v.carryoverExpiryMonth),
                }),
            })
          }
        >
          Thêm loại nghỉ
        </Button>
        <Button
          permission="hrm.leave.manage"
          variant="outline"
          onClick={() =>
            setAction({
              title: 'Lịch cộng phép',
              fields: [
                {
                  key: 'leaveTypeId',
                  label: 'Loại nghỉ',
                  options: types.map((t) => ({ value: t.id, label: t.name })),
                },
                { key: 'effectiveFrom', label: 'Hiệu lực từ', type: 'date' },
                {
                  key: 'effectiveTo',
                  label: 'Hiệu lực đến',
                  type: 'date',
                  optional: true,
                },
                {
                  key: 'accrualFrequency',
                  label: 'Chu kỳ',
                  options: [
                    { value: 'MONTHLY', label: 'Cuối tháng' },
                    { value: 'QUARTERLY', label: 'Cuối quý' },
                    { value: 'YEARLY', label: 'Cuối năm' },
                  ],
                },
                {
                  key: 'accrualAmount',
                  label: 'Số lượng mỗi chu kỳ',
                  type: 'number',
                  min: 0,
                  step: '0.01',
                },
                {
                  key: 'prorationRule',
                  label: 'Phân bổ theo thời gian làm việc',
                  options: [
                    { value: 'BY_JOIN_DATE', label: 'Theo ngày vào làm' },
                    { value: 'NONE', label: 'Đủ định mức kỳ' },
                  ],
                  value: 'BY_JOIN_DATE',
                },
                {
                  key: 'seniorityBonusYears',
                  label: 'Mỗi số năm thâm niên',
                  type: 'number',
                  min: 0,
                  value: 0,
                },
                {
                  key: 'seniorityBonusDays',
                  label: 'Số lượng phép tăng thêm',
                  type: 'number',
                  min: 0,
                  value: 0,
                  step: '0.5',
                },
              ],
              submit: (v) =>
                save(`/leave-types/${v.leaveTypeId}/accrual-schedules`, {
                  ...v,
                  effectiveTo: v.effectiveTo || null,
                  accrualAmount: Number(v.accrualAmount),
                  seniorityBonusYears: Number(v.seniorityBonusYears),
                  seniorityBonusDays: Number(v.seniorityBonusDays),
                }),
            })
          }
        >
          Lịch cộng phép
        </Button>
        <Button
          permission="hrm.leave.manage"
          variant="outline"
          onClick={() =>
            setAction({
              title: 'Chốt cộng phép tháng',
              fields: [
                { key: 'month', label: 'Tháng đã kết thúc', type: 'month' },
              ],
              submit: (v) => save('/leave-accruals/run', v),
            })
          }
        >
          Cộng phép tháng
        </Button>
        <Button
          permission="hrm.leave.manage"
          variant="outline"
          onClick={() =>
            setAction({
              title: 'Chuyển phép năm',
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
        >
          Chuyển phép năm
        </Button>
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
        >
          Hết hạn phép chuyển
        </Button>
      </div>
      {can('hrm.leave.read') && (
        <LeaveLedger employees={employees} types={types} />
      )}
      <section className="rounded-xl border bg-white p-4">
        <Table<HrmLeaveType>
          rowKey="id"
          dataSource={types}
          columns={[
            { title: 'Loại nghỉ', dataIndex: 'name' },
            { title: 'Đơn vị', dataIndex: 'unit' },
            {
              title: 'Hưởng lương',
              render: (_, r) => (r.paid ? 'Có' : 'Không'),
            },
            {
              title: 'Trừ quỹ',
              render: (_, r) => (r.deductBalance ? 'Có' : 'Không'),
            },
            { title: 'Hạn mức âm', dataIndex: 'negativeLimit' },
            { title: 'Chuyển tối đa', dataIndex: 'maxCarryoverDays' },
            { title: 'Hết hạn tháng', dataIndex: 'carryoverExpiryMonth' },
          ]}
        />
      </section>
      {mayReadAdvances && (
        <section className="rounded-xl border bg-white p-4">
          <h2 className="mb-3 font-semibold">Giải ngân và thu hồi ứng lương</h2>
          <Table<HrmSalaryAdvanceRequest>
            rowKey="id"
            dataSource={advances}
            scroll={{ x: 900 }}
            columns={[
              {
                title: 'Nhân viên',
                dataIndex: 'employeeId',
                render: (id) =>
                  employees.find((e) => e.value === id)?.label || id,
              },
              { title: 'Ngày đề nghị', dataIndex: 'requestDate' },
              {
                title: 'Đề nghị',
                dataIndex: 'requestedAmount',
                render: (v) => Number(v).toLocaleString('vi-VN'),
              },
              {
                title: 'Đã duyệt',
                dataIndex: 'approvedAmount',
                render: (v) => Number(v).toLocaleString('vi-VN'),
              },
              {
                title: 'Dư nợ',
                dataIndex: 'remainingBalance',
                render: (v) => Number(v).toLocaleString('vi-VN'),
              },
              { title: 'Trạng thái', dataIndex: 'status' },
              {
                title: 'Thao tác',
                render: (_, r) =>
                  r.status === 'APPROVED' ? (
                    <Button
                      permission="hrm.advance.disburse"
                      variant="outline"
                      onClick={() =>
                        setAction({
                          title: 'Ghi nhận giải ngân ứng lương',
                          fields: [
                            {
                              key: 'disbursedAmount',
                              label: 'Số tiền đã giải ngân',
                              type: 'number',
                              min: 1,
                              max: r.approvedAmount,
                              value: r.approvedAmount,
                            },
                          ],
                          submit: (v) =>
                            save(`/salary-advance-requests/${r.id}/disburse`, {
                              disbursedAmount: Number(v.disbursedAmount),
                            }),
                        })
                      }
                    >
                      Ghi nhận giải ngân
                    </Button>
                  ) : r.status === 'DISBURSED' ? (
                    <Button
                      permission="hrm.advance.disburse"
                      variant="outline"
                      onClick={() =>
                        setAction({
                          title: 'Lập kỳ thu hồi ứng lương',
                          fields: [
                            {
                              key: 'payrollPeriodId',
                              label: 'Kỳ lương thu hồi',
                              options: periods.map((p) => ({
                                value: p.id,
                                label: p.periodCode,
                              })),
                            },
                            {
                              key: 'amount',
                              label: 'Số tiền kỳ này',
                              type: 'number',
                              min: 1,
                              max: r.remainingBalance,
                            },
                          ],
                          submit: (v) =>
                            save(`/salary-advance-requests/${r.id}/schedule`, {
                              ...v,
                              amount: Number(v.amount),
                            }),
                        })
                      }
                    >
                      Lập lịch thu hồi
                    </Button>
                  ) : null,
              },
            ]}
          />
        </section>
      )}
      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </main>
  );
}
