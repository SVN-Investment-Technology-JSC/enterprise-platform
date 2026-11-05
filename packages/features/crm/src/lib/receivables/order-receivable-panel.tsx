'use client';

import { CREDIT_REQUEST_STATUS_LABELS, type SalesOrderDetail } from '@enterprise-platform/contracts-crm';
import { useState } from 'react';
import { CrmDialog, Field, StatusPill } from '../components/crm-ui';
import { decideOrderCredit } from '../crm-api';
import { useCrm } from '../crm-context';
import { formatMoney, personName } from '../sales.model';
import styles from '../sales.module.scss';
import { canApproveReceivable } from './receivables.model';

/**
 * Công nợ của đơn trên chi tiết đơn (T5-11): đã ghi nợ, đã thu, điều chỉnh, còn
 * phải thu theo sổ; yêu cầu duyệt vượt hạn mức (D5) và nút duyệt, từ chối khi
 * duyệt trực tiếp trong Bán hàng.
 */
export function OrderReceivablePanel({
  detail,
  busy,
  run,
  onOpenReceivables,
}: {
  detail: SalesOrderDetail;
  busy: boolean;
  run: (work: () => Promise<SalesOrderDetail>, success?: string) => Promise<boolean>;
  onOpenReceivables?: (customerId: string) => void;
}) {
  const { capabilities, people } = useCrm();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const balance = detail.receivable;
  const credit = detail.creditRequest;
  const pending = credit?.status === 'PENDING' && detail.status === 'CREDIT_PENDING';
  const canDecide = pending && credit?.mode === 'DIRECT' && canApproveReceivable(capabilities);

  return (
    <>
      {balance && (balance.debited || balance.collected || balance.adjusted) ? (
        <dl className={styles.facts} aria-label="Công nợ của đơn">
          <dt>Đã ghi nợ</dt>
          <dd>{formatMoney(balance.debited)}</dd>
          <dt>Đã thu (đã ghi sổ)</dt>
          <dd>{formatMoney(balance.collected)}</dd>
          {balance.adjusted ? (
            <>
              <dt>Điều chỉnh, đảo</dt>
              <dd>{formatMoney(balance.adjusted)}</dd>
            </>
          ) : null}
          <dt>Còn phải thu</dt>
          <dd>
            <strong className={balance.outstanding > 0 ? styles.overdue : undefined}>{formatMoney(balance.outstanding)}</strong>
            {onOpenReceivables ? (
              <>
                {' · '}
                <button type="button" className={styles.linkButton} onClick={() => onOpenReceivables(detail.customerId)}>
                  Sổ công nợ khách
                </button>
              </>
            ) : null}
          </dd>
        </dl>
      ) : null}
      {credit ? (
        <div className={styles.warning} role="status">
          <span className={styles.cellWithPill}>
            <strong>Duyệt vượt hạn mức công nợ</strong>
            <StatusPill tone={credit.status === 'PENDING' ? 'warning' : credit.status === 'APPROVED' ? 'success' : 'neutral'}>
              {CREDIT_REQUEST_STATUS_LABELS[credit.status]}
            </StatusPill>
          </span>
          <p className={styles.muted}>
            {credit.message ??
              `Dư nợ ${formatMoney(credit.balance)} cộng giá trị đơn ${formatMoney(credit.orderAmount)} vượt hạn mức ${formatMoney(credit.creditLimit)}.`}
          </p>
          {credit.mode === 'PROCEDURE' ? (
            <p className={styles.muted}>
              Duyệt trên Quy trình{credit.procedureInstanceCode ? `, hồ sơ ${credit.procedureInstanceCode}` : ' (đang tạo hồ sơ)'}.
            </p>
          ) : null}
          {credit.decidedBy ? (
            <p className={styles.muted}>
              {personName(people, credit.decidedBy)}
              {credit.decisionNote ? `: ${credit.decisionNote}` : ''}
            </p>
          ) : null}
          {canDecide ? (
            <div className={styles.toolbar}>
              <button
                type="button"
                className={styles.buttonPrimary}
                disabled={busy}
                onClick={() => void run(() => decideOrderCredit(detail.id, 'approve', {}), 'Đã duyệt vượt hạn mức; đơn được giữ hàng nếu đủ tồn.')}
              >
                Duyệt vượt hạn mức
              </button>
              <button type="button" className={styles.buttonDangerGhost} disabled={busy} onClick={() => setRejecting(true)}>
                Từ chối
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {rejecting ? (
        <CrmDialog
          open
          title="Từ chối duyệt vượt hạn mức"
          subtitle="Đơn về Nháp kèm lý do"
          submitLabel="Từ chối"
          danger
          submitting={busy}
          error={error}
          onClose={() => setRejecting(false)}
          onSubmit={() => {
            if (!reason.trim()) return setError('Vui lòng ghi lý do từ chối.');
            void run(() => decideOrderCredit(detail.id, 'reject', { reason: reason.trim() }), 'Đã từ chối; đơn về Nháp.').then((ok) => ok && setRejecting(false));
          }}
        >
          <Field label="Lý do" required wide>
            <textarea className={styles.textarea} rows={3} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
        </CrmDialog>
      ) : null}
    </>
  );
}
