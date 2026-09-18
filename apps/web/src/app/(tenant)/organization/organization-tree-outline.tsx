'use client';

import {
  Briefcase,
  Building2,
  ChevronDown,
  ChevronRight,
  FolderTree,
  Network,
  Pencil,
  Plus,
  Search,
  Trash2,
  User,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Popconfirm } from 'antd';
import type { Node, NodeType } from './organization-workspace';

type TreeNode = Node & {
  children: TreeNode[];
  level: number;
};

export function OrganizationTreeOutline({
  nodes,
  nodeTypes,
  selectedNodeId,
  onSelectNode,
  onAddChild,
  onEditNode,
  onDeleteNode,
}: {
  nodes: Node[];
  nodeTypes: Map<string, NodeType>;
  selectedNodeId?: string;
  onSelectNode: (nodeId: string) => void;
  onAddChild: (node: Node) => void;
  onEditNode: (node: Node) => void;
  onDeleteNode: (node: Node) => void;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    // Expand root and second-level nodes by default
    const set = new Set<string>();
    const nodeIds = new Set(nodes.map((n) => n.id));
    const roots = nodes.filter((n) => !n.parentId || !nodeIds.has(n.parentId));
    for (const r of roots) {
      set.add(r.id);
      for (const child of nodes.filter((n) => n.parentId === r.id)) {
        set.add(child.id);
      }
    }
    return set;
  });

  const toggleExpand = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  // Build recursive tree
  const treeData = useMemo(() => {
    const nodeIds = new Set(nodes.map((n) => n.id));
    const childrenMap = new Map<string, Node[]>();
    for (const node of nodes) {
      if (node.parentId && nodeIds.has(node.parentId)) {
        const list = childrenMap.get(node.parentId) ?? [];
        list.push(node);
        childrenMap.set(node.parentId, list);
      }
    }
    for (const list of childrenMap.values()) {
      list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'vi'));
    }

    const roots = nodes
      .filter((n) => !n.parentId || !nodeIds.has(n.parentId))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'vi'));

    function buildRecursive(node: Node, level: number): TreeNode {
      const children = (childrenMap.get(node.id) ?? []).map((child) =>
        buildRecursive(child, level + 1),
      );
      return { ...node, children, level };
    }

    return roots.map((root) => buildRecursive(root, 0));
  }, [nodes]);

  const expandAll = () => {
    setExpandedIds(new Set(nodes.map((n) => n.id)));
  };

  const collapseAll = () => {
    setExpandedIds(new Set());
  };

  // Helper to pick node badge / icon according to sketch
  const getNodeVisual = (node: Node, isRoot: boolean) => {
    const category =
      node.category ??
      (node.nodeTypeId ? nodeTypes.get(node.nodeTypeId)?.category : undefined);
    const nameLower = node.name.toLowerCase();

    if (isRoot || nameLower.includes('tập đoàn') || nameLower.includes('hội đồng quản trị')) {
      return {
        icon: Building2,
        color: 'text-red-600 bg-red-50 border-red-200',
        textColor: 'text-red-700',
      };
    }
    if (nameLower.includes('giám đốc') || nameLower.includes('ban điều hành') || nameLower.includes('bod')) {
      return {
        icon: Briefcase,
        color: 'text-blue-600 bg-blue-50 border-blue-200',
        textColor: 'text-blue-700',
      };
    }
    if (nameLower.includes('chi nhánh') || nameLower.includes('khu vực')) {
      return {
        icon: Network,
        color: 'text-amber-600 bg-amber-50 border-amber-200',
        textColor: 'text-amber-700',
      };
    }
    if (category === 'position' || nameLower.includes('chức danh') || nameLower.includes('trưởng') || nameLower.includes('nhân viên')) {
      return {
        icon: User,
        color: 'text-emerald-600 bg-emerald-50 border-emerald-200',
        textColor: 'text-emerald-700',
      };
    }
    return {
      icon: Network,
      color: 'text-sky-600 bg-sky-50 border-sky-200',
      textColor: 'text-sky-700',
    };
  };

  // Recursive item rendering
  const renderItem = (item: TreeNode) => {
    const isExpanded = expandedIds.has(item.id);
    const isSelected = selectedNodeId === item.id;
    const hasChildren = item.children.length > 0;
    const visual = getNodeVisual(item, item.level === 0);
    const Icon = visual.icon;

    const category =
      item.category ??
      (item.nodeTypeId ? nodeTypes.get(item.nodeTypeId)?.category : undefined);
    const isUnit = category !== 'position';

    const matchesSearch = !searchTerm.trim() || item.name.toLowerCase().includes(searchTerm.toLowerCase()) || item.code.toLowerCase().includes(searchTerm.toLowerCase());

    return (
      <div key={item.id} className="select-none">
        <div
          onClick={() => onSelectNode(item.id)}
          className={`group flex items-center justify-between gap-1.5 rounded-lg px-2 py-1.5 text-xs transition-colors cursor-pointer ${
            isSelected
              ? 'border-l-2 border-blue-600 bg-blue-50/90 font-semibold text-blue-950 shadow-xs'
              : matchesSearch
                ? 'text-slate-700 hover:bg-slate-100/80'
                : 'text-slate-400 hover:bg-slate-50 opacity-60'
          }`}
          style={{ paddingLeft: `${Math.max(8, item.level * 16 + 8)}px` }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {/* Expand / Collapse arrow button */}
            {hasChildren ? (
              <button
                type="button"
                onClick={(e) => toggleExpand(item.id, e)}
                className="grid size-4 shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-200/70 hover:text-slate-700"
              >
                {isExpanded ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
              </button>
            ) : (
              <span className="size-4 shrink-0" />
            )}

            {/* Category Icon */}
            <span
              className={`grid size-5 shrink-0 place-items-center rounded border ${visual.color}`}
            >
              <Icon className="size-3" />
            </span>

            {/* Node Name & Code (hiển thị đầy đủ tên node) */}
            <span className="font-medium break-words leading-tight" title={`${item.code} · ${item.name}`}>
              {item.name}
            </span>
          </div>

          {/* Quick Action buttons on hover or selected */}
          <div
            className={`flex shrink-0 items-center gap-0.5 ${
              isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            } transition-opacity`}
          >
            {isUnit ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddChild(item);
                }}
                className="grid size-5.5 place-items-center rounded text-slate-500 hover:bg-blue-100 hover:text-blue-700"
                title="Thêm node con trực thuộc"
              >
                <Plus className="size-3" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEditNode(item);
              }}
              className="grid size-5.5 place-items-center rounded text-slate-500 hover:bg-slate-200 hover:text-slate-800"
              title="Sửa thông tin node"
            >
              <Pencil className="size-2.5" />
            </button>
            <Popconfirm
              title="Xoá node tổ chức?"
              description={`Bạn có chắc chắn muốn xoá node "${item.name}"? Dữ liệu lịch sử vẫn được lưu trữ.`}
              okText="Xoá"
              cancelText="Huỷ"
              okButtonProps={{ danger: true }}
              placement="left"
              onConfirm={() => onDeleteNode(item)}
            >
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className="grid size-5.5 place-items-center rounded text-slate-400 hover:bg-red-100 hover:text-red-700"
                title="Xoá node"
              >
                <Trash2 className="size-3" />
              </button>
            </Popconfirm>
          </div>
        </div>

        {/* Render child nodes */}
        {hasChildren && isExpanded ? (
          <div className="relative">
            {item.children.map(renderItem)}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3.5 py-3">
        <div className="flex items-center gap-2">
          <FolderTree className="size-4 text-blue-600" />
          <h3 className="text-sm font-bold text-slate-900">Sơ đồ phân cấp</h3>
        </div>
        <div className="flex items-center gap-1 text-[11px] text-slate-500">
          <button
            type="button"
            onClick={expandAll}
            className="rounded px-1.5 py-0.5 hover:bg-slate-200/60 hover:text-slate-800"
            title="Mở rộng tất cả các nhánh"
          >
            Mở hết
          </button>
          <span>·</span>
          <button
            type="button"
            onClick={collapseAll}
            className="rounded px-1.5 py-0.5 hover:bg-slate-200/60 hover:text-slate-800"
            title="Thu gọn các nhánh"
          >
            Thu gọn
          </button>
        </div>
      </div>

      {/* Quick Search */}
      <div className="shrink-0 border-b border-slate-100 p-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Tìm kiếm node…"
            className="h-7.5 w-full rounded-md border border-slate-200 bg-slate-50/50 pl-8 pr-2.5 text-xs placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Tree Content List */}
      <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-0.5">
        {treeData.length > 0 ? (
          treeData.map(renderItem)
        ) : (
          <div className="py-8 text-center text-xs text-slate-400">
            Chưa có node nào trong sơ đồ này.
          </div>
        )}
      </div>

      {/* Footer Status */}
      <div className="flex shrink-0 items-center justify-between border-t border-slate-100 bg-slate-50/60 px-3 py-2 text-[11px] text-slate-500">
        <span>Tổng cộng: <b>{nodes.length}</b> node</span>
        <span className="text-slate-400">Bấm node để xem chi tiết</span>
      </div>
    </div>
  );
}
