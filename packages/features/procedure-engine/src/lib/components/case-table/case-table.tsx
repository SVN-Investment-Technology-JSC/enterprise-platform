'use client';

import {
  PROCEDURE_BULK_ACTION_MAX,
  evaluateInstanceSla,
  type ProcedureBulkAction,
  type ProcedureBulkActionResponse,
  type ProcedureBulkActionSkipped,
  type ProcedureDefinition,
  type ProcedureInstance,
} from '@enterprise-platform/contracts-procedure-engine';
import { Popconfirm, SearchableSelect } from '@enterprise-platform/shared-ui';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Columns3,
  Play,
  RotateCcw,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { bulkProcedureAction } from '../../procedure-api';
import {
  BULK_DISABLED_TOOLTIP,
  OVERVIEW_CHECK_COLUMN_WIDTH,
  bulkAllowedByDefinition,
  defaultOverviewColumnLayout,
  formatOverviewDateTime,
  inlineActionPlan,
  isBulkEligible,
  isDefaultOverviewColumnLayout,
  loadOverviewColumnLayout,
  loadOverviewSort,
  moveOverviewColumn,
  nextOverviewSort,
  overviewColumn,
  overviewColumnWidth,
  overviewWaitingTitle,
  resizeOverviewColumn,
  saveOverviewColumnLayout,
  saveOverviewSort,
  shiftOverviewColumn,
  sortOverviewGroups,
  splitInlineActions,
  toggleOverviewColumn,
  visibleOverviewColumns,
  type CaseColumnSet,
  type InlineAction,
  type InlineActionKind,
  type OverviewColumnKey,
  type OverviewColumnLayout,
  type OverviewGroup,
  type OverviewPage,
  type OverviewRow,
  type OverviewSort,
  type OverviewSortKey,
} from '../../procedure-overview';
import { SlaBadge } from '../sla-badge';
import { STATUS_LABEL } from '../workspace-board-options';
import boardStyles from '../workspace-board.module.scss';
import styles from './case-table.module.scss';

/**
 * Bảng hồ sơ của "Hồ sơ xử lý" (giao diện A): dòng gom theo dự án, tiêu đề cột sắp xếp / kéo đổi chỗ / kéo độ
 * rộng, ẩn hiện cột ("Cột"), chọn dòng để duyệt / không duyệt hàng loạt, cột Hành động kiểu 1office. Trạng thái của bảng
 * nằm trong `useCaseTable`; mỗi trang tự lọc dòng, tự giữ trang đang xem và truyền cách chạy thao tác vào.
 */

/** Đường mở thẳng một hồ sơ ở trang Hồ sơ xử lý của module. */
export function caseHref(instanceId: string): string {
  return `#workspace/${encodeURIComponent(instanceId)}`;
}

const AVATAR_TONES = ['#2f6fed', '#16845e', '#b45309', '#7c3aed', '#be123c', '#0f766e'];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const last = parts[parts.length - 1] ?? '';
  return (parts.length > 1 ? `${parts[0]?.[0] ?? ''}${last[0] ?? ''}` : last.slice(0, 2)).toUpperCase();
}

function Avatar({ name }: { name?: string }) {
  if (!name) return <span className={styles.muted}>--</span>;
  const tone = AVATAR_TONES[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % AVATAR_TONES.length];
  return (
    <span className={styles.person} title={name}>
      <span className={styles.avatar} style={{ background: tone }} aria-hidden>
        {initials(name)}
      </span>
      <span className={styles.personName}>{name}</span>
    </span>
  );
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Thao tác không thành công.';
}

const BULK_DONE_TEXT: Record<ProcedureBulkAction, string> = {
  approve: 'Đã duyệt',
  reject: 'Đã không duyệt (huỷ)',
};

/** Kết quả lần bấm hàng loạt gần nhất, hiện dưới thanh chọn tới khi người dùng đóng. */
interface BulkOutcome {
  readonly action: ProcedureBulkAction;
  readonly done: number;
  readonly skipped: readonly ProcedureBulkActionSkipped[];
}

/** Gửi theo từng lô tối đa 50 hồ sơ (giới hạn của server), gộp kết quả. */
async function runBulkInChunks(
  action: ProcedureBulkAction,
  ids: readonly string[],
  comment?: string,
): Promise<ProcedureBulkActionResponse> {
  const done: ProcedureBulkActionResponse['done'][number][] = [];
  const skipped: ProcedureBulkActionSkipped[] = [];
  for (let start = 0; start < ids.length; start += PROCEDURE_BULK_ACTION_MAX) {
    const result = await bulkProcedureAction(action, ids.slice(start, start + PROCEDURE_BULK_ACTION_MAX), comment);
    done.push(...result.done);
    skipped.push(...result.skipped);
  }
  return { done, skipped };
}

