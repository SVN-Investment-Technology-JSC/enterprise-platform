'use client';

import { BUSINESS_PLAN_STATUS_LABELS, type OpportunityDetail } from '@enterprise-platform/contracts-crm';
import { useState } from 'react';
import { CrmDialog, Field } from '../components/crm-ui';
import { errorMessage, updateOpportunity } from '../crm-api';
import { formatMoney } from '../sales.model';
import styles from '../sales.module.scss';
import { digitsOnly, parseEstimateInput, summarizeEstimate, compareEstimateWithPlan, planFiguresOf } from './estimate.model';

/**
 * Khối "Dự toán" trong ngăn chi tiết dự án: tổng giá trị dự toán và giá vốn dự kiến. File dự toán đính ở khối
 * "Tài liệu" bên dưới bằng loại tài liệu "Dự toán" (mã ESTIMATE). `plan` là số liệu PAKD khi đã có để đối chiếu.
 */
export function EstimatePanel({
  opportunity,
  canEdit,
  onSaved,
}: {
  opportunity: OpportunityDetail;
  canEdit: boolean;
  onSaved: (saved: OpportunityDetail) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [total, setTotal] = useState('');
  const [cost, setCost] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const summary = summarizeEstimate(opportunity.estimateTotalValue, opportunity.estimateCostValue);
  const businessPlan = opportunity.latestBusinessPlan ?? null;
  const comparison = compareEstimateWithPlan(opportunity.estimateTotalValue, opportunity.estimateCostValue, planFiguresOf(businessPlan));

  function open() {
    setTotal(opportunity.estimateTotalValue?.toString() ?? '');
    setCost(opportunity.estimateCostValue?.toString() ?? '');
    setError(undefined);
    setEditing(true);
  }

  async function submit() {
    const parsed = parseEstimateInput({ total, cost });
    if (!parsed.ok) return setError(parsed.message);
    setSubmitting(true);
    setError(undefined);
    try {
      const saved = await updateOpportunity(opportunity.id, {
        name: opportunity.name,
        version: opportunity.version,
        estimateTotalValue: parsed.total,
        estimateCostValue: parsed.cost,
      });
      onSaved(saved);
      setEditing(false);
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được dự toán.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <h4 className={styles.sectionTitle}>Dự toán</h4>
      <dl className={styles.facts}>
        <dt>Tổng giá trị dự toán</dt>
        <dd>{formatMoney(opportunity.estimateTotalValue) || 'Chưa nhập'}</dd>
        <dt>Giá vốn dự kiến</dt>
        <dd>{formatMoney(opportunity.estimateCostValue) || 'Chưa nhập'}</dd>
        {summary ? (
          <>
            <dt>Lợi nhuận dự kiến</dt>
            <dd>
              {formatMoney(summary.profit)}
              {summary.marginPercent === null ? '' : ` (${summary.marginPercent}%)`}
            </dd>
          </>
        ) : null}
      </dl>
      {businessPlan ? (
        <dl className={styles.facts}>
          <dt>PAKD đối chiếu</dt>
          <dd>
            {businessPlan.quoteCode} · phiên bản {businessPlan.versionNo} · {BUSINESS_PLAN_STATUS_LABELS[businessPlan.status]}
          </dd>
          <dt>Doanh thu theo PAKD</dt>
          <dd>{formatMoney(businessPlan.revenue)}</dd>
          {businessPlan.costVisible && businessPlan.totalCost !== null ? (
            <>
              <dt>Tổng chi phí theo PAKD</dt>
              <dd>{formatMoney(businessPlan.totalCost)}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      <p className={styles.muted}>{comparison.message}</p>
      {comparison.status === 'DIFFERENT' ? (
        <p className={styles.alert}>
          {comparison.totalDelta !== null ? `Tổng giá trị lệch ${formatMoney(comparison.totalDelta)}. ` : ''}
          {comparison.costDelta !== null ? `Giá vốn lệch ${formatMoney(comparison.costDelta)}.` : ''}
        </p>
      ) : null}
      <p className={styles.muted}>
        Để đính file dự toán, tải lên ở khối Tài liệu bên dưới và chọn loại tài liệu &quot;Dự toán&quot;.
      </p>
      {canEdit ? (
        <div className={styles.toolbar}>
          <button type="button" className={styles.buttonGhost} onClick={open}>
            Sửa dự toán
          </button>
        </div>
      ) : null}
      <CrmDialog open={editing} title="Dự toán của dự án" submitting={submitting} error={error} onClose={() => setEditing(false)} onSubmit={submit}>
        <Field label="Tổng giá trị dự toán (đồng)">
          <input className={styles.input} inputMode="numeric" value={total} onChange={(event) => setTotal(digitsOnly(event.target.value))} />
        </Field>
        <Field label="Giá vốn dự kiến của dự toán (đồng)">
          <input className={styles.input} inputMode="numeric" value={cost} onChange={(event) => setCost(digitsOnly(event.target.value))} />
        </Field>
      </CrmDialog>
    </>
  );
}
