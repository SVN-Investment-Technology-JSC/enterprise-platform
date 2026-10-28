'use client';

import {
  DASHBOARD_ATTENTION_KINDS,
  DASHBOARD_ATTENTION_LABELS,
  DASHBOARD_PERIODS,
  DASHBOARD_PERIOD_LABELS,
  type CrmCapabilities,
  type DashboardAttentionKind,
  type DashboardAttentionList,
  type DashboardPeriod,
  type SalesDashboard,
} from '@enterprise-platform/contracts-crm';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { errorMessage, loadDashboard } from '../crm-api';
import type { CrmView } from '../crm-nav.model';
import { PipelineBars, RevenueTrendChart } from './dashboard-charts';
import {
  ATTENTION_EMPTY,
  ATTENTION_VIEWS,
  SCOPE_TEXT,
  canOpenReports,
  dashboardCards,
  dashboardQuery,
  formatCount,
  formatDay,
  formatVndCompact,
  type DashboardCard,
} from './dashboard.model';
import styles from './dashboard.module.scss';

export interface CrmDashboardProps {
  readonly capabilities: CrmCapabilities;
  readonly navigate: (view: CrmView, sub?: string) => void;
}

/**
 * Tổng quan Bán hàng: thẻ chỉ số so với kỳ trước, xu hướng doanh thu và đơn mới, cơ hội theo giai đoạn, khách hàng
 * và sản phẩm doanh thu cao nhất, các việc cần chú ý. Mọi con số do server lọc theo phạm vi dữ liệu của người xem.
 */
