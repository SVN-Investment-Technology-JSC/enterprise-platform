'use client';
import { useCallback, useEffect, useState } from 'react';
import { Table } from 'antd';
import {
  CalendarOff,
  Plus,
  Calendar,
  Clock,
  ArrowRightLeft,
  Hourglass,
  CheckCircle2,
  AlertTriangle,
  Pencil,
  XCircle,
} from 'lucide-react';
import type { HrmLeaveType } from '@enterprise-platform/contracts-hrm';
import { hrmFetch, hrmEmployeeOptions } from '../hrm-api';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';
import { useHrmPermissions } from '../hrm-permissions';
import { LeaveLedger } from '../ui/leave-ledger';
import { HrmLeaveSchedules } from '../ui/hrm-leave-schedules';

const yesNo = [
  { value: 'true', label: 'Có' },
  { value: 'false', label: 'Không' },
];

export default function LeaveSettingsScreen() {
  const { can } = useHrmPermissions();
  const [types, setTypes] = useState<HrmLeaveType[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [action, setAction] = useState<HrmAction | null>(null);
  const [employees, setEmployees] = useState<
    { value: string; label: string }[]
  >([]);

  const load = useCallback(async () => {
    const [t, e] = await Promise.all([
      hrmFetch<{ data: HrmLeaveType[] }>('/leave-types'),
      hrmEmployeeOptions(),
    ]);
    setTypes(t.data);
    setEmployees(e);
  }, []);

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

  function editLeaveType(row: HrmLeaveType, deactivate = false) {
    setAction({
      title: deactivate ? 'Ngừng sử dụng loại nghỉ' : `Cập nhật ${row.code}`,
      confirmTitle: deactivate ? 'Ngừng loại nghỉ cho các đơn mới?' : undefined,
      description:
        'Giữ dữ liệu và sổ phép hiện có. Chế độ hưởng lương/trừ quỹ của loại đã có đơn không được sửa lại.',
      columns: deactivate ? 1 : 3,
      fields: deactivate
        ? [{ key: 'reason', label: 'Lý do', required: true }]
        : [
            {
              key: 'name',
              label: 'Tên loại nghỉ',
              value: row.name,
              colSpan: 2,
              required: true,
            },
            {
              key: 'active',
              label: 'Đang sử dụng',
              options: yesNo,
              value: String(row.active),
              required: true,
            },
            {
              key: 'paid',
              label: 'Hưởng lương',
              options: yesNo,
              value: String(row.paid),
              required: true,
            },
            {
              key: 'deductBalance',
              label: 'Trừ quỹ phép',
              options: yesNo,
              value: String(row.deductBalance),
              required: true,
            },
            {
              key: 'requiresAttachment',
              label: 'Yêu cầu chứng từ',
              options: yesNo,
              value: String(row.requiresAttachment),
              required: true,
            },
            {
              key: 'negativeLimit',
              label: 'Hạn mức âm phép',
              type: 'number',
              min: 0,
              max: 366,
              step: '0.5',
              value: row.negativeLimit,
              required: true,
            },
            {
              key: 'carryoverAllowed',
              label: 'Chuyển phép sang năm',
              options: yesNo,
              value: String(row.carryoverAllowed),
              required: true,
            },
            {
              key: 'maxCarryoverDays',
              label: 'Số ngày chuyển tối đa',
              type: 'number',
              min: 0,
              max: 366,
              step: '0.5',
              value: row.maxCarryoverDays,
              required: true,
            },
            {
              key: 'carryoverExpiryMonth',
              label: 'Tháng hết hạn phép chuyển',
              type: 'number',
              min: 1,
              max: 12,
              value: row.carryoverExpiryMonth,
              required: true,
            },
            {
              key: 'reason',
              label: 'Lý do',
              colSpan: 2,
              required: true,
            },
          ],
      submit: async (v) => {
        const payload = deactivate
          ? { active: false }
          : {
              name: v.name,
              paid: v.paid === 'true',
              deductBalance: v.deductBalance === 'true',
              requiresAttachment: v.requiresAttachment === 'true',
              negativeLimit: Number(v.negativeLimit),
              carryoverAllowed: v.carryoverAllowed === 'true',
              maxCarryoverDays: Number(v.maxCarryoverDays),
              carryoverExpiryMonth: Number(v.carryoverExpiryMonth),
              active: v.active === 'true',
            };
        await hrmFetch(`/leave-types/${row.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            ...payload,
            expectedUpdatedAt: row.updatedAt,
            reason: v.reason,
          }),
        });
        await load();
      },
    });
  }

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      {/* 1. Page Header Card */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <CalendarOff className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Quản lý Quỹ phép & Loại nghỉ
            </h1>
            <p className="text-xs text-slate-500 max-w-[85ch]">
              Định mức ngày nghỉ, chế độ thâm niên, hạn mức ứng âm phép và chính sách kết chuyển phép cuối năm.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            permission="hrm.leave.manage"
            onClick={() =>
              setAction({
                title: 'Thêm loại nghỉ mới',
                columns: 3,
                fields: [
                  { key: 'code', label: 'Mã loại (VD: AL, SL)', required: true },
                  { key: 'name', label: 'Tên loại nghỉ', colSpan: 2, required: true },
                  {
                    key: 'unit',
                    label: 'Đơn vị tính',
                    options: [
                      { value: 'DAYS', label: 'Ngày' },
                      { value: 'HOURS', label: 'Giờ' },
                    ],
                    value: 'DAYS',
                    required: true,
                  },
                  {
                    key: 'paid',
                    label: 'Hưởng lương',
                    options: yesNo,
                    value: 'true',
                    required: true,
                  },
                  {
                    key: 'deductBalance',
                    label: 'Trừ quỹ phép',
                    options: yesNo,
                    value: 'true',
                    required: true,
                  },
                  {
                    key: 'requiresAttachment',
                    label: 'Yêu cầu chứng từ kèm theo',
                    options: yesNo,
                    value: 'false',
                    required: true,
                  },
                  {
                    key: 'negativeLimit',
                    label: 'Hạn mức ứng / âm phép',
                    type: 'number',
                    min: 0,
                    value: 0,
                    step: '0.5',
                    required: true,
                  },
                  {
                    key: 'carryoverAllowed',
                    label: 'Cho phép chuyển sang năm sau',
                    options: yesNo,
                    value: 'false',
                    required: true,
                  },
                  {
                    key: 'maxCarryoverDays',
                    label: 'Số lượng chuyển tối đa',
                    type: 'number',
                    min: 0,
                    value: 0,
                    step: '0.5',
                    required: true,
                  },
                  {
                    key: 'carryoverExpiryMonth',
                    label: 'Hết hạn vào cuối tháng (1-12)',
                    type: 'number',
                    min: 1,
                    max: 12,
                    value: 3,
                    colSpan: 2,
                    required: true,
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
            className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 shadow-xs text-xs"
          >
            <Plus className="size-4" />
            <span>Thêm loại nghỉ</span>
          </Button>
          <Button
            permission="hrm.leave.manage"
            variant="outline"
            onClick={() =>
              setAction({
                title: 'Lập lịch cộng phép',
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
                title: 'Chốt cộng phép tháng',
                fields: [
                  { key: 'month', label: 'Tháng đã kết thúc', type: 'month' },
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
            className="text-xs flex items-center gap-1.5"
          >
            <ArrowRightLeft className="size-3.5" />
            <span>Chuyển phép năm</span>
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
            className="text-xs flex items-center gap-1.5"
          >
            <Hourglass className="size-3.5" />
            <span>Hết hạn phép chuyển</span>
          </Button>
        </div>
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

      {/* 2. Leave Ledger & Schedules Components */}
      {can('hrm.leave.read') && (
        <LeaveLedger employees={employees} types={types} />
      )}
      {can('hrm.leave.read') && <HrmLeaveSchedules types={types} />}

      {/* 3. Leave Types Directory Table */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-xs p-5 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Danh mục các loại nghỉ phép ({types.length})
          </span>
        </div>
        <Table<HrmLeaveType>
          size="small"
          rowKey="id"
          dataSource={types}
          scroll={{ x: 1100, y: 380 }}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (total, range) => `Hiển thị ${range[0]}–${range[1]} / ${total} loại nghỉ`,
          }}
          columns={[
            {
              title: 'Loại nghỉ',
              dataIndex: 'name',
              render: (v, r) => (
                <div>
                  <span className="font-semibold text-slate-900 block">{v}</span>
                  <span className="text-[11px] font-mono text-slate-500">{r.code}</span>
                </div>
              ),
            },
            {
              title: 'Đơn vị',
              dataIndex: 'unit',
              width: 100,
              render: (v) => <span className="text-xs text-slate-700">{v === 'HOURS' ? 'Giờ' : 'Ngày'}</span>,
            },
            {
              title: 'Hưởng lương',
              render: (_, r) =>
                r.paid ? (
                  <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">Hưởng lương</Badge>
                ) : (
                  <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-xs">Không hưởng</Badge>
                ),
            },
            {
              title: 'Trừ quỹ',
              render: (_, r) =>
                r.deductBalance ? (
                  <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-xs">Trừ quỹ</Badge>
                ) : (
                  <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-xs">Không trừ</Badge>
                ),
            },
            {
              title: 'Hạn mức âm',
              dataIndex: 'negativeLimit',
              width: 120,
              render: (v) => <span className="text-xs text-slate-700">{v} {v ? 'ngày' : ''}</span>,
            },
            {
              title: 'Chuyển tối đa',
              dataIndex: 'maxCarryoverDays',
              width: 120,
              render: (v) => <span className="text-xs text-slate-700">{v} {v ? 'ngày' : ''}</span>,
            },
            {
              title: 'Hết hạn tháng',
              dataIndex: 'carryoverExpiryMonth',
              width: 120,
              render: (v) => <span className="text-xs text-slate-700">{v ? `Tháng ${v}` : '—'}</span>,
            },
            {
              title: 'Trạng thái',
              width: 130,
              render: (_, r) =>
                r.active ? (
                  <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">Đang áp dụng</Badge>
                ) : (
                  <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-xs">Đã ngừng</Badge>
                ),
            },
            {
              title: 'Thao tác',
              fixed: 'right',
              width: 140,
              render: (_, r) =>
                can('hrm.leave.manage') ? (
                  <div className="flex gap-1.5">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => editLeaveType(r)}
                      className="h-7 text-xs px-2"
                    >
                      <Pencil className="size-3 mr-1" />
                      Sửa
                    </Button>
                    {r.active && (
                      <Button
                        size="xs"
                        variant="destructive"
                        onClick={() => editLeaveType(r, true)}
                        className="h-7 text-xs px-2"
                      >
                        <XCircle className="size-3 mr-1" />
                        Ngừng
                      </Button>
                    )}
                  </div>
                ) : null,
            },
          ]}
        />
      </section>

      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </div>
  );
}
