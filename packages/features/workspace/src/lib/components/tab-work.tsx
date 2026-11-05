'use client';

import {
  type ExternalReference,
  type SavedFilter,
  type WorkItem,
  type WorkItemDependency,
  type WorkItemPriority,
  type WorkItemStatus,
} from '@enterprise-platform/contracts-workspace';
import { ChevronDown, ChevronRight, CornerDownRight, Diamond, Plus, Workflow } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Provider } from 'react-redux';
import { buildWorkItemTree } from '../project-tree.model';
import * as api from '../workspace-api';
import {
  PRIORITY_LABELS,
  PRIORITY_TONE,
  WORK_ITEM_STATUS_LABELS,
  formatDateTime,
  formatShortDate,
  formatShortTimestamp,
  isOverdue,
  workItemStatusLabel,
  workItemStatusTone,
  priorityKeys,
  priorityLabel,
  workItemStatusKeys,
} from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { Pager } from './pager';
import { GanttChart } from './gantt-chart';
import { initials } from './project-header';
import { TabKanban } from './tab-kanban';
import { useDirectory } from './use-directory';
import type { PendingProcedure } from '../procedure-pending';
import { tagColor, useTags } from './use-tags';
import {
  WORK_COLUMNS,
  WORK_TABLE_PAGE_SIZE,
  WORK_TABLE_PAGE_SIZES,
  WORK_TITLE_MIN_WIDTH,
  useWorkColumns,
  useWorkTableField,
  workTableStore,
} from '../work-table-store';
import { ColumnPicker } from './column-picker';

const PAGE_SIZE_OPTIONS = WORK_TABLE_PAGE_SIZES.map((size) => ({ value: String(size), label: `${size} / trang` }));
const NO_COLLAPSED: readonly string[] = [];

/** Ba cách xem cùng một danh sách công việc. */
type WorkView = 'table' | 'kanban' | 'gantt';

const WORK_VIEWS: readonly { id: WorkView; label: string }[] = [
  { id: 'table', label: 'Bảng' },
  { id: 'kanban', label: 'Kanban' },
  { id: 'gantt', label: 'Gantt' },
];

type DueFilter = 'all' | 'overdue' | 'week' | 'month';

const DUE_OPTIONS: readonly { value: DueFilter; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'overdue', label: 'Quá hạn' },
  { value: 'week', label: 'Trong 7 ngày tới' },
  { value: 'month', label: 'Trong tháng này' },
];

type WorkSort = 'wbs' | 'code' | 'title' | 'end' | 'start' | 'priority' | 'status' | 'progress';
type SortDirection = 'asc' | 'desc';

const WORK_SORT_OPTIONS: readonly { value: WorkSort; label: string }[] = [
  { value: 'wbs', label: 'Thứ tự WBS' },
  { value: 'code', label: 'Mã công việc' },
  { value: 'title', label: 'Tên công việc' },
  { value: 'end', label: 'Thời hạn' },
  { value: 'start', label: 'Ngày bắt đầu' },
  { value: 'priority', label: 'Ưu tiên' },
  { value: 'status', label: 'Trạng thái' },
  { value: 'progress', label: 'Tiến độ' },
];

const SORT_DIRECTION_OPTIONS: readonly { value: SortDirection; label: string }[] = [
  { value: 'asc', label: 'Tăng dần' },
  { value: 'desc', label: 'Giảm dần' },
];

/**
 * So sánh hai việc cùng cấp theo tiêu chí đã chọn. Việc thiếu ngày luôn xếp
 * cuối, dù tăng hay giảm; hoà nhau thì về thứ tự WBS để bảng không nhảy.
 */
