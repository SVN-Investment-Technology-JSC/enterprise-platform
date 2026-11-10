'use client';

import { CRM_LIST_PAGE_SIZE, CRM_TASK_KIND_LABELS, type CrmTask, type CrmTaskKind, type CrmTaskList } from '@enterprise-platform/contracts-crm';
import { formatDateTime } from '@enterprise-platform/shared-ui';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ListPager, rowOpener, StatusPill } from '../components/crm-ui';
import { pageCountOf } from '../components/pagination.model';
import { errorMessage, getMyTasks } from '../crm-api';
import { useCrm } from '../crm-context';
import { formatPercent } from '../pricing/pricing.model';
import { formatMoney, personName } from '../sales.model';
import styles from '../sales.module.scss';
import {
  approvalModeText,
  hasMargin,
  openPath,
  taskActionLabel,
  taskQuoteLabel,
  taskTarget,
} from './tasks.model';

export interface TaskOpeners {
  /** Mở báo giá trong CRM, `sub` là đoạn sau `#quotes/`. */
  readonly onOpenQuote: (sub: string) => void;
  /** Sang hồ sơ Quy trình (cùng tab); mặc định `location.assign`. */
  readonly onOpenProcedure?: (href: string) => void;
}

/** Mở một việc theo `taskTarget`. */
export function openTask(task: CrmTask, openers: TaskOpeners, options: { returnTo?: string; fromTasks?: boolean } = {}): void {
  const target = taskTarget(task, options);
  if (target.kind === 'procedure') (openers.onOpenProcedure ?? openPath)(target.href);
  else openers.onOpenQuote(target.sub);
}

/**
 * Trang "Việc cần xử lý" (plan mục 17.4, D3-32, D3-36): "Chờ tôi duyệt" (báo giá, PAKD trình riêng chờ người xem
 * duyệt), "Việc của tôi" (báo giá, PAKD người xem phụ trách bị từ chối; báo giá đã duyệt chờ gửi khách) và "Đang chờ
 * duyệt" (việc người xem trình hoặc phụ trách đang chờ người khác; quản trị thấy hết, kèm bước và người đang duyệt).
 * Bấm dòng: duyệt qua Quy trình thì sang hồ sơ bên Quy trình, Quy trình tự quay về đây; còn lại mở báo giá kèm nút
 * quay về.
 */
