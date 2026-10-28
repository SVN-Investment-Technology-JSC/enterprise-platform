'use client';

import {
  OPPORTUNITY_STAGE_LABELS,
  QUOTE_STATUS_LABELS,
  type OpportunityDetail,
  type OpportunityStage,
  type QuoteSummary,
} from '@enterprise-platform/contracts-crm';
import { SearchableSelect, formatDateTime, toast } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Drawer } from 'antd';
import { useEffect, useState } from 'react';
import { ActivityPanel } from '../activities/activity-panel';
import { CrmDialog, Field, StatusPill } from '../components/crm-ui';
import { useDebounced } from '../components/use-debounced';
import {
  changeOpportunityStage,
  createOpportunity,
  errorMessage,
  getOpportunity,
  listCustomers,
  listQuotes,
  updateOpportunity,
} from '../crm-api';
import { peopleOptions, useCanWrite, useCrm } from '../crm-context';
import { QUOTE_STATUS_TONE } from '../quotes/quote.model';
import { CreateQuoteDialog } from '../quotes/quotes-page';
import { canDropStage, formatMoney, personName } from '../sales.model';
import styles from '../sales.module.scss';

const digits = (value: string) => value.replace(/[^\d]/g, '');

/** Thêm hoặc sửa cơ hội. Thêm từ trang khách thì khách đã chọn sẵn. */
export function OpportunityFormDialog({
  opportunity,
  customer,
  onClose,
  onSaved,
}: {
  opportunity?: OpportunityDetail;
  customer?: { id: string; code: string; name: string };
  onClose: () => void;
  onSaved: (opportunity: OpportunityDetail) => void;
}) {
  const { people } = useCrm();
  const [customerId, setCustomerId] = useState(opportunity?.customerId ?? customer?.id ?? '');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerOptions, setCustomerOptions] = useState(
    customer ? [{ value: customer.id, label: customer.name, badge: customer.code }] : [],
  );
  const [name, setName] = useState(opportunity?.name ?? '');
  const [probability, setProbability] = useState(String(opportunity?.probability ?? 10));
  const [expectedValue, setExpectedValue] = useState(opportunity?.expectedValue?.toString() ?? '');
  const [expectedCloseDate, setExpectedCloseDate] = useState(opportunity?.expectedCloseDate ?? '');
  const [budget, setBudget] = useState(opportunity?.budget?.toString() ?? '');
  const [need, setNeed] = useState(opportunity?.need ?? '');
  const [ownerUserId, setOwnerUserId] = useState(opportunity?.ownerUserId ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const query = useDebounced(customerSearch, 300);

  // Tìm khách trong phạm vi khi chưa cố định khách.
  useEffect(() => {
    if (opportunity || customer) return;
    listCustomers({ q: query || undefined, limit: 20 })
      .then((page) => setCustomerOptions(page.items.map((item) => ({ value: item.id, label: item.name, badge: item.code }))))
      .catch(() => undefined);
  }, [query, opportunity, customer]);

  async function submit() {
    if (!customerId) return setError('Vui lòng chọn khách hàng.');
    if (!name.trim()) return setError('Vui lòng nhập tên cơ hội.');
    const percent = Number(probability || 0);
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) return setError('Xác suất phải là số nguyên từ 0 đến 100.');
    setSubmitting(true);
    setError(undefined);
    const fields = {
      name: name.trim(),
      probability: percent,
      expectedValue: expectedValue ? Number(expectedValue) : null,
      expectedCloseDate: expectedCloseDate || null,
      budget: budget ? Number(budget) : null,
      need: need.trim() || null,
      ownerUserId: ownerUserId || null,
    };
    try {
      const saved = opportunity
        ? await updateOpportunity(opportunity.id, { ...fields, version: opportunity.version })
        : await createOpportunity({ ...fields, customerId });
      toast.success('Đã lưu cơ hội.');
      onSaved(saved);
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được cơ hội.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <CrmDialog
      open
      wide
      title={opportunity ? 'Sửa cơ hội' : 'Thêm cơ hội'}
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <div className={styles.fieldGrid}>
        <Field label="Khách hàng" required wide>
          {opportunity || customer ? (
            <input className={styles.input} value={opportunity ? `${opportunity.customerCode} - ${opportunity.customerName}` : `${customer?.code} - ${customer?.name}`} disabled />
          ) : (
            <span onInput={(event) => setCustomerSearch((event.target as HTMLInputElement).value ?? '')}>
              <SearchableSelect options={customerOptions} value={customerId} placeholder="Tìm khách theo mã, tên, MST" emptyText="Không tìm thấy khách hàng" onChange={setCustomerId} />
            </span>
          )}
        </Field>
        <Field label="Tên cơ hội" required wide>
          <input className={styles.input} value={name} maxLength={300} autoFocus onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Xác suất thắng (%)">
          <input className={styles.input} inputMode="numeric" value={probability} maxLength={3} onChange={(event) => setProbability(digits(event.target.value))} />
        </Field>
        <Field label="Giá trị dự kiến (đồng)">
          <input className={styles.input} inputMode="numeric" value={expectedValue} onChange={(event) => setExpectedValue(digits(event.target.value))} />
        </Field>
        <Field label="Ngày chốt dự kiến">
          <DatePickerInput value={expectedCloseDate || undefined} onChange={setExpectedCloseDate} height={38} aria-label="Ngày chốt dự kiến" />
        </Field>
        <Field label="Ngân sách khách (đồng)">
          <input className={styles.input} inputMode="numeric" value={budget} onChange={(event) => setBudget(digits(event.target.value))} />
        </Field>
        <Field label="Người phụ trách" hint={opportunity ? undefined : 'Mặc định là bạn'}>
          <SearchableSelect options={peopleOptions(people)} value={ownerUserId} placeholder="Chọn người phụ trách" clearable onChange={setOwnerUserId} />
        </Field>
        <Field label="Nhu cầu" wide>
          <textarea className={styles.textarea} rows={3} value={need} maxLength={4000} onChange={(event) => setNeed(event.target.value)} />
        </Field>
      </div>
    </CrmDialog>
  );
}

