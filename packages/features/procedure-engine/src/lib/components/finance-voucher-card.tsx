'use client';

import type { ProcedureInstanceStep } from '@enterprise-platform/contracts-procedure-engine';
import { PROCEDURE_FINANCE_VOUCHER_KIND_LABELS } from '@enterprise-platform/contracts-procedure-engine';
import { ExternalLink, Landmark } from 'lucide-react';
import { financeVoucherCard, financeVoucherHref } from './rcsi/finance-step';
import styles from './finance-voucher-card.module.scss';

/**
 * Thẻ phiếu trên bước Tài chính của hồ sơ. Phiếu sống ở module Tài chính; ở đây
 * chỉ hiện tiến trình mà Tài chính đã báo về và lối mở phiếu bên đó.
 */
export function FinanceVoucherCard({ step }: { step: ProcedureInstanceStep }) {
  const integration = step.integration;
  if (integration?.module !== 'finance') return null;
  const voucher = step.financeVoucher;
  const kindLabel = PROCEDURE_FINANCE_VOUCHER_KIND_LABELS[integration.voucherKind];
  const card = voucher ? financeVoucherCard(voucher) : { title: 'Chưa tới bước này', tone: 'waiting' as const };
  const href = voucher?.voucherId ? financeVoucherHref(integration.voucherKind, voucher.voucherId) : undefined;

  return (
    <div className={`${styles.card} ${styles[card.tone]}`}>
      <Landmark size={16} aria-hidden="true" className={styles.icon} />
      <div className={styles.body}>
        <span className={styles.kind}>Bước Tài chính · {kindLabel}</span>
        <strong className={styles.title}>{card.title}</strong>
        {card.detail ? <span className={styles.detail}>{card.detail}</span> : null}
      </div>
      {href ? (
        <a className={styles.open} href={href} title="Mở phiếu ở module Tài chính">
          <ExternalLink size={14} aria-hidden="true" />
          Mở phiếu
        </a>
      ) : null}
    </div>
  );
}
