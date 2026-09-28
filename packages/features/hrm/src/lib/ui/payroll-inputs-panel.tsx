'use client';
import { useEffect, useState } from 'react';
import { Table } from 'antd';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
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
  const [employee, setEmployee] = useState(''),
    [rows, setRows] = useState<InputVersion[]>([]),
    [error, setError] = useState(''),
    [action, setAction] = useState<HrmAction | null>(null);
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
    <section className="space-y-3 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">Tham số lương theo nhân viên</h2>
      <div className="flex gap-3">
        <div className="w-96">
          <SearchableSelect
            value={employee}
            onChange={(v) => setEmployee(v || '')}
            options={employees}
            placeholder="Chọn nhân viên để xem tham số"
          />
        </div>
        <Button
          permission="hrm.payroll.configure"
          disabled={!employee}
          onClick={() => edit()}
        >
          Thêm tham số
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      <Table<InputVersion>
        size="small"
        rowKey="effective_from"
        dataSource={rows}
        pagination={{ pageSize: 8 }}
        columns={[
          { title: 'Hiệu lực từ', dataIndex: 'effective_from' },
          {
            title: 'Tham số',
            render: (_, r) =>
              Object.entries(r.inputs)
                .map(([k, v]) => `${k} = ${v.toLocaleString('vi-VN')}`)
                .join(' · '),
          },
          {
            title: 'Thao tác',
            render: (_, r) => (
              <div className="flex gap-2">
                <Button
                  permission="hrm.payroll.configure"
                  variant="outline"
                  onClick={() => edit(r)}
                >
                  Sửa
                </Button>
                <Button
                  permission="hrm.payroll.configure"
                  variant="outline"
                  onClick={() => edit(r, true)}
                >
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
