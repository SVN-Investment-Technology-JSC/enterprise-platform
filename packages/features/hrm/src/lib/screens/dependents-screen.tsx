'use client';
import { useCallback, useEffect, useState } from 'react';
import { Table } from 'antd';
import { hrmFetch, hrmEmployeeOptions } from '../hrm-api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';
type Dependent = {
  updated_at: string;
  id: string;
  employee_name: string;
  employee_code: string;
  full_name: string;
  reference_code: string;
  relationship: string;
  birth_date: string;
  tax_code: string | null;
  evidence_reference: string;
  effective_from: string;
  effective_to: string | null;
};
export default function DependentsScreen() {
  const [rows, setRows] = useState<Dependent[]>([]),
    [employees, setEmployees] = useState<{ value: string; label: string }[]>(
      [],
    ),
    [search, setSearch] = useState(''),
    [error, setError] = useState(''),
    [action, setAction] = useState<HrmAction | null>(null);
  const load = useCallback(async () => {
    const [r, e] = await Promise.all([
      hrmFetch<{ data: Dependent[] }>('/dependents'),
      hrmEmployeeOptions(),
    ]);
    setRows(r.data);
    setEmployees(e);
  }, []);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  async function command(path: string, body: unknown, method = 'POST') {
    await hrmFetch(path, { method, body: JSON.stringify(body) });
    await load();
  }
  return (
    <main className="space-y-3">
      <header>
        <h1 className="text-xl font-semibold">Đăng ký người phụ thuộc</h1>
        <p className="text-sm text-slate-500">
          HR xác minh căn cứ và thời gian đăng ký. Số người phụ thuộc tại ngày
          cuối kỳ được đưa vào công thức lương qua REGISTERED_DEPENDENT_COUNT.
        </p>
      </header>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Input
          className="max-w-sm"
          aria-label="Tìm hồ sơ người phụ thuộc"
          placeholder="Mã nhân viên, họ tên, mã hồ sơ…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button
          permission="hrm.dependent.manage"
          onClick={() =>
            setAction({
              title: 'Ghi nhận đăng ký đã xác minh',
              fields: [
                { key: 'employeeId', label: 'Nhân viên', options: employees },
                {
                  key: 'referenceCode',
                  label: 'Mã định danh hồ sơ người phụ thuộc',
                },
                { key: 'fullName', label: 'Họ tên người phụ thuộc' },
                { key: 'relationship', label: 'Quan hệ với nhân viên' },
                { key: 'birthDate', label: 'Ngày sinh', type: 'date' },
                { key: 'taxCode', label: 'Mã số thuế', optional: true },
                {
                  key: 'evidenceReference',
                  label: 'Số hồ sơ / căn cứ HR đã xác minh',
                },
                {
                  key: 'effectiveFrom',
                  label: 'Đăng ký từ ngày',
                  type: 'date',
                },
                {
                  key: 'effectiveTo',
                  label: 'Đăng ký đến ngày',
                  type: 'date',
                  optional: true,
                },
              ],
              submit: (v) => command('/dependents', v),
            })
          }
        >
          Thêm đăng ký
        </Button>
      </div>
      <Table<Dependent>
        rowKey="id"
        dataSource={rows.filter((r) =>
          `${r.employee_code} ${r.employee_name} ${r.full_name} ${r.reference_code}`
            .toLocaleLowerCase('vi')
            .includes(search.toLocaleLowerCase('vi')),
        )}
        pagination={{ pageSize: 25, showSizeChanger: true }}
        scroll={{ x: 1650, y: 'calc(100vh - 300px)' }}
        columns={[
          {
            title: 'Mã NV',
            dataIndex: 'employee_code',
            width: 110,
            fixed: 'left',
          },
          {
            title: 'Nhân viên',
            dataIndex: 'employee_name',
            width: 180,
            fixed: 'left',
          },
          { title: 'Mã hồ sơ', dataIndex: 'reference_code', width: 150 },
          { title: 'Người phụ thuộc', dataIndex: 'full_name', width: 190 },
          { title: 'Quan hệ', dataIndex: 'relationship', width: 130 },
          { title: 'Ngày sinh', dataIndex: 'birth_date', width: 110 },
          { title: 'MST', dataIndex: 'tax_code', width: 150 },
          { title: 'Từ ngày', dataIndex: 'effective_from', width: 110 },
          { title: 'Đến ngày', dataIndex: 'effective_to', width: 110 },
          { title: 'Căn cứ', dataIndex: 'evidence_reference' },
          {
            title: 'Thao tác',
            width: 200,
            fixed: 'right',
            render: (_, r) => (
              <span className="inline-flex gap-1">
                <Button
                  variant="outline"
                  permission="hrm.dependent.manage"
                  onClick={() =>
                    setAction({
                      title: `Điều chỉnh đăng ký · ${r.full_name}`,
                      columns: 2,
                      description:
                        'Điều chỉnh cần căn cứ xác minh; không được tác động kỳ lương đã chốt.',
                      fields: [
                        {
                          key: 'fullName',
                          label: 'Họ tên',
                          value: r.full_name,
                        },
                        {
                          key: 'relationship',
                          label: 'Quan hệ',
                          value: r.relationship,
                        },
                        {
                          key: 'birthDate',
                          label: 'Ngày sinh',
                          type: 'date',
                          value: r.birth_date,
                        },
                        {
                          key: 'taxCode',
                          label: 'Mã số thuế',
                          optional: true,
                          value: r.tax_code || '',
                        },
                        {
                          key: 'effectiveFrom',
                          label: 'Từ ngày',
                          type: 'date',
                          value: r.effective_from,
                        },
                        {
                          key: 'effectiveTo',
                          label: 'Đến ngày',
                          type: 'date',
                          optional: true,
                          value: r.effective_to || '',
                        },
                        {
                          key: 'evidenceReference',
                          label: 'Căn cứ xác minh',
                          value: r.evidence_reference,
                        },
                        { key: 'reason', label: 'Lý do điều chỉnh' },
                      ],
                      submit: (v) =>
                        command(
                          `/dependents/${r.id}`,
                          {
                            ...v,
                            taxCode: v.taxCode || null,
                            effectiveTo: v.effectiveTo || null,
                            expectedUpdatedAt: r.updated_at,
                          },
                          'PATCH',
                        ),
                    })
                  }
                >
                  Sửa
                </Button>
                <Button
                  variant="outline"
                  permission="hrm.dependent.manage"
                  onClick={() =>
                    setAction({
                      title: `Kết thúc đăng ký — ${r.full_name}`,
                      confirmTitle:
                        'Kết thúc đăng ký theo chứng từ đã xác minh?',
                      fields: [
                        {
                          key: 'effectiveTo',
                          label: 'Ngày cuối còn hiệu lực',
                          type: 'date',
                          value: r.effective_to || '',
                        },
                        { key: 'reason', label: 'Lý do' },
                        {
                          key: 'evidenceReference',
                          label: 'Căn cứ xác minh',
                          value: r.evidence_reference,
                        },
                      ],
                      submit: (v) =>
                        command(`/dependents/${r.id}/end`, {
                          ...v,
                          expectedUpdatedAt: r.updated_at,
                        }),
                    })
                  }
                >
                  Kết thúc
                </Button>
              </span>
            ),
          },
        ]}
      />
      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </main>
  );
}
