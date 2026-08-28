'use client';

import type { TenantOrganizationSnapshot } from '@enterprise-platform/contracts-organization';
import type {
  ProcedureAttachment,
  ProcedureDefinition,
  ProcedureInstance,
  ProcedureInstanceStep,
  ProcedureRaciRole,
  ProcedureRuntimeAction,
  ProcedureSubtaskExecutionMode,
  ProcedureSubtaskInput,
  RequestProcedureMaterialsRequest,
} from '@enterprise-platform/contracts-procedure-engine';
import {
  evaluateInstanceSla,
  evaluateStepSla,
  type ProcedureSlaView,
} from '@enterprise-platform/contracts-procedure-engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AssetCatalogItem, MaterialCatalogItem } from '../procedure-api';
import { AttachmentPanel } from './attachment-panel';
import { ChatPanel } from './chat-panel';
import { HistoryPanel } from './history-panel';
import { LinkedPanel } from './linked-panel';
import { SlaBadge } from './sla-badge';
import { SubtaskPanel } from './subtask-panel';
import styles from './workspace-board.module.scss';

type Filter = 'all' | 'urgent' | ProcedureInstance['status'];

const STATUS_LABEL: Record<ProcedureInstance['status'], string> = {
  running: 'Đang xử lý',
  completed: 'Hoàn thành',
  rejected: 'Từ chối',
  cancelled: 'Đã huỷ',
};

const STEP_STATUS_LABEL: Record<string, string> = {
  pending: 'Chờ xử lý',
  running: 'Đang thực hiện',
  completed: 'Hoàn thành',
  rejected: 'Từ chối',
  returned: 'Trả lại',
  cancelled: 'Đã huỷ',
};

const ACTION_LABEL: Record<ProcedureRuntimeAction, string> = {
  approve: 'Phê duyệt',
  reject: 'Từ chối',
  return: 'Trả lại',
  complete: 'Hoàn tất',
  cancel: 'Huỷ hồ sơ',
  comment: 'Ghi nhận trao đổi',
};

const ROLE_ORDER: readonly ProcedureRaciRole[] = ['S', 'R', 'E', 'C', 'A', 'I'];

const dateTime = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function formatDateTime(value?: string): string {
  return value ? dateTime.format(new Date(value)) : '—';
}

function subjectNames(snapshot?: TenantOrganizationSnapshot) {
  const label = new Map<string, string>();
  if (!snapshot) return label;

  const units = snapshot.units ?? [];
  const positions = snapshot.positions ?? [];
  const members = snapshot.members ?? [];

  for (const unit of units) {
    label.set(unit.id, unit.headName ? `${unit.headName} (${unit.name})` : unit.name);
  }
  for (const position of positions) {
    const holders = members
      .filter((member) => member.positionId === position.id)
      .map((member) => member.displayName);
    label.set(position.id, holders.length > 0 ? holders.join(', ') : position.name);
  }
  for (const member of members) label.set(member.userId, member.displayName);
  return label;
}

function participantsOf(
  instance: ProcedureInstance,
  names: ReadonlyMap<string, string>,
): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const step of instance.steps) {
    for (const assignment of step.assignments) {
      const label = names.get(assignment.subjectId) ?? assignment.subjectLabel;
      if (label) seen.set(assignment.subjectId, label);
    }
  }
  for (const subtask of instance.subtasks ?? []) {
    if (subtask.assigneeId && subtask.assigneeName) seen.set(subtask.assigneeId, subtask.assigneeName);
  }
  return [...seen].map(([id, name]) => ({ id, name }));
}

function roleLines(step: ProcedureInstanceStep, names: ReadonlyMap<string, string>) {
  return ROLE_ORDER.flatMap((role) => {
    const holders = step.assignments
      .filter((item) => item.role === role)
      .map((item) => names.get(item.subjectId) ?? item.subjectLabel ?? item.subjectId);
    return holders.length > 0 ? [{ role, names: holders.join(', ') }] : [];
  });
}

function getProcedureCategory(def: ProcedureDefinition): string {
  if (def.category) return def.category;
  const name = def.name.toLowerCase();
  const code = def.code.toLowerCase();
  if (
    code.includes('bt') ||
    code.includes('tn') ||
    name.includes('bảo trì') ||
    name.includes('thí nghiệm') ||
    name.includes('máy biến áp')
  ) {
    return 'Kỹ thuật & Bảo trì';
  }
  if (
    code.includes('mua') ||
    code.includes('kiem-ke') ||
    code.includes('muon') ||
    name.includes('vật tư') ||
    name.includes('kiểm kê') ||
    name.includes('kho') ||
    name.includes('dụng cụ')
  ) {
    return 'Vật tư & Kho vận';
  }
  if (
    code.includes('nghi-phep') ||
    code.includes('tuyen-dung') ||
    code.includes('dao-tao') ||
    name.includes('nghỉ phép') ||
    name.includes('tuyển dụng') ||
    name.includes('đào tạo') ||
    name.includes('nhân sự')
  ) {
    return 'Hành chính & Nhân sự';
  }
  if (
    code.includes('ngan-sach') ||
    code.includes('tam-ung') ||
    code.includes('tt-ncc') ||
    code.includes('chu-truong') ||
    name.includes('ngân sách') ||
    name.includes('tạm ứng') ||
    name.includes('thanh toán') ||
    name.includes('đầu tư')
  ) {
    return 'Tài chính & Kế toán';
  }
  if (
    code.includes('hd-kh') ||
    code.includes('bao-gia') ||
    code.includes('khkd') ||
    code.includes('cskh') ||
    name.includes('hợp đồng') ||
    name.includes('báo giá') ||
    name.includes('kinh doanh') ||
    name.includes('khách hàng')
  ) {
    return 'Kinh doanh & CSKH';
  }
  return 'Quy trình khác';
}

function getProcedureIcon(def: ProcedureDefinition): string {
  const cat = getProcedureCategory(def);
  if (cat.includes('Kỹ thuật') || cat.includes('Bảo trì')) return '⚡';
  if (cat.includes('Vật tư') || cat.includes('Kho')) return '📦';
  if (cat.includes('Hành chính') || cat.includes('Nhân sự')) return '👥';
  if (cat.includes('Tài chính') || cat.includes('Kế toán')) return '💰';
  if (cat.includes('Kinh doanh') || cat.includes('CSKH')) return '🤝';
  return '📋';
}

