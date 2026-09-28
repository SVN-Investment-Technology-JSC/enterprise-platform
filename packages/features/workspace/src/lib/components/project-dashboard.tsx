'use client';

import type { ReportBundle } from '@enterprise-platform/contracts-workspace';
import { BarChart, DonutChart } from '@enterprise-platform/feature-module-shell';
import { AlertTriangle, Briefcase, DollarSign, ListChecks, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { formatVnd, formatVndCompact } from '../money';
import * as api from '../workspace-api';
import { WORK_ITEM_STATUS_LABELS, formatDate } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { useDirectory } from './use-directory';

/**
 * Tổng quan toàn phạm vi, mở từ đầu danh mục dự án.
 *
 * **Khác trang Báo cáo:** đây là bức tranh nhanh để mở đầu ngày làm việc — bốn
 * con số lớn, hai biểu đồ và danh sách việc trễ hạn. Trang Báo cáo mới là chỗ
 * lọc theo kỳ, xem tải công việc của từng người và xuất CSV.
 *
 * Dùng chung endpoint `/reports` nên không thêm lượt gọi nào cho server.
 */
export function ProjectDashboard({ onOpenProject }: { onOpenProject: (projectId: string) => void }) {
  const directory = useDirectory();
  const [bundle, setBundle] = useState<ReportBundle>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setBundle(await api.loadReports({}));
      setError(undefined);
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không tải được số liệu tổng quan.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (error) {
    return (
      <p role="alert" className={styles.alert}>
        {error}
      </p>
    );
  }
  if (!bundle) {
    return <p className={styles.muted}>{loading ? 'Đang tải số liệu…' : 'Chưa có số liệu.'}</p>;
  }

  const projects = bundle.projectProgress;
  const totalItems = projects.reduce((sum, row) => sum + row.totalItems, 0);
  const closedItems = projects.reduce((sum, row) => sum + row.closedItems, 0);
  const overdueItems = projects.reduce((sum, row) => sum + row.overdueItems, 0);
  const activeProjects = projects.filter((row) => row.status !== 'cancelled').length;

  // Cụm trạng thái lấy từ chính danh sách dự án: xong, quá hạn và phần còn lại
  // đang mở. Không gọi thêm API chỉ để vẽ một hình tròn.
  const statusSlices = [
    { label: 'Đã đóng', value: closedItems, color: '#22c55e' },
    { label: 'Quá hạn', value: overdueItems, color: '#ef4444' },
    { label: 'Đang mở', value: Math.max(totalItems - closedItems - overdueItems, 0), color: '#3b82f6' },
  ];

  const workloadSlices = projects.map((row) => ({ label: row.projectCode, value: row.totalItems }));
  /** Mã dự án -> id, để bấm từ bảng quá hạn mở đúng dự án. */
  const projectIdOf = new Map(projects.map((row) => [row.projectCode, row.projectId]));

  return (
    <div className={styles.dashboardBody}>
      <div className={styles.statRow}>
        <DashboardCard
          icon={<Briefcase size={18} />}
          tone="info"
          label="Tổng dự án"
          value={String(projects.length)}
          foot={`${activeProjects} đang hoạt động`}
        />
        <DashboardCard
          icon={<ListChecks size={18} />}
          tone="info"
          label="Tổng công việc"
          value={String(totalItems)}
          foot={`${closedItems} đã đóng`}
        />
        <DashboardCard
          icon={<AlertTriangle size={18} />}
          tone="danger"
          label="Công việc quá hạn"
          value={String(overdueItems)}
          foot={overdueItems > 0 ? 'Cần xử lý gấp' : 'Không có việc nào trễ hạn'}
        />
        {bundle.finance ? (
          <DashboardCard
            icon={<DollarSign size={18} />}
            tone="success"
            label="Tổng giá trị hợp đồng"
            value={formatVndCompact(bundle.finance.contractValue)}
            foot={`Lợi nhuận dự kiến ${formatVndCompact(bundle.finance.profit)}`}
            title={formatVnd(bundle.finance.contractValue)}
          />
        ) : (
          <DashboardCard
            icon={<ListChecks size={18} />}
            tone="info"
            label="Việc của tôi đang mở"
            value={String(bundle.mine.openItems)}
            foot={`${bundle.mine.overdueItems} quá hạn`}
          />
        )}
      </div>

      <div className={styles.reportCharts}>
        <section className={styles.panel}>
          <h3>Trạng thái công việc toàn phạm vi</h3>
          <DonutChart slices={statusSlices} unit="công việc" emptyHint="Chưa có công việc nào." />
        </section>
        <section className={styles.panel}>
          <h3>Khối lượng công việc theo dự án</h3>
          <BarChart slices={workloadSlices} emptyHint="Chưa có dự án nào trong phạm vi." />
        </section>
      </div>

      <section className={styles.panel}>
        <h3 className={styles.panelHeadRow}>
          Công việc quá hạn cần chú ý
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Tải lại"
            onClick={() => void refresh()}
          >
            <RefreshCw size={14} />
          </button>
        </h3>
        {bundle.overdue.length === 0 ? (
          <p className={styles.muted}>Không có công việc nào quá hạn.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Mã</th>
                <th>Công việc</th>
                <th>Dự án</th>
                <th>Người phụ trách</th>
                <th>Hạn</th>
                <th>Trễ</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {bundle.overdue.map((row) => (
                <tr key={row.workItemId}>
                  <td className={styles.treeCode}>{row.code}</td>
                  <td>{row.title}</td>
                  <td>
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => {
                        const id = projectIdOf.get(row.projectCode);
                        if (id) onOpenProject(id);
                      }}
                    >
                      {row.projectCode}
                    </button>
                  </td>
                  <td>{directory.nameOf(row.assigneeUserId)}</td>
                  <td>{formatDate(row.plannedEnd)}</td>
                  <td className={styles.cellDanger}>{row.daysLate} ngày</td>
                  <td>{WORK_ITEM_STATUS_LABELS[row.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function DashboardCard(props: {
  icon: React.ReactNode;
  tone: 'info' | 'danger' | 'success';
  label: string;
  value: string;
  foot: string;
  title?: string;
}) {
  return (
    <div className={props.tone === 'danger' ? styles.statDanger : styles.stat} title={props.title}>
      <span className={styles.dashboardIcon} data-tone={props.tone} aria-hidden>
        {props.icon}
      </span>
      <span className={styles.statValue}>{props.value}</span>
      <span className={styles.statLabel}>{props.label}</span>
      <span className={styles.statHint}>{props.foot}</span>
    </div>
  );
}
