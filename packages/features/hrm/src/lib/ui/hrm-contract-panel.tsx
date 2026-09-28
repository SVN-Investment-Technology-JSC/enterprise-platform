'use client';
import { useState } from 'react';
import { Table } from 'antd';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import type { HrmEmploymentContract } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { Button } from './button';
import {
  HrmActionDialog,
  type HrmAction,
  type ActionField,
} from './hrm-action-dialog';
import { toast } from './toast';
const statuses: Record<string, string> = {
  DRAFT: 'Nháp',
  ACTIVE: 'Đã ban hành',
  EXPIRED: 'Hết hạn',
  TERMINATED: 'Đã ghi nhận chấm dứt',
};
function fields(row?: HrmEmploymentContract): ActionField[] {
  return [
    {
      key: 'contractCode',
      label: 'Số hợp đồng / phụ lục',
      value: row?.contractCode,
    },
    {
      key: 'contractType',
      label: 'Loại',
      value: row?.contractType || 'DEFINITE',
      options: [
        { value: 'PROBATION', label: 'Thử việc' },
        { value: 'DEFINITE', label: 'Xác định thời hạn' },
        { value: 'INDEFINITE', label: 'Không xác định thời hạn' },
        { value: 'AMENDMENT', label: 'Phụ lục / gia hạn' },
      ],
    },
    {
      key: 'effectiveFrom',
      label: 'Hiệu lực từ',
      type: 'date',
      value: row?.effectiveFrom,
    },
    {
      key: 'effectiveTo',
      label: 'Hiệu lực đến',
      type: 'date',
      optional: true,
      value: row?.effectiveTo || '',
    },
    {
      key: 'signDate',
      label: 'Ngày ký',
      type: 'date',
      optional: true,
      value: row?.signDate || '',
    },
    {
      key: 'baseSalary',
      label: 'Mức lương thỏa thuận',
      type: 'number',
      min: 0,
      optional: true,
      value: row?.baseSalary ?? '',
    },
    {
      key: 'fileUrl',
      label: 'Đường dẫn chứng từ',
      optional: true,
      value: row?.fileUrl || '',
    },
    { key: 'note', label: 'Ghi chú', optional: true, value: row?.note || '' },
  ];
}
function payload(v: Record<string, string>) {
  return {
    ...Object.fromEntries(
      Object.entries(v).map(([k, value]) => [k, value.trim() || null]),
    ),
    baseSalary: v.baseSalary ? Number(v.baseSalary) : null,
  };
}
export function HrmContractPanel({
  employeeId,
  rows,
  onChanged,
  readOnly = false,
}: {
  employeeId: string;
  rows: HrmEmploymentContract[];
  onChanged: (rows: HrmEmploymentContract[]) => void;
  readOnly?: boolean;
}) {
  const [action, setAction] = useState<HrmAction | null>(null);
  const refresh = async () =>
    onChanged(
      (
        await hrmFetch<{ data: HrmEmploymentContract[] }>(
          `/employees/${employeeId}/contracts`,
        )
      ).data,
    );
  const command = async (path: string, method: string, body: unknown) => {
    await hrmFetch(path, { method, body: JSON.stringify(body) });
    await refresh();
  };
  const draft = (row?: HrmEmploymentContract) =>
    setAction({
      title: row ? 'Cập nhật hợp đồng nháp' : 'Tạo hợp đồng nháp',
      columns: 2,
      fields: fields(row),
      submit: (v) =>
        command(
          row ? `/contracts/${row.id}` : `/employees/${employeeId}/contracts`,
          row ? 'PATCH' : 'POST',
          {
            ...payload(v),
            ...(row ? { expectedUpdatedAt: row.updatedAt } : {}),
          },
        ),
    });
  const amend = (row: HrmEmploymentContract) =>
    setAction({
      title: `Phụ lục / gia hạn · ${row.contractCode}`,
      columns: 2,
      fields: [
        ...fields({
          ...row,
          contractCode: '',
          contractType: 'AMENDMENT',
          signDate: null,
          fileUrl: null,
        }),
        { key: 'reason', label: 'Lý do thay đổi' },
      ],
      submit: (v) =>
        command(`/contracts/${row.id}/amendments`, 'POST', {
          ...payload(v),
          expectedUpdatedAt: row.updatedAt,
        }),
    });
  const terminate = (row: HrmEmploymentContract) =>
    setAction({
      title: `Ghi nhận chấm dứt · ${row.contractCode}`,
      confirmTitle: 'Ghi nhận chấm dứt theo chứng từ đã xác minh?',
      fields: [
        { key: 'effectiveDate', label: 'Ngày chấm dứt', type: 'date' },
        { key: 'reason', label: 'Lý do' },
        { key: 'evidenceReference', label: 'Số / đường dẫn chứng từ' },
      ],
      submit: (v) =>
        command(`/contracts/${row.id}/terminate`, 'POST', {
          ...v,
          expectedUpdatedAt: row.updatedAt,
        }),
    });
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Hợp đồng và phụ lục</h3>
          <p className="text-xs text-slate-500">
            Lưu hồ sơ ký kết và lịch sử hiệu lực. Cấu hình chi trả lương được
            quản lý riêng.
          </p>
        </div>
        {!readOnly && (
          <Button
            permission="hrm.employee.manage"
            size="sm"
            onClick={() => draft()}
          >
            Tạo hợp đồng nháp
          </Button>
        )}
      </div>
      <Table<HrmEmploymentContract>
        size="small"
        rowKey="id"
        dataSource={rows}
        pagination={false}
        scroll={{ x: 1150, y: 300 }}
        locale={{ emptyText: 'Chưa có hợp đồng' }}
        columns={[
          {
            title: 'Số hợp đồng',
            dataIndex: 'contractCode',
            width: 160,
            fixed: 'left',
          },
          { title: 'Loại', dataIndex: 'contractType', width: 120 },
          { title: 'Từ ngày', dataIndex: 'effectiveFrom', width: 110 },
          { title: 'Đến ngày', dataIndex: 'effectiveTo', width: 110 },
          {
            title: 'Trạng thái',
            width: 150,
            render: (_, r) => statuses[r.status],
          },
          { title: 'Ngày chấm dứt', dataIndex: 'terminatedOn', width: 120 },
          {
            title: 'Chứng từ',
            width: 120,
            render: (_, r) =>
              r.fileUrl && /^(\/[^/]|https?:\/\/)/.test(r.fileUrl) ? (
                <a
                  href={r.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-700 underline"
                >
                  Xem chứng từ
                </a>
              ) : (
                'Chưa đính kèm'
              ),
          },
          {
            title: 'Hợp đồng gốc',
            width: 140,
            render: (_, r) =>
              rows.find((x) => x.id === r.parentContractId)?.contractCode ||
              '—',
          },
          ...(!readOnly
            ? [
                {
                  title: 'Thao tác',
                  width: 240,
                  fixed: 'right' as const,
                  render: (_: unknown, r: HrmEmploymentContract) => (
                    <div className="flex flex-wrap gap-1">
                      {r.status === 'DRAFT' && (
                        <>
                          <Button
                            permission="hrm.employee.manage"
                            size="sm"
                            variant="outline"
                            onClick={() => draft(r)}
                          >
                            Sửa
                          </Button>
                          <Popconfirm
                            title="Ban hành hồ sơ theo chứng từ đã ký?"
                            okText="Ban hành"
                            onConfirm={async () => {
                              try {
                                await command(
                                  `/contracts/${r.id}/activate`,
                                  'POST',
                                  { expectedUpdatedAt: r.updatedAt },
                                );
                              } catch (e) {
                                toast.error(
                                  e instanceof Error
                                    ? e.message
                                    : 'Không thể ban hành',
                                );
                              }
                            }}
                          >
                            <Button
                              permission="hrm.employee.manage"
                              size="sm"
                              variant="outline"
                            >
                              Ban hành
                            </Button>
                          </Popconfirm>
                          <Popconfirm
                            title="Xóa hợp đồng nháp?"
                            okText="Xóa"
                            onConfirm={async () => {
                              try {
                                await command(`/contracts/${r.id}`, 'DELETE', {
                                  expectedUpdatedAt: r.updatedAt,
                                });
                              } catch (e) {
                                toast.error(
                                  e instanceof Error
                                    ? e.message
                                    : 'Không thể xóa',
                                );
                              }
                            }}
                          >
                            <Button
                              permission="hrm.employee.manage"
                              size="sm"
                              variant="outline"
                            >
                              Xóa
                            </Button>
                          </Popconfirm>
                        </>
                      )}
                      {r.status === 'ACTIVE' && (
                        <>
                          {!r.parentContractId && (
                            <Button
                              permission="hrm.employee.manage"
                              size="sm"
                              variant="outline"
                              onClick={() => amend(r)}
                            >
                              Phụ lục / gia hạn
                            </Button>
                          )}
                          <Button
                            permission="hrm.employee.manage"
                            size="sm"
                            variant="outline"
                            onClick={() => terminate(r)}
                          >
                            Chấm dứt
                          </Button>
                        </>
                      )}
                    </div>
                  ),
                },
              ]
            : []),
        ]}
      />
      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </section>
  );
}
