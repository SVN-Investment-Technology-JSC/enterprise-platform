'use client';
import { useState } from 'react';
import { Table } from 'antd';
import { Shield, Search, ExternalLink, CheckCircle2, Lock } from 'lucide-react';
import { HRM_PERMISSION_ACTIONS } from '@enterprise-platform/contracts-identity';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { useHrmPermissions } from '../hrm-permissions';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';

export default function HrmPermissionsScreen() {
  const { can } = useHrmPermissions();
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('');

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
    <div className="space-y-6 max-w-[1600px] mx-auto">
      {/* 1. Page Header Card */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Shield className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Danh mục Quyền hạn HRM
            </h1>
            <p className="text-xs text-slate-500 max-w-[85ch]">
              Quản trị tenant ghép hành động thành bộ quyền, gán bộ quyền vào vai trò và cấp module HRM cho vai trò người dùng.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-xs"
            href="/authorization"
          >
            <span>Mở phân quyền ERP</span>
            <ExternalLink className="size-3.5 text-slate-500" />
          </a>
        </div>
      </div>

      {/* 2. Filter Bar */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
          <Input
            aria-label="Tìm quyền"
            placeholder="Tìm theo mã hoặc tên hành động..."
            className="pl-9 text-xs h-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
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
      </div>

      {/* 3. Permissions Table Card */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-xs p-5 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Danh sách hành động bảo mật ({rows.length})
          </span>
        </div>
        <Table
          size="small"
          rowKey="key"
          dataSource={rows}
          pagination={{
            pageSize: 25,
            showSizeChanger: true,
            showTotal: (total, range) => `Hiển thị ${range[0]}–${range[1]} / ${total} hành động`,
          }}
          scroll={{ x: 900, y: 560 }}
          columns={[
            {
              title: 'Nhóm chức năng',
              dataIndex: 'group',
              width: 200,
              render: (v) => <span className="font-semibold text-slate-900">{v}</span>,
            },
            {
              title: 'Mã hành động bảo mật',
              dataIndex: 'key',
              width: 300,
              render: (v) => (
                <code className="text-xs font-mono bg-slate-100 px-2 py-0.5 rounded text-blue-700 border border-slate-200">
                  {v}
                </code>
              ),
            },
            {
              title: 'Đầu ra & Hành động được phép',
              dataIndex: 'label',
              render: (v) => <span className="text-xs text-slate-700">{v}</span>,
            },
            {
              title: 'Tài khoản của bạn',
              width: 170,
              render: (_, r) =>
                can(r.key) ? (
                  <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs flex items-center gap-1">
                    <CheckCircle2 className="size-3 text-emerald-600" />
                    <span>Đã cấp quyền</span>
                  </Badge>
                ) : (
                  <Badge className="bg-slate-100 text-slate-500 border-slate-200 text-xs flex items-center gap-1">
                    <Lock className="size-3 text-slate-400" />
                    <span>Chưa cấp</span>
                  </Badge>
                ),
            },
          ]}
        />
      </section>
    </div>
  );
}
