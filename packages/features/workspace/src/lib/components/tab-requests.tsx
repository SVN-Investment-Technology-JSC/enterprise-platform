'use client';

import {
  PROJECT_REQUEST_STATUSES,
  type ProjectRequest,
  type ProjectRequestStatus,
  type SavedFilter,
  type WorkdayRule,
  type WorkdayRuleSet,
} from '@enterprise-platform/contracts-workspace';
import {
  Download,
  ExternalLink,
  FileBarChart,
  GripVertical,
  ListOrdered,
  Workflow,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  computeMonthlyWorkdays,
  DEFAULT_WORKDAY_RULES,
  formatUnits,
  monthDays,
  workdaysCsv,
} from '../project-workday.model';
import * as api from '../workspace-api';
import {
  formatDateTime,
  PROJECT_REQUEST_STATUS_LABELS,
  PROJECT_REQUEST_STATUS_TONE,
} from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { Dialog } from './dialog';
import { initials } from './project-header';
import { useDirectory } from './use-directory';

/** Đường mở hồ sơ ở module Quy trình; module đó chưa có đường tới từng hồ sơ. */
const PROCEDURE_LAUNCH_URL = '/modules/procedure#workspace';

/** `2026-10-09` → `09/10/2026`; đọc thẳng chuỗi, không qua Date (lệch múi giờ). */
function formatDay(value?: string): string {
  if (!value) return '—';
  const [year, month, day] = value.slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : '—';
}

function formatRange(from?: string, to?: string): string {
  if (!from && !to) return '—';
  return from === to || !to ? formatDay(from) : `${formatDay(from)} – ${formatDay(to)}`;
}

/* ------------------------------------------------------------ Lọc và sắp xếp */

type RequestPeriod = 'all' | 'current' | 'week' | 'month' | 'past';
type RequestSource = 'all' | 'direct' | 'trip';

interface RequestFilter {
  status: 'all' | ProjectRequestStatus;
  type: string;
  person: string;
  source: RequestSource;
  period: RequestPeriod;
}

const NO_FILTER: RequestFilter = {
  status: 'all',
  type: 'all',
  person: 'all',
  source: 'all',
  period: 'all',
};

const PERIOD_OPTIONS: readonly { value: RequestPeriod; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'current', label: 'Đang diễn ra' },
  { value: 'week', label: 'Trong 7 ngày tới' },
  { value: 'month', label: 'Trong tháng này' },
  { value: 'past', label: 'Đã kết thúc' },
];

const SOURCE_OPTIONS: readonly { value: RequestSource; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'direct', label: 'Chọn dự án khi gửi' },
  { value: 'trip', label: 'Theo đơn công tác' },
];

type RequestSort = 'submitted' | 'code' | 'from' | 'status' | 'requester' | 'type';
type SortDirection = 'asc' | 'desc';

const SORT_OPTIONS: readonly { value: RequestSort; label: string }[] = [
  { value: 'submitted', label: 'Ngày gửi' },
  { value: 'code', label: 'Mã đơn' },
  { value: 'from', label: 'Ngày bắt đầu' },
  { value: 'status', label: 'Trạng thái' },
  { value: 'requester', label: 'Người gửi' },
  { value: 'type', label: 'Loại đơn' },
];

const DIRECTION_OPTIONS: readonly { value: SortDirection; label: string }[] = [
  { value: 'desc', label: 'Giảm dần' },
  { value: 'asc', label: 'Tăng dần' },
];

/** Đọc lại mẫu đã lưu; trường lạ hay thiếu thì về "Tất cả". */
function filterFrom(saved: SavedFilter): RequestFilter {
  const value = saved.filter as Partial<Record<keyof RequestFilter, unknown>>;
  const text = (key: keyof RequestFilter) =>
    typeof value[key] === 'string' && value[key] ? (value[key] as string) : 'all';
  return {
    status: text('status') as RequestFilter['status'],
    type: text('type'),
    person: text('person'),
    source: text('source') as RequestSource,
    period: text('period') as RequestPeriod,
  };
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.filterField}>
      <span className={styles.filterLabel}>{label}</span>
      {children}
    </div>
  );
}

