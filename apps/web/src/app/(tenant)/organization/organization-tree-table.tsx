'use client';

import {
  Eye,
  GitBranch,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popconfirm } from '@enterprise-platform/shared-ui';

export type Tree = {
  id: string;
  code: string;
  name: string;
  description?: string;
  isPrimary: boolean;
  status: string;
};

export type Node = {
  id: string;
  treeId: string;
  parentId?: string;
  category?: 'unit' | 'position';
  nodeTypeId?: string;
  code: string;
  name: string;
  description?: string;
  sortOrder?: number;
  status: string;
};

export function OrganizationTreeTable({
  trees,
  nodes,
  onOpenTree,
  onEditTree,
  onDeleteTree,
  onCreateTree,
}: {
  trees: Tree[];
  nodes: Node[];
  onOpenTree: (treeId: string) => void;
  onEditTree: (tree: Tree) => void;
  onDeleteTree: (tree: Tree) => void;
  onCreateTree: () => void;
}) {
  const [searchTerm, setSearchTerm] = useState('');

  const nodeCountByTree = useMemo(() => {
    const map = new Map<string, number>();
    for (const node of nodes) {
      map.set(node.treeId, (map.get(node.treeId) ?? 0) + 1);
    }
    return map;
  }, [nodes]);

  const filteredTrees = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return trees;
    return trees.filter(
      (t) =>
        t.name.toLowerCase().includes(query) ||
        t.code.toLowerCase().includes(query) ||
        (t.description && t.description.toLowerCase().includes(query)),
    );
  }, [trees, searchTerm]);

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Table Toolbar / Header Controls */}
      <div className="shrink-0 flex flex-col justify-between gap-3 border-b border-slate-200 bg-white p-3 sm:p-4 sm:flex-row sm:items-center">
        <div className="flex flex-1 items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Tìm kiếm sơ đồ theo tên, mã…"
              className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          {searchTerm ? (
            <button
              onClick={() => setSearchTerm('')}
              className="text-xs text-slate-500 hover:text-slate-700 hover:underline"
            >
              Xoá tìm kiếm
            </button>
          ) : null}
        </div>
        <Button
          onClick={onCreateTree}
          size="default"
          className="bg-blue-600 hover:bg-blue-700 shrink-0 gap-1.5"
        >
          <Plus className="size-4" />
          Thêm sơ đồ mới
        </Button>
      </div>

      {/* Data Table */}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-left text-sm border-collapse">
          <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100 text-xs font-semibold uppercase text-slate-700 shadow-sm">
            <tr>
              <th className="px-5 py-3">Mã sơ đồ</th>
              <th className="px-5 py-3">Tên sơ đồ</th>
              <th className="px-5 py-3">Mô tả</th>
              <th className="px-5 py-3 text-center">Loại sơ đồ</th>
              <th className="px-5 py-3 text-center">Số node</th>
              <th className="px-5 py-3 text-center">Trạng thái</th>
              <th className="px-5 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {filteredTrees.length > 0 ? (
              filteredTrees.map((item) => {
                const nodeCount = nodeCountByTree.get(item.id) ?? 0;
                return (
                  <tr
                    key={item.id}
                    className="group transition-colors hover:bg-slate-50/80"
                  >
                    <td className="whitespace-nowrap px-5 py-4 font-mono text-xs font-semibold text-slate-700">
                      {item.code}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900">
                          {item.name}
                        </span>
                        {item.isPrimary ? (
                          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 border border-blue-200">
                            CHÍNH
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="max-w-xs truncate px-5 py-4 text-xs text-slate-500">
                      {item.description || '—'}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-center">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${item.isPrimary
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-slate-100 text-slate-600'
                          }`}
                      >
                        {item.isPrimary ? 'Sơ đồ chính' : 'Sơ đồ phụ'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-center font-semibold text-slate-900">
                      {nodeCount}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-center">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 border border-emerald-200">
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                        Hoạt động
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="default"
                          className="h-8 gap-1 bg-blue-600 px-3 text-xs hover:bg-blue-700"
                          onClick={() => onOpenTree(item.id)}
                          title="Vào xem và chỉnh sửa chi tiết cây sơ đồ"
                        >
                          <Eye className="size-3.5" />
                          <span>Xem chi tiết</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 size-8 p-0"
                          onClick={() => onEditTree(item)}
                          title="Chỉnh sửa thông tin sơ đồ"
                        >
                          <Pencil className="size-3.5 text-slate-600" />
                        </Button>
                        <Popconfirm
                          title="Xoá sơ đồ tổ chức?"
                          description={`Bạn có chắc chắn muốn xoá sơ đồ "${item.name}"?`}
                          okText="Xoá"
                          cancelText="Huỷ"
                          okType="danger"
                          placement="left"
                          onConfirm={() => onDeleteTree(item)}
                        >
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 size-8 p-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                            title="Xoá sơ đồ"
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
                  <GitBranch className="mx-auto size-8 text-slate-300" />
                  <p className="mt-2 font-medium">Không tìm thấy sơ đồ tổ chức nào.</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Bấm &quot;Thêm sơ đồ mới&quot; để tạo sơ đồ đầu tiên.
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer info */}
      <div className="shrink-0 flex items-center justify-between border-t border-slate-200 bg-slate-50/70 px-4 py-2.5 text-xs text-slate-500">
        <span>
          Hiển thị <b>{filteredTrees.length}</b> / <b>{trees.length}</b> sơ đồ tổ chức
        </span>
        <span className="text-slate-400">
          Nhấp vào &quot;Xem chi tiết&quot; để mở không gian làm việc sơ đồ 3 cột
        </span>
      </div>
    </div>
  );
}