function workComparator(sort: WorkSort, direction: SortDirection) {
  const sign = direction === 'asc' ? 1 : -1;
  const wbs = (a: WorkItem, b: WorkItem) =>
    a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, 'vi', { numeric: true });
  const byDate = (pick: (item: WorkItem) => string | undefined) => (a: WorkItem, b: WorkItem) => {
    const left = pick(a)?.slice(0, 10);
    const right = pick(b)?.slice(0, 10);
    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    return sign * left.localeCompare(right);
  };
  const comparators: Record<WorkSort, (a: WorkItem, b: WorkItem) => number> = {
    wbs: (a: WorkItem, b: WorkItem) => sign * wbs(a, b),
    code: (a: WorkItem, b: WorkItem) => sign * a.code.localeCompare(b.code, 'vi', { numeric: true }),
    title: (a: WorkItem, b: WorkItem) => sign * a.title.localeCompare(b.title, 'vi'),
    end: byDate((item) => item.plannedEnd),
    start: byDate((item) => item.plannedStart),
    // Ưu tiên và trạng thái theo thứ tự đặt ở Cài đặt.
    priority: (a: WorkItem, b: WorkItem) =>
      sign * (priorityKeys().indexOf(a.priority) - priorityKeys().indexOf(b.priority)),
    status: (a: WorkItem, b: WorkItem) =>
      sign * (workItemStatusKeys().indexOf(a.status) - workItemStatusKeys().indexOf(b.status)),
    progress: (a: WorkItem, b: WorkItem) => sign * (a.progressPercent - b.progressPercent),
  };
  const primary = comparators[sort];
  return (a: WorkItem, b: WorkItem) => primary(a, b) || wbs(a, b);
}

/** Thụt mỗi cấp trong cột Công việc của bảng WBS. */
const INDENT_REM = 1.25;

/** Số avatar hiện trong cột Người thực hiện; còn lại gộp thành "+N". */
const MAX_AVATARS = 3;

/** Bộ lọc của bảng, cũng là nội dung một mẫu lọc đã lưu. */
interface WorkFilter {
  status: 'all' | WorkItemStatus;
  priority: 'all' | WorkItemPriority;
  person: string;
  tag: string;
  due: DueFilter;
}

const NO_FILTER: WorkFilter = {
  status: 'all',
  priority: 'all',
  person: 'all',
  tag: 'all',
  due: 'all',
};

/** Đọc lại mẫu đã lưu; trường lạ hay thiếu thì về "Tất cả". */
function filterFrom(saved: SavedFilter): WorkFilter {
  const value = saved.filter as Partial<Record<keyof WorkFilter, unknown>>;
  const text = (key: keyof WorkFilter) =>
    typeof value[key] === 'string' && value[key] ? (value[key] as string) : 'all';
  return {
    status: text('status') as WorkFilter['status'],
    priority: text('priority') as WorkFilter['priority'],
    person: text('person'),
    tag: text('tag'),
    due: text('due') as DueFilter,
  };
}

/** Người phụ trách đứng đầu, sau đó là người cùng thực hiện. */
const peopleOf = (item: WorkItem) =>
  [item.assigneeUserId, ...(item.participantUserIds ?? [])].filter(Boolean) as string[];

export interface TabWorkProps {
  readonly projectId: string;
  readonly items: readonly WorkItem[];
  readonly dependencies: readonly WorkItemDependency[];
  readonly externalRefs: readonly ExternalReference[];
  /** Việc chạy theo quy trình mà chưa mở được hồ sơ bên Quy trình. */
  readonly pendingProcedure: ReadonlyMap<string, PendingProcedure>;
  /** Tin chưa đọc theo công việc, đã cộng dồn nhánh con. */
  readonly unread?: Readonly<Record<string, number>>;
  readonly canWrite: boolean;
  readonly currentUserId: string;
  readonly onOpen: (item: WorkItem) => void;
  /** Thêm công việc cấp gốc (nút "Thêm công việc" và "Thêm nhóm công việc"). */
  readonly onAddRoot: () => void;
  /** Chuột phải trên một dòng: cùng menu lệnh với cây công việc trước đây. */
  readonly onMenu: (item: WorkItem, at: { x: number; y: number }) => void;
  readonly onChangeStatus: (item: WorkItem, next: WorkItemStatus) => Promise<void>;
}

/**
 * Tab Công việc của dự án: thanh công cụ (kiểu xem, bộ lọc, nút thêm) và bảng
 * WBS dạng cây — nhóm công việc bung ra các việc con, thụt theo cấp.
 *
 * Cây công việc trước đây nằm ở cột trái; giờ chính bảng này là cây, nên
 * vùng chính không phải chia cột. Bấm một dòng để mở chi tiết công việc.
 */
