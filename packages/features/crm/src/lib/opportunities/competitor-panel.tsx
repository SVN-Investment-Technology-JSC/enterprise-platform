'use client';

import type { OpportunityDetail } from '@enterprise-platform/contracts-crm';
import { useState } from 'react';
import { COMPETITOR_NAME_MAX, parseCompetitorInput } from '../care-notes.model';
import { CrmDialog, Field } from '../components/crm-ui';
import { errorMessage, updateOpportunity } from '../crm-api';
import { formatMoney } from '../sales.model';
import styles from '../sales.module.scss';
import { digitsOnly } from './estimate.model';

/** Khối "Đối thủ" trong ngăn chi tiết dự án: tên đối thủ và giá đối thủ chào (P2F-03). */
export function CompetitorPanel({
  opportunity,
  canEdit,
  onSaved,
}: {
  opportunity: OpportunityDetail;
  canEdit: boolean;
  onSaved: (saved: OpportunityDetail) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  function open() {
    setName(opportunity.competitorName ?? '');
    setPrice(opportunity.competitorPrice?.toString() ?? '');
    setError(undefined);
    setEditing(true);
  }

  async function submit() {
    const parsed = parseCompetitorInput({ name, price });
    if (!parsed.ok) return setError(parsed.message);
    setSubmitting(true);
    setError(undefined);
    try {
      const saved = await updateOpportunity(opportunity.id, {
        name: opportunity.name,
        version: opportunity.version,
        competitorName: parsed.name,
        competitorPrice: parsed.price,
      });
      onSaved(saved);
      setEditing(false);
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được thông tin đối thủ.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <h4 className={styles.sectionTitle}>Đối thủ</h4>
      <dl className={styles.facts}>
        <dt>Đối thủ cạnh tranh</dt>
        <dd>{opportunity.competitorName ?? 'Chưa nhập'}</dd>
        <dt>Giá đối thủ</dt>
        <dd>{formatMoney(opportunity.competitorPrice) || 'Chưa nhập'}</dd>
      </dl>
      {canEdit ? (
        <div className={styles.toolbar}>
          <button type="button" className={styles.buttonGhost} onClick={open}>
            Sửa thông tin đối thủ
          </button>
        </div>
      ) : null}
      <CrmDialog open={editing} title="Đối thủ của dự án" submitting={submitting} error={error} onClose={() => setEditing(false)} onSubmit={submit}>
        <Field label="Tên đối thủ">
          <input className={styles.input} maxLength={COMPETITOR_NAME_MAX} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Giá đối thủ chào (đồng)">
          <input className={styles.input} inputMode="numeric" value={price} onChange={(event) => setPrice(digitsOnly(event.target.value))} />
        </Field>
      </CrmDialog>
    </>
  );
}
