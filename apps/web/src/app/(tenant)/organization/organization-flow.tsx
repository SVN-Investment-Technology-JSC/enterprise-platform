'use client';

import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useNodesState,
  useEdgesState,
  type Edge,
  type Node,
  type NodeProps,
  type OnNodeDrag,
  type ReactFlowInstance,
} from '@xyflow/react';
import { AlertTriangle, ArrowRightLeft, GripVertical, Map as MapIcon, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  cacheLayout,
  initializeLayout,
  useAppDispatch,
  useAppSelector,
  type FlowPositions,
} from '@/store/organization-layout-store';
import {
  calculateHierarchicalLayout,
  type LayoutDirection,
  type LayoutNode,
} from './organization-layout-utils';
import styles from './organization-workspace.module.css';

type OrganizationNode = {
  id: string;
  treeId: string;
  parentId?: string;
  headPositionId?: string | null;
  category?: 'unit' | 'position';
  nodeTypeId?: string;
  code: string;
  name: string;
  description?: string;
  status: string;
  sortOrder?: number;
};
type OrganizationNodeType = {
  id: string;
  name: string;
  category: 'unit' | 'position';
};
type OrganizationAssignment = {
  nodeId: string;
  userId: string;
  isPrimary: boolean;
  startDate?: string;
  endDate?: string;
  status: string;
};
type OrganizationUser = {
  id: string;
  fullName: string;
};
type FlowData = {
  node: OrganizationNode;
  type?: OrganizationNodeType;
  isRoot: boolean;
  isSelected?: boolean;
  isHighlighted?: boolean;
  childUnitCount: number;
  childPersonnelCount: number;
  managerDisplay: string;
  hasManagerWarning: boolean;
  managerName?: string;
  onSelect: (node: OrganizationNode) => void;
  onEdit: (node: OrganizationNode) => void;
  onAddChild: (node: OrganizationNode) => void;
  layoutDirection?: LayoutDirection;
};