function cx(...classes: (string | false | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

type LayoutUpdate = (update: (current: OverviewColumnLayout) => OverviewColumnLayout) => void;

export interface CaseTableOptions {
  /** Nhóm dự án theo thứ tự mặc định của trang (chưa áp sắp xếp theo cột). */
  readonly groups: readonly OverviewGroup[];
  readonly definitions: readonly ProcedureDefinition[];
  /** Bộ cột và khoá lưu bố cục / sắp xếp riêng của trang. */
  readonly columnSet: CaseColumnSet;
  /** Chạy một thao tác trên dòng (Duyệt, Hoàn tất, Trả lại, Không duyệt, Hoàn duyệt); lỗi ném ra thì bảng báo `onError`. */
  readonly runAction: (instance: ProcedureInstance, kind: InlineActionKind, comment?: string) => Promise<void>;
  /** Sau một lần duyệt / không duyệt hàng loạt (thành công hay không): nạp lại danh sách. */
  readonly afterBulk: (ids: readonly string[]) => void | Promise<void>;
  readonly onNotice?: (message: string) => void;
  readonly onError?: (message: string) => void;
}

/** Trạng thái của bảng: sắp xếp và bố cục cột (lưu theo trình duyệt), nhóm gập, dòng chọn, thao tác đang chạy. */
export function useCaseTable({ groups, definitions, columnSet, runAction, afterBulk, onNotice, onError }: CaseTableOptions) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<string>();
  const [bulkOutcome, setBulkOutcome] = useState<BulkOutcome>();
  // Sắp xếp và bố cục cột lưu theo trình duyệt (localStorage, bỏ qua khi bị chặn), khoá riêng cho từng trang.
  const [sort, setSort] = useState<OverviewSort | undefined>(() => loadOverviewSort(undefined, columnSet.sortStorageKey));
  const [layout, setLayout] = useState<OverviewColumnLayout>(() => loadOverviewColumnLayout(undefined, columnSet));
  useEffect(() => saveOverviewSort(sort, undefined, columnSet.sortStorageKey), [sort, columnSet]);
  useEffect(() => saveOverviewColumnLayout(layout, undefined, columnSet), [layout, columnSet]);
  const toggleSort = (key: OverviewSortKey) => setSort((current) => nextOverviewSort(current, key));
  const columns = visibleOverviewColumns(layout);
  // Cột "Tên công việc" lấy phần còn lại của bảng; bảng chỉ rộng hơn khung (cuộn ngang) khi người dùng nới cột.
  const tableMinWidth =
    OVERVIEW_CHECK_COLUMN_WIDTH + columns.reduce((sum, key) => sum + overviewColumnWidth(layout, key), 0);

  const sortedGroups = useMemo(() => sortOverviewGroups(groups, sort), [groups, sort]);

  // Bỏ chọn những hồ sơ không còn trong bảng (đổi tab, lọc, hay đã xử lý xong).
  useEffect(() => {
    const visible = new Set(sortedGroups.flatMap((group) => group.rows.map((row) => row.instance.id)));
    setSelected((current) => {
      const kept = [...current].filter((id) => visible.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [sortedGroups]);

  const definitionsById = useMemo(
    () => new Map(definitions.map((definition) => [definition.id, definition] as const)),
    [definitions],
  );
  /** Dòng chọn được: quy trình của hồ sơ có bật duyệt hoặc không duyệt hàng loạt. */
  const selectable = (instance: ProcedureInstance) => bulkAllowedByDefinition(instance, definitionsById);

  const run = async (instance: ProcedureInstance, kind: InlineActionKind, comment?: string) => {
    setPending(`${kind}:${instance.id}`);
    try {
      await runAction(instance, kind, comment);
    } catch (cause) {
      onError?.(errorText(cause));
    } finally {
      setPending(undefined);
    }
  };

  // Quy trình vừa bị tắt thao tác hàng loạt sau khi chọn thì dòng đó thôi tính là đang chọn.
  const selectedRows = sortedGroups
    .flatMap((group) => group.rows)
    .filter((row) => selected.has(row.instance.id) && selectable(row.instance));
  // Nút chỉ đếm hồ sơ sẽ thật sự được xử lý (cùng luật với server); hồ sơ chọn mà không đủ điều kiện vẫn được gửi để
  // server trả lý do bỏ qua trong phần kết quả.
  const approveCount = selectedRows.filter((row) => isBulkEligible(row.instance, definitionsById, 'approve')).length;
  const rejectCount = selectedRows.filter((row) => isBulkEligible(row.instance, definitionsById, 'reject')).length;
  const runBulk = async (action: ProcedureBulkAction, comment?: string) => {
    const ids = selectedRows.map((row) => row.instance.id);
    setPending(`bulk:${action}`);
    try {
      const result = await runBulkInChunks(action, ids, comment);
      setSelected(new Set());
      setBulkOutcome({ action, done: result.done.length, skipped: result.skipped });
      if (result.done.length) onNotice?.(`${BULK_DONE_TEXT[action]} ${result.done.length} hồ sơ.`);
    } catch (cause) {
      onError?.(errorText(cause));
    } finally {
      setPending(undefined);
    }
    await afterBulk(ids);
  };

  const toggleRow = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  /** Chọn / bỏ chọn mọi dòng chọn được của trang đang xem. */
  const togglePage = (rows: readonly OverviewRow[]) =>
    setSelected((current) => {
      const pageSelectable = rows.filter((row) => selectable(row.instance));
      const allOn = pageSelectable.length > 0 && pageSelectable.every((row) => current.has(row.instance.id));
      const next = new Set(current);
      for (const row of pageSelectable) {
        if (allOn) next.delete(row.instance.id);
        else next.add(row.instance.id);
      }
      return next;
    });
  const toggleGroup = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return {
    columnSet,
    sort,
    toggleSort,
    layout,
    setLayout: setLayout as LayoutUpdate,
    columns,
    tableMinWidth,
    sortedGroups,
    collapsed,
    toggleGroup,
    selected,
    selectable,
    toggleRow,
    togglePage,
    clearSelection: () => setSelected(new Set()),
    selectedRows,
    approveCount,
    rejectCount,
    pending,
    run,
    runBulk,
    bulkOutcome,
    clearBulkOutcome: () => setBulkOutcome(undefined),
  };
}

export type CaseTableState = ReturnType<typeof useCaseTable>;

/** Mở hồ sơ ngay tại trang (Hồ sơ xử lý); `trigger` là phần tử nhận lại focus khi đóng. */
export type CaseOpenHandler = (instance: ProcedureInstance, trigger?: HTMLElement) => void;

/** Thanh "Đã chọn N hồ sơ" với nút duyệt / không duyệt hàng loạt, và kết quả lần chạy gần nhất. */
export function CaseBulkBar({
  table,
  titleOf,
}: {
  table: CaseTableState;
  /** Tên hồ sơ để hiện thay mã trong danh sách bị bỏ qua. */
  titleOf: (instanceId: string) => string | undefined;
}) {
  const { selectedRows, approveCount, rejectCount, pending, runBulk, bulkOutcome } = table;
  return (
    <>
      {selectedRows.length ? (
        <div className={styles.bulkBar} role="status">
          <span>Đã chọn {selectedRows.length} hồ sơ</span>
          {approveCount ? (
            <Popconfirm
              title={`Duyệt / hoàn tất ${approveCount} hồ sơ đã chọn?`}
              description="Chỉ tính hồ sơ đang tới lượt bạn, quy trình cho duyệt hàng loạt và không cần nhập thêm thông tin."
              okText="Đồng ý"
              okType="primary"
              placement="bottom-start"
              disabled={pending !== undefined}
              onConfirm={() => runBulk('approve')}
            >
              <button type="button" className={styles.bulkPrimary} disabled={pending !== undefined}>
                <Play size={12} aria-hidden="true" />
                {pending === 'bulk:approve' ? 'Đang duyệt…' : `Duyệt ${approveCount} hồ sơ`}
              </button>
            </Popconfirm>
          ) : null}
          {rejectCount ? (
            <Popconfirm
              title={`Không duyệt và huỷ ${rejectCount} hồ sơ đã chọn?`}
              description="Các hồ sơ chuyển sang trạng thái từ chối và dừng xử lý; lý do ghi vào từng hồ sơ."
              reasonRequired
              reasonLabel="Lý do không duyệt"
              okText="Không duyệt"
              placement="bottom-start"
              disabled={pending !== undefined}
              onConfirm={(reason) => runBulk('reject', reason)}
            >
              <button
                type="button"
                className={`${styles.bulkPrimary} ${styles.bulkDanger}`}
                disabled={pending !== undefined}
              >
                <Play size={12} aria-hidden="true" />
                {pending === 'bulk:reject' ? 'Đang xử lý…' : `Không duyệt ${rejectCount} hồ sơ`}
              </button>
            </Popconfirm>
          ) : null}
          <button type="button" className={styles.linkButton} onClick={table.clearSelection}>
            Bỏ chọn
          </button>
        </div>
      ) : null}

      {bulkOutcome ? <BulkSummary outcome={bulkOutcome} titleOf={titleOf} onClose={table.clearBulkOutcome} /> : null}
    </>
  );
}

function BulkSummary({
  outcome,
  titleOf,
  onClose,
}: {
  outcome: BulkOutcome;
  /** Tên hồ sơ để hiện thay mã (mã chỉ nằm ở gợi ý khi rê chuột). */
  titleOf: (instanceId: string) => string | undefined;
  onClose: () => void;
}) {
  return (
    <div className={styles.bulkSummary} role="status" aria-label="Kết quả xử lý hàng loạt">
      <div className={styles.bulkSummaryHead}>
        <b>
          {BULK_DONE_TEXT[outcome.action]} {outcome.done} hồ sơ
        </b>
        {outcome.skipped.length ? <span>· Bỏ qua {outcome.skipped.length} hồ sơ:</span> : null}
        <button type="button" className={styles.linkButton} onClick={onClose}>
          Đóng
        </button>
      </div>
      {outcome.skipped.length ? (
        <ul className={styles.bulkSkipped}>
          {outcome.skipped.map((item) => (
            <li key={item.id}>
              <b title={item.code ? `Mã hồ sơ ${item.code}` : undefined}>
                {item.code ? (titleOf(item.id) ?? 'Hồ sơ đã chọn') : 'Hồ sơ không xem được'}
              </b>
              : {item.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Bảng hồ sơ của trang đang xem (`view`), gom theo dự án. */
export function CaseTable({
  table,
  view,
  emptyText,
  onOpen,
  openId,
}: {
  table: CaseTableState;
  view: OverviewPage;
  emptyText: string;
  /** Có thì bấm dòng, tên công việc hay "Mở để xử lý" mở hồ sơ ngay tại trang thay vì chuyển trang. */
  onOpen?: CaseOpenHandler;
  /** Hồ sơ đang mở (tô nhẹ dòng). */
  openId?: string;
}) {
  const { columns, layout } = table;
  const columnCount = columns.length + 1;
  const pageRows = view.groups.flatMap((slice) => slice.rows);
  const pageSelectable = pageRows.filter((row) => table.selectable(row.instance));
  const allOnPage = pageSelectable.length > 0 && pageSelectable.every((row) => table.selected.has(row.instance.id));

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table} style={{ minWidth: table.tableMinWidth }}>
        <colgroup>
          <col style={{ width: OVERVIEW_CHECK_COLUMN_WIDTH }} />
          {columns.map((key) => (
            <col key={key} style={key === 'name' ? undefined : { width: overviewColumnWidth(layout, key) }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className={styles.checkCell}>
              <input
                type="checkbox"
                aria-label="Chọn mọi hồ sơ trên trang"
                checked={allOnPage}
                disabled={!pageSelectable.length}
                title={pageRows.length && !pageSelectable.length ? BULK_DISABLED_TOOLTIP : undefined}
                onChange={() => table.togglePage(pageRows)}
              />
            </th>
            <ColumnHeaders layout={layout} sort={table.sort} onSort={table.toggleSort} onLayoutChange={table.setLayout} />
          </tr>
        </thead>
        <tbody>
          {view.total === 0 ? (
            <tr>
              <td colSpan={columnCount} className={styles.empty}>
                {emptyText}
              </td>
            </tr>
          ) : (
            view.groups.map(({ group, rows }) => {
              const isCollapsed = table.collapsed.has(group.key);
              return (
                <GroupRows
                  key={group.key}
                  groupKey={group.key}
                  name={group.name}
                  code={group.code}
                  total={group.rows.length}
                  colSpan={columnCount}
                  collapsed={isCollapsed}
                  onToggle={() => table.toggleGroup(group.key)}
                >
                  {isCollapsed
                    ? null
                    : rows.map((row) => (
                        <CaseTableRow
                          key={row.instance.id}
                          row={row}
                          columns={columns}
                          selectable={table.selectable(row.instance)}
                          selected={table.selected.has(row.instance.id)}
                          onSelect={() => table.toggleRow(row.instance.id)}
                          pending={table.pending}
                          onRun={table.run}
                          onOpen={onOpen}
                          open={openId === row.instance.id}
                        />
                      ))}
                </GroupRows>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Phân trang: nút trước / sau và "Trang x / y"; có `range` và `pageSize` thì thêm số bản ghi và ô chọn cỡ trang. */
export function CasePager({
  page,
  pageCount,
  onPage,
  range,
  pageSize,
  pageSizeOptions,
  onPageSize,
}: {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  range?: ReactNode;
  pageSize?: number;
  pageSizeOptions?: readonly { value: string; label: string }[];
  onPageSize?: (value: string) => void;
}) {
  return (
    <nav className={styles.pager} aria-label="Phân trang">
      {range ? <span className={styles.pagerRange}>{range}</span> : null}
      {pageSize !== undefined && pageSizeOptions && onPageSize ? (
        <SearchableSelect
          className={styles.pagerSize}
          height={28}
          searchInDropdown
          hideDropdownSearch
          dropdownMinWidth={112}
          clearable={false}
          value={String(pageSize)}
          options={[...pageSizeOptions]}
          onChange={onPageSize}
        />
      ) : null}
      <button type="button" aria-label="Trang trước" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft size={14} aria-hidden="true" />
      </button>
      <span>
        Trang {page} / {pageCount}
      </span>
      <button type="button" aria-label="Trang sau" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
        <ChevronRight size={14} aria-hidden="true" />
      </button>
    </nav>
  );
}

function GroupRows({
  groupKey,
  name,
  code,
  total,
  colSpan,
  collapsed,
  onToggle,
  children,
}: {
  groupKey: string;
  name: string;
  code?: string;
  total: number;
  colSpan: number;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <tr className={styles.groupRow} data-group={groupKey}>
        <td colSpan={colSpan}>
          <button
            type="button"
            className={styles.groupToggle}
            aria-expanded={!collapsed}
            title={code && code !== name ? `Mã dự án ${code}` : undefined}
            onClick={onToggle}
          >
            {collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
            <span className={styles.groupName}>{name}</span>
            <span className={styles.groupCount}>({total})</span>
          </button>
        </td>
      </tr>
      {children}
    </>
  );
}

// ------------------------------------------------------------------ Tiêu đề cột: sắp xếp, kéo đổi chỗ, kéo độ rộng

const COLUMN_DRAG_TYPE = 'application/x-procedure-overview-column';

function SortIcon({ direction }: { direction?: 'asc' | 'desc' }) {
  if (direction === 'asc') return <ArrowUp size={12} aria-hidden="true" />;
  if (direction === 'desc') return <ArrowDown size={12} aria-hidden="true" />;
  return <ArrowUpDown size={12} aria-hidden="true" />;
}

function sortHint(label: string, direction?: 'asc' | 'desc'): string {
  if (direction === 'asc') return `Đang sắp xếp ${label} tăng dần; bấm để giảm dần`;
  if (direction === 'desc') return `Đang sắp xếp ${label} giảm dần; bấm để bỏ sắp xếp`;
  return `Sắp xếp theo ${label}`;
}

function ariaSort(direction?: 'asc' | 'desc'): 'ascending' | 'descending' | 'none' {
  return direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none';
}

/**
 * Tiêu đề các cột sau ô chọn (ô chọn đứng yên ở đầu):
 * - Bấm tên cột để sắp xếp: tăng dần → giảm dần → về mặc định.
 * - Kéo tiêu đề thả lên nửa trái / phải của cột khác để chèn trước / sau cột đó; bàn phím: Alt + mũi tên trái/phải.
 * - Kéo mép phải tiêu đề để đổi độ rộng (có mức tối thiểu); tay nắm không kích hoạt sắp xếp hay kéo cột.
 */
function ColumnHeaders({
  layout,
  sort,
  onSort,
  onLayoutChange,
}: {
  layout: OverviewColumnLayout;
  sort?: OverviewSort;
  onSort: (key: OverviewSortKey) => void;
  onLayoutChange: LayoutUpdate;
}) {
  const [dragging, setDragging] = useState<OverviewColumnKey>();
  const [over, setOver] = useState<{ key: OverviewColumnKey; side: 'before' | 'after' }>();
  const [resizing, setResizing] = useState<OverviewColumnKey>();
  const [handleHot, setHandleHot] = useState<OverviewColumnKey>();
  const stopResize = useRef<(() => void) | undefined>(undefined);
  // Rời trang khi đang kéo độ rộng: gỡ trình nghe trên document.
  useEffect(() => () => stopResize.current?.(), []);

  const sideOf = (event: DragEvent<HTMLElement>): 'before' | 'after' => {
    const box = event.currentTarget.getBoundingClientRect();
    return event.clientX < box.left + box.width / 2 ? 'before' : 'after';
  };
  const draggedKey = (event: DragEvent<HTMLElement>): string | undefined =>
    dragging ?? (event.dataTransfer?.getData(COLUMN_DRAG_TYPE) || undefined);
  const isColumnDrag = (event: DragEvent<HTMLElement>) =>
    dragging !== undefined || Boolean(event.dataTransfer?.types?.includes(COLUMN_DRAG_TYPE));

  const startResize = (key: OverviewColumnKey, event: ReactMouseEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const measured = event.currentTarget.closest('th')?.getBoundingClientRect().width ?? 0;
    const startWidth = measured > 0 ? measured : overviewColumnWidth(layout, key);
    const startX = event.clientX;
    const previousSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    setResizing(key);
    const move = (moveEvent: MouseEvent) =>
      onLayoutChange((current) => resizeOverviewColumn(current, key, startWidth + moveEvent.clientX - startX));
    const end = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', end);
      document.body.style.userSelect = previousSelect;
      document.body.style.cursor = previousCursor;
      stopResize.current = undefined;
      setResizing(undefined);
    };
    stopResize.current = end;
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', end);
  };

  const onHandleKeyDown = (key: OverviewColumnKey, event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    const step = (event.shiftKey ? 40 : 10) * (event.key === 'ArrowLeft' ? -1 : 1);
    onLayoutChange((current) => resizeOverviewColumn(current, key, overviewColumnWidth(current, key) + step));
  };

  const onHeaderKeyDown = (key: OverviewColumnKey, event: KeyboardEvent<HTMLTableCellElement>) => {
    if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    onLayoutChange((current) => shiftOverviewColumn(current, key, event.key === 'ArrowLeft' ? -1 : 1));
  };

  const endDrag = () => {
    setDragging(undefined);
    setOver(undefined);
  };

  return (
    <>
      {visibleOverviewColumns(layout).map((key) => {
        const column = overviewColumn(key);
        const direction = column.sortKey && sort?.key === column.sortKey ? sort.direction : undefined;
        const label = <span className={styles.headLabel}>{column.label}</span>;
        return (
          <th
            key={key}
            data-column={key}
            className={cx(
              styles.headCell,
              dragging === key && styles.headDragging,
              over?.key === key && (over.side === 'before' ? styles.dropBefore : styles.dropAfter),
            )}
            draggable={resizing === undefined && handleHot !== key}
            aria-sort={column.sortKey ? ariaSort(direction) : undefined}
            onKeyDown={(event) => onHeaderKeyDown(key, event)}
            onDragStart={(event) => {
              setDragging(key);
              if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData(COLUMN_DRAG_TYPE, key);
              }
            }}
            onDragOver={(event) => {
              if (!isColumnDrag(event)) return;
              event.preventDefault();
              if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
              const side = sideOf(event);
              if (dragging === key) setOver(undefined);
              else if (over?.key !== key || over.side !== side) setOver({ key, side });
            }}
            onDragLeave={() => setOver((current) => (current?.key === key ? undefined : current))}
            onDrop={(event) => {
              if (!isColumnDrag(event)) return;
              event.preventDefault();
              const from = draggedKey(event);
              const side = sideOf(event);
              endDrag();
              if (from) onLayoutChange((current) => moveOverviewColumn(current, from, key, side));
            }}
            onDragEnd={endDrag}
          >
            {column.sortKey ? (
              <button
                type="button"
                className={cx(styles.sortButton, direction && styles.sortButtonOn)}
                title={sortHint(column.label, direction)}
                onClick={() => column.sortKey && onSort(column.sortKey)}
              >
                {label}
                <SortIcon direction={direction} />
              </button>
            ) : (
              label
            )}
            <span
              role="separator"
              aria-orientation="vertical"
              aria-label={`Độ rộng cột ${column.label}`}
              tabIndex={0}
              title="Kéo để đổi độ rộng cột"
              draggable={false}
              className={cx(styles.resizeHandle, resizing === key && styles.resizeHandleActive)}
              onMouseEnter={() => setHandleHot(key)}
              onMouseLeave={() => setHandleHot(undefined)}
              onMouseDown={(event) => startResize(key, event)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => onHandleKeyDown(key, event)}
              onDragStart={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            />
          </th>
        );
      })}
    </>
  );
}

/** Nút sắp xếp thứ tự nhóm dự án (không có cột dự án riêng): cùng vòng tăng → giảm → mặc định. */
export function ProjectSortButton({ table }: { table: CaseTableState }) {
  const direction = table.sort?.key === 'project' ? table.sort.direction : undefined;
  const hint = sortHint('nhóm dự án', direction);
  return (
    <button
      type="button"
      className={cx(styles.toolButton, direction && styles.toolbarSortOn)}
      aria-label={hint}
      title={hint}
      onClick={() => table.toggleSort('project')}
    >
      Dự án
      <SortIcon direction={direction} />
    </button>
  );
}

/** Nút "Cột" trên thanh công cụ: bật/tắt cột, đổi thứ tự bằng nút mũi tên, "Về mặc định". */
export function ColumnSettings({ table }: { table: CaseTableState }) {
  const { layout, setLayout: onChange, columnSet } = table;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const customized = !isDefaultOverviewColumnLayout(layout, columnSet);

  return (
    <span className={styles.columnSettings} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={cx(styles.toolButton, open && styles.toolButtonActive)}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Columns3 size={14} aria-hidden="true" />
        Cột
        {customized ? <span className={styles.customDot} aria-hidden="true" /> : null}
      </button>
      {open ? (
        <div className={styles.columnPanel} role="dialog" aria-label="Tuỳ chỉnh cột">
          <div className={styles.columnPanelHead}>Cột hiển thị</div>
          <ul className={styles.columnList}>
            {layout.order.map((key, index) => {
              const column = overviewColumn(key);
              return (
                <li key={key} className={styles.columnItem}>
                  <label className={styles.columnToggle}>
                    <input
                      type="checkbox"
                      checked={!layout.hidden.includes(key)}
                      disabled={column.required}
                      onChange={() => onChange((current) => toggleOverviewColumn(current, key))}
                    />
                    <span>{column.label}</span>
                  </label>
                  <button
                    type="button"
                    className={styles.columnMove}
                    aria-label={`Đưa cột ${column.label} sang trái`}
                    title="Sang trái"
                    disabled={index === 0}
                    onClick={() => onChange((current) => shiftOverviewColumn(current, key, -1))}
                  >
                    <ChevronUp size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={styles.columnMove}
                    aria-label={`Đưa cột ${column.label} sang phải`}
                    title="Sang phải"
                    disabled={index === layout.order.length - 1}
                    onClick={() => onChange((current) => shiftOverviewColumn(current, key, 1))}
                  >
                    <ChevronDown size={14} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
          <p className={styles.columnHint}>Kéo tiêu đề cột để đổi chỗ, kéo mép phải tiêu đề để đổi độ rộng.</p>
          <button
            type="button"
            className={styles.columnReset}
            disabled={!customized}
            onClick={() => onChange(() => defaultOverviewColumnLayout(columnSet))}
          >
            <RotateCcw size={13} aria-hidden="true" />
            Về mặc định
          </button>
        </div>
      ) : null}
    </span>
  );
}

// ------------------------------------------------------------------ Dòng hồ sơ

/** Bấm chuột trái thường (không giữ phím, không bấm giữa) vào liên kết hồ sơ: mở tại trang thay vì chuyển trang. */
function linkOpener(instance: ProcedureInstance, onOpen?: CaseOpenHandler) {
  if (!onOpen) return undefined;
  return (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    onOpen(instance, event.currentTarget);
  };
}

/** Phần tử bấm được trong dòng: bấm vào đó không mở hồ sơ theo dòng. */
const ROW_CONTROLS = 'a, button, input, label, textarea, [role="separator"]';

function CaseTableRow({
  row,
  columns,
  selectable,
  selected,
  onSelect,
  pending,
  onRun,
  onOpen,
  open,
}: {
  row: OverviewRow;
  columns: readonly OverviewColumnKey[];
  selectable: boolean;
  selected: boolean;
  onSelect: () => void;
  pending?: string;
  onRun: (instance: ProcedureInstance, kind: InlineActionKind, comment?: string) => Promise<void>;
  onOpen?: CaseOpenHandler;
  open?: boolean;
}) {
  const { instance } = row;
  const href = caseHref(instance.id);
  const openLink = linkOpener(instance, onOpen);
  const cell = (key: OverviewColumnKey) => {
    switch (key) {
      case 'name':
        return (
          <td key={key} className={styles.nameCell}>
            <a
              className={styles.stepName}
              href={href}
              title={`Mở hồ sơ: ${row.stepName}\nMã hồ sơ ${instance.code}`}
              onClick={openLink}
            >
              {row.stepName}
            </a>
            <a
              className={styles.procedureLine}
              href={href}
              title={`${instance.definitionName} · ${instance.title}\nMã hồ sơ ${instance.code}`}
              onClick={openLink}
            >
              Quy trình: {instance.title}
            </a>
          </td>
        );
      case 'status':
        return (
          <td key={key} className={styles.statusCell}>
            <span className={`${boardStyles.badge} ${boardStyles[instance.status]}`}>{STATUS_LABEL[instance.status]}</span>
          </td>
        );
      case 'sla':
        return (
          <td key={key} className={styles.slaCell}>
            <SlaBadge view={evaluateInstanceSla(instance)} />
          </td>
        );
      case 'actualStart':
        return (
          <td key={key} className={styles.dateCell}>
            <span className={row.actualStart ? undefined : styles.muted}>{formatOverviewDateTime(row.actualStart)}</span>
          </td>
        );
      case 'plannedEnd':
        return (
          <td key={key} className={styles.dateCell}>
            <span className={styles.dateLine}>
              {/* Quá hạn chỉ tô đỏ ngày, không thêm chữ cho gọn; rê chuột vẫn thấy "Quá hạn". */}
              <span
                className={row.overdue ? styles.overdue : row.plannedEnd ? undefined : styles.muted}
                title={row.overdue ? 'Quá hạn' : undefined}
              >
                {formatOverviewDateTime(row.plannedEnd)}
              </span>
            </span>
          </td>
        );
      case 'action':
        return (
          <td key={key} className={styles.actionCell}>
            <RowActions instance={instance} href={href} pending={pending} onRun={onRun} openLink={openLink} />
          </td>
        );
      case 'owner':
        return (
          <td key={key} className={styles.ownerCell}>
            <Avatar name={row.initiatorName} />
          </td>
        );
      default:
        return null;
    }
  };
  return (
    <tr
      data-case-id={instance.id}
      className={cx(selected && styles.rowSelected, onOpen && styles.rowOpenable, open && styles.rowOpen)}
      onClick={
        onOpen
          ? (event) => {
              // Bấm ô chọn, nút thao tác, liên kết, hay trong hộp xác nhận (vẽ bằng portal) thì không mở hồ sơ.
              const target = event.target as HTMLElement;
              if (!event.currentTarget.contains(target) || target.closest(ROW_CONTROLS)) return;
              onOpen(instance, event.currentTarget.querySelector<HTMLElement>('a') ?? undefined);
            }
          : undefined
      }
    >
      <td className={styles.checkCell}>
        <input
          type="checkbox"
          aria-label={`Chọn ${instance.code}`}
          checked={selected && selectable}
          disabled={!selectable}
          title={selectable ? undefined : BULK_DISABLED_TOOLTIP}
          onChange={onSelect}
        />
      </td>
      {columns.map(cell)}
    </tr>
  );
}

/**
 * Cột "Hành động" kiểu 1office: hiện HẾT các thao tác của dòng thành một cột dọc, gom bằng một ngoặc mảnh bên trái, mỗi thao tác
 * là một liên kết xanh có dấu ▷. Thứ tự: không duyệt cần chỉnh sửa, duyệt / hoàn tất (hay "Mở để xử lý" khi bước cần nhập thêm),
 * không duyệt hủy, hoàn duyệt. Thao tác "không duyệt" và "hoàn duyệt" vẫn qua ô xác nhận như trước (trả lại bắt buộc nội dung
 * cần sửa). Chưa tới lượt thì chỉ hiện nhãn mờ "Chờ …".
 */
function RowActions({
  instance,
  href,
  pending,
  onRun,
  openLink,
}: {
  instance: ProcedureInstance;
  href: string;
  pending?: string;
  onRun: (instance: ProcedureInstance, kind: InlineActionKind, comment?: string) => Promise<void>;
  /** Có thì "Mở để xử lý" mở hồ sơ ngay tại trang. */
  openLink?: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
}) {
  const plan = inlineActionPlan(instance);
  const { primary, secondary } = splitInlineActions(plan);
  const disabled = pending !== undefined;
  const label = (action: InlineAction) => (pending === `${action.kind}:${instance.id}` ? 'Đang xử lý…' : action.label);
  const play = <Play size={12} aria-hidden="true" className={styles.actionPlay} />;

  const items: ReactNode[] = [];
  const returnAction = secondary.find((action) => action.kind === 'return');
  if (returnAction) {
    items.push(
      returnAction.needsDetail ? (
        <a key="return" className={styles.actionItem} href={href} title="Chọn bước trả về trong hồ sơ" onClick={openLink}>
          {play}
          {returnAction.label}
        </a>
      ) : (
        <Popconfirm
          key="return"
          title="Không duyệt, trả lại để chỉnh sửa?"
          description={instance.title}
          reasonRequired
          reasonLabel="Nội dung cần chỉnh sửa"
          okText="Trả lại"
          placement="left"
          disabled={disabled}
          onConfirm={(reason) => onRun(instance, 'return', reason)}
        >
          <button type="button" className={styles.actionItem} disabled={disabled}>
            {play}
            {label(returnAction)}
          </button>
        </Popconfirm>
      ),
    );
  }
  if (primary) {
    items.push(
      <button
        key="primary"
        type="button"
        className={styles.actionItem}
        disabled={disabled}
        onClick={() => void onRun(instance, primary.kind)}
      >
        {play}
        {label(primary)}
      </button>,
    );
  } else if (plan.openReason) {
    items.push(
      <a key="open" className={styles.actionItem} href={href} title={plan.openReason} onClick={openLink}>
        {play}
        Mở để xử lý
      </a>,
    );
  }
  for (const action of secondary) {
    if (action.kind === 'reject') {
      items.push(
        <Popconfirm
          key="reject"
          title="Không duyệt và hủy hồ sơ này?"
          description="Hồ sơ chuyển sang trạng thái từ chối và dừng xử lý."
          reasonRequired={false}
          reasonLabel="Lý do"
          okText="Không duyệt, hủy"
          placement="left"
          disabled={disabled}
          onConfirm={(reason) => onRun(instance, 'reject', reason || undefined)}
        >
          <button type="button" className={styles.actionItem} disabled={disabled}>
            {play}
            {label(action)}
          </button>
        </Popconfirm>,
      );
    } else if (action.kind === 'withdraw') {
      items.push(
        <Popconfirm
          key="withdraw"
          title={`Hoàn duyệt và quay lại bước “${instance.authorization?.withdrawStepName ?? 'trước'}”?`}
          okText="Hoàn duyệt"
          okType="primary"
          placement="left"
          disabled={disabled}
          onConfirm={() => onRun(instance, 'withdraw')}
        >
          <button type="button" className={styles.actionItem} disabled={disabled}>
            {play}
            {label(action)}
          </button>
        </Popconfirm>,
      );
    } else if (action.kind === 'approve' || action.kind === 'complete') {
      // Duyệt / Hoàn tất thứ hai (hiếm): làm ngay như thao tác chính.
      items.push(
        <button
          key={action.kind}
          type="button"
          className={styles.actionItem}
          disabled={disabled}
          onClick={() => void onRun(instance, action.kind)}
        >
          {play}
          {label(action)}
        </button>,
      );
    }
  }

  if (items.length === 0) {
    return plan.waiting ? (
      <span
        className={cx(styles.waitingPill, instance.status === 'completed' && styles.waitingPillDone)}
        title={overviewWaitingTitle(instance) ?? plan.waiting}
      >
        {plan.waiting}
      </span>
    ) : null;
  }
  return (
    <div
      className={cx(styles.actionList, items.length > 1 && styles.actionListBracket)}
      aria-label={`Thao tác cho ${instance.code}`}
    >
      {items}
    </div>
  );
}
