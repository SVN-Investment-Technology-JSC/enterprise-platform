'use client';

import {
  Check,
  FileText,
  Loader2,
  Plus,
  Save,
  SlidersHorizontal,
  Trash2,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Assignment, Node, NodeType } from './organization-workspace';

export function OrganizationNodeInspector({
  selectedNode,
  nodes,
  nodeTypes,
  assignments,
  users,
  onSaveNode,
  onDeleteNode,
  onAssignUser,
}: {
  selectedNode?: Node;
  nodes: Node[];
  nodeTypes: NodeType[];
  assignments: Assignment[];
  users: { id: string; fullName: string; email: string }[];
  onSaveNode: (nodeId: string, data: Partial<Node>) => Promise<void>;
  onDeleteNode: (node: Node) => void;
  onAssignUser: (nodeId: string) => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [nodeTypeId, setNodeTypeId] = useState('');
  const [parentId, setParentId] = useState<string | undefined>();
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [activeTab, setActiveTab] = useState<'info' | 'tasks' | 'users'>('info');

  // Sync state whenever selectedNode changes
  useEffect(() => {
    if (selectedNode) {
      setName(selectedNode.name);
      setCode(selectedNode.code);
      setNodeTypeId(selectedNode.nodeTypeId);
      setParentId(selectedNode.parentId);
      setDescription(selectedNode.description ?? '');
      setSavedSuccess(false);
      setActiveTab('info');
    }
  }, [selectedNode]);

  const currentNodeType = useMemo(() => {
    return nodeTypes.find((t) => t.id === nodeTypeId);
  }, [nodeTypes, nodeTypeId]);

  const userMap = useMemo(() => {
    return new Map(users.map((u) => [u.id, u]));
  }, [users]);

  // Current assignees for this node
  const nodeAssignees = useMemo(() => {
    if (!selectedNode) return [];
    return assignments
      .filter((a) => a.nodeId === selectedNode.id && a.status === 'active')
      .map((a) => ({
        ...a,
        user: userMap.get(a.userId),
      }));
  }, [selectedNode, assignments, userMap]);

  // Potential parent nodes (exclude self and self descendants to avoid cycles)
  const availableParents = useMemo(() => {
    if (!selectedNode) return nodes;
    return nodes.filter((n) => n.id !== selectedNode.id);
  }, [nodes, selectedNode]);

  if (!selectedNode) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="grid size-12 place-items-center rounded-full bg-slate-100 text-slate-400">
          <SlidersHorizontal className="size-6" />
        </div>
        <h4 className="mt-3 text-sm font-semibold text-slate-800">
          Thuộc tính Chi tiết
        </h4>
        <p className="mt-1 text-xs text-slate-500 max-w-[220px]">
          Chọn một node bất kỳ trên cây sơ đồ hoặc canvas để xem và cập nhật thông tin.
        </p>
      </div>
    );
  }

  const hasOtherRoot = useMemo(() => {
    return nodes.some(
      (n) =>
        n.treeId === selectedNode?.treeId &&
        !n.parentId &&
        n.id !== selectedNode?.id,
    );
  }, [nodes, selectedNode?.treeId, selectedNode?.id]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !code.trim()) return;
    if (!parentId && hasOtherRoot) {
      alert('Mỗi sơ đồ tổ chức chỉ được phép có 1 node gốc. Vui lòng chọn Node cha.');
      return;
    }
    setSaving(true);
    setSavedSuccess(false);
    try {
      await onSaveNode(selectedNode.id, {
        name: name.trim(),
        code: code.trim(),
        nodeTypeId,
        parentId: parentId || undefined,
        description: description.trim() || undefined,
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="size-4 text-blue-600" />
          <h3 className="text-sm font-bold text-slate-900">Thuộc tính Chi tiết</h3>
        </div>
        <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200">
          {currentNodeType?.name ?? 'Ban / Phòng'}
        </span>
      </div>

      {/* Quick Action Buttons Matching Sketch */}
      <div className="shrink-0 grid grid-cols-2 gap-1.5 border-b border-slate-100 bg-slate-50/50 p-2.5">
        <button
          type="button"
          onClick={() => setActiveTab(activeTab === 'tasks' ? 'info' : 'tasks')}
          className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
            activeTab === 'tasks'
              ? 'border-blue-300 bg-blue-50 text-blue-700'
              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          <FileText className="size-3.5 text-slate-500" />
          <span>Chức năng nhiệm vụ</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab(activeTab === 'users' ? 'info' : 'users')}
          className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
            activeTab === 'users'
              ? 'border-blue-300 bg-blue-50 text-blue-700'
              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          <Users className="size-3.5 text-slate-500" />
          <span>Hồ sơ nhân sự ({nodeAssignees.length})</span>
        </button>
      </div>

      {/* Main Body Form */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {activeTab === 'tasks' ? (
          <div className="space-y-3">
            <h5 className="text-xs font-semibold uppercase text-slate-600">
              Mô tả chức năng & nhiệm vụ
            </h5>
            <textarea
              rows={6}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Nhập phạm vi trách nhiệm, mục tiêu và chức năng chính của đơn vị/chức danh này…"
              className="w-full rounded-md border border-slate-200 p-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-blue-600 text-xs hover:bg-blue-700"
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              Lưu nhiệm vụ
            </Button>
          </div>
        ) : activeTab === 'users' ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h5 className="text-xs font-semibold uppercase text-slate-600">
                Nhân sự bổ nhiệm
              </h5>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-[11px]"
                onClick={() => onAssignUser(selectedNode.id)}
              >
                <Plus className="size-3" />
                Bổ nhiệm
              </Button>
            </div>
            {nodeAssignees.length > 0 ? (
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                {nodeAssignees.map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-2.5 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="grid size-7 shrink-0 place-items-center rounded-full bg-blue-100 font-semibold text-blue-700">
                        {item.user?.fullName ? item.user.fullName.charAt(0).toUpperCase() : 'U'}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 truncate">
                          {item.user?.fullName ?? item.userId}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {item.user?.email ?? (item.isPrimary ? 'Trưởng đơn vị' : 'Thành viên')}
                        </p>
                      </div>
                    </div>
                    {item.isPrimary ? (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-200">
                        Phụ trách
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
                Chưa có nhân sự bổ nhiệm vào vị trí này.
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-3.5">
            {/* Loại đơn vị / Đối tượng */}
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Loại Đơn vị / Đối tượng
              </label>
              <select
                value={nodeTypeId}
                onChange={(e) => setNodeTypeId(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {nodeTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.category === 'unit' ? 'Đơn vị' : 'Chức danh'})
                  </option>
                ))}
              </select>
            </div>

            {/* Tên hiển thị */}
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Tên hiển thị
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="VD: Phòng Kinh Doanh, Ban TGĐ…"
                required
                className="mt-1 h-9 w-full rounded-md border border-slate-200 px-3 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Mã số định danh (Code/MSNV) */}
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Mã số định danh (Code / MSNV)
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="VD: KD-01, NEW-572…"
                required
                className="mt-1 h-9 w-full rounded-md border border-slate-200 px-3 font-mono text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Chức danh / Vị trí đảm nhiệm */}
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Chức danh / Vị trí đảm nhiệm
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="VD: Trưởng phòng, Chuyên viên, Cấp điều hành…"
                className="mt-1 h-9 w-full rounded-md border border-slate-200 px-3 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Đơn vị cấp trên (Parent node) */}
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Trực thuộc đơn vị (Node cha)
              </label>
              <select
                value={parentId ?? ''}
                onChange={(e) => setParentId(e.target.value || undefined)}
                className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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

            {/* Action buttons */}
            <div className="pt-2">
              <Button
                type="submit"
                disabled={saving}
                className="w-full gap-1.5 bg-blue-600 text-xs font-semibold hover:bg-blue-700"
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
        )}
      </div>

      {/* Footer Danger Action */}
      <div className="flex shrink-0 items-center justify-between border-t border-slate-100 bg-slate-50/70 p-3">
        <span className="text-[11px] text-slate-400 font-mono">{selectedNode.code}</span>
        <button
          type="button"
          onClick={() => onDeleteNode(selectedNode)}
          className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700 hover:underline"
        >
          <Trash2 className="size-3.5" />
          <span>Xoá node này</span>
        </button>
      </div>
    </div>
  );
}
