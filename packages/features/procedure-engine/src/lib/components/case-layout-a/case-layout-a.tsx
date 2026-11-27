'use client';

import type { ProcedureDefinition, ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CASE_BOARD_COLUMN_SET,
  buildOverviewRow,
  groupOverviewRowsInOrder,
  paginateOverviewGroups,
  type InlineActionKind,
  type OverviewTab,
} from '../../procedure-overview';
import {
  CaseBulkBar,
  CasePager,
  CaseTable,
  ColumnSettings,
  ProjectSortButton,
  useCaseTable,
  type CaseOpenHandler,
} from '../case-table/case-table';
import { useInstanceProjects } from '../use-instance-project';
import { PAGE_SIZE_OPTIONS, SLA_FILTER_OPTIONS, SOURCE_FILTER_OPTIONS } from '../workspace-board-options';
import boardStyles from '../workspace-board.module.scss';
import { CaseDetail, CaseHeading, type CaseLayoutADetail } from './case-detail';
import { CaseModal } from './case-modal';
import styles from './case-layout-a.module.scss';
import { useWidthLayout } from './use-width-mode';

export type { CaseLayoutADetail } from './case-detail';

/**
 * Giao diện mới của màn "Hồ sơ xử lý": thanh lọc + bảng hồ sơ đầy đủ chiều rộng (bảng chung `case-table/`: gom theo dự án,
 * sắp xếp, ẩn hiện / kéo cột, duyệt ngay trên dòng, duyệt hàng loạt); bấm một hồ sơ thì mở cửa sổ chi tiết để xem và xử lý.
 * Chỉ SẮP LẠI các khối có sẵn của `WorkspaceBoard` (state, bộ lọc, khung xử lý, hộp thoại đều do `WorkspaceBoard` giữ và
 * truyền vào), không có logic nghiệp vụ riêng.
 */

/** Class gắn vào khung xử lý (`ActionPanel`) để hàng nút thao tác bám đáy cửa sổ hồ sơ. */
export const CASE_LAYOUT_A_DOCK = { dock: styles.dock, actionRow: styles.stickyActions } as const;

export interface CaseLayoutAToolbar<F extends string> {
  readonly statusTabs: ReadonlyArray<readonly [F, string, number]>;
  readonly filter: string;
  readonly onFilter: (value: F) => void;
  readonly query: string;
  readonly onQuery: (value: string) => void;
  readonly slaFilter: string;
  readonly onSlaFilter: (value: string) => void;
  readonly source: string;
  readonly onSource: (value: string) => void;
  readonly canReset: boolean;
  readonly onReset: () => void;
  /** Xuất Excel, Tạo đơn: đúng các nút của giao diện cũ. */
  readonly headActions: ReactNode;
  readonly layoutToggle: ReactNode;
}

/** Cách mở hồ sơ: từ bảng thì thêm một mục lịch sử (nút Back đóng cửa sổ), chuyển hồ sơ trong cửa sổ thì thay mục đang có. */
export type CaseOpenMode = 'push' | 'replace';

export interface CaseLayoutABoard {
  /** Mọi hồ sơ (tra dự án, tên hồ sơ cho kết quả hàng loạt). */
  readonly instances: readonly ProcedureInstance[];
  /** Hồ sơ khớp bộ lọc, đã sắp theo ngày mở đơn (thứ tự mặc định của bảng). */
  readonly visible: readonly ProcedureInstance[];
  readonly totalCount: number;
  readonly definitions: readonly ProcedureDefinition[];
  readonly actorId?: string;
  /** Bước hiện trên dòng: `mine-done` (tab "Bạn đã xử lý") là bước người xem xử lý gần nhất; mặc định bước đang chạy. */
  readonly rowTab?: OverviewTab;
  readonly page: number;
  readonly pageSize: number;
  readonly onPage: (page: number) => void;
  readonly onPageSize: (value: string) => void;
  /** Thao tác ngay trên dòng: đi đúng đường xử lý hồ sơ của màn (`onAction`). */
  readonly runAction: (instance: ProcedureInstance, kind: InlineActionKind, comment?: string) => Promise<void>;
  readonly afterBulk: (ids: readonly string[]) => void | Promise<void>;
  readonly onNotice?: (message: string) => void;
  readonly onError?: (message: string) => void;
  /** Hồ sơ đang mở trong cửa sổ. */
  readonly openId?: string;
  readonly onOpen: (instanceId: string, mode: CaseOpenMode) => void;
  readonly onClose: () => void;
}

