'use client';

import type { ProcedureWorkspace } from '@enterprise-platform/contracts-procedure-engine';
import {
  BarChart,
  DonutChart,
  type DashboardCardCatalog,
} from '@enterprise-platform/feature-module-shell';
import styles from './components/procedure-engine.module.scss';

/**
 * Dữ liệu chung cho mọi thẻ.
 *
 * Một object cho tất cả: module nạp một lần rồi mọi thẻ đọc từ đó, nên bật thêm
 * thẻ không sinh thêm request.
 */
export interface ProcedureDashboardData {
  readonly workspace: ProcedureWorkspace;
}

function Metric(props: { value: number | string; alert?: boolean }) {
  return (
    <p className={`${styles.dashValue} ${props.alert ? styles.dashValueAlert : ''}`}>
      <strong>{props.value}</strong>
    </p>
  );
}

/** Hồ sơ đang chờ chính người đang đăng nhập xử lý. */
function actionableInstances(data: ProcedureDashboardData) {
  return data.workspace.instances.filter(
    (instance) =>
      instance.status === 'running' &&
      (instance.authorization?.availableActions ?? []).some((action) => action !== 'comment'),
  );
}

/**
 * Mười thẻ dựng sẵn; admin bật một tập con trong mục Cài đặt.
 *
 * `id` được lưu vào cấu hình của tenant nên không bao giờ đổi tên — chỉ ngừng
 * dùng. Bốn thẻ `defaultEnabled` là những con số một người xử lý hồ sơ cần thấy
 * đầu tiên khi mở module.
 */