function OrganizationFlowNode({ data }: NodeProps<Node<FlowData>>) {
  const isUnit = (data.node.category ?? data.type?.category ?? 'unit') === 'unit';
  const nameLower = data.node.name.toLowerCase();
  const isHorizontal = (data.layoutDirection ?? 'horizontal') === 'horizontal';

  // Top color accent bar matching the sketch
  const accentColor =
    data.isRoot || nameLower.includes('tập đoàn') || nameLower.includes('hội đồng quản trị')
      ? 'border-t-red-500'
      : nameLower.includes('giám đốc') || nameLower.includes('ban điều hành')
        ? 'border-t-blue-600'
        : nameLower.includes('chi nhánh')
          ? 'border-t-amber-500'
          : isUnit
            ? 'border-t-sky-500'
            : 'border-t-emerald-500';

  // Letter abbreviation for circular avatar
  const initials = useMemo(() => {
    if (data.managerName) {
      const raw = data.managerName.trim();
      const parts = raw.split(/\s+/);
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
      return raw.slice(0, 2).toUpperCase();
    }
    const raw = data.node.name.trim();
    if (raw.length <= 3) return raw.toUpperCase();
    const parts = raw.split(/\s+/);
    if (parts.length === 1) return raw.slice(0, 2).toUpperCase();
    return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase();
  }, [data.managerName, data.node.name]);

  const isSelected = data.isSelected;
  const isHighlighted = data.isHighlighted;

  return (
    <div
      onClick={() => data.onSelect(data.node)}
      className={`relative w-64 rounded-xl border border-slate-200 border-t-4 bg-white p-3.5 shadow-sm transition-all cursor-pointer ${accentColor} ${
        isSelected
          ? 'ring-2 ring-blue-500 ring-offset-2 shadow-[0_8px_25px_rgba(37,99,235,0.22)]'
          : isHighlighted
            ? 'ring-2 ring-amber-500 ring-offset-2 shadow-[0_8px_25px_rgba(245,158,11,0.25)] border-amber-300'
            : 'hover:shadow-md hover:border-slate-300'
      }`}
    >
      <Handle
        className="!size-2 !border-2 !border-slate-400 !bg-white"
        position={isHorizontal ? Position.Left : Position.Top}
        type="target"
      />

      {/* Top drag bar */}
      <div
        className="organization-drag-handle flex cursor-grab items-center justify-between gap-1 pb-1.5 active:cursor-grabbing"
        title="Kéo node để điều chỉnh vị trí"
      >
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          {/* {data.type?.name ?? (isUnit ? 'Đơn vị' : 'Chức danh')} */}
          {isUnit ? 'Đơn vị' : 'Chức danh'}
        </span>
        <div className="flex items-center gap-1">
          <span
            className={`size-1.5 rounded-full ${data.node.status === 'active' ? 'bg-emerald-500' : 'bg-slate-300'}`}
          />
          <GripVertical
            aria-hidden="true"
            className="size-3.5 text-slate-400"
          />
        </div>
      </div>

      {/* Center content */}
      <div className="flex flex-col items-center text-center pt-0.5 pb-1">
        {/* Avatar circle */}
        <div className="grid size-9 place-items-center rounded-full bg-slate-100 border border-slate-200 text-xs font-bold text-slate-700 shadow-xs">
          {initials}
        </div>

        {/* Node Name */}
        <h4 className="mt-2 text-sm font-bold text-slate-900 leading-snug line-clamp-2" title={data.node.name}>
          {data.node.name}
        </h4>

        {/* Manager subtitle */}
        <div className="mt-1 flex items-center justify-center gap-1 max-w-full px-1">
          {data.hasManagerWarning ? (
            <AlertTriangle className="size-3.5 shrink-0 text-amber-500" />
          ) : null}
          <p
            className={`text-xs line-clamp-2 leading-tight ${data.hasManagerWarning
              ? 'text-amber-600 font-semibold'
              : data.managerDisplay.startsWith('Không có') ||
                data.managerDisplay.startsWith('Chưa chọn')
                ? 'text-slate-400 italic'
                : 'text-slate-600 font-medium'
              }`}
            title={data.managerDisplay}
          >
            {data.managerDisplay}
          </p>
        </div>

        {/* Unit badges */}
        {isUnit && (data.childUnitCount > 0 || data.childPersonnelCount > 0) ? (
          <div className="mt-2 flex flex-wrap justify-center gap-1">
            {data.childUnitCount > 0 ? (
              <span className="inline-flex rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 border border-blue-100">
                {data.childUnitCount} đơn vị
              </span>
            ) : null}
            {data.childPersonnelCount > 0 ? (
              <span className="inline-flex rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 border border-violet-100">
                {data.childPersonnelCount} nhân sự
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <Handle
        className="!size-2 !border-2 !border-slate-400 !bg-white"
        position={isHorizontal ? Position.Right : Position.Bottom}
        type="source"
      />
    </div>
  );
}

const flowNodeTypes = { organization: OrganizationFlowNode };

export function OrganizationFlow({
  nodes,
  nodeTypes,
  assignments,
  users,
  initialPositions,
  layoutCacheKey,
  selectedNodeId,
  onSelectNode,
  onEdit,
  onAddChild,
}: {
  nodes: OrganizationNode[];
  nodeTypes: Map<string, OrganizationNodeType>;
  assignments: OrganizationAssignment[];
  users: OrganizationUser[];
  initialPositions: FlowPositions;
  layoutCacheKey: string;
  selectedNodeId?: string;
  onSelectNode?: (nodeId: string) => void;
  onEdit: (node: OrganizationNode) => void;
  onAddChild: (node: OrganizationNode) => void;
}) {
  const [layoutDirection, setLayoutDirection] = useState<LayoutDirection>('horizontal');
  const [showMiniMap, setShowMiniMap] = useState<boolean>(true);

  const flow = useMemo(() => {
    const allNodesById = new Map(nodes.map((node) => [node.id, node]));
    // Canvas ONLY displays Unit nodes (not Position nodes)
    const unitNodes = nodes.filter((node) => (node.category ?? 'unit') !== 'position');
    const unitNodeIds = new Set(unitNodes.map((node) => node.id));

    const roots = unitNodes
      .filter((node) => {
        let pId = node.parentId;
        while (pId && !unitNodeIds.has(pId)) {
          pId = allNodesById.get(pId)?.parentId;
        }
        return !pId;
      })
      .sort(bySortOrder);
    const rootIds = new Set(roots.map((node) => node.id));
    const today = localDate(new Date());
    const userNames = new Map(users.map((user) => [user.id, user.fullName]));
    const assigneesByNode = new Map<string, OrganizationAssignment[]>();
    assignments
      .filter(
        (assignment) =>
          assignment.status === 'active' &&
          (!assignment.startDate || assignment.startDate <= today) &&
          (!assignment.endDate || assignment.endDate >= today),
      )
      .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary))
      .forEach((assignment) =>
        assigneesByNode.set(assignment.nodeId, [
          ...(assigneesByNode.get(assignment.nodeId) ?? []),
          assignment,
        ]),
      );

    // Compute effective parent ID among unit nodes (skipping any intermediate position nodes)
    const effectiveUnitNodes: LayoutNode[] = unitNodes.map((u) => {
      let effectiveParentId = u.parentId;
      while (effectiveParentId && !unitNodeIds.has(effectiveParentId)) {
        effectiveParentId = allNodesById.get(effectiveParentId)?.parentId;
      }
      return {
        ...u,
        parentId: effectiveParentId,
      };
    });

    // Calculate balanced, professional hierarchical layout positions for unit nodes only
    const automaticPositions = calculateHierarchicalLayout(effectiveUnitNodes, layoutDirection);

    const flowNodes: Node<FlowData>[] = unitNodes.map((node) => {
      // Direct child units
      const childUnits = unitNodes.filter((child) => {
        let pId = child.parentId;
        while (pId && !unitNodeIds.has(pId)) {
          pId = allNodesById.get(pId)?.parentId;
        }
        return pId === node.id;
      });

      // Direct child positions under this unit
      const childPositions = nodes.filter(
        (child) => child.parentId === node.id && child.category === 'position',
      );

      // Child personnel count across all positions under this unit
      const childPersonnelCount = new Set(
        childPositions.flatMap((posNode) =>
          (assigneesByNode.get(posNode.id) ?? []).map((a) => a.userId),
        ),
      ).size;

      // Head position node of this unit
      let headPosition: OrganizationNode | undefined = undefined;
      if (node.headPositionId) {
        const hp = allNodesById.get(node.headPositionId);
        if (hp && hp.category === 'position') {
          headPosition = hp;
        }
      }

      // Compute manager display text & warning
      let managerDisplay = 'Không có / chưa chọn quản lý';
      let hasManagerWarning = false;
      let managerName: string | undefined = undefined;

      if (childPositions.length === 0) {
        managerDisplay = 'Không có / chưa chọn quản lý';
      } else if (!headPosition) {
        managerDisplay = 'Chưa chọn quản lý';
      } else {
        const posAssignees = assigneesByNode.get(headPosition.id) ?? [];
        if (posAssignees.length === 0) {
          managerDisplay = `${headPosition.name} - (chưa bổ nhiệm nhân sự)`;
        } else if (posAssignees.length === 1) {
          const uName = userNames.get(posAssignees[0].userId) ?? 'Nhân sự';
          managerDisplay = `${headPosition.name} - ${uName}`;
          managerName = uName;
        } else {
          // Multiple assignees
          const primaryAssignee = posAssignees.find((a) => a.isPrimary);
          if (primaryAssignee) {
            const uName = userNames.get(primaryAssignee.userId) ?? 'Nhân sự';
            managerDisplay = `${headPosition.name} - ${uName}`;
            managerName = uName;
          } else {
            managerDisplay = `${headPosition.name} - (chưa gắn nhân sự nào làm vị trí chính cho chức danh này)`;
            hasManagerWarning = true;
          }
        }
      }

      // Check if selectedNodeId directly matches this unit or is a position belonging to this unit
      const isSelected = node.id === selectedNodeId;
      let isHighlighted = false;
      if (!isSelected && selectedNodeId) {
        const selectedRawNode = allNodesById.get(selectedNodeId);
        if (selectedRawNode && (selectedRawNode.category ?? 'unit') === 'position') {
          // Walk up to find if this position belongs to this unit
          let curParentId = selectedRawNode.parentId;
          while (curParentId && !unitNodeIds.has(curParentId)) {
            curParentId = allNodesById.get(curParentId)?.parentId;
          }
          if (curParentId === node.id) {
            isHighlighted = true;
          }
        }
      }

      return {
        id: node.id,
        type: 'organization',
        dragHandle: '.organization-drag-handle',
        position: automaticPositions[node.id] ?? { x: 0, y: 0 },
        data: {
          node,
          type: node.nodeTypeId ? nodeTypes.get(node.nodeTypeId) : undefined,
          isRoot: rootIds.has(node.id),
          isSelected,
          isHighlighted,
          childUnitCount: childUnits.length,
          childPersonnelCount,
          managerDisplay,
          hasManagerWarning,
          managerName,
          onSelect: (n) => onSelectNode?.(n.id),
          onEdit,
          onAddChild,
          layoutDirection,
        },
      };
    });

    const edges: Edge[] = unitNodes.flatMap((node) => {
      let parentUnitId = node.parentId;
      while (parentUnitId && !unitNodeIds.has(parentUnitId)) {
        parentUnitId = allNodesById.get(parentUnitId)?.parentId;
      }
      if (!parentUnitId || !unitNodeIds.has(parentUnitId)) return [];
      return [
        {
          id: `${parentUnitId}-${node.id}`,
          source: parentUnitId,
          target: node.id,
          type: 'smoothstep',
          style: { stroke: '#94a3b8', strokeWidth: 1.4 },
        },
      ];
    });
    return { flowNodes, edges };
  }, [assignments, layoutDirection, nodes, nodeTypes, onAddChild, onEdit, onSelectNode, selectedNodeId, users]);
  const flowInstance = useRef<ReactFlowInstance<Node<FlowData>, Edge> | null>(
    null,
  );
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dispatch = useAppDispatch();
  const cachedLayout = useAppSelector(
    (state) => state.organizationLayouts.layouts[layoutCacheKey],
  );
  const [moveMessage, setMoveMessage] = useState<string>();
  const isInitialMount = useRef(true);

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<Node<FlowData>>([]);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Child mapping to easily find all descendants of any node (only unit nodes on canvas)
  const childrenMap = useMemo(() => {
    const map = new Map<string, string[]>();
    const allNodesById = new Map(nodes.map((n) => [n.id, n]));
    const unitNodes = nodes.filter((n) => (n.category ?? 'unit') !== 'position');
    const unitNodeIds = new Set(unitNodes.map((n) => n.id));
    for (const node of unitNodes) {
      let pId = node.parentId;
      while (pId && !unitNodeIds.has(pId)) {
        pId = allNodesById.get(pId)?.parentId;
      }
      if (pId && unitNodeIds.has(pId)) {
        const list = map.get(pId) ?? [];
        list.push(node.id);
        map.set(pId, list);
      }
    }
    return map;
  }, [nodes]);

  const getDescendantIds = (rootId: string): Set<string> => {
    const descendants = new Set<string>();
    const queue = [rootId];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const children = childrenMap.get(currentId) ?? [];
      for (const childId of children) {
        if (!descendants.has(childId)) {
          descendants.add(childId);
          queue.push(childId);
        }
      }
    }
    return descendants;
  };

  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const descendantStartPositionsRef = useRef<Map<string, { x: number; y: number }> | null>(null);
  const activeDescendantIdsRef = useRef<Set<string> | null>(null);

  const handleNodeDragStart: OnNodeDrag<Node<FlowData>> = (
    _event,
    draggedNode,
  ) => {
    setMoveMessage('Đang sắp xếp vị trí hiển thị…');
    dragStartPosRef.current = { ...draggedNode.position };

    const descendantIds = getDescendantIds(draggedNode.id);
    activeDescendantIdsRef.current = descendantIds;

    if (descendantIds.size > 0) {
      const currentNodes = flowInstance.current?.getNodes() ?? flowNodes;
      const startPositions = new Map<string, { x: number; y: number }>();
      for (const n of currentNodes) {
        if (descendantIds.has(n.id)) {
          startPositions.set(n.id, { ...n.position });
        }
      }
      descendantStartPositionsRef.current = startPositions;
    } else {
      descendantStartPositionsRef.current = null;
    }
  };

  const handleNodeDrag: OnNodeDrag<Node<FlowData>> = (
    _event,
    draggedNode,
  ) => {
    const startPos = dragStartPosRef.current;
    const descendantStartPositions = descendantStartPositionsRef.current;
    const descendantIds = activeDescendantIdsRef.current;

    if (
      !startPos ||
      !descendantStartPositions ||
      !descendantIds ||
      descendantIds.size === 0
    ) {
      return;
    }

    const deltaX = draggedNode.position.x - startPos.x;
    const deltaY = draggedNode.position.y - startPos.y;

    setFlowNodes((prevNodes) =>
      prevNodes.map((n) => {
        if (descendantIds.has(n.id)) {
          const initialPos = descendantStartPositions.get(n.id);
          if (initialPos) {
            return {
              ...n,
              position: {
                x: initialPos.x + deltaX,
                y: initialPos.y + deltaY,
              },
            };
          }
        }
        return n;
      }),
    );
  };

  const handleNodeDragStop: OnNodeDrag<Node<FlowData>> = (
    _event,
    draggedNode,
  ) => {
    const startPos = dragStartPosRef.current;
    const descendantStartPositions = descendantStartPositionsRef.current;
    const descendantIds = activeDescendantIdsRef.current;

    const currentNodes = flowInstance.current?.getNodes() ?? flowNodes;
    let finalNodes = currentNodes;

    if (
      startPos &&
      descendantStartPositions &&
      descendantIds &&
      descendantIds.size > 0
    ) {
      const deltaX = draggedNode.position.x - startPos.x;
      const deltaY = draggedNode.position.y - startPos.y;

      finalNodes = currentNodes.map((n) => {
        if (descendantIds.has(n.id)) {
          const initialPos = descendantStartPositions.get(n.id);
          if (initialPos) {
            return {
              ...n,
              position: {
                x: initialPos.x + deltaX,
                y: initialPos.y + deltaY,
              },
            };
          }
        }
        if (n.id === draggedNode.id) {
          return {
            ...n,
            position: { ...draggedNode.position },
          };
        }
        return n;
      });

      setFlowNodes(finalNodes);
    }

    dragStartPosRef.current = null;
    descendantStartPositionsRef.current = null;
    activeDescendantIdsRef.current = null;

    const positions: FlowPositions = Object.fromEntries(
      finalNodes.map((node) => [node.id, node.position] as const),
    );
    dispatch(cacheLayout({ key: layoutCacheKey, positions }));
    setMoveMessage('Đã lưu tạm vị trí — bấm nút Lưu để ghi vào hệ thống.');
  };

  // Synchronize flowNodes whenever flow.flowNodes or cachedLayout changes
  useEffect(() => {
    setFlowNodes((currentNodes) => {
      const posMap = new Map(currentNodes.map((n) => [n.id, n.position]));
      return flow.flowNodes.map((node) => {
        const position =
          cachedLayout?.positions?.[node.id] ??
          (cachedLayout?.dirty ? posMap.get(node.id) : undefined) ??
          node.position;
        return {
          ...node,
          position,
        };
      });
    });
  }, [flow.flowNodes, cachedLayout, setFlowNodes]);

  useEffect(() => {
    setFlowEdges(flow.edges);
  }, [flow.edges, setFlowEdges]);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (!selectedNodeId || !flowInstance.current) return;

    // Direct check if selectedNodeId is on canvas (unit node)
    let targetNode = flowInstance.current.getNode(selectedNodeId);

    // If not found directly, it might be a Position node -> find its parent Unit node
    if (!targetNode) {
      const allNodesById = new Map(nodes.map((n) => [n.id, n]));
      const unitNodes = nodes.filter((n) => (n.category ?? 'unit') !== 'position');
      const unitNodeIds = new Set(unitNodes.map((n) => n.id));
      const rawNode = allNodesById.get(selectedNodeId);
      if (rawNode) {
        let parentUnitId = rawNode.parentId;
        while (parentUnitId && !unitNodeIds.has(parentUnitId)) {
          parentUnitId = allNodesById.get(parentUnitId)?.parentId;
        }
        if (parentUnitId) {
          targetNode = flowInstance.current.getNode(parentUnitId);
        }
      }
    }

    if (targetNode) {
      void flowInstance.current.setCenter(
        targetNode.position.x + 128,
        targetNode.position.y + 75,
        { zoom: 0.95, duration: 350 },
      );
    }
  }, [nodes, selectedNodeId]);

  const handleApplyLayout = (direction: LayoutDirection) => {
    const allNodesById = new Map(nodes.map((node) => [node.id, node]));
    const unitNodes = nodes.filter((n) => (n.category ?? 'unit') !== 'position');
    const unitNodeIds = new Set(unitNodes.map((n) => n.id));
    const effectiveUnitNodes: LayoutNode[] = unitNodes.map((u) => {
      let effectiveParentId = u.parentId;
      while (effectiveParentId && !unitNodeIds.has(effectiveParentId)) {
        effectiveParentId = allNodesById.get(effectiveParentId)?.parentId;
      }
      return {
        ...u,
        parentId: effectiveParentId,
      };
    });
    const freshPositions = calculateHierarchicalLayout(effectiveUnitNodes, direction);
    dispatch(
      cacheLayout({
        key: layoutCacheKey,
        positions: freshPositions,
      }),
    );
    setFlowNodes((prev) =>
      prev.map((n) => ({
        ...n,
        position: freshPositions[n.id] ?? n.position,
        data: {
          ...n.data,
          layoutDirection: direction,
        },
      })),
    );
    setTimeout(() => {
      void flowInstance.current?.fitView({
        padding: 0.15,
        minZoom: 0.25,
        maxZoom: 0.85,
        duration: 400,
      });
    }, 60);
  };

  const handleAutoLayout = () => {
    handleApplyLayout(layoutDirection);
    setMoveMessage(
      'Đã tự động sắp xếp sơ đồ gọn gàng — bấm "Lưu vị trí" để ghi vào hệ thống.',
    );
  };

  const handleToggleDirection = () => {
    const nextDirection: LayoutDirection =
      layoutDirection === 'horizontal' ? 'vertical' : 'horizontal';
    setLayoutDirection(nextDirection);
    handleApplyLayout(nextDirection);
    setMoveMessage(
      nextDirection === 'horizontal'
        ? 'Đã chuyển sang bố cục Phân tầng Ngang (Trục Y) — bấm "Lưu vị trí" để ghi nhận.'
        : 'Đã chuyển sang bố cục Phân tầng Dọc (Trục X) — bấm "Lưu vị trí" để ghi nhận.',
    );
  };

  if (!nodes.length)
    return (
      <div className="grid h-full min-h-0 w-full place-items-center text-sm text-slate-500">
        Chưa có node trong sơ đồ này.
      </div>
    );
  return (
    <div ref={wrapperRef} className="relative h-full min-h-0 w-full overflow-hidden bg-white">
      {/* Canvas Floating Toolbar: Chuyển đổi hướng trục Y/X, Nút MiniMap & Nút Sắp xếp */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowMiniMap((prev) => !prev)}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-sm backdrop-blur transition-all cursor-pointer ${
            showMiniMap
              ? 'border-blue-300 bg-blue-50/90 text-blue-700'
              : 'border-slate-200 bg-white/95 text-slate-700 hover:bg-slate-50 hover:border-slate-300 hover:text-blue-700'
          }`}
          title={showMiniMap ? 'Ẩn bản đồ thu nhỏ (MiniMap)' : 'Hiện bản đồ thu nhỏ (MiniMap)'}
        >
          <MapIcon className="size-3.5 text-blue-600" />
          <span>Bản đồ</span>
        </button>

        <button
          type="button"
          onClick={handleToggleDirection}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/95 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur hover:bg-slate-50 hover:border-slate-300 hover:text-blue-700 transition-all cursor-pointer"
          title={
            layoutDirection === 'horizontal'
              ? 'Đang ở dạng Phân tầng Ngang (Trục Y) - Nhấp để chuyển sang Phân tầng Dọc (Trục X)'
              : 'Đang ở dạng Phân tầng Dọc (Trục X) - Nhấp để chuyển sang Phân tầng Ngang (Trục Y)'
          }
        >
          <ArrowRightLeft className="size-3.5 text-blue-600" />
          <span>
            Bố cục: {layoutDirection === 'horizontal' ? 'Trục Y (Ngang)' : 'Trục X (Dọc)'}
          </span>
        </button>

        <button
          type="button"
          onClick={handleAutoLayout}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/95 px-3 py-1.5 text-xs font-semibold text-blue-700 shadow-sm backdrop-blur hover:bg-blue-50 hover:border-blue-300 transition-all cursor-pointer"
          title="Tự động căn chỉnh và sắp xếp lại các node thẳng hàng, đẹp mắt"
        >
          <Sparkles className="size-3.5 text-blue-600" />
          <span>Sắp xếp</span>
        </button>
      </div>

      <ReactFlow
        className={styles.flow}
        nodes={flowNodes}
        edges={flowEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        fitViewOptions={{ padding: 0.15, minZoom: 0.25, maxZoom: 0.85 }}
        maxZoom={2.5}
        minZoom={0.15}
        nodeTypes={flowNodeTypes}
        nodesConnectable={false}
        nodesDraggable
        onInit={(instance) => {
          flowInstance.current = instance;
          const allNodesById = new Map(nodes.map((node) => [node.id, node]));
          const unitNodes = nodes.filter((n) => (n.category ?? 'unit') !== 'position');
          const unitNodeIds = new Set(unitNodes.map((n) => n.id));
          const effectiveUnitNodes: LayoutNode[] = unitNodes.map((u) => {
            let effectiveParentId = u.parentId;
            while (effectiveParentId && !unitNodeIds.has(effectiveParentId)) {
              effectiveParentId = allNodesById.get(effectiveParentId)?.parentId;
            }
            return {
              ...u,
              parentId: effectiveParentId,
            };
          });
          const automaticPositions: FlowPositions = calculateHierarchicalLayout(effectiveUnitNodes);
          const positions = cachedLayout?.positions ?? automaticPositions;
          if (!cachedLayout) {
            dispatch(initializeLayout({ key: layoutCacheKey, positions }));
          }

          requestAnimationFrame(() => {
            void instance.fitView({
              padding: 0.15,
              minZoom: 0.25,
              maxZoom: 0.85,
              duration: 350,
            });
          });
        }}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        panOnDrag
        proOptions={{ hideAttribution: true }}
      >
        <Background
          color="#cbd5e1"
          gap={24}
          size={1}
          variant={BackgroundVariant.Dots}
        />
        <Controls showInteractive={false} />
        {showMiniMap ? (
          <MiniMap
            className={styles.minimap}
            nodeStrokeColor="#94a3b8"
            nodeColor={(n) => {
              const d = n.data as FlowData | undefined;
              if (d?.isSelected) return '#2563eb';
              if (d?.isHighlighted) return '#f59e0b';
              if (d?.isRoot) return '#ef4444';
              return '#e2e8f0';
            }}
            nodeBorderRadius={4}
            maskColor="rgba(241, 245, 249, 0.7)"
            pannable
            zoomable
          />
        ) : null}
      </ReactFlow>
      <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
        <div className="rounded-full border border-slate-200 bg-white/95 px-3.5 py-2 text-xs font-medium text-slate-600 shadow-sm backdrop-blur">
          {moveMessage ??
            'Kéo bằng biểu tượng ⋮⋮ để sắp xếp — chưa thay đổi dữ liệu hệ thống'}
        </div>
      </div>
    </div>
  );
}

function bySortOrder(left: OrganizationNode, right: OrganizationNode) {
  return (
    (left.sortOrder ?? 0) - (right.sortOrder ?? 0) ||
    left.name.localeCompare(right.name, 'vi')
  );
}

function localDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
