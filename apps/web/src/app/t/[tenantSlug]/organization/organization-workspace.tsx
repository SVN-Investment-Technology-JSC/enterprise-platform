'use client';

import {
  Building2,
  ChevronRight,
  GitBranch,
  MoreVertical,
  Pencil,
  Plus,
  Save,
  UserPlus,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import {
  markLayoutSaved,
  useAppDispatch,
  useAppSelector,
  type FlowPositions,
} from '@/store/organization-layout-store';
import { OrganizationFlow } from './organization-flow';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

type Tree = {
  id: string;
  code: string;
  name: string;
  description?: string;
  isPrimary: boolean;
  status: string;
  layout?: { version?: number; positions?: FlowPositions };
};
type NodeType = {
  id: string;
  code: string;
  name: string;
  category: 'unit' | 'position';
  description?: string;
  sortOrder?: number;
  isSystem: boolean;
  isActive: boolean;
};
type Node = {
  id: string;
  treeId: string;
  parentId?: string;
  nodeTypeId: string;
  code: string;
  name: string;
  description?: string;
  sortOrder?: number;
  status: string;
};
type Assignment = {
  id: string;
  nodeId: string;
  userId: string;
  isPrimary: boolean;
  startDate?: string;
  endDate?: string;
  note?: string;
  status: string;
};
export type OrganizationSnapshot = {
  trees: Tree[];
  nodeTypes: NodeType[];
  nodes: Node[];
  assignments: Assignment[];
  users: { id: string; fullName: string; email: string }[];
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
  const [snapshot] = useState(() => initialSnapshot),
    [tab, setTab] = useState<'tree' | 'type' | 'assignment'>('tree'),
    [treeId, setTreeId] = useState(
      () =>
        initialSnapshot.trees.find((x) => x.isPrimary)?.id ??
        initialSnapshot.trees[0]?.id,
    ),
    [editor, setEditor] = useState<Editor>(),
    [menu, setMenu] = useState<string>(),
    [error, setError] = useState(loadError),
    [layoutSaving, setLayoutSaving] = useState(false);
  const tree = snapshot.trees.find((x) => x.id === treeId);
  const nodes = snapshot.nodes.filter((x) => x.treeId === treeId);
  const layoutCacheKey = `organization-layout:${tenantSlug}:${treeId ?? 'none'}`;
  const dispatch = useAppDispatch();
  const cachedLayout = useAppSelector(
    (state) => state.organizationLayouts.layouts[layoutCacheKey],
  );
  const types = useMemo(
    () => new Map(snapshot.nodeTypes.map((x) => [x.id, x])),
    [snapshot.nodeTypes],
  );
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
      setError('Không thể kết nối API để lưu dữ liệu.');
      return;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(
        Array.isArray(body.message)
          ? body.message.join(' ')
          : (body.message ?? 'Không thể lưu dữ liệu.'),
      );
      return;
    }
    setEditor(undefined);
    location.reload();
  }
  async function remove(resource: Resource, item: Editor['item']) {
    if (
      !item ||
      !confirm('Xóa mềm bản ghi này? Dữ liệu lịch sử vẫn được giữ lại.')
    )
      return;
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
      setError(
        Array.isArray(body.message)
          ? body.message.join(' ')
          : (body.message ?? 'Không thể xóa.'),
      );
      return;
    }
    location.reload();
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
    setMenu(undefined);
    setEditor({ resource, item, parentId });
  };
  return (
    <>
      <main className="mx-auto max-w-[1440px] p-4 sm:p-6 lg:p-8">
        <div className="mb-6">
          <nav className="mb-2 flex items-center text-sm text-slate-500">
            <Link href={`/t/${tenantSlug}`}>Tenant Portal</Link>
            <ChevronRight className="mx-1 size-4" />
            <span>Quản trị</span>
            <ChevronRight className="mx-1 size-4" />
            <span className="font-medium text-[#0d1c2d]">Sơ đồ tổ chức</span>
          </nav>
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">
                Sơ đồ tổ chức
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Quản lý cấu trúc tổ chức trực tiếp trong dữ liệu lõi của tenant.
              </p>
            </div>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              onClick={() =>
                open(
                  tab === 'tree'
                    ? 'trees'
                    : tab === 'type'
                      ? 'node-types'
                      : 'assignments',
                )
              }
            >
              <Plus />
              {tab === 'tree'
                ? 'Thêm sơ đồ'
                : tab === 'type'
                  ? 'Thêm loại node'
                  : 'Bổ nhiệm người dùng'}
            </Button>
          </div>
        </div>
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <Metric label="Sơ đồ tổ chức" value={snapshot.trees.length} />
          <Metric
            label="Node đang dùng"
            value={snapshot.nodes.length}
            accent="text-blue-700"
          />
          <Metric
            label="Bổ nhiệm hiệu lực"
            value={
              snapshot.assignments.filter((x) => x.status === 'active').length
            }
            accent="text-violet-700"
          />
        </div>
        {error ? (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        ) : null}
        <div className="mb-5 flex gap-5 border-b border-slate-200">
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
        {tab === 'tree' ? (
          <div className="grid gap-5 xl:grid-cols-[340px_1fr]">
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 bg-[#f8f9ff] p-4">
                <h2 className="font-bold">Danh sách sơ đồ</h2>
                <p className="mt-1 text-xs text-slate-500">
                  organization_trees
                </p>
              </div>
              {snapshot.trees.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setTreeId(item.id)}
                  className={`block w-full border-b border-slate-200 px-4 py-4 text-left ${treeId === item.id ? 'border-l-2 border-l-blue-600 bg-blue-50/60' : ''}`}
                >
                  <div className="flex justify-between">
                    <b>{item.name}</b>
                    {item.isPrimary ? <Badge text="CHÍNH" tone="blue" /> : null}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{item.code}</p>
                </button>
              ))}
            </section>
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col justify-between gap-3 border-b border-slate-200 bg-[#f8f9ff] p-4 sm:flex-row sm:items-center">
                <div>
                  <h2 className="font-bold">
                    {tree?.name ?? 'Chưa chọn sơ đồ'}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {tree?.description ?? 'Tạo node để xây dựng cây tổ chức.'}
                  </p>
                </div>
                {tree ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={layoutSaving || !cachedLayout?.dirty}
                      onClick={() =>
                        void toast.promise(saveTreeLayout(), {
                          loading: {
                            title: 'Đang lưu vị trí các node',
                            description: 'Đang ghi tọa độ sơ đồ vào hệ thống.',
                            type: 'loading',
                          },
                          success: {
                            title: 'Đã lưu vị trí các node',
                            description: 'Tọa độ sơ đồ đã được cập nhật thành công.',
                            type: 'success',
                          },
                          error: (error) => ({
                            title: 'Không thể lưu vị trí các node',
                            description:
                              error instanceof Error
                                ? error.message
                                : 'Vui lòng thử lại.',
                            type: 'error',
                          }),
                        })
                      }
                      size="sm"
                      title={
                        cachedLayout?.dirty
                          ? 'Lưu tọa độ hiện tại vào hệ thống'
                          : 'Chưa có thay đổi vị trí'
                      }
                      variant="outline"
                    >
                      <Save />
                      {layoutSaving ? 'Đang lưu…' : 'Lưu vị trí các node'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => open('trees', tree)}
                    >
                      <Pencil />
                      Sửa
                    </Button>
                    <Button size="sm" onClick={() => open('nodes')}>
                      <Plus />
                      Thêm node
                    </Button>
                  </div>
                ) : null}
              </div>
              <OrganizationFlow
                key={treeId}
                assignments={snapshot.assignments}
                initialPositions={tree?.layout?.positions ?? {}}
                layoutCacheKey={layoutCacheKey}
                nodes={nodes}
                nodeTypes={types}
                onAddChild={(node) => open('nodes', undefined, node.id)}
                onEdit={(node) => open('nodes', node)}
                users={snapshot.users}
              />
            </section>
          </div>
        ) : null}
        {tab === 'type' ? (
          <Registry
            items={snapshot.nodeTypes}
            resource="node-types"
            menu={menu}
            setMenu={setMenu}
            open={open}
            remove={remove}
          />
        ) : null}
        {tab === 'assignment' ? (
          <AssignmentList
            assignments={snapshot.assignments}
            nodes={snapshot.nodes}
            users={snapshot.users}
            menu={menu}
            setMenu={setMenu}
            open={open}
            remove={remove}
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
    nodeId: item?.nodeId ?? '',
    userId: item?.userId ?? users[0]?.id ?? '',
    startDate: item?.startDate ?? '',
    endDate: item?.endDate ?? '',
    note: item?.note ?? '',
  });
  const set = (k: string, v: unknown) => setData((x) => ({ ...x, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
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
              <option value="">Node gốc</option>
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
function Registry({
  items,
  menu,
  setMenu,
  open,
  remove,
}: {
  items: NodeType[];
  resource: Resource;
  menu?: string;
  setMenu: (x?: string) => void;
  open: (r: Resource, i?: Editor['item']) => void;
  remove: (r: Resource, i: Editor['item']) => Promise<void>;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-[#f8f9ff] p-4">
        <h2 className="font-bold">Registry loại node</h2>
        <p className="mt-1 text-sm text-slate-500">
          Định nghĩa các loại đơn vị và chức danh.
        </p>
      </div>
      {items.map((x) => (
        <div
          className="grid grid-cols-[1.4fr_1fr_1fr_1fr_52px] items-center border-b border-slate-200 p-4 text-sm"
          key={x.id}
        >
          <b>{x.name}</b>
          <span className="text-slate-500">{x.code}</span>
          <Badge
            text={x.category === 'unit' ? 'Đơn vị' : 'Chức danh'}
            tone={x.category === 'unit' ? 'blue' : 'violet'}
          />
          <Badge
            text={x.isActive ? 'Hoạt động' : 'Tắt'}
            tone={x.isActive ? 'green' : 'gray'}
          />
          <Menu
            id={x.id}
            active={menu}
            set={setMenu}
            edit={() => open('node-types', x)}
            remove={() => void remove('node-types', x)}
          />
        </div>
      ))}
      {!items.length ? <Empty text="Chưa có loại node." /> : null}
    </section>
  );
}
function AssignmentList({
  assignments,
  nodes,
  users,
  menu,
  setMenu,
  open,
  remove,
}: {
  assignments: Assignment[];
  nodes: Node[];
  users: OrganizationSnapshot['users'];
  menu?: string;
  setMenu: (x?: string) => void;
  open: (r: Resource, i?: Editor['item']) => void;
  remove: (r: Resource, i: Editor['item']) => Promise<void>;
}) {
  const names = new Map(nodes.map((x) => [x.id, x.name])),
    people = new Map(users.map((x) => [x.id, x.fullName]));
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-[#f8f9ff] p-4">
        <h2 className="font-bold">Lịch sử bổ nhiệm</h2>
        <p className="mt-1 text-sm text-slate-500">
          Người dùng chỉ được gán vào chức danh POSITION.
        </p>
      </div>
      {assignments.map((x) => (
        <div
          className="grid grid-cols-[1.3fr_1.3fr_1fr_1fr_52px] items-center border-b border-slate-200 p-4 text-sm"
          key={x.id}
        >
          <b>{people.get(x.userId)}</b>
          <span>{names.get(x.nodeId)}</span>
          <span className="text-slate-500">
            {x.startDate || '—'}
            {x.endDate ? ` — ${x.endDate}` : ''}
          </span>
          <Badge
            text={x.status === 'active' ? 'Hoạt động' : x.status}
            tone={x.status === 'active' ? 'green' : 'gray'}
          />
          <Menu
            id={x.id}
            active={menu}
            set={setMenu}
            edit={() => open('assignments', x)}
            remove={() => void remove('assignments', x)}
          />
        </div>
      ))}
      {!assignments.length ? <Empty text="Chưa có lịch sử bổ nhiệm." /> : null}
    </section>
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
function Metric({
  label,
  value,
  accent = 'text-[#0d1c2d]',
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p className={`mt-1 text-[32px] font-bold ${accent}`}>{value}</p>
    </div>
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
function Empty({ text }: { text: string }) {
  return (
    <div className="grid min-h-40 place-items-center p-6 text-sm text-slate-500">
      {text}
    </div>
  );
}
function Badge({
  text,
  tone,
}: {
  text: string;
  tone: 'blue' | 'violet' | 'green' | 'gray';
}) {
  const c = {
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    violet: 'border-violet-200 bg-violet-50 text-violet-700',
    green: 'border-green-200 bg-green-50 text-green-700',
    gray: 'border-slate-200 bg-slate-100 text-slate-700',
  }[tone];
  return (
    <span
      className={`w-fit rounded border px-2 py-0.5 text-[11px] font-medium ${c}`}
    >
      {text}
    </span>
  );
}
function Menu({
  id,
  active,
  set,
  edit,
  remove,
}: {
  id: string;
  active?: string;
  set: (x?: string) => void;
  edit: () => void;
  remove: () => void;
}) {
  return (
    <div className="relative text-right">
      <Button
        size="icon"
        variant="ghost"
        onClick={() => set(active === id ? undefined : id)}
      >
        <MoreVertical className="size-4" />
      </Button>
      {active === id ? (
        <div className="absolute right-5 top-8 z-20 w-32 rounded-lg border border-slate-200 bg-white py-1 text-left shadow-lg">
          <button
            className="block w-full px-3 py-2 text-sm hover:bg-slate-100"
            onClick={edit}
          >
            Chỉnh sửa
          </button>
          <button
            className="block w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50"
            onClick={remove}
          >
            Xóa mềm
          </button>
        </div>
      ) : null}
    </div>
  );
}