export function CrmDashboard({ capabilities, navigate }: CrmDashboardProps) {
  const [period, setPeriod] = useState<DashboardPeriod>('month');
  const [custom, setCustom] = useState<{ from?: string; to?: string }>({});
  const [dashboard, setDashboard] = useState<SalesDashboard>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const query = useMemo(() => dashboardQuery(period, custom), [period, custom]);

  const reload = useCallback(async () => {
    if (!query) return;
    setLoading(true);
    try {
      setDashboard(await loadDashboard(query));
      setError(undefined);
    } catch (cause) {
      setError(errorMessage(cause, 'Không tải được số liệu Tổng quan.'));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const cards = dashboard ? dashboardCards(dashboard, capabilities) : [];
  const salesView: CrmView = canOpenReports(capabilities) ? 'reports' : 'orders';

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.period} role="group" aria-label="Kỳ số liệu">
          {DASHBOARD_PERIODS.map((entry) => (
            <button
              key={entry}
              type="button"
              aria-pressed={period === entry}
              className={period === entry ? styles.periodActive : undefined}
              onClick={() => {
                // Chuyển sang "Tuỳ chọn" thì bắt đầu từ kỳ đang xem, khỏi phải chọn lại cả hai ngày.
                if (entry === 'custom' && dashboard && !custom.from) setCustom(dashboard.range);
                setPeriod(entry);
              }}
            >
              {DASHBOARD_PERIOD_LABELS[entry]}
            </button>
          ))}
        </div>
        {period === 'custom' ? (
          <>
            <label className={styles.dateField}>
              Từ
              <span>
                <DatePickerInput
                  height={32}
                  aria-label="Từ ngày"
                  value={custom.from}
                  onChange={(from) => setCustom((value) => ({ ...value, from: from || undefined }))}
                />
              </span>
            </label>
            <label className={styles.dateField}>
              Đến
              <span>
                <DatePickerInput
                  height={32}
                  aria-label="Đến ngày"
                  value={custom.to}
                  onChange={(to) => setCustom((value) => ({ ...value, to: to || undefined }))}
                />
              </span>
            </label>
          </>
        ) : dashboard ? (
          <span className={styles.muted}>
            {formatDay(dashboard.range.from)} – {formatDay(dashboard.range.to)}
          </span>
        ) : null}
        <span className={styles.spacer} />
        {loading ? <span className={styles.muted}>Đang tải…</span> : null}
        <button type="button" className={styles.iconButton} aria-label="Tải lại" title="Tải lại" onClick={() => void reload()}>
          <RefreshCw size={15} />
        </button>
      </div>

      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}
      {period === 'custom' && !query ? <p className={styles.muted}>Chọn đủ từ ngày và đến ngày để xem số liệu.</p> : null}

      {dashboard ? (
        <>
          <p className={styles.scopeLine}>
            {SCOPE_TEXT[dashboard.scope]} · so với kỳ trước {formatDay(dashboard.previous.from)} –{' '}
            {formatDay(dashboard.previous.to)} · công nợ, cơ hội, việc cần chú ý tính tại {formatDay(dashboard.asOf)}
          </p>

          <div className={styles.kpiGrid}>
            {cards.map((card) => (
              <KpiCard key={card.key} card={card} onOpen={() => navigate(card.view)} />
            ))}
          </div>

          <div className={styles.grid}>
            <Panel title="Doanh thu và đơn bán mới" note={`Theo ${GRANULARITY_TEXT[dashboard.trend.granularity]}`}>
              {dashboard.kpis.revenue.value || dashboard.kpis.newOrders.value ? (
                <RevenueTrendChart trend={dashboard.trend} onPick={() => navigate(salesView)} />
              ) : (
                <p className={styles.empty}>Chưa có doanh thu hay đơn bán mới trong kỳ.</p>
              )}
            </Panel>
            <Panel title="Cơ hội đang mở theo giai đoạn" note="Bấm để mở Cơ hội">
              {dashboard.kpis.pipeline.count ? (
                <>
                  <PipelineBars rows={dashboard.pipeline} onPick={() => navigate('opportunities')} />
                  <div className={styles.pipelineTotal}>
                    <span>
                      {formatCount(dashboard.kpis.pipeline.count)} cơ hội · theo xác suất{' '}
                      <strong>{formatVndCompact(dashboard.kpis.pipeline.weightedValue)}</strong>
                    </span>
                    <strong>{formatVndCompact(dashboard.kpis.pipeline.value)}</strong>
                  </div>
                </>
              ) : (
                <p className={styles.empty}>Chưa có cơ hội đang mở.</p>
              )}
            </Panel>
          </div>

          <div className={styles.gridEven}>
            <Panel title="Khách hàng doanh thu cao nhất" note="Trong kỳ">
              {dashboard.topCustomers.length ? (
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Khách hàng</th>
                        <th className={styles.num}>Doanh thu</th>
                        <th className={styles.num}>Lợi nhuận</th>
                        <th className={styles.num}>Số đơn</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.topCustomers.map((row, index) => (
                        <tr key={row.customerId}>
                          <td className={styles.rank}>{index + 1}</td>
                          <td>
                            <span className={styles.nameCell}>
                              <button type="button" className={styles.linkButton} onClick={() => navigate('customers', row.customerId)}>
                                {row.name}
                              </button>
                              <small>{row.code}</small>
                            </span>
                          </td>
                          <td className={styles.num}>{formatVndCompact(row.revenue)}</td>
                          <td className={`${styles.num} ${row.profit < 0 ? styles.negative : ''}`}>{formatVndCompact(row.profit)}</td>
                          <td className={styles.num}>{formatCount(row.orderCount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={styles.empty}>Chưa có doanh thu trong kỳ.</p>
              )}
            </Panel>
            <Panel title="Sản phẩm doanh thu cao nhất" note="Trong kỳ">
              {dashboard.topProducts.length ? (
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Sản phẩm</th>
                        <th className={styles.num}>Sản lượng</th>
                        <th className={styles.num}>Doanh thu</th>
                        <th className={styles.num}>Lợi nhuận</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.topProducts.map((row, index) => (
                        <tr key={row.materialId}>
                          <td className={styles.rank}>{index + 1}</td>
                          <td>
                            <span className={styles.nameCell}>
                              <span>{row.name}</span>
                              <small>{row.code}</small>
                            </span>
                          </td>
                          <td className={styles.num}>{formatCount(row.quantity)}</td>
                          <td className={styles.num}>{formatVndCompact(row.revenue)}</td>
                          <td className={`${styles.num} ${row.profit < 0 ? styles.negative : ''}`}>{formatVndCompact(row.profit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={styles.empty}>Chưa có doanh thu trong kỳ.</p>
              )}
            </Panel>
          </div>

          <h2 className={styles.sectionTitle}>Cần chú ý</h2>
          <div className={styles.attentionGrid}>
            {DASHBOARD_ATTENTION_KINDS.map((kind) => (
              <AttentionPanel
                key={kind}
                kind={kind}
                title={
                  kind === 'expiringContracts'
                    ? `${DASHBOARD_ATTENTION_LABELS[kind]} (${dashboard.contractExpiringDays} ngày)`
                    : DASHBOARD_ATTENTION_LABELS[kind]
                }
                list={dashboard.attention[kind]}
                navigate={navigate}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

const GRANULARITY_TEXT = { day: 'ngày', week: 'tuần', month: 'tháng' } as const;

function Panel({ title, note, children }: { title: ReactNode; note?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.panel}>
      <h3>
        {title}
        {note ? <span className={styles.panelNote}>{note}</span> : null}
      </h3>
      {children}
    </section>
  );
}

/** Thẻ chỉ số: giá trị, so với kỳ trước (xanh khi tốt, đỏ khi xấu), dòng phụ. Bấm thẻ để mở trang liên quan. */
function KpiCard({ card, onOpen }: { card: DashboardCard; onOpen: () => void }) {
  const tone = card.delta?.tone === 'good' ? styles.deltaGood : card.delta?.tone === 'bad' ? styles.deltaBad : styles.deltaFlat;
  return (
    <button
      type="button"
      className={`${styles.kpiCard} ${card.danger ? styles.kpiCardDanger : ''}`}
      onClick={onOpen}
      title={card.title}
    >
      <span className={styles.kpiLabel}>{card.label}</span>
      <span className={styles.kpiValue}>{card.value}</span>
      {card.delta ? <span className={tone}>{card.delta.text}</span> : null}
      {card.hint ? <span className={styles.kpiHint}>{card.hint}</span> : null}
    </button>
  );
}

/** Một danh sách "Cần chú ý": tối đa 5 mục, mỗi mục mở chi tiết; còn nữa thì có nút mở cả danh sách. */
function AttentionPanel({
  kind,
  title,
  list,
  navigate,
}: {
  kind: DashboardAttentionKind;
  title: string;
  list: DashboardAttentionList;
  navigate: (view: CrmView, sub?: string) => void;
}) {
  const view = ATTENTION_VIEWS[kind];
  const open = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    // Bấm thường thì chuyển trang trong phân hệ; Ctrl/Cmd + bấm vẫn mở tab mới theo `href`.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(view, id);
  };
  return (
    <Panel title={title} note={<span className={`${styles.count} ${list.total ? '' : styles.countZero}`}>{formatCount(list.total)}</span>}>
      {list.items.length ? (
        <>
          <ul className={styles.attentionList}>
            {list.items.map((item) => (
              <li key={item.id}>
                <a href={item.deepLink} onClick={(event) => open(event, item.id)}>
                  <span className={styles.attentionTitle}>{item.title}</span>
                  <span className={styles.attentionAmount}>{item.amount === null ? '' : formatVndCompact(item.amount)}</span>
                  <span className={styles.attentionSub}>{item.subtitle}</span>
                  <span className={styles.attentionNote}>{item.note}</span>
                </a>
              </li>
            ))}
          </ul>
          {list.total > list.items.length ? (
            <button type="button" className={styles.moreLink} onClick={() => navigate(view)}>
              Xem tất cả {formatCount(list.total)} mục
            </button>
          ) : null}
        </>
      ) : (
        <p className={styles.empty}>{ATTENTION_EMPTY[kind]}</p>
      )}
    </Panel>
  );
}
