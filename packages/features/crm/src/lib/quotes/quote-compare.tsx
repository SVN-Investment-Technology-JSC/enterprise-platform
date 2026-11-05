'use client';

import {
  QUOTE_STATUS_LABELS,
  type QuoteComparison,
  type QuoteDetail,
  type QuoteLineDifference,
} from '@enterprise-platform/contracts-crm';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { StatusPill } from '../components/crm-ui';
import { compareQuote, errorMessage } from '../crm-api';
import { formatPercent } from '../pricing/pricing.model';
import { formatMoney } from '../sales.model';
import styles from '../sales.module.scss';
import { signed } from './quote.model';

const CHANGE_LABELS: Readonly<Record<QuoteLineDifference['change'], string>> = {
  ADDED: 'Thêm',
  REMOVED: 'Bỏ',
  CHANGED: 'Đổi',
};
const CHANGE_TONE: Readonly<Record<QuoteLineDifference['change'], 'success' | 'danger' | 'warning'>> = {
  ADDED: 'success',
  REMOVED: 'danger',
  CHANGED: 'warning',
};

type Side = QuoteLineDifference['from'];

/** Một ô "trước → sau", tô đậm khi trường đó đổi. */
function cell(row: QuoteLineDifference, field: keyof NonNullable<Side>, format: (value: number) => string) {
  const before = row.from?.[field];
  const after = row.to?.[field];
  const changed = row.change !== 'CHANGED' || row.fields.includes(field);
  const text =
    row.change === 'ADDED'
      ? format(after ?? 0)
      : row.change === 'REMOVED'
        ? format(before ?? 0)
        : changed
          ? `${format(before ?? 0)} → ${format(after ?? 0)}`
          : format(after ?? 0);
  return changed ? <strong>{text}</strong> : <span className={styles.muted}>{text}</span>;
}

/**
 * So sánh hai phiên bản báo giá (T3-16, TC-QUO-07): chọn hai phiên bản, tô các
 * dòng khác nhau (thêm, bỏ, đổi số lượng, đơn giá, chiết khấu...) và chênh
 * lệch tổng. Khác biệt do server tính (`GET /quotes/:id/compare`).
 */
export function QuoteCompare({ detail }: { detail: QuoteDetail }) {
  const versions = [...detail.versions].sort((left, right) => left.versionNo - right.versionNo);
  const [from, setFrom] = useState(String(versions[Math.max(0, versions.length - 2)]?.versionNo ?? 1));
  const [to, setTo] = useState(String(detail.currentVersion));
  const [result, setResult] = useState<QuoteComparison>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!from || !to || from === to) {
      setResult(undefined);
      return;
    }
    let active = true;
    compareQuote(detail.id, Number(from), Number(to))
      .then((value) => {
        if (!active) return;
        setResult(value);
        setError(undefined);
      })
      .catch((cause) => active && setError(errorMessage(cause, 'Không so sánh được hai phiên bản.')));
    return () => {
      active = false;
    };
  }, [detail.id, from, to]);

  const options = versions.map((entry) => ({
    value: String(entry.versionNo),
    label: `Phiên bản ${entry.versionNo}`,
    description: QUOTE_STATUS_LABELS[entry.status],
  }));
  const quantity = (value: number) => value.toLocaleString('vi-VN', { maximumFractionDigits: 3 });
  const columns: ColumnsType<QuoteLineDifference> = [
    {
      title: 'Thay đổi',
      dataIndex: 'change',
      width: 90,
      render: (value: QuoteLineDifference['change']) => <StatusPill tone={CHANGE_TONE[value]}>{CHANGE_LABELS[value]}</StatusPill>,
    },
    {
      title: 'Mặt hàng',
      key: 'material',
      render: (_: unknown, row) => (
        <span>
          <span className={styles.mono}>{row.materialCode}</span> {row.materialName} ({row.unit})
        </span>
      ),
    },
    { title: 'Số lượng', key: 'quantity', width: 150, align: 'right', render: (_: unknown, row) => cell(row, 'quantity', quantity) },
    { title: 'Đơn giá sau CK', key: 'unitPrice', width: 200, align: 'right', render: (_: unknown, row) => cell(row, 'unitPrice', formatMoney) },
    { title: 'Chiết khấu', key: 'discount', width: 140, align: 'right', render: (_: unknown, row) => cell(row, 'discountPercent', formatPercent) },
    { title: 'Thành tiền', key: 'amount', width: 200, align: 'right', render: (_: unknown, row) => cell(row, 'lineAmount', formatMoney) },
  ];

  return (
    <section className={styles.tableCard} aria-label="So sánh phiên bản">
      <div className={styles.toolbar}>
        <h3 className={styles.sectionTitle}>So sánh phiên bản</h3>
        <SearchableSelect className={styles.filter} options={options} value={from} onChange={setFrom} />
        <span className={styles.muted}>với</span>
        <SearchableSelect className={styles.filter} options={options} value={to} onChange={setTo} />
      </div>
      {error ? <p className={styles.alert}>{error}</p> : null}
      {from === to ? <p className={styles.muted}>Chọn hai phiên bản khác nhau.</p> : null}
      {result ? (
        <>
          <Table<QuoteLineDifference>
            size="small"
            rowKey={(row) => `${row.materialId}|${row.unit}|${row.change}`}
            columns={columns}
            dataSource={[...result.lines]}
            pagination={false}
            scroll={{ x: 1000 }}
            locale={{ emptyText: 'Hai phiên bản có cùng dòng hàng.' }}
          />
          <dl className={styles.facts}>
            <dt>Chênh lệch tiền hàng sau CK</dt>
            <dd>{signed(result.totalsDelta.netAmount, formatMoney)}</dd>
            <dt>Chênh lệch VAT</dt>
            <dd>{signed(result.totalsDelta.vatAmount, formatMoney)}</dd>
            <dt>Chênh lệch tổng cộng</dt>
            <dd>
              <strong>{signed(result.totalsDelta.totalAmount, formatMoney)}</strong>
            </dd>
            <dt>Chênh lệch lợi nhuận ước tính</dt>
            <dd>{signed(result.totalsDelta.profit, formatMoney)}</dd>
          </dl>
        </>
      ) : null}
    </section>
  );
}