export const PROCEDURE_DASHBOARD_CARDS: DashboardCardCatalog<ProcedureDashboardData> = [
  {
    id: 'metric.actionable',
    title: 'Chờ tôi xử lý',
    description: 'Hồ sơ đang chạy mà bạn có quyền thao tác ở bước hiện tại.',
    size: 'sm',
    defaultEnabled: true,
    render: (data) => {
      const count = actionableInstances(data).length;
      return <Metric value={count} alert={count > 0} />;
    },
  },
  {
    id: 'metric.running',
    title: 'Hồ sơ đang chạy',
    description: 'Tổng số hồ sơ chưa kết thúc mà bạn tham gia.',
    size: 'sm',
    defaultEnabled: true,
    render: (data) => (
      <Metric
        value={data.workspace.instances.filter((item) => item.status === 'running').length}
      />
    ),
  },
  {
    id: 'metric.completed',
    title: 'Đã hoàn thành',
    description: 'Hồ sơ đã đóng thành công.',
    size: 'sm',
    defaultEnabled: true,
    render: (data) => (
      <Metric
        value={data.workspace.instances.filter((item) => item.status === 'completed').length}
      />
    ),
  },
  {
    id: 'metric.publishedDefinitions',
    title: 'Quy trình đã công bố',
    description: 'Số quy trình sẵn sàng mở hồ sơ. Chỉ người thiết kế mới thấy con số này.',
    size: 'sm',
    defaultEnabled: true,
    render: (data) => (
      <Metric
        value={data.workspace.definitions.filter((item) => item.status === 'published').length}
      />
    ),
  },
  {
    id: 'metric.draftDefinitions',
    title: 'Quy trình còn nháp',
    description: 'Bản nháp chưa công bố nên chưa mở được hồ sơ.',
    size: 'sm',
    render: (data) => {
      const drafts = data.workspace.definitions.filter((item) => item.status === 'draft').length;
      return <Metric value={drafts} alert={drafts > 0} />;
    },
  },
  {
    id: 'metric.rejected',
    title: 'Hồ sơ bị từ chối',
    description: 'Hồ sơ kết thúc ở trạng thái từ chối.',
    size: 'sm',
    render: (data) => (
      <Metric
        value={data.workspace.instances.filter((item) => item.status === 'rejected').length}
      />
    ),
  },
  {
    id: 'list.actionable',
    title: 'Việc cần làm',
    description: 'Năm hồ sơ đang chờ bạn thao tác, kèm bước hiện tại.',
    size: 'md',
    defaultEnabled: true,
    render: (data) => {
      const rows = actionableInstances(data).slice(0, 5);
      if (rows.length === 0) {
        return <p className={styles.dashEmpty}>Không có hồ sơ nào chờ bạn.</p>;
      }
      return (
        <ul className={styles.dashList}>
          {rows.map((instance) => (
            <li key={instance.id}>
              <span>{instance.title}</span>
              <small>{instance.authorization?.currentRoleStage ?? '—'}</small>
            </li>
          ))}
        </ul>
      );
    },
  },
  {
    id: 'list.recent',
    title: 'Hồ sơ gần đây',
    description: 'Năm hồ sơ mới mở gần nhất.',
    size: 'md',
    render: (data) => {
      const rows = data.workspace.instances.slice(0, 5);
      if (rows.length === 0) return <p className={styles.dashEmpty}>Chưa có hồ sơ nào.</p>;
      return (
        <ul className={styles.dashList}>
          {rows.map((instance) => (
            <li key={instance.id}>
              <span>{instance.title}</span>
              <small>{instance.startedAt.slice(0, 10)}</small>
            </li>
          ))}
        </ul>
      );
    },
  },
  {
    id: 'list.bySource',
    title: 'Hồ sơ theo nguồn mở',
    description: 'Phân bố hồ sơ: mở tay, sinh từ Bảo trì, hay tự mở từ quy trình cha.',
    size: 'md',
    render: (data) => {
      const label: Record<string, string> = {
        manual: 'Mở tay',
        maintenance_occurrence: 'Từ Bảo trì',
        auto_from_parent: 'Từ quy trình cha',
      };
      const counts = new Map<string, number>();
      for (const instance of data.workspace.instances) {
        const key = instance.sourceType ?? 'manual';
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      if (counts.size === 0) return <p className={styles.dashEmpty}>Chưa có hồ sơ nào.</p>;
      return (
        <ul className={styles.dashList}>
          {[...counts.entries()].map(([source, count]) => (
            <li key={source}>
              <span>{label[source] ?? source}</span>
              <small>{count}</small>
            </li>
          ))}
        </ul>
      );
    },
  },
  {
    id: 'chart.status',
    title: 'Hồ sơ theo trạng thái',
    description: 'Biểu đồ tròn: tỉ lệ hồ sơ đang chạy, hoàn thành, từ chối, đã huỷ.',
    size: 'md',
    defaultEnabled: true,
    render: (data) => {
      const label: Record<string, string> = {
        running: 'Đang xử lý',
        completed: 'Hoàn thành',
        rejected: 'Từ chối',
        cancelled: 'Đã huỷ',
      };
      const counts = new Map<string, number>();
      for (const instance of data.workspace.instances) {
        counts.set(instance.status, (counts.get(instance.status) ?? 0) + 1);
      }
      return (
        <DonutChart
          unit="hồ sơ"
          emptyHint="Chưa có hồ sơ nào."
          slices={[...counts.entries()].map(([status, value]) => ({
            label: label[status] ?? status,
            value,
          }))}
        />
      );
    },
  },
  {
    id: 'chart.byDefinition',
    title: 'Hồ sơ theo quy trình',
    description: 'Biểu đồ cột: quy trình nào đang sinh nhiều hồ sơ nhất.',
    size: 'md',
    defaultEnabled: true,
    render: (data) => {
      const counts = new Map<string, number>();
      for (const instance of data.workspace.instances) {
        counts.set(instance.definitionName, (counts.get(instance.definitionName) ?? 0) + 1);
      }
      return (
        <BarChart
          emptyHint="Chưa có hồ sơ nào."
          slices={[...counts.entries()].map(([label, value]) => ({ label, value }))}
        />
      );
    },
  },
  {
    id: 'chart.stage',
    title: 'Hồ sơ đang chờ vai nào',
    description: 'Biểu đồ cột: hồ sơ đang chạy đứng ở giai đoạn S, R, E, C hay A.',
    size: 'md',
    render: (data) => {
      const counts = new Map<string, number>();
      for (const instance of data.workspace.instances) {
        if (instance.status !== 'running') continue;
        const stage = instance.authorization?.currentRoleStage ?? '—';
        counts.set(stage, (counts.get(stage) ?? 0) + 1);
      }
      return (
        <BarChart
          emptyHint="Không có hồ sơ nào đang chạy."
          slices={[...counts.entries()].map(([label, value]) => ({ label: `Vai ${label}`, value }))}
        />
      );
    },
  },
  {
    id: 'notice.tenant',
    title: 'Dữ liệu tenant',
    description: 'Mã tenant đang kết nối; mỗi tenant có database riêng.',
    size: 'md',
    render: (data) => (
      <>
        <p className={styles.dashValue}>
          <strong className={styles.dashMono}>{data.workspace.tenantId}</strong>
        </p>
        <p className={styles.dashEmpty}>Dedicated database boundary</p>
      </>
    ),
  },
];
