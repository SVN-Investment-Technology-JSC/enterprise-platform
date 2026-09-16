'use client';

import { Building2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import type { NodeType } from './organization-workspace';

export function OrganizationNodeTypeTable({
  nodeTypes,
  onOpenCreate,
  onEdit,
  onDelete,
}: {
  nodeTypes: NodeType[];
  onOpenCreate: () => void;
  onEdit: (type: NodeType) => void;
  onDelete: (type: NodeType) => Promise<void> | void;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'unit' | 'position'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const filteredNodeTypes = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return nodeTypes.filter((item) => {
      const matchesSearch =
        !query ||
        item.name.toLowerCase().includes(query) ||
        item.code.toLowerCase().includes(query) ||
        (item.description && item.description.toLowerCase().includes(query));
      const matchesCategory =
        categoryFilter === 'all' || item.category === categoryFilter;
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && item.isActive) ||
        (statusFilter === 'inactive' && !item.isActive);
      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [nodeTypes, searchTerm, categoryFilter, statusFilter]);

  const unitCount = nodeTypes.filter((t) => t.category === 'unit').length;
  const positionCount = nodeTypes.filter((t) => t.category === 'position').length;

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Table Toolbar */}
      <div className="shrink-0 flex flex-col justify-between gap-3 border-b border-slate-200 bg-white p-3 sm:p-4 md:flex-row md:items-center">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          <div className="relative w-full max-w-xs sm:w-72">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Tìm kiếm loại node theo tên, mã…"
              className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-2">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as typeof categoryFilter)}
              className="h-9 rounded-md border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">Tất cả phân loại</option>
              <option value="unit">Đơn vị (Unit)</option>
              <option value="position">Chức danh (Position)</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="h-9 rounded-md border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="active">Đang hoạt động</option>
              <option value="inactive">Đã tắt</option>
            </select>
          </div>

          {searchTerm || categoryFilter !== 'all' || statusFilter !== 'all' ? (
            <button
              onClick={() => {
                setSearchTerm('');
                setCategoryFilter('all');
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
          Thêm loại node
        </Button>
      </div>

      {/* Internal Scrollable Table Body */}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-left text-sm border-collapse">
          <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100 text-xs font-semibold uppercase text-slate-700 shadow-sm">
            <tr>
              <th className="px-5 py-3">Mã loại</th>
              <th className="px-5 py-3">Tên loại node</th>
              <th className="px-5 py-3 text-center">Phân loại</th>
              <th className="px-5 py-3 text-center">Thứ tự</th>
              <th className="px-5 py-3 text-center">Tính chất</th>
              <th className="px-5 py-3 text-center">Trạng thái</th>
              <th className="px-5 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {filteredNodeTypes.length > 0 ? (
              filteredNodeTypes.map((item) => (
                <tr
                  key={item.id}
                  className="group transition-colors hover:bg-slate-50/80"
                >
                  <td className="whitespace-nowrap px-5 py-3.5 font-mono text-xs font-semibold text-slate-700">
                    {item.code}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="font-semibold text-slate-900">{item.name}</div>
                    {item.description ? (
                      <p className="mt-0.5 line-clamp-1 text-xs text-slate-400">
                        {item.description}
                      </p>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3.5 text-center">
                    <span
                      className={`inline-flex items-center rounded px-2.5 py-0.5 text-xs font-medium border ${item.category === 'unit'
                          ? 'border-blue-200 bg-blue-50 text-blue-700'
                          : 'border-purple-200 bg-purple-50 text-purple-700'
                        }`}
                    >
                      {item.category === 'unit' ? 'Đơn vị' : 'Chức danh'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3.5 text-center text-xs text-slate-500 font-mono">
                    {item.sortOrder ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3.5 text-center">
                    {item.isSystem ? (
                      <span className="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 border border-slate-200">
                        Hệ thống
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 border border-emerald-200">
                        Tuỳ chỉnh
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3.5 text-center">
                    {item.isActive ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 border border-emerald-200">
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                        Hoạt động
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 border border-slate-200">
                        <span className="size-1.5 rounded-full bg-slate-400" />
                        Đã tắt
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 size-8 p-0"
                        onClick={() => onEdit(item)}
                        title="Chỉnh sửa loại node"
                      >
                        <Pencil className="size-3.5 text-slate-600" />
                      </Button>
                      <Popconfirm
                        title="Xoá loại node?"
                        description={`Bạn có chắc chắn muốn xoá loại node "${item.name}"? Dữ liệu lịch sử vẫn được bảo toàn.`}
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
                          title="Xoá loại node"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </Popconfirm>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={7}
                  className="py-12 text-center text-sm text-slate-500"
                >
                  <Building2 className="mx-auto size-8 text-slate-300" />
                  <p className="mt-2 font-medium">Không tìm thấy loại node nào.</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Bấm &quot;Thêm loại node&quot; để tạo định nghĩa mới.
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
          Hiển thị <strong>{filteredNodeTypes.length}</strong> / {nodeTypes.length} loại node
        </span>
        <div className="flex items-center gap-3">
          <span>{unitCount} đơn vị</span>
          <span>•</span>
          <span>{positionCount} chức danh</span>
        </div>
      </div>
    </div>
  );
}
