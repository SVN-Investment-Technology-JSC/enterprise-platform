'use client';
import { useEffect, useState } from 'react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { Plus, UserCog } from 'lucide-react';
import { hrmFetch } from '../hrm-api';
import { formatDateVn } from '../personnel-decision-rules';
import { Button } from './button';
import { HrmActionDialog, type HrmAction } from './hrm-action-dialog';
import { EmptyPanel, InfoNote, SettingsSection } from './settings-kit';
import { ActionMenu, DataList, type DataColumn } from './payroll-settings/data-rows';

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
      void hrmFetch<{ data: InputVersion[] }>(`/employees/${employee}/payroll-inputs`)
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
      title: remove ? 'Xóa tham số chưa chốt' : row ? 'Sửa tham số lương' : 'Thêm tham số lương',
      confirmTitle: remove ? 'Xóa và yêu cầu tính lại các kỳ liên quan?' : undefined,
      description:
        'Thay đổi chỉ áp dụng từ ngày hiệu lực đến trước phiên bản kế tiếp. Kỳ đã chốt được bảo vệ.',
      fields: [
        ...(!row ? [{ key: 'effectiveFrom', label: 'Hiệu lực từ', type: 'date' as const }] : []),
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
        await hrmFetch(`/employees/${employee}/payroll-inputs${row ? `/${row.effective_from}` : ''}`, {
          method: remove ? 'DELETE' : row ? 'PATCH' : 'POST',
          body: JSON.stringify({
            ...v,
            ...(!remove ? { inputs: parse(v.inputs) } : {}),
            ...(row ? { expectedUpdatedAt: row.updated_at } : {}),
          }),
        });
        const result = await hrmFetch<{ data: InputVersion[] }>(`/employees/${employee}/payroll-inputs`);
        setRows(result.data);
      },
    });
  }

  const columns: DataColumn<InputVersion>[] = [
    {
      key: 'from',
      header: 'Hiệu lực từ',
      width: '130px',
      cardOrder: -1,
      cell: (r) => <span className="text-sm font-semibold text-slate-900">{formatDateVn(r.effective_from)}</span>,
    },
    {
      key: 'inputs',
      header: 'Tham số cấu hình',
      width: 'minmax(0,1fr)',
      cardFull: true,
      cardOrder: 1,
      cell: (r) => (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(r.inputs).map(([k, v]) => (
            <span
              key={k}
              className="inline-flex max-w-full items-center rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700"
            >
              <span className="break-all">{k}:</span>
              <strong className="ml-1 text-slate-900">{v.toLocaleString('vi-VN')}</strong>
            </span>
          ))}
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Thao tác',
      width: '56px',
      cardEnd: true,
      cell: (r) => (
        <ActionMenu
          label={`Thao tác tham số từ ${formatDateVn(r.effective_from)}`}
          items={[
            { key: 'edit', label: 'Sửa', onSelect: () => edit(r) },
            { key: 'remove', label: 'Xóa', tone: 'danger', onSelect: () => edit(r, true) },
          ]}
        />
      ),
    },
  ];

  return (
    <SettingsSection
      icon={UserCog}
      tone="violet"
      title="Tham số lương theo nhân viên"
      description="Chỉ số riêng từng nhân viên (số người phụ thuộc, mức đóng BHXH theo thỏa thuận...)."
      bodyClassName="space-y-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 basis-64">
          <SearchableSelect
            value={employee}
            onChange={(v) => setEmployee(v || '')}
            options={employees}
            placeholder="Chọn nhân viên để xem cấu hình..."
          />
        </div>
        <Button permission="hrm.payroll.configure" disabled={!employee} onClick={() => edit()} className="h-9 gap-1.5 px-3 text-xs font-semibold">
          <Plus className="size-4" />
          <span>Thêm tham số</span>
        </Button>
      </div>

      {error && (
        <InfoNote tone="red" role="alert">
          {error}
        </InfoNote>
      )}

      <DataList
        label="Tham số lương theo nhân viên"
        rows={rows}
        rowKey={(r) => r.effective_from}
        columns={columns}
        pageSize={6}
        empty={
          <EmptyPanel
            icon={UserCog}
            title={employee ? 'Nhân viên chưa có bộ tham số riêng' : 'Chọn nhân viên để xem tham số'}
            description={employee ? 'Bấm Thêm tham số để tạo bộ tham số đầu tiên.' : undefined}
          />
        }
      />

      {action && <HrmActionDialog action={action} onClose={() => setAction(null)} />}
    </SettingsSection>
  );
}
