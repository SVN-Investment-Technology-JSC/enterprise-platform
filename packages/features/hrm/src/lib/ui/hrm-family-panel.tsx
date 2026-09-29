'use client';
import { useState } from 'react';
import { Table, type TableColumnsType } from 'antd';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import type { HrmEmployeeDependent } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { Button } from './button';
import { HrmActionDialog, type HrmAction } from './hrm-action-dialog';
import { toast } from './toast';

export function HrmFamilyPanel({
  rows,
  employeeId,
  onChanged,
}: {
  rows: HrmEmployeeDependent[];
  employeeId?: string;
  onChanged: (rows: HrmEmployeeDependent[]) => void;
}) {
  const [action, setAction] = useState<HrmAction | null>(null);
  const path = employeeId
    ? `/employees/${employeeId}/dependents`
    : '/my-dependents';
  const permission = employeeId
    ? 'hrm.employee.manage'
    : 'hrm.self.profile.write';
  const reload = async () =>
    onChanged((await hrmFetch<{ data: HrmEmployeeDependent[] }>(path)).data);
  const edit = (row?: HrmEmployeeDependent) =>
    setAction({
      title: row ? 'Cập nhật người thân' : 'Khai báo người thân',
      columns: 2,
      description:
        'Thông tin tự khai không tự tạo giảm trừ thuế. HR xác minh đăng ký giảm trừ tại màn hình riêng.',
      fields: [
        { key: 'fullName', label: 'Họ và tên', value: row?.fullName },
        {
          key: 'relationship',
          label: 'Quan hệ',
          value: row?.relationship,
          options: ['Vợ/chồng', 'Con', 'Cha', 'Mẹ', 'Anh/chị/em', 'Khác'].map(
            (value) => ({ value, label: value }),
          ),
        },
        {
          key: 'dateOfBirth',
          label: 'Ngày sinh',
          type: 'date',
          optional: true,
          value: row?.dateOfBirth || '',
        },
        {
          key: 'phone',
          label: 'Điện thoại',
          optional: true,
          value: row?.phone || '',
        },
        {
          key: 'identityCardNumber',
          label: 'Số giấy tờ định danh',
          optional: true,
          value: row?.identityCardNumber || '',
        },
        {
          key: 'taxCode',
          label: 'Mã số thuế',
          optional: true,
          value: row?.taxCode || '',
        },
        {
          key: 'note',
          label: 'Ghi chú',
          optional: true,
          value: row?.note || '',
        },
      ],
      submit: async (values) => {
        await hrmFetch(row ? `${path}/${row.id}` : path, {
          method: row ? 'PATCH' : 'POST',
          body: JSON.stringify({
            ...Object.fromEntries(
              Object.entries(values).map(([k, v]) => [k, v.trim() || null]),
            ),
            ...(row ? { expectedUpdatedAt: row.updatedAt } : {}),
          }),
        });
        await reload();
        toast.success('Đã lưu hồ sơ người thân');
      },
    });
  const columns: TableColumnsType<HrmEmployeeDependent> = [
    { title: 'Họ tên', dataIndex: 'fullName', width: 170 },
    { title: 'Quan hệ', dataIndex: 'relationship', width: 120 },
    { title: 'Ngày sinh', dataIndex: 'dateOfBirth', width: 110 },
    { title: 'Điện thoại', dataIndex: 'phone', width: 120 },
    { title: 'Giấy tờ', dataIndex: 'identityCardNumber', width: 140 },
    { title: 'Mã số thuế', dataIndex: 'taxCode', width: 130 },
    {
      title: 'Thao tác',
      width: 145,
      fixed: 'right',
      render: (_, row) => (
        <span className="inline-flex gap-1">
          <Button
            permission={permission}
            variant="outline"
            size="sm"
            onClick={() => edit(row)}
          >
            Sửa
          </Button>
          <Popconfirm
            title="Xóa thông tin người thân?"
            description="Lưu lịch sử hồ sơ; đăng ký giảm trừ đã xác minh được quản lý riêng."
            okText="Xóa"
            onConfirm={async () => {
              try {
                await hrmFetch(`${path}/${row.id}`, {
                  method: 'DELETE',
                  body: JSON.stringify({ expectedUpdatedAt: row.updatedAt }),
                });
                await reload();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Không thể xóa');
              }
            }}
          >
            <Button permission={permission} variant="outline" size="sm">
              Xóa
            </Button>
          </Popconfirm>
        </span>
      ),
    },
  ];
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Người thân và gia đình</h3>
          <p className="text-xs text-slate-500">
            Thông tin tự khai. Giảm trừ chỉ áp dụng sau khi HR xác minh đăng ký.
          </p>
        </div>
        <Button permission={permission} size="sm" onClick={() => edit()}>
          Thêm người thân
        </Button>
      </div>
      <Table
        size="small"
        rowKey="id"
        dataSource={rows}
        columns={columns}
        pagination={false}
        scroll={{ x: 940, y: 260 }}
        locale={{ emptyText: 'Chưa có thông tin người thân' }}
      />
      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </section>
  );
}
