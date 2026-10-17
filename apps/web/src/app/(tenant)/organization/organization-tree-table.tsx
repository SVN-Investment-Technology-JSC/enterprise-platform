'use client';
import { useOrganizationPermissions } from './organization-permissions';

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
import { CollapsibleGroup } from '../collapsible-group';

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
  const { canCreate, canUpdate, canDelete } = useOrganizationPermissions();
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

  const groups = [
    {
      id: 'primary',
      title: 'Sơ đồ chính',
      tone: 'bg-[#fff6d6] text-[#8a6400]',
      rows: filteredTrees.filter((t) => t.isPrimary),
    },
    {
      id: 'secondary',
      title: 'Sơ đồ phụ',
      tone: 'bg-slate-100 text-slate-700',
      rows: filteredTrees.filter((t) => !t.isPrimary),
    },
  ].filter((group) => group.rows.length > 0);

  return (
    <div className="flex flex-col gap-3.5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex h-[38px] min-w-[220px] flex-[0_1_380px] items-center gap-2 rounded-lg border border-[#eef0f3] bg-white px-3 text-slate-500 focus-within:border-[#ffc90a]">
          <Search className="size-4 shrink-0" aria-hidden />
          <input
            type="search"
            aria-label="Tìm sơ đồ"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Tìm kiếm sơ đồ theo tên, mã…"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-[#18181b] outline-none placeholder:text-slate-400"
          />
        </label>
        {searchTerm ? (
          <button
            type="button"
            onClick={() => setSearchTerm('')}
            className="cursor-pointer text-xs text-slate-500 hover:text-slate-700 hover:underline"
          >
            Xoá tìm kiếm
          </button>
        ) : null}
        <span className="flex-1" />
        <Button
          disabled={!canCreate}
          onClick={onCreateTree}
          className="h-[38px] shrink-0 gap-1.5 bg-[#ffc90a] text-[14px] font-bold text-[#18181b] hover:bg-[#ffd84d]"
        >
          <Plus className="size-4" />
          Thêm sơ đồ mới
        </Button>
      </div>

      {groups.map((group) => (
        <CollapsibleGroup
          count={group.rows.length}
          icon={<GitBranch className="size-4" />}
          key={group.id}
          title={group.title}
          tone={group.tone}
        >
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <div className={`${ROW} py-2 text-[12px] font-semibold tracking-[0.4px] text-slate-500`}>
                <span>TÊN SƠ ĐỒ</span>
                <span>MÃ SƠ ĐỒ</span>
                <span>SỐ NODE</span>
                <span>TRẠNG THÁI</span>
                <span className="text-right">THAO TÁC</span>
              </div>
              {group.rows.map((item) => (
                <div className={`${ROW} py-3 hover:bg-[#f4f6f9]/60`} key={item.id}>
                  <div className="flex min-w-0 flex-col">
                    <span className="flex min-w-0 items-center gap-2 font-semibold">
                      <span className="truncate">{item.name}</span>
                      {item.isPrimary ? (
                        <span className="rounded-[5px] bg-[#fff6d6] px-1.5 text-[12px] font-extrabold tracking-[0.4px] text-[#8a6400]">
                          CHÍNH
                        </span>
                      ) : null}
                    </span>
                    <span className="truncate text-[13px] text-slate-500">
                      {item.description || '—'}
                    </span>
                  </div>
                  <span className="truncate font-mono text-xs font-semibold text-slate-700">
                    {item.code}
                  </span>
                  <b className="tabular-nums">{nodeCountByTree.get(item.id) ?? 0}</b>
                  <span className="flex items-center gap-1.5 justify-self-start rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    Hoạt động
                  </span>
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      className="flex h-8 cursor-pointer items-center gap-1.5 rounded-[7px] bg-[#18181b] px-3 text-[13px] font-semibold text-white hover:bg-[#2a2a2f]"
                      onClick={() => onOpenTree(item.id)}
                      title="Vào xem và chỉnh sửa chi tiết cây sơ đồ"
                    >
                      <Eye className="size-3.5" />
                      Xem chi tiết
                    </button>
                    <button
                      type="button"
                      className="grid size-8 cursor-pointer place-items-center rounded-[7px] border border-[#eef0f3] bg-white text-slate-600 hover:bg-[#f4f6f9] disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!canUpdate}
                      onClick={() => onEditTree(item)}
                      aria-label="Chỉnh sửa thông tin sơ đồ"
                      title="Chỉnh sửa thông tin sơ đồ"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <Popconfirm
                      title="Xoá sơ đồ tổ chức?"
                      description={`Bạn có chắc chắn muốn xoá sơ đồ "${item.name}"?`}
                      okText="Xoá"
                      cancelText="Huỷ"
                      okType="danger"
                      placement="left"
                      disabled={!canDelete}
                      onConfirm={() => onDeleteTree(item)}
                    >
                      <button
                        type="button"
                        className="grid size-8 cursor-pointer place-items-center rounded-[7px] border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={!canDelete}
                        aria-label="Xoá sơ đồ"
                        title="Xoá sơ đồ"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </Popconfirm>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CollapsibleGroup>
      ))}

      {groups.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-slate-200 bg-white py-12 text-center text-sm text-slate-500">
          <GitBranch className="mx-auto size-8 text-slate-300" />
          <p className="mt-2 font-medium">Không tìm thấy sơ đồ tổ chức nào.</p>
          <p className="mt-0.5 text-xs text-slate-400">
            Bấm &quot;Thêm sơ đồ mới&quot; để tạo sơ đồ đầu tiên.
          </p>
        </div>
      ) : null}

      <p className="m-0 text-[13px] text-slate-500">
        Hiển thị <b className="text-[#18181b]">{filteredTrees.length}</b> /{' '}
        <b className="text-[#18181b]">{trees.length}</b> sơ đồ tổ chức
      </p>
    </div>
  );
}

const ROW =
  'grid grid-cols-[minmax(220px,1fr)_120px_80px_120px_200px] items-center gap-x-3 border-t border-[#f1f3f6] px-5';
