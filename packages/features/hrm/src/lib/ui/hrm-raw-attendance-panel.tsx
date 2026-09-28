'use client';
import { useEffect, useState } from 'react';
import { Table } from 'antd';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import type { HrmEmployeeProfile } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { Input } from './input';

type RawEvent = {
  id: string;
  employee_code: string;
  full_name: string;
  work_date: string;
  occurred_at: string;
  event_kind: string;
  source: string;
  device_id: string | null;
  evidence: {
    ip?: string;
    siteSnapshot?: { name?: string };
    latitude?: number;
    longitude?: number;
  };
  voided_by_correction_id: string | null;
};
export function HrmRawAttendancePanel({
  employees,
}: {
  employees: HrmEmployeeProfile[];
}) {
  const [month, setMonth] = useState(
    () => new Date().toLocaleDateString('en-CA', {timeZone:'Asia/Ho_Chi_Minh'}).slice(0, 7),
    ),
    [employee, setEmployee] = useState(''),
    [page, setPage] = useState(1);
  const [result, setResult] = useState<{
      data: RawEvent[];
      meta: { total: number };
    }>({ data: [], meta: { total: 0 } }),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    let live = true;
    setLoading(true);
    setError('');
    const [year, m] = month.split('-').map(Number),
      last = new Date(year, m, 0).getDate();
    const query = new URLSearchParams({
      from: `${month}-01`,
      to: `${month}-${last}`,
      page: String(page),
      page_size: '50',
      ...(employee ? { employee_id: employee } : {}),
    });
    void hrmFetch<typeof result>(`/attendance-events?${query}`)
      .then((r) => {
        if (live) setResult(r);
      })
      .catch((e) => {
        if (live) {
          setError(e instanceof Error ? e.message : 'Không tải được sự kiện');
          setResult({ data: [], meta: { total: 0 } });
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [month, employee, page]);
  return (
    <section className="space-y-3 rounded-xl border bg-white p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[180px_350px_1fr]">
        <Input
          type="month"
          aria-label="Tháng chấm công"
          value={month}
          onChange={(e) => {
            setMonth(e.target.value);
            setPage(1);
          }}
        />
        <SearchableSelect
          placeholder="Tất cả nhân viên"
          options={employees.map((e) => ({
            value: e.employeeId,
            label: `${e.employeeCode} · ${e.fullName}`,
          }))}
          value={employee}
          onChange={(v) => {
            setEmployee(v || '');
            setPage(1);
          }}
          clearable
        />
        <p className="text-xs text-slate-500">
          Từng lượt vào/ra và chứng cứ gốc. Lượt đã được điều chỉnh vẫn giữ
          trong lịch sử.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <Table<RawEvent>
        size="small"
        rowKey="id"
        loading={loading}
        dataSource={result.data}
        scroll={{ x: 1350, y: 450 }}
        pagination={{
          current: page,
          pageSize: 50,
          total: result.meta.total,
          showSizeChanger: false,
          onChange: setPage,
          showTotal: (n) => `${n} lượt`,
        }}
        columns={[
          {
            title: 'Mã NV',
            dataIndex: 'employee_code',
            width: 100,
            fixed: 'left',
          },
          { title: 'Nhân viên', dataIndex: 'full_name', width: 210 },
          { title: 'Ngày công', dataIndex: 'work_date', width: 110 },
          {
            title: 'Thời điểm',
            dataIndex: 'occurred_at',
            width: 175,
            render: (v) => new Date(v).toLocaleString('vi-VN'),
          },
          {
            title: 'Lượt',
            dataIndex: 'event_kind',
            width: 65,
            render: (v) => (v === 'IN' ? 'Vào' : 'Ra'),
          },
          { title: 'Nguồn', dataIndex: 'source', width: 140 },
          { title: 'IP', width: 130, render: (_, r) => r.evidence.ip || '—' },
          {
            title: 'Địa điểm / GPS',
            width: 240,
            render: (_, r) =>
              r.evidence.siteSnapshot?.name ||
              (r.evidence.latitude !== undefined
                ? `${r.evidence.latitude}, ${r.evidence.longitude}`
                : '—'),
          },
          {
            title: 'Hiệu lực',
            width: 140,
            render: (_, r) =>
              r.voided_by_correction_id ? 'Đã được điều chỉnh' : 'Đang sử dụng',
          },
        ]}
      />
    </section>
  );
}
