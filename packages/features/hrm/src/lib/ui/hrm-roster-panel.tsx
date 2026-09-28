'use client';
import { useMemo, useState } from 'react';
import { Table } from 'antd';
import Link from 'next/link';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import type {
  HrmEmployeeProfile,
  HrmShiftAssignment,
  HrmShiftDefinition,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { Button } from './button';
import { Input } from './input';
import {
  HrmActionDialog,
  type HrmAction,
  type ActionField,
} from './hrm-action-dialog';

type RosterRow = HrmShiftAssignment & {
  employeeName?: string;
  employeeCode?: string;
  shiftCode?: string;
  shiftName?: string;
};
const statusNames: Record<string, string> = {
  ACTIVE: 'Đang áp dụng',
  SUPERSEDED: 'Đã thay thế',
  CANCELLED: 'Đã hủy',
};
const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase();
export function HrmRosterPanel({
  rows,
  employees,
  shifts,
  onChanged,
}: {
  rows: RosterRow[];
  employees: HrmEmployeeProfile[];
  shifts: HrmShiftDefinition[];
  onChanged: () => Promise<void>;
}) {
  const [query, setQuery] = useState(''),
    [status, setStatus] = useState('ACTIVE'),
    [department, setDepartment] = useState('');
  const [action, setAction] = useState<HrmAction | null>(null);
  const departments = useMemo(
    () =>
      Array.from(
        new Set(
          employees.map((e) => e.department).filter((d): d is string => !!d),
        ),
      ).map((d) => ({ value: d, label: d })),
    [employees],
  );
  const filtered = rows.filter(
    (r) =>
      (!status || r.status === status) &&
      (!department ||
        employees.some(
          (e) => e.employeeId === r.employeeId && e.department === department,
        )) &&
      normalize(
        [r.employeeName, r.employeeCode, r.shiftCode, r.shiftName].join(' '),
      ).includes(normalize(query)),
  );
  const fields = (row?: RosterRow): ActionField[] => [
    ...(!row
      ? [
          {
            key: 'employeeId',
            label: 'Nhân viên',
            options: employees
              .filter(
                (e) => !['RESIGNED', 'TERMINATED'].includes(e.employmentStatus),
              )
              .map((e) => ({
                value: e.employeeId,
                label: `${e.employeeCode} · ${e.fullName}`,
              })),
          },
        ]
      : []),
    {
      key: 'shiftId',
      label: 'Ca làm việc',
      value: row?.shiftId,
      options: shifts
        .filter((s) => s.status === 'ACTIVE' || s.id === row?.shiftId)
        .map((s) => ({
          value: s.id,
          label: `${s.code} · ${s.startTime.slice(0, 5)}–${s.endTime.slice(0, 5)}${s.crossMidnight ? ' (+1 ngày)' : ''}`,
        })),
    },
    {
      key: 'effectiveFrom',
      label: 'Từ ngày',
      type: 'date',
      value: row?.effectiveFrom || new Date().toLocaleDateString('en-CA'),
    },
    {
      key: 'effectiveTo',
      label: 'Đến ngày',
      type: 'date',
      optional: true,
      value: row?.effectiveTo || '',
    },
    ...(row ? [{ key: 'reason', label: 'Lý do điều chỉnh' }] : []),
  ];
  function edit(row?: RosterRow) {
    setAction({
      title: row ? `Sửa phân ca · ${row.employeeCode}` : 'Phân ca nhân viên',
      columns: 2,
      description:
        'Một ca chính cho mỗi ngày. Ca qua đêm tính theo ngày bắt đầu. Ngày OFF/lễ cấu hình tại lịch nghỉ.',
      fields: fields(row),
      submit: async (v) => {
        await hrmFetch(
          row
            ? `/shift-assignments/${row.id}`
            : `/employees/${v.employeeId}/shift-assignments`,
          {
            method: row ? 'PATCH' : 'POST',
            body: JSON.stringify({
              ...v,
              effectiveTo: v.effectiveTo || null,
              ...(row
                ? { expectedUpdatedAt: row.updatedAt }
                : { source: 'MANUAL' }),
            }),
          },
        );
        await onChanged();
      },
    });
  }
  function cancel(row: RosterRow) {
    setAction({
      title: `Hủy phân ca · ${row.employeeCode}`,
      confirmTitle: 'Hủy lịch này và đánh dấu kỳ mở cần tính lại?',
      description:
        'Lịch đã hủy được giữ trong lịch sử. Kỳ công đã khóa phải được mở lại theo quyền trước.',
      fields: [{ key: 'reason', label: 'Lý do hủy' }],
      submit: async (v) => {
        await hrmFetch(`/shift-assignments/${row.id}`, {
          method: 'DELETE',
          body: JSON.stringify({ ...v, expectedUpdatedAt: row.updatedAt }),
        });
        await onChanged();
      },
    });
  }
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Lịch phân ca đã lưu</h2>
          <p className="text-xs text-slate-500">
            Theo dõi ca, khoảng hiệu lực và lịch sử thay đổi từng nhân viên.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/policies?tab=calendar"
            className="rounded border px-3 py-2 text-xs"
          >
            Lịch OFF / lễ
          </Link>
          <Button
            permission="hrm.shift.manage"
            size="sm"
            onClick={() => edit()}
          >
            Phân ca
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <Input
          aria-label="Tìm phân ca"
          placeholder="Tìm mã nhân viên, họ tên hoặc ca…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <SearchableSelect
          placeholder="Tất cả phòng ban"
          options={departments}
          value={department}
          onChange={(v) => setDepartment(v || '')}
          clearable
        />
        <SearchableSelect
          placeholder="Tất cả trạng thái"
          options={Object.entries(statusNames).map(([value, label]) => ({
            value,
            label,
          }))}
          value={status}
          onChange={(v) => setStatus(v || '')}
          clearable
        />
      </div>
      <Table<RosterRow>
        size="small"
        rowKey="id"
        dataSource={filtered}
        pagination={{
          pageSize: 20,
          showSizeChanger: false,
          showTotal: (n) => `${n} lịch phân ca`,
        }}
        scroll={{ x: 1100, y: 440 }}
        locale={{ emptyText: 'Chưa có lịch phù hợp' }}
        columns={[
          {
            title: 'Mã NV',
            dataIndex: 'employeeCode',
            width: 100,
            fixed: 'left',
          },
          { title: 'Nhân viên', dataIndex: 'employeeName', width: 210 },
          {
            title: 'Phòng ban',
            width: 170,
            render: (_, r) =>
              employees.find((e) => e.employeeId === r.employeeId)
                ?.department || 'Chưa phân bổ',
          },
          { title: 'Ca', dataIndex: 'shiftCode', width: 120 },
          {
            title: 'Từ ngày',
            dataIndex: 'effectiveFrom',
            width: 110,
            sorter: (a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom),
          },
          {
            title: 'Đến ngày',
            dataIndex: 'effectiveTo',
            width: 110,
            render: (v) => v || 'Không giới hạn',
          },
          {
            title: 'Trạng thái',
            dataIndex: 'status',
            width: 130,
            render: (v) => statusNames[v] || v,
          },
          {
            title: 'Thao tác',
            width: 150,
            fixed: 'right',
            render: (_, r) =>
              r.status === 'ACTIVE' ? (
                <span className="inline-flex gap-1">
                  <Button
                    permission="hrm.shift.manage"
                    size="sm"
                    variant="outline"
                    onClick={() => edit(r)}
                  >
                    Sửa
                  </Button>
                  <Button
                    permission="hrm.shift.manage"
                    size="sm"
                    variant="outline"
                    onClick={() => cancel(r)}
                  >
                    Hủy lịch
                  </Button>
                </span>
              ) : null,
          },
        ]}
      />
      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </section>
  );
}
