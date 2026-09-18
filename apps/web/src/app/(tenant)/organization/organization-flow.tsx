'use client';

import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
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
import { GripVertical, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  cacheLayout,
  initializeLayout,
  useAppDispatch,
  useAppSelector,
  type FlowPositions,
} from '@/store/organization-layout-store';
import styles from './organization-workspace.module.css';

type OrganizationNode = {
  id: string;
  treeId: string;
  parentId?: string;
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
  childUnitCount: number;
  childPersonnelCount: number;
  assigneeNames: string[];
  onSelect: (node: OrganizationNode) => void;
  onEdit: (node: OrganizationNode) => void;
  onAddChild: (node: OrganizationNode) => void;
};

function OrganizationFlowNode({ data }: NodeProps<Node<FlowData>>) {
  const isUnit = (data.node.category ?? data.type?.category ?? 'unit') === 'unit';
  const nameLower = data.node.name.toLowerCase();

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
    const raw = data.node.name.trim();
    if (raw.length <= 3) return raw.toUpperCase();
    const parts = raw.split(/\s+/);
    if (parts.length === 1) return raw.slice(0, 2).toUpperCase();
    return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase();
  }, [data.node.name]);

  const isSelected = data.isSelected;

  return (
    <div
      onClick={() => data.onSelect(data.node)}
      className={`relative w-64 rounded-xl border border-slate-200 border-t-4 bg-white p-3.5 shadow-sm transition-all cursor-pointer ${accentColor} ${
        isSelected
          ? 'ring-2 ring-blue-500 ring-offset-2 shadow-[0_8px_25px_rgba(37,99,235,0.22)]'
          : 'hover:shadow-md hover:border-slate-300'
      }`}
    >
      <Handle
        className="!size-2 !border-2 !border-slate-400 !bg-white"
        position={Position.Top}
        type="target"
      />

      {/* Top drag bar */}
      <div
        className="organization-drag-handle flex cursor-grab items-center justify-between gap-1 pb-1.5 active:cursor-grabbing"
        title="Kéo node để điều chỉnh vị trí"
      >
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          {data.type?.name ?? (isUnit ? 'Đơn vị' : 'Chức danh')}
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

      {/* Center content matching sketch */}
      <div className="flex flex-col items-center text-center pt-0.5 pb-1">
        {/* Avatar circle */}
        <div className="grid size-9 place-items-center rounded-full bg-slate-100 border border-slate-200 text-xs font-bold text-slate-700 shadow-xs">
          {initials}
        </div>

        {/* Node Name */}
        <h4 className="mt-2 text-sm font-bold text-slate-900 leading-snug line-clamp-2" title={data.node.name}>
          {data.node.name}
        </h4>

        {/* Role subtitle / assignees or type */}
        <p className="mt-0.5 text-xs text-slate-500 line-clamp-1">
          {data.assigneeNames.length > 0 ? data.assigneeNames.join(', ') : (data.type?.name ?? '—')}
        </p>

        {/* Code / MSNV */}
        <span className="mt-1 font-mono text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
          {data.node.code}
        </span>

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

      {/* Add Child button (+) at bottom right */}
      {isUnit ? (
        <button
          aria-label={`Thêm node con cho ${data.node.name}`}
          className="nodrag nopan absolute -bottom-2.5 -right-2.5 grid size-6 place-items-center rounded-full border-2 border-white bg-blue-600 text-white shadow-md transition-colors hover:bg-blue-700"
          onClick={(event) => {
            event.stopPropagation();
            data.onAddChild(data.node);
          }}
          type="button"
          title="Thêm node con trực thuộc"
        >
          <Plus className="size-3.5" />
        </button>
      ) : null}

      <Handle
        className="!size-2 !border-2 !border-slate-400 !bg-white"
        position={Position.Bottom}
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
  const flow = useMemo(() => {
    const nodeIds = new Set(nodes.map((node) => node.id));
    const roots = nodes
      .filter((node) => !node.parentId || !nodeIds.has(node.parentId))
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
    const children = new Map<string, OrganizationNode[]>();
    for (const node of nodes) {
      if (node.parentId && nodeIds.has(node.parentId)) {
        children.set(node.parentId, [
          ...(children.get(node.parentId) ?? []),
          node,
        ]);
      }
    }
    children.forEach((items) => items.sort(bySortOrder));
    const positions = new Map<string, { x: number; y: number }>();
    const visited = new Set<string>();
    let leafIndex = 0;
    const place = (node: OrganizationNode, level: number): number => {
      if (visited.has(node.id))
        return positions.get(node.id)?.x ?? leafIndex * 340;
      visited.add(node.id);
      const descendants = (children.get(node.id) ?? []).filter(
        (child) => !visited.has(child.id),
      );
      let x: number;
      if (!descendants.length) {
        x = leafIndex * 340;
        leafIndex += 1;
      } else {
        const childPositions = descendants.map((child) =>
          place(child, level + 1),
        );
        x = (childPositions[0] + childPositions[childPositions.length - 1]) / 2;
      }
      positions.set(node.id, { x, y: level * 210 });
      return x;
    };
    roots.forEach((root) => {
      place(root, 0);
      leafIndex += 0.5;
    });
    nodes
      .filter((node) => !visited.has(node.id))
      .forEach((node) => place(node, 0));
    const xs = [...positions.values()].map((position) => position.x);
    const firstRoot = roots[0];
    const firstRootX = firstRoot ? positions.get(firstRoot.id)?.x : undefined;
    const centerOffset =
      firstRootX !== undefined
        ? firstRootX
        : xs.length
          ? (Math.min(...xs) + Math.max(...xs)) / 2
          : 0;
    positions.forEach((position, id) =>
      positions.set(id, { ...position, x: position.x - centerOffset }),
    );
    const flowNodes: Node<FlowData>[] = nodes.map((node) => ({
      id: node.id,
      type: 'organization',
      dragHandle: '.organization-drag-handle',
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      data: {
        node,
        type: node.nodeTypeId ? nodeTypes.get(node.nodeTypeId) : undefined,
        isRoot: rootIds.has(node.id),
        isSelected: node.id === selectedNodeId,
        childUnitCount: (children.get(node.id) ?? []).filter(
          (child) =>
            (child.category ??
              (child.nodeTypeId ? nodeTypes.get(child.nodeTypeId)?.category : undefined) ??
              'unit') === 'unit',
        ).length,
        childPersonnelCount: new Set(
          (children.get(node.id) ?? [])
            .filter(
              (child) =>
                (child.category ??
                  (child.nodeTypeId ? nodeTypes.get(child.nodeTypeId)?.category : undefined)) ===
                'position',
            )
            .flatMap((posNode) =>
              (assigneesByNode.get(posNode.id) ?? []).map((a) => a.userId),
            ),
        ).size,
        assigneeNames: (assigneesByNode.get(node.id) ?? [])
          .map((assignment) => userNames.get(assignment.userId))
          .filter((name): name is string => Boolean(name)),
        onSelect: (n) => onSelectNode?.(n.id),
        onEdit,
        onAddChild,
      },
    }));
    const edges: Edge[] = nodes.flatMap((node) => {
      if (!node.parentId || !nodeIds.has(node.parentId)) return [];
      return [
        {
          id: `${node.parentId}-${node.id}`,
          source: node.parentId,
          target: node.id,
          type: 'smoothstep',
          style: { stroke: '#94a3b8', strokeWidth: 1.4 },
        },
      ];
    });
    return { flowNodes, edges };
  }, [assignments, nodes, nodeTypes, onAddChild, onEdit, onSelectNode, selectedNodeId, users]);
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

  // Child mapping to easily find all descendants of any node
  const childrenMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const node of nodes) {
      if (node.parentId) {
        const list = map.get(node.parentId) ?? [];
        list.push(node.id);
        map.set(node.parentId, list);
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
          posMap.get(node.id) ??
          initialPositions[node.id] ??
          node.position;
        return {
          ...node,
          position,
        };
      });
    });
  }, [flow.flowNodes, cachedLayout, initialPositions, setFlowNodes]);

  useEffect(() => {
    setFlowEdges(flow.edges);
  }, [flow.edges, setFlowEdges]);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (!selectedNodeId || !flowInstance.current) return;
    const node = flowInstance.current.getNode(selectedNodeId);
    if (node) {
      void flowInstance.current.setCenter(
        node.position.x + 128,
        node.position.y + 75,
        { zoom: 0.95, duration: 350 },
      );
    }
  }, [selectedNodeId]);

  if (!nodes.length)
    return (
      <div className="grid h-full min-h-0 w-full place-items-center text-sm text-slate-500">
        Chưa có node trong sơ đồ này.
      </div>
    );
  return (
    <div ref={wrapperRef} className="relative h-full min-h-0 w-full overflow-hidden bg-white">
      <ReactFlow
        className={styles.flow}
        nodes={flowNodes}
        edges={flowEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        fitViewOptions={{ padding: 0.2, minZoom: 0.72, maxZoom: 0.95 }}
        maxZoom={2.5}
        minZoom={0.2}
        nodeTypes={flowNodeTypes}
        nodesConnectable={false}
        nodesDraggable
        onInit={(instance) => {
          flowInstance.current = instance;
          const automaticPositions: FlowPositions = Object.fromEntries(
            flow.flowNodes.map((node) => [node.id, node.position] as const),
          );
          const positions = cachedLayout?.positions ?? {
            ...automaticPositions,
            ...initialPositions,
          };
          if (!cachedLayout) {
            dispatch(initializeLayout({ key: layoutCacheKey, positions }));
          }
          // Mặc định hiển thị tối đa 8 node đầu tiên và đặt node gốc lên cao gần sát lề trên
          const firstEightNodes = flow.flowNodes.slice(0, 8);
          const primaryRootNode =
            flow.flowNodes.find((n) => n.data.isRoot) ?? flow.flowNodes[0];

          requestAnimationFrame(() => {
            void instance.fitView({
              nodes: firstEightNodes.length > 0 ? firstEightNodes : undefined,
              padding: 0.2,
              minZoom: 0.72,
              maxZoom: 0.95,
            });

            if (primaryRootNode) {
              const targetNode =
                instance.getNode(primaryRootNode.id) ?? primaryRootNode;
              setTimeout(() => {
                const currentZoom = Math.min(Math.max(instance.getZoom(), 0.75), 0.92);
                const containerWidth = wrapperRef.current?.clientWidth || 800;
                const topPadding = 36; // Đặt node gốc lên cao gần sát lề trên (cách lề trên 36px)

                // Tính toán viewport để node gốc nằm ở giữa theo chiều ngang và gần sát lề trên
                const viewportX = containerWidth / 2 - (targetNode.position.x + 128) * currentZoom;
                const viewportY = topPadding - targetNode.position.y * currentZoom;

                void instance.setViewport(
                  { x: viewportX, y: viewportY, zoom: currentZoom },
                  { duration: 250 },
                );
              }, 60);
            }
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
