'use client';

import type { ProjectSummary, ReportBundle } from '@enterprise-platform/contracts-workspace';
import { BarChart, DonutChart } from '@enterprise-platform/feature-module-shell';
import { Download, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatPercent, formatVnd, formatVndCompact } from '../money';
import { ExportTooLargeError, buildCsv, exportFileName } from '../report-export';
import * as api from '../workspace-api';
import {
  PROJECT_STATUS_LABELS,
  WORK_ITEM_STATUS_LABELS,
  formatDate,
  formatDateTime,
} from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { useDirectory } from './use-directory';

const SCOPE_LABELS: Record<ReportBundle['scope']['level'], string> = {
  self: 'Số liệu của riêng bạn',
  managed: 'Các dự án bạn phụ trách',
  tenant: 'Toàn bộ tenant',
};

/**
 * Trang Báo cáo.
 *
 * Phạm vi do server quyết định theo vai trò; giao diện chỉ hiển thị lại nó
 * để người đọc biết con số đang nói về ai. Bộ lọc dự án chỉ **thu hẹp** phạm
 * vi đó — chọn một dự án không tham gia sẽ nhận `403` từ server.
 */
export function ReportsView() {
  const directory = useDirectory();
  const [bundle, setBundle] = useState<ReportBundle>();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setBundle(
        await api.loadReports({
          // Ô ngày trống nghĩa là để server dùng mặc định — tuần hiện tại,
          // cắt theo múi giờ tenant.
          from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
          to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
          projectIds: projectId ? [projectId] : undefined,
        }),
      );
      setError(undefined);
    } catch (cause) {
      setBundle(undefined);
      setError((cause as { message?: string })?.message ?? 'Không tải được báo cáo.');
    } finally {
      setLoading(false);
    }
  }, [from, to, projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Danh sách dự án cho ô lọc: server chỉ trả dự án người dùng thấy được, nên
  // ô lọc không bao giờ mời chọn một dự án sẽ nhận `403`. Hỏng thì ẩn ô lọc.
  useEffect(() => {
    api
      .listProjects({ pageSize: 60 })
      .then((page) => setProjects(page.items))
      .catch(() => setProjects([]));
  }, []);

  const exportCsv = () => {
    if (!bundle) return;
    setNotice(undefined);
    setError(undefined);
    try {
      // Tệp sinh hoàn toàn ở trình duyệt: không có endpoint xuất file nào,
      // và dữ liệu cần xuất đã nằm sẵn trên màn hình.
      const blob = new Blob(['﻿', buildCsv(bundle, directory.nameOf)], {
        type: 'text/csv;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = exportFileName(bundle);
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice(`Đã xuất ${exportFileName(bundle)}.`);
    } catch (cause) {
      setError(
        cause instanceof ExportTooLargeError
          ? cause.message
          : 'Không xuất được tệp báo cáo.',
      );
    }
  };

  /**
   * Donut chia công việc thành ba phần, cộng dồn từ chính bảng bên dưới.
   *
   * Không vẽ donut theo `progressPercent` của từng dự án: cộng các tỉ lệ
   * phần trăm lại với nhau không ra con số có nghĩa, và người đọc sẽ không
   * đối chiếu được với bảng nào.
   */
  const progressSlices = useMemo(() => {
    const rows = bundle?.projectProgress ?? [];
    const closed = rows.reduce((sum, row) => sum + row.closedItems, 0);
    const overdue = rows.reduce((sum, row) => sum + row.overdueItems, 0);
    const total = rows.reduce((sum, row) => sum + row.totalItems, 0);
    return [
      { label: 'Đã đóng', value: closed },
      { label: 'Đang mở đúng hạn', value: Math.max(total - closed - overdue, 0) },
      { label: 'Quá hạn', value: overdue },
    ];
  }, [bundle]);

  const workloadSlices = useMemo(
    () =>
      (bundle?.workload ?? []).map((row) => ({
        label: directory.nameOf(row.userId),
        value: row.openItems,
      })),
    [bundle, directory],
  );

  return (
    <div className={styles.tabBody}>
      <div className={styles.filterBar}>
        {projects.length > 0 ? (
          <Choice
            label="Lọc theo dự án"
            value={projectId}
            emptyOption="Tất cả dự án trong phạm vi"
            options={projects.map((project) => ({
              value: project.id,
              label: `${project.code} · ${project.name}`,
            }))}
            onChange={setProjectId}
          />
        ) : null}
        <label className={styles.checkbox}>
          Từ ngày
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className={styles.checkbox}>
          Đến ngày
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Tải lại"
          onClick={() => void reload()}
        >
          <RefreshCw size={15} />
        </button>
        <button
          type="button"
          className={styles.buttonGhost}
          disabled={!bundle}
          onClick={exportCsv}
        >
          <Download size={14} /> Xuất CSV
        </button>
        <span className={styles.muted}>
          {bundle ? `${SCOPE_LABELS[bundle.scope.level]} · ${bundle.scope.projectCount} dự án` : ''}
        </span>
        {loading ? <span className={styles.muted}>Đang tải…</span> : null}
      </div>

      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      ) : null}

      <section className={styles.panel}>
        <h3>Của tôi</h3>
        <div className={styles.statRow}>
          <Stat label="Việc đang mở" value={bundle?.mine.openItems} />
          <Stat label="Quá hạn" value={bundle?.mine.overdueItems} danger />
          <Stat label="Hoàn thành trong kỳ" value={bundle?.mine.completedInPeriod} />
        </div>
        {bundle ? (
          <p className={styles.muted}>
            Kỳ báo cáo {formatDate(bundle.from.slice(0, 10))} – {formatDate(bundle.to.slice(0, 10))}{' '}
            · múi giờ {bundle.timezone} · số liệu lúc {formatDateTime(bundle.generatedAt)}
          </p>
        ) : null}
      </section>

      {/* Chỉ có khi server gửi kèm — mức `self` không nhận khối này, và
          server cũng không hề truy vấn số tiền cho họ. */}
      {bundle?.finance ? (
        <section className={styles.panel}>
          <h3>Tài chính các dự án trong phạm vi</h3>
          <div className={styles.statRow}>
            <MoneyStat label="Tổng giá trị hợp đồng" value={bundle.finance.contractValue} />
            <MoneyStat label="Tổng ngân sách" value={bundle.finance.budget} />
            <MoneyStat label="Tổng chi phí thực tế" value={bundle.finance.actualCost} />
            <MoneyStat label="Tổng chi phí dự kiến" value={bundle.finance.forecastCost} />
            <MoneyStat
              label="Tổng lợi nhuận dự kiến"
              value={bundle.finance.profit}
              danger={bundle.finance.profit < 0}
            />
            <div className={styles.stat}>
              <span className={styles.statValue}>{formatPercent(bundle.finance.profitMargin)}</span>
              <span className={styles.statLabel}>Biên lợi nhuận bình quân</span>
            </div>
          </div>
          <p className={styles.muted}>
            {bundle.finance.projectCount} dự án. Biên bình quân tính có trọng số theo giá trị hợp
            đồng — tổng lợi nhuận chia tổng hợp đồng — không phải trung bình cộng các tỉ lệ. Dự án
            chưa nhập hợp đồng vẫn góp chi phí nhưng không góp lợi nhuận.
          </p>
        </section>
      ) : null}

      <div className={styles.reportCharts}>
        <section className={styles.panel}>
          <h3>Phân bổ công việc</h3>
          <DonutChart
            slices={progressSlices}
            unit="công việc"
            emptyHint="Chưa có công việc nào trong phạm vi."
          />
        </section>
        <section className={styles.panel}>
          <h3>Tải công việc</h3>
          <BarChart
            slices={workloadSlices}
            emptyHint="Không có việc nào đang mở trong phạm vi."
          />
        </section>
      </div>

      <section className={styles.panel}>
        <h3>Tiến độ dự án</h3>
        {bundle?.projectProgress.length ? (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Mã</th>
                <th>Dự án</th>
                <th>Trạng thái</th>
                <th>Tiến độ</th>
                <th>Việc</th>
                <th>Quá hạn</th>
                <th>Kỳ hạn</th>
              </tr>
            </thead>
            <tbody>
              {bundle.projectProgress.map((row) => (
                <tr key={row.projectId}>
                  <td className={styles.treeCode}>{row.projectCode}</td>
                  <td>{row.projectName}</td>
                  <td>{PROJECT_STATUS_LABELS[row.status]}</td>
                  <td>
                    <div className={styles.progressTrack} aria-label={`${row.progressPercent}%`}>
                      <div
                        className={styles.progressFill}
                        style={{ width: `${row.progressPercent}%` }}
                      />
                    </div>
                  </td>
                  <td>
                    {row.closedItems}/{row.totalItems}
                  </td>
                  <td className={row.overdueItems > 0 ? styles.cellDanger : undefined}>
                    {row.overdueItems}
                  </td>
                  <td className={styles.muted}>
                    {formatDate(row.startDate) || '…'} → {formatDate(row.endDate) || '…'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className={styles.muted}>Chưa có dự án nào trong phạm vi.</p>
        )}
      </section>

      <section className={styles.panel}>
        <h3>Tải công việc</h3>
        {bundle?.workload.length ? (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Người phụ trách</th>
                <th>Đang mở</th>
                <th>Quá hạn</th>
                <th>Đến hạn trong tuần</th>
                <th>Giờ ước lượng</th>
              </tr>
            </thead>
            <tbody>
              {bundle.workload.map((row) => (
                <tr key={row.userId}>
                  <td>{directory.nameOf(row.userId)}</td>
                  <td>{row.openItems}</td>
                  <td className={row.overdueItems > 0 ? styles.cellDanger : undefined}>
                    {row.overdueItems}
                  </td>
                  <td>{row.dueThisWeek}</td>
                  <td>{row.estimatedHours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className={styles.muted}>Không có việc nào đang mở trong phạm vi.</p>
        )}
      </section>

      <section className={styles.panel}>
        <h3>Công việc quá hạn</h3>
        {bundle?.overdue.length ? (
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
                  <td className={styles.muted}>{row.projectCode}</td>
                  <td>{directory.nameOf(row.assigneeUserId)}</td>
                  <td>{formatDate(row.plannedEnd)}</td>
                  <td className={styles.cellDanger}>{row.daysLate} ngày</td>
                  <td>{WORK_ITEM_STATUS_LABELS[row.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className={styles.muted}>Không có công việc nào quá hạn. </p>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value?: number; danger?: boolean }) {
  return (
    <div className={danger && value ? styles.statDanger : styles.stat}>
      <span className={styles.statValue}>{value ?? '—'}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

function MoneyStat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className={danger ? styles.statDanger : styles.stat} title={formatVnd(value)}>
      <span className={styles.statValue}>{formatVndCompact(value)}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}
