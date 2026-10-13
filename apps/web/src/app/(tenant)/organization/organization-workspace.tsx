'use client';
import { useOrganizationPermissions } from './organization-permissions';

import { ArrowLeft, Pencil, Plus, Save } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/sonner';
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
import { useResizableWidth } from './use-resizable-width';
import { OrganizationNodeInspector } from './organization-node-inspector';
import { OrganizationAssignmentTable } from './organization-assignment-table';
import { OrganizationPositionTable } from './organization-position-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
type Resource = 'trees' | 'nodes' | 'assignments';
type Editor = {
  resource: Resource;
  item?: Tree | Node | Assignment;
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
export function OrganizationWorkspace({
  initialSnapshot,
  loadError,
  tenantSlug,
}: {
  initialSnapshot: OrganizationSnapshot;
  loadError?: string;
  tenantSlug: string;
}) {
  const { canCreate, canUpdate, canDelete } = useOrganizationPermissions();
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

  const [tab, setTab] = useState<'tree' | 'assignment' | 'position'>('tree');
  const [treeViewMode, setTreeViewMode] = useState<'table' | 'workspace'>('table');
  const [treeId, setTreeId] = useState(
    () =>
      initialSnapshot.trees.find((x) => x.isPrimary)?.id ??
      initialSnapshot.trees[0]?.id,
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  // Cột "Sơ đồ phân cấp" kéo thả được (nhớ độ rộng; nhấp đúp thanh chia để về mặc định).
  const outlineGridRef = useRef<HTMLDivElement>(null);
  const outlineResize = useResizableWidth(outlineGridRef, {
    storageKey: 'org-outline-width',
    initial: 340,
    min: 240,
    max: 520,
    cssVar: '--outline-w',
  });
  const [editor, setEditor] = useState<Editor>();
  const [, setError] = useState(loadError);
  const [layoutSaving, setLayoutSaving] = useState(false);

  const handleSelectNodeWithDrawer = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setIsDrawerOpen(true);
  };

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
      setSelectedNodeId(undefined);
      setIsDrawerOpen(false);
    }
  }, [snapshot.nodes, selectedNodeId]);

  const isWorkspaceDetail = tab === 'tree' && treeViewMode === 'workspace';
  const tree = snapshot.trees.find((x) => x.id === treeId);
  const nodes = snapshot.nodes.filter((x) => x.treeId === treeId);
  const selectedNode = nodes.find((x) => x.id === selectedNodeId);
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
    setSelectedNodeId(undefined);
    setIsDrawerOpen(false);
    setTreeViewMode('workspace');
  };
  const handleSaveNodeDirect = async (
    nodeId: string,
    data: Partial<Node>,
  ) => {
    if (!canUpdate) return;
    const item = snapshot.nodes.find((n) => n.id === nodeId);
    if (!item) return;
    // 1. Instantly update Redux store (Optimistic cache update)
    dispatch(updateNode({ id: nodeId, changes: data }));
    // 2. Persist to API
    await save('nodes', item, data as Record<string, unknown>);
  };
  const handleQuickAssign = async (
    nodeId: string,
    userId: string,
    isPrimary = false,
  ) => {
    return save('assignments', undefined, {
      nodeId,
      userId,
      isPrimary,
      status: 'active',
    }, { silent: true });
  };
  const handleQuickUnassign = async (assignmentId: string) => {
    const assignment = snapshot.assignments.find((a) => a.id === assignmentId);
    if (!assignment) return;
    return remove('assignments', assignment, { silent: true });
  };
  const handleSetPrimaryAssignment = async (
    assignmentId: string,
    nodeId: string,
  ) => {
    const nodeAssignments = snapshot.assignments.filter(
      (a) => a.nodeId === nodeId && a.status === 'active',
    );
    for (const a of nodeAssignments) {
      dispatch(
        updateAssignment({
          id: a.id,
          changes: { isPrimary: a.id === assignmentId },
        }),
      );
    }
    const target = nodeAssignments.find((a) => a.id === assignmentId);
    if (target) {
      await save('assignments', target, { isPrimary: true }, { silent: true });
    }
    const others = nodeAssignments.filter(
      (a) => a.id !== assignmentId && a.isPrimary,
    );
    for (const other of others) {
      await save('assignments', other, { isPrimary: false }, { silent: true });
    }
  };
  async function save(
    resource: Resource,
    item: Editor['item'] | undefined,
    data: Record<string, unknown>,
    options?: { silent?: boolean },
  ) {
    if (item ? !canUpdate : !canCreate) throw new Error('Không có quyền thao tác tổ chức.');
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
        if (!options?.silent) toast.success(`Đã cập nhật node "${nodeName}" thành công!`);
      } else {
        dispatch(addNode(body));
        if (!options?.silent) toast.success(`Đã tạo node "${nodeName}" thành công!`);
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
        if (!options?.silent) toast.success(`Đã cập nhật sơ đồ "${treeName}" thành công!`);
      } else {
        dispatch(addTree(body));
        if (!options?.silent) toast.success(`Đã tạo sơ đồ "${treeName}" thành công!`);
        if (body?.id) {
          setTreeId(body.id);
        }
      }
    } else if (resource === 'assignments') {
      if (item) {
        dispatch(updateAssignment({ id: item.id, changes: { ...data, ...body } }));
        if (!options?.silent) toast.success('Đã cập nhật bổ nhiệm thành công!');
      } else {
        dispatch(addAssignment(body));
        if (!options?.silent) toast.success('Đã thêm bổ nhiệm mới thành công!');
      }
    } else {
      if (!options?.silent) toast.success('Lưu dữ liệu thành công!');
    }

    void syncSnapshotWithServer();
    return body;
  }
  async function remove(
    resource: Resource,
    item: Editor['item'],
    options?: { silent?: boolean },
  ) {
    if (!item || !canDelete) return;
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
        if (!options?.silent) toast.success(`Đã xóa node "${itemName}" thành công!`);
        if (selectedNodeId === item.id) {
          setSelectedNodeId(undefined);
        }
      } else if (resource === 'trees') {
        dispatch(removeTree(item.id));
        if (!options?.silent) toast.success(`Đã xóa sơ đồ "${itemName}" thành công!`);
        if (treeId === item.id) {
          setTreeViewMode('table');
        }
      } else if (resource === 'assignments') {
        dispatch(removeAssignment(item.id));
        if (!options?.silent) toast.success('Đã xóa bổ nhiệm thành công!');
      } else {
        if (!options?.silent) toast.success('Đã xóa thành công!');
      }

      void syncSnapshotWithServer();
    } catch {
      const msg = 'Không thể kết nối API để xóa.';
      setError(msg);
      toast.error(msg);
    }
  }
  async function saveTreeLayout() {
    if (!canUpdate) throw new Error('Không có quyền lưu bố cục.');
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
    if (item ? !canUpdate : !canCreate) return;
    setEditor({ resource, item, parentId });
  };
  const positionCount = snapshot.nodes.filter(
    (x) => (x.category ?? (x.nodeTypeId ? types.get(x.nodeTypeId)?.category : undefined)) === 'position',
  ).length;
  return (
    <>
      <main
        className={`flex flex-col text-[14px] text-[#18181b] ${isWorkspaceDetail
          ? 'gap-3 xl:h-[calc(100dvh-6.5rem)]'
          : 'gap-4'
          }`}
      >
        {!isWorkspaceDetail ? (
          <div>
            <h1 className="m-0 text-[22px] font-bold tracking-[-0.3px]">Sơ đồ tổ chức</h1>
            <p className="mt-1 text-[13.5px] text-slate-600">
              Quản lý cấu trúc tổ chức trực tiếp trong dữ liệu lõi của tenant.
            </p>
          </div>
        ) : null}
        {/* {error ? (
          <p className="shrink-0 mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        ) : null} */}
        {!isWorkspaceDetail ? (
          <div
            role="tablist"
            aria-label="Sơ đồ tổ chức"
            className="flex flex-wrap gap-x-[22px] gap-y-1 border-b border-[#eef0f3]"
          >
            <Tab
              active={tab === 'tree'}
              count={snapshot.trees.length}
              label="Cây tổ chức"
              onClick={() => setTab('tree')}
            />
            <Tab
              active={tab === 'assignment'}
              count={snapshot.assignments.length}
              label="Bổ nhiệm"
              onClick={() => setTab('assignment')}
            />
            <Tab
              active={tab === 'position'}
              count={positionCount}
              label="Chức danh"
              onClick={() => setTab('position')}
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
            <div className="flex flex-1 flex-col gap-3 xl:min-h-0">
              {/* Toolbar điều hướng & thông tin sơ đồ */}
              <div className="shrink-0 flex flex-wrap items-center gap-3 rounded-[14px] border border-[#eef0f3] bg-white px-3.5 py-3">
                <button
                  type="button"
                  aria-label="Quay lại danh sách sơ đồ"
                  title="Quay lại danh sách sơ đồ"
                  onClick={() => setTreeViewMode('table')}
                  className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg border border-[#eef0f3] text-slate-700 hover:bg-[#f4f6f9]"
                >
                  <ArrowLeft className="size-4" />
                </button>
                <span aria-hidden className="hidden h-7 w-px bg-[#eef0f3] sm:block" />
                <div className="flex min-w-0 flex-[1_1_300px] flex-col">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="m-0 text-base font-bold">
                      {tree?.name ?? 'Chưa chọn sơ đồ'}
                    </h1>
                    {tree?.isPrimary ? (
                      <span className="rounded-[5px] bg-[#fff6d6] px-1.5 text-[10px] font-extrabold tracking-[0.4px] text-[#8a6400]">
                        CHÍNH
                      </span>
                    ) : null}
                    <span className="rounded-[5px] bg-[#f1f3f6] px-1.5 font-mono text-[11px] text-slate-700">
                      {tree?.code}
                    </span>
                  </div>
                  {tree?.description ? (
                    <p className="m-0 truncate text-[12.5px] text-slate-500">
                      {tree.description}
                    </p>
                  ) : null}
                </div>

                {tree ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      disabled={!canUpdate || layoutSaving || !cachedLayout?.dirty}
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
                      className="h-9 border-[#eef0f3] text-[13px] font-semibold"
                    >
                      <Save className="mr-1 size-3.5" />
                      {layoutSaving ? 'Đang lưu…' : 'Lưu vị trí'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canUpdate}
                      onClick={() => open('trees', tree)}
                      className="h-9 border-[#eef0f3] text-[13px] font-semibold"
                    >
                      <Pencil className="mr-1 size-3.5" />
                      Sửa sơ đồ
                    </Button>
                    <Button
                      size="sm"
                      disabled={!canCreate}
                      onClick={() => open('nodes')}
                      className="h-9 bg-[#ffc90a] text-[13px] font-bold text-[#18181b] hover:bg-[#ffd84d]"
                    >
                      <Plus className="mr-1 size-3.5" />
                      Thêm node
                    </Button>
                  </div>
                ) : null}
              </div>

              {/* Bố cục 2 cột: cây phân cấp (kéo thả đổi độ rộng) | canvas. Chi tiết node mở bằng ngăn kéo từ mép phải.
                  Màn rộng thì vừa khít khung nhìn; màn hẹp thì xếp dọc và cuộn cả trang. */}
              <div
                ref={outlineGridRef}
                style={{ ['--outline-w' as string]: `${outlineResize.width}px` }}
                className={`relative grid grid-cols-1 gap-3 xl:min-h-0 xl:flex-1 xl:grid-cols-[var(--outline-w)_minmax(0,1fr)] ${outlineResize.dragging ? 'select-none' : ''}`}
              >
                {/* Cột 1: Cây sơ đồ Nested Tree List / Outline */}
                <div className="flex h-[360px] min-h-0 flex-col overflow-hidden xl:h-full">
                  <OrganizationTreeOutline
                    nodes={nodes}
                    nodeTypes={types}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={handleSelectNodeWithDrawer}
                    onAddChild={(node) => open('nodes', undefined, node.id)}
                    onEditNode={(node) => open('nodes', node)}
                    onDeleteNode={(node) => remove('nodes', node)}
                  />
                </div>

                {/* Thanh chia kéo thả giữa hai cột (chỉ từ màn xl, khi hai cột nằm ngang) */}
                <div
                  {...outlineResize.handleProps}
                  aria-label="Kéo để đổi độ rộng cột Sơ đồ phân cấp (nhấp đúp để về mặc định)"
                  title="Kéo để đổi độ rộng; nhấp đúp để về mặc định"
                  style={{ left: 'var(--outline-w)' }}
                  className="group absolute inset-y-0 z-10 hidden w-3 cursor-col-resize touch-none items-center justify-center outline-none xl:flex"
                >
                  <span
                    aria-hidden="true"
                    className={`h-12 w-1 rounded-full transition-colors group-hover:bg-blue-400 group-focus-visible:bg-blue-500 ${
                      outlineResize.dragging ? 'bg-blue-500' : 'bg-slate-300'
                    }`}
                  />
                </div>

                {/* Cột 2: Canvas sơ đồ Flow toàn diện tích */}
                <section
                  aria-label="Canvas sơ đồ"
                  className="flex h-[560px] min-h-0 flex-col overflow-hidden rounded-[14px] border border-[#eef0f3] bg-white xl:h-full"
                >
                  <div className="relative h-full w-full flex-1 min-h-0">
                    <OrganizationFlow
                      key={treeId}
                      assignments={snapshot.assignments}
                      initialPositions={tree?.layout?.positions ?? {}}
                      layoutCacheKey={layoutCacheKey}
                      nodes={nodes}
                      nodeTypes={types}
                      selectedNodeId={selectedNodeId}
                      onSelectNode={handleSelectNodeWithDrawer}
                      onAddChild={(node) => open('nodes', undefined, node.id)}
                      onEdit={(node) => open('nodes', node)}
                      users={snapshot.users}
                    />
                  </div>
                </section>
              </div>

              {/* Drawer Chi tiết Node (trượt từ mép phải) */}
              <Sheet
                open={isDrawerOpen && Boolean(selectedNodeId)}
                onOpenChange={(openState: boolean) => {
                  setIsDrawerOpen(openState);
                  if (!openState) {
                    setSelectedNodeId(undefined);
                  }
                }}
              >
                <SheetContent
                  side="right"
                  className="!w-[595px] !max-w-[595px] p-0 overflow-hidden border-l border-slate-200 bg-white flex flex-col"
                  style={{ width: '595px', maxWidth: '595px' }}
                >
                  <SheetHeader className="sr-only">
                    <SheetTitle>Chi tiết Node Tổ chức</SheetTitle>
                    <SheetDescription>
                      Xem và cập nhật cấu hình node cùng danh sách nhân sự bổ nhiệm.
                    </SheetDescription>
                  </SheetHeader>
                  <div className="flex-1 min-h-0 h-full overflow-hidden flex flex-col">
                    <OrganizationNodeInspector
                      selectedNode={selectedNode}
                      nodes={nodes}
                      assignments={snapshot.assignments}
                      users={snapshot.users}
                      onSaveNode={handleSaveNodeDirect}
                      onDeleteNode={(node) => {
                        setIsDrawerOpen(false);
                        setSelectedNodeId(undefined);
                        remove('nodes', node);
                      }}
                      onAssignUser={(nodeId) => open('assignments', undefined, nodeId)}
                      onQuickAssign={handleQuickAssign}
                      onQuickUnassign={handleQuickUnassign}
                      onSetPrimaryAssignment={handleSetPrimaryAssignment}
                      onSelectNode={handleSelectNodeWithDrawer}
                    />
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          )
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
        {tab === 'position' ? <OrganizationPositionTable /> : null}
      </main>
      <Dialog
        open={Boolean(editor)}
        onOpenChange={(openState) => !openState && setEditor(undefined)}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto p-6">
          <DialogHeader>
            <DialogTitle>
              {editor?.item ? 'Cập nhật' : 'Tạo mới'}{' '}
              {editor?.resource === 'trees'
                ? 'sơ đồ tổ chức'
                : editor?.resource === 'nodes'
                  ? 'node tổ chức'
                  : 'bổ nhiệm nhân sự'}
            </DialogTitle>
            <DialogDescription>
              Lưu trực tiếp vào cơ sở dữ liệu của tenant.
            </DialogDescription>
          </DialogHeader>
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
        </DialogContent>
      </Dialog>
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
  const parentNode = nodes.find((n) => n.id === (item?.parentId ?? editor.parentId));
  const defaultCategory =
    item?.category ??
    (parentNode?.category === 'position'
      ? 'position'
      : types.find((t) => t.id === item?.nodeTypeId)?.category ?? 'unit');

  const [data, setData] = useState<Record<string, unknown>>({
    name: item?.name ?? '',
    code: item?.code ?? '',
    description: item?.description ?? '',
    status: item?.status ?? 'active',
    isPrimary: item?.isPrimary ?? false,
    category: defaultCategory,
    isActive: item?.isActive ?? true,
    sortOrder: item?.sortOrder ?? 0,
    treeId: item?.treeId ?? selectedTreeId ?? '',
    parentId: item?.parentId ?? editor.parentId ?? '',
    headPositionId: item?.headPositionId ?? '',
    nodeTypeId: item?.nodeTypeId ?? types.find((t) => t.category === defaultCategory)?.id ?? types[0]?.id ?? '',
    nodeId: item?.nodeId ?? editor.parentId ?? '',
    // Bổ nhiệm mới: không tự chọn người đầu danh sách, người dùng phải chủ động tìm và chọn.
    userId: item?.userId ?? '',
    startDate: item?.startDate ?? '',
    endDate: item?.endDate ?? '',
    note: item?.note ?? '',
  });
  const set = (k: string, v: unknown) => setData((x) => ({ ...x, [k]: v }));
  // Chức danh chọn được khi bổ nhiệm: nhãn là tên, mô tả gồm mã và đơn vị cha để phân biệt các chức danh trùng tên.
  const positionOptions = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return nodes
      .filter(
        (x) => types.find((t) => t.id === x.nodeTypeId)?.category === 'position',
      )
      .map((x) => ({
        value: x.id,
        label: x.name,
        description: [x.code, x.parentId ? byId.get(x.parentId)?.name : '']
          .filter(Boolean)
          .join(' · '),
      }));
  }, [nodes, types]);
  const userOptions = useMemo(
    () =>
      users.map((u) => ({
        value: u.id,
        label: u.email ? `${u.fullName} (${u.email})` : u.fullName,
      })),
    [users],
  );
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
    if (editor.resource === 'assignments' && (!data.nodeId || !data.userId)) {
      toast.error(
        !data.nodeId
          ? 'Vui lòng chọn chức danh để bổ nhiệm.'
          : 'Vui lòng chọn người dùng để bổ nhiệm.',
      );
      return;
    }
    setBusy(true);
    try {
      const payload = { ...data };
      if (editor.resource === 'nodes') {
        if (payload.category !== 'unit' || !payload.headPositionId) {
          payload.headPositionId = null;
        }
      }
      await onSave(editor.resource, editor.item, payload);
    } catch {
      // save() displays API errors; this keeps the form interactive on network failures.
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="space-y-4 pt-1" onSubmit={submit}>
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
      {editor.resource === 'nodes' ? (
        <>
          <SelectField label="Sơ đồ">
            <SearchableSelect
              clearable={false}
              value={String(data.treeId)}
              placeholder="Gõ tên sơ đồ để tìm"
              onChange={(v) => set('treeId', v)}
              options={trees.map((x) => ({ value: x.id, label: x.name }))}
            />
          </SelectField>
          <SelectField label="Node cha">
            <SearchableSelect
              clearable={!hasExistingRoot}
              value={String(data.parentId)}
              placeholder={
                hasExistingRoot
                  ? 'Đã có node gốc, chọn node cha để tiếp tục'
                  : 'Node gốc (không có node cha)'
              }
              onChange={(v) => set('parentId', v)}
              options={nodes
                .filter(
                  (x) => x.id !== editor.item?.id && x.treeId === data.treeId,
                )
                .map((x) => ({
                  value: x.id,
                  label: x.name,
                  description: x.code,
                }))}
            />
            {hasExistingRoot ? (
              <p className="mt-1 text-[11px] text-amber-600">
                Sơ đồ này đã có node gốc. Mỗi sơ đồ chỉ được phép tạo 1 node gốc duy nhất.
              </p>
            ) : null}
          </SelectField>
          <Field label="Phân loại Đối tượng">
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                className={`group relative flex items-center justify-center gap-2 h-10 px-2.5 rounded-lg text-xs font-medium border transition-all cursor-pointer shadow-2xs ${data.category === 'unit'
                  ? 'border-blue-500 bg-blue-50/70 text-blue-700 font-semibold ring-1 ring-blue-500/20'
                  : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:border-slate-300'
                  }`}
                onClick={() => {
                  set('category', 'unit');
                  const t = types.find((x) => x.category === 'unit');
                  if (t) set('nodeTypeId', t.id);
                }}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${data.category === 'unit'
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-slate-300 bg-white group-hover:border-slate-400'
                    }`}
                >
                  {data.category === 'unit' && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
                <span className="text-sm shrink-0">🏢</span>
                <span className="truncate">Đơn vị (Unit)</span>
              </button>
              <button
                type="button"
                className={`group relative flex items-center justify-center gap-2 h-10 px-2.5 rounded-lg text-xs font-medium border transition-all cursor-pointer shadow-2xs ${data.category === 'position'
                  ? 'border-purple-500 bg-purple-50/70 text-purple-700 font-semibold ring-1 ring-purple-500/20'
                  : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:border-slate-300'
                  }`}
                onClick={() => {
                  set('category', 'position');
                  const t = types.find((x) => x.category === 'position');
                  if (t) set('nodeTypeId', t.id);
                }}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${data.category === 'position'
                    ? 'border-purple-600 bg-purple-600 text-white'
                    : 'border-slate-300 bg-white group-hover:border-slate-400'
                    }`}
                >
                  {data.category === 'position' && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
                <span className="text-sm shrink-0">👤</span>
                <span className="truncate">Chức danh (Position)</span>
              </button>
            </div>
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
          {data.category === 'unit' && editor.item ? (
            <SelectField label="Chức danh quản lý (Node Position chính)">
              <SearchableSelect
                value={String(data.headPositionId ?? '')}
                placeholder="Chưa chọn chức danh quản lý"
                onChange={(v) => set('headPositionId', v || '')}
                options={nodes
                  .filter(
                    (x) =>
                      x.parentId === editor.item?.id && x.category === 'position',
                  )
                  .map((x) => ({
                    value: x.id,
                    label: x.name,
                    description: x.code,
                  }))}
              />
            </SelectField>
          ) : null}
        </>
      ) : null}
      {editor.resource === 'assignments' ? (
        <>
          <SelectField label="Chức danh" required>
            <SearchableSelect
              required
              clearable={false}
              value={String(data.nodeId)}
              placeholder="Gõ tên hoặc mã chức danh để tìm"
              onChange={(v) => set('nodeId', v)}
              options={positionOptions}
            />
          </SelectField>
          <SelectField label="Người dùng" required>
            <SearchableSelect
              required
              clearable={false}
              value={String(data.userId)}
              placeholder="Gõ tên hoặc email người dùng để tìm"
              onChange={(v) => set('userId', v)}
              options={userOptions}
            />
          </SelectField>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Từ ngày">
              <DatePickerInput
                height={32}
                value={String(data.startDate)}
                onChange={(value) => set('startDate', value)}
              />
            </Field>
            <Field label="Đến ngày">
              <DatePickerInput
                height={32}
                value={String(data.endDate)}
                onChange={(value) => set('endDate', value)}
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
      <SelectField label="Trạng thái">
        <SearchableSelect
          clearable={false}
          value={String(data.status)}
          placeholder="Chọn trạng thái"
          onChange={(v) => set('status', v)}
          options={[
            { value: 'active', label: 'Hoạt động' },
            { value: 'inactive', label: 'Không hoạt động' },
            editor.resource === 'assignments'
              ? { value: 'ended', label: 'Đã kết thúc' }
              : { value: 'archived', label: 'Lưu trữ' },
          ]}
        />
      </SelectField>
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
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px flex h-[42px] cursor-pointer items-center gap-2 border-b-2 px-0.5 text-sm font-semibold ${active ? 'border-[#ffc90a] text-[#18181b]' : 'border-transparent text-slate-500 hover:text-[#18181b]'}`}
    >
      {label}
      <span
        className={`rounded-full px-2 text-[11.5px] font-bold ${active ? 'bg-[#fff6d6] text-[#8a6400]' : 'bg-[#f1f3f6] text-slate-500'}`}
      >
        {count}
      </span>
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
/**
 * Nhãn cho ô chọn có ô tìm kiếm. Dùng `div` thay vì `label`: danh sách chọn nằm trong `label` sẽ bị trình duyệt
 * chuyển lần nhấp về ô nhập và đóng danh sách.
 */
function SelectField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5 text-sm font-medium text-slate-700">
      <span>
        {label}
        {required ? <span className="ml-0.5 text-red-500">*</span> : null}
      </span>
      {children}
    </div>
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
