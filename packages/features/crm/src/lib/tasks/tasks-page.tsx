'use client';

import { CRM_TASK_KIND_LABELS, type CrmTask, type CrmTaskList } from '@enterprise-platform/contracts-crm';
import { formatDateTime } from '@enterprise-platform/shared-ui';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { rowOpener } from '../components/crm-ui';
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
 * Trang "Việc cần xử lý" (plan mục 17.4, D3-32): hai bảng "Chờ tôi duyệt" (báo giá, PAKD trình riêng chờ người xem
 * duyệt) và "Việc của tôi" (báo giá, PAKD người xem phụ trách bị từ chối; báo giá đã duyệt chờ gửi khách). Bấm dòng: qua
 * Quy trình thì sang hồ sơ bên Quy trình, Quy trình tự quay về đây; còn lại mở báo giá kèm nút quay về.
 */
export function TasksPage({ onLoaded, ...openers }: TaskOpeners & { /** Báo số việc cho thanh bên. */ onLoaded?: (list: CrmTaskList) => void }) {
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
    </div>
  );
}

function TaskTable({
  title,
  group,
  tasks,
  loading,
  emptyText,
  openers,
}: {
  title: string;
  group: 'awaiting' | 'mine';
  tasks: readonly CrmTask[];
  loading: boolean;
  emptyText: string;
  openers: TaskOpeners;
}) {
  const { people } = useCrm();
  const showMargin = hasMargin(tasks);
  const awaiting = group === 'awaiting';

  const columns = useMemo<ColumnsType<CrmTask>>(() => {
    const all: ColumnsType<CrmTask> = [
      { title: 'Việc', key: 'kind', width: 210, render: (_: unknown, row) => CRM_TASK_KIND_LABELS[row.kind] },
      {
        title: 'Báo giá',
        key: 'quote',
        width: 260,
        ellipsis: true,
        render: (_: unknown, row) => (
          <span title={taskQuoteLabel(row)}>
            <span className={styles.mono}>{row.quoteCode}</span>
            {row.quoteName ? ` - ${row.quoteName}` : ''} (v{row.versionNo})
          </span>
        ),
      },
      { title: 'Khách hàng', key: 'customer', width: 200, ellipsis: true, render: (_: unknown, row) => row.customerName ?? '' },
      awaiting
        ? {
            title: 'Người trình',
            key: 'actor',
            width: 170,
            ellipsis: true,
            render: (_: unknown, row) => row.actorName ?? personName(people, row.actorUserId),
          }
        : {
            title: 'Người phụ trách',
            key: 'owner',
            width: 170,
            ellipsis: true,
            render: (_: unknown, row) => row.ownerName ?? personName(people, row.ownerUserId),
          },
      { title: 'Thời điểm', key: 'at', width: 140, render: (_: unknown, row) => formatDateTime(row.at ?? '') },
      { title: 'Tổng tiền', key: 'total', width: 150, align: 'right', render: (_: unknown, row) => formatMoney(row.totalAmount) },
    ];
    if (showMargin) {
      all.push({ title: 'Biên', key: 'margin', width: 90, align: 'right', render: (_: unknown, row) => formatPercent(row.marginPercent) });
    }
    all.push({
      title: awaiting ? 'Lý do cần duyệt' : 'Lý do',
      key: 'reasons',
      width: 260,
      // Một dòng cho lý do đầu, các lý do còn lại gộp "và n lý do khác"; đủ danh sách ở tooltip (`title`) để dòng không cao.
      render: (_: unknown, row) => <ReasonsCell reasons={row.reasons} />,
    });
    if (awaiting) {
      all.push({ title: 'Cách duyệt', key: 'mode', width: 170, render: (_: unknown, row) => approvalModeText(row.approval) });
    }
    all.push({
      title: '',
      key: 'action',
      width: 170,
      fixed: 'right',
      render: (_: unknown, row) => (
        <button type="button" className={styles.buttonGhost} onClick={() => openTask(row, openers)}>
          {taskActionLabel(row)}
        </button>
      ),
    });
    return all;
  }, [awaiting, showMargin, people, openers]);

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
        dataSource={[...tasks]}
        pagination={false}
        scroll={{ x: columns.reduce((sum, column) => sum + (typeof column.width === 'number' ? column.width : 0), 0) }}
        onRow={(row) => rowOpener(() => openTask(row, openers))}
        locale={{ emptyText: loading ? 'Đang tải…' : emptyText }}
      />
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
      {more > 0 ? <span className={styles.muted}>và {more} lý do khác</span> : null}
    </span>
  );
}

