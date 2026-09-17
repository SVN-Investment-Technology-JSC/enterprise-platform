'use client';

import {
  ArrowLeft,
  Building2,
  ChevronRight,
  GitBranch,
  Pencil,
  Plus,
  Save,
  UserPlus,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import {
  markLayoutSaved,
  useAppDispatch,
  useAppSelector,
  setSnapshot,
  updateNode,
  addNode,
  removeNode,
  updateTree,
  addTree,
  removeTree,
  updateNodeType,
  addNodeType,
  removeNodeType,
  updateAssignment,
  addAssignment,
  removeAssignment,
  type Tree,
  type Node,
  type NodeType,
  type Assignment,
  type OrganizationSnapshot,
} from '@/store/organization-layout-store';
import { OrganizationFlow } from './organization-flow';
import { OrganizationTreeTable } from './organization-tree-table';
import { OrganizationTreeOutline } from './organization-tree-outline';
import { OrganizationNodeInspector } from './organization-node-inspector';
import { OrganizationNodeTypeTable } from './organization-node-type-table';
import { OrganizationAssignmentTable } from './organization-assignment-table';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

export type {
  Tree,
  NodeType,
  Node,
  Assignment,
  OrganizationSnapshot,
};
type Resource = 'trees' | 'node-types' | 'nodes' | 'assignments';
type Editor = {
  resource: Resource;
  item?: Tree | NodeType | Node | Assignment;
  parentId?: string;
};
const csrf = () =>
  decodeURIComponent(
    document.cookie
      .split('; ')
      .find((x) => x.startsWith('ep_csrf='))
      ?.split('=')
      .slice(1)
      .join('=') ?? '',
  );
const field =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

export function OrganizationWorkspace({
  initialSnapshot,
  loadError,
  tenantSlug,
}: {
  initialSnapshot: OrganizationSnapshot;
  loadError?: string;
  tenantSlug: string;
}) {
  const dispatch = useAppDispatch();
  const reduxSnapshot = useAppSelector(
    (state) => state.organizationData.snapshot,
  );

  // Initialize Redux store cache with initialSnapshot on mount
  useEffect(() => {
    dispatch(setSnapshot(initialSnapshot));
  }, [initialSnapshot, dispatch]);

  const snapshot = reduxSnapshot ?? initialSnapshot;

  const syncSnapshotWithServer = async () => {
    try {
      const res = await fetch(
        '/api/platform/v1/tenant-organization/core-snapshot',
        { credentials: 'same-origin' },
      );
      if (res.ok) {
        const fresh = (await res.json()) as OrganizationSnapshot;
        dispatch(setSnapshot(fresh));
      }
    } catch {
      // background sync ignore
    }
  };

  const [tab, setTab] = useState<'tree' | 'type' | 'assignment'>('tree');
  const [treeViewMode, setTreeViewMode] = useState<'table' | 'workspace'>('table');
  const [treeId, setTreeId] = useState(
    () =>
      initialSnapshot.trees.find((x) => x.isPrimary)?.id ??
      initialSnapshot.trees[0]?.id,
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(() => {
    const primaryTreeId =
      initialSnapshot.trees.find((x) => x.isPrimary)?.id ??
      initialSnapshot.trees[0]?.id;
    const initialNodes = initialSnapshot.nodes.filter(
      (x) => x.treeId === primaryTreeId,
    );
    const root = initialNodes.find((x) => !x.parentId) ?? initialNodes[0];
    return root?.id;
  });
  const [editor, setEditor] = useState<Editor>();
  const [error, setError] = useState(loadError);
  const [layoutSaving, setLayoutSaving] = useState(false);

  useEffect(() => {
    if (treeId && !snapshot.trees.some((x) => x.id === treeId)) {
      const fallback =
        snapshot.trees.find((x) => x.isPrimary) ?? snapshot.trees[0];
      setTreeId(fallback?.id);
      setTreeViewMode('table');
    }
  }, [snapshot.trees, treeId]);

  useEffect(() => {
    if (selectedNodeId && !snapshot.nodes.some((x) => x.id === selectedNodeId)) {
      const treeNodes = snapshot.nodes.filter((x) => x.treeId === treeId);
      const root = treeNodes.find((x) => !x.parentId) ?? treeNodes[0];
      setSelectedNodeId(root?.id);
    }
  }, [snapshot.nodes, selectedNodeId, treeId]);

  const isWorkspaceDetail = tab === 'tree' && treeViewMode === 'workspace';
  const tree = snapshot.trees.find((x) => x.id === treeId);
  const nodes = snapshot.nodes.filter((x) => x.treeId === treeId);
  const layoutCacheKey = `organization-layout:${tenantSlug}:${treeId ?? 'none'}`;
  const cachedLayout = useAppSelector(
    (state) => state.organizationLayouts.layouts[layoutCacheKey],
  );
  const types = useMemo(
    () => new Map(snapshot.nodeTypes.map((x) => [x.id, x])),
    [snapshot.nodeTypes],
  );
  const handleOpenTree = (id: string) => {
    setTreeId(id);
    const treeNodes = snapshot.nodes.filter((x) => x.treeId === id);
    const root = treeNodes.find((x) => !x.parentId) ?? treeNodes[0];
    setSelectedNodeId(root?.id);
    setTreeViewMode('workspace');
  };
  const handleSaveNodeDirect = async (
    nodeId: string,
    data: Partial<Node>,
  ) => {
    const item = snapshot.nodes.find((n) => n.id === nodeId);
    if (!item) return;
    // 1. Instantly update Redux store (Optimistic cache update)
    dispatch(updateNode({ id: nodeId, changes: data }));
    // 2. Persist to API
    await save('nodes', item, data as Record<string, unknown>);
  };
  async function save(
    resource: Resource,
    item: Editor['item'] | undefined,
    data: Record<string, unknown>,
  ) {
    setError(undefined);
    let res: Response;
    try {
      res = await fetch(
        `/api/platform/v1/tenant-organization/${resource}${item ? `/${item.id}` : ''}`,
        {
          method: item ? 'PATCH' : 'POST',
          credentials: 'same-origin',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrf(),
          },
          body: JSON.stringify(data),
        },
      );
    } catch {
      const msg = 'Không thể kết nối API để lưu dữ liệu.';
      setError(msg);
      toast.error(msg);
      void syncSnapshotWithServer();
      return;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = Array.isArray(body.message)
        ? body.message.join(' ')
        : (body.message ?? 'Không thể lưu dữ liệu.');
      setError(msg);
      toast.error(msg);
      void syncSnapshotWithServer();
      return;
    }

    setEditor(undefined);

    if (resource === 'nodes') {
      const nodeName =
        (data.name as string) ||
        (item && 'name' in item ? item.name : '') ||
        '';
      if (item) {
        dispatch(updateNode({ id: item.id, changes: { ...data, ...body } }));
        toast.success(`Đã cập nhật node "${nodeName}" thành công!`);
      } else {
        dispatch(addNode(body));
        toast.success(`Đã tạo node "${nodeName}" thành công!`);
        if (body?.id) {
          setSelectedNodeId(body.id);
        }
      }
    } else if (resource === 'trees') {
      const treeName =
        (data.name as string) ||
        (item && 'name' in item ? item.name : '') ||
        '';
      if (item) {
        dispatch(updateTree({ id: item.id, changes: { ...data, ...body } }));
        toast.success(`Đã cập nhật sơ đồ "${treeName}" thành công!`);
      } else {
        dispatch(addTree(body));
        toast.success(`Đã tạo sơ đồ "${treeName}" thành công!`);
        if (body?.id) {
          setTreeId(body.id);
        }
      }
    } else if (resource === 'node-types') {
      const typeName =
        (data.name as string) ||
        (item && 'name' in item ? item.name : '') ||
        '';
      if (item) {
        dispatch(updateNodeType({ id: item.id, changes: { ...data, ...body } }));
        toast.success(`Đã cập nhật loại node "${typeName}" thành công!`);
      } else {
        dispatch(addNodeType(body));
        toast.success(`Đã tạo loại node "${typeName}" thành công!`);
      }
    } else if (resource === 'assignments') {
      if (item) {
        dispatch(updateAssignment({ id: item.id, changes: { ...data, ...body } }));
        toast.success('Đã cập nhật bổ nhiệm thành công!');
      } else {
        dispatch(addAssignment(body));
        toast.success('Đã thêm bổ nhiệm mới thành công!');
      }
    } else {
      toast.success('Lưu dữ liệu thành công!');
    }

    void syncSnapshotWithServer();
  }
  async function remove(resource: Resource, item: Editor['item']) {
    if (
      !item ||
      !confirm('Xóa mềm bản ghi này? Dữ liệu lịch sử vẫn được giữ lại.')
    )
      return;
    try {
      const res = await fetch(
        `/api/platform/v1/tenant-organization/${resource}/${item.id}`,
        {
          method: 'DELETE',
          credentials: 'same-origin',
          headers: { 'x-csrf-token': csrf() },
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = Array.isArray(body.message)
          ? body.message.join(' ')
          : (body.message ?? 'Không thể xóa.');
        setError(msg);
        toast.error(msg);
        return;
      }

      const itemName = item && 'name' in item ? item.name : '';
      if (resource === 'nodes') {
        dispatch(removeNode(item.id));
        toast.success(`Đã xóa node "${itemName}" thành công!`);
        if (selectedNodeId === item.id) {
          setSelectedNodeId(undefined);
        }
      } else if (resource === 'trees') {
        dispatch(removeTree(item.id));
        toast.success(`Đã xóa sơ đồ "${itemName}" thành công!`);
        if (treeId === item.id) {
          setTreeViewMode('table');
        }
      } else if (resource === 'node-types') {
        dispatch(removeNodeType(item.id));
        toast.success(`Đã xóa loại node "${itemName}" thành công!`);
      } else if (resource === 'assignments') {
        dispatch(removeAssignment(item.id));
        toast.success('Đã xóa bổ nhiệm thành công!');
      } else {
        toast.success('Đã xóa thành công!');
      }

      void syncSnapshotWithServer();
    } catch {
      const msg = 'Không thể kết nối API để xóa.';
      setError(msg);
      toast.error(msg);
    }
  }
  async function saveTreeLayout() {
    if (!tree || !cachedLayout?.positions || !cachedLayout.dirty) return;
    const savedRevision = cachedLayout.revision;
    setLayoutSaving(true);
    setError(undefined);
    try {
      const response = await fetch(
        `/api/platform/v1/tenant-organization/trees/${tree.id}/layout`,
        {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrf(),
          },
          body: JSON.stringify({ positions: cachedLayout.positions }),
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          Array.isArray(body.message)
            ? body.message.join(' ')
            : (body.message ?? 'Không thể lưu vị trí các node.'),
        );
      }
      dispatch(markLayoutSaved({ key: layoutCacheKey, revision: savedRevision }));
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Không thể kết nối API để lưu vị trí các node.';
      setError(message);
      throw new Error(message);
    } finally {
      setLayoutSaving(false);
    }
  }
  const open = (
    resource: Resource,
    item?: Editor['item'],
    parentId?: string,
  ) => {
    setEditor({ resource, item, parentId });
  };
  return (
    <>
      <main
        className={`flex flex-col h-[calc(100vh-4rem)] overflow-hidden ${isWorkspaceDetail
          ? 'p-3 sm:p-4'
          : 'p-4 sm:p-6'
          }`}
      >
        {!isWorkspaceDetail ? (
          <div className="shrink-0 mb-3">
            <nav className="mb-1.5 flex items-center text-xs sm:text-sm text-slate-500">
              <Link href="/dashboard">Tenant Portal</Link>
              <ChevronRight className="mx-1 size-4" />
              <span>Quản trị</span>
              <ChevronRight className="mx-1 size-4" />
              <span className="font-medium text-[#0d1c2d]">Sơ đồ tổ chức</span>
            </nav>
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                  Sơ đồ tổ chức
                </h1>
                <p className="mt-0.5 text-xs sm:text-sm text-slate-500">
                  Quản lý cấu trúc tổ chức trực tiếp trong dữ liệu lõi của tenant.
                </p>
              </div>
            </div>
          </div>
        ) : null}
        {error ? (
          <p className="shrink-0 mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        ) : null}
        {!isWorkspaceDetail ? (
          <div className="shrink-0 mb-3 flex gap-5 border-b border-slate-200">
            <Tab
              active={tab === 'tree'}
              icon={GitBranch}
              label="Cây tổ chức"
              onClick={() => setTab('tree')}
            />
            <Tab
              active={tab === 'type'}
              icon={Building2}
              label="Loại node"
              onClick={() => setTab('type')}
            />
            <Tab
              active={tab === 'assignment'}
              icon={UserPlus}
              label="Bổ nhiệm"
              onClick={() => setTab('assignment')}
            />
          </div>
        ) : null}
        {tab === 'tree' ? (
          treeViewMode === 'table' ? (
            <OrganizationTreeTable
              trees={snapshot.trees}
              nodes={snapshot.nodes}
              onOpenTree={handleOpenTree}
              onCreateTree={() => open('trees')}
              onEditTree={(t) => open('trees', t)}
              onDeleteTree={(t) => remove('trees', t)}
            />
          ) : (
            <div className="flex flex-1 flex-col gap-3 min-h-0 overflow-hidden">
              {/* Toolbar điều hướng & thông tin sơ đồ */}
              <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setTreeViewMode('table')}
                    className="cursor-pointer gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-900"
                  >
                    <ArrowLeft className="size-4" />
                  </Button>
                  <div className="h-5 w-px bg-slate-200" />
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-slate-900">
                        {tree?.name ?? 'Chưa chọn sơ đồ'}
                      </h2>
                      {tree?.isPrimary ? (
                        <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
                          CHÍNH
                        </span>
                      ) : null}
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                        {tree?.code}
                      </span>
                    </div>
                    {tree?.description ? (
                      <p className="line-clamp-1 text-xs text-slate-500">
                        {tree.description}
                      </p>
                    ) : null}
                  </div>
                </div>

                {tree ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      disabled={layoutSaving || !cachedLayout?.dirty}
                      onClick={() =>
                        void toast.promise(saveTreeLayout(), {
                          loading: 'Đang lưu vị trí các node...',
                          success: 'Đã lưu vị trí các node thành công!',
                          error: (error) =>
                            error instanceof Error
                              ? error.message
                              : 'Không thể lưu vị trí các node.',
                        })
                      }
                      size="sm"
                      title={
                        cachedLayout?.dirty
                          ? 'Lưu tọa độ hiện tại vào hệ thống'
                          : 'Chưa có thay đổi vị trí'
                      }
                      variant="outline"
                      className="text-xs"
                    >
                      <Save className="mr-1 size-3.5" />
                      {layoutSaving ? 'Đang lưu…' : 'Lưu vị trí'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => open('trees', tree)}
                      className="text-xs"
                    >
                      <Pencil className="mr-1 size-3.5" />
                      Sửa sơ đồ
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => open('nodes')}
                      className="bg-blue-600 text-xs text-white hover:bg-blue-700"
                    >
                      <Plus className="mr-1 size-3.5" />
                      Thêm node
                    </Button>
                  </div>
                ) : null}
              </div>

              {/* Bố cục 3 cột: Fit 100% viewport, thanh cuộn chỉ xuất hiện nội bộ từng card khi dài */}
              <div className="grid flex-1 min-h-0 grid-cols-1 gap-3 overflow-hidden xl:grid-cols-[280px_1fr_340px] 2xl:grid-cols-[300px_1fr_360px]">
                {/* Cột 1: Cây sơ đồ Nested Tree List / Outline */}
                <div className="h-full min-h-0 flex flex-col overflow-hidden">
                  <OrganizationTreeOutline
                    nodes={nodes}
                    nodeTypes={types}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={(nodeId) => setSelectedNodeId(nodeId)}
                    onAddChild={(node) => open('nodes', undefined, node.id)}
                    onEditNode={(node) => open('nodes', node)}
                    onDeleteNode={(node) => remove('nodes', node)}
                  />
                </div>

                {/* Cột 2: Canvas sơ đồ Flow */}
                <section className="h-full min-h-0 flex flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="relative h-full w-full flex-1 min-h-0">
                    <OrganizationFlow
                      key={treeId}
                      assignments={snapshot.assignments}
                      initialPositions={tree?.layout?.positions ?? {}}
                      layoutCacheKey={layoutCacheKey}
                      nodes={nodes}
                      nodeTypes={types}
                      selectedNodeId={selectedNodeId}
                      onSelectNode={(nodeId) => setSelectedNodeId(nodeId)}
                      onAddChild={(node) => open('nodes', undefined, node.id)}
                      onEdit={(node) => open('nodes', node)}
                      users={snapshot.users}
                    />
                  </div>
                </section>

                {/* Cột 3: Thuộc tính Chi tiết Node */}
                <div className="h-full min-h-0 flex flex-col overflow-hidden">
                  <OrganizationNodeInspector
                    selectedNode={nodes.find((x) => x.id === selectedNodeId)}
                    nodes={nodes}
                    nodeTypes={snapshot.nodeTypes}
                    assignments={snapshot.assignments}
                    users={snapshot.users}
                    onSaveNode={handleSaveNodeDirect}
                    onDeleteNode={(node) => remove('nodes', node)}
                    onAssignUser={(nodeId) => open('assignments', undefined, nodeId)}
                  />
                </div>
              </div>
            </div>
          )
        ) : null}
        {tab === 'type' ? (
          <OrganizationNodeTypeTable
            nodeTypes={snapshot.nodeTypes}
            onOpenCreate={() => open('node-types')}
            onEdit={(t) => open('node-types', t)}
            onDelete={(t) => remove('node-types', t)}
          />
        ) : null}
        {tab === 'assignment' ? (
          <OrganizationAssignmentTable
            assignments={snapshot.assignments}
            nodes={snapshot.nodes}
            users={snapshot.users}
            onOpenCreate={() => open('assignments')}
            onEdit={(a) => open('assignments', a)}
            onDelete={(a) => remove('assignments', a)}
          />
        ) : null}
      </main>
      <Sheet
        open={Boolean(editor)}
        onOpenChange={(x) => !x && setEditor(undefined)}
      >
        <SheetContent className="overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>
              {editor?.item ? 'Cập nhật' : 'Tạo mới'} dữ liệu tổ chức
            </SheetTitle>
            <SheetDescription>
              Lưu trực tiếp vào core_schema của tenant.
            </SheetDescription>
          </SheetHeader>
          {editor ? (
            <Form
              editor={editor}
              trees={snapshot.trees}
              types={snapshot.nodeTypes}
              nodes={snapshot.nodes}
              users={snapshot.users}
              selectedTreeId={treeId}
              onSave={save}
              onCancel={() => setEditor(undefined)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function Form({
  editor,
  trees,
  types,
  nodes,
  users,
  selectedTreeId,
  onSave,
  onCancel,
}: {
  editor: Editor;
  trees: Tree[];
  types: NodeType[];
  nodes: Node[];
  users: OrganizationSnapshot['users'];
  selectedTreeId?: string;
  onSave: (
    r: Resource,
    i: Editor['item'] | undefined,
    d: Record<string, unknown>,
  ) => Promise<void>;
  onCancel: () => void;
}) {
  const item = editor.item as Record<string, unknown> | undefined;
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<Record<string, unknown>>({
    name: item?.name ?? '',
    code: item?.code ?? '',
    description: item?.description ?? '',
    status: item?.status ?? 'active',
    isPrimary: item?.isPrimary ?? false,
    category: item?.category ?? 'unit',
    isActive: item?.isActive ?? true,
    sortOrder: item?.sortOrder ?? 0,
    treeId: item?.treeId ?? selectedTreeId ?? '',
    parentId: item?.parentId ?? editor.parentId ?? '',
    nodeTypeId: item?.nodeTypeId ?? types[0]?.id ?? '',
    nodeId: item?.nodeId ?? editor.parentId ?? '',
    userId: item?.userId ?? users[0]?.id ?? '',
    startDate: item?.startDate ?? '',
    endDate: item?.endDate ?? '',
    note: item?.note ?? '',
  });
  const set = (k: string, v: unknown) => setData((x) => ({ ...x, [k]: v }));
  const hasExistingRoot = useMemo(() => {
    if (editor.resource !== 'nodes') return false;
    return nodes.some(
      (x) =>
        x.treeId === data.treeId &&
        !x.parentId &&
        x.id !== editor.item?.id,
    );
  }, [editor.resource, editor.item?.id, data.treeId, nodes]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (editor.resource === 'nodes' && !data.parentId && hasExistingRoot) {
      toast.error(
        'Mỗi sơ đồ tổ chức chỉ được phép tạo 1 node gốc. Vui lòng chọn Node cha.',
      );
      return;
    }
    setBusy(true);
    try {
      await onSave(editor.resource, editor.item, data);
    } catch {
      // save() displays API errors; this keeps the form interactive on network failures.
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="space-y-4 p-4" onSubmit={submit}>
      {editor.resource === 'trees' ? (
        <>
          <Field label="Tên sơ đồ">
            <Input
              required
              value={String(data.name)}
              onChange={(e) => set('name', e.currentTarget.value)}
            />
          </Field>
          <Field label="Mã sơ đồ">
            <Input
              required
              value={String(data.code)}
              onChange={(e) => set('code', e.currentTarget.value)}
            />
          </Field>
          <Field label="Mô tả">
            <textarea
              className="min-h-20 w-full rounded-md border border-input p-3 text-sm"
              value={String(data.description)}
              onChange={(e) => set('description', e.currentTarget.value)}
            />
          </Field>
          <Check
            label="Đặt làm sơ đồ chính"
            checked={Boolean(data.isPrimary)}
            onChange={(v) => set('isPrimary', v)}
          />
        </>
      ) : null}
      {editor.resource === 'node-types' ? (
        <>
          <Field label="Tên loại node">
            <Input
              required
              value={String(data.name)}
              onChange={(e) => set('name', e.currentTarget.value)}
            />
          </Field>
          <Field label="Mã loại">
            <Input
              required
              value={String(data.code)}
              onChange={(e) => set('code', e.currentTarget.value.toUpperCase())}
            />
          </Field>
          <Field label="Nhóm">
            <select
              className={field}
              value={String(data.category)}
              onChange={(e) => set('category', e.currentTarget.value)}
            >
              <option value="unit">Đơn vị (UNIT)</option>
              <option value="position">Chức danh (POSITION)</option>
            </select>
          </Field>
          <Check
            label="Đang sử dụng"
            checked={Boolean(data.isActive)}
            onChange={(v) => set('isActive', v)}
          />
        </>
      ) : null}
      {editor.resource === 'nodes' ? (
        <>
          <Field label="Sơ đồ">
            <select
              className={field}
              value={String(data.treeId)}
              onChange={(e) => set('treeId', e.currentTarget.value)}
            >
              {trees.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Node cha">
            <select
              className={field}
              value={String(data.parentId)}
              onChange={(e) => set('parentId', e.currentTarget.value)}
            >
              <option value="" disabled={hasExistingRoot}>
                {hasExistingRoot
                  ? '— Đã có node gốc (Mỗi sơ đồ chỉ có 1 node gốc) —'
                  : 'Node gốc'}
              </option>
              {nodes
                .filter(
                  (x) => x.id !== editor.item?.id && x.treeId === data.treeId,
                )
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
            {hasExistingRoot ? (
              <p className="mt-1 text-[11px] text-amber-600">
                Sơ đồ này đã có node gốc. Mỗi sơ đồ chỉ được phép tạo 1 node gốc duy nhất.
              </p>
            ) : null}
          </Field>
          <Field label="Loại node">
            <select
              className={field}
              value={String(data.nodeTypeId)}
              onChange={(e) => set('nodeTypeId', e.currentTarget.value)}
            >
              {types
                .filter((x) => x.isActive)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({x.category})
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Tên node">
            <Input
              required
              value={String(data.name)}
              onChange={(e) => set('name', e.currentTarget.value)}
            />
          </Field>
          <Field label="Mã node">
            <Input
              required
              value={String(data.code)}
              onChange={(e) => set('code', e.currentTarget.value)}
            />
          </Field>
          <Field label="Thứ tự">
            <Input
              type="number"
              value={String(data.sortOrder)}
              onChange={(e) => set('sortOrder', Number(e.currentTarget.value))}
            />
          </Field>
        </>
      ) : null}
      {editor.resource === 'assignments' ? (
        <>
          <Field label="Chức danh">
            <select
              required
              className={field}
              value={String(data.nodeId)}
              onChange={(e) => set('nodeId', e.currentTarget.value)}
            >
              <option value="">Chọn chức danh</option>
              {nodes
                .filter(
                  (x) =>
                    types.find((t) => t.id === x.nodeTypeId)?.category ===
                    'position',
                )
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Người dùng">
            <select
              className={field}
              value={String(data.userId)}
              onChange={(e) => set('userId', e.currentTarget.value)}
            >
              {users.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.fullName}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Từ ngày">
              <Input
                type="date"
                value={String(data.startDate)}
                onChange={(e) => set('startDate', e.currentTarget.value)}
              />
            </Field>
            <Field label="Đến ngày">
              <Input
                type="date"
                value={String(data.endDate)}
                onChange={(e) => set('endDate', e.currentTarget.value)}
              />
            </Field>
          </div>
          <Field label="Ghi chú">
            <textarea
              className="min-h-20 w-full rounded-md border border-input p-3 text-sm"
              value={String(data.note)}
              onChange={(e) => set('note', e.currentTarget.value)}
            />
          </Field>
          <Check
            label="Vị trí chính"
            checked={Boolean(data.isPrimary)}
            onChange={(v) => set('isPrimary', v)}
          />
        </>
      ) : null}
      <Field label="Trạng thái">
        <select
          className={field}
          value={String(data.status)}
          onChange={(e) => set('status', e.currentTarget.value)}
        >
          <option value="active">Hoạt động</option>
          <option value="inactive">Không hoạt động</option>
          {editor.resource === 'assignments' ? (
            <option value="ended">Đã kết thúc</option>
          ) : (
            <option value="archived">Lưu trữ</option>
          )}
        </select>
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Hủy
        </Button>
        <Button
          type="submit"
          disabled={busy}
          className="bg-[#091426] hover:bg-[#1e293b]"
        >
          {busy ? 'Đang lưu…' : 'Lưu thay đổi'}
        </Button>
      </div>
    </form>
  );
}

function Tab({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Users;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium ${active ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500'}`}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (x: boolean) => void;
}) {
  return (
    <label className="flex gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      {label}
    </label>
  );
}