function TabWorkImpl({
  projectId,
  items,
  dependencies,
  externalRefs,
  pendingProcedure,
  unread = {},
  canWrite,
  currentUserId,
  onOpen,
  onAddRoot,
  onMenu,
  onChangeStatus,
}: TabWorkProps) {
  const directory = useDirectory();
  const tags = useTags();
  // Trạng thái xem nằm trong Redux theo dự án (xem work-table-store): quay lại tab vẫn đúng trang, bộ lọc, nhánh thu gọn.
  const [view, setView] = useWorkTableField<WorkView>(projectId, 'view', 'table');
  const [showChildren, setShowChildren] = useWorkTableField(projectId, 'showChildren', true);
  const [collapsedIds, setCollapsedIds] = useWorkTableField<readonly string[]>(projectId, 'collapsed', NO_COLLAPSED);
  const collapsed = useMemo<ReadonlySet<string>>(() => new Set(collapsedIds), [collapsedIds]);
  const [filter, setFilter] = useWorkTableField<WorkFilter>(projectId, 'filter', NO_FILTER);
  const { status, priority, person, tag, due } = filter;
  const [sort, setSort] = useWorkTableField<WorkSort>(projectId, 'sort', 'wbs');
  const [direction, setDirection] = useWorkTableField<SortDirection>(projectId, 'direction', 'asc');
  // Cột hiển thị do từng người chọn (áp cho mọi dự án, lưu theo người dùng).
  const columns = useWorkColumns(currentUserId);
  const showCol = (id: (typeof WORK_COLUMNS)[number]['id']) => !columns.hidden.has(id);
  const colWidth = (id: (typeof WORK_COLUMNS)[number]['id']) => ({ width: WORK_COLUMNS.find((column) => column.id === id)?.width });
  // Đã tuỳ chỉnh: bảng rộng đủ chỗ cho đúng các cột đã chọn và cuộn ngang nếu khung hẹp hơn.
  const customMinWidth =
    WORK_TITLE_MIN_WIDTH +
    WORK_COLUMNS.filter((column) => !columns.hidden.has(column.id)).reduce((sum, column) => sum + column.width, 0);
  const visibleColumnCount = 1 + WORK_COLUMNS.filter((column) => !columns.hidden.has(column.id)).length;
  const [page, setPage] = useWorkTableField(projectId, 'page', 1);
  const [pageSize, setPageSize] = useWorkTableField<number>(projectId, 'pageSize', WORK_TABLE_PAGE_SIZE);
  const compare = useMemo(() => workComparator(sort, direction), [sort, direction]);
  const setField = (patch: Partial<WorkFilter>) =>
    setFilter((current) => ({ ...current, ...patch }));

  // Mẫu lọc: của tôi, cộng mẫu được chia sẻ trong dự án này.
  const [savedFilters, setSavedFilters] = useState<readonly SavedFilter[]>([]);
  const [savedId, setSavedId] = useState('');
  const [savingName, setSavingName] = useState<string>();
  const [savedError, setSavedError] = useState<string>();
  const selectedSaved = savedFilters.find((entry) => entry.id === savedId);

  useEffect(() => {
    let alive = true;
    setSavedId('');
    void api
      .listSavedFilters('work_items', projectId)
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
        viewKey: 'work_items',
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

  const filtering =
    status !== 'all' || priority !== 'all' || person !== 'all' || tag !== 'all' || due !== 'all';

  /** Việc khớp bộ lọc; bảng giữ thêm tổ tiên của chúng để còn thấy chúng thuộc nhánh nào. */
  const matched = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const weekEnd = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const month = today.slice(0, 7);
    return items.filter((item) => {
      if (status !== 'all' && item.status !== status) return false;
      if (priority !== 'all' && item.priority !== priority) return false;
      const people = peopleOf(item);
      if (person === 'me' && !people.includes(currentUserId)) return false;
      if (person === 'none' && people.length > 0) return false;
      if (!['all', 'me', 'none'].includes(person) && !people.includes(person)) return false;
      if (tag !== 'all' && !(item.tagIds ?? []).includes(tag)) return false;
      const end = item.plannedEnd?.slice(0, 10);
      if (due === 'overdue' && !isOverdue(item)) return false;
      if (due === 'week' && !(end && end >= today && end <= weekEnd)) return false;
      if (due === 'month' && !(end && end.startsWith(month))) return false;
      return true;
    });
  }, [items, status, priority, person, tag, due, currentUserId]);

  const rows = useMemo(() => {
    // Tắt "Hiện việc con" thì chỉ còn các nhóm cấp gốc.
    const hidden = showChildren ? collapsed : new Set(items.map((item) => item.id));
    return buildWorkItemTree(items, new Set(matched.map((item) => item.id)), hidden, compare);
  }, [items, matched, collapsed, showChildren, compare]);

  // Đổi bộ lọc, sắp xếp hay kiểu hiện việc con thì về trang 1 (lần dựng đầu giữ trang đã nhớ).
  const resetKey = `${status}|${priority}|${person}|${tag}|${due}|${sort}|${direction}|${showChildren}`;
  const lastResetKey = useRef(resetKey);
  useEffect(() => {
    if (lastResetKey.current === resetKey) return;
    lastResetKey.current = resetKey;
    setPage(1);
  }, [resetKey, setPage]);

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  // Thu gọn nhánh hay xoá việc làm số trang ít đi: lùi về trang cuối.
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages, setPage]);
  const currentPage = Math.min(page, pages);
  const pageRows = useMemo(
    () => rows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [rows, currentPage, pageSize],
  );

  const ganttRows = useMemo(
    () =>
      buildWorkItemTree(items, new Set(matched.map((item) => item.id)), undefined, compare).map(
        (row) => ({
          item: row.item,
          depth: row.depth,
        }),
      ),
    [items, matched, compare],
  );

  const personOptions = useMemo(() => {
    const ids = [...new Set(items.flatMap(peopleOf))];
    return [
      { value: 'all', label: 'Tất cả' },
      { value: 'me', label: 'Của tôi' },
      { value: 'none', label: 'Chưa giao' },
      ...ids
        .map((id) => ({ value: id, label: directory.nameOf(id) }))
        .sort((a, b) => a.label.localeCompare(b.label, 'vi')),
    ];
  }, [items, directory]);

  /** Chỉ những nhãn đang gắn trên việc của dự án này, để ô lọc không dài vô ích. */
  const tagOptions = useMemo(() => {
    const used = new Set(items.flatMap((item) => item.tagIds ?? []));
    return [
      { value: 'all', label: 'Tất cả' },
      ...tags.tags
        .filter((entry) => used.has(entry.id))
        .map((entry) => ({ value: entry.id, label: entry.name }))
        .sort((a, b) => a.label.localeCompare(b.label, 'vi')),
    ];
  }, [items, tags.tags]);

  /** Hồ sơ quy trình đã mở của từng công việc. */
  const procedureOf = useMemo(() => {
    const map = new Map<string, ExternalReference>();
    for (const ref of externalRefs) {
      if (ref.moduleKey === 'procedure-engine' && ref.entityType === 'work_item') {
        map.set(ref.entityId, ref);
      }
    }
    return map;
  }, [externalRefs]);

  const toggle = (id: string) =>
    setCollapsedIds((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));

  const openMenu = (event: MouseEvent, item: WorkItem) => {
    event.preventDefault();
    onMenu(item, { x: event.clientX, y: event.clientY });
  };

  return (
    <div className={styles.tabBody}>
      <div className={styles.panel}>
        <div className={styles.workToolbar}>
          <div className={styles.segmented} role="group" aria-label="Kiểu xem công việc">
            {WORK_VIEWS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={view === entry.id}
                className={view === entry.id ? styles.segmentActive : styles.segment}
                onClick={() => setView(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          {view === 'table' ? (
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={showChildren}
                onChange={(event) => setShowChildren(event.target.checked)}
              />
              Hiện việc con
            </label>
          ) : null}
          {view === 'table' ? (
            <ColumnPicker
              hidden={columns.hidden}
              customized={columns.customized}
              onChange={columns.setHidden}
              onReset={columns.reset}
            />
          ) : null}
          {/* Không có quyền ghi (người xem, dự án đã lưu trữ) thì ẩn hẳn nút, không để nút mờ. */}
          {canWrite ? (
            <button
              type="button"
              className={`${styles.buttonPrimary} ${styles.workToolbarAdd}`}
              onClick={onAddRoot}
            >
              <Plus size={15} /> Thêm công việc
            </button>
          ) : null}
        </div>

        <div className={styles.workFilters}>
          <FilterField label="Trạng thái">
            <Choice
              label="Lọc theo trạng thái"
              value={status}
              options={[
                { value: 'all', label: 'Tất cả' },
                ...workItemStatusKeys().map((value) => ({
                  value,
                  label: WORK_ITEM_STATUS_LABELS[value],
                })),
              ]}
              onChange={(value) => setField({ status: value as WorkFilter['status'] })}
            />
          </FilterField>
          <FilterField label="Ưu tiên">
            <Choice
              label="Lọc theo ưu tiên"
              value={priority}
              options={[
                { value: 'all', label: 'Tất cả' },
                ...priorityKeys().map((value) => ({ value, label: priorityLabel(value) })),
              ]}
              onChange={(value) => setField({ priority: value as WorkFilter['priority'] })}
            />
          </FilterField>
          <FilterField label="Người thực hiện">
            <Choice
              label="Lọc theo người phụ trách hoặc cùng thực hiện"
              value={person}
              options={personOptions}
              onChange={(value) => setField({ person: value })}
            />
          </FilterField>
          {tagOptions.length > 1 ? (
            <FilterField label="Nhãn">
              <Choice
                label="Lọc theo nhãn"
                value={tag}
                options={tagOptions}
                onChange={(value) => setField({ tag: value })}
              />
            </FilterField>
          ) : null}
          <FilterField label="Thời hạn">
            <Choice
              label="Lọc theo thời hạn"
              value={due}
              options={DUE_OPTIONS}
              onChange={(value) => setField({ due: value as DueFilter })}
            />
          </FilterField>
          <FilterField label="Sắp xếp">
            <Choice
              label="Sắp xếp công việc theo"
              value={sort}
              options={WORK_SORT_OPTIONS}
              onChange={(value) => setSort(value as WorkSort)}
            />
          </FilterField>
          <FilterField label="Chiều">
            <Choice
              label="Chiều sắp xếp"
              value={direction}
              options={SORT_DIRECTION_OPTIONS}
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

      {view === 'kanban' ? (
        <TabKanban
          items={matched}
          canWrite={canWrite}
          onOpen={onOpen}
          onChangeStatus={onChangeStatus}
        />
      ) : null}

      {view === 'gantt' ? (
        <GanttChart rows={ganttRows} dependencies={dependencies} onOpen={onOpen} />
      ) : null}

      {view === 'table' ? (
        <div className={styles.tableCard}>
          <div className={styles.tableScroll}>
            <table
              className={[styles.table, styles.wbsTable, columns.customized ? styles.wbsTableCustom : ''].filter(Boolean).join(' ')}
              style={columns.customized ? { minWidth: customMinWidth } : undefined}
            >
              <thead>
                <tr>
                  <th>Công việc</th>
                  {showCol('people') ? (
                    <th className={styles.wbsColPeople} style={colWidth('people')}>
                      Người thực hiện
                    </th>
                  ) : null}
                  {showCol('priority') ? (
                    <th className={styles.wbsColPriority} style={colWidth('priority')}>
                      Ưu tiên
                    </th>
                  ) : null}
                  {showCol('status') ? (
                    <th className={styles.wbsColStatus} style={colWidth('status')}>
                      Trạng thái
                    </th>
                  ) : null}
                  {showCol('start') ? (
                    <th className={styles.wbsColStart} style={colWidth('start')}>
                      Bắt đầu
                    </th>
                  ) : null}
                  {showCol('due') ? (
                    <th className={styles.wbsColDate} style={colWidth('due')}>
                      Thời hạn
                    </th>
                  ) : null}
                  {showCol('last') ? (
                    <th className={styles.wbsColLast} style={colWidth('last')} title="Ngày cập nhật trạng thái gần nhất">
                      Trạng thái cuối
                    </th>
                  ) : null}
                  {showCol('progress') ? (
                    <th className={styles.wbsColProgress} style={colWidth('progress')}>
                      Tiến độ
                    </th>
                  ) : null}
                  {showCol('process') ? (
                    <th className={styles.wbsColProcess} style={colWidth('process')}>
                      Quy trình
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={visibleColumnCount} className={styles.muted}>
                      {filtering
                        ? 'Không có công việc nào khớp bộ lọc.'
                        : 'Dự án chưa có công việc nào.'}
                    </td>
                  </tr>
                ) : null}
                {pageRows.map((row, rowIndex) => {
                  const { item } = row;
                  const tone = workItemStatusTone(item);
                  const procedure = procedureOf.get(item.id);
                  const overdue = isOverdue(item);
                  return (
                    <tr
                      key={item.id}
                      className={[
                        row.hasChildren ? styles.wbsGroupRow : '',
                        // Việc gốc mới (trừ dòng đầu bảng): vạch đậm ngăn với nhóm việc gốc phía trên.
                        row.depth === 0 && rowIndex > 0 ? styles.wbsRootStart : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => onOpen(item)}
                      onContextMenu={(event) => openMenu(event, item)}
                    >
                      <td>
                        <span
                          className={styles.wbsName}
                          style={{ paddingLeft: `${row.depth * INDENT_REM}rem` }}
                        >
                          {row.hasChildren ? (
                            <button
                              type="button"
                              className={styles.treeToggle}
                              aria-label={row.expanded ? 'Thu gọn nhánh' : 'Mở nhánh'}
                              aria-expanded={row.expanded}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (showChildren) toggle(item.id);
                                else {
                                  // Đang tắt "Hiện việc con": bật lại và mở đúng nhánh này. Nhánh có thể còn nằm trong
                                  // danh sách thu gọn từ trước, nên phải gỡ nó, không thì ô được tích mà nhánh vẫn đóng.
                                  setShowChildren(true);
                                  setCollapsedIds((current) => current.filter((entry) => entry !== item.id));
                                }
                              }}
                            >
                              {row.expanded ? (
                                <ChevronDown size={14} />
                              ) : (
                                <ChevronRight size={14} />
                              )}
                            </button>
                          ) : item.itemType === 'milestone' ? (
                            <Diamond size={14} className={styles.wbsMilestone} aria-hidden />
                          ) : row.depth > 0 ? (
                            <CornerDownRight size={14} className={styles.wbsBranch} aria-hidden />
                          ) : (
                            <span className={styles.treeToggleSpacer} aria-hidden />
                          )}
                          <button
                            type="button"
                            className={styles.wbsTitle}
                            title={`${item.code} · ${item.title}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpen(item);
                            }}
                          >
                            <span className={styles.treeCode}>{item.code}</span>
                            <span className={styles.treeTitle}>{item.title}</span>
                          </button>
                          {item.tagIds?.length ? (
                            <span className={styles.wbsTags}>
                              {item.tagIds.map((tagId) => {
                                const entry = tags.find(tagId);
                                return entry ? (
                                  <span
                                    key={tagId}
                                    className={styles.wbsTag}
                                    style={{ color: tagColor(entry) }}
                                  >
                                    {entry.name}
                                  </span>
                                ) : null;
                              })}
                            </span>
                          ) : null}
                          {unread[item.id] ? (
                            <span
                              className={styles.treeUnread}
                              title={`${unread[item.id]} tin chưa đọc`}
                            >
                              {unread[item.id]}
                            </span>
                          ) : null}
                        </span>
                      </td>
                      {showCol('people') ? (
<td className={styles.wbsColPeople}>
                        <People userIds={peopleOf(item)} nameOf={directory.nameOf} />
                      </td>
) : null}
                      {showCol('priority') ? (
<td className={styles.wbsColPriority}>
                        {row.hasChildren ? null : (
                          <span
                            className={styles.pill}
                            style={{
                              background: PRIORITY_TONE[item.priority].bg,
                              color: PRIORITY_TONE[item.priority].fg,
                            }}
                          >
                            {PRIORITY_LABELS[item.priority]}
                          </span>
                        )}
                      </td>
) : null}
                      {showCol('status') ? (
<td className={styles.wbsColStatus}>
                        <span
                          className={styles.pill}
                          style={{ background: tone.bg, color: tone.fg }}
                        >
                          {workItemStatusLabel(item)}
                        </span>
                      </td>
) : null}
                      {showCol('start') ? (
<td className={styles.wbsColStart}>{formatShortDate(item.plannedStart)}</td>
) : null}
                      {showCol('due') ? (
<td className={[styles.wbsColDate, overdue ? styles.cellDanger : ''].filter(Boolean).join(' ')}>
                        {formatShortDate(item.plannedEnd)}
                      </td>
) : null}
                      {showCol('last') ? (
<td
                        className={`${styles.muted} ${styles.wbsColLast}`}
                        title={
                          item.statusChangedAt
                            ? `Cập nhật trạng thái lúc ${formatDateTime(item.statusChangedAt)}`
                            : undefined
                        }
                      >
                        {formatShortTimestamp(item.statusChangedAt)}
                      </td>
) : null}
                      {showCol('progress') ? (
<td className={styles.wbsColProgress}>
                        {item.reversal ? (
                          // Việc huỷ hiệu lực không tính tiến độ; 100% cũ sẽ gây hiểu nhầm.
                          <span className={styles.muted} title="Đã huỷ hiệu lực, không tính tiến độ">
                            —
                          </span>
                        ) : (
                          <span className={styles.progressCell}>
                            <span
                              className={styles.progressTrack}
                              aria-label={`${item.progressPercent}%`}
                            >
                              <span
                                className={
                                  item.progressPercent >= 100
                                    ? styles.progressFillDone
                                    : styles.progressFill
                                }
                                style={{ width: `${item.progressPercent}%` }}
                              />
                            </span>
                            {item.progressPercent}%
                          </span>
                        )}
                      </td>
) : null}
                      {showCol('process') ? (
<td className={styles.wbsColProcess}>
                        {procedure ? (
                          <a
                            className={styles.wbsProcedure}
                            href={procedure.launchUrl}
                            title={procedure.cachedStatus ?? undefined}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Workflow size={12} aria-hidden />
                            {procedure.cachedLabel ?? procedure.externalCode ?? 'Quy trình'}
                          </a>
                        ) : pendingProcedure.get(item.id) ? (
                          <span
                            className={styles.treePending}
                            title={pendingProcedure.get(item.id)?.hint}
                          >
                            {pendingProcedure.get(item.id)?.label}
                          </span>
                        ) : null}
                      </td>
) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > 0 ? (
            <div className={styles.wbsFoot}>
              <Choice
                label="Số việc mỗi trang"
                value={String(pageSize)}
                options={PAGE_SIZE_OPTIONS}
                onChange={(value) => {
                  setPageSize(Number(value));
                  setPage(1);
                }}
                selectOnly
                height={32}
              />
              <Pager page={currentPage} pages={pages} total={rows.length} pageSize={pageSize} onPage={setPage} />
            </div>
          ) : null}
          {canWrite ? (
            <button type="button" className={styles.wbsAddGroup} onClick={onAddRoot}>
              <Plus size={14} /> Thêm nhóm công việc
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
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
 * Người phụ trách đứng đầu kèm tên; người cùng thực hiện chồng avatar phía
 * sau, rê chuột để xem đủ tên.
 */
function People({
  userIds,
  nameOf,
}: {
  userIds: readonly string[];
  nameOf: (userId: string) => string;
}) {
  const [first, ...others] = userIds;
  if (!first) return null;
  const shown = others.slice(0, MAX_AVATARS - 1);
  const more = others.length - shown.length;
  return (
    <span className={styles.wbsPeople} title={userIds.map(nameOf).join(', ')}>
      <span>
        <span className={styles.avatarSmall}>{initials(nameOf(first))}</span>
        {shown.map((userId) => (
          <span key={userId} className={styles.avatarSmall}>
            {initials(nameOf(userId))}
          </span>
        ))}
        {more > 0 ? (
          <span className={`${styles.avatarSmall} ${styles.avatarMore}`}>+{more}</span>
        ) : null}
      </span>
      {nameOf(first)}
    </span>
  );
}

/**
 * Bảng 600+ dòng rất tốn khi vẽ lại. Bọc `memo` để bật/tắt ngăn Trao đổi (hay bất kỳ
 * state nào khác của `ProjectsView` không liên quan tới bảng) không vẽ lại cả bảng;
 * nơi gọi phải truyền hàm ổn định (`useCallback`), nếu không `memo` không có tác dụng.
 */
export const TabWork = memo(function TabWork(props: TabWorkProps) {
  return (
    <Provider store={workTableStore}>
      <TabWorkImpl {...props} />
    </Provider>
  );
});
