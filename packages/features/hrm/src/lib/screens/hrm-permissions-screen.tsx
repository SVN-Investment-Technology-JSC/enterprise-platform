'use client';
import { useState } from 'react';
import { Table, Tag } from 'antd';
import { HRM_PERMISSION_ACTIONS } from '@enterprise-platform/contracts-identity';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { useHrmPermissions } from '../hrm-permissions';
import { Input } from '../ui/input';

export default function HrmPermissionsScreen() {
  const { can } = useHrmPermissions();
  const [search, setSearch] = useState(''),
    [group, setGroup] = useState('');
  const normalize = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .toLowerCase();
  const rows = HRM_PERMISSION_ACTIONS.filter(
    (a) =>
      (!group || a.group === group) &&
      normalize(a.key + ' ' + a.label).includes(normalize(search)),
  );
  return (
    <main className="space-y-3">
      <header>
        <h1 className="text-lg font-semibold">Danh mục quyền HRM</h1>
        <p className="text-xs text-slate-500">
          Quản trị tenant ghép hành động thành bộ quyền, gán bộ quyền vào vai
          trò, cấp module HRM cho vai trò rồi gán người dùng.
        </p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Tìm quyền"
          placeholder="Tìm mã hoặc tên quyền..."
          className="max-w-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="w-64">
          <SearchableSelect
            value={group}
            onChange={(v) => setGroup(v || '')}
            placeholder="Tất cả nhóm quyền"
            clearable
            options={[
              ...new Set(HRM_PERMISSION_ACTIONS.map((a) => a.group)),
            ].map((value) => ({ value, label: value }))}
          />
        </div>
        <a
          className="rounded border bg-white px-3 py-1.5 text-blue-700"
          href="/authorization"
        >
          Mở phân quyền ERP
        </a>
      </div>
      <Table
        rowKey="key"
        dataSource={rows}
        pagination={{
          pageSize: 30,
          showSizeChanger: true,
          showTotal: (t) => `${t} hành động`,
        }}
        scroll={{ x: 900, y: 'calc(100dvh - 290px)' }}
        columns={[
          {
            title: 'Nhóm',
            dataIndex: 'group',
            width: 190,
            filters: [
              ...new Set(HRM_PERMISSION_ACTIONS.map((a) => a.group)),
            ].map((value) => ({ text: value, value })),
            onFilter: (value, r) => r.group === value,
          },
          {
            title: 'Mã hành động',
            dataIndex: 'key',
            width: 270,
            render: (v) => <code>{v}</code>,
          },
          { title: 'Đầu ra được phép', dataIndex: 'label' },
          {
            title: 'Tài khoản hiện tại',
            width: 150,
            render: (_, r) => (
              <Tag color={can(r.key) ? 'green' : 'default'}>
                {can(r.key) ? 'Được cấp' : 'Chưa cấp'}
              </Tag>
            ),
          },
        ]}
      />
    </main>
  );
}
