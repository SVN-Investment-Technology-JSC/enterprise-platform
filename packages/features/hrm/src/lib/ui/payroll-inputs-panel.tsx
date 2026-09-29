'use client';
import { useEffect, useState } from 'react';
import { Table } from 'antd';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { Plus, Pencil, Trash2, UserCheck, AlertTriangle } from 'lucide-react';
import { hrmFetch } from '../hrm-api';
import { Button } from './button';
import { HrmActionDialog, type HrmAction } from './hrm-action-dialog';

type InputVersion = {
  effective_from: string;
  inputs: Record<string, number>;
  updated_at: string;
};

export function PayrollInputsPanel({
  employees,
  parse,
}: {
  employees: { value: string; label: string }[];
  parse: (text: string) => Record<string, number>;
}) {
  const [employee, setEmployee] = useState('');
  const [rows, setRows] = useState<InputVersion[]>([]);
  const [error, setError] = useState('');
  const [action, setAction] = useState<HrmAction | null>(null);

  useEffect(() => {
    let current = true;
    setRows([]);
    setError('');
    if (employee)
      void hrmFetch<{ data: InputVersion[] }>(
        `/employees/${employee}/payroll-inputs`,
      )
        .then((r) => {
          if (current) setRows(r.data);
        })
        .catch((e) => {
          if (current) setError(e.message);
        });
    return () => {
      current = false;
    };
  }, [employee]);

  function edit(row?: InputVersion, remove = false) {
    setAction({
      title: remove
        ? 'Xóa tham số chưa chốt'
        : row
          ? 'Sửa tham số lương'
          : 'Thêm tham số lương',
      confirmTitle: remove
        ? 'Xóa và yêu cầu tính lại các kỳ liên quan?'
        : undefined,
      description:
        'Thay đổi chỉ áp dụng từ ngày hiệu lực đến trước phiên bản kế tiếp. Kỳ đã chốt được bảo vệ.',
      fields: [
        ...(!row
          ? [
              {
                key: 'effectiveFrom',
                label: 'Hiệu lực từ',
                type: 'date' as const,
              },
            ]
          : []),
        ...(!remove
          ? [
              {
                key: 'inputs',
                label: 'Tham số (MA=giá trị; MA_KHAC=giá trị)',
                value: Object.entries(row?.inputs || {})
                  .map(([k, v]) => `${k}=${v}`)
                  .join('; '),
              },
            ]
          : []),
        ...(row ? [{ key: 'reason', label: 'Lý do' }] : []),
      ],
      submit: async (v) => {
        await hrmFetch(
          `/employees/${employee}/payroll-inputs${row ? `/${row.effective_from}` : ''}`,
          {
            method: remove ? 'DELETE' : row ? 'PATCH' : 'POST',
            body: JSON.stringify({
              ...v,
              ...(!remove ? { inputs: parse(v.inputs) } : {}),
              ...(row ? { expectedUpdatedAt: row.updated_at } : {}),
            }),
          },
        );
        const result = await hrmFetch<{ data: InputVersion[] }>(
          `/employees/${employee}/payroll-inputs`,
        );
        setRows(result.data);
      },
    });
  }

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="size-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <UserCheck className="size-4" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Tham số lương theo nhân viên
            </h2>
            <p className="text-xs text-slate-500">
              Cấu hình các chỉ số riêng (số người phụ thuộc, mức đóng BHXH theo thỏa thuận)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-72">
            <SearchableSelect
              value={employee}
              onChange={(v) => setEmployee(v || '')}
              options={employees}
              placeholder="Chọn nhân viên để xem cấu hình..."
            />
          </div>
          <Button
            permission="hrm.payroll.configure"
            disabled={!employee}
            onClick={() => edit()}
            className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-9 flex items-center gap-1.5 shadow-xs"
          >
            <Plus className="size-3.5" />
            <span>Thêm tham số</span>
          </Button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700 flex items-center gap-2"
        >
          <AlertTriangle className="size-4 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      <Table<InputVersion>
        size="small"
        rowKey="effective_from"
        dataSource={rows}
        pagination={{
          pageSize: 6,
          showTotal: (total) => `Tổng ${total} phiên bản tham số`,
        }}
        columns={[
          {
            title: 'Hiệu lực từ',
            dataIndex: 'effective_from',
            width: 140,
            render: (v) => <span className="font-semibold text-slate-900">{v}</span>,
          },
          {
            title: 'Tham số cấu hình',
            render: (_, r) => (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(r.inputs).map(([k, v]) => (
                  <span
                    key={k}
                    className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-700 border border-slate-200"
                  >
                    {k}: <strong className="ml-1 text-slate-900">{v.toLocaleString('vi-VN')}</strong>
                  </span>
                ))}
              </div>
            ),
          },
          {
            title: 'Thao tác',
            width: 130,
            render: (_, r) => (
              <div className="flex gap-1.5">
                <Button
                  permission="hrm.payroll.configure"
                  variant="outline"
                  onClick={() => edit(r)}
                  className="h-7 text-xs px-2"
                >
                  <Pencil className="size-3 mr-1" />
                  Sửa
                </Button>
                <Button
                  permission="hrm.payroll.configure"
                  variant="outline"
                  onClick={() => edit(r, true)}
                  className="h-7 text-xs px-2 text-rose-600 hover:bg-rose-50 border-rose-200"
                >
                  <Trash2 className="size-3 mr-1" />
                  Xóa
                </Button>
              </div>
            ),
          },
        ]}
      />

      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </section>
  );
}
