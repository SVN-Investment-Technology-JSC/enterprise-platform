'use client';

import type { DashboardCardCatalog } from '@enterprise-platform/feature-module-shell';
import type { MaintenanceMatrix, MaintenanceWorkspace } from '@enterprise-platform/contracts-maintenance';
import styles from './maintenance.module.scss';

/**
 * Dữ liệu chung cho mọi thẻ.
 *
 * Một object cho tất cả, cố ý: module nạp một lần rồi mọi thẻ đọc từ đó, nhờ vậy
 * package module-shell không chứa dòng gọi mạng nào và bật thêm thẻ không sinh
 * thêm request.
 */
export interface MaintenanceDashboardData {
  readonly workspace: MaintenanceWorkspace;
  readonly matrix?: MaintenanceMatrix;
}

function Metric(props: { value: number | string; hint?: string; alert?: boolean }) {
  return (
    <p className={`${styles.dashValue} ${props.alert ? styles.dashValueAlert : ''}`}>
      <strong>{props.value}</strong>
      {props.hint ? <span>{props.hint}</span> : null}
    </p>
  );
}

/**
 * Mười thẻ dựng sẵn; admin bật năm cái trong mục Cài đặt.
 *
 * `id` được lưu vào cấu hình của tenant nên không bao giờ đổi tên — chỉ ngừng
 * dùng. Năm thẻ đầu là năm KPI vốn nằm cố định trên đầu màn hình trước đây, nên
 * `defaultEnabled` giữ nguyên bố cục cũ cho tenant chưa vào cài đặt lần nào.
 */
export const MAINTENANCE_DASHBOARD_CARDS: DashboardCardCatalog<MaintenanceDashboardData> = [
  {
    id: 'metric.activeSchedules',
    title: 'Lịch đang chạy',
    description: 'Số lịch bảo trì ở trạng thái hoạt động.',
    size: 'sm',
    defaultEnabled: true,
    render: (data) => <Metric value={data.workspace.metrics.activeSchedules} />,
  },
  {
    id: 'metric.upcoming',
    title: 'Sắp đến hạn',
    description: 'Phiếu sẽ phát sinh trong kỳ tới.',
    size: 'sm',
    defaultEnabled: true,
    render: (data) => <Metric value={data.workspace.metrics.upcomingOccurrences} />,
  },
  {
    id: 'metric.generated',
    title: 'Đã sinh phiếu',
    description: 'Tổng số phiếu scheduler đã tạo.',
    size: 'sm',
    defaultEnabled: true,
    render: (data) => <Metric value={data.workspace.metrics.generatedOccurrences} />,
  },
  {
    id: 'metric.completed',
    title: 'Đã hoàn thành',
    description: 'Số phiếu đã đóng.',
    size: 'sm',
    defaultEnabled: true,
    render: (data) => <Metric value={data.workspace.metrics.completedOccurrences} />,
  },
  {
    id: 'metric.openIncidents',
    title: 'Sự cố đang xử lý',
    description: 'Sự cố chưa đóng; đổi màu khi lớn hơn 0.',
    size: 'sm',
    defaultEnabled: true,
    render: (data) => (
      <Metric
        value={data.workspace.metrics.openIncidents}
        alert={data.workspace.metrics.openIncidents > 0}
      />
    ),
  },
  {
    id: 'metric.assets',
    title: 'Thiết bị trong ma trận',
    description: 'Số thiết bị đang có mặt trên ma trận bảo trì.',
    size: 'sm',
    render: (data) => <Metric value={data.matrix?.rows.length ?? 0} />,
  },
  {
    id: 'metric.assetsWithoutTasks',
    title: 'Thiết bị chưa có đầu việc',
    description: 'Thiết bị chưa khai báo đầu việc bên Kho — phiếu sinh ra sẽ rỗng.',
    size: 'sm',
    render: (data) => {
      const rows = data.matrix?.rows ?? [];
      const missing = rows.filter((row) => row.asset.taskCount === 0).length;
      return <Metric value={missing} alert={missing > 0} />;
    },
  },
  {
    id: 'list.upcomingOccurrences',
    title: 'Phiếu sắp tới',
    description: 'Năm phiếu gần nhất theo ngày đến hạn.',
    size: 'md',
    render: (data) => {
      const rows = [...data.workspace.occurrences]
        .sort((left, right) => left.dueAt.localeCompare(right.dueAt))
        .slice(0, 5);
      if (rows.length === 0) return <p className={styles.dashEmpty}>Chưa có phiếu nào.</p>;
      return (
        <ul className={styles.dashList}>
          {rows.map((occurrence) => (
            <li key={occurrence.id}>
              <span>{occurrence.title}</span>
              <small>{occurrence.dueAt.slice(0, 10)}</small>
            </li>
          ))}
        </ul>
      );
    },
  },
  {
    id: 'list.priority',
    title: 'Lịch theo mức ưu tiên',
    description: 'Phân bố lịch bảo trì theo Cao / Thường / Thấp.',
    size: 'md',
    render: (data) => {
      const counts = new Map<string, number>();
      for (const schedule of data.workspace.schedules) {
        counts.set(schedule.priority, (counts.get(schedule.priority) ?? 0) + 1);
      }
      const label: Record<string, string> = { High: 'Cao', Normal: 'Thường', Low: 'Thấp' };
      return (
        <ul className={styles.dashList}>
          {['High', 'Normal', 'Low'].map((priority) => (
            <li key={priority}>
              <span>{label[priority]}</span>
              <small>{counts.get(priority) ?? 0}</small>
            </li>
          ))}
        </ul>
      );
    },
  },
  {
    id: 'notice.assetDirectory',
    title: 'Kết nối Kho',
    description: 'Cảnh báo khi không đọc được danh mục thiết bị từ module Kho.',
    size: 'md',
    render: (data) => {
      if (data.matrix?.assetDirectoryAvailable === false) {
        return (
          <p className={styles.dashAlert}>
            Không đọc được danh mục thiết bị từ Kho. Số đầu việc hiển thị có thể không đúng.
          </p>
        );
      }
      return <p className={styles.dashEmpty}>Đang đọc được danh mục thiết bị từ Kho.</p>;
    },
  },
];
