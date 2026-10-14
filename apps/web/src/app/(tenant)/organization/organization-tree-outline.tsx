'use client';
import { useOrganizationPermissions } from './organization-permissions';

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
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Popconfirm } from 'antd';
// Tooltip chi tiết node (đang tắt, bỏ comment cùng khối JSX bên dưới để dùng lại):
// import {
//   Tooltip,
//   TooltipContent,
//   TooltipTrigger,
// } from '@/components/ui/tooltip';
import type { Node, NodeType } from './organization-workspace';

/** Mỗi cấp thụt vào bao nhiêu px (trước đây 16px, từng giảm còn 12px; 14px để đường nối cây có chỗ mà tên vẫn rộng hơn bản cũ). */
const INDENT_PX = 14;

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
  const { canCreate, canUpdate, canDelete } = useOrganizationPermissions();
  const [searchTerm, setSearchTerm] = useState('');
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // Tìm các node khớp trực tiếp với từ khóa tìm kiếm (tên hoặc mã)
  const matchedDirectIds = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    if (!needle) return new Set<string>();
    return new Set(
      nodes
        .filter(
          (node) =>
            node.name.toLowerCase().includes(needle) ||
            node.code.toLowerCase().includes(needle),
        )
        .map((n) => n.id),
    );
  }, [nodes, searchTerm]);

  // Giữ lại toàn bộ chuỗi tổ tiên đến node khớp tìm kiếm (giống buildAssetTree trong Inventory)
  const keepNodeIds = useMemo(() => {
    const needle = searchTerm.trim();
    if (!needle) return new Set(nodes.map((n) => n.id));

    const keep = new Set<string>();
    for (const id of matchedDirectIds) {
      let cur: Node | undefined = nodeMap.get(id);
      while (cur && !keep.has(cur.id)) {
        keep.add(cur.id);
        cur = cur.parentId ? nodeMap.get(cur.parentId) : undefined;
      }
    }
    return keep;
  }, [matchedDirectIds, nodeMap, nodes, searchTerm]);

  // Build recursive tree with filtering and ordering
  const treeData = useMemo(() => {
    const presentNodeIds = new Set(nodes.map((n) => n.id));
    const childrenMap = new Map<string, Node[]>();

    for (const node of nodes) {
      if (node.parentId && presentNodeIds.has(node.parentId)) {
        const list = childrenMap.get(node.parentId) ?? [];
        list.push(node);
        childrenMap.set(node.parentId, list);
      }
    }

    for (const list of childrenMap.values()) {
      list.sort(
        (a, b) =>
          (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
          a.name.localeCompare(b.name, 'vi'),
      );
    }

    const roots = nodes
      .filter((n) => !n.parentId || !presentNodeIds.has(n.parentId))
      .sort(
        (a, b) =>
          (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
          a.name.localeCompare(b.name, 'vi'),
      );

    function buildRecursive(node: Node, level: number): TreeNode | null {
      if (!keepNodeIds.has(node.id)) return null;

      const rawChildren = childrenMap.get(node.id) ?? [];
      const children: TreeNode[] = [];
      for (const child of rawChildren) {
        const built = buildRecursive(child, level + 1);
        if (built) children.push(built);
      }

      return { ...node, children, level };
    }

    const result: TreeNode[] = [];
    for (const root of roots) {
      const built = buildRecursive(root, 0);
      if (built) result.push(built);
    }
    return result;
  }, [keepNodeIds, nodes]);

  // Danh sách các node đang hiển thị phẳng theo thứ tự xuất hiện (để hỗ trợ phím mũi tên Lên/Xuống)
  const flatVisibleNodes = useMemo(() => {
    const list: TreeNode[] = [];
    const isSearching = Boolean(searchTerm.trim());

    function traverse(item: TreeNode) {
      list.push(item);
      // Khi đang search, luôn mở mọi nhánh chứa kết quả; khi không search, tuân theo collapsedIds
      const isExpanded = isSearching || !collapsedIds.has(item.id);
      if (item.children.length > 0 && isExpanded) {
        for (const child of item.children) {
          traverse(child);
        }
      }
    }

    for (const root of treeData) {
      traverse(root);
    }
    return list;
  }, [collapsedIds, searchTerm, treeData]);

  // Tập hợp các ID của các node cha có con
  const parentNodeIds = useMemo(() => {
    const set = new Set<string>();
    const nodeIds = new Set(nodes.map((n) => n.id));
    for (const node of nodes) {
      if (node.parentId && nodeIds.has(node.parentId)) {
        set.add(node.parentId);
      }
    }
    return set;
  }, [nodes]);

  const toggleExpand = (nodeId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const expandAll = () => {
    setCollapsedIds(new Set());
  };

  const collapseAll = () => {
    setCollapsedIds(new Set(parentNodeIds));
  };

  // Keyboard navigation hỗ trợ điều hướng danh sách (Mũi tên lên/xuống/trái/phải)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (flatVisibleNodes.length === 0) return;
    const currentIndex = flatVisibleNodes.findIndex((n) => n.id === selectedNodeId);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = currentIndex < flatVisibleNodes.length - 1 ? currentIndex + 1 : 0;
      onSelectNode(flatVisibleNodes[nextIndex].id);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : flatVisibleNodes.length - 1;
      onSelectNode(flatVisibleNodes[prevIndex].id);
    } else if (e.key === 'ArrowRight' && currentIndex >= 0) {
      const currentNode = flatVisibleNodes[currentIndex];
      if (currentNode.children.length > 0 && collapsedIds.has(currentNode.id)) {
        e.preventDefault();
        toggleExpand(currentNode.id);
      }
    } else if (e.key === 'ArrowLeft' && currentIndex >= 0) {
      const currentNode = flatVisibleNodes[currentIndex];
      if (currentNode.children.length > 0 && !collapsedIds.has(currentNode.id)) {
        e.preventDefault();
        toggleExpand(currentNode.id);
      }
    }
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
  const isSearching = Boolean(searchTerm.trim());

  /**
   * `trail[k]` = node tổ tiên ở cấp k có phải anh em cuối cùng không (cấp 0..level-1); `isLast` = chính node này.
   * Dùng để vẽ đường nối kiểu cây thư mục: nhánh dọc chạy tiếp qua các hàng khi tổ tiên còn anh em phía sau,
   * và nhánh ngang rẽ vào đúng node.
   */
  const renderItem = (item: TreeNode, trail: boolean[] = [], isLast = true) => {
    // Khi đang search, luôn tự động mở mọi nhánh; khi không search thì tuân theo collapsedIds
    const isExpanded = isSearching || !collapsedIds.has(item.id);
    const isSelected = selectedNodeId === item.id;
    const hasChildren = item.children.length > 0;
    const visual = getNodeVisual(item, item.level === 0);
    const Icon = visual.icon;

    const category =
      item.category ??
      (item.nodeTypeId ? nodeTypes.get(item.nodeTypeId)?.category : undefined);
    const parentNode = item.parentId ? nodeMap.get(item.parentId) : undefined;
    const isHeadPosition = Boolean(
      category === 'position' &&
      parentNode &&
      parentNode.headPositionId === item.id,
    );

    const isDirectMatch = matchedDirectIds.has(item.id);

    return (
      <div key={item.id} className="select-none">
        <div
          onClick={() => onSelectNode(item.id)}
          className="group relative flex items-center gap-0.5 px-2 py-1 text-xs cursor-pointer"
          style={{ paddingLeft: `${Math.max(8, item.level * INDENT_PX + 8)}px` }}
        >
          {/* Đường nối cây: nhánh dọc của các tổ tiên còn anh em phía sau, và nhánh rẽ vào node (┣ / ┗), cùng trục với mũi tên mở/thu */}
          {item.level > 0 ? (
            <>
              {Array.from({ length: item.level - 1 }, (_, a) =>
                trail[a + 1] ? null : (
                  <span
                    key={a}
                    aria-hidden="true"
                    className="pointer-events-none absolute -bottom-px -top-px w-px bg-slate-300"
                    style={{ left: `${a * INDENT_PX + 16}px` }}
                  />
                ),
              )}
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute -top-px w-px bg-slate-300 ${isLast ? 'h-[calc(50%+1px)]' : '-bottom-px'}`}
                style={{ left: `${(item.level - 1) * INDENT_PX + 16}px` }}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 h-px bg-slate-300"
                style={{
                  left: `${(item.level - 1) * INDENT_PX + 16}px`,
                  // Node có con: rẽ tới mũi tên mở/thu; node lá: rẽ tới tận biểu tượng của node.
                  width: `${hasChildren ? INDENT_PX - 9 : INDENT_PX + 12}px`,
                }}
              />
            </>
          ) : null}
          {/* Expand / Collapse arrow button (nằm ngoài vùng highlight) */}
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

          {/* Vùng highlight (hover / đang chọn / khớp tìm kiếm): chỉ tính từ Category Icon trở đi, không gồm phần thụt cấp, đường nối và mũi tên */}
          <div
            className={`flex min-w-0 flex-1 items-center justify-between gap-1.5 rounded-sm border-l-2 pl-0.5 pr-1.5 py-0.5 transition-colors ${isSelected
              ? 'border-blue-600 bg-blue-50/90 font-semibold text-blue-950 shadow-xs'
              : isDirectMatch
                ? 'border-transparent bg-amber-50/80 text-amber-950 font-medium hover:bg-amber-100/90'
                : isHeadPosition
                  ? 'border-transparent bg-amber-50/40 text-slate-800 hover:bg-amber-100/50'
                  : 'border-transparent text-slate-700 hover:bg-slate-100/80'
              }`}
          >
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              {/* Category Icon */}
              <span
                className={`grid size-5 shrink-0 place-items-center rounded border ${isHeadPosition ? 'border-amber-300 bg-amber-100 text-amber-700' : visual.color
                  }`}
              >
                <Icon className="size-3" />
              </span>

              {/* Node Name & Code (hiển thị đầy đủ tên node, kèm badge nếu khớp từ khóa) */}
              <span
                className="font-medium break-words leading-tight flex items-center gap-1 min-w-0"
                title={`${item.code} · ${item.name}`}
              >
                {/* Tooltip chi tiết node (đang tắt):
              <Tooltip>
                <TooltipTrigger render={<span className="line-clamp-2 min-w-0 break-words" />}>
                  {item.name}
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-sm flex-col items-start gap-0.5 py-2">
                  <span className="text-[13px] font-semibold leading-snug">{item.name}</span>
                  <span className="opacity-80">Mã: {item.code}</span>
                  {item.nodeTypeId && nodeTypes.get(item.nodeTypeId) ? (
                    <span className="opacity-80">Loại: {nodeTypes.get(item.nodeTypeId)?.name}</span>
                  ) : null}
                  {parentNode ? <span className="opacity-80">Thuộc: {parentNode.name}</span> : null}
                  {hasChildren ? <span className="opacity-80">{item.children.length} node trực thuộc</span> : null}
                  {isHeadPosition ? <span className="opacity-80">Chức danh quản lý chính của đơn vị</span> : null}
                </TooltipContent>
              </Tooltip>
              */}
                <span className="line-clamp-2 min-w-0 break-words">{item.name}</span>
                {isHeadPosition ? (
                  <span
                    className="inline-flex items-center gap-0.5 rounded-full bg-amber-100/90 px-1.5 py-0.2 text-[9px] font-bold text-amber-800 border border-amber-300 shrink-0"
                    title="Chức danh quản lý chính của đơn vị"
                  >
                    ★ Quản lý
                  </span>
                ) : null}
              </span>
            </div>

            {/* Quick Action buttons on hover or selected — ẩn hẳn khi không dùng để tên node có đủ chỗ */}
            <div
              className={`shrink-0 items-center gap-0.5 ${isSelected ? 'flex' : 'hidden group-hover:flex'
                }`}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddChild(item);
                }}
                className="grid size-5.5 place-items-center rounded text-slate-500 hover:bg-blue-100 hover:text-blue-700"
                disabled={!canCreate}
                title="Thêm node con trực thuộc"
              >
                <Plus className="size-3" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEditNode(item);
                }}
                className="grid size-5.5 place-items-center rounded text-slate-500 hover:bg-slate-200 hover:text-slate-800"
                disabled={!canUpdate}
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
                  disabled={!canDelete}
                  title="Xoá node"
                >
                  <Trash2 className="size-3" />
                </button>
              </Popconfirm>
            </div>
          </div>
        </div>

        {/* Render child nodes */}
        {hasChildren && isExpanded ? (
          <div className="relative">
            {item.children.map((child, index) =>
              renderItem(child, [...trail, isLast], index === item.children.length - 1),
            )}
          </div>
        ) : null}
      </div>
    );
  };

  const allCollapsed = parentNodeIds.size > 0 && parentNodeIds.size === collapsedIds.size;

  return (
    <div
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[14px] border border-[#eef0f3] bg-white focus:outline-none focus:ring-1 focus:ring-[#ffc90a]/60"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-[#eef0f3] bg-[#fafbfc] px-3.5 py-3">
        <div className="flex items-center gap-2">
          <FolderTree className="size-4 text-amber-700" />
          <h3 className="m-0 text-[13.5px] font-bold text-slate-900">Sơ đồ phân cấp</h3>
        </div>
        <div className="flex items-center gap-1 text-[11px] text-slate-500">
          <button
            type="button"
            onClick={allCollapsed ? expandAll : collapseAll}
            className="rounded-md border border-[#eef0f3] bg-white px-2 py-1 text-xs text-slate-700 transition hover:bg-[#f4f6f9] cursor-pointer"
            title={allCollapsed ? 'Mở rộng toàn bộ cây' : 'Thu gọn toàn bộ cây'}
          >
            {allCollapsed ? '⊞ Mở hết' : '⊟ Thu gọn'}
          </button>
        </div>
      </div>

      {/* Search Box chuẩn Modules/Inventory #assets */}
      <div className="shrink-0 px-3 pb-1.5 pt-2.5">
        <div className="relative flex items-center">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Tìm theo mã hoặc tên node… (Phím ↑↓ điều hướng)"
            className="h-[34px] w-full rounded-lg border border-[#eef0f3] bg-[#fafbfc] pl-8 pr-7 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#ffc90a] focus:bg-white focus:outline-none transition-all"
          />
          {searchTerm ? (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer"
              title="Xoá tìm kiếm"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        {searchTerm.trim() ? (
          <div className="mt-1.5 flex items-center justify-between px-1 text-[11px] text-slate-500">
            <span>
              Tìm thấy: <b className="text-blue-600">{matchedDirectIds.size}</b> node phù hợp
            </span>
            <span className="text-[10px] text-slate-400">Tự động giữ mạch tổ tiên</span>
          </div>
        ) : null}
      </div>

      {/* Tree Content List */}
      <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-0.5">
        {treeData.length > 0 ? (
          treeData.map((root, index) => renderItem(root, [], index === treeData.length - 1))
        ) : (
          <div className="py-8 text-center text-xs text-slate-400">
            {searchTerm.trim()
              ? `Không tìm thấy node nào khớp với "${searchTerm.trim()}"`
              : 'Chưa có node nào trong sơ đồ này.'}
          </div>
        )}
      </div>

      {/* Footer Status */}
      <div className="flex shrink-0 items-center justify-between border-t border-[#eef0f3] px-3.5 py-2.5 text-[11.5px] text-slate-500">
        <span>Tổng cộng: <b className="text-[#18181b]">{nodes.length}</b> node</span>
        <span className="text-slate-400">Bấm node để xem chi tiết</span>
      </div>
    </div>
  );
}
