'use client';

import type { TenantOrganizationSnapshot } from '@enterprise-platform/contracts-organization';
import type {
  ProcedureDefinition,
  ProcedureInstance,
  ProcedureInstanceStep,
  ProcedureInstanceStepStatus,
  ProcedureRaciRole,
  ProcedureAttachment,
  ProcedureRuntimeAction,
  ProcedureSubtaskExecutionMode,
  ProcedureSubtaskInput,
  RequestProcedureMaterialsRequest,
} from '@enterprise-platform/contracts-procedure-engine';
import {
  evaluateInstanceSla,
  evaluateStepSla,
  PROCEDURE_STAGE_ORDER,
  type ProcedureSlaView,
} from '@enterprise-platform/contracts-procedure-engine';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AttachmentPanel } from './attachment-panel';
import { ChatPanel } from './chat-panel';
import { DetailTabs } from './detail-tabs';
import { HistoryPanel } from './history-panel';
import { LinkedPanel } from './linked-panel';
import { MaterialRequestPanel } from './material-request-panel';
import { SlaBadge } from './sla-badge';
import type { AssetCatalogItem, MaterialCatalogItem } from '../procedure-api';
import { SubtaskPanel } from './subtask-panel';
import styles from './workspace-board.module.scss';

const STATUS_LABEL: Record<ProcedureInstance['status'], string> = {
  running: 'Đang xử lý',
  completed: 'Hoàn thành',
  rejected: 'Từ chối',
  cancelled: 'Đã huỷ',
};

type Filter = 'all' | ProcedureInstance['status'];

/**
 * Suy ra từ STATUS_LABEL chứ không liệt kê tay.
 *
 * Bản liệt kê tay trước đây thiếu 'cancelled', nên đơn đã huỷ không lọc tới
 * được và tổng các tab không khớp con số "Tất cả".
 */
const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: 'all', label: 'Tất cả' },
  ...(Object.keys(STATUS_LABEL) as ProcedureInstance['status'][]).map((status) => ({
    id: status as Filter,
    label: STATUS_LABEL[status],
  })),
];

