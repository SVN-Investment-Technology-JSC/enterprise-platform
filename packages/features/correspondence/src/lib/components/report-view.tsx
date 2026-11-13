'use client';

import type { CorrespondenceReport, CorrespondenceReportRow } from '@enterprise-platform/contracts-correspondence';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { useEffect, useState } from 'react';
import { errorMessage, loadReport } from '../correspondence-api';
import styles from '../correspondence.module.scss';

/** Báo cáo văn thư theo năm: tổng số, theo tháng, theo loại văn bản, theo phòng ban. */
export function ReportView({ refreshKey }: { readonly refreshKey: number }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [report, setReport] = useState<CorrespondenceReport>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    setReport(undefined);
    loadReport(year)
      .then((next) => {
        if (!active) return;
        setReport(next);
        setError(undefined);
      })
      .catch((cause) => active && setError(errorMessage(cause, 'Không tải được báo cáo.')));
    return () => {
      active = false;
    };
  }, [year, refreshKey]);

  const years = Array.from({ length: 6 }, (_, index) => thisYear - index);
  const max = Math.max(1, ...(report?.byMonth ?? []).map((row) => row.incoming + row.outgoing));
  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div style={{ width: 160 }}>
          <SearchableSelect
            options={years.map((value) => ({ value: String(value), label: `Năm ${value}` }))}
            value={String(year)}
            searchInDropdown
            hideDropdownSearch
            onChange={(value) => setYear(Number(value) || thisYear)}
          />
        </div>
      </div>
      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}
      {report ? (
        <>
          <div className={styles.stats}>
            {[
              { label: 'Công văn đến', value: report.totals.incoming },
              { label: 'Công văn đi', value: report.totals.outgoing },
              { label: 'Đã hoàn tất, lưu trữ', value: report.totals.completed, tone: 'stat-success' },
              { label: 'Đang xử lý', value: report.totals.open },
              { label: 'Trễ hạn', value: report.totals.late, tone: 'stat-danger' },
            ].map((stat) => (
              <div key={stat.label} className={`${styles.stat} ${stat.tone ? styles[stat.tone] : ''}`}>
                <b>{stat.value}</b>
                <span>{stat.label}</span>
              </div>
            ))}
          </div>
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h2>Theo tháng</h2>
              <span className={styles.legend}>
                <i className={styles.legendIncoming} /> Đến <i className={styles.legendOutgoing} /> Đi
              </span>
            </div>
            <div className={styles.bars} role="img" aria-label={`Số công văn đến và đi theo tháng năm ${report.year}`}>
              {report.byMonth.map((row, index) => (
                <div key={row.label} className={styles.barColumn} title={`${row.label}: ${row.incoming} đến, ${row.outgoing} đi`}>
                  <div className={styles.barStack}>
                    <span className={styles.barOutgoing} style={{ height: `${(row.outgoing / max) * 100}%` }} />
                    <span className={styles.barIncoming} style={{ height: `${(row.incoming / max) * 100}%` }} />
                  </div>
                  <small>T{index + 1}</small>
                </div>
              ))}
            </div>
          </section>
          <ReportTable title="Theo loại văn bản" rows={report.byType} />
          <ReportTable title="Theo phòng ban" rows={report.byUnit} />
        </>
      ) : error ? null : (
        <div className={styles.empty}>Đang tải báo cáo…</div>
      )}
    </div>
  );
}

function ReportTable({ title, rows }: { readonly title: string; readonly rows: readonly CorrespondenceReportRow[] }) {
  return (
    <section className={styles.card}>
      <h2>{title}</h2>
      <div className={styles.tableWrap}>
        <table className={styles.table} style={{ minWidth: 520 }}>
          <thead>
            <tr>
              <th>{title.replace('Theo ', '').replace(/^./, (char) => char.toUpperCase())}</th>
              <th className={styles.numeric}>Đến</th>
              <th className={styles.numeric}>Đi</th>
              <th className={styles.numeric}>Đã xong</th>
              <th className={styles.numeric}>Trễ hạn</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} style={{ cursor: 'default' }}>
                <td>{row.label}</td>
                <td className={styles.numeric}>{row.incoming}</td>
                <td className={styles.numeric}>{row.outgoing}</td>
                <td className={styles.numeric}>{row.completed}</td>
                <td className={`${styles.numeric} ${row.late > 0 ? styles.lateCell : ''}`}>{row.late}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <div className={styles.empty}>Chưa có số liệu.</div> : null}
      </div>
    </section>
  );
}
