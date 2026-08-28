'use client';

import type { Material } from '@enterprise-platform/contracts-inventory';
import {
  BarChart,
  DonutChart,
  type DashboardCardCatalog,
} from '@enterprise-platform/feature-module-shell';
import type { InventoryLedgerRow, InventoryWorkspace } from './inventory-api';
import { formatNumber } from './inventory-labels';
import styles from './inventory.module.scss';

/**
 * Dữ liệu chung cho mọi thẻ.
 *
 * Một object cho tất cả: module nạp một lần rồi mọi thẻ đọc từ đó, nên bật thêm
 * thẻ không sinh thêm request và package module-shell không cần biết gì về API.
 */
export interface InventoryDashboardData {
  readonly workspace: InventoryWorkspace;
  readonly ledger?: readonly InventoryLedgerRow[];
  readonly materialByCode: ReadonlyMap<string, Material>;
}

function Metric(props: { value: number | string; alert?: boolean }) {
  return (
    <p className={`${styles.dashValue} ${props.alert ? styles.dashValueAlert : ''}`}>
      <strong>{props.value}</strong>
    </p>
  );
}

/** Số dòng tồn dưới mức tối thiểu — dùng chung cho hai thẻ nên tách ra một chỗ. */
function lowStockRows(data: InventoryDashboardData) {
  return data.workspace.stock.filter((row) => {
    const material = row.materialCode ? data.materialByCode.get(row.materialCode) : undefined;
    return material ? row.available < material.minStock : false;
  });
}

/**
 * Mười thẻ dựng sẵn; admin bật một tập con trong mục Cài đặt.
 *
 * `id` được lưu vào cấu hình của tenant nên không bao giờ đổi tên — chỉ ngừng
 * dùng. Bốn thẻ `defaultEnabled` đúng bằng dải chỉ số vốn nằm cố định trên tab
 * Tồn kho trước đây, nên tenant chưa vào Cài đặt vẫn thấy đúng con số quen thuộc.
 */
