'use client';
import { useOrganizationPermissions } from './organization-permissions';

import {
  AlertTriangle,
  Briefcase,
  Check,
  ChevronRight,
  Loader2,
  Save,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  ConfigProvider,
  Popconfirm,
} from 'antd';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { Assignment, Node } from './organization-workspace';
import {
  findPrimaryElsewhere,
  isConcurrentHolder,
} from './organization-primary-position';

export function OrganizationNodeInspector({
  selectedNode,
  nodes,
  allNodes,
  assignments,
  users,
  onSaveNode,
  onDeleteNode,
  onQuickAssign,
  onQuickUnassign,
  onSetPrimaryAssignment,
  onUnsetPrimaryAssignment,
  onSelectNode,
  onClose,
}: {
  selectedNode?: Node;
  nodes: Node[];
  /** Mọi node (mọi sơ đồ) để tra tên chức danh mà nhân sự đang giữ vị trí chính; mặc định dùng `nodes`. */
  allNodes?: Node[];
  assignments: Assignment[];
  users: { id: string; fullName: string; email: string }[];
  onSaveNode: (nodeId: string, data: Partial<Node>) => Promise<void>;
  onDeleteNode: (node: Node) => void;
  onAssignUser?: (nodeId: string) => void;
  onQuickAssign?: (nodeId: string, userId: string, isPrimary?: boolean) => Promise<unknown>;
  onQuickUnassign?: (assignmentId: string) => Promise<unknown>;
  onSetPrimaryAssignment?: (assignmentId: string, nodeId: string) => Promise<unknown>;
  onUnsetPrimaryAssignment?: (assignmentId: string) => Promise<unknown>;
  onSelectNode?: (nodeId: string) => void;
  /** Có thì hiện nút đóng ở đầu khung (khung nằm cạnh canvas, không phải ngăn kéo). */
  onClose?: () => void;
}) {
  const { canCreate, canUpdate, canDelete } = useOrganizationPermissions();
  const [assignUserId, setAssignUserId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [category, setCategory] = useState<'unit' | 'position'>('unit');
  const [parentId, setParentId] = useState<string | undefined>();
  const [headPositionId, setHeadPositionId] = useState<string | undefined>();
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Sync state only when switching to a different node by ID (prevents dirty field wipe-out)
  useEffect(() => {
    if (selectedNode) {
      setName(selectedNode.name);
      setCode(selectedNode.code);
      const cat = selectedNode.category ?? 'unit';
      setCategory(cat);
      setParentId(selectedNode.parentId);
      setHeadPositionId(selectedNode.headPositionId ?? undefined);
      setDescription(selectedNode.description ?? '');
      setSavedSuccess(false);
      setAssignUserId('');
    }
  }, [selectedNode]);

  const isPositionNode = category === 'position';

  const userMap = useMemo(() => {
    return new Map(users.map((u) => [u.id, u]));
  }, [users]);

  // Current active assignees for this node
  const nodeAssignees = useMemo(() => {
    if (!selectedNode) return [];
    return assignments
      .filter((a) => a.nodeId === selectedNode.id && a.status === 'active')
      .map((a) => ({
        ...a,
        user: userMap.get(a.userId),
      }));
  }, [selectedNode, assignments, userMap]);

  const nodeNameById = useMemo(
    () => new Map((allNodes ?? nodes).map((n) => [n.id, n.name])),
    [allNodes, nodes],
  );

  // Potential parent nodes (exclude self and avoid cycles)
  const availableParents = useMemo(() => {
    if (!selectedNode) return nodes;
    return nodes.filter((n) => n.id !== selectedNode.id);
  }, [nodes, selectedNode]);

  // Direct child position nodes under this unit (for choosing main position)
  const childPositions = useMemo(() => {
    if (!selectedNode || selectedNode.category === 'position') return [];
    return nodes.filter(
      (n) => n.parentId === selectedNode.id && n.category === 'position',
    );
  }, [selectedNode, nodes]);

  const assigneesByNode = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const a of assignments) {
      if (a.status === 'active') {
        const list = map.get(a.nodeId) ?? [];
        list.push(a);
        map.set(a.nodeId, list);
      }
    }
    return map;
  }, [assignments]);

  const headPositionWarning = useMemo(() => {
    if (category !== 'unit' || !headPositionId) return null;
    const headPos = nodes.find((n) => n.id === headPositionId);
    if (!headPos) return null;
    const posAssignees = assigneesByNode.get(headPositionId) ?? [];
    if (posAssignees.length === 0) {
      return `Chức danh "${headPos.name}" chưa có nhân sự nào được bổ nhiệm.`;
    }
    if (posAssignees.length > 1) {
      const hasPrimary = posAssignees.some((a) => a.isPrimary);
      if (!hasPrimary) {
        return `Chức danh "${headPos.name}" hiện có ${posAssignees.length} nhân sự nhưng chưa có ai được chọn làm "Vị trí chính". Vui lòng bổ nhiệm 1 nhân sự làm vị trí chính.`;
      }
    }
    return null;
  }, [category, headPositionId, nodes, assigneesByNode]);

  if (!selectedNode) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm font-sans">
        <div className="grid size-12 place-items-center rounded-full bg-slate-100 text-slate-400">
          <SlidersHorizontal className="size-6" />
        </div>
        <h4 className="mt-3 text-xs font-bold text-slate-800 uppercase tracking-wider">
          Thuộc tính Chi tiết
        </h4>
        <p className="mt-1 text-xs text-slate-500 max-w-[220px]">
          Chọn một node bất kỳ trên cây sơ đồ hoặc canvas để xem và cập nhật thông tin.
        </p>
      </div>
    );
  }

  const hasOtherRoot = nodes.some(
    (n) =>
      n.treeId === selectedNode.treeId &&
      !n.parentId &&
      n.id !== selectedNode.id,
  );

  const assignableUsers = users.filter(
    (u) => !nodeAssignees.some((a) => a.userId === u.id),
  );
  const primaryNodeNameOf = (userId: string) => {
    const primary = findPrimaryElsewhere(assignments, userId, selectedNode.id);
    return primary ? (nodeNameById.get(primary.nodeId) ?? 'chức danh khác') : undefined;
  };
  const pickedUserPrimaryNode = assignUserId ? primaryNodeNameOf(assignUserId) : undefined;

  const handleAssign = async () => {
    if (!onQuickAssign || !assignUserId) return;
    setAssigning(true);
    try {
      // Người đầu tiên của chức danh mặc định là vị trí chính, trừ khi người đó đã giữ vị trí chính ở chức danh khác (khi đó là kiêm nhiệm).
      const result = await onQuickAssign(
        selectedNode.id,
        assignUserId,
        nodeAssignees.length === 0 &&
          !findPrimaryElsewhere(assignments, assignUserId, selectedNode.id),
      );
      if (result) {
        toast.success('Đã bổ nhiệm nhân sự vào chức danh.');
        setAssignUserId('');
      }
    } finally {
      setAssigning(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !code.trim()) return;
    if (!parentId && hasOtherRoot) {
      toast.error('Mỗi sơ đồ tổ chức chỉ được phép có 1 node gốc. Vui lòng chọn Node cha.');
      return;
    }
    setSaving(true);
    setSavedSuccess(false);
    try {
      await onSaveNode(selectedNode.id, {
        name: name.trim(),
        code: code.trim(),
        category,
        parentId: parentId || undefined,
        headPositionId: category === 'unit' ? (headPositionId || null) : null,
        description: description.trim(),
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    } finally {
      setSaving(false);
    }
  };


  return (
    <ConfigProvider
      theme={{
        token: {
          fontFamily: 'var(--font-sans), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontSize: 13,
          colorPrimary: '#2563eb',
          borderRadius: 6,
          colorText: '#0f172a',
          colorTextDescription: '#64748b',
          colorTextPlaceholder: '#94a3b8',
        },
        components: {
          Select: {
            fontSize: 13,
            optionFontSize: 12,
            controlHeight: 36,
            borderRadius: 6,
          },
          Input: {
            fontSize: 13,
            controlHeight: 30,
            borderRadius: 6,
          },
          Popconfirm: {
            fontSize: 13,
          },
        },
      }}
    >
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[14px] border border-[#eef0f3] bg-white font-sans">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-[#eef0f3] bg-[#fafbfc] px-4 py-3">
          <SlidersHorizontal className="size-4 text-amber-700" />
          <h3 className="m-0 flex-1 text-[12px] font-bold uppercase tracking-[0.6px] text-slate-700">
            Thuộc tính chi tiết
          </h3>
          <span
            className={cn(
              'rounded-full px-2 py-px text-[12px] font-bold',
              isPositionNode ? 'bg-violet-50 text-violet-700' : 'bg-blue-50 text-blue-700',
            )}
          >
            {isPositionNode ? 'Chức danh' : 'Đơn vị'}
          </span>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng"
              title="Đóng"
              className="grid size-7 cursor-pointer place-items-center rounded-[7px] border border-[#eef0f3] bg-white text-slate-600 hover:bg-[#f4f6f9]"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>

        {/* Main Body: Single continuous scrollable form */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3.5 space-y-5">
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {/* Tên đơn vị / chức danh */}
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Đơn vị / Chức danh (Tên node)
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="VD: Phòng Kinh Doanh, Trưởng phòng Kinh Doanh…"
                  required
                  className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Phân loại Đối tượng (cùng một hàng với Mã số định danh) */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Phân loại Đối tượng
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setCategory('unit')}
                    className={cn(
                      'group relative flex items-center justify-center gap-1.5 h-9 rounded-md border text-xs font-medium cursor-pointer transition-all',
                      category === 'unit'
                        ? 'border-blue-500 bg-blue-50/70 text-blue-700 font-semibold shadow-xs ring-1 ring-blue-500/20'
                        : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:border-slate-300',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition-colors',
                        category === 'unit'
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-slate-300 bg-white group-hover:border-slate-400',
                      )}
                    >
                      {category === 'unit' && <span className="h-1 w-1 rounded-full bg-white" />}
                    </span>
                    <span className="truncate">Đơn vị</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCategory('position')}
                    className={cn(
                      'group relative flex items-center justify-center gap-1.5 h-9 rounded-md border text-xs font-medium cursor-pointer transition-all',
                      category === 'position'
                        ? 'border-purple-500 bg-purple-50/70 text-purple-700 font-semibold shadow-xs ring-1 ring-purple-500/20'
                        : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:border-slate-300',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition-colors',
                        category === 'position'
                          ? 'border-purple-600 bg-purple-600 text-white'
                          : 'border-slate-300 bg-white group-hover:border-slate-400',
                      )}
                    >
                      {category === 'position' && <span className="h-1 w-1 rounded-full bg-white" />}
                    </span>
                    <span className="truncate">Chức danh</span>
                  </button>
                </div>
              </div>

              {/* Mã số định danh (Code / MSNV) */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Mã số định danh (Code / MSNV)
                </label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="VD: KD-01, TP-KD…"
                  required
                  className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 uppercase tracking-wide"
                />
              </div>

              {/* Đơn vị cấp trên (Parent node) */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Trực thuộc đơn vị (Node cha)
                </label>
                <SearchableSelect
                  searchInDropdown
                  height={36}
                  clearable={false}
                  value={parentId ?? ''}
                  onChange={(v) => setParentId(v || undefined)}
                  placeholder="Chọn đơn vị cha"
                  searchPlaceholder="Tìm đơn vị…"
                  options={[
                    {
                      value: '',
                      label: hasOtherRoot
                        ? '— Đã có node gốc —'
                        : 'Không có (Node gốc / Cao nhất)',
                      disabled: hasOtherRoot,
                    },
                    ...availableParents.map((p) => ({ value: p.id, label: p.name })),
                  ]}
                />
                {hasOtherRoot ? (
                  <p className="mt-1 text-[12px] text-amber-600">
                    Sơ đồ này đã có node gốc. Mỗi sơ đồ chỉ có 1 node gốc duy nhất.
                  </p>
                ) : null}
              </div>

              {/* Chức danh quản lý (Node Position chính) */}
              {category === 'unit' ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Chức danh quản lý (Node chính)
                  </label>
                  <SearchableSelect
                    searchInDropdown
                    height={36}
                    clearable={false}
                    value={headPositionId ?? ''}
                    onChange={(v) => setHeadPositionId(v || undefined)}
                    placeholder="Chọn chức danh quản lý"
                    searchPlaceholder="Tìm chức danh…"
                    options={[
                      { value: '', label: '-- Chưa chọn quản lý --' },
                      ...childPositions.map((pos) => ({ value: pos.id, label: pos.name })),
                    ]}
                  />
                  {childPositions.length === 0 ? (
                    <p className="mt-1 text-[12px] text-slate-400 italic">
                      Chưa có chức danh trực thuộc đơn vị này.
                    </p>
                  ) : null}
                  {headPositionWarning ? (
                    <div className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50/70 p-2 text-[12px] text-amber-800 leading-snug">
                      <AlertTriangle className="size-3.5 shrink-0 text-amber-600 mt-0.5" />
                      <span>{headPositionWarning}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Mô tả chức năng & nhiệm vụ */}
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Mô tả chức năng & nhiệm vụ
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Mô tả chức năng, nhiệm vụ và phạm vi trách nhiệm của đơn vị / chức danh này…"
                  className="w-full rounded-md border border-slate-200 bg-white p-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 leading-relaxed"
                />
              </div>
            </div>

            {/* Save Button */}
            <div className="pt-2">
              <Button
                type="submit"
                disabled={!canUpdate || saving}
                className="w-full gap-1.5 bg-[#18181b] text-[14px] font-semibold text-white hover:bg-[#2a2a2f] h-9"
              >
                {saving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : savedSuccess ? (
                  <Check className="size-3.5 text-emerald-300" />
                ) : (
                  <Save className="size-3.5" />
                )}
                {saving ? 'Đang lưu…' : savedSuccess ? 'Đã lưu thành công!' : 'Lưu thay đổi'}
              </Button>
            </div>
          </form>

          {/* Khối Quản lý Nhân sự Đương nhiệm (Chỉ hiển thị cho node Chức danh - position) */}
          {isPositionNode ? (
            <div className="mt-4 pt-4 border-t border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.6px] text-slate-500">
                  <span aria-hidden className="h-3.5 w-[3px] rounded-sm bg-[#ffc90a]" />
                  <Users className="size-3.5" />
                  <span>Nhân sự đương nhiệm</span>
                </div>
                <span className="rounded-full bg-[#f1f3f6] px-2 text-[12px] font-semibold text-slate-700">
                  {nodeAssignees.length} nhân sự
                </span>
              </div>

              {/* Cảnh báo nếu có >= 2 nhân sự nhưng chưa chọn ai làm Vị trí chính */}
              {nodeAssignees.length > 1 && !nodeAssignees.some((a) => a.isPrimary) ? (
                <div className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50/70 p-2 text-[12px] text-amber-800 leading-snug">
                  <AlertTriangle className="size-3.5 shrink-0 text-amber-600 mt-0.5" />
                  <span>
                    Chức danh này đang có {nodeAssignees.length} nhân sự nhưng chưa có ai được đặt làm &ldquo;Vị trí chính&rdquo;. Hãy chọn 1 người làm vị trí chính để đại diện quản lý đơn vị.
                  </span>
                </div>
              ) : null}

              <p className="text-[12px] leading-snug text-slate-500">
                Một chức danh có thể có nhiều người giữ vị trí chính, nhưng mỗi người chỉ giữ vị trí chính ở một chức danh.
              </p>

              {/* Danh sách nhân sự hiện tại */}
              {nodeAssignees.length > 0 ? (
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                  {nodeAssignees.map((item) => {
                    const primaryAt = item.isPrimary ? undefined : primaryNodeNameOf(item.userId);
                    const concurrent = isConcurrentHolder(assignments, item);
                    return (
                    <div key={item.id} className="flex items-center justify-between gap-2 p-2.5 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="grid size-7 shrink-0 place-items-center rounded-full bg-blue-100 font-semibold text-blue-700 text-xs">
                          {item.user?.fullName ? item.user.fullName.charAt(0).toUpperCase() : 'U'}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 truncate">
                            {item.user?.fullName ?? item.userId}
                          </p>
                          <p className="text-[12px] text-slate-500 truncate">
                            {item.user?.email ?? ''}
                          </p>
                          {primaryAt ? (
                            <p className="mt-0.5 flex items-start gap-1 text-[12px] leading-snug text-amber-700">
                              <AlertTriangle className="mt-px size-3 shrink-0" />
                              <span>Đang giữ vị trí chính tại &ldquo;{primaryAt}&rdquo;</span>
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {item.isPrimary ? (
                          <>
                            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[12px] font-semibold text-amber-700 border border-amber-200">
                              Vị trí chính
                            </span>
                            {canUpdate && onUnsetPrimaryAssignment ? (
                              <button
                                type="button"
                                onClick={() => void onUnsetPrimaryAssignment(item.id)}
                                className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[12px] font-medium text-slate-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700 cursor-pointer"
                                title="Bỏ vị trí chính ở chức danh này"
                              >
                                Bỏ chính
                              </button>
                            ) : null}
                          </>
                        ) : (
                          <>
                            {concurrent ? (
                              <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[12px] font-semibold text-violet-700 border border-violet-200">
                                Kiêm nhiệm
                              </span>
                            ) : null}
                            {canUpdate && onSetPrimaryAssignment ? (
                              <button
                                type="button"
                                disabled={Boolean(primaryAt)}
                                onClick={() => void onSetPrimaryAssignment(item.id, item.nodeId)}
                                title={
                                  primaryAt
                                    ? `Nhân sự đang giữ vị trí chính tại "${primaryAt}". Hãy bỏ vị trí chính ở đó trước.`
                                    : 'Đặt làm vị trí chính'
                                }
                                className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[12px] font-medium text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:bg-white disabled:hover:text-slate-600"
                              >
                                Đặt làm chính
                              </button>
                            ) : null}
                          </>
                        )}
                        {canDelete && onQuickUnassign ? (
                          <Popconfirm
                            title="Gỡ bổ nhiệm?"
                            description={`Gỡ "${item.user?.fullName ?? item.userId}" khỏi chức danh này?`}
                            okText="Gỡ"
                            cancelText="Huỷ"
                            okButtonProps={{ danger: true }}
                            placement="topRight"
                            onConfirm={() => onQuickUnassign(item.id)}
                          >
                            <button
                              type="button"
                              className="p-1 rounded text-slate-400 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                              title="Gỡ bổ nhiệm"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </Popconfirm>
                        ) : null}
                      </div>
                    </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">
                  Chưa có nhân sự được bổ nhiệm vào chức danh này.
                </div>
              )}

              {/* Bổ nhiệm nhanh */}
              {canCreate && onQuickAssign ? (
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <SearchableSelect
                      value={assignUserId}
                      onChange={(v) => setAssignUserId(v)}
                      placeholder="Chọn nhân sự để bổ nhiệm"
                      options={assignableUsers.map((u) => {
                        const at = primaryNodeNameOf(u.id);
                        return {
                          value: u.id,
                          label: u.email ? `${u.fullName} (${u.email})` : u.fullName,
                          description: at ? `Đang giữ vị trí chính tại: ${at}` : undefined,
                        };
                      })}
                    />
                  </div>
                  <Button
                    type="button"
                    disabled={!assignUserId || assigning}
                    onClick={() => void handleAssign()}
                    className="h-9 shrink-0 bg-[#ffc90a] text-[13px] font-bold text-[#18181b] hover:bg-[#ffd84d]"
                  >
                    {assigning ? <Loader2 className="size-3.5 animate-spin" /> : 'Bổ nhiệm'}
                  </Button>
                </div>
              ) : null}
              {canCreate && onQuickAssign && pickedUserPrimaryNode ? (
                <div className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50/70 p-2 text-[12px] leading-snug text-amber-800">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                  <span>
                    Nhân sự này đang giữ vị trí chính tại &ldquo;{pickedUserPrimaryNode}&rdquo;. Bổ nhiệm vào chức danh này sẽ là kiêm nhiệm; muốn đặt vị trí chính ở đây, hãy bỏ vị trí chính ở chức danh kia trước.
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Khối Danh sách Chức danh trực thuộc đơn vị (Chỉ hiển thị cho node Đơn vị - unit) */}
          {!isPositionNode ? (
            <div className="mt-4 pt-4 border-t border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.6px] text-slate-500">
                  <span aria-hidden className="h-3.5 w-[3px] rounded-sm bg-[#ffc90a]" />
                  <Briefcase className="size-3.5" />
                  <span>Chức danh trực thuộc</span>
                </div>
                <span className="rounded-full bg-[#f1f3f6] px-2 text-[12px] font-semibold text-slate-700">
                  {childPositions.length} chức danh
                </span>
              </div>

              {childPositions.length > 0 ? (
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                  {childPositions.map((pos) => {
                    const isHead = (headPositionId ?? selectedNode.headPositionId) === pos.id;
                    const posAssignees = (assigneesByNode.get(pos.id) ?? []).map((a) => ({
                      ...a,
                      user: userMap.get(a.userId),
                    }));
                    return (
                      <div
                        key={pos.id}
                        className={cn(
                          'p-2.5 text-xs transition-colors',
                          isHead ? 'bg-amber-50/40' : 'hover:bg-slate-50/70',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {/* <div
                              className={cn(
                                'grid size-7 shrink-0 place-items-center rounded-md border text-xs',
                                isHead
                                  ? 'border-amber-300 bg-amber-100 text-amber-700'
                                  : 'border-slate-200 bg-slate-100 text-slate-600',
                              )}
                            >
                              <User className="size-3.5" />
                            </div> */}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-semibold text-slate-900 truncate">
                                  {pos.name}
                                </span>
                                {/* <span className="text-[12px] text-slate-400 font-mono">
                                  ({pos.code})
                                </span> */}
                                {isHead ? (
                                  <span className="rounded bg-amber-100 px-1.5 py-0.2 text-[12px] font-bold text-amber-800 border border-amber-300 inline-flex items-center gap-0.5">
                                    ★ Quản lý
                                  </span>
                                ) : null}
                              </div>
                              {/* Danh sách nhân sự trong chức danh */}
                              <div className="mt-1 flex items-center gap-1 flex-wrap text-[12px]">
                                {posAssignees.length > 0 ? (
                                  posAssignees.map((a) => (
                                    <span
                                      key={a.id}
                                      className={cn(
                                        'inline-flex items-center gap-1 rounded px-1.5 py-0.2 text-[12px] border',
                                        a.isPrimary
                                          ? 'bg-blue-50 text-blue-700 border-blue-200 font-medium'
                                          : 'bg-slate-50 text-slate-600 border-slate-200',
                                      )}
                                    >
                                      {a.user?.fullName ?? a.userId}
                                      {a.isPrimary ? ' (Chính)' : ''}
                                    </span>
                                  ))
                                ) : (
                                  <span className="italic text-slate-400 text-[12px]">
                                    (Chưa có nhân sự)
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {/* {!isHead ? (
                              <button
                                type="button"
                                onClick={() => setHeadPositionId(pos.id)}
                                className="rounded border border-slate-200 bg-white px-2 py-1 text-[12px] font-medium text-slate-600 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-300 transition cursor-pointer"
                                title="Chọn làm chức danh quản lý đơn vị"
                              >
                                Đặt làm quản lý
                              </button>
                            ) : null} */}
                            {onSelectNode ? (
                              <button
                                type="button"
                                onClick={() => onSelectNode(pos.id)}
                                className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition cursor-pointer"
                                title="Xem chi tiết chức danh này"
                              >
                                <ChevronRight className="size-3.5" />
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">
                  Chưa có chức danh trực thuộc đơn vị này.
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Footer Danger Action with Ant Design Popconfirm */}
        <div className="flex shrink-0 items-center justify-between border-t border-[#eef0f3] bg-[#fafbfc] px-4 py-2.5 font-sans">
          <span className="font-mono text-[12px] text-slate-500">{selectedNode.code}</span>
          <Popconfirm
            title="Xoá node tổ chức?"
            description={`Bạn có chắc chắn muốn xoá node "${selectedNode.name}"? Dữ liệu lịch sử vẫn được lưu trữ.`}
            okText="Xoá"
            cancelText="Huỷ"
            okButtonProps={{ danger: true }}
            placement="topRight"
            disabled={!canDelete}
            onConfirm={() => onDeleteNode(selectedNode)}
          >
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700 hover:underline"
            >
              <Trash2 className="size-3.5" />
              <span>Xoá node này</span>
            </button>
          </Popconfirm>
        </div>
      </div>
    </ConfigProvider>
  );
}