/**
 * Tab "Đơn từ" của dự án.
 *
 * Liệt kê đơn module khác gửi kèm dự án (hiện là đơn công tác của HRM), mã
 * DTxxx do Workspace cấp. Chỉ đọc: duyệt hay huỷ đơn làm ở module gốc, trạng
 * thái ở đây tự cập nhật theo sự kiện.
 */
export function TabRequests({
  projectId,
  projectCode,
  currentUserId,
}: {
  readonly projectId: string;
  readonly projectCode: string;
  readonly currentUserId: string;
}) {
  const directory = useDirectory();
  const [items, setItems] = useState<readonly ProjectRequest[]>();
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<ProjectRequest>();
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [rules, setRules] = useState<WorkdayRuleSet>();
  const [filter, setFilter] = useState<RequestFilter>(NO_FILTER);
  const setField = (patch: Partial<RequestFilter>) =>
    setFilter((current) => ({ ...current, ...patch }));
  const [sort, setSort] = useState<RequestSort>('submitted');
  const [direction, setDirection] = useState<SortDirection>('desc');

  // Mẫu lọc: của tôi, cộng mẫu được chia sẻ trong dự án này — như tab Công việc.
  const [savedFilters, setSavedFilters] = useState<readonly SavedFilter[]>([]);
  const [savedId, setSavedId] = useState('');
  const [savingName, setSavingName] = useState<string>();
  const [savedError, setSavedError] = useState<string>();
  const selectedSaved = savedFilters.find((entry) => entry.id === savedId);

  useEffect(() => {
    let alive = true;
    setSavedId('');
    setFilter(NO_FILTER);
    void api
      .listSavedFilters('project_requests', projectId)
      .then((result) => {
        if (alive) setSavedFilters(result.items);
      })
      .catch(() => {
        if (alive) setSavedFilters([]);
      });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const applySaved = (id: string) => {
    setSavedId(id);
    setSavedError(undefined);
    const saved = savedFilters.find((entry) => entry.id === id);
    setFilter(saved ? filterFrom(saved) : NO_FILTER);
  };

  const saveCurrent = async () => {
    const name = savingName?.trim();
    if (!name) return;
    try {
      const saved = await api.saveFilter({
        viewKey: 'project_requests',
        name,
        filter: { ...filter },
        projectId,
      });
      setSavedFilters((current) =>
        [...current.filter((entry) => entry.id !== saved.id), saved].sort((a, b) =>
          a.name.localeCompare(b.name, 'vi'),
        ),
      );
      setSavedId(saved.id);
      setSavingName(undefined);
      setSavedError(undefined);
    } catch (cause) {
      setSavedError((cause as { message?: string })?.message ?? 'Không lưu được mẫu lọc.');
    }
  };

  const removeSaved = async () => {
    if (!savedId) return;
    try {
      await api.removeSavedFilter(savedId);
      setSavedFilters((current) => current.filter((entry) => entry.id !== savedId));
      setSavedId('');
    } catch (cause) {
      setSavedError((cause as { message?: string })?.message ?? 'Không xoá được mẫu lọc.');
    }
  };

  useEffect(() => {
    let cancelled = false;
    api
      .getWorkdayRules()
      .then((result) => {
        if (!cancelled) setRules(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setItems(undefined);
    setError(undefined);
    api
      .listProjectRequests(projectId)
      .then((result) => {
        if (!cancelled) setItems(result.items);
      })
      .catch((cause: { message?: string }) => {
        if (!cancelled) setError(cause?.message ?? 'Không tải được danh sách đơn từ.');
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!selected && !reportOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSelected(undefined);
      setReportOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, reportOpen]);

  const nameOf = (item: ProjectRequest) =>
    item.requesterName || directory.nameOf(item.requesterUserId);

  const filtering = Object.values(filter).some((value) => value !== 'all');

  const typeOptions = useMemo(
    () => [
      { value: 'all', label: 'Tất cả' },
      ...[...new Set((items ?? []).map((item) => item.requestTypeLabel))]
        .sort((a, b) => a.localeCompare(b, 'vi'))
        .map((label) => ({ value: label, label })),
    ],
    [items],
  );

  const personOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of items ?? []) seen.set(item.requesterUserId, nameOf(item));
    return [
      { value: 'all', label: 'Tất cả' },
      { value: 'me', label: 'Của tôi' },
      ...[...seen]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label, 'vi')),
    ];
  }, [items, directory]);

  /** Đơn khớp bộ lọc, đã sắp theo lựa chọn; hoà nhau thì theo mã đơn. */
  const visible = useMemo(() => {
    const today = new Date().toLocaleDateString('sv-SE');
    const weekEnd = new Date(Date.now() + 7 * 86_400_000).toLocaleDateString('sv-SE');
    const month = today.slice(0, 7);
    const monthEnd = `${month}-31`;
    const matched = (items ?? []).filter((item) => {
      const from = item.fromDate ?? '';
      const to = item.toDate ?? item.fromDate ?? '';
      if (filter.status !== 'all' && item.status !== filter.status) return false;
      if (filter.type !== 'all' && item.requestTypeLabel !== filter.type) return false;
      if (filter.person === 'me' && item.requesterUserId !== currentUserId) return false;
      if (!['all', 'me'].includes(filter.person) && item.requesterUserId !== filter.person)
        return false;
      if (filter.source === 'direct' && item.linkedViaKind) return false;
      if (filter.source === 'trip' && !item.linkedViaKind) return false;
      if (filter.period === 'current' && !(from && from <= today && to >= today)) return false;
      if (filter.period === 'week' && !(from && from <= weekEnd && to >= today)) return false;
      if (filter.period === 'month' && !(from && from <= monthEnd && to >= `${month}-01`))
        return false;
      if (filter.period === 'past' && !(to && to < today)) return false;
      return true;
    });
    const sign = direction === 'asc' ? 1 : -1;
    const byCode = (a: ProjectRequest, b: ProjectRequest) =>
      a.code.localeCompare(b.code, 'vi', { numeric: true });
    const primary: Record<RequestSort, (a: ProjectRequest, b: ProjectRequest) => number> = {
      submitted: (a, b) => a.submittedAt.localeCompare(b.submittedAt),
      code: byCode,
      from: (a, b) => (a.fromDate ?? '').localeCompare(b.fromDate ?? ''),
      status: (a, b) =>
        PROJECT_REQUEST_STATUSES.indexOf(a.status) - PROJECT_REQUEST_STATUSES.indexOf(b.status),
      requester: (a, b) => nameOf(a).localeCompare(nameOf(b), 'vi'),
      type: (a, b) => a.requestTypeLabel.localeCompare(b.requestTypeLabel, 'vi'),
    };
    return [...matched].sort((a, b) => sign * (primary[sort](a, b) || byCode(a, b)));
  }, [items, filter, sort, direction, currentUserId, directory]);

  return (
    <div className={styles.tabBody}>
      <div className={styles.requestToolbar}>
        <button type="button" className={styles.buttonGhost} onClick={() => setReportOpen(true)}>
          <FileBarChart size={14} aria-hidden /> Báo cáo công tác
        </button>
        <button type="button" className={styles.buttonGhost} onClick={() => setPriorityOpen(true)}>
          <ListOrdered size={14} aria-hidden /> Thứ tự ưu tiên
        </button>
      </div>
      <div className={styles.panel}>
        <div className={styles.workFilters}>
          <FilterField label="Trạng thái">
            <Choice
              label="Lọc theo trạng thái"
              value={filter.status}
              options={[
                { value: 'all', label: 'Tất cả' },
                ...PROJECT_REQUEST_STATUSES.map((value) => ({
                  value,
                  label: PROJECT_REQUEST_STATUS_LABELS[value],
                })),
              ]}
              onChange={(value) => setField({ status: value as RequestFilter['status'] })}
            />
          </FilterField>
          <FilterField label="Loại đơn">
            <Choice
              label="Lọc theo loại đơn"
              value={filter.type}
              options={typeOptions}
              onChange={(value) => setField({ type: value })}
            />
          </FilterField>
          <FilterField label="Người gửi">
            <Choice
              label="Lọc theo người gửi"
              value={filter.person}
              options={personOptions}
              onChange={(value) => setField({ person: value })}
            />
          </FilterField>
          <FilterField label="Nguồn">
            <Choice
              label="Lọc theo cách đơn vào dự án"
              value={filter.source}
              options={SOURCE_OPTIONS}
              onChange={(value) => setField({ source: value as RequestSource })}
            />
          </FilterField>
          <FilterField label="Thời gian">
            <Choice
              label="Lọc theo thời gian của đơn"
              value={filter.period}
              options={PERIOD_OPTIONS}
              onChange={(value) => setField({ period: value as RequestPeriod })}
            />
          </FilterField>
          <FilterField label="Sắp xếp">
            <Choice
              label="Sắp xếp đơn từ theo"
              value={sort}
              options={SORT_OPTIONS}
              onChange={(value) => setSort(value as RequestSort)}
            />
          </FilterField>
          <FilterField label="Chiều">
            <Choice
              label="Chiều sắp xếp"
              value={direction}
              options={DIRECTION_OPTIONS}
              onChange={(value) => setDirection(value as SortDirection)}
            />
          </FilterField>
          {savedFilters.length > 0 ? (
            <FilterField label="Mẫu lọc">
              <Choice
                label="Áp dụng mẫu lọc"
                value={savedId}
                emptyOption="Chọn mẫu…"
                options={savedFilters.map((entry) => ({
                  value: entry.id,
                  label: entry.isShared ? `${entry.name} (chung)` : entry.name,
                }))}
                onChange={applySaved}
              />
            </FilterField>
          ) : null}
          {savingName !== undefined ? (
            <form
              className={styles.savedFilterSave}
              onSubmit={(event) => {
                event.preventDefault();
                void saveCurrent();
              }}
            >
              <input
                autoFocus
                value={savingName}
                maxLength={120}
                placeholder="Tên mẫu lọc"
                aria-label="Tên mẫu lọc"
                onChange={(event) => setSavingName(event.target.value)}
              />
              <button type="submit" className={styles.linkButton} disabled={!savingName.trim()}>
                Lưu
              </button>
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => setSavingName(undefined)}
              >
                Huỷ
              </button>
            </form>
          ) : filtering ? (
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => setSavingName(selectedSaved?.name ?? '')}
            >
              Lưu mẫu lọc
            </button>
          ) : null}
          {selectedSaved && selectedSaved.ownerUserId === currentUserId ? (
            <button type="button" className={styles.linkButton} onClick={() => void removeSaved()}>
              Xoá mẫu
            </button>
          ) : null}
          {filtering ? (
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => {
                setFilter(NO_FILTER);
                setSavedId('');
              }}
            >
              Bỏ lọc
            </button>
          ) : null}
          {savedError ? <span className={styles.fieldHint}>{savedError}</span> : null}
        </div>
      </div>
      <div className={styles.tableCard}>
        <div className={styles.tableScroll}>
          <table className={`${styles.table} ${styles.wbsTable}`}>
            <thead>
              <tr>
                <th>Đơn từ</th>
                <th>Người gửi</th>
                <th>Thời gian</th>
                <th>Trạng thái</th>
                <th>Ngày gửi</th>
                <th>Quy trình</th>
              </tr>
            </thead>
            <tbody>
              {error ? (
                <tr>
                  <td colSpan={6} className={styles.muted}>
                    {error}
                  </td>
                </tr>
              ) : items === undefined ? (
                <tr>
                  <td colSpan={6} className={styles.muted}>
                    Đang tải…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className={styles.muted}>
                    Dự án chưa có đơn từ nào. Đơn gửi từ HRM có chọn dự án này sẽ hiện ở đây.
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={6} className={styles.muted}>
                    Không có đơn nào khớp bộ lọc.
                  </td>
                </tr>
              ) : null}
              {visible.map((item) => {
                const tone = PROJECT_REQUEST_STATUS_TONE[item.status];
                return (
                  <tr key={item.id} onClick={() => setSelected(item)}>
                    <td>
                      <span className={styles.wbsName}>
                        <span className={styles.wbsTitle} title={`${item.code} · ${item.requestTypeLabel}`}>
                          <span className={styles.treeCode}>{item.code}</span>
                          <span className={styles.treeTitle}>{item.requestTypeLabel}</span>
                        </span>
                        {item.linkedViaKind ? (
                          <span
                            className={styles.requestVia}
                            title="Đơn rơi vào thời gian công tác của dự án này nên tự hiện ở đây"
                          >
                            Theo đơn công tác {item.linkedViaCode ?? ''}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td>
                      <span className={styles.wbsPerson}>
                        <span className={styles.avatarSmall}>{initials(nameOf(item))}</span>
                        {nameOf(item)}
                      </span>
                    </td>
                    <td>{formatRange(item.fromDate, item.toDate)}</td>
                    <td>
                      <span className={styles.pill} style={{ background: tone.bg, color: tone.fg }}>
                        {PROJECT_REQUEST_STATUS_LABELS[item.status]}
                      </span>
                    </td>
                    <td>{formatDateTime(item.submittedAt)}</td>
                    <td>
                      {item.procedureInstanceCode || item.procedureInstanceId ? (
                        <a
                          className={styles.wbsProcedure}
                          href={PROCEDURE_LAUNCH_URL}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Workflow size={12} aria-hidden />
                          {item.procedureInstanceCode ?? 'Hồ sơ quy trình'}
                        </a>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selected ? (
        <aside className={styles.drawer} role="complementary" aria-label={`Đơn ${selected.code}`}>
          <header className={styles.drawerHead}>
            <div>
              <h3>
                {selected.code} · {selected.requestTypeLabel}
              </h3>
              <p>Đơn từ gửi từ module khác; duyệt hoặc huỷ đơn ở module gốc.</p>
            </div>
            <button type="button" aria-label="Đóng" onClick={() => setSelected(undefined)}>
              <X size={16} />
            </button>
          </header>
          <div className={styles.drawerBody}>
            <dl className={styles.detailGrid}>
              <dt>Mã đơn</dt>
              <dd>{selected.code}</dd>
              <dt>Loại đơn</dt>
              <dd>{selected.requestTypeLabel}</dd>
              {selected.linkedViaKind ? (
                <>
                  <dt>Gắn vào dự án</dt>
                  <dd>Theo đơn công tác {selected.linkedViaCode ?? ''}</dd>
                </>
              ) : null}
              <dt>Người gửi</dt>
              <dd>{nameOf(selected)}</dd>
              <dt>Thời gian</dt>
              <dd>{formatRange(selected.fromDate, selected.toDate)}</dd>
              <dt>Trạng thái</dt>
              <dd>
                <span
                  className={styles.pill}
                  style={{
                    background: PROJECT_REQUEST_STATUS_TONE[selected.status].bg,
                    color: PROJECT_REQUEST_STATUS_TONE[selected.status].fg,
                  }}
                >
                  {PROJECT_REQUEST_STATUS_LABELS[selected.status]}
                </span>
              </dd>
              <dt>Ngày gửi</dt>
              <dd>{formatDateTime(selected.submittedAt)}</dd>
              {selected.statusChangedAt ? (
                <>
                  <dt>Cập nhật trạng thái</dt>
                  <dd>{formatDateTime(selected.statusChangedAt)}</dd>
                </>
              ) : null}
              <dt>Hồ sơ quy trình</dt>
              <dd>{selected.procedureInstanceCode ?? 'Không chạy quy trình'}</dd>
            </dl>
            {selected.launchUrl ? (
              <a className={styles.wbsProcedure} href={selected.launchUrl}>
                <ExternalLink size={12} aria-hidden /> Mở đơn ở module gốc
              </a>
            ) : null}
          </div>
        </aside>
      ) : null}

      {priorityOpen ? (
        <PriorityDialog
          rules={rules}
          onClose={() => setPriorityOpen(false)}
          onSaved={(saved) => {
            setRules(saved);
            setPriorityOpen(false);
          }}
        />
      ) : null}

      {reportOpen ? (
        <WorkdayReportDrawer
          projectId={projectId}
          projectCode={projectCode}
          requests={items ?? []}
          rules={rules ?? DEFAULT_WORKDAY_RULES}
          onClose={() => setReportOpen(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * Thứ tự ưu tiên tính công. Quản trị kéo thả để đổi thứ tự và sửa số công mỗi
 * ngày; người khác chỉ xem. Ngày trùng nhiều đơn chỉ tính theo đơn ở trên cùng.
 */
function PriorityDialog({
  rules,
  onClose,
  onSaved,
}: {
  readonly rules?: WorkdayRuleSet;
  readonly onClose: () => void;
  readonly onSaved: (saved: WorkdayRuleSet) => void;
}) {
  const source = rules ?? { ...DEFAULT_WORKDAY_RULES, canEdit: false };
  const editable = Boolean(rules?.canEdit);
  const [order, setOrder] = useState<readonly WorkdayRule[]>(source.rules);
  const [units, setUnits] = useState<Record<string, string>>(() =>
    Object.fromEntries(source.rules.map((rule) => [rule.kind, String(rule.units)])),
  );
  const [normalUnits, setNormalUnits] = useState(String(source.normalUnits));
  const [dragging, setDragging] = useState<number>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const move = (from: number, to: number) => {
    if (from === to) return;
    setOrder((current) => {
      const next = [...current];
      const [picked] = next.splice(from, 1);
      next.splice(to, 0, picked as WorkdayRule);
      return next;
    });
  };

  const parse = (value: string) => Number(value.replace(',', '.'));

  const save = async () => {
    if (!editable) {
      onClose();
      return;
    }
    const values = [...order.map((rule) => parse(units[rule.kind] ?? '')), parse(normalUnits)];
    if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 10)) {
      setError('Số công mỗi ngày phải từ 0 đến 10.');
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const saved = await api.updateWorkdayRules({
        order: order.map((rule) => rule.kind),
        units: Object.fromEntries(
          order.map((rule) => [rule.kind, parse(units[rule.kind] ?? '')]),
        ) as Record<WorkdayRule['kind'], number>,
        normalUnits: parse(normalUnits),
      });
      onSaved(saved);
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không lưu được thứ tự ưu tiên.');
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      title="Thứ tự ưu tiên tính công"
      subtitle={
        editable
          ? 'Kéo thả để đổi thứ tự; đơn ở trên cùng thắng khi nhiều đơn trùng một ngày.'
          : 'Ngày có nhiều đơn trùng nhau chỉ tính theo đơn có ưu tiên cao nhất.'
      }
      submitLabel={editable ? 'Lưu thay đổi' : 'Đã hiểu'}
      cancelLabel={editable ? 'Huỷ' : null}
      submitting={saving}
      error={error}
      onClose={onClose}
      onSubmit={() => void save()}
    >
      <table className={styles.table}>
        <thead>
          <tr>
            <th aria-label="Kéo thả" />
            <th>Ưu tiên</th>
            <th>Loại ngày</th>
            <th>Công / ngày</th>
          </tr>
        </thead>
        <tbody>
          {order.map((rule, index) => (
            <tr
              key={rule.kind}
              draggable={editable}
              className={dragging === index ? styles.priorityDragging : undefined}
              onDragStart={(event) => {
                setDragging(index);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(event) => {
                if (dragging === undefined) return;
                event.preventDefault();
                if (dragging !== index) {
                  move(dragging, index);
                  setDragging(index);
                }
              }}
              onDragEnd={() => setDragging(undefined)}
            >
              <td className={styles.priorityHandle}>
                {editable ? <GripVertical size={14} aria-label="Kéo để đổi thứ tự" /> : null}
              </td>
              <td>{index + 1}</td>
              <td>{rule.label}</td>
              <td>
                {editable ? (
                  <input
                    className={styles.priorityUnits}
                    inputMode="decimal"
                    aria-label={`Công mỗi ngày cho ${rule.label}`}
                    value={units[rule.kind] ?? ''}
                    onChange={(event) =>
                      setUnits((current) => ({ ...current, [rule.kind]: event.target.value }))
                    }
                  />
                ) : (
                  formatUnits(rule.units)
                )}
              </td>
            </tr>
          ))}
          <tr>
            <td />
            <td>—</td>
            <td>Ngày thường (không có đơn)</td>
            <td>
              {editable ? (
                <input
                  className={styles.priorityUnits}
                  inputMode="decimal"
                  aria-label="Công mỗi ngày thường"
                  value={normalUnits}
                  onChange={(event) => setNormalUnits(event.target.value)}
                />
              ) : (
                formatUnits(source.normalUnits)
              )}
            </td>
          </tr>
        </tbody>
      </table>
      <p className={styles.muted}>
        Ví dụ: công tác ngày 1–3, nghỉ phép ngày 2 → ngày 1 và 3 tính theo công tác, ngày 2 tính theo
        nghỉ phép. Chỉ đơn đã duyệt mới được tính; đơn làm thêm giờ, đổi ca, giải trình công không đổi
        số công.{editable ? '' : ' Chỉ quản trị được sửa bảng này.'}
      </p>
    </Dialog>
  );
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Báo cáo công tác theo tháng: công từng thành viên sau khi áp thứ tự ưu tiên,
 * kèm nút xuất CSV (hàng là thành viên, cột là từng ngày trong tháng).
 */
function WorkdayReportDrawer({
  projectId,
  projectCode,
  requests,
  rules,
  onClose,
}: {
  readonly projectId: string;
  readonly projectCode: string;
  readonly requests: readonly ProjectRequest[];
  readonly rules: Pick<WorkdayRuleSet, 'rules' | 'normalUnits'>;
  readonly onClose: () => void;
}) {
  const directory = useDirectory();
  const [month, setMonth] = useState(currentMonth);
  const [memberIds, setMemberIds] = useState<readonly string[]>();

  useEffect(() => {
    let cancelled = false;
    api
      .listMembers(projectId)
      .then((result) => {
        if (!cancelled) setMemberIds(result.items.map((member) => member.userId));
      })
      .catch(() => {
        if (!cancelled) setMemberIds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const rows = useMemo(() => {
    // Người gửi đơn nhưng đã rời dự án vẫn có mặt trong báo cáo.
    const ids = [...new Set([...(memberIds ?? []), ...requests.map((r) => r.requesterUserId)])];
    const members = ids.map((userId) => ({
      userId,
      name:
        requests.find((r) => r.requesterUserId === userId && r.requesterName)?.requesterName ||
        directory.nameOf(userId),
    }));
    members.sort((left, right) => left.name.localeCompare(right.name, 'vi'));
    return computeMonthlyWorkdays(members, requests, month, rules);
  }, [memberIds, requests, month, directory, rules]);

  const exportCsv = () => {
    const blob = new Blob([workdaysCsv(rows, month)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bao-cao-cong-tac-${projectCode}-${month}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside className={styles.drawer} role="complementary" aria-label="Báo cáo công tác">
      <header className={styles.drawerHead}>
        <div>
          <h3>Báo cáo công tác</h3>
          <p>Công theo thứ tự ưu tiên, chỉ tính đơn đã duyệt.</p>
        </div>
        <button type="button" aria-label="Đóng" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <div className={styles.drawerBody}>
        <div className={styles.requestToolbar}>
          <label className={styles.filterField}>
            <span>Tháng</span>
            <input
              type="month"
              value={month}
              onChange={(event) => event.target.value && setMonth(event.target.value)}
            />
          </label>
          <button
            type="button"
            className={styles.buttonPrimary}
            disabled={memberIds === undefined || monthDays(month).length === 0}
            onClick={exportCsv}
          >
            <Download size={14} aria-hidden /> Xuất báo cáo (CSV)
          </button>
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Thành viên</th>
              <th>Ngày công tác</th>
              <th>Bị ghi đè</th>
              <th>Tổng công</th>
            </tr>
          </thead>
          <tbody>
            {memberIds === undefined ? (
              <tr>
                <td colSpan={4} className={styles.muted}>
                  Đang tải…
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.userId}>
                  <td>{row.name}</td>
                  <td>{row.tripDays}</td>
                  <td>{row.overriddenTripDays}</td>
                  <td>{formatUnits(row.total)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <p className={styles.muted}>
          "Bị ghi đè" là số ngày công tác trùng đơn có ưu tiên cao hơn (ví dụ nghỉ phép). File CSV
          có mỗi hàng là một thành viên, mỗi cột là một ngày trong tháng.
        </p>
      </div>
    </aside>
  );
}
