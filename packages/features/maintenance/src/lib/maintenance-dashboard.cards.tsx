'use client';

import {
  resolveDashboardCards,
  type DashboardCardCatalog,
  type DashboardCardSize,
} from '@enterprise-platform/feature-module-shell';
import type { MaintenanceMatrix, MaintenanceWorkspace } from '@enterprise-platform/contracts-maintenance';
import { formatDate } from '@enterprise-platform/shared-ui';
import { Card } from './ui/card';
import { cn } from './utils';

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
    <p className="m-0 flex items-baseline gap-2">
      <strong
        className={cn(
          'text-[1.7rem] font-bold leading-none tracking-tight tabular-nums',
          props.alert ? 'text-red-700' : 'text-slate-900',
        )}
      >
        {props.value}
      </strong>
      {props.hint ? <span className="text-sm text-slate-500">{props.hint}</span> : null}
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
      if (rows.length === 0) return <p className="m-0 text-sm text-slate-500">Chưa có phiếu nào.</p>;
      return (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {rows.map((occurrence) => (
            <li key={occurrence.id} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-sm">{occurrence.title}</span>
              <small className="flex-none text-[0.8125rem] text-slate-500 tabular-nums">{formatDate(occurrence.dueAt.slice(0, 10))}</small>
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
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {['High', 'Normal', 'Low'].map((priority) => (
            <li key={priority} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-sm">{label[priority]}</span>
              <small className="flex-none text-[0.8125rem] text-slate-500 tabular-nums">{counts.get(priority) ?? 0}</small>
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
          <p className="m-0 text-sm leading-normal text-amber-700">
            Không đọc được danh mục thiết bị từ Kho. Số đầu việc hiển thị có thể không đúng.
          </p>
        );
      }
      return <p className="m-0 text-sm text-slate-500">Đang đọc được danh mục thiết bị từ Kho.</p>;
    },
  },
];

const CARD_SPAN: Readonly<Record<DashboardCardSize, string>> = {
  sm: '',
  md: 'sm:col-span-2',
  lg: 'sm:col-span-2 md:col-span-3',
  xl: 'col-span-full',
};

/**
 * Lưới thẻ tổng quan: 2 cột trên màn nhỏ, 3 cột trung bình, 5 cột từ 1280px để năm thẻ KPI mặc định nằm
 * trọn một hàng. Cùng luật chọn thẻ với `DashboardView` của module-shell (`resolveDashboardCards`).
 */
export function MaintenanceDashboardGrid(props: {
  selection: readonly string[];
  data: MaintenanceDashboardData;
}) {
  const cards = resolveDashboardCards(MAINTENANCE_DASHBOARD_CARDS, props.selection);
  if (cards.length === 0) {
    return (
      <p className="m-0 text-sm text-slate-500">
        Chưa có thẻ nào được bật. Chọn thẻ trong mục Cài đặt.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
      {cards.map((card) => (
        <Card key={card.id} className={cn('gap-2', CARD_SPAN[card.size])}>
          <h2 className="m-0 text-[0.8125rem] font-bold uppercase tracking-wide text-slate-500">
            {card.title}
          </h2>
          {card.render(props.data)}
        </Card>
      ))}
    </div>
  );
}
