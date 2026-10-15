'use client';
import { useOrganizationPermissions } from './organization-permissions';

import { Pencil, Plus, Search, Trash2, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { CollapsibleGroup } from '../collapsible-group';
import type { Assignment, Node, OrganizationSnapshot } from './organization-workspace';

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(-2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?'
  );
}

export function OrganizationAssignmentTable({
  assignments,
  nodes,
  users,
  onOpenCreate,
  onEdit,
  onDelete,
}: {
  assignments: Assignment[];
  nodes: Node[];
  users: OrganizationSnapshot['users'];
  onOpenCreate: () => void;
  onEdit: (assignment: Assignment) => void;
  onDelete: (assignment: Assignment) => Promise<void> | void;
}) {
  const { canCreate, canUpdate, canDelete } = useOrganizationPermissions();
  const [searchTerm, setSearchTerm] = useState('');
  const [primaryFilter, setPrimaryFilter] = useState<'all' | 'primary' | 'secondary'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const filteredAssignments = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return assignments.filter((item) => {
      const user = userMap.get(item.userId);
      const node = nodeMap.get(item.nodeId);
      const userName = user?.fullName?.toLowerCase() ?? '';
      const userEmail = user?.email?.toLowerCase() ?? '';
      const nodeName = node?.name?.toLowerCase() ?? '';
      const nodeCode = node?.code?.toLowerCase() ?? '';
      const note = item.note?.toLowerCase() ?? '';

      const matchesSearch =
        !query ||
        userName.includes(query) ||
        userEmail.includes(query) ||
        nodeName.includes(query) ||
        nodeCode.includes(query) ||
        note.includes(query);

      const matchesPrimary =
        primaryFilter === 'all' ||
        (primaryFilter === 'primary' && item.isPrimary) ||
        (primaryFilter === 'secondary' && !item.isPrimary);

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && item.status === 'active') ||
        (statusFilter === 'inactive' && item.status !== 'active');

      return matchesSearch && matchesPrimary && matchesStatus;
    });
  }, [assignments, nodeMap, userMap, searchTerm, primaryFilter, statusFilter]);

  const primaryCount = assignments.filter((a) => a.isPrimary).length;
  const secondaryCount = assignments.filter((a) => !a.isPrimary).length;
  const filtersActive = Boolean(searchTerm || primaryFilter !== 'all' || statusFilter !== 'all');

  // Nhóm theo vai trò bổ nhiệm, thay cho cột "Vai trò" lặp lại ở mọi dòng.
  const groups = [
    {
      id: 'primary',
      title: 'Bổ nhiệm chính',
      tone: 'bg-blue-100 text-blue-800',
      rows: filteredAssignments.filter((a) => a.isPrimary),
    },
    {
      id: 'secondary',
      title: 'Kiêm nhiệm',
      tone: 'bg-amber-100 text-amber-700',
      rows: filteredAssignments.filter((a) => !a.isPrimary),
    },
  ].filter((group) => group.rows.length > 0);

  return (
    <div className="flex flex-col gap-3.5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex h-[38px] min-w-[220px] flex-[0_1_320px] items-center gap-2 rounded-lg border border-[#eef0f3] bg-white px-3 text-slate-500 focus-within:border-[#ffc90a]">
          <Search className="size-4 shrink-0" aria-hidden />
          <input
            type="search"
            aria-label="Tìm bổ nhiệm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Tìm nhân sự, vị trí bổ nhiệm…"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-[#18181b] outline-none placeholder:text-slate-400"
          />
        </label>
        <select
          aria-label="Vai trò bổ nhiệm"
          value={primaryFilter}
          onChange={(e) => setPrimaryFilter(e.target.value as typeof primaryFilter)}
          className="h-[38px] rounded-lg border border-[#eef0f3] bg-white px-2.5 text-[14px] text-slate-700"
        >
          <option value="all">Tất cả vai trò</option>
          <option value="primary">Bổ nhiệm chính</option>
          <option value="secondary">Kiêm nhiệm</option>
        </select>
        <select
          aria-label="Trạng thái bổ nhiệm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="h-[38px] rounded-lg border border-[#eef0f3] bg-white px-2.5 text-[14px] text-slate-700"
        >
          <option value="all">Tất cả trạng thái</option>
          <option value="active">Đang hoạt động</option>
          <option value="inactive">Đã kết thúc / Khác</option>
        </select>
        {filtersActive ? (
          <button
            type="button"
            onClick={() => {
              setSearchTerm('');
              setPrimaryFilter('all');
              setStatusFilter('all');
            }}
            className="cursor-pointer text-xs text-slate-500 hover:text-slate-700 hover:underline"
          >
            Xoá bộ lọc
          </button>
        ) : null}
        <span className="flex-1" />
        <Button
          disabled={!canCreate}
          onClick={onOpenCreate}
          className="h-[38px] shrink-0 gap-1.5 bg-[#ffc90a] text-[14px] font-bold text-[#18181b] hover:bg-[#ffd84d]"
        >
          <Plus className="size-4" />
          Bổ nhiệm người dùng
        </Button>
      </div>

      {groups.map((group) => {
        const showAll = expandedGroups.has(group.id) || filtersActive;
        const visible = showAll ? group.rows : group.rows.slice(0, GROUP_PREVIEW);
        const more = group.rows.length - visible.length;
        return (
          <CollapsibleGroup
            count={group.rows.length}
            icon={<UserPlus className="size-4" />}
            key={group.id}
            title={group.title}
            tone={group.tone}
          >
            <div className="overflow-x-auto">
              <div className="min-w-[860px]">
                <div className={`${ROW} py-2 text-[12px] font-semibold tracking-[0.4px] text-slate-500`}>
                  <span>NHÂN SỰ</span>
                  <span>VỊ TRÍ / CHỨC DANH</span>
                  <span>THỜI HẠN BỔ NHIỆM</span>
                  <span>TRẠNG THÁI</span>
                  <span>GHI CHÚ</span>
                  <span className="text-right">THAO TÁC</span>
                </div>
                {visible.map((item) => {
                  const user = userMap.get(item.userId);
                  const node = nodeMap.get(item.nodeId);
                  const userName = user?.fullName || 'Người dùng không xác định';
                  const nodeName = node?.name || 'Vị trí không xác định';
                  return (
                    <div className={`${ROW} py-[11px] text-[14px] hover:bg-[#f4f6f9]/60`} key={item.id}>
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#f1f3f6] text-[12px] font-bold text-slate-700">
                          {initials(userName)}
                        </span>
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-semibold">{userName}</span>
                          {user?.email ? (
                            <span className="truncate text-xs text-slate-500">{user.email}</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-semibold">{nodeName}</span>
                        {node?.code ? (
                          <span className="truncate font-mono text-[12px] text-slate-500">{node.code}</span>
                        ) : null}
                      </div>
                      <span className="text-slate-700 tabular-nums">
                        {item.startDate ? (
                          <>
                            {formatDay(item.startDate)}
                            {item.endDate ? ` → ${formatDay(item.endDate)}` : ' (Hiện tại)'}
                          </>
                        ) : (
                          <span className="text-slate-400">Không thời hạn</span>
                        )}
                      </span>
                      {item.status === 'active' ? (
                        <span className="flex items-center gap-1.5 justify-self-start rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                          <span className="size-1.5 rounded-full bg-emerald-500" />
                          Hoạt động
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 justify-self-start rounded-full bg-[#f1f3f6] px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                          <span className="size-1.5 rounded-full bg-slate-400" />
                          {STATUS_LABELS[item.status] ?? item.status}
                        </span>
                      )}
                      <span className="truncate text-slate-500" title={item.note || undefined}>
                        {item.note || '—'}
                      </span>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          className="grid size-8 cursor-pointer place-items-center rounded-[7px] border border-[#eef0f3] bg-white text-slate-600 hover:bg-[#f4f6f9] disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!canUpdate}
                          onClick={() => onEdit(item)}
                          aria-label="Chỉnh sửa bổ nhiệm"
                          title="Chỉnh sửa bổ nhiệm"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <Popconfirm
                          title="Xoá bổ nhiệm?"
                          description={`Xoá bổ nhiệm của "${userName}" tại "${nodeName}"?`}
                          okText="Xoá"
                          cancelText="Huỷ"
                          okType="danger"
                          placement="left"
                          disabled={!canDelete}
                          onConfirm={() => onDelete(item)}
                        >
                          <button
                            type="button"
                            className="grid size-8 cursor-pointer place-items-center rounded-[7px] border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={!canDelete}
                            aria-label="Xoá bổ nhiệm"
                            title="Xoá bổ nhiệm"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </Popconfirm>
                      </div>
                    </div>
                  );
                })}
                {more > 0 ? (
                  <button
                    type="button"
                    className="block w-full cursor-pointer border-t border-[#f1f3f6] px-5 py-2.5 text-left text-[13px] font-semibold text-blue-700 hover:bg-[#f4f6f9]"
                    onClick={() => setExpandedGroups((prev) => new Set(prev).add(group.id))}
                  >
                    Xem thêm {more} bổ nhiệm
                  </button>
                ) : null}
              </div>
            </div>
          </CollapsibleGroup>
        );
      })}

      {groups.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-slate-200 bg-white py-12 text-center text-sm text-slate-500">
          <UserPlus className="mx-auto size-8 text-slate-300" />
          <p className="mt-2 font-medium">Không tìm thấy bản ghi bổ nhiệm nào.</p>
          <p className="mt-0.5 text-xs text-slate-400">
            Bấm &quot;Bổ nhiệm người dùng&quot; để tạo phân công nhân sự mới.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap justify-between gap-2 text-[13px] text-slate-500">
        <span>
          Hiển thị <b className="text-[#18181b]">{filteredAssignments.length}</b> / {assignments.length} bổ nhiệm
        </span>
        <span>
          {primaryCount} chính • {secondaryCount} kiêm nhiệm
        </span>
      </div>
    </div>
  );
}

/** Số dòng mỗi nhóm hiện sẵn; còn nữa thì bấm "Xem thêm". Đang lọc thì hiện đủ. */
const GROUP_PREVIEW = 10;

const ROW =
  'grid grid-cols-[minmax(220px,1.2fr)_minmax(180px,1fr)_170px_110px_minmax(120px,0.8fr)_76px] items-center gap-x-3 border-t border-[#f1f3f6] px-5';

const STATUS_LABELS: Record<string, string> = {
  inactive: 'Không hoạt động',
  ended: 'Đã kết thúc',
};

/** Ngày dạng yyyy-mm-dd hiển thị dd/mm/yyyy; giá trị khác giữ nguyên. */
function formatDay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}
