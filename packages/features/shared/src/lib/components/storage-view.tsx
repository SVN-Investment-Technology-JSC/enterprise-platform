'use client';

import {
  BYTES_PER_GB,
  formatBytes,
  STORAGE_ADD_ON_STEP_GB,
  STORAGE_PLAN_QUOTAS_GB,
  type StorageUsage,
} from '@enterprise-platform/contracts-shared';
import styles from '../shared.module.scss';

const PLAN_LABELS: Readonly<Record<string, string>> = {
  standard: 'Gói Tiêu Chuẩn',
  enterprise: 'Gói Doanh Nghiệp',
};

export function meterTone(usage: StorageUsage): 'normal' | 'warn' | 'over' {
  if (usage.usedBytes >= usage.quotaBytes) return 'over';
  return usage.usedPercent >= usage.warnPercent ? 'warn' : 'normal';
}

/** Dung lượng tệp của cả tenant: một hạn mức chung cho mọi phân hệ. */
export function StorageView({ usage }: { readonly usage?: StorageUsage }) {
  if (!usage) return <p className={styles.muted}>Đang tải…</p>;
  const tone = meterTone(usage);
  const planLabel =
    usage.source === 'plan' ? (PLAN_LABELS[usage.planKey ?? ''] ?? usage.planKey ?? 'Theo gói') : 'Mức mặc định';
  const width = Math.min(100, usage.usedPercent);

  return (
    <div className={styles.storage}>
      <section className={`${styles.panel} ${styles.storageCard}`} aria-label="Dung lượng đã dùng">
        <div className={styles.sectionTitle}>
          <h3>Dung lượng tệp</h3>
          <span className={`${styles.badge} ${tone === 'over' ? styles.badgeDanger : tone === 'warn' ? styles.badgeWarn : styles.badgeSuccess}`}>
            {usage.usedPercent.toLocaleString('vi-VN')}%
          </span>
        </div>
        <div className={styles.storageFigure}>
          <strong>{formatBytes(usage.usedBytes)}</strong>
          <span>/ {formatBytes(usage.quotaBytes)}</span>
        </div>
        <div className={styles.meter} data-tone={tone} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={width} aria-label="Đã dùng">
          <span style={{ width: `${width}%` }} />
        </div>
        <dl className={styles.facts}>
          <div>
            <dt>Hạn mức</dt>
            <dd>{planLabel}</dd>
          </div>
          <div>
            <dt>Mua thêm</dt>
            <dd>{usage.addOnBytes ? formatBytes(usage.addOnBytes) : '—'}</dd>
          </div>
          <div>
            <dt>Khi vượt</dt>
            <dd>{usage.enforcement === 'hard' ? 'Chặn tải lên' : 'Chỉ cảnh báo'}</dd>
          </div>
          <div>
            <dt>Cảnh báo từ</dt>
            <dd>{usage.warnPercent}%</dd>
          </div>
        </dl>
      </section>

      <section className={`${styles.panel} ${styles.storageCard}`} aria-label="Theo phân hệ">
        <div className={styles.sectionTitle}>
          <h3>Theo phân hệ</h3>
        </div>
        <table className={styles.storageTable}>
          <thead>
            <tr>
              <th>Phân hệ</th>
              <th className={styles.number}>Tệp</th>
              <th className={styles.number}>Dung lượng</th>
              <th className={styles.number}>Tỷ lệ</th>
            </tr>
          </thead>
          <tbody>
            {usage.byModule.map((item) => (
              <tr key={`${item.moduleKey}-${item.label}`}>
                <td>{item.label}</td>
                <td className={styles.number}>{item.files.toLocaleString('vi-VN')}</td>
                <td className={styles.number}>{formatBytes(item.bytes)}</td>
                <td className={styles.number}>
                  {usage.usedBytes
                    ? `${((item.bytes / usage.usedBytes) * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={`${styles.panel} ${styles.storageCard}`} aria-label="Dung lượng theo gói">
        <div className={styles.sectionTitle}>
          <h3>Dung lượng theo gói</h3>
        </div>
        <table className={styles.storageTable}>
          <tbody>
            {Object.entries(STORAGE_PLAN_QUOTAS_GB).map(([key, gb]) => (
              <tr key={key}>
                <td>
                  {PLAN_LABELS[key] ?? key}
                  {usage.planKey === key ? (
                    <>
                      {' '}
                      <span className={`${styles.badge} ${styles.badgeInfo}`}>Đang dùng</span>
                    </>
                  ) : null}
                </td>
                <td className={styles.number}>{formatBytes(gb * BYTES_PER_GB)}</td>
              </tr>
            ))}
            <tr>
              <td>Gói mua thêm</td>
              <td className={styles.number}>{STORAGE_ADD_ON_STEP_GB} GB / gói</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}
