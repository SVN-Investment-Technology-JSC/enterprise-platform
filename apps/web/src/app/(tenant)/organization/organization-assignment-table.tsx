'use client';

import { Pencil, Plus, Search, Trash2, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import type { Assignment, Node, OrganizationSnapshot } from './organization-workspace';

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(-2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?'
  );
}

export function OrganizationAssignmentTable({
  assignments,
  nodes,
  users,
  onOpenCreate,
  onEdit,
  onDelete,
}: {
  assignments: Assignment[];
  nodes: Node[];
  users: OrganizationSnapshot['users'];
  onOpenCreate: () => void;
  onEdit: (assignment: Assignment) => void;
  onDelete: (assignment: Assignment) => Promise<void> | void;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [primaryFilter, setPrimaryFilter] = useState<'all' | 'primary' | 'secondary'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const filteredAssignments = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return assignments.filter((item) => {
      const user = userMap.get(item.userId);
      const node = nodeMap.get(item.nodeId);
      const userName = user?.fullName?.toLowerCase() ?? '';
      const userEmail = user?.email?.toLowerCase() ?? '';
      const nodeName = node?.name?.toLowerCase() ?? '';
      const nodeCode = node?.code?.toLowerCase() ?? '';
      const note = item.note?.toLowerCase() ?? '';

      const matchesSearch =
        !query ||
        userName.includes(query) ||
        userEmail.includes(query) ||
        nodeName.includes(query) ||
        nodeCode.includes(query) ||
        note.includes(query);

      const matchesPrimary =
        primaryFilter === 'all' ||
        (primaryFilter === 'primary' && item.isPrimary) ||
        (primaryFilter === 'secondary' && !item.isPrimary);

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && item.status === 'active') ||
        (statusFilter === 'inactive' && item.status !== 'active');

      return matchesSearch && matchesPrimary && matchesStatus;
    });
  }, [assignments, nodeMap, userMap, searchTerm, primaryFilter, statusFilter]);

  const primaryCount = assignments.filter((a) => a.isPrimary).length;
  const secondaryCount = assignments.filter((a) => !a.isPrimary).length;

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Table Toolbar */}
      <div className="shrink-0 flex flex-col justify-between gap-3 border-b border-slate-200 bg-white p-3 sm:p-4 md:flex-row md:items-center">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          <div className="relative w-full max-w-xs sm:w-80">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Tìm nhân sự, vị trí bổ nhiệm…"
              className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-2">
            <select
              value={primaryFilter}
              onChange={(e) => setPrimaryFilter(e.target.value as typeof primaryFilter)}
              className="h-9 rounded-md border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">Tất cả vai trò</option>
              <option value="primary">Bổ nhiệm chính</option>
              <option value="secondary">Kiêm nhiệm</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="h-9 rounded-md border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="active">Đang hoạt động</option>
              <option value="inactive">Đã kết thúc / Khác</option>
            </select>
          </div>

          {searchTerm || primaryFilter !== 'all' || statusFilter !== 'all' ? (
            <button
              onClick={() => {
                setSearchTerm('');
                setPrimaryFilter('all');
                setStatusFilter('all');
              }}
              className="text-xs text-slate-500 hover:text-slate-700 hover:underline"
            >
              Xoá bộ lọc
            </button>
          ) : null}
        </div>

        <Button
          onClick={onOpenCreate}
          size="default"
          className="bg-blue-600 hover:bg-blue-700 text-white shrink-0 gap-1.5"
        >
          <Plus className="size-4" />
          Bổ nhiệm người dùng
        </Button>
      </div>

      {/* Internal Scrollable Table Body */}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-left text-sm border-collapse">
          <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100 text-xs font-semibold uppercase text-slate-700 shadow-sm">
            <tr>
              <th className="px-5 py-3">Nhân sự</th>
              <th className="px-5 py-3">Vị trí / Chức danh</th>
              <th className="px-5 py-3 text-center">Vai trò</th>
              <th className="px-5 py-3 text-center">Thời hạn bổ nhiệm</th>
              <th className="px-5 py-3 text-center">Trạng thái</th>
              <th className="px-5 py-3">Ghi chú</th>
              <th className="px-5 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {filteredAssignments.length > 0 ? (
              filteredAssignments.map((item) => {
                const user = userMap.get(item.userId);
                const node = nodeMap.get(item.nodeId);
                const userName = user?.fullName || 'Người dùng không xác định';
                const userEmail = user?.email;
                const nodeName = node?.name || 'Vị trí không xác định';
                const nodeCode = node?.code;

                return (
                  <tr
                    key={item.id}
                    className="group transition-colors hover:bg-slate-50/80"
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
                          {initials(userName)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-900">
                            {userName}
                          </p>
                          {userEmail ? (
                            <p className="truncate text-xs text-slate-400">
                              {userEmail}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </td>

                    <td className="px-5 py-3.5">
                      <div className="font-semibold text-slate-900">{nodeName}</div>
                      {nodeCode ? (
                        <span className="font-mono text-xs text-slate-400">
                          {nodeCode}
                        </span>
                      ) : null}
                    </td>

                    <td className="whitespace-nowrap px-5 py-3.5 text-center">
                      <span
                        className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium border ${item.isPrimary
                            ? 'border-blue-200 bg-blue-50 text-blue-700'
                            : 'border-amber-200 bg-amber-50 text-amber-700'
                          }`}
                      >
                        {item.isPrimary ? 'Bổ nhiệm chính' : 'Kiêm nhiệm'}
                      </span>
                    </td>

                    <td className="whitespace-nowrap px-5 py-3.5 text-center text-xs text-slate-600">
                      {item.startDate ? (
                        <span>
                          {item.startDate}
                          {item.endDate ? ` → ${item.endDate}` : ' (Hiện tại)'}
                        </span>
                      ) : (
                        <span className="text-slate-400">Không thời hạn</span>
                      )}
                    </td>

                    <td className="whitespace-nowrap px-5 py-3.5 text-center">
                      {item.status === 'active' ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 border border-emerald-200">
                          <span className="size-1.5 rounded-full bg-emerald-500" />
                          Hoạt động
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 border border-slate-200">
                          <span className="size-1.5 rounded-full bg-slate-400" />
                          {item.status}
                        </span>
                      )}
                    </td>

                    <td className="max-w-[180px] truncate px-5 py-3.5 text-xs text-slate-500">
                      {item.note || '—'}
                    </td>

                    <td className="whitespace-nowrap px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 size-8 p-0"
                          onClick={() => onEdit(item)}
                          title="Chỉnh sửa bổ nhiệm"
                        >
                          <Pencil className="size-3.5 text-slate-600" />
                        </Button>
                        <Popconfirm
                          title="Xoá bổ nhiệm?"
                          description={`Xoá bổ nhiệm của "${userName}" tại "${nodeName}"?`}
                          okText="Xoá"
                          cancelText="Huỷ"
                          okType="danger"
                          placement="left"
                          onConfirm={() => onDelete(item)}
                        >
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 size-8 p-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                            title="Xoá bổ nhiệm"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </Popconfirm>
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  colSpan={7}
                  className="py-12 text-center text-sm text-slate-500"
                >
                  <UserPlus className="mx-auto size-8 text-slate-300" />
                  <p className="mt-2 font-medium">Không tìm thấy bản ghi bổ nhiệm nào.</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Bấm &quot;Bổ nhiệm người dùng&quot; để tạo phân công nhân sự mới.
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Table Footer */}
      <div className="shrink-0 flex items-center justify-between border-t border-slate-200 bg-slate-50/70 px-4 py-2.5 text-xs text-slate-500">
        <span>
          Hiển thị <strong>{filteredAssignments.length}</strong> / {assignments.length} bổ nhiệm
        </span>
        <div className="flex items-center gap-3">
          <span>{primaryCount} chính</span>
          <span>•</span>
          <span>{secondaryCount} kiêm nhiệm</span>
        </div>
      </div>
    </div>
  );
}
