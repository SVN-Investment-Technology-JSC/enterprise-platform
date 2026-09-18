'use client';

import {
  Check,
  Loader2,
  Save,
  SlidersHorizontal,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  ConfigProvider,
  Popconfirm,
  Radio,
  Select,
} from 'antd';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import type { Assignment, Node, NodeType } from './organization-workspace';

export function OrganizationNodeInspector({
  selectedNode,
  nodes,
  nodeTypes,
  assignments,
  users,
  onSaveNode,
  onDeleteNode,
  onQuickAssign,
  onQuickUnassign,
  onCreateNodeType,
}: {
  selectedNode?: Node;
  nodes: Node[];
  nodeTypes: NodeType[];
  assignments: Assignment[];
  users: { id: string; fullName: string; email: string }[];
  onSaveNode: (nodeId: string, data: Partial<Node>) => Promise<void>;
  onDeleteNode: (node: Node) => void;
  onAssignUser?: (nodeId: string) => void;
  onQuickAssign?: (nodeId: string, userId: string, isPrimary?: boolean) => Promise<unknown>;
  onQuickUnassign?: (assignmentId: string) => Promise<unknown>;
  onCreateNodeType?: (data: { code: string; name: string; category: 'unit' | 'position' }) => Promise<NodeType | undefined>;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [category, setCategory] = useState<'unit' | 'position'>('unit');
  const [parentId, setParentId] = useState<string | undefined>();
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Quick assignment form states for position nodes (supports multiple selection)
  const [assignUserIds, setAssignUserIds] = useState<string[]>([]);
  const [assignIsPrimary, setAssignIsPrimary] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [unassigningId, setUnassigningId] = useState<string | undefined>();

  // Sync state only when switching to a different node by ID (prevents dirty field wipe-out)
  useEffect(() => {
    if (selectedNode) {
      setName(selectedNode.name);
      setCode(selectedNode.code);
      const cat =
        selectedNode.category ??
        nodeTypes.find((t) => t.id === selectedNode.nodeTypeId)?.category ??
        'unit';
      setCategory(cat);
      setParentId(selectedNode.parentId);
      setDescription(selectedNode.description ?? '');
      setSavedSuccess(false);
      setAssignUserIds([]);
      setAssignIsPrimary(false);
    }
  }, [selectedNode?.id, selectedNode?.category, selectedNode?.nodeTypeId, nodeTypes]);

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

  // Users available for assignment (exclude those already assigned)
  const availableUsersToAssign = useMemo(() => {
    const assignedIds = new Set(nodeAssignees.map((a) => a.userId));
    return users.filter((u) => !assignedIds.has(u.id));
  }, [users, nodeAssignees]);

  // Potential parent nodes (exclude self and avoid cycles)
  const availableParents = useMemo(() => {
    if (!selectedNode) return nodes;
    return nodes.filter((n) => n.id !== selectedNode.id);
  }, [nodes, selectedNode]);

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
        nodeTypeId:
          nodeTypes.find((t) => t.category === category)?.id ??
          selectedNode.nodeTypeId,
        parentId: parentId || undefined,
        description: description.trim(),
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const handleQuickAssignSubmit = async () => {
    if (assignUserIds.length === 0 || !onQuickAssign) return;
    setAssigning(true);
    try {
      for (const uid of assignUserIds) {
        await onQuickAssign(selectedNode.id, uid, assignIsPrimary);
      }
      const count = assignUserIds.length;
      setAssignUserIds([]);
      setAssignIsPrimary(false);
      toast.success(
        count === 1
          ? 'Đã bổ nhiệm nhân sự vào chức danh thành công!'
          : `Đã bổ nhiệm ${count} nhân sự vào chức danh thành công!`,
      );
    } catch {
      toast.error('Không thể thực hiện bổ nhiệm.');
    } finally {
      setAssigning(false);
    }
  };

  const handleUnassignUser = async (assignmentId: string) => {
    if (!onQuickUnassign) return;
    setUnassigningId(assignmentId);
    try {
      await onQuickUnassign(assignmentId);
      toast.success('Đã bãi nhiệm nhân sự khỏi vị trí thành công!');
    } catch {
      toast.error('Không thể bãi nhiệm nhân sự.');
    } finally {
      setUnassigningId(undefined);
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
          Radio: {
            fontSize: 12,
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
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          <form onSubmit={handleSave} className="space-y-3.5">
            {/* Tên đơn vị / chức danh */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tên đơn vị / Chức danh
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

            {/* Phân loại Đối tượng: 2 Radio Đơn vị / Chức danh */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Phân loại Đối tượng
              </label>
              <Radio.Group
                className="w-full grid grid-cols-2 gap-2"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <Radio.Button
                  value="unit"
                  className={cn(
                    'h-9 flex items-center justify-center gap-1.5 rounded-md text-xs font-medium border text-center transition-all cursor-pointer',
                    category === 'unit'
                      ? 'border-blue-600 bg-blue-50 text-blue-700 font-semibold shadow-xs'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700',
                  )}
                >
                  <span className="text-sm">🏢</span> Đơn vị (Unit)
                </Radio.Button>
                <Radio.Button
                  value="position"
                  className={cn(
                    'h-9 flex items-center justify-center gap-1.5 rounded-md text-xs font-medium border text-center transition-all cursor-pointer',
                    category === 'position'
                      ? 'border-purple-600 bg-purple-50 text-purple-700 font-semibold shadow-xs'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700',
                  )}
                >
                  <span className="text-sm">👤</span> Chức danh (Position)
                </Radio.Button>
              </Radio.Group>
              <p className="mt-1 text-[11px] text-slate-400">
                {category === 'unit'
                  ? 'Đơn vị (phòng, ban, khối...) có thể chứa các đơn vị hoặc chức danh con trực thuộc.'
                  : 'Chức danh (vị trí đảm nhiệm) là node lá trực thuộc đơn vị, cho phép bổ nhiệm nhân sự.'}
              </p>
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

            {/* Mô tả chức năng & nhiệm vụ */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Mô tả chức năng & nhiệm vụ
              </label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Mô tả chức năng, nhiệm vụ và phạm vi trách nhiệm của đơn vị / chức danh này…"
                className="w-full rounded-md border border-slate-200 bg-white p-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 leading-relaxed"
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
                    ? '— Đã có node gốc (Mỗi sơ đồ chỉ có 1 node gốc) —'
                    : 'Không có (Node gốc / Cấp cao nhất)'}
                </option>
                {availableParents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
              {hasOtherRoot ? (
                <p className="mt-1 text-[11px] text-amber-600">
                  Sơ đồ này đã có node gốc. Mỗi sơ đồ chỉ được phép tạo 1 node gốc duy nhất.
                </p>
              ) : null}
            </div>

            {/* Save Button */}
            <div className="pt-1">
              <Button
                type="submit"
                disabled={saving}
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
                            Vị trí chính
                          </span>
                        ) : null}
                        <Popconfirm
                          title="Bãi nhiệm nhân sự?"
                          description={`Bãi nhiệm ${item.user?.fullName ?? 'nhân sự này'} khỏi chức danh "${selectedNode.name}"?`}
                          okText="Bãi nhiệm"
                          cancelText="Huỷ"
                          okButtonProps={{ danger: true }}
                          placement="left"
                          onConfirm={() => handleUnassignUser(item.id)}
                        >
                          <button
                            type="button"
                            disabled={unassigningId === item.id}
                            className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                            title="Bãi nhiệm khỏi vị trí"
                          >
                            {unassigningId === item.id ? (
                              <Loader2 className="size-3.5 animate-spin text-red-500" />
                            ) : (
                              <UserMinus className="size-3.5" />
                            )}
                          </button>
                        </Popconfirm>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">
                  Chưa có nhân sự được bổ nhiệm vào chức danh này.
                </div>
              )}

              {/* Form Bổ nhiệm nhanh tại chỗ (Hỗ trợ multiple selection) */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <UserPlus className="size-3.5 text-blue-600" />
                  <span>Bổ nhiệm nhanh nhân sự vào vị trí</span>
                </div>
                <div className="space-y-2">
                  <Select
                    mode="multiple"
                    showSearch
                    allowClear
                    className="w-full text-xs"
                    placeholder="Tìm và chọn nhân sự bổ nhiệm..."
                    value={assignUserIds}
                    onChange={(vals: string[]) => setAssignUserIds(vals)}
                    filterOption={(input, option) =>
                      (option?.searchStr ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                    popupMatchSelectWidth={false}
                    dropdownStyle={{ minWidth: 320, maxWidth: 460 }}
                    options={availableUsersToAssign.map((u) => ({
                      value: u.id,
                      label: `${u.fullName} (${u.email})`,
                      searchStr: `${u.fullName} ${u.email}`,
                      user: u,
                    }))}
                    optionRender={(option) => {
                      const u = option.data.user as { fullName: string; email: string };
                      return (
                        <div className="flex items-center gap-2.5 py-1.5 whitespace-normal break-words leading-tight">
                          <div className="grid size-7 shrink-0 place-items-center rounded-full bg-blue-100 font-bold text-xs text-blue-700">
                            {u?.fullName ? u.fullName.charAt(0).toUpperCase() : 'U'}
                          </div>
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="font-semibold text-xs text-slate-900 break-words">
                              {u?.fullName}
                            </span>
                            <span className="text-[11px] text-slate-500 break-all font-normal">
                              {u?.email}
                            </span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={assignIsPrimary}
                        onChange={(e) => setAssignIsPrimary(e.target.checked)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span>Đặt làm vị trí chính</span>
                    </label>
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white gap-1"
                      disabled={assignUserIds.length === 0 || assigning}
                      onClick={handleQuickAssignSubmit}
                    >
                      {assigning ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Check className="size-3" />
                      )}
                      <span>
                        {assigning
                          ? 'Đang bổ nhiệm…'
                          : assignUserIds.length > 0
                            ? `Bổ nhiệm (${assignUserIds.length})`
                            : 'Bổ nhiệm'}
                      </span>
                    </Button>
                  </div>
                </div>
              </div>
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