export function TasksPage({ onLoaded, ...openers }: TaskOpeners & { /** Báo số việc cho thanh bên. */ onLoaded?: (list: CrmTaskList) => void }) {
  const { capabilities } = useCrm();
  const [list, setList] = useState<CrmTaskList>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  // Chỉ để báo ra ngoài: đọc qua ref để màn gọi dựng lại hàm cũng không tải lại danh sách.
  const reported = useRef(onLoaded);
  useEffect(() => {
    reported.current = onLoaded;
  }, [onLoaded]);

  const load = useCallback(() => {
    setLoading(true);
    return getMyTasks()
      .then((next) => {
        setList(next);
        setError(undefined);
        reported.current?.(next);
      })
      .catch((cause) => setError(errorMessage(cause, 'Không tải được việc cần xử lý.')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <h2 className={styles.title}>Việc cần xử lý</h2>
        <button type="button" className={styles.buttonGhost} disabled={loading} onClick={() => void load()}>
          <RefreshCw size={14} aria-hidden /> Làm mới
        </button>
      </div>
      {error ? (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      ) : null}
      <TaskTable
        title="Chờ tôi duyệt"
        group="awaiting"
        tasks={list?.awaitingMe ?? []}
        loading={loading}
        emptyText="Không có báo giá hay phương án kinh doanh nào đang chờ bạn duyệt."
        openers={openers}
      />
      <TaskTable
        title="Việc của tôi"
        group="mine"
        tasks={list?.mine ?? []}
        loading={loading}
        emptyText="Không có báo giá nào của bạn cần xử lý."
        openers={openers}
      />
      <TaskTable
        title="Đang chờ duyệt"
        group="waiting"
        tasks={list?.waiting ?? []}
        loading={loading}
        emptyText={
          capabilities.isTenantAdmin || capabilities.canManage
            ? 'Không có báo giá hay phương án kinh doanh nào đang chờ duyệt.'
            : 'Không có báo giá hay phương án kinh doanh nào bạn trình đang chờ người khác duyệt.'
        }
        openers={openers}
      />
    </div>
  );
}

/** Màu nhãn Việc, như cột Trạng thái của danh sách báo giá. */
const TASK_KIND_TONE: Readonly<Record<CrmTaskKind, 'neutral' | 'info' | 'success' | 'warning' | 'danger'>> = {
  QUOTE_APPROVAL: 'warning',
  BUSINESS_PLAN_APPROVAL: 'warning',
  QUOTE_REJECTED: 'danger',
  BUSINESS_PLAN_REJECTED: 'danger',
  QUOTE_READY_TO_SEND: 'success',
  QUOTE_PENDING: 'info',
  BUSINESS_PLAN_PENDING: 'info',
};

/**
 * Một bảng việc, cùng kiểu danh sách báo giá: mỗi việc một dòng gọn (chữ dài cắt, rê chuột xem đủ), bấm cả dòng để
 * mở (duyệt qua Quy trình thì sang hồ sơ bên Quy trình), phân trang `ListPager` 15 dòng ngay trên trang.
 */
function TaskTable({
  title,
  group,
  tasks,
  loading,
  emptyText,
  openers,
}: {
  title: string;
  group: 'awaiting' | 'mine' | 'waiting';
  tasks: readonly CrmTask[];
  loading: boolean;
  emptyText: string;
  openers: TaskOpeners;
}) {
  const { people } = useCrm();
  const showMargin = hasMargin(tasks);
  const [page, setPage] = useState(1);
  // Danh sách tải lại ít đi (vừa duyệt xong): không để trang hiện tại vượt quá số trang.
  const pageCount = pageCountOf(tasks.length, CRM_LIST_PAGE_SIZE);
  const current = Math.min(page, pageCount);
  const shown = tasks.slice((current - 1) * CRM_LIST_PAGE_SIZE, current * CRM_LIST_PAGE_SIZE);

  const columns = useMemo<ColumnsType<CrmTask>>(() => {
    const person = (userId: string | null, name: string | null) => name ?? personName(people, userId);
    const all: ColumnsType<CrmTask> = [
      {
        title: 'Mã',
        key: 'code',
        width: 130,
        render: (_: unknown, row) => (
          <span className={styles.mono} title={taskQuoteLabel(row)}>
            {row.quoteCode}
          </span>
        ),
      },
      { title: 'Khách hàng', key: 'customer', width: 240, ellipsis: { showTitle: true }, render: (_: unknown, row) => row.customerName ?? '' },
      {
        title: 'Việc',
        key: 'kind',
        width: 230,
        render: (_: unknown, row) => <StatusPill tone={TASK_KIND_TONE[row.kind]}>{CRM_TASK_KIND_LABELS[row.kind]}</StatusPill>,
      },
      { title: 'Phiên bản', key: 'version', width: 90, align: 'right', render: (_: unknown, row) => `v${row.versionNo}` },
      { title: 'Tổng cộng', key: 'total', width: 150, align: 'right', render: (_: unknown, row) => formatMoney(row.totalAmount) },
    ];
    if (showMargin) {
      all.push({ title: 'Biên', key: 'margin', width: 80, align: 'right', render: (_: unknown, row) => formatPercent(row.marginPercent) });
    }
    if (group === 'waiting') {
      all.push({ title: 'Đang chờ', key: 'waitingOn', width: 200, ellipsis: { showTitle: true }, render: (_: unknown, row) => row.waitingOn ?? '' });
    }
    if (group === 'awaiting') {
      all.push({ title: 'Cách duyệt', key: 'mode', width: 170, ellipsis: true, render: (_: unknown, row) => approvalModeText(row.approval) });
    }
    all.push(
      group === 'mine'
        ? { title: 'Người phụ trách', key: 'owner', width: 170, ellipsis: true, render: (_: unknown, row) => person(row.ownerUserId, row.ownerName) }
        : { title: 'Người trình', key: 'actor', width: 170, ellipsis: true, render: (_: unknown, row) => person(row.actorUserId, row.actorName) },
      {
        title: group === 'mine' ? 'Lúc có kết quả' : 'Lúc trình',
        key: 'at',
        width: 150,
        render: (_: unknown, row) => <span className={styles.nowrap}>{formatDateTime(row.at ?? '')}</span>,
      },
      {
        title: group === 'mine' ? 'Lý do' : 'Lý do cần duyệt',
        key: 'reasons',
        width: 240,
        ellipsis: true,
        render: (_: unknown, row) => (row.reasons.length ? <ReasonsCell reasons={row.reasons} /> : ''),
      },
    );
    return all;
  }, [group, showMargin, people]);

  return (
    <section className={styles.tableCard} aria-label={title}>
      <h3 className={styles.sectionTitle}>
        {title}
        {loading ? '' : ` (${tasks.length})`}
      </h3>
      <Table<CrmTask>
        size="small"
        rowKey={(row) => `${row.kind}:${row.quoteId}:${row.versionNo}`}
        loading={loading}
        columns={columns}
        dataSource={shown}
        pagination={false}
        // Đủ chỗ cho mọi cột (không cột nào bị bóp mất); màn hẹp thì cuộn ngang như danh sách báo giá.
        scroll={{ x: columns.reduce((sum, column) => sum + (typeof column.width === 'number' ? column.width : 0), 0) }}
        onRow={(row) => ({ ...rowOpener(() => openTask(row, openers)), title: taskActionLabel(row) })}
        locale={{ emptyText: loading ? 'Đang tải…' : emptyText }}
      />
      {tasks.length > CRM_LIST_PAGE_SIZE ? (
        <ListPager page={current} total={tasks.length} pageSize={CRM_LIST_PAGE_SIZE} loading={loading} noun="việc" onChange={setPage} />
      ) : null}
    </section>
  );
}

/** Lý do trong bảng: lý do đầu (cắt một dòng) và số lý do còn lại; rê chuột xem đủ. */
export function ReasonsCell({ reasons }: { reasons: readonly string[] }) {
  if (!reasons.length) return null;
  const more = reasons.length - 1;
  return (
    <span className={styles.reasonCell} title={reasons.join('\n')}>
      <span className={styles.reasonFirst}>{reasons[0]}</span>
      {more > 0 ? <span className={styles.muted}> và {more} lý do khác</span> : null}
    </span>
  );
}
