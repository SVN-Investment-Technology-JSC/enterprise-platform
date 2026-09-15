'use client';

import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';
import { GripVertical, Plus, UserRound } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
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
  nodeTypeId: string;
  code: string;
  name: string;
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
  childUnitCount: number;
  childPositionCount: number;
  assigneeNames: string[];
  onEdit: (node: OrganizationNode) => void;
  onAddChild: (node: OrganizationNode) => void;
};

function OrganizationFlowNode({ data }: NodeProps<Node<FlowData>>) {
  const isUnit = data.type?.category === 'unit';
  const tone = data.isRoot
    ? 'border-[#102443] bg-[#102443] text-white'
    : isUnit
      ? 'border-blue-200 bg-white text-slate-900'
      : 'border-violet-200 bg-violet-50 text-violet-950';
  return (
    <div
      className={`relative w-56 rounded-xl border p-3.5 shadow-[0_2px_8px_rgba(15,23,42,0.08)] transition-all hover:shadow-[0_8px_20px_rgba(15,23,42,0.12)] ${tone}`}
    >
      <Handle
        className="!size-2 !border-2 !border-slate-400 !bg-white"
        position={Position.Top}
        type="target"
      />
      <div
        className="organization-drag-handle flex cursor-grab items-center justify-between gap-3 active:cursor-grabbing"
        title="Kéo node và thả lên một đơn vị để chuyển vị trí"
      >
        <span
          className={`text-[10px] font-bold uppercase tracking-[0.08em] ${data.isRoot ? 'text-blue-200' : isUnit ? 'text-blue-700' : 'text-violet-700'}`}
        >
          {data.type?.name ?? 'Node'}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className={`size-2 rounded-full ${data.node.status === 'active' ? 'bg-emerald-500' : 'bg-slate-300'}`}
          />
          <GripVertical
            aria-hidden="true"
            className={`size-4 ${data.isRoot ? 'text-blue-200' : 'text-slate-400'}`}
          />
        </span>
      </div>
      <button
        className="nodrag block w-full text-left"
        onClick={() => data.onEdit(data.node)}
        type="button"
      >
        <span className="mt-1.5 block text-[15px] font-semibold leading-5">
          {data.node.name}
        </span>
        <span
          className={`mt-1 block text-[11px] ${data.isRoot ? 'text-blue-200' : 'text-slate-500'}`}
        >
          {data.node.code}
        </span>
        {!isUnit && data.assigneeNames.length > 0 ? (
          <span
            className="mt-3 flex items-start gap-1.5 rounded-md bg-white/70 px-2 py-1.5 text-[11px] font-medium leading-4 text-violet-800"
            title={data.assigneeNames.join(', ')}
          >
            <UserRound className="mt-0.5 size-3.5 shrink-0" />
            <span className="line-clamp-2">
              {data.assigneeNames.join(', ')}
            </span>
          </span>
        ) : null}
        {isUnit && (data.childUnitCount > 0 || data.childPositionCount > 0) ? (
          <span className="mt-3 flex flex-wrap gap-1.5">
            {data.childUnitCount > 0 ? (
              <span
                className={`inline-flex rounded-md px-2 py-1 text-[10px] font-medium ${data.isRoot ? 'bg-white/10 text-blue-100' : 'bg-blue-50 text-blue-700'}`}
              >
                {data.childUnitCount} đơn vị trực thuộc
              </span>
            ) : null}
            {data.childPositionCount > 0 ? (
              <span
                className={`inline-flex rounded-md px-2 py-1 text-[10px] font-medium ${data.isRoot ? 'bg-violet-400/20 text-violet-100' : 'bg-violet-50 text-violet-700'}`}
              >
                {data.childPositionCount} nhân sự
              </span>
            ) : null}
          </span>
        ) : null}
      </button>
      {isUnit ? (
        <button
          aria-label={`Thêm node con cho ${data.node.name}`}
          className="nodrag nopan absolute -bottom-3 -right-3 grid size-7 place-items-center rounded-full border-2 border-white bg-blue-600 text-white shadow-md transition-colors hover:bg-blue-700"
          onClick={(event) => {
            event.stopPropagation();
            data.onAddChild(data.node);
          }}
          type="button"
        >
          <Plus className="size-4" />
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
  onEdit,
  onAddChild,
}: {
  nodes: OrganizationNode[];
  nodeTypes: Map<string, OrganizationNodeType>;
  assignments: OrganizationAssignment[];
  users: OrganizationUser[];
  initialPositions: FlowPositions;
  layoutCacheKey: string;
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
        return positions.get(node.id)?.x ?? leafIndex * 280;
      visited.add(node.id);
      const descendants = (children.get(node.id) ?? []).filter(
        (child) => !visited.has(child.id),
      );
      let x: number;
      if (!descendants.length) {
        x = leafIndex * 280;
        leafIndex += 1;
      } else {
        const childPositions = descendants.map((child) =>
          place(child, level + 1),
        );
        x = (childPositions[0] + childPositions[childPositions.length - 1]) / 2;
      }
      positions.set(node.id, { x, y: level * 170 });
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
    const centerOffset = xs.length
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
        type: nodeTypes.get(node.nodeTypeId),
        isRoot: rootIds.has(node.id),
        childUnitCount: (children.get(node.id) ?? []).filter(
          (child) => nodeTypes.get(child.nodeTypeId)?.category === 'unit',
        ).length,
        childPositionCount: (children.get(node.id) ?? []).filter(
          (child) => nodeTypes.get(child.nodeTypeId)?.category === 'position',
        ).length,
        assigneeNames: (assigneesByNode.get(node.id) ?? [])
          .map((assignment) => userNames.get(assignment.userId))
          .filter((name): name is string => Boolean(name)),
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
  }, [assignments, nodes, nodeTypes, onAddChild, onEdit, users]);
  const flowInstance = useRef<ReactFlowInstance<Node<FlowData>, Edge> | null>(
    null,
  );
  const dispatch = useAppDispatch();
  const cachedLayout = useAppSelector(
    (state) => state.organizationLayouts.layouts[layoutCacheKey],
  );
  const [moveMessage, setMoveMessage] = useState<string>();

  if (!nodes.length)
    return (
      <div className="grid min-h-[430px] place-items-center text-sm text-slate-500">
        Chưa có node trong sơ đồ này.
      </div>
    );
  return (
    <div className="relative h-[540px] overflow-hidden bg-white">
      <ReactFlow
        className={styles.flow}
        defaultNodes={flow.flowNodes}
        edges={flow.edges}
        fitView
        fitViewOptions={{ padding: 0.28, maxZoom: 1 }}
        maxZoom={1.25}
        minZoom={0.35}
        nodeTypes={flowNodeTypes}
        nodesConnectable={false}
        nodesDraggable
        onInit={(instance) => {
          flowInstance.current = instance;
          const automaticPositions: FlowPositions = Object.fromEntries(
            instance
              .getNodes()
              .map((node) => [node.id, node.position] as const),
          );
          const positions = cachedLayout?.positions ?? {
            ...automaticPositions,
            ...initialPositions,
          };
          if (!cachedLayout) {
            dispatch(initializeLayout({ key: layoutCacheKey, positions }));
          }
          instance.setNodes((currentNodes) =>
            currentNodes.map((node) => ({
              ...node,
              position: positions[node.id] ?? node.position,
            })),
          );
          requestAnimationFrame(
            () => void instance.fitView({ padding: 0.28, maxZoom: 1 }),
          );
        }}
        onNodeDragStart={() => setMoveMessage('Đang sắp xếp vị trí hiển thị…')}
        onNodeDragStop={() => {
          const currentNodes = flowInstance.current?.getNodes() ?? [];
          const positions: FlowPositions = Object.fromEntries(
            currentNodes.map((node) => [node.id, node.position] as const),
          );
          dispatch(cacheLayout({ key: layoutCacheKey, positions }));
          setMoveMessage(
            'Đã lưu tạm vị trí — bấm nút Lưu để ghi vào hệ thống.',
          );
        }}
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
        {nodes.length >= 5 ? (
          <MiniMap
            className={styles.minimap}
            maskColor="rgb(255 255 255 / 0.78)"
            nodeColor={(node) =>
              (node.data as FlowData).isRoot
                ? '#102443'
                : (node.data as FlowData).type?.category === 'position'
                  ? '#ddd6fe'
                  : '#bfdbfe'
            }
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