export const INVENTORY_DASHBOARD_CARDS: DashboardCardCatalog<InventoryDashboardData> = [
  {
    id: 'metric.materials',
    title: 'Mã vật tư',
    description: 'Số mã vật tư đang hoạt động.',
    size: 'sm',
    defaultEnabled: true,
    render: (data) => <Metric value={formatNumber(data.workspace.materials.length)} />,
  },
  {
    id: 'metric.available',
    title: 'Tồn khả dụng',
    description: 'Tổng số lượng khả dụng trên mọi kho.',
    size: 'sm',
    defaultEnabled: true,
    render: (data) => (
      <Metric
        value={formatNumber(data.workspace.stock.reduce((sum, row) => sum + row.available, 0))}
      />
    ),
  },
  {
    id: 'metric.lowStock',
    title: 'Dưới mức tối thiểu',
    description: 'Số dòng tồn thấp hơn tồn tối thiểu đã khai báo.',
    size: 'sm',
    defaultEnabled: true,
    render: (data) => {
      const count = lowStockRows(data).length;
      return <Metric value={formatNumber(count)} alert={count > 0} />;
    },
  },
  {
    id: 'metric.warehouses',
    title: 'Kho hoạt động',
    description: 'Số kho đang mở.',
    size: 'sm',
    defaultEnabled: true,
    render: (data) => <Metric value={formatNumber(data.workspace.warehouses.length)} />,
  },
  {
    id: 'metric.assets',
    title: 'Vật tư lắp đặt',
    description: 'Số vật tư lắp đặt chưa thanh lý trong cây.',
    size: 'sm',
    render: (data) => <Metric value={formatNumber(data.workspace.assets.length)} />,
  },
  {
    id: 'metric.assetsWithoutTasks',
    title: 'Vật tư chưa có đầu việc',
    description: 'Vật tư lắp đặt chưa khai đầu việc; phiếu bảo trì sinh ra sẽ rỗng.',
    size: 'sm',
    render: (data) => {
      const missing = data.workspace.assets.filter(
        (asset) => (asset.taskTemplate?.length ?? 0) === 0,
      ).length;
      return <Metric value={formatNumber(missing)} alert={missing > 0} />;
    },
  },
  {
    id: 'list.lowStock',
    title: 'Vật tư cần bổ sung',
    description: 'Năm dòng tồn thấp nhất so với mức tối thiểu.',
    size: 'md',
    render: (data) => {
      const rows = lowStockRows(data).slice(0, 5);
      if (rows.length === 0) {
        return <p className={styles.dashEmpty}>Không có vật tư nào dưới mức tối thiểu.</p>;
      }
      return (
        <ul className={styles.dashList}>
          {rows.map((row) => (
            <li key={`${row.warehouseCode}-${row.materialCode}`}>
              <span>
                {row.materialCode} · {row.warehouseCode}
              </span>
              <small>{formatNumber(row.available)}</small>
            </li>
          ))}
        </ul>
      );
    },
  },
  {
    id: 'list.recentLedger',
    title: 'Phát sinh gần đây',
    description: 'Năm bút toán nhập/xuất mới nhất.',
    size: 'md',
    render: (data) => {
      const rows = (data.ledger ?? []).slice(0, 5);
      if (rows.length === 0) return <p className={styles.dashEmpty}>Chưa có phát sinh nào.</p>;
      return (
        <ul className={styles.dashList}>
          {rows.map((row) => (
            <li key={row.id}>
              <span>
                {row.type} · {row.transactionCode}
              </span>
              <small>{formatNumber(row.quantity)}</small>
            </li>
          ))}
        </ul>
      );
    },
  },
  {
    id: 'list.warehouses',
    title: 'Tồn theo kho',
    description: 'Số dòng tồn đang có ở từng kho.',
    size: 'md',
    render: (data) => {
      const counts = new Map<string, number>();
      for (const row of data.workspace.stock) {
        if (!row.warehouseCode) continue;
        counts.set(row.warehouseCode, (counts.get(row.warehouseCode) ?? 0) + 1);
      }
      if (counts.size === 0) return <p className={styles.dashEmpty}>Chưa có dòng tồn nào.</p>;
      return (
        <ul className={styles.dashList}>
          {[...counts.entries()].map(([code, count]) => (
            <li key={code}>
              <span>{code}</span>
              <small>{formatNumber(count)}</small>
            </li>
          ))}
        </ul>
      );
    },
  },
  {
    id: 'metric.stockValue',
    title: 'Tổng giá trị kho',
    description: 'Tồn khả dụng × giá nhập, cộng mọi mã đã khai giá.',
    size: 'sm',
    defaultEnabled: true,
    render: (data) => {
      /**
       * Chỉ cộng những mã ĐÃ KHAI giá. Coi mã chưa khai là 0 sẽ cho ra một con
       * số trông như thật nhưng thiếu hụt, và không ai biết thiếu bao nhiêu —
       * nên hiện luôn số mã chưa khai bên dưới.
       */
      let total = 0;
      let priced = 0;
      let unpriced = 0;
      const seen = new Set<string>();
      for (const row of data.workspace.stock) {
        if (!row.materialCode) continue;
        const material = data.materialByCode.get(row.materialCode);
        const price = material?.purchasePrice;
        if (price === undefined) {
          if (!seen.has(row.materialCode)) {
            seen.add(row.materialCode);
            unpriced += 1;
          }
          continue;
        }
        if (!seen.has(row.materialCode)) {
          seen.add(row.materialCode);
          priced += 1;
        }
        total += price * row.available;
      }
      const money = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
      return (
        <>
          <Metric value={money.format(total)} />
          <p className={styles.dashEmpty}>
            {priced} mã đã khai giá
            {unpriced > 0 ? ` · ${unpriced} mã chưa khai` : ''}
          </p>
        </>
      );
    },
  },
  {
    id: 'chart.stockByWarehouse',
    title: 'Tồn theo kho',
    description: 'Biểu đồ tròn: tỉ trọng tồn khả dụng của từng kho.',
    size: 'md',
    defaultEnabled: true,
    render: (data) => {
      const byWarehouse = new Map<string, number>();
      for (const row of data.workspace.stock) {
        const key = row.warehouseCode ?? '—';
        byWarehouse.set(key, (byWarehouse.get(key) ?? 0) + row.available);
      }
      return (
        <DonutChart
          unit="đơn vị tồn"
          emptyHint="Chưa có tồn kho nào."
          slices={[...byWarehouse.entries()].map(([label, value]) => ({ label, value }))}
        />
      );
    },
  },
  {
    id: 'chart.topStock',
    title: 'Vật tư tồn nhiều nhất',
    description: 'Biểu đồ cột: sáu mã có tồn khả dụng lớn nhất.',
    size: 'md',
    defaultEnabled: true,
    render: (data) => {
      const byMaterial = new Map<string, number>();
      for (const row of data.workspace.stock) {
        if (!row.materialCode) continue;
        const name = data.materialByCode.get(row.materialCode)?.name ?? row.materialCode;
        byMaterial.set(name, (byMaterial.get(name) ?? 0) + row.available);
      }
      return (
        <BarChart
          emptyHint="Chưa có tồn kho nào."
          slices={[...byMaterial.entries()].map(([label, value]) => ({ label, value }))}
        />
      );
    },
  },
  {
    id: 'chart.movementTypes',
    title: 'Giao dịch theo loại',
    description: 'Biểu đồ cột: nhập, xuất, chuyển kho, điều chỉnh trong nhật ký gần đây.',
    size: 'md',
    render: (data) => {
      const label: Record<string, string> = {
        IMPORT: 'Nhập kho',
        EXPORT: 'Xuất kho',
        TRANSFER_IN: 'Chuyển đến',
        TRANSFER_OUT: 'Chuyển đi',
        BORROW: 'Mượn',
        RETURN: 'Trả',
        ADJUST: 'Điều chỉnh',
      };
      const counts = new Map<string, number>();
      for (const entry of data.ledger ?? []) {
        const key = label[entry.type] ?? entry.type;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return (
        <BarChart
          emptyHint="Nhật ký chưa có giao dịch nào."
          slices={[...counts.entries()].map(([label2, value]) => ({ label: label2, value }))}
        />
      );
    },
  },
  {
    id: 'list.categories',
    title: 'Vật tư theo nhóm',
    description: 'Phân bố mã vật tư theo nhóm phân loại.',
    size: 'md',
    render: (data) => {
      const counts = new Map<string, number>();
      for (const material of data.workspace.materials) {
        counts.set(material.category, (counts.get(material.category) ?? 0) + 1);
      }
      return (
        <ul className={styles.dashList}>
          {[...counts.entries()].map(([category, count]) => (
            <li key={category}>
              <span>{category}</span>
              <small>{formatNumber(count)}</small>
            </li>
          ))}
        </ul>
      );
    },
  },
];
