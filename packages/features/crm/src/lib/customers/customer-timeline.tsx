'use client';

import type { CustomerTimelineEntry } from '@enterprise-platform/contracts-crm';
import { formatDateTime } from '@enterprise-platform/shared-ui';
import { CalendarClock, CircleDot, FileSignature, FileText, ShieldCheck, ShoppingCart, Target, Wallet } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { errorMessage, loadTimeline } from '../crm-api';
import { useCrm } from '../crm-context';
import { describeTimelineEntry, personName } from '../sales.model';
import styles from '../sales.module.scss';

/** Biểu tượng theo loại mục; loại mới (báo giá, đơn...) thêm ở đây, thiếu thì dùng chấm tròn. */
const ICONS: Partial<Record<CustomerTimelineEntry['kind'], ReactNode>> = {
  'opportunity-created': <Target size={14} />,
  'opportunity-stage-changed': <Target size={14} />,
  activity: <CalendarClock size={14} />,
  quote: <FileText size={14} />,
  contract: <FileSignature size={14} />,
  order: <ShoppingCart size={14} />,
  receivable: <Wallet size={14} />,
  warranty: <ShieldCheck size={14} />,
};

/**
 * Dòng thời gian khách hàng: cơ hội, chuyển giai đoạn, hoạt động, báo giá, hợp
 * đồng, đơn bán, mới nhất trước, tải thêm theo trang. API đã lọc theo phạm vi
 * dữ liệu từng mục.
 */
export function CustomerTimeline({
  customerId,
  onOpenOpportunity,
  onOpenQuote,
  onOpenContract,
  onOpenOrder,
  onOpenWarranty,
}: {
  customerId: string;
  onOpenOpportunity: (id: string) => void;
  onOpenQuote?: (id: string) => void;
  onOpenContract?: (id: string) => void;
  onOpenOrder?: (id: string) => void;
  onOpenWarranty?: (id: string) => void;
}) {
  const { people } = useCrm();
  const [entries, setEntries] = useState<CustomerTimelineEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(
    (after?: string) => {
      setLoading(true);
      loadTimeline(customerId, after)
        .then((page) => {
          setEntries((current) => (after ? [...current, ...page.items] : [...page.items]));
          setCursor(page.nextCursor);
          setError(undefined);
        })
        .catch((cause) => setError(errorMessage(cause, 'Không tải được dòng thời gian.')))
        .finally(() => setLoading(false));
    },
    [customerId],
  );

  useEffect(() => load(), [load]);

  return (
    <section className={styles.panel} aria-label="Dòng thời gian">
      {error ? <p className={styles.alert}>{error}</p> : null}
      {!entries.length && !loading ? <p className={styles.muted}>Chưa có sự kiện nào.</p> : null}
      <ol className={styles.timeline}>
        {entries.map((entry) => {
          const { title, detail } = describeTimelineEntry(entry);
          const open =
            entry.kind === 'contract' && onOpenContract
              ? () => onOpenContract(entry.contractId)
              : entry.kind === 'order' && onOpenOrder
                ? () => onOpenOrder(entry.orderId)
                : entry.kind === 'warranty' && onOpenWarranty
                  ? () => onOpenWarranty(entry.caseId)
                  : entry.kind === 'quote' && onOpenQuote
                  ? () => onOpenQuote(entry.quoteId)
                  : 'opportunityId' in entry && entry.opportunityId
                    ? () => onOpenOpportunity(entry.opportunityId as string)
                    : null;
          return (
            <li key={`${entry.kind}:${entry.id}`} className={styles.timelineItem}>
              <span className={styles.timelineIcon}>{ICONS[entry.kind] ?? <CircleDot size={14} />}</span>
              <div>
                <div className={styles.timelineTitle}>
                  {open ? (
                    <button type="button" className={styles.linkButton} onClick={open}>
                      {title}
                    </button>
                  ) : (
                    title
                  )}
                </div>
                {detail ? <div className={styles.muted}>{detail}</div> : null}
                <div className={styles.timelineMeta}>
                  {formatDateTime(entry.at)}
                  {entry.actorId ? ` · ${personName(people, entry.actorId)}` : ''}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {cursor ? (
        <button type="button" className={styles.buttonGhost} disabled={loading} onClick={() => load(cursor)}>
          {loading ? 'Đang tải…' : 'Xem thêm'}
        </button>
      ) : null}
    </section>
  );
}
