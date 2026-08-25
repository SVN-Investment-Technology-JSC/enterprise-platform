'use client';

import type { TenantOrganizationSnapshot } from '@enterprise-platform/contracts-organization';
import type {
  ProcedureDefinition,
  ProcedureInstance,
  ProcedureInstanceStep,
  ProcedureRaciRole,
  ProcedureAttachment,
  ProcedureRuntimeAction,
  ProcedureSubtaskExecutionMode,
  ProcedureSubtaskInput,
} from '@enterprise-platform/contracts-procedure-engine';
import {
  evaluateInstanceSla,
  evaluateStepSla,
  type ProcedureSlaView,
} from '@enterprise-platform/contracts-procedure-engine';
import { useEffect, useMemo, useState } from 'react';
import { AttachmentPanel } from './attachment-panel';
import { ChatPanel } from './chat-panel';
import { DetailTabs } from './detail-tabs';
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

export function WorkspaceBoard({
  busy,
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
}: {
  busy?: string;
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
  onSendComment?: (instanceId: string, body: string, mentions: string[]) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [viewMode, setViewMode] = useState<'list' | 'table'>('list');
  const [query, setQuery] = useState('');
  const [slaFilter, setSlaFilter] = useState<'all' | ProcedureSlaView['state']>('all');
  const [source, setSource] = useState<'all' | 'manual' | 'maintenance_occurrence' | 'auto_from_parent'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [activeStepDrawer, setActiveStepDrawer] = useState<{ step: ProcedureInstanceStep; tab: 'execution' | 'chat' | 'files' } | null>(null);
  const [comment, setComment] = useState('');
  const [dateSort, setDateSort] = useState<'newest' | 'oldest'>('newest');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [creating, setCreating] = useState(false);

  const published = definitions.filter((item) => item.status === 'published');
  const names = useMemo(() => subjectNames(organization), [organization]);

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

  useEffect(() => {
    setComment('');
  }, [selected?.id]);

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
            <span style={{
              background: 'rgba(37, 99, 235, 0.1)',
              color: '#2563eb',
              fontWeight: 700,
              fontSize: '12px',
              padding: '2px 9px',
              borderRadius: '999px',
              border: '1px solid rgba(37, 99, 235, 0.2)'
            }}>
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

      {/* ========================================================================= */}
      {/* 2. KPI METRIC OVERVIEW CARDS (5 CARDS)                                   */}
      {/* ========================================================================= */}
      <div className={styles.metricGrid}>
        {/* Card 1: Tất cả */}
        <div className={`${styles.metricCard} ${styles.metricCardAll}`}>
          <div className={styles.metricLabel}>Tổng số hồ sơ</div>
          <div className={styles.metricValue} style={{ color: '#2563eb' }}>{stats.total}</div>
          <div className={styles.metricHint}>Tất cả quy trình tham gia</div>
        </div>

        {/* Card 2: Đang xử lý */}
        <div className={`${styles.metricCard} ${styles.metricCardRunning}`}>
          <div className={styles.metricLabel} style={{ color: '#059669' }}>Đang xử lý</div>
          <div className={styles.metricValue} style={{ color: '#059669' }}>{stats.processing}</div>
          <div className={styles.metricHint}>Đang trong các bước thực hiện</div>
        </div>

        {/* Card 3: Duyệt gấp (SLA) */}
        <div className={`${styles.metricCard} ${styles.metricCardUrgent}`}>
          <div className={styles.metricLabel} style={{ color: '#dc2626' }}>⚠️ Duyệt gấp (SLA)</div>
          <div className={styles.metricValue} style={{ color: '#dc2626' }}>{stats.urgent}</div>
          <div className={styles.metricHint} style={{ color: '#dc2626' }}>Quá hạn hoặc sắp hết giờ</div>
        </div>

        {/* Card 4: Hoàn thành */}
        <div className={`${styles.metricCard} ${styles.metricCardCompleted}`}>
          <div className={styles.metricLabel} style={{ color: '#4f46e5' }}>Hoàn tất thành công</div>
          <div className={styles.metricValue} style={{ color: '#4f46e5' }}>{stats.completed}</div>
          <div className={styles.metricHint}>Đã kết thúc trọn vẹn</div>
        </div>

        {/* Card 5: Từ chối / Huỷ */}
        <div className={`${styles.metricCard} ${styles.metricCardRejected}`}>
          <div className={styles.metricLabel} style={{ color: '#64748b' }}>Từ chối / Đã huỷ</div>
          <div className={styles.metricValue} style={{ color: '#64748b' }}>{stats.rejected + stats.cancelled}</div>
          <div className={styles.metricHint}>{stats.rejected} từ chối · {stats.cancelled} đã huỷ</div>
        </div>
      </div>

      {creating ? (
        <div className={styles.createPanel}>
          <span>Chọn quy trình để mở đơn mới:</span>
          <div className={styles.createList}>
            {published.map((definition) => (
              <button
                key={definition.id}
                type="button"
                disabled={busy === `start:${definition.id}`}
                onClick={() => {
                  void onStart(definition).then(() => setCreating(false));
                }}
              >
                <strong>{definition.code}</strong>
                <span>{definition.name}</span>
                <small>{definition.steps.length} bước</small>
              </button>
            ))}
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
              {/* Card 1: Selected Instance Summary */}
              <article className={styles.panel}>
                <header className={styles.detailHead}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span className={styles.code}>{selected.code}</span>
                    <span className={`${styles.badge} ${styles[selected.status]}`}>
                      {STATUS_LABEL[selected.status]}
                    </span>
                  </div>
                  <SlaBadge view={evaluateInstanceSla(selected)} />
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

              {/* Card 2: Vertical Timeline (Tiến trình các bước) */}
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
                        onClick={() => setActiveStepDrawer({ step, tab: 'execution' })}
                      >
                        {/* Node Icon */}
                        <div className={`${styles.timelineNodeIcon} ${nodeClass}`}>
                          {isDone ? '✓' : isRejected ? '✕' : step.order}
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

                        <div className={styles.nodeWorkspaceLink}>
                          <span>🔍 Xem chi tiết Node Workspace</span>
                          <span>→</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>

              {/* Card 3: Action Panel (Thao tác xử lý & Phê duyệt) */}
              <ActionPanel
                busy={busy}
                comment={comment}
                instance={selected}
                onAction={onAction}
                onComment={setComment}
              />

              {/* Card 4: Material Status (Kiểm tra vật tư) */}
              <MaterialStatus
                instance={selected}
                busy={busy}
                onRecheck={onRecheckMaterials ? () => onRecheckMaterials(selected.id) : undefined}
              />

              {/* Card 5: Detail Tabs (Trao đổi · Phân rã · Tệp) */}
              <DetailTabs
                tabs={[
                  {
                    id: 'chat',
                    label: 'Trao đổi & Nhật ký',
                    count: selected.activity.length,
                    render: () => (
                      <ChatPanel
                        instance={selected}
                        busy={busy}
                        participants={participantsOf(selected, names)}
                        onSend={(body, mentions) => onSendComment?.(selected.id, body, mentions)}
                      />
                    ),
                  },
                  ...(onSeedSubtasks &&
                    onSetSubtasks &&
                    onCompleteSubtask &&
                    onCancelSubtask &&
                    onUploadEvidence
                    ? [
                      {
                        id: 'work',
                        label: 'Phân rã việc',
                        render: () => (
                          <SubtaskPanel
                            instance={selected}
                            organization={organization}
                            actorId={actorId}
                            busy={busy}
                            attachments={attachments}
                            onSeed={() => onSeedSubtasks(selected.id)}
                            onSetItems={(items, mode) => onSetSubtasks(selected.id, items, mode)}
                            onComplete={(subtaskId) => onCompleteSubtask(selected.id, subtaskId)}
                            onCancel={(subtaskId) => onCancelSubtask(selected.id, subtaskId)}
                            onUpload={(subtaskId, file) =>
                              onUploadEvidence(selected.id, subtaskId, file)
                            }
                          />
                        ),
                      },
                    ]
                    : []),
                  {
                    id: 'files',
                    label: 'Tệp đính kèm',
                    count: attachments.filter((item) => item.instanceId === selected.id).length,
                    render: () => (
                      <AttachmentPanel
                        instance={selected}
                        attachments={attachments}
                        busy={busy}
                        onUpload={(file) => onUploadFile?.(selected.id, file)}
                      />
                    ),
                  },
                ]}
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
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 100,
          display: 'flex',
          justifyContent: 'flex-end',
          background: 'rgba(15, 23, 42, 0.5)',
          backdropFilter: 'blur(4px)'
        }}>
          <div
            style={{
              width: '100%',
              maxWidth: '680px',
              background: '#ffffff',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '-8px 0 32px rgba(15, 23, 42, 0.2)',
              animation: 'fadeIn 0.2s ease-out'
            }}
          >
            {/* Drawer Header */}
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--line)',
              background: '#f8fafc',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ background: 'rgba(37, 99, 235, 0.1)', color: '#2563eb', fontWeight: 700, fontSize: '11px', padding: '2px 8px', borderRadius: '4px' }}>
                      BƯỚC {activeStepDrawer.step.order}
                    </span>
                    <span className={`${styles.badge} ${styles[activeStepDrawer.step.status]}`}>
                      {activeStepDrawer.step.status}
                    </span>
                    {activeStepDrawer.step.slaHours ? (
                      <span style={{ fontSize: '11px', color: 'var(--muted)', background: '#e2e8f0', padding: '2px 6px', borderRadius: '4px' }}>
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
                  style={{ border: 'none', background: 'transparent', fontSize: '20px', cursor: 'pointer', color: 'var(--faint)' }}
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
                    color: activeStepDrawer.tab === 'execution' ? '#ffffff' : 'var(--ink)'
                  }}
                >
                  1. Xử lý & Phân công RACI
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
                    color: activeStepDrawer.tab === 'chat' ? '#ffffff' : 'var(--ink)'
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
                    color: activeStepDrawer.tab === 'files' ? '#ffffff' : 'var(--ink)'
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
                        <div key={asgn.id} style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 14px',
                          borderRadius: '8px',
                          border: '1px solid var(--line)',
                          background: '#f8fafc'
                        }}>
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
                            {asgn.role === 'R' ? 'Thực hiện chính' : asgn.role === 'A' ? 'Phê duyệt cuối' : asgn.role === 'C' ? 'Kiểm soát / Tham vấn' : asgn.role === 'S' ? 'Hỗ trợ' : asgn.role === 'E' ? 'Chuyên gia' : 'Thông báo'}
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
                          <li key={mat.materialCode} style={{
                            padding: '8px 12px',
                            background: '#f1f5f9',
                            borderRadius: '6px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: '12.5px'
                          }}>
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
                    onSend={(body, mentions) => onSendComment?.(selected.id, body, mentions)}
                  />
                </div>
              ) : (
                <div>
                  <AttachmentPanel
                    instance={selected}
                    attachments={attachments}
                    busy={busy}
                    onUpload={(file) => onUploadFile?.(selected.id, file)}
                  />
                </div>
              )}
            </div>

            {/* Drawer Footer */}
            <div style={{
              padding: '12px 20px',
              borderTop: '1px solid var(--line)',
              background: '#f8fafc',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <button
                type="button"
                className={styles.ghost}
                onClick={() => setActiveStepDrawer(null)}
              >
                Đóng Drawer
              </button>
              <button
                type="button"
                className={styles.primary}
                onClick={() => setActiveStepDrawer(null)}
              >
                Về khung thao tác hồ sơ
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ActionPanel({
  busy,
  comment,
  instance,
  onAction,
  onComment,
}: {
  busy?: string;
  comment: string;
  instance: ProcedureInstance;
  onAction: (
    instanceId: string,
    action: ProcedureRuntimeAction,
    comment?: string,
    returnToStepId?: string,
  ) => Promise<void>;
  onComment: (value: string) => void;
}) {
  const authorization = instance.authorization;
  const current = instance.steps.find((step) => step.id === instance.currentStepId);
  const currentIndex = instance.steps.findIndex((step) => step.id === instance.currentStepId);

  const fixedRollback = current?.assignments.find(
    (item) => item.role === 'C' && item.fixedRollbackStepId,
  )?.fixedRollbackStepId;
  const canPickReturnStep =
    current?.currentRoleStage === 'A' && !fixedRollback && currentIndex > 0;
  const earlierSteps = currentIndex > 0 ? instance.steps.slice(0, currentIndex) : [];
  const [returnTo, setReturnTo] = useState('');
  const actions = authorization?.availableActions ?? [];
  const canAct = actions.length > 0 || (authorization?.myRoles.length ?? 0) > 0;

  return (
    <article className={styles.panel}>
      <header className={styles.actionHead}>
        <h3 className={styles.panelTitle}>Xử lý &amp; Phê duyệt</h3>
        {current ? <span className={styles.stepBadge}>Bước: {current.name}</span> : null}
      </header>

      {!authorization || !canAct ? (
        <p className={styles.panelHint}>
          Bạn không giữ vai trò nào ở bước hiện tại — chỉ theo dõi được tiến trình.
        </p>
      ) : (
        <>
          <p className={styles.myRoles}>
            Vai trò bạn giữ ở bước này:{' '}
            {authorization.myRoles.length > 0 ? (
              authorization.myRoles.map((role) => (
                <i key={role} className={`${styles.role} ${styles[`role${role}`]}`}>
                  {role}
                </i>
              ))
            ) : (
              <span className={styles.tag}>quản trị — quyền override</span>
            )}
            {authorization.isDelegated ? (
              <span className={styles.tag}>được uỷ quyền</span>
            ) : null}
            {authorization.isEscalated ? (
              <span className={styles.tag}>xử lý thay cấp dưới</span>
            ) : null}
          </p>

          <label className={styles.commentField}>
            Ghi chú phản hồi / lý do từ chối (Ctrl+Enter để gửi)
            <textarea
              rows={3}
              placeholder="Nhập nhận xét hoặc phương án điều chỉnh…"
              value={comment}
              onChange={(event) => onComment(event.target.value)}
            />
          </label>

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

          {actions.length === 0 ? (
            <p className={styles.panelHint}>
              Chưa tới lượt bạn: bước này đang ở pha {current?.currentRoleStage ?? '—'}.
            </p>
          ) : (
            <div className={styles.actionRow}>
              {actions
                .filter((action) => action !== 'approve' && action !== 'complete')
                .map((action) => (
                  <button
                    key={action}
                    type="button"
                    className={action === 'reject' ? styles.danger : styles.ghost}
                    disabled={busy === `${action}:${instance.id}`}
                    onClick={() =>
                      void onAction(
                        instance.id,
                        action,
                        comment || undefined,
                        action === 'return' ? returnTo || undefined : undefined,
                      )
                    }
                  >
                    {busy === `${action}:${instance.id}` ? 'Đang xử lý…' : ACTION_LABEL[action]}
                  </button>
                ))}
              {actions
                .filter((action) => action === 'approve' || action === 'complete')
                .map((action) => (
                  <button
                    key={action}
                    type="button"
                    className={styles.primary}
                    disabled={busy === `${action}:${instance.id}`}
                    onClick={() => void onAction(instance.id, action, comment || undefined)}
                  >
                    {busy === `${action}:${instance.id}` ? 'Đang xử lý…' : ACTION_LABEL[action]}
                  </button>
                ))}
            </div>
          )}
        </>
      )}
    </article>
  );
}

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
          Bước bị chặn hoàn tất cho tới khi bổ sung đủ hàng. Nhập kho xong thì bấm “Kiểm lại tồn
          kho”.
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