const STEP_ICON: Record<ProcedureInstanceStepStatus, string> = {
  pending: '○',
  active: '↻',
  ready: '↻',
  completed: '✓',
  returned: '↩',
  rejected: '✕',
  cancelled: '⊘',
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

/**
 * Tên người thực sự nhận việc. Phân công ở cấp đơn vị định tuyến tới người phụ
 * trách, nên chỉ hiện tên đơn vị thì người dùng không biết ai phải làm.
 */
function subjectNames(snapshot?: TenantOrganizationSnapshot) {
  const label = new Map<string, string>();
  if (!snapshot) return label;

  // Snapshot đến từ Core qua HTTP; một phản hồi thiếu trường không được phép làm
  // trắng cả màn hình Workspace, nên đọc phòng thủ thay vì tin vào kiểu.
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

/** Người có mặt trong hồ sơ, để gợi ý @ và tô đậm khi hiển thị. */
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

/** “S: Phạm Thị Hà, Lê Văn Nam; C: Nguyễn Văn Tuấn” — ai giữ vai trò gì ở bước. */
function roleLines(step: ProcedureInstanceStep, names: ReadonlyMap<string, string>) {
  return ROLE_ORDER.flatMap((role) => {
    const holders = step.assignments
      .filter((item) => item.role === role)
      .map((item) => names.get(item.subjectId) ?? item.subjectLabel ?? item.subjectId);
    return holders.length > 0 ? [{ role, names: holders.join(', ') }] : [];
  });
}

/**
 * Phần trăm hoàn thành của một bước.
 *
 * Một bước chạy lần lượt qua các pha RACI mà nó có (S → R → E → C → A). Tiến độ
 * gồm hai phần: số pha đã đi qua trọn vẹn, cộng phần dở dang của pha đang chạy.
 *
 * Phần dở dang lấy từ **trọng số đầu việc đã xong** khi bước đang ở pha E và đã
 * phân rã — đây là con số thật, không phải ước lượng, vì tổng trọng số luôn bằng
 * 100. Các pha khác không có thước đo nào bên trong nên tính nửa pha: đang làm
 * mà hiện 0% thì người xem tưởng chưa ai động tới.
 */
/**
 * Phần đã hoàn thành của một bước, từ 0 đến 1.
 *
 * Ba luật dễ sai, nên viết rõ:
 *  - Bước bị trả về tính bằng 0. Nó phải làm lại từ đầu, và vẽ nó gần đầy trong
 *    khi biểu tượng ghi "↩" thì mâu thuẫn ngay trên màn hình.
 *  - Chưa ai thao tác ở bước thì thanh để TRỐNG. Trước đây mọi bước đang mở đều
 *    được cộng sẵn nửa chặng, nên hồ sơ vừa mở đã hiện như đang làm dở.
 *  - Ở chặng E, tiến độ lấy theo trọng số các đầu việc con đã xong.
 */
function stepProgress(step: ProcedureInstanceStep, instance: ProcedureInstance): number {
  if (step.status === 'completed') return 1;
  if (step.status === 'rejected' || step.status === 'cancelled') return 0;
  if (step.status === 'pending' || step.status === 'returned') return 0;

  const stages = PROCEDURE_STAGE_ORDER.filter((role) =>
    step.assignments.some((assignment) => assignment.role === role),
  );
  if (stages.length === 0 || !step.currentRoleStage) return 0;

  const passed = stages.indexOf(step.currentRoleStage);
  if (passed < 0) return 0;

  // Chưa có thao tác nào ở bước này thì chưa có gì để tô.
  const touched = instance.activity.some(
    (entry) => entry.stepInstanceId === step.id && entry.action !== 'comment',
  );
  let partial = touched ? 0.5 : 0;
  if (step.currentRoleStage === 'E') {
    const subtasks = (instance.subtasks ?? []).filter((item) => item.stepInstanceId === step.id);
    if (subtasks.length > 0) {
      partial =
        subtasks
          .filter((item) => item.status === 'completed')
          .reduce((sum, item) => sum + item.weight, 0) / 100;
    }
  }

  return Math.min(1, (passed + partial) / stages.length);
}

export function WorkspaceBoard({
  busy,
  materialCatalog = [],
  assetCatalog = [],
  onPickAsset,
  groups = [],
  handoffTitle,
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
}: {
  busy?: string;
  /** Danh mục vật tư của Kho, để vai E chọn vật tư cho từng đầu việc. */
  materialCatalog?: readonly MaterialCatalogItem[];
  /** Danh mục thiết bị để vai E chọn lúc chạy. */
  assetCatalog?: readonly AssetCatalogItem[];
  onPickAsset?: (instanceId: string, assetCode: string) => void;
  /** Danh mục nhóm quy trình đang bật, để lọc hồ sơ theo nhóm. */
  groups?: readonly { code: string; label: string }[];
  /** Nội dung do module khác chuyển sang; có thì mở sẵn khung chọn quy trình. */
  handoffTitle?: string;
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
  onSendComment?: (
    instanceId: string,
    body: string,
    mentions: string[],
    replyToId?: string,
  ) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [slaFilter, setSlaFilter] = useState<'all' | ProcedureSlaView['state']>('all');
  const [source, setSource] = useState<'all' | 'manual' | 'maintenance_occurrence' | 'auto_from_parent'>('all');
  const [groupFilter, setGroupFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [comment, setComment] = useState('');
  const [dateSort, setDateSort] = useState<'newest' | 'oldest'>('newest');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'chat' | 'files' | 'linked' | 'history' | 'materials'>('chat');

  /**
   * Có nội dung chuyển sang từ module khác thì mở sẵn khung chọn quy trình.
   *
   * Không tự chọn quy trình hộ: chỉ người dùng mới biết tenant này dùng thủ tục
   * nào cho việc đó, và đoán sai là mở nhầm quy trình.
   */
  useEffect(() => {
    if (handoffTitle) setCreating(true);
  }, [handoffTitle]);

  const published = definitions.filter((item) => item.status === 'published');

  /**
   * Hồ sơ con mở tại TỪNG BƯỚC của hồ sơ đang xem.
   *
   * Lấy `stepInstanceId` từ nhật ký của hồ sơ mẹ — chính chỗ mở hồ sơ con đã ghi
   * lại nó cùng mã hồ sơ. Không suy từ thời điểm tạo: một bước có thể mở nhiều
   * hồ sơ cách nhau vài ngày, và bước sau đó lại mở tiếp.
   */
  const ordersByStep = useMemo(() => {
    const map = new Map<string, ProcedureInstance[]>();
    const selectedInstance = instances.find((item) => item.id === selectedId);
    if (!selectedInstance) return map;
    const byCode = new Map(instances.map((item) => [item.code, item]));
    for (const entry of selectedInstance.activity) {
      if (!entry.stepInstanceId) continue;
      for (const code of entry.summary.match(/PR-\d{8}-[A-Z0-9]+/g) ?? []) {
        const child = byCode.get(code);
        if (!child || child.id === selectedInstance.id) continue;
        const list = map.get(entry.stepInstanceId) ?? [];
        if (!list.some((item) => item.id === child.id)) list.push(child);
        map.set(entry.stepInstanceId, list);
      }
    }
    return map;
  }, [instances, selectedId]);

  /**
   * Nhóm nằm trên ĐỊNH NGHĨA chứ không trên hồ sơ, nên phải tra ngược qua
   * `definitionId`. Không chụp nhóm vào hồ sơ có chủ đích: admin đổi nhóm thì
   * mọi hồ sơ cũ phải theo nhóm mới ngay, không phải đợi hồ sơ mới.
   */
  const categoryOf = useMemo(
    () => new Map(definitions.map((item) => [item.id, item.category])),
    [definitions],
  );
  const names = useMemo(() => subjectNames(organization), [organization]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    // Ngày lọc theo NGÀY BẮT ĐẦU của hồ sơ, tính theo mốc đầu/cuối ngày để người
    // dùng chọn "từ 19/8 đến 19/8" vẫn ra hồ sơ mở trong ngày đó.
    const fromTime = from ? new Date(`${from}T00:00:00`).getTime() : undefined;
    const toTime = to ? new Date(`${to}T23:59:59.999`).getTime() : undefined;

    const matched = instances.filter((instance) => {
      if (filter !== 'all' && instance.status !== filter) return false;
      if (source !== 'all' && (instance.sourceType ?? 'manual') !== source) return false;
      if (groupFilter && categoryOf.get(instance.definitionId) !== groupFilter) return false;
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

    // Mặc định sắp theo ngày mở hồ sơ, mới nhất trước. Sắp ở đây chứ không dựa
    // vào thứ tự server trả về, để mọi bộ lọc đều cho ra cùng một trật tự.
    return [...matched].sort((left, right) =>
      dateSort === 'newest'
        ? right.startedAt.localeCompare(left.startedAt)
        : left.startedAt.localeCompare(right.startedAt),
    );
  }, [filter, instances, query, source, slaFilter, from, to, dateSort, groupFilter, categoryOf]);

  const PAGE_SIZE = 20;
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  // Bộ lọc đổi có thể làm trang hiện tại vượt quá số trang còn lại.
  const currentPage = Math.min(page, pageCount);
  const paged = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const filtersActive =
    source !== 'all' || slaFilter !== 'all' || Boolean(from) || Boolean(to);

  // Luôn giữ một đơn được chọn: danh sách đổi theo bộ lọc nên lựa chọn cũ có
  // thể biến mất khỏi màn hình.
  const selected =
    visible.find((instance) => instance.id === selectedId) ?? paged[0] ?? visible[0];

  useEffect(() => {
    setComment('');
  }, [selected?.id]);

  return (
    <section className={styles.workspace}>
      <header className={styles.topBar}>
        <div>
          <h1>Workspace</h1>
          {/* Tên người đăng nhập đã có ở thanh shell; nhắc lại ở đây là thừa. */}
          <p>
            Chỉ hiện những đơn bạn đang giữ vai trò, ở bất kỳ bước nào — kể cả việc được uỷ quyền
            lại hoặc được phân rã cho bạn.
          </p>
        </div>
        <div className={styles.topActions}>
          {published.length > 0 ? (
            <button
              type="button"
              className={styles.primary}
              onClick={() => setCreating((open) => !open)}
            >
              <span aria-hidden="true">⊕</span> Tạo Đơn / Yêu cầu Mới
            </button>
          ) : null}
          <input
            className={styles.search}
            placeholder="Tìm kiếm đơn, mã…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </header>

      {creating ? (
        <div className={styles.createPanel}>
          <span>
            {handoffTitle
              ? `Chọn quy trình cho: ${handoffTitle}`
              : 'Chọn quy trình để mở đơn mới:'}
          </span>
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

      <nav className={styles.filters}>
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={filter === entry.id ? styles.filterOn : undefined}
            onClick={() => setFilter(entry.id)}
          >
            {entry.label}
            <span className={styles.filterCount}>
              {entry.id === 'all'
                ? instances.length
                : instances.filter((item) => item.status === entry.id).length}
            </span>
          </button>
        ))}
      </nav>

      <div className={styles.moreFilters}>
        {groups.length > 0 ? (
          <label>
            Nhóm
            <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
              <option value="">Tất cả nhóm</option>
              {groups.map((group) => (
                <option key={group.code} value={group.code}>
                  {group.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Sắp xếp
          <select
            value={dateSort}
            onChange={(event) => {
              setDateSort(event.target.value as 'newest' | 'oldest');
              setPage(1);
            }}
          >
            <option value="newest">Ngày mở — mới nhất trước</option>
            <option value="oldest">Ngày mở — cũ nhất trước</option>
          </select>
        </label>
        <label>
          SLA
          <select
            value={slaFilter}
            onChange={(event) => setSlaFilter(event.target.value as typeof slaFilter)}
          >
            <option value="all">Tất cả</option>
            <option value="breached">Đã quá hạn</option>
            <option value="warning">Sắp đến hạn</option>
            <option value="ok">Còn thời gian</option>
            <option value="none">Không cài SLA</option>
          </select>
        </label>
        <label>
          Nguồn
          <select value={source} onChange={(event) => setSource(event.target.value as typeof source)}>
            <option value="all">Tất cả</option>
            <option value="manual">Tạo thủ công</option>
            <option value="maintenance_occurrence">Từ bảo trì</option>
            <option value="auto_from_parent">Nối tiếp quy trình</option>
          </select>
        </label>
        <label>
          Mở từ ngày
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          Đến ngày
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        {filtersActive ? (
          <button
            type="button"
            className={styles.ghost}
            onClick={() => {
              setSlaFilter('all');
              setSource('all');
              setFrom('');
              setTo('');
            }}
          >
            Xoá lọc
          </button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <div className={styles.empty}>
          <h2>
            {filtersActive || query
              ? 'Không có đơn nào khớp bộ lọc'
              : 'Không có đơn nào bạn đang tham gia'}
          </h2>
          <p>
            Workspace chỉ hiện đơn mà bạn giữ vai trò. Nếu cần xem toàn bộ quy trình của doanh
            nghiệp, mở bảng thiết kế ma trận RCSI.
          </p>
          <button type="button" className={styles.ghost} onClick={onOpenDefinitions}>
            Mở ma trận quy trình
          </button>
        </div>
      ) : (
        <>
          {pageCount > 1 ? (
            <div className={styles.pager}>
              <span>
                {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, visible.length)}{' '}
                trên {visible.length} hồ sơ
              </span>
              <div>
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  ← Trước
                </button>
                <strong>
                  {currentPage} / {pageCount}
                </strong>
                <button
                  type="button"
                  disabled={currentPage >= pageCount}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Sau →
                </button>
              </div>
            </div>
          ) : null}

          <div className={styles.cardStrip}>
            {paged.map((instance) => (
              <button
                key={instance.id}
                type="button"
                className={`${styles.orderCard} ${
                  instance.id === selected?.id ? styles.orderCardOn : ''
                }`}
                onClick={() => setSelectedId(instance.id)}
              >
                <span className={styles.cardTop}>
                  <span className={styles.code}>{instance.code}</span>
                  <span className={`${styles.badge} ${styles[instance.status]}`}>
                    {STATUS_LABEL[instance.status]}
                  </span>
                </span>
                <strong>{instance.title}</strong>
                <span className={styles.cardFoot}>
                  <span>{instance.definitionCode}</span>
                  <span className={styles.cardFootRight}>
                    <SlaBadge view={evaluateInstanceSla(instance)} />
                    {instance.steps.filter((step) => step.status === 'completed').length}/
                    {instance.steps.length} bước
                  </span>
                </span>
              </button>
            ))}
          </div>

          {selected ? (
            <div className={styles.detailLayout}>
              <div className={styles.detailMain}>
                <article className={styles.panel}>
                  <header className={styles.detailHead}>
                    <span className={styles.code}>{selected.code}</span>
                    <span className={`${styles.badge} ${styles[selected.status]}`}>
                      {STATUS_LABEL[selected.status]}
                    </span>
                  </header>
                  <h2 className={styles.detailTitle}>{selected.title}</h2>

                  <dl className={styles.metaGrid}>
                    <div>
                      <dt>Người khởi tạo</dt>
                      <dd>
                        {selected.activity.find((entry) => entry.action === 'start')?.actorName ??
                          '—'}
                      </dd>
                    </div>
                    <div>
                      <dt>Đơn vị</dt>
                      <dd>
                        {selected.steps[0]?.assignments.find((item) => item.role === 'S')
                          ?.subjectLabel ?? '—'}
                      </dd>
                    </div>
                    <div>
                      <dt>Quy trình</dt>
                      <dd>
                        {selected.definitionName}
                        <small> · v{selected.definitionVersion}</small>
                      </dd>
                    </div>
                    <div>
                      <dt>Nguồn</dt>
                      <dd>
                        {selected.sourceType === 'maintenance_occurrence'
                          ? 'Lịch bảo trì'
                          : 'Tạo thủ công'}
                      </dd>
                    </div>
                    <div>
                      <dt>{selected.completedAt ? 'Hoàn thành' : 'Bắt đầu'}</dt>
                      <dd>{formatDateTime(selected.completedAt ?? selected.startedAt)}</dd>
                    </div>
                  </dl>
                </article>

                <article className={styles.panel}>
                  <h3 className={styles.panelTitle}>
Tiến trình các bước
                  </h3>
                  <div className={styles.stepStrip}>
                    {selected.steps.map((step) => (
                      <div
                        key={step.id}
                        className={`${styles.stepCard} ${
                          step.id === selected.currentStepId ? styles.stepCurrent : ''
                        } ${styles[`step_${step.status}`]}`}
                        // Nền xanh phủ đúng phần đã hoàn thành. Dùng biến CSS thay
                        // vì đặt nền trực tiếp, để lớp trạng thái vẫn giữ được màu
                        // viền và màu nền nền của nó.
                        style={
                          {
                            '--progress': `${Math.round(stepProgress(step, selected) * 100)}%`,
                          } as CSSProperties
                        }
                      >
                        <span className={styles.stepTop}>
                          <span>BƯỚC {step.order}</span>
                          <span className={styles.stepIcon}>{STEP_ICON[step.status]}</span>
                        </span>
                        <strong>{step.name}</strong>
                        <ul className={styles.stepRoles}>
                          {roleLines(step, names).map((line) => (
                            <li key={line.role}>
                              <i className={`${styles.role} ${styles[`role${line.role}`]}`}>
                                {line.role}
                              </i>
                              {line.names}
                            </li>
                          ))}
                          {step.assignments.length === 0 ? (
                            <li className={styles.stepMuted}>Chưa phân vai</li>
                          ) : null}
                        </ul>
                        {(ordersByStep.get(step.id) ?? []).length > 0 ? (
                          <ul className={styles.stepOrders}>
                            {(ordersByStep.get(step.id) ?? []).map((order) => (
                              <li key={order.id}>
                                <button
                                  type="button"
                                  className={`${styles.stepOrder} ${
                                    styles[`orderState_${order.status}`]
                                  }`}
                                  title={`${order.title} — ${STATUS_LABEL[order.status]}`}
                                  onClick={() => setSelectedId(order.id)}
                                >
                                  <span className={styles.stepOrderCode}>{order.code}</span>
                                  <span className={styles.stepOrderDot} aria-hidden="true" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}

                        <span className={styles.stepFoot}>
                          {step.currentRoleStage ? (
                            <span className={styles.stepStage}>
                              Đang ở pha {step.currentRoleStage}
                            </span>
                          ) : null}
                          <SlaBadge
                            view={evaluateStepSla(step, selected)}
                            slaHours={step.slaHours}
                            startedAt={step.startedAt}
                          />
                        </span>
                      </div>
                    ))}
                  </div>
                </article>
              </div>

              <aside className={styles.detailSide}>
                <ActionPanel
                  busy={busy}
                  comment={comment}
                  instance={selected}
                  onAction={onAction}
                  onComment={setComment}
                  onOpenDrawer={(tab) => {
                    setDrawerTab(tab);
                    setDrawerOpen(true);
                  }}
                />

                <MaterialStatus
                  instance={selected}
                  busy={busy}
                  onRecheck={onRecheckMaterials ? () => onRecheckMaterials(selected.id) : undefined}
                />

                <LinkedPanel
                  instance={selected}
                  instances={instances}
                  onOpen={(instanceId) => setSelectedId(instanceId)}
                />

                <DetailTabs
                  tabs={[
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
                                materialCatalog={materialCatalog}
                                assetCatalog={assetCatalog}
                                onPickAsset={
                                  onPickAsset
                                    ? (assetCode) => onPickAsset(selected.id, assetCode)
                                    : undefined
                                }
                                definitions={definitions}
                                onRequestMaterials={
                                  onRequestMaterials
                                    ? (input) => onRequestMaterials(selected.id, input)
                                    : undefined
                                }
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
                    ...(onRequestMaterials &&
                    !(selected.authorization?.canManageSubtasks ?? false) &&
                    (selected.authorization?.myRoles.length ?? 0) > 0
                      ? [
                          {
                            id: 'materials',
                            label: 'Xin vật tư',
                            render: () => (
                              <MaterialRequestPanel
                                instance={selected}
                                materialCatalog={materialCatalog}
                                definitions={definitions}
                                busy={busy}
                                onRequest={(input) => onRequestMaterials(selected.id, input)}
                              />
                            ),
                          },
                        ]
                      : []),
                    {
                      id: 'files',
                      label: 'Tệp',
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
                    {
                      id: 'chat',
                      label: 'Trao đổi',
                      count: selected.activity.filter((entry) => entry.action === 'comment').length,
                      render: () => (
                        <ChatPanel
                          instance={selected}
                          busy={busy}
                          participants={participantsOf(selected, names)}
                          onSend={(body, mentions, replyToId) =>
                            onSendComment?.(selected.id, body, mentions, replyToId)
                          }
                        />
                      ),
                    },
                    {
                      id: 'history',
                      label: 'Lịch sử thao tác',
                      count: selected.activity.filter((entry) => entry.action !== 'comment').length,
                      render: () => <HistoryPanel instance={selected} />,
                    },
                  ]}
                />
              </aside>
            </div>
          ) : null}

          {/* Contextual Workspace Drawer (Right Slide-In) */}
          {drawerOpen && selected ? (
            <div className={styles.drawerBackdrop} onClick={() => setDrawerOpen(false)}>
              <div className={styles.drawerPanel} onClick={(e) => e.stopPropagation()}>
                <header className={styles.drawerHeader}>
                  <div>
                    <span className={styles.code}>{selected.code}</span>
                    <h3 className={styles.drawerTitle}>{selected.title}</h3>
                  </div>
                  <button
                    type="button"
                    className={styles.drawerCloseBtn}
                    onClick={() => setDrawerOpen(false)}
                  >
                    ✕
                  </button>
                </header>

                <nav className={styles.drawerNavTabs}>
                  <button
                    type="button"
                    className={`${styles.drawerNavTab} ${
                      drawerTab === 'chat' ? styles.drawerNavTabActive : ''
                    }`}
                    onClick={() => setDrawerTab('chat')}
                  >
                    💬 Trao đổi ({selected.activity.filter((e) => e.action === 'comment').length})
                  </button>
                  <button
                    type="button"
                    className={`${styles.drawerNavTab} ${
                      drawerTab === 'files' ? styles.drawerNavTabActive : ''
                    }`}
                    onClick={() => setDrawerTab('files')}
                  >
                    📎 Tệp đính kèm ({attachments.filter((a) => a.instanceId === selected.id).length})
                  </button>
                  <button
                    type="button"
                    className={`${styles.drawerNavTab} ${
                      drawerTab === 'linked' ? styles.drawerNavTabActive : ''
                    }`}
                    onClick={() => setDrawerTab('linked')}
                  >
                    🔗 Hồ sơ liên kết
                  </button>
                  <button
                    type="button"
                    className={`${styles.drawerNavTab} ${
                      drawerTab === 'history' ? styles.drawerNavTabActive : ''
                    }`}
                    onClick={() => setDrawerTab('history')}
                  >
                    📜 Nhật ký kiểm toán ({selected.activity.filter((e) => e.action !== 'comment').length})
                  </button>
                </nav>

                <div className={styles.drawerBody}>
                  {drawerTab === 'chat' ? (
                    <ChatPanel
                      instance={selected}
                      busy={busy}
                      participants={participantsOf(selected, names)}
                      onSend={(body, mentions, replyToId) =>
                        onSendComment?.(selected.id, body, mentions, replyToId)
                      }
                    />
                  ) : null}
                  {drawerTab === 'files' ? (
                    <AttachmentPanel
                      instance={selected}
                      attachments={attachments}
                      busy={busy}
                      onUpload={(file) => onUploadFile?.(selected.id, file)}
                    />
                  ) : null}
                  {drawerTab === 'linked' ? (
                    <LinkedPanel
                      instance={selected}
                      instances={instances}
                      onOpen={(instanceId) => {
                        setSelectedId(instanceId);
                        setDrawerOpen(false);
                      }}
                    />
                  ) : null}
                  {drawerTab === 'history' ? (
                    <HistoryPanel instance={selected} />
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function ActionPanel({
  busy,
  comment,
  instance,
  onAction,
  onComment,
  onOpenDrawer,
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
  onOpenDrawer: (tab: 'chat' | 'files' | 'linked' | 'history') => void;
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

  // Popconfirm states
  const [confirmRejectOpen, setConfirmRejectOpen] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

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
            Ghi chú phản hồi / lý do từ chối
            <textarea
              rows={4}
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
                .filter(
                  (action) =>
                    action !== 'approve' && action !== 'complete' && action !== 'cancel',
                )
                .map((action) => {
                  if (action === 'reject') {
                    return (
                      <div key={action} className={styles.popconfirmWrapper}>
                        <button
                          type="button"
                          className={styles.danger}
                          disabled={busy === `reject:${instance.id}`}
                          onClick={() => {
                            setConfirmCancelOpen(false);
                            setConfirmRejectOpen((prev) => !prev);
                          }}
                        >
                          {busy === `reject:${instance.id}` ? 'Đang xử lý…' : 'Từ chối'}
                        </button>
                        {confirmRejectOpen ? (
                          <div className={styles.popconfirmBox}>
                            <div className={styles.popconfirmArrow} />
                            <div className={styles.popconfirmTitle}>⚠️ Xác nhận từ chối?</div>
                            <div className={styles.popconfirmDesc}>
                              Hồ sơ sẽ bị chuyển sang trạng thái Từ chối và dừng các bước sau.
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
                                disabled={busy === `reject:${instance.id}`}
                                onClick={() => {
                                  setConfirmRejectOpen(false);
                                  void onAction(instance.id, 'reject', comment || undefined);
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
                  );
                })}

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

          {/* Dedicated Cancel Row with Popconfirm */}
          {actions.includes('cancel') ? (
            <div className={styles.cancelRow}>
              <div className={styles.popconfirmWrapper}>
                <button
                  type="button"
                  className={styles.dangerGhost}
                  disabled={busy === `cancel:${instance.id}`}
                  onClick={() => {
                    setConfirmRejectOpen(false);
                    setConfirmCancelOpen((prev) => !prev);
                  }}
                >
                  🗑️ Huỷ hồ sơ quy trình
                </button>
                {confirmCancelOpen ? (
                  <div className={styles.popconfirmBox}>
                    <div className={styles.popconfirmArrow} />
                    <div className={styles.popconfirmTitle}>⛔ Xác nhận huỷ hồ sơ?</div>
                    <div className={styles.popconfirmDesc}>
                      Hồ sơ sẽ bị đóng vĩnh viễn và không thể phục hồi hoặc tiếp tục các bước sau.
                    </div>
                    <div className={styles.popconfirmActions}>
                      <button
                        type="button"
                        className={styles.ghost}
                        style={{ fontSize: '11px', padding: '3px 8px' }}
                        onClick={() => setConfirmCancelOpen(false)}
                      >
                        Giữ lại
                      </button>
                      <button
                        type="button"
                        className={styles.danger}
                        style={{ fontSize: '11px', padding: '3px 10px' }}
                        disabled={busy === `cancel:${instance.id}`}
                        onClick={() => {
                          setConfirmCancelOpen(false);
                          void onAction(instance.id, 'cancel', comment || undefined);
                        }}
                      >
                        Đồng ý huỷ
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      )}

      {/* Button to open Contextual Drawer */}
      <div className={styles.utilityRow}>
        <button
          type="button"
          className={styles.utilityBtn}
          style={{ width: '100%', justifyContent: 'center' }}
          onClick={() => onOpenDrawer('chat')}
        >
          🗂️ Không gian lưu trữ &amp; Nhật ký làm việc
        </button>
      </div>
    </article>
  );
}

/**
 * Tình trạng vật tư của bước hiện tại.
 *
 * Hiện ngay trên panel chi tiết chứ không giấu trong tab: bước thiếu hàng là thứ
 * chặn công việc, người dùng phải thấy trước khi bấm bất cứ nút nào.
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
          Bước bị chặn hoàn tất cho tới khi bổ sung đủ hàng. Nhập kho xong thì bấm “Kiểm lại tồn
          kho”.
        </p>
      ) : step.materialReservations?.length ? (
        <p className={styles.materialHeld}>
          Đã giữ hàng trong kho cho bước này —{' '}
          {step.materialReservations.map((code) => (
            <code key={code}>{code}</code>
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
              <em>
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