/** Vị trí của hồ sơ trên quy trình: đổi sau một thao tác thì hồ sơ đã được xử lý ở cửa sổ này. */
function progressKey(instance: ProcedureInstance): string {
  const step = instance.steps.find((item) => item.id === instance.currentStepId);
  return `${instance.status}|${instance.currentStepId ?? ''}|${step?.currentRoleStage ?? ''}`;
}

export function CaseLayoutA<F extends string>({
  toolbar,
  board,
  detail,
  overlaysTop,
  overlaysBottom,
}: {
  toolbar: CaseLayoutAToolbar<F>;
  board: CaseLayoutABoard;
  /** Chi tiết hồ sơ đang mở; vắng là cửa sổ đóng. */
  detail?: CaseLayoutADetail;
  overlaysTop: ReactNode;
  overlaysBottom: ReactNode;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const { mode, toolbar: toolbarLayout } = useWidthLayout(rootRef);
  const titleId = useId();

  const projects = useInstanceProjects(board.instances);
  const actorId = board.actorId ?? '';
  const rowTab = board.rowTab ?? 'all';
  const groups = useMemo(
    () =>
      groupOverviewRowsInOrder(
        board.visible.map((instance) => buildOverviewRow(instance, rowTab, actorId, projects.get(instance.id))),
      ),
    [board.visible, rowTab, actorId, projects],
  );
  const table = useCaseTable({
    groups,
    definitions: board.definitions,
    columnSet: CASE_BOARD_COLUMN_SET,
    runAction: board.runAction,
    afterBulk: board.afterBulk,
    onNotice: board.onNotice,
    onError: board.onError,
  });
  const view = paginateOverviewGroups(table.sortedGroups, board.page, board.pageSize);
  // Thứ tự hồ sơ đang thấy (mọi trang): để ‹ › trong cửa sổ đi tới hồ sơ trước / sau.
  const order = useMemo(
    () => table.sortedGroups.flatMap((group) => group.rows.map((row) => row.instance.id)),
    [table.sortedGroups],
  );

  // Đổi sắp xếp theo cột: về trang 1 (như đổi bộ lọc).
  const { onPage } = board;
  const sortRef = useRef(table.sort);
  useEffect(() => {
    if (sortRef.current === table.sort) return;
    sortRef.current = table.sort;
    onPage(1);
  }, [table.sort, onPage]);

  // Hồ sơ đang mở (kể cả mở thẳng qua đường dẫn, hay chuyển bằng ‹ ›) luôn nằm ở trang đang xem của bảng.
  const openIndex = board.openId ? order.indexOf(board.openId) : -1;
  useEffect(() => {
    if (openIndex < 0) return;
    const target = Math.floor(openIndex / board.pageSize) + 1;
    if (target !== view.page) onPage(target);
  }, [openIndex, board.pageSize, view.page, onPage]);

  // Vị trí sau cùng của hồ sơ đang mở: hồ sơ vừa xử lý xong rời bộ lọc thì ‹ › vẫn đi tiếp từ chỗ đó.
  const anchor = useRef(-1);
  useEffect(() => {
    if (openIndex >= 0) anchor.current = openIndex;
  }, [openIndex]);
  const base = openIndex >= 0 ? openIndex : anchor.current;
  const prevId = base > 0 ? order[base - 1] : undefined;
  const nextId = openIndex >= 0 ? order[openIndex + 1] : base >= 0 ? order[base] : undefined;

  // Hồ sơ đã được xử lý trong cửa sổ (vị trí trên quy trình đổi so với lúc mở): mời sang hồ sơ kế tiếp.
  const [openedAt, setOpenedAt] = useState<{ id: string; key: string }>();
  const openInstance = detail?.instance;
  useEffect(() => {
    if (!openInstance) {
      setOpenedAt(undefined);
      return;
    }
    setOpenedAt((current) =>
      current?.id === openInstance.id ? current : { id: openInstance.id, key: progressKey(openInstance) },
    );
  }, [openInstance]);
  const processed = Boolean(
    openInstance && openedAt?.id === openInstance.id && openedAt.key !== progressKey(openInstance),
  );

  // Phần tử nhận lại focus khi đóng cửa sổ: dòng của hồ sơ trên bảng, không thì nơi đã bấm mở.
  const trigger = useRef<HTMLElement | null>(null);
  const openFromTable: CaseOpenHandler = (instance, element) => {
    trigger.current = element ?? (document.activeElement as HTMLElement | null);
    board.onOpen(instance.id, 'push');
  };
  const restoreFocus = () => {
    const id = board.openId;
    const row = id
      ? rootRef.current?.querySelector<HTMLElement>(`tr[data-case-id="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id}"] a`)
      : null;
    return row ?? (trigger.current?.isConnected ? trigger.current : null);
  };

  return (
    <section
      ref={rootRef}
      className={`${boardStyles.workspace} ${styles.root} ${styles[`mode_${mode}`] ?? ''} ${
        styles[`toolbar_${toolbarLayout}`] ?? ''
      }`}
      data-layout="a"
      data-width-mode={mode}
      data-toolbar={toolbarLayout}
    >
      {overlaysTop}

      <div className={styles.toolbar}>
        <div className={styles.segment} role="tablist" aria-label="Lọc theo trạng thái">
          {toolbar.statusTabs.map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={toolbar.filter === value}
              className={`${styles.segmentItem} ${toolbar.filter === value ? styles.segmentItemOn : ''} ${
                value === 'urgent' && count > 0 ? styles.segmentItemUrgent : ''
              }`}
              onClick={() => toolbar.onFilter(value)}
            >
              {label}
              <span className={styles.segmentCount}>{count}</span>
            </button>
          ))}
        </div>

        <div className={styles.toolbarFilters}>
          <label className={styles.search}>
            <Search size={14} strokeWidth={2} aria-hidden />
            <input
              aria-label="Tìm hồ sơ"
              placeholder="Tìm mã PROC, tiêu đề..."
              value={toolbar.query}
              onChange={(event) => toolbar.onQuery(event.target.value)}
            />
          </label>
          <SearchableSelect
            className={styles.filterSelect}
            height={32}
            searchInDropdown
            hideDropdownSearch
            dropdownMinWidth={160}
            clearable={false}
            value={toolbar.slaFilter}
            options={SLA_FILTER_OPTIONS}
            onChange={toolbar.onSlaFilter}
          />
          <SearchableSelect
            className={styles.filterSelect}
            height={32}
            searchInDropdown
            hideDropdownSearch
            dropdownMinWidth={160}
            clearable={false}
            value={toolbar.source}
            options={SOURCE_FILTER_OPTIONS}
            onChange={toolbar.onSource}
          />
          {toolbar.canReset ? (
            <button type="button" className={styles.reset} onClick={toolbar.onReset} title="Đặt lại tất cả bộ lọc">
              Đặt lại
            </button>
          ) : null}
        </div>

        <div className={styles.toolbarEnd}>
          <ProjectSortButton table={table} />
          <ColumnSettings table={table} />
          {toolbar.headActions}
          {toolbar.layoutToggle}
        </div>
      </div>

      <CaseBulkBar table={table} titleOf={(id) => board.instances.find((item) => item.id === id)?.title} />

      <section className={styles.tableArea} aria-label="Danh sách hồ sơ">
        <CaseTable
          table={table}
          view={view}
          emptyText={board.totalCount === 0 ? 'Chưa có hồ sơ.' : 'Không có hồ sơ nào khớp bộ lọc.'}
          onOpen={openFromTable}
          openId={board.openId}
        />
        {view.total > 0 ? (
          <CasePager
            page={view.page}
            pageCount={view.pageCount}
            onPage={onPage}
            range={`${view.from}–${view.to} / ${view.total} hồ sơ`}
            pageSize={board.pageSize}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageSize={board.onPageSize}
          />
        ) : null}
      </section>

      {detail ? (
        <CaseModal
          titleId={titleId}
          onClose={board.onClose}
          position={openIndex >= 0 ? openIndex + 1 : undefined}
          total={order.length}
          onPrev={prevId ? () => board.onOpen(prevId, 'replace') : undefined}
          onNext={nextId ? () => board.onOpen(nextId, 'replace') : undefined}
          onNextCase={processed && nextId ? () => board.onOpen(nextId, 'replace') : undefined}
          restoreFocus={restoreFocus}
          heading={<CaseHeading instance={detail.instance} titleId={titleId} />}
          actions={detail.headerActions}
        >
          <CaseDetail key={detail.instance.id} detail={detail} />
        </CaseModal>
      ) : null}

      {overlaysBottom}
    </section>
  );
}
