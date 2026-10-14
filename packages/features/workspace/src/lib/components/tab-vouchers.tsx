'use client';

import { authFetch } from '@enterprise-platform/shared-ui';
import { ExternalLink } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { formatVnd, formatVndCompact } from '../money';
import {
  NO_VOUCHER_FILTER,
  PROJECT_VOUCHER_KIND_LABELS,
  PROJECT_VOUCHER_LINK_LABELS,
  PROJECT_VOUCHER_STATUS_LABELS,
  PROJECT_VOUCHER_STATUS_TONE,
  classifyProjectVoucherResponse,
  filterProjectVouchers,
  projectVoucherHref,
  projectVoucherNet,
  type ProjectVoucherFilter,
  type ProjectVoucherResult,
} from '../project-vouchers.model';
import styles from '../workspace.module.scss';
import { Choice } from './choice';

/** `2026-10-09` → `09/10/2026`; đọc thẳng chuỗi, không qua Date (lệch múi giờ). */
function formatDay(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : '—';
}

function Stat({ label, value, danger, hint }: { label: string; value: number; danger?: boolean; hint?: string }) {
  return (
    <div className={danger ? styles.statDanger : styles.stat} title={hint ?? formatVnd(value)}>
      <span className={styles.statValue}>{formatVndCompact(value)}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

/**
 * Tab "Thu chi" của dự án.
 *
 * Phiếu thu/chi do module Tài chính sở hữu; tab chỉ đọc qua API của Tài chính bằng phiên của người dùng. Tài chính hỏi lại
 * Workspace người này có được xem tài chính dự án không, nên tab chỉ hiện với người đã thấy tab Tài chính của dự án. Tổng tiền chỉ tính
 * phiếu HẠCH TOÁN cho dự án (kể cả công việc thuộc dự án); phiếu "liên quan" chỉ để tra cứu và không cộng vào tổng.
 */
export function TabVouchers({ projectId }: { readonly projectId: string }) {
  const [result, setResult] = useState<ProjectVoucherResult>();
  const [filter, setFilter] = useState<ProjectVoucherFilter>(NO_VOUCHER_FILTER);

  useEffect(() => {
    let alive = true;
    setResult(undefined);
    setFilter(NO_VOUCHER_FILTER);
    authFetch(`/api/finance/v1/projects/${encodeURIComponent(projectId)}/vouchers`, { cache: 'no-store' })
      .then(classifyProjectVoucherResponse)
      .then((next) => {
        if (alive) setResult(next);
      })
      .catch(() => {
        if (alive) setResult({ state: 'unavailable', message: 'Không kết nối được module Tài chính.' });
      });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const data = result?.state === 'ok' ? result.data : undefined;
  const visible = useMemo(() => (data ? filterProjectVouchers(data.items, filter) : []), [data, filter]);
  const filtering = filter.kind !== 'all' || filter.link !== 'all' || filter.status !== 'all';

  if (!result) return <p className={styles.muted}>Đang tải thu chi của dự án…</p>;
  if (!data)
    return (
      <div className={styles.tabBody}>
        <p className={styles.muted} role="status">
          {result.message}
        </p>
      </div>
    );

  const { totals } = data;
  return (
    <div className={styles.tabBody}>
      <div className={styles.statRow}>
        <Stat label="Đã thu" value={totals.received} hint={`${formatVnd(totals.received)} (${totals.receiptCount} phiếu thu hạch toán)`} />
        <Stat label="Đã chi" value={totals.paid} hint={`${formatVnd(totals.paid)} (${totals.paymentCount} phiếu chi hạch toán)`} />
        <Stat label="Chênh lệch thu - chi" value={projectVoucherNet(totals)} danger={projectVoucherNet(totals) < 0} />
        <Stat label="Chờ thu (chưa ghi sổ)" value={totals.pendingReceived} />
        <Stat label="Chờ chi (chưa ghi sổ)" value={totals.pendingPaid} />
      </div>
      <p className={styles.muted}>
        Chỉ tính phiếu hạch toán cho dự án hoặc công việc của dự án. Phiếu chờ duyệt chưa ghi sổ nên chưa cộng vào Đã thu / Đã chi.
        Phiếu có dự án này ở mục "Đối tượng liên quan" hiện bên dưới nhưng không cộng vào tổng.
      </p>

      <div className={styles.panel}>
        <div className={styles.workFilters}>
          <div className={styles.filterField}>
            <span className={styles.filterLabel}>Loại phiếu</span>
            <Choice
              label="Lọc theo loại phiếu"
              value={filter.kind}
              options={[
                { value: 'all', label: 'Tất cả' },
                { value: 'RECEIPT', label: PROJECT_VOUCHER_KIND_LABELS.RECEIPT },
                { value: 'PAYMENT', label: PROJECT_VOUCHER_KIND_LABELS.PAYMENT },
              ]}
              onChange={(value) => setFilter((current) => ({ ...current, kind: value as ProjectVoucherFilter['kind'] }))}
            />
          </div>
          <div className={styles.filterField}>
            <span className={styles.filterLabel}>Quan hệ với dự án</span>
            <Choice
              label="Lọc theo quan hệ với dự án"
              value={filter.link}
              options={[
                { value: 'all', label: 'Tất cả' },
                { value: 'ALLOCATION', label: PROJECT_VOUCHER_LINK_LABELS.ALLOCATION },
                { value: 'RELATED', label: PROJECT_VOUCHER_LINK_LABELS.RELATED },
              ]}
              onChange={(value) => setFilter((current) => ({ ...current, link: value as ProjectVoucherFilter['link'] }))}
            />
          </div>
          <div className={styles.filterField}>
            <span className={styles.filterLabel}>Trạng thái</span>
            <Choice
              label="Lọc theo trạng thái phiếu"
              value={filter.status}
              options={[
                { value: 'all', label: 'Tất cả' },
                { value: 'APPROVED', label: PROJECT_VOUCHER_STATUS_LABELS.APPROVED },
                { value: 'PENDING', label: PROJECT_VOUCHER_STATUS_LABELS.PENDING },
              ]}
              onChange={(value) => setFilter((current) => ({ ...current, status: value as ProjectVoucherFilter['status'] }))}
            />
          </div>
          {filtering ? (
            <button type="button" className={styles.linkButton} onClick={() => setFilter(NO_VOUCHER_FILTER)}>
              Bỏ lọc
            </button>
          ) : null}
        </div>
      </div>

      <div className={styles.tableCard}>
        <div className={styles.tableScroll}>
          <table className={`${styles.table} ${styles.wbsTable}`}>
            <thead>
              <tr>
                <th>Phiếu</th>
                <th>Ngày</th>
                <th>Nội dung</th>
                <th>Hạch toán</th>
                <th style={{ textAlign: 'right' }}>Số tiền</th>
                <th>Trạng thái</th>
                <th>Người lập</th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 ? (
                <tr>
                  <td colSpan={7} className={styles.muted}>
                    Dự án chưa có phiếu thu chi nào. Phiếu hạch toán cho dự án này ở module Tài chính sẽ hiện ở đây.
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={7} className={styles.muted}>
                    Không có phiếu nào khớp bộ lọc.
                  </td>
                </tr>
              ) : null}
              {visible.map((item) => {
                const tone = PROJECT_VOUCHER_STATUS_TONE[item.status];
                const sign = item.kind === 'PAYMENT' ? '-' : '';
                return (
                  <tr key={item.id}>
                    <td>
                      <a className={styles.wbsProcedure} href={projectVoucherHref(item)} title="Mở phiếu ở module Tài chính">
                        <ExternalLink size={12} aria-hidden />
                        {item.code}
                      </a>
                      <span className={styles.muted} style={{ display: 'block' }}>
                        {PROJECT_VOUCHER_KIND_LABELS[item.kind]}
                      </span>
                    </td>
                    <td>{formatDay(item.voucherDate)}</td>
                    <td>
                      <span className={styles.treeTitle} title={item.content}>
                        {item.content}
                      </span>
                      {item.reasonName ? (
                        <span className={styles.muted} style={{ display: 'block' }}>
                          {item.reasonName}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {item.link === 'RELATED' ? (
                        <span className={styles.muted}>Chỉ liên quan</span>
                      ) : item.workItem ? (
                        <span title={item.workItem.title}>
                          <span className={styles.treeCode}>{item.workItem.code}</span> {item.workItem.title}
                        </span>
                      ) : (
                        'Cả dự án'
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {item.link === 'RELATED' ? <span className={styles.muted}>{sign}{formatVnd(item.totalAmount)}</span> : `${sign}${formatVnd(item.totalAmount)}`}
                    </td>
                    <td>
                      <span className={styles.pill} style={{ background: tone.bg, color: tone.fg }}>
                        {PROJECT_VOUCHER_STATUS_LABELS[item.status]}
                      </span>
                    </td>
                    <td>{item.createdByName ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {data.truncated ? (
        <p className={styles.muted}>Chỉ hiển thị 200 phiếu gần nhất; tổng tiền ở trên vẫn tính đủ mọi phiếu hạch toán.</p>
      ) : null}
    </div>
  );
}