/** Hộp nhập lý do khi chuyển cơ hội sang Thua (bắt buộc). */
export function LostReasonDialog({
  name,
  onClose,
  onConfirm,
}: {
  name: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  async function submit() {
    if (!reason.trim()) return setError('Phải ghi lý do thua.');
    setSubmitting(true);
    try {
      await onConfirm(reason.trim());
    } catch (cause) {
      setError(errorMessage(cause, 'Không chuyển được giai đoạn.'));
      setSubmitting(false);
    }
  }
  return (
    <CrmDialog open danger title="Chuyển cơ hội sang Thua" subtitle={name} submitLabel="Xác nhận thua" submitting={submitting} error={error} onClose={onClose} onSubmit={() => void submit()}>
      <Field label="Lý do thua" required>
        <textarea className={styles.textarea} rows={4} value={reason} maxLength={2000} autoFocus onChange={(event) => setReason(event.target.value)} />
      </Field>
    </CrmDialog>
  );
}

/**
 * Ngăn chi tiết cơ hội: thông tin, nút chuyển giai đoạn hợp lệ, lịch sử giai
 * đoạn (người, thời điểm, lý do) và hoạt động của cơ hội.
 */
export function OpportunityDrawer({
  opportunityId,
  onClose,
  onChanged,
  onOpenCustomer,
  onOpenQuote,
}: {
  opportunityId: string;
  onClose: () => void;
  onChanged: () => void;
  onOpenCustomer: (id: string) => void;
  onOpenQuote: (id: string) => void;
}) {
  const { people } = useCrm();
  const canWrite = useCanWrite();
  const [detail, setDetail] = useState<OpportunityDetail>();
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [losing, setLosing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDetail(undefined);
    getOpportunity(opportunityId)
      .then(setDetail)
      .catch((cause) => setError(errorMessage(cause, 'Không tải được cơ hội.')));
  }, [opportunityId]);

  async function move(stage: OpportunityStage, reason?: string) {
    if (!detail) return;
    setBusy(true);
    try {
      const next = await changeOpportunityStage(detail.id, { stage, reason, version: detail.version });
      setDetail(next);
      setLosing(false);
      onChanged();
    } catch (cause) {
      if (stage === 'LOST') throw cause;
      toast.error(errorMessage(cause, 'Không chuyển được giai đoạn.'));
    } finally {
      setBusy(false);
    }
  }

  const targets = detail ? (Object.keys(OPPORTUNITY_STAGE_LABELS) as OpportunityStage[]).filter((stage) => canDropStage(detail.stage, stage)) : [];

  return (
    <Drawer open size={720} title={detail ? detail.name : 'Cơ hội'} onClose={onClose} destroyOnHidden>
      {error ? <p className={styles.alert}>{error}</p> : null}
      {detail ? (
        <div className={styles.drawerBody}>
          <dl className={styles.facts}>
            <dt>Khách hàng</dt>
            <dd>
              <button type="button" className={styles.linkButton} onClick={() => onOpenCustomer(detail.customerId)}>
                {detail.customerCode} - {detail.customerName}
              </button>
            </dd>
            <dt>Giai đoạn</dt>
            <dd>
              <StatusPill tone={detail.stage === 'WON' ? 'success' : detail.stage === 'LOST' ? 'danger' : 'info'}>
                {OPPORTUNITY_STAGE_LABELS[detail.stage]}
              </StatusPill>
            </dd>
            <dt>Xác suất</dt>
            <dd>{detail.probability}%</dd>
            <dt>Giá trị dự kiến</dt>
            <dd>{formatMoney(detail.expectedValue)}</dd>
            <dt>Ngày chốt dự kiến</dt>
            <dd>{detail.expectedCloseDate ? detail.expectedCloseDate.split('-').reverse().join('/') : ''}</dd>
            <dt>Người phụ trách</dt>
            <dd>{personName(people, detail.ownerUserId)}</dd>
            {detail.need ? (
              <>
                <dt>Nhu cầu</dt>
                <dd>{detail.need}</dd>
              </>
            ) : null}
            {detail.lostReason ? (
              <>
                <dt>Lý do thua</dt>
                <dd>{detail.lostReason}</dd>
              </>
            ) : null}
          </dl>
          {canWrite && targets.length ? (
            <div className={styles.toolbar}>
              {targets.map((stage) => (
                <button
                  key={stage}
                  type="button"
                  disabled={busy}
                  className={stage === 'LOST' ? styles.buttonDangerGhost : styles.buttonGhost}
                  onClick={() => (stage === 'LOST' ? setLosing(true) : void move(stage))}
                >
                  Chuyển sang {OPPORTUNITY_STAGE_LABELS[stage]}
                </button>
              ))}
              {detail.stage !== 'WON' && detail.stage !== 'LOST' ? (
                <button type="button" className={styles.buttonGhost} onClick={() => setEditing(true)}>
                  Sửa
                </button>
              ) : null}
            </div>
          ) : null}
          <OpportunityQuotes opportunity={detail} refresh={detail.version} onOpenQuote={onOpenQuote} />
          <h4 className={styles.sectionTitle}>Lịch sử giai đoạn</h4>
          <ol className={styles.timeline}>
            {detail.history.map((entry) => (
              <li key={entry.id} className={styles.timelineItem}>
                <div>
                  <div className={styles.timelineTitle}>
                    {entry.fromStage ? `${OPPORTUNITY_STAGE_LABELS[entry.fromStage]} → ` : 'Tạo ở '}
                    {OPPORTUNITY_STAGE_LABELS[entry.toStage]}
                  </div>
                  {entry.reason ? <div className={styles.muted}>Lý do: {entry.reason}</div> : null}
                  <div className={styles.timelineMeta}>
                    {formatDateTime(entry.at)} · {personName(people, entry.actorId)}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <h4 className={styles.sectionTitle}>Hoạt động</h4>
          <ActivityPanel scope={{ opportunityId: detail.id }} />
        </div>
      ) : null}
      {editing && detail ? (
        <OpportunityFormDialog
          opportunity={detail}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setDetail(saved);
            setEditing(false);
            onChanged();
          }}
        />
      ) : null}
      {losing && detail ? (
        <LostReasonDialog name={detail.name} onClose={() => setLosing(false)} onConfirm={(reason) => move('LOST', reason)} />
      ) : null}
    </Drawer>
  );
}

/**
 * Báo giá của cơ hội (mới nhất trước) và nút lập báo giá. Sang giai đoạn Báo giá
 * server tự tạo nháp; sang Thắng cần một báo giá Khách chấp nhận.
 */
function OpportunityQuotes({
  opportunity,
  refresh,
  onOpenQuote,
}: {
  opportunity: OpportunityDetail;
  refresh: number;
  onOpenQuote: (id: string) => void;
}) {
  const { capabilities } = useCrm();
  const canWriteQuote = capabilities.isTenantAdmin || capabilities.canWriteQuote;
  const [quotes, setQuotes] = useState<readonly QuoteSummary[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    listQuotes({ opportunityId: opportunity.id, limit: 20 })
      .then((page) => setQuotes(page.items))
      .catch(() => setQuotes([]));
  }, [opportunity.id, refresh]);

  const open = opportunity.stage !== 'WON' && opportunity.stage !== 'LOST';
  return (
    <>
      <h4 className={styles.sectionTitle}>Báo giá</h4>
      {quotes.length ? (
        <ul className={styles.timeline}>
          {quotes.map((quote) => (
            <li key={quote.id} className={styles.timelineItem}>
              <button type="button" className={styles.linkButton} onClick={() => onOpenQuote(quote.id)}>
                {quote.code} v{quote.currentVersion}
              </button>{' '}
              <StatusPill tone={QUOTE_STATUS_TONE[quote.status]}>{QUOTE_STATUS_LABELS[quote.status]}</StatusPill>{' '}
              <span className={styles.muted}>{formatMoney(quote.totalAmount)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.muted}>Chưa có báo giá.</p>
      )}
      {opportunity.stage === 'NEGOTIATION' && !quotes.some((quote) => quote.status === 'ACCEPTED') ? (
        <p className={styles.muted}>Cần một báo giá được khách chấp nhận trước khi chuyển sang Thắng.</p>
      ) : null}
      {open && canWriteQuote ? (
        <div className={styles.toolbar}>
          <button type="button" className={styles.buttonGhost} onClick={() => setCreating(true)}>
            Lập báo giá
          </button>
        </div>
      ) : null}
      {creating ? (
        <CreateQuoteDialog opportunityId={opportunity.id} onClose={() => setCreating(false)} onCreated={onOpenQuote} />
      ) : null}
    </>
  );
}