export function WorkspaceBoard({
  busy,
  materialCatalog = [],
  assetCatalog = [],
  groups = [],
  onPickAsset,
  onRequestMaterials,
  actorName,
  actorId,
  organization,
  definitions,
  instances,
  onAction,
  onOpenDefinitions,
  onStart,
  attachments = [],
  onSeedSubtasks,
  onRecheckMaterials,
  onSetSubtasks,
  onCompleteSubtask,
  onCancelSubtask,
  onUploadEvidence,
  onUploadFile,
  onSendComment,
  handoffTitle,
}: {
  busy?: string;
  groups?: readonly { code: string; label: string }[];
  materialCatalog?: readonly MaterialCatalogItem[];
  assetCatalog?: readonly { code: string; name: string }[];
  onPickAsset?: (instanceId: string, assetCode: string) => void;
  onRequestMaterials?: (
    instanceId: string,
    input: RequestProcedureMaterialsRequest,
  ) => void;
  actorName?: string;
  actorId?: string;
  organization?: TenantOrganizationSnapshot;
  definitions: ProcedureDefinition[];
  instances: ProcedureInstance[];
  onAction: (
    instanceId: string,
    action: ProcedureRuntimeAction,
    comment?: string,
    returnToStepId?: string,
  ) => Promise<void>;
  onOpenDefinitions: () => void;
  onStart: (definition: ProcedureDefinition) => Promise<void>;
  attachments?: readonly ProcedureAttachment[];
  onSeedSubtasks?: (instanceId: string) => void;
  onRecheckMaterials?: (instanceId: string) => void;
  onSetSubtasks?: (
    instanceId: string,
    items: ProcedureSubtaskInput[],
    executionMode: ProcedureSubtaskExecutionMode,
  ) => void;
  onCompleteSubtask?: (instanceId: string, subtaskId: string) => void;
  onCancelSubtask?: (instanceId: string, subtaskId: string) => void;
  onUploadEvidence?: (instanceId: string, subtaskId: string, file: File) => void;
  onUploadFile?: (instanceId: string, file: File) => void;
  onSendComment?: (instanceId: string, body: string, mentions: string[], replyToId?: string) => void;
  handoffTitle?: string;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [viewMode, setViewMode] = useState<'list' | 'table'>('table');
  const [query, setQuery] = useState('');
  const [slaFilter, setSlaFilter] = useState<'all' | ProcedureSlaView['state']>('all');
  const [source, setSource] = useState<'all' | 'manual' | 'maintenance_occurrence' | 'auto_from_parent'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [activeTabModal, setActiveTabModal] = useState<'chat' | 'files' | 'history' | null>(null);
  const [activeStepDrawer, setActiveStepDrawer] = useState<{ step: ProcedureInstanceStep; tab: 'execution' | 'chat' | 'files' } | null>(null);
  const [comment, setComment] = useState('');
  const [dateSort, setDateSort] = useState<'newest' | 'oldest'>('newest');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [creating, setCreating] = useState(false);
  const [createSearch, setCreateSearch] = useState('');
  const [createCategory, setCreateCategory] = useState('all');
  const [selectedCreateDefId, setSelectedCreateDefId] = useState<string>();
  const [attachQueue, setAttachQueue] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (handoffTitle) setCreating(true);
  }, [handoffTitle]);

  const published = definitions.filter((item) => item.status === 'published');
  const names = useMemo(() => subjectNames(organization), [organization]);

  const definitionCategories = useMemo(() => {
    const map = new Map<string, number>();
    published.forEach((def) => {
      const cat = getProcedureCategory(def);
      map.set(cat, (map.get(cat) ?? 0) + 1);
    });
    return Array.from(map.entries()).map(([name, count]) => ({ name, count }));
  }, [published]);

  const filteredDefinitions = useMemo(() => {
    const q = createSearch.trim().toLowerCase();
    return published.filter((def) => {
      if (createCategory !== 'all' && getProcedureCategory(def) !== createCategory) {
        return false;
      }
      if (!q) return true;
      return (
        def.code.toLowerCase().includes(q) ||
        def.name.toLowerCase().includes(q) ||
        (def.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [published, createSearch, createCategory]);

  const selectedCreateDef = useMemo(() => {
    return filteredDefinitions.find((d) => d.id === selectedCreateDefId) ?? filteredDefinitions[0];
  }, [filteredDefinitions, selectedCreateDefId]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const fromTime = from ? new Date(`${from}T00:00:00`).getTime() : undefined;
    const toTime = to ? new Date(`${to}T23:59:59.999`).getTime() : undefined;

    const matched = instances.filter((instance) => {
      if (filter === 'urgent') {
        const sla = evaluateInstanceSla(instance);
        if (instance.status !== 'running' || (sla.state !== 'breached' && sla.state !== 'warning')) return false;
      } else if (filter !== 'all' && instance.status !== filter) {
        return false;
      }

      if (source !== 'all' && (instance.sourceType ?? 'manual') !== source) return false;
      if (slaFilter !== 'all' && evaluateInstanceSla(instance).state !== slaFilter) return false;

      const started = Date.parse(instance.startedAt);
      if (fromTime !== undefined && started < fromTime) return false;
      if (toTime !== undefined && started > toTime) return false;

      if (!needle) return true;
      return (
        instance.code.toLowerCase().includes(needle) ||
        instance.title.toLowerCase().includes(needle) ||
        instance.definitionName.toLowerCase().includes(needle)
      );
    });

    return [...matched].sort((left, right) =>
      dateSort === 'newest'
        ? right.startedAt.localeCompare(left.startedAt)
        : left.startedAt.localeCompare(right.startedAt),
    );
  }, [filter, instances, query, source, slaFilter, from, to, dateSort]);

  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paged = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const filtersActive =
    source !== 'all' || slaFilter !== 'all' || Boolean(from) || Boolean(to);

  const selected =
    visible.find((instance) => instance.id === selectedId) ?? paged[0] ?? visible[0];

  const [headerCancelOpen, setHeaderCancelOpen] = useState(false);

  useEffect(() => {
    setComment('');
    setAttachQueue([]);
    setHeaderCancelOpen(false);
  }, [selected?.id]);

  /** Upload queued files first, then execute the workflow action */
  const handleActionWithAttach = async (
    instanceId: string,
    action: ProcedureRuntimeAction,
    comment?: string,
    returnToStepId?: string,
  ) => {
    setIsSubmitting(true);
    try {
      if (attachQueue.length > 0 && onUploadFile) {
        for (const file of attachQueue) {
          onUploadFile(instanceId, file);
        }
        setAttachQueue([]);
        await new Promise<void>((r) => setTimeout(r, 300));
      }
      await onAction(instanceId, action, comment, returnToStepId);
    } finally {
      setIsSubmitting(false);
    }
  };

  const exportExcel = () => {
    const csvContent = [
      ['Mã hồ sơ', 'Tiêu đề', 'Quy trình', 'Trạng thái', 'Ngày bắt đầu'].join(','),
      ...visible.map((i) => [
        `"${i.code}"`,
        `"${i.title.replace(/"/g, '""')}"`,
        `"${i.definitionName.replace(/"/g, '""')}"`,
        `"${STATUS_LABEL[i.status]}"`,
        `"${formatDateTime(i.startedAt)}"`,
      ].join(',')),
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Workspace_Ho_So_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Thống kê tổng quan 5 chỉ số
  const stats = useMemo(() => {
    const total = instances.length;
    const processing = instances.filter((i) => i.status === 'running').length;
    const completed = instances.filter((i) => i.status === 'completed').length;
    const rejected = instances.filter((i) => i.status === 'rejected').length;
    const cancelled = instances.filter((i) => i.status === 'cancelled').length;
    const urgent = instances.filter((inst) => {
      const sla = evaluateInstanceSla(inst);
      return inst.status === 'running' && (sla.state === 'breached' || sla.state === 'warning');
    }).length;
    return { total, processing, completed, rejected, cancelled, urgent };
  }, [instances]);

  return (
    <section className={styles.workspace}>
      {/* ========================================================================= */}
      {/* 1. TOP HEADER                                                             */}
      {/* ========================================================================= */}
      <header className={styles.topBar}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h1>Workspace xử lý</h1>
            <span
              style={{
                background: 'rgba(37, 99, 235, 0.1)',
                color: '#2563eb',
                fontWeight: 700,
                fontSize: '12px',
                padding: '2px 9px',
                borderRadius: '999px',
                border: '1px solid rgba(37, 99, 235, 0.2)',
              }}
            >
              {instances.length} hồ sơ
            </span>
          </div>
          <p>
            Quản lý tập trung các quy trình bạn giữ vai trò (R, A, C, S, I) — tích hợp Node Workspace 3 trục cùng Vertical Timeline.
          </p>
        </div>
        <div className={styles.topActions}>
          <button
            type="button"
            className={styles.ghost}
            onClick={exportExcel}
            title="Xuất file danh sách CSV"
          >
            📥 Xuất Excel
          </button>
          {published.length > 0 ? (
            <button
              type="button"
              className={styles.primary}
              onClick={() => setCreating((open) => !open)}
            >
              <span aria-hidden="true">⊕</span> Tạo Đơn / Yêu cầu Mới
            </button>
          ) : null}
        </div>
      </header>

      {creating ? (
        <div
          className={styles.createModalBackdrop}
          onClick={(e) => {
            if (e.target === e.currentTarget) setCreating(false);
          }}
        >
          <div className={styles.createModalDialog}>
            {/* Header */}
            <div className={styles.createModalHead}>
              <div>
                <h3 className={styles.createModalTitle}>
                  📋 Khởi tạo Đơn / Yêu cầu Quy trình Mới
                </h3>
                <p className={styles.createModalSubtitle}>
                  {handoffTitle
                    ? `Chọn quy trình tiếp nối cho: ${handoffTitle}`
                    : `Chọn 1 trong ${published.length} quy trình đã ban hành để mở hồ sơ xử lý`}
                </p>
              </div>
              <button
                type="button"
                className={styles.modalCloseBtn}
                aria-label="Đóng"
                onClick={() => setCreating(false)}
              >
                ✕
              </button>
            </div>

            {/* Search & Category Dropdown Filter Toolbar */}
            <div className={styles.createModalToolbar}>
              <div className={styles.createSearchWrapper}>
                <span className={styles.createSearchIcon}>🔍</span>
                <input
                  type="text"
                  className={styles.createSearchInput}
                  placeholder="Tìm theo mã (QT-BT-MBA), tên quy trình, từ khóa..."
                  value={createSearch}
                  onChange={(e) => setCreateSearch(e.target.value)}
                  autoFocus
                />
                {createSearch ? (
                  <button
                    type="button"
                    className={styles.createSearchClear}
                    onClick={() => setCreateSearch('')}
                  >
                    ✕
                  </button>
                ) : null}
              </div>

              {/* Category Select Filter */}
              <div className={styles.createFilterSelectWrapper}>
                <select
                  className={styles.createFilterSelect}
                  value={createCategory}
                  onChange={(e) => setCreateCategory(e.target.value)}
                >
                  <option value="all">📂 Tất cả danh mục ({published.length})</option>
                  {definitionCategories.map((cat) => (
                    <option key={cat.name} value={cat.name}>
                      {cat.name} ({cat.count})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Scrollable Catalog Table */}
            <div className={styles.createCatalogScroll}>
              {filteredDefinitions.length > 0 ? (
                <div className={styles.createTableWrapper}>
                  <table className={styles.createTable}>
                    <thead>
                      <tr>
                        <th style={{ width: '36px', textAlign: 'center' }}></th>
                        <th style={{ width: '130px' }}>Mã quy trình</th>
                        <th>Tên &amp; Mô tả quy trình</th>
                        <th style={{ width: '160px' }}>Nhóm danh mục</th>
                        <th style={{ width: '240px' }}>Tiến trình</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDefinitions.map((definition) => {
                        const icon = getProcedureIcon(definition);
                        const category = getProcedureCategory(definition);
                        const isSelected = selectedCreateDef?.id === definition.id;
                        const isBusy = busy === `start:${definition.id}`;
                        return (
                          <tr
                            key={definition.id}
                            className={`${styles.createTableRow} ${isSelected ? styles.createTableRowActive : ''}`}
                            onClick={() => setSelectedCreateDefId(definition.id)}
                            onDoubleClick={() => {
                              if (!isBusy) {
                                void onStart(definition).then(() => setCreating(false));
                              }
                            }}
                          >
                            <td style={{ textAlign: 'center' }}>
                              <input
                                type="radio"
                                name="selectedProcedure"
                                checked={isSelected}
                                onChange={() => setSelectedCreateDefId(definition.id)}
                                style={{ cursor: 'pointer' }}
                              />
                            </td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '15px' }}>{icon}</span>
                                <span className={styles.createTableCode}>{definition.code}</span>
                              </div>
                            </td>
                            <td>
                              <div className={styles.createTableNameCol}>
                                <strong className={styles.createTableName}>{definition.name}</strong>
                                {definition.description ? (
                                  <span className={styles.createTableDesc}>{definition.description}</span>
                                ) : null}
                              </div>
                            </td>
                            <td>
                              <span className={styles.createTableCategoryTag}>{category}</span>
                            </td>
                            <td>
                              <div className={styles.createTableWorkflow}>
                                <span className={styles.createTableStepsBadge}>
                                  {definition.steps.length} bước
                                </span>
                                <div className={styles.createStepPillsList}>
                                  {definition.steps.slice(0, 2).map((st, i) => (
                                    <span key={st.id} className={styles.createStepPill}>
                                      {i + 1}. {st.name}
                                    </span>
                                  ))}
                                  {definition.steps.length > 2 ? (
                                    <span className={styles.createStepMore}>
                                      +{definition.steps.length - 2}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className={styles.createEmptyState}>
                  <span style={{ fontSize: '32px' }}>🔍</span>
                  <p>
                    Không tìm thấy quy trình nào khớp với <strong>"{createSearch}"</strong>
                  </p>
                  <button
                    type="button"
                    className={styles.ghost}
                    onClick={() => {
                      setCreateSearch('');
                      setCreateCategory('all');
                    }}
                  >
                    Xem tất cả quy trình
                  </button>
                </div>
              )}
            </div>

            {/* Footer with Đóng and + Mở đơn buttons side-by-side */}
            <div className={styles.createModalFoot}>
              <span className={styles.createModalHint}>
                Hiển thị <strong>{filteredDefinitions.length}</strong> / {published.length} quy trình
                {selectedCreateDef ? (
                  <> · Đang chọn: <strong style={{ color: 'var(--ink)' }}>{selectedCreateDef.name}</strong></>
                ) : null}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  className={styles.ghost}
                  onClick={() => setCreating(false)}
                >
                  Đóng
                </button>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={!selectedCreateDef || (selectedCreateDef && busy === `start:${selectedCreateDef.id}`)}
                  onClick={() => {
                    if (selectedCreateDef) {
                      void onStart(selectedCreateDef).then(() => setCreating(false));
                    }
                  }}
                >
                  {selectedCreateDef && busy === `start:${selectedCreateDef.id}`
                    ? 'Đang mở đơn…'
                    : '+ Mở đơn'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ========================================================================= */}
      {/* 3. 16:9 SPLIT GRID: MASTER (LEFT) & DETAIL (RIGHT)                        */}
      {/* ========================================================================= */}
      <div className={styles.masterDetailGrid}>

        {/* ======================================================================= */}
        {/* LEFT COLUMN: FILTERS + SEARCH + MASTER LIST (CARDS / TABLE)             */}
        {/* ======================================================================= */}
        <div className={styles.leftMasterCard}>
          {/* Search & Filter Toolbar */}
          <div className={styles.toolbarRow}>
            <div className={styles.searchWrapper}>
              <span className={styles.searchIcon}>🔍</span>
              <input
                className={styles.search}
                placeholder="Tìm mã PROC, tiêu đề..."
                value={query}
                onChange={(event) => { setQuery(event.target.value); setPage(1); }}
              />
            </div>

            <label className={styles.selectLabel}>
              Trạng thái:
              <select
                className={styles.filterSelect}
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value as Filter);
                  setPage(1);
                }}
              >
                <option value="all">Tất cả ({instances.length})</option>
                <option value="running">Đang xử lý ({stats.processing})</option>
                <option value="urgent">⚠️ Duyệt gấp / SLA ({stats.urgent})</option>
                <option value="completed">Hoàn thành ({stats.completed})</option>
                <option value="rejected">Từ chối ({stats.rejected})</option>
                <option value="cancelled">Đã huỷ ({stats.cancelled})</option>
              </select>
            </label>

            <label className={styles.selectLabel}>
              Sắp xếp:
              <select
                className={styles.filterSelect}
                value={dateSort}
                onChange={(event) => {
                  setDateSort(event.target.value as 'newest' | 'oldest');
                  setPage(1);
                }}
              >
                <option value="newest">Mới nhất</option>
                <option value="oldest">Cũ nhất</option>
              </select>
            </label>

            <label className={styles.selectLabel}>
              SLA:
              <select
                className={styles.filterSelect}
                value={slaFilter}
                onChange={(event) => { setSlaFilter(event.target.value as typeof slaFilter); setPage(1); }}
              >
                <option value="all">Tất cả SLA</option>
                <option value="breached">🔴 Quá hạn</option>
                <option value="warning">🟡 Sắp đến hạn</option>
                <option value="ok">🟢 Còn hạn</option>
                <option value="none">Không cài</option>
              </select>
            </label>

            <label className={styles.selectLabel}>
              Nguồn:
              <select
                className={styles.filterSelect}
                value={source}
                onChange={(event) => { setSource(event.target.value as typeof source); setPage(1); }}
              >
                <option value="all">Tất cả</option>
                <option value="manual">Thủ công</option>
                <option value="maintenance_occurrence">Bảo trì</option>
                <option value="auto_from_parent">Tự động</option>
              </select>
            </label>

            {/* View Mode Toggle */}
            <div className={styles.viewModeToggle}>
              <button
                type="button"
                className={`${styles.viewModeBtn} ${viewMode === 'list' ? styles.viewModeBtnActive : ''}`}
                onClick={() => setViewMode('list')}
                title="Xem dạng thẻ"
              >
                Thẻ
              </button>
              <button
                type="button"
                className={`${styles.viewModeBtn} ${viewMode === 'table' ? styles.viewModeBtnActive : ''}`}
                onClick={() => setViewMode('table')}
                title="Xem dạng bảng"
              >
                Bảng
              </button>
            </div>

            {filtersActive || query || filter !== 'all' ? (
              <button
                type="button"
                className={styles.ghost}
                style={{ padding: '5px 10px', fontSize: '11.5px' }}
                onClick={() => {
                  setFilter('all');
                  setSlaFilter('all');
                  setSource('all');
                  setFrom('');
                  setTo('');
                  setQuery('');
                  setPage(1);
                }}
                title="Đặt lại tất cả bộ lọc"
              >
                🔄 Đặt lại
              </button>
            ) : null}
          </div>

          {/* Records Render (Card list vs Data Table) */}
          {visible.length === 0 ? (
            <div className={styles.empty}>
              <h2>Không có hồ sơ nào khớp bộ lọc</h2>
              <p>Thử đổi điều kiện lọc hoặc tạo yêu cầu mới.</p>
            </div>
          ) : viewMode === 'table' ? (
            <div className={styles.tableContainer}>
              <table className={styles.masterTable}>
                <thead>
                  <tr>
                    <th>Mã hồ sơ</th>
                    <th>Tiêu đề</th>
                    <th>Quy trình</th>
                    <th>Tiến độ</th>
                    <th>SLA</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((instance) => {
                    const isSel = instance.id === selected?.id;
                    const completedSteps = instance.steps.filter((s) => s.status === 'completed').length;
                    return (
                      <tr
                        key={instance.id}
                        onClick={() => setSelectedId(instance.id)}
                        className={`${styles.masterTableRow} ${isSel ? styles.masterTableRowActive : ''}`}
                      >
                        <td style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: '#1e40af' }}>
                          {instance.code}
                        </td>
                        <td style={{ fontWeight: 600 }}>{instance.title}</td>
                        <td style={{ color: 'var(--faint)' }}>{instance.definitionCode}</td>
                        <td style={{ fontWeight: 600 }}>
                          {completedSteps}/{instance.steps.length}
                        </td>
                        <td>
                          <SlaBadge view={evaluateInstanceSla(instance)} />
                        </td>
                        <td>
                          <span className={`${styles.badge} ${styles[instance.status]}`}>
                            {STATUS_LABEL[instance.status]}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={styles.cardsScroll}>
              {paged.map((instance) => {
                const completedSteps = instance.steps.filter((s) => s.status === 'completed').length;
                const progressPercent = Math.round((completedSteps / Math.max(1, instance.steps.length)) * 100);
                return (
                  <button
                    key={instance.id}
                    type="button"
                    className={`${styles.orderCard} ${instance.id === selected?.id ? styles.orderCardOn : ''}`}
                    onClick={() => setSelectedId(instance.id)}
                  >
                    <div className={styles.cardTop}>
                      <span className={styles.code}>{instance.code}</span>
                      <span className={`${styles.badge} ${styles[instance.status]}`}>
                        {STATUS_LABEL[instance.status]}
                      </span>
                    </div>
                    <h3 className={styles.cardTitle}>{instance.title}</h3>
                    <div className={styles.cardFoot}>
                      <span>{instance.definitionName}</span>
                      <div className={styles.cardFootRight}>
                        <SlaBadge view={evaluateInstanceSla(instance)} />
                        <span style={{ fontWeight: 600 }}>
                          {completedSteps}/{instance.steps.length} bước
                        </span>
                        <div className={styles.miniProgressBar} title={`Tiến độ ${progressPercent}%`}>
                          <div className={styles.miniProgressFill} style={{ width: `${progressPercent}%` }} />
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Pager Bar (Placed at Bottom) */}
          {visible.length > 0 ? (
            <div className={styles.pagerRow}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span>
                  Hiển thị <strong>{(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, visible.length)}</strong> / <strong>{visible.length}</strong> hồ sơ
                </span>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: 'var(--muted)' }}>
                  Hiển thị:
                  <select
                    className={styles.pagerSelect}
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                  >
                    <option value={15}>15 / trang</option>
                    <option value={30}>30 / trang</option>
                    <option value={45}>45 / trang</option>
                    <option value={60}>60 / trang</option>
                  </select>
                </label>
              </div>

              <div className={styles.pagerControls}>
                <button
                  type="button"
                  className={styles.pagerBtn}
                  disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  ← Trước
                </button>
                <span style={{ fontWeight: 700, color: 'var(--ink)' }}>
                  {currentPage} / {pageCount}
                </span>
                <button
                  type="button"
                  className={styles.pagerBtn}
                  disabled={currentPage >= pageCount}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Sau →
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* ======================================================================= */}
        {/* RIGHT COLUMN: DETAIL + VERTICAL TIMELINE + ACTION CONSOLE + TABS        */}
        {/* ======================================================================= */}
        <div className={styles.rightDetailContainer}>
          {selected ? (
            <>
              {/* 1. THÔNG TIN QUY TRÌNH (Selected Instance Summary) */}
              <article className={styles.panel}>
                <header className={styles.detailHead}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span className={styles.code}>{selected.code}</span>
                    <span className={`${styles.badge} ${styles[selected.status]}`}>
                      {STATUS_LABEL[selected.status]}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <SlaBadge view={evaluateInstanceSla(selected)} />

                    {/* Nút Huỷ hồ sơ dành cho Admin / Quản trị viên */}
                    {selected.authorization?.availableActions.includes('cancel') && selected.status === 'running' ? (
                      <div className={styles.popconfirmWrapper}>
                        <button
                          type="button"
                          className={styles.headerCancelBtn}
                          disabled={busy === `cancel:${selected.id}` || isSubmitting}
                          onClick={() => setHeaderCancelOpen((prev) => !prev)}
                        >
                          🗑️ Huỷ hồ sơ
                        </button>

                        {headerCancelOpen ? (
                          <div className={styles.popconfirmBox} style={{ right: 0, left: 'auto', width: '280px' }}>
                            <div className={styles.popconfirmArrow} style={{ right: '20px', left: 'auto' }} />
                            <div className={styles.popconfirmTitle}>
                              ⚠️ Xác nhận huỷ hồ sơ này?
                            </div>
                            <div className={styles.popconfirmDesc}>
                              Hành động huỷ chỉ dành cho Quản trị viên, sẽ kết thúc toàn bộ quy trình ngay lập tức và không thể hoàn tác.
                            </div>
                            <div className={styles.popconfirmActions}>
                              <button
                                type="button"
                                className={styles.ghost}
                                style={{ fontSize: '11px', padding: '3px 8px' }}
                                onClick={() => setHeaderCancelOpen(false)}
                              >
                                Không
                              </button>
                              <button
                                type="button"
                                className={styles.danger}
                                style={{ fontSize: '11px', padding: '3px 10px' }}
                                onClick={() => {
                                  setHeaderCancelOpen(false);
                                  void handleActionWithAttach(selected.id, 'cancel');
                                }}
                              >
                                Đồng ý huỷ
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </header>
                <h2 className={styles.detailTitle}>{selected.title}</h2>

                <dl className={styles.metaGrid}>
                  <div>
                    <dt>Người khởi tạo</dt>
                    <dd>{selected.activity.find((entry) => entry.action === 'start')?.actorName ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Quy trình</dt>
                    <dd>{selected.definitionName} <small style={{ color: 'var(--faint)' }}>· v{selected.definitionVersion}</small></dd>
                  </div>
                  <div>
                    <dt>Nguồn tiếp nhận</dt>
                    <dd>{selected.sourceType === 'maintenance_occurrence' ? '🛠️ Lịch bảo trì' : '✍️ Tạo thủ công'}</dd>
                  </div>
                  <div>
                    <dt>{selected.completedAt ? 'Hoàn tất lúc' : 'Mở đơn lúc'}</dt>
                    <dd>{formatDateTime(selected.completedAt ?? selected.startedAt)}</dd>
                  </div>
                </dl>
              </article>

              {/* 2. ACTION & APPROVAL CONSOLE (Thao tác xử lý, duyệt, đính kèm, WBS) */}
              <ActionPanel
                busy={busy}
                comment={comment}
                instance={selected}
                isSubmitting={isSubmitting}
                attachments={attachments ?? []}
                attachQueue={attachQueue}
                onAttachQueue={setAttachQueue}
                onAction={(action, comment, returnToStepId) =>
                  void handleActionWithAttach(selected.id, action, comment, returnToStepId)
                }
                onComment={setComment}
                onOpenDrawer={setActiveTabModal}
                materialCatalog={materialCatalog}
                assetCatalog={assetCatalog}
                onPickAsset={onPickAsset ? (assetCode) => onPickAsset(selected.id, assetCode) : undefined}
                definitions={definitions}
                organization={organization}
                actorId={actorId}
                onSeedSubtasks={onSeedSubtasks ? () => onSeedSubtasks(selected.id) : undefined}
                onSetSubtasks={
                  onSetSubtasks
                    ? (items, mode) => onSetSubtasks(selected.id, items, mode)
                    : undefined
                }
                onCompleteSubtask={
                  onCompleteSubtask
                    ? (subtaskId) => onCompleteSubtask(selected.id, subtaskId)
                    : undefined
                }
                onCancelSubtask={
                  onCancelSubtask
                    ? (subtaskId) => onCancelSubtask(selected.id, subtaskId)
                    : undefined
                }
                onUploadEvidence={
                  onUploadEvidence
                    ? (subtaskId, file) => onUploadEvidence(selected.id, subtaskId, file)
                    : undefined
                }
                onRequestMaterials={
                  onRequestMaterials
                    ? (input) => onRequestMaterials(selected.id, input)
                    : undefined
                }
              />

              {/* 3. TIẾN TRÌNH CÁC BƯỚC (Vertical Timeline) */}
              <article className={styles.panel}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '1px solid var(--line)', paddingBottom: '8px' }}>
                  <h3 className={styles.panelTitle}>
                    Tiến trình các bước
                  </h3>
                  <span style={{ fontSize: '11px', color: 'var(--muted)', background: '#f1f5f9', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                    {selected.steps.filter((s) => s.status === 'completed').length}/{selected.steps.length} bước
                  </span>
                </div>

                <div className={styles.timelineContainer}>
                  {/* Spine line */}
                  <div className={styles.timelineSpine} />

                  {selected.steps.map((step) => {
                    const isCur = step.id === selected.currentStepId;
                    const isDone = step.status === 'completed';
                    const isRejected = step.status === 'rejected';

                    const nodeClass = isDone
                      ? styles.nodeCompleted
                      : isRejected
                        ? styles.nodeRejected
                        : isCur
                          ? styles.nodeActive
                          : styles.nodePending;

                    return (
                      <div
                        key={step.id}
                        className={`${styles.timelineStepCard} ${isCur ? styles.timelineStepActive : ''}`}
                      >
                        {/* Node Icon */}
                        <div className={`${styles.timelineNodeIcon} ${nodeClass}`}>
                          {isDone ? '✓' : isRejected ? '✗' : step.order}
                        </div>

                        {/* Step Card Content */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                          <div>
                            <span style={{ fontSize: '10.5px', fontWeight: 800, color: isCur ? 'var(--blue)' : 'var(--faint)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              Bước {step.order} {isCur ? '· Đang thực hiện' : ''}
                            </span>
                            <h4 style={{ margin: '2px 0 4px', fontSize: '13.5px', fontWeight: 700, color: 'var(--ink)' }}>
                              {step.name}
                            </h4>
                          </div>
                          <SlaBadge
                            view={evaluateStepSla(step, selected)}
                            slaHours={step.slaHours}
                            startedAt={step.startedAt}
                          />
                        </div>

                        {/* RACI Role assignments list */}
                        <div className={styles.roleList}>
                          {roleLines(step, names).map((line) => (
                            <span key={line.role} className={styles.roleTag}>
                              <i className={`${styles.role} ${styles[`role${line.role}`]}`}>
                                {line.role}
                              </i>
                              <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{line.names}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>

              {/* 4. VẬT TƯ CẦN CHO BƯỚC */}
              <MaterialStatus
                instance={selected}
                busy={busy}
                onRecheck={onRecheckMaterials ? () => onRecheckMaterials(selected.id) : undefined}
              />

              {/* 5. QUY TRÌNH LIÊN KẾT */}
              <LinkedPanel
                instance={selected}
                instances={instances}
                onOpen={(instanceId) => setSelectedId(instanceId)}
              />
            </>
          ) : (
            <div className={styles.empty}>
              <p>Chọn một hồ sơ bên trái để xem chi tiết</p>
            </div>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 4. SLIDE-OVER NODE WORKSPACE DRAWER (3 AXES: XỬ LÝ · TRAO ĐỔI · TỆP)       */}
      {/* ========================================================================= */}
      {activeStepDrawer && selected ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            display: 'flex',
            justifyContent: 'flex-end',
            background: 'rgba(15, 23, 42, 0.5)',
            backdropFilter: 'blur(4px)',
          }}
          onClick={() => setActiveStepDrawer(null)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '680px',
              background: '#ffffff',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '-8px 0 32px rgba(15, 23, 42, 0.2)',
              animation: 'fadeIn 0.2s ease-out',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--line)',
                background: '#f8fafc',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span
                      style={{
                        background: 'rgba(37, 99, 235, 0.1)',
                        color: '#2563eb',
                        fontWeight: 700,
                        fontSize: '11px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                      }}
                    >
                      BƯỚC {activeStepDrawer.step.order}
                    </span>
                    <span className={`${styles.badge} ${styles[activeStepDrawer.step.status]}`}>
                      {STEP_STATUS_LABEL[activeStepDrawer.step.status] ?? activeStepDrawer.step.status}
                    </span>
                    {activeStepDrawer.step.slaHours ? (
                      <span
                        style={{
                          fontSize: '11px',
                          color: 'var(--muted)',
                          background: '#e2e8f0',
                          padding: '2px 6px',
                          borderRadius: '4px',
                        }}
                      >
                        SLA: {activeStepDrawer.step.slaHours}h
                      </span>
                    ) : null}
                  </div>
                  <h3 style={{ margin: '6px 0 2px', fontSize: '17px', fontWeight: 800, color: 'var(--ink)' }}>
                    {activeStepDrawer.step.name}
                  </h3>
                  <p style={{ margin: 0, fontSize: '12px', color: 'var(--faint)' }}>
                    Hồ sơ: <strong style={{ color: 'var(--ink)' }}>{selected.code}</strong> · {selected.title}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveStepDrawer(null)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    fontSize: '20px',
                    cursor: 'pointer',
                    color: 'var(--faint)',
                  }}
                >
                  ✕
                </button>
              </div>

              {/* 3 Drawer Tabs */}
              <div style={{ display: 'flex', gap: '6px', borderTop: '1px solid var(--line)', paddingTop: '10px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => setActiveStepDrawer({ ...activeStepDrawer, tab: 'execution' })}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: activeStepDrawer.tab === 'execution' ? 'var(--blue)' : '#e2e8f0',
                    color: activeStepDrawer.tab === 'execution' ? '#ffffff' : 'var(--ink)',
                  }}
                >
                  1. Xử lý &amp; Phân công RACI
                </button>
                <button
                  type="button"
                  onClick={() => setActiveStepDrawer({ ...activeStepDrawer, tab: 'chat' })}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: activeStepDrawer.tab === 'chat' ? 'var(--blue)' : '#e2e8f0',
                    color: activeStepDrawer.tab === 'chat' ? '#ffffff' : 'var(--ink)',
                  }}
                >
                  2. Trao đổi ({selected.activity.filter((a) => !a.stepInstanceId || a.stepInstanceId === activeStepDrawer.step.id).length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveStepDrawer({ ...activeStepDrawer, tab: 'files' })}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: activeStepDrawer.tab === 'files' ? 'var(--blue)' : '#e2e8f0',
                    color: activeStepDrawer.tab === 'files' ? '#ffffff' : 'var(--ink)',
                  }}
                >
                  3. Tệp ({attachments.filter((a) => a.instanceId === selected.id && a.stepInstanceId === activeStepDrawer.step.id).length})
                </button>
              </div>
            </div>

            {/* Drawer Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {activeStepDrawer.tab === 'execution' ? (
                <div>
                  <h4 style={{ fontSize: '12px', fontWeight: 700, margin: '0 0 10px', textTransform: 'uppercase', color: 'var(--muted)' }}>
                    Phân công Ma trận RACI cho bước này
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
                    {activeStepDrawer.step.assignments.map((asgn) => {
                      const holderLabel = names.get(asgn.subjectId) ?? asgn.subjectLabel ?? asgn.subjectId;
                      return (
                        <div
                          key={asgn.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '10px 14px',
                            borderRadius: '8px',
                            border: '1px solid var(--line)',
                            background: '#f8fafc',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <i className={`${styles.role} ${styles[`role${asgn.role}`]}`}>
                              {asgn.role}
                            </i>
                            <div>
                              <strong style={{ fontSize: '13px', color: 'var(--ink)' }}>{holderLabel}</strong>
                              <div style={{ fontSize: '11px', color: 'var(--faint)' }}>
                                Loại: {asgn.subjectType === 'user' ? 'Nhân sự' : asgn.subjectType === 'organization_unit' ? 'Đơn vị' : 'Chức vụ'}
                              </div>
                            </div>
                          </div>
                          <span style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--blue)' }}>
                            {asgn.role === 'R'
                              ? 'Thực hiện chính'
                              : asgn.role === 'A'
                                ? 'Phê duyệt cuối'
                                : asgn.role === 'C'
                                  ? 'Kiểm soát / Tham vấn'
                                  : asgn.role === 'S'
                                    ? 'Hỗ trợ'
                                    : asgn.role === 'E'
                                      ? 'Chuyên gia'
                                      : 'Thông báo'}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Step Material Requirements */}
                  {activeStepDrawer.step.materials && activeStepDrawer.step.materials.length > 0 ? (
                    <div style={{ borderTop: '1px solid var(--line)', paddingTop: '16px' }}>
                      <h4 style={{ fontSize: '12px', fontWeight: 700, margin: '0 0 10px', textTransform: 'uppercase', color: 'var(--muted)' }}>
                        Vật tư / Thiết bị yêu cầu cho bước
                      </h4>
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {activeStepDrawer.step.materials.map((mat) => (
                          <li
                            key={mat.materialCode}
                            style={{
                              padding: '8px 12px',
                              background: '#f1f5f9',
                              borderRadius: '6px',
                              display: 'flex',
                              justifyContent: 'space-between',
                              fontSize: '12.5px',
                            }}
                          >
                            <span>{mat.materialName ?? mat.materialCode}</span>
                            <strong>{mat.quantity} {mat.unit ?? 'cái'}</strong>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : activeStepDrawer.tab === 'chat' ? (
                <div>
                  <ChatPanel
                    instance={selected}
                    busy={busy}
                    participants={participantsOf(selected, names)}
                    onSend={(body, mentions, replyToId) =>
                      onSendComment?.(selected.id, body, mentions, replyToId)
                    }
                  />
                </div>
              ) : (
                <div>
                  <AttachmentPanel
                    instance={selected}
                    attachments={attachments.filter(
                      (a) => !a.stepInstanceId || a.stepInstanceId === activeStepDrawer.step.id,
                    )}
                    busy={busy}
                    onUpload={(file) => onUploadFile?.(selected.id, file)}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* ========================================================================= */}
      {/* 5. POPUP DRAWER LƯU TRỮ HỒ SƠ (3 TAB: HỘI THOẠI · TỆP · NHẬT KÝ LÀM VIỆC)   */}
      {/* ========================================================================= */}
      {activeTabModal && selected ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            display: 'flex',
            justifyContent: 'flex-end',
            background: 'rgba(15, 23, 42, 0.5)',
            backdropFilter: 'blur(4px)',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveTabModal(null);
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '680px',
              background: '#ffffff',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '-8px 0 32px rgba(15, 23, 42, 0.2)',
              animation: 'fadeIn 0.2s ease-out',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--line)',
                background: '#f8fafc',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span className={styles.code}>{selected.code}</span>
                    <span className={`${styles.badge} ${styles[selected.status]}`}>
                      {STATUS_LABEL[selected.status]}
                    </span>
                  </div>
                  <h3 style={{ margin: '6px 0 2px', fontSize: '16px', fontWeight: 800, color: 'var(--ink)' }}>
                    {selected.title}
                  </h3>
                  <p style={{ margin: 0, fontSize: '12px', color: 'var(--faint)' }}>
                    Quy trình: {selected.definitionName} (v{selected.definitionVersion})
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTabModal(null)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    fontSize: '20px',
                    cursor: 'pointer',
                    color: 'var(--faint)',
                  }}
                >
                  ✕
                </button>
              </div>

              {/* 3 Drawer Tabs: Hội thoại · Tệp & Tài liệu · Nhật ký làm việc */}
              <div style={{ display: 'flex', gap: '6px', borderTop: '1px solid var(--line)', paddingTop: '10px', marginTop: '6px' }}>
                {[
                  {
                    key: 'chat' as const,
                    label: '💬 Hội thoại',
                    count: selected.activity.filter((a) => a.action === 'comment').length,
                  },
                  {
                    key: 'files' as const,
                    label: '📎 Tệp & Tài liệu',
                    count: (attachments ?? []).filter((a) => a.instanceId === selected.id).length,
                  },
                  {
                    key: 'history' as const,
                    label: '📜 Nhật ký làm việc',
                    count: selected.activity.filter((a) => a.action !== 'comment').length,
                  },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTabModal(tab.key)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      border: 'none',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      background: activeTabModal === tab.key ? 'var(--blue)' : '#e2e8f0',
                      color: activeTabModal === tab.key ? '#ffffff' : 'var(--ink)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <span>{tab.label}</span>
                    {tab.count > 0 ? (
                      <span
                        style={{
                          fontSize: '10.5px',
                          padding: '1px 5px',
                          borderRadius: '999px',
                          background: activeTabModal === tab.key ? 'rgba(255,255,255,0.25)' : '#cbd5e1',
                          color: activeTabModal === tab.key ? '#ffffff' : 'var(--ink)',
                        }}
                      >
                        {tab.count}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>

            {/* Drawer Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {activeTabModal === 'chat' ? (
                <ChatPanel
                  instance={selected}
                  busy={busy}
                  participants={participantsOf(selected, names)}
                  onSend={(body, mentions, replyToId) =>
                    onSendComment?.(selected.id, body, mentions, replyToId)
                  }
                />
              ) : activeTabModal === 'files' ? (
                <AttachmentPanel
                  instance={selected}
                  attachments={attachments ?? []}
                  busy={busy}
                  onUpload={(file) => onUploadFile?.(selected.id, file)}
                />
              ) : (
                <HistoryPanel instance={selected} />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ActionPanel({
  busy,
  isSubmitting,
  comment,
  instance,
  attachments,
  attachQueue,
  onAttachQueue,
  onAction,
  onComment,
  onOpenDrawer,
  materialCatalog = [],
  assetCatalog = [],
  onPickAsset,
  definitions = [],
  organization,
  actorId,
  onSeedSubtasks,
  onSetSubtasks,
  onCompleteSubtask,
  onCancelSubtask,
  onUploadEvidence,
  onRequestMaterials,
}: {
  busy?: string;
  isSubmitting?: boolean;
  comment: string;
  instance: ProcedureInstance;
  attachments: readonly ProcedureAttachment[];
  attachQueue: File[];
  onAttachQueue: (files: File[]) => void;
  onAction: (
    action: ProcedureRuntimeAction,
    comment?: string,
    returnToStepId?: string,
  ) => void;
  onComment: (value: string) => void;
  onOpenDrawer: (tab: 'chat' | 'files' | 'history') => void;
  materialCatalog?: readonly MaterialCatalogItem[];
  assetCatalog?: readonly AssetCatalogItem[];
  onPickAsset?: (assetCode: string) => void;
  definitions?: readonly ProcedureDefinition[];
  organization?: TenantOrganizationSnapshot;
  actorId?: string;
  onSeedSubtasks?: () => void;
  onSetSubtasks?: (items: ProcedureSubtaskInput[], mode: ProcedureSubtaskExecutionMode) => void;
  onCompleteSubtask?: (subtaskId: string) => void;
  onCancelSubtask?: (subtaskId: string) => void;
  onUploadEvidence?: (subtaskId: string, file: File) => void;
  onRequestMaterials?: (input: RequestProcedureMaterialsRequest) => void;
}) {
  const authorization = instance.authorization;
  const current = instance.steps.find((step) => step.id === instance.currentStepId);
  const currentIndex = instance.steps.findIndex((step) => step.id === instance.currentStepId);
  const actions = authorization?.availableActions ?? [];
  const myRoles = authorization?.myRoles ?? [];
  const canAct = actions.length > 0 || myRoles.length > 0;

  const fixedRollback = current?.assignments.find(
    (item) => item.role === 'C' && item.fixedRollbackStepId,
  )?.fixedRollbackStepId;
  const canPickReturnStep =
    current?.currentRoleStage === 'A' && !fixedRollback && currentIndex > 0;
  const earlierSteps = currentIndex > 0 ? instance.steps.slice(0, currentIndex) : [];

  const [returnTo, setReturnTo] = useState('');
  const [attachOpen, setAttachOpen] = useState(false);
  const [wbsOpen, setWbsOpen] = useState(false);
  const [confirmRejectOpen, setConfirmRejectOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // WBS / E role: check if current step has an E assignment the actor can manage
  const eAssignment = current?.assignments.find((a) => a.role === 'E');
  const canManageSubtasks = authorization?.canManageSubtasks ?? false;
  const mySubtaskCount = authorization?.mySubtaskIds?.length ?? 0;
  const showWbs =
    Boolean(eAssignment) &&
    (canManageSubtasks || mySubtaskCount > 0) &&
    Boolean(onSeedSubtasks && onSetSubtasks && onCompleteSubtask && onCancelSubtask && onUploadEvidence);

  // WBS progress summary (for collapsed header)
  const stepSubtasks = (instance.subtasks ?? []).filter(
    (s) => s.stepInstanceId === current?.id,
  );
  const subtasksResolved = stepSubtasks.filter(
    (s) => s.status === 'completed' || s.status === 'cancelled',
  ).length;
  const subtasksDoneWeight = stepSubtasks
    .filter((s) => s.status === 'completed')
    .reduce((sum, s) => sum + s.weight, 0);

  // Role-adaptive textarea label
  const textareaLabel = myRoles.includes('R')
    ? 'Mô tả kết quả thực hiện (Ctrl+Enter để gửi)'
    : myRoles.includes('C')
      ? 'Ý kiến chuyên môn / thẩm định kỹ thuật (Ctrl+Enter để gửi)'
      : 'Ghi chú phản hồi / lý do từ chối (Ctrl+Enter để gửi)';

  // Pure "I" (Informed) role check — read-only notice
  const isRoleI = myRoles.length === 1 && myRoles[0] === 'I' && actions.length === 0;

  const isActionBusy = (action: ProcedureRuntimeAction) =>
    busy === `${action}:${instance.id}` || isSubmitting;

  return (
    <article className={styles.panel}>
      {/* 1. Header: Action Title */}
      <header className={styles.actionHead}>
        <h3 className={styles.panelTitle}>Xử lý &amp; Phê duyệt</h3>
      </header>

      {/* Role badges */}
      {myRoles.length > 0 || authorization?.isDelegated || authorization?.isEscalated ? (
        <p className={styles.myRoles}>
          Vai trò bạn giữ ở bước này:{' '}
          {myRoles.map((role) => (
            <i key={role} className={`${styles.role} ${styles[`role${role}`]}`}>
              {role}
            </i>
          ))}
          {authorization?.isDelegated ? <span className={styles.tag}>được uỷ quyền</span> : null}
          {authorization?.isEscalated ? <span className={styles.tag}>xử lý thay cấp dưới</span> : null}
        </p>
      ) : null}

      {/* Pure I (Informed) notice */}
      {isRoleI ? (
        <p className={styles.panelHint}>
          ℹ️ Bạn giữ vai trò <strong>Thông báo (I)</strong> ở bước này — bạn có thể theo dõi tiến trình, trao đổi và xem hồ sơ đính kèm mà không cần thực hiện phê duyệt.
        </p>
      ) : !canAct ? (
        <p className={styles.panelHint}>
          Bạn không giữ vai trò nào ở bước hiện tại — chỉ theo dõi được tiến trình.
        </p>
      ) : (
        <>
          {/* 2. Textarea (Adaptable by RACIE role) */}
          <label className={styles.commentField}>
            {textareaLabel}
            <textarea
              rows={3}
              placeholder="Nhập nhận xét hoặc phương án điều chỉnh…"
              value={comment}
              onChange={(event) => onComment(event.target.value)}
              onKeyDown={(e) => {
                if (e.ctrlKey && e.key === 'Enter') {
                  const primaryAction = actions.find((a) => a === 'approve' || a === 'complete');
                  if (primaryAction && !isActionBusy(primaryAction)) {
                    onAction(primaryAction, comment || undefined);
                  }
                }
              }}
            />
          </label>

          {/* 3. Attachment section — Toggle Dropzone */}
          <div className={styles.attachSection}>
            <button
              type="button"
              className={`${styles.attachToggleBtn} ${attachOpen ? styles.attachToggleBtnActive : ''}`}
              onClick={() => setAttachOpen((prev) => !prev)}
            >
              <span className={styles.attachToggleIcon}>📎</span>
              <span>{attachOpen ? 'Thu gọn đính kèm' : 'Đính kèm tài liệu kèm lượt duyệt'}</span>
              {attachQueue.length > 0 ? (
                <span className={styles.attachCountBadge}>
                  {attachQueue.length} tệp đã chọn
                </span>
              ) : (
                <span className={styles.attachToggleHint}>+ Thêm tệp</span>
              )}
            </button>

            {attachOpen ? (
              <div className={styles.attachDropzone}>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length > 0) {
                      onAttachQueue([...attachQueue, ...files]);
                    }
                    e.target.value = '';
                  }}
                />

                {attachQueue.length > 0 ? (
                  <div className={styles.attachChipList}>
                    {attachQueue.map((file, idx) => (
                      <span key={idx} className={styles.attachChip}>
                        <span className={styles.attachChipName} title={file.name}>{file.name}</span>
                        <span className={styles.attachChipSize}>
                          ({(file.size / 1024).toFixed(0)} KB)
                        </span>
                        <button
                          type="button"
                          className={styles.attachChipRemove}
                          aria-label="Xoá tệp"
                          onClick={() =>
                            onAttachQueue(attachQueue.filter((_, i) => i !== idx))
                          }
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className={styles.attachActionsRow}>
                  <button
                    type="button"
                    className={styles.primaryGhostBtn}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    📂 Chọn tệp từ máy tính
                  </button>
                  <span className={styles.attachSubtext}>
                    Tệp sẽ được tải lên tự động khi bạn bấm gửi phê duyệt
                  </span>
                </div>
              </div>
            ) : null}
          </div>

          {/* 4. WBS Inline Section (for E role, collapsible) */}
          {showWbs ? (
            <div className={styles.wbsInlinePanel}>
              <button
                type="button"
                className={styles.wbsCollapseBtn}
                onClick={() => setWbsOpen((prev) => !prev)}
              >
                <span>
                  <i className={`${styles.role} ${styles.roleE}`} style={{ display: 'inline-grid', verticalAlign: 'middle', marginRight: '6px' }}>E</i>
                  Phân rã công việc (WBS)
                  {stepSubtasks.length > 0 ? (
                    <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--blue)', fontWeight: 600 }}>
                      ({subtasksResolved}/{stepSubtasks.length} xử lý · {Math.round(subtasksDoneWeight * 100) / 100}%)
                    </span>
                  ) : null}
                </span>
                <span>{wbsOpen ? '▲ Thu gọn' : '▼ Mở phân rã'}</span>
              </button>

              {wbsOpen ? (
                <div className={styles.wbsContent}>
                  <SubtaskPanel
                    instance={instance}
                    materialCatalog={materialCatalog}
                    assetCatalog={assetCatalog}
                    onPickAsset={onPickAsset}
                    definitions={definitions}
                    onRequestMaterials={onRequestMaterials}
                    organization={organization}
                    actorId={actorId}
                    busy={busy}
                    attachments={attachments}
                    onSeed={onSeedSubtasks!}
                    onSetItems={onSetSubtasks!}
                    onComplete={onCompleteSubtask!}
                    onCancel={onCancelSubtask!}
                    onUpload={onUploadEvidence!}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Rollback picker (for A stage) */}
          {canPickReturnStep && actions.includes('return') ? (
            <label className={styles.commentField}>
              Trả lại về bước
              <select value={returnTo} onChange={(event) => setReturnTo(event.target.value)}>
                <option value="">
                  Bước liền trước ({earlierSteps[earlierSteps.length - 1]?.order}-
                  {earlierSteps[earlierSteps.length - 1]?.name})
                </option>
                {earlierSteps.map((step) => (
                  <option key={step.id} value={step.id}>
                    {step.order}-{step.name}
                  </option>
                ))}
              </select>
            </label>
          ) : fixedRollback && actions.includes('return') ? (
            <p className={styles.panelHint}>
              Bước quay về đã cấu hình sẵn:{' '}
              <strong>
                {instance.steps.find((step) => step.definitionStepId === fixedRollback)?.name ??
                  'bước trước'}
              </strong>
            </p>
          ) : null}

          {/* Action buttons */}
          {actions.length === 0 ? (
            <p className={styles.panelHint}>
              Chưa tới lượt bạn: bước này đang ở pha {current?.currentRoleStage ?? '—'}.
            </p>
          ) : (
            <>
              <div className={styles.actionRow}>
                {actions
                  .filter((action) => action !== 'approve' && action !== 'complete' && action !== 'comment' && action !== 'cancel')
                  .map((action) => {
                    if (action === 'reject') {
                      return (
                        <div key={action} className={styles.popconfirmWrapper}>
                          <button
                            key={action}
                            type="button"
                            className={styles.danger}
                            disabled={isActionBusy(action)}
                            onClick={() => {
                              setConfirmRejectOpen((prev) => !prev);
                            }}
                          >
                            {isActionBusy(action) ? 'Đang xử lý…' : ACTION_LABEL[action]}
                          </button>

                          {confirmRejectOpen ? (
                            <div className={styles.popconfirmBox}>
                              <div className={styles.popconfirmArrow} />
                              <div className={styles.popconfirmTitle}>
                                ⚠️ Xác nhận từ chối hồ sơ này?
                              </div>
                              <div className={styles.popconfirmDesc}>
                                Hành động từ chối sẽ chuyển hồ sơ sang trạng thái bị từ chối và ngừng xử lý bước tiếp theo.
                              </div>
                              <div className={styles.popconfirmActions}>
                                <button
                                  type="button"
                                  className={styles.ghost}
                                  style={{ fontSize: '11px', padding: '3px 8px' }}
                                  onClick={() => setConfirmRejectOpen(false)}
                                >
                                  Huỷ
                                </button>
                                <button
                                  type="button"
                                  className={styles.danger}
                                  style={{ fontSize: '11px', padding: '3px 10px' }}
                                  onClick={() => {
                                    setConfirmRejectOpen(false);
                                    onAction('reject', comment || undefined);
                                  }}
                                >
                                  Đồng ý từ chối
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    }

                    return (
                      <button
                        key={action}
                        type="button"
                        className={styles.ghost}
                        disabled={isActionBusy(action)}
                        onClick={() =>
                          onAction(
                            action,
                            comment || undefined,
                            action === 'return' ? returnTo || undefined : undefined,
                          )
                        }
                      >
                        {isActionBusy(action) ? 'Đang xử lý…' : ACTION_LABEL[action]}
                      </button>
                    );
                  })}
                {actions
                  .filter((action) => action === 'approve' || action === 'complete')
                  .map((action) => (
                    <button
                      key={action}
                      type="button"
                      className={styles.primary}
                      disabled={isActionBusy(action)}
                      onClick={() => onAction(action, comment || undefined)}
                    >
                      {isActionBusy(action)
                        ? attachQueue.length > 0
                          ? 'Đang tải tệp & xử lý…'
                          : 'Đang xử lý…'
                        : attachQueue.length > 0
                          ? `${ACTION_LABEL[action]} & Gửi ${attachQueue.length} tệp`
                          : ACTION_LABEL[action]}
                    </button>
                  ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Utility row — gộp thành 1 nút mở Hồ sơ & Nhật ký làm việc */}
      <div className={styles.utilityRow}>
        <button
          type="button"
          className={styles.drawerTriggerBtn}
          onClick={() => onOpenDrawer('chat')}
        >
          <span className={styles.drawerTriggerIcon}>🗂️</span>
          <span className={styles.drawerTriggerLabel}>Nhật ký &amp; Lịch sử làm việc</span>
          <span className={styles.drawerTriggerArrow}>Mở ngăn kéo →</span>
        </button>
      </div>
    </article>
  );
}

/**
 * Tình trạng vật tư của bước hiện tại.
 */
function MaterialStatus({
  instance,
  busy,
  onRecheck,
}: {
  instance: ProcedureInstance;
  busy?: string;
  onRecheck?: () => void;
}) {
  const step = instance.steps.find((item) => item.id === instance.currentStepId);
  if (!step?.materials?.length) return null;

  const check = step.materialCheck;
  const short = check?.state === 'short';

  return (
    <article className={`${styles.panel} ${short ? styles.materialShort : ''}`}>
      <header className={styles.actionHead}>
        <h3 className={styles.panelTitle}>Vật tư cần cho bước này</h3>
        {onRecheck ? (
          <button
            type="button"
            className={styles.ghost}
            disabled={busy === 'materials'}
            onClick={onRecheck}
          >
            {busy === 'materials' ? 'Đang kiểm…' : 'Kiểm lại tồn kho'}
          </button>
        ) : null}
      </header>

      {short ? (
        <p className={styles.materialAlert}>
          Bước bị chặn hoàn tất cho tới khi bổ sung đủ hàng. Nhập kho xong thì bấm “Kiểm lại tồn kho”.
        </p>
      ) : step.materialReservations?.length ? (
        <p className={styles.materialHeld}>
          Đã giữ hàng trong kho cho bước này —{' '}
          {step.materialReservations.map((code) => (
            <code key={code} style={{ background: '#d1fae5', padding: '1px 5px', borderRadius: '4px', margin: '0 2px' }}>{code}</code>
          ))}
          . Hàng được trả lại kho khi bước xong hoặc hồ sơ đóng.
        </p>
      ) : null}

      <ul className={styles.materialList}>
        {step.materials.map((item) => {
          const line = check?.lines.find((row) => row.materialCode === item.materialCode);
          return (
            <li key={item.materialCode} className={line && line.short > 0 ? styles.lineShort : ''}>
              <span>{item.materialName ?? item.materialCode}</span>
              <em style={{ color: 'var(--muted)', fontStyle: 'normal' }}>
                cần {item.quantity}
                {item.unit ? ` ${item.unit}` : ''}
              </em>
              <strong>
                {line
                  ? line.short > 0
                    ? `thiếu ${line.short}`
                    : `còn ${line.available}`
                  : 'chưa kiểm'}
              </strong>
            </li>
          );
        })}
      </ul>

      {check ? (
        <small className={styles.panelHint}>
          Kiểm lúc {new Intl.DateTimeFormat('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
            day: '2-digit',
            month: '2-digit',
          }).format(new Date(check.checkedAt))}
        </small>
      ) : null}
    </article>
  );
}
