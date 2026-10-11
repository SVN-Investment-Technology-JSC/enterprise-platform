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
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  ConfigProvider,
  Popconfirm,
} from 'antd';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { Assignment, Node } from './organization-workspace';

export function OrganizationNodeInspector({
  selectedNode,
  nodes,
  assignments,
  users,
  onSaveNode,
  onDeleteNode,
  onSelectNode,
}: {
  selectedNode?: Node;
  nodes: Node[];
  assignments: Assignment[];
  users: { id: string; fullName: string; email: string }[];
  onSaveNode: (nodeId: string, data: Partial<Node>) => Promise<void>;
  onDeleteNode: (node: Node) => void;
  onAssignUser?: (nodeId: string) => void;
  onQuickAssign?: (nodeId: string, userId: string, isPrimary?: boolean) => Promise<unknown>;
  onQuickUnassign?: (assignmentId: string) => Promise<unknown>;
  onSetPrimaryAssignment?: (assignmentId: string, nodeId: string) => Promise<unknown>;
  onSelectNode?: (nodeId: string) => void;
}) {
  const { canUpdate, canDelete } = useOrganizationPermissions();
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
          fontSize: 12,
          colorPrimary: '#2563eb',
          borderRadius: 6,
          colorText: '#0f172a',
          colorTextDescription: '#64748b',
          colorTextPlaceholder: '#94a3b8',
        },
        components: {
          Select: {
            fontSize: 12,
            optionFontSize: 12,
            controlHeight: 36,
            borderRadius: 6,
          },
          Input: {
            fontSize: 12,
            controlHeight: 30,
            borderRadius: 6,
          },
          Popconfirm: {
            fontSize: 12,
          },
        },
      }}
    >
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm font-sans">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-4 text-blue-600" />
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Thuộc tính chi tiết
            </h3>
          </div>
          <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200">
            {isPositionNode ? 'Chức danh' : 'Đơn vị'}
          </span>
        </div>

        {/* Main Body: Single continuous scrollable form */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5">
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Tên đơn vị / chức danh */}
              <div className="md:col-span-2">
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

              {/* Phân loại Đối tượng */}
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
                <select
                  value={parentId ?? ''}
                  onChange={(e) => setParentId(e.target.value || undefined)}
                  className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="" disabled={hasOtherRoot}>
                    {hasOtherRoot
                      ? '— Đã có node gốc —'
                      : 'Không có (Node gốc / Cao nhất)'}
                  </option>
                  {availableParents.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {hasOtherRoot ? (
                  <p className="mt-1 text-[11px] text-amber-600">
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
                  <select
                    value={headPositionId ?? ''}
                    onChange={(e) => setHeadPositionId(e.target.value || undefined)}
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">-- Chưa chọn quản lý --</option>
                    {childPositions.map((pos) => (
                      <option key={pos.id} value={pos.id}>
                        {pos.name}
                      </option>
                    ))}
                  </select>
                  {childPositions.length === 0 ? (
                    <p className="mt-1 text-[11px] text-slate-400 italic">
                      Chưa có chức danh trực thuộc đơn vị này.
                    </p>
                  ) : null}
                  {headPositionWarning ? (
                    <div className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50/70 p-2 text-[11px] text-amber-800 leading-snug">
                      <AlertTriangle className="size-3.5 shrink-0 text-amber-600 mt-0.5" />
                      <span>{headPositionWarning}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Mô tả chức năng & nhiệm vụ */}
              <div className="md:col-span-2">
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
                className="w-full gap-1.5 bg-blue-600 text-xs font-semibold hover:bg-blue-700 h-9"
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
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-800">
                  <Users className="size-4 text-blue-600" />
                  <span>Nhân sự đương nhiệm</span>
                </div>
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 border border-blue-200">
                  {nodeAssignees.length} nhân sự
                </span>
              </div>

              {/* Cảnh báo nếu có >= 2 nhân sự nhưng chưa chọn ai làm Vị trí chính */}
              {nodeAssignees.length > 1 && !nodeAssignees.some((a) => a.isPrimary) ? (
                <div className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50/70 p-2 text-[11px] text-amber-800 leading-snug">
                  <AlertTriangle className="size-3.5 shrink-0 text-amber-600 mt-0.5" />
                  <span>
                    Chức danh này đang có {nodeAssignees.length} nhân sự nhưng chưa có ai được đặt làm &ldquo;Vị trí chính&rdquo;. Hãy chọn 1 người làm vị trí chính để đại diện quản lý đơn vị.
                  </span>
                </div>
              ) : null}

              {/* Danh sách nhân sự hiện tại */}
              {nodeAssignees.length > 0 ? (
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                  {nodeAssignees.map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-2.5 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="grid size-7 shrink-0 place-items-center rounded-full bg-blue-100 font-semibold text-blue-700 text-xs">
                          {item.user?.fullName ? item.user.fullName.charAt(0).toUpperCase() : 'U'}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 truncate">
                            {item.user?.fullName ?? item.userId}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate">
                            {item.user?.email ?? ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {item.isPrimary ? (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-200">
                            ★ Vị trí chính
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">
                  Chưa có nhân sự được bổ nhiệm vào chức danh này.
                </div>
              )}
            </div>
          ) : null}

          {/* Khối Danh sách Chức danh trực thuộc đơn vị (Chỉ hiển thị cho node Đơn vị - unit) */}
          {!isPositionNode ? (
            <div className="mt-4 pt-4 border-t border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-800">
                  <Briefcase className="size-4 text-blue-600" />
                  <span>Chức danh trực thuộc</span>
                </div>
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 border border-blue-200">
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
                                {/* <span className="text-[10px] text-slate-400 font-mono">
                                  ({pos.code})
                                </span> */}
                                {isHead ? (
                                  <span className="rounded bg-amber-100 px-1.5 py-0.2 text-[10px] font-bold text-amber-800 border border-amber-300 inline-flex items-center gap-0.5">
                                    ★ Quản lý
                                  </span>
                                ) : null}
                              </div>
                              {/* Danh sách nhân sự trong chức danh */}
                              <div className="mt-1 flex items-center gap-1 flex-wrap text-[11px]">
                                {posAssignees.length > 0 ? (
                                  posAssignees.map((a) => (
                                    <span
                                      key={a.id}
                                      className={cn(
                                        'inline-flex items-center gap-1 rounded px-1.5 py-0.2 text-[10px] border',
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
                                  <span className="italic text-slate-400 text-[10px]">
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
                                className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-300 transition cursor-pointer"
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
        <div className="flex shrink-0 items-center justify-between border-t border-slate-100 bg-slate-50/70 p-3 font-sans">
          <span className="text-[11px] text-slate-500 font-medium">{selectedNode.code}</span>
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
