'use client';

import {
  QUOTE_STATUS_LABELS,
  type OpportunityDetail,
  type OpportunityStagePlan,
  type QuoteSummary,
  type StageRequirementCheck,
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
  getStagePlan,
  getStageRequirements,
  listCustomers,
  listQuotes,
  updateOpportunity,
} from '../crm-api';
import { peopleOptions, useCanWrite, useCrm } from '../crm-context';
import { QUOTE_STATUS_TONE } from '../quotes/quote.model';
import { CreateQuoteDialog } from '../quotes/quotes-page';
import {
  buildSkipStages,
  canEditStageAssignee,
  canLeaveCurrentStage,
  defaultPipeline,
  describeStageError,
  formatMoney,
  personName,
  skippableStartStages,
  stageLabelByCode,
  stageNeedsReason,
  stageOptions,
  stageTone,
} from '../sales.model';
import styles from '../sales.module.scss';
import { StagePlanPanel } from './stage-plan';
import { usePipelines } from './use-pipelines';

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
  const { pipelines } = usePipelines();
  const [pipelineId, setPipelineId] = useState('');
  const [skipped, setSkipped] = useState<Record<string, string>>({});
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
    if (!name.trim()) return setError('Vui lòng nhập tên dự án bán hàng.');
    const percent = Number(probability || 0);
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) return setError('Xác suất phải là số nguyên từ 0 đến 100.');
    setSubmitting(true);
    setError(undefined);
    const selectedPipeline = pipelines.find((item) => item.id === (pipelineId || defaultPipeline(pipelines)?.id));
    const skip = opportunity ? { skipStages: [] } : buildSkipStages(selectedPipeline, skipped);
    if (skip.error) return setError(skip.error);
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
        : await createOpportunity({ ...fields, customerId, pipelineId: pipelineId || null, ...(skip.skipStages.length ? { skipStages: skip.skipStages } : {}) });
      toast.success('Đã lưu dự án bán hàng.');
      onSaved(saved);
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được dự án bán hàng.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <CrmDialog
      open
      wide
      title={opportunity ? 'Sửa dự án bán hàng' : 'Thêm dự án bán hàng'}
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
        {!opportunity && pipelines.filter((item) => item.active).length > 1 ? (
          <Field label="Luồng bán hàng" hint="Dự án vào giai đoạn đầu của luồng" wide>
            <SearchableSelect
              options={pipelines.filter((item) => item.active).map((item) => ({ value: item.id, label: item.name }))}
              value={pipelineId || defaultPipeline(pipelines)?.id || ''}
              placeholder="Chọn luồng bán hàng"
              onChange={(value) => {
                setPipelineId(value);
                setSkipped({});
              }}
            />
          </Field>
        ) : null}
        <Field label="Tên dự án bán hàng" required wide>
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
        {!opportunity && skippableStartStages(pipelines.find((item) => item.id === (pipelineId || defaultPipeline(pipelines)?.id))).length ? (
          <Field label="Bỏ qua giai đoạn" hint="Tuỳ chọn: giai đoạn không cần làm với dự án này; phải ghi lý do" wide>
            {skippableStartStages(pipelines.find((item) => item.id === (pipelineId || defaultPipeline(pipelines)?.id))).map((stage) => (
              <div key={stage.id}>
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={stage.code in skipped}
                    onChange={(event) =>
                      setSkipped((current) => {
                        const next = { ...current };
                        if (event.target.checked) next[stage.code] = '';
                        else delete next[stage.code];
                        return next;
                      })
                    }
                  />
                  Bỏ qua {stage.name}
                </label>
                {stage.code in skipped ? (
                  <input
                    className={styles.input}
                    value={skipped[stage.code]}
                    maxLength={2000}
                    placeholder={`Lý do bỏ qua ${stage.name}`}
                    aria-label={`Lý do bỏ qua ${stage.name}`}
                    onChange={(event) => setSkipped((current) => ({ ...current, [stage.code]: event.target.value }))}
                  />
                ) : null}
              </div>
            ))}
          </Field>
        ) : null}
        <Field label="Nhu cầu" wide>
          <textarea className={styles.textarea} rows={3} value={need} maxLength={4000} onChange={(event) => setNeed(event.target.value)} />
        </Field>
      </div>
    </CrmDialog>
  );
}

/**
 * Hộp nhập lý do khi chuyển dự án bán hàng sang giai đoạn bắt buộc lý do
 * (Thua, hoặc giai đoạn có điều kiện lý do). `stage` để hiện tên giai đoạn đích.
 */
export function LostReasonDialog({
  name,
  stage,
  onClose,
  onConfirm,
}: {
  name: string;
  stage?: { name: string; semantic: 'OPEN' | 'WON' | 'LOST' };
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const lost = !stage || stage.semantic === 'LOST';
  async function submit() {
    if (!reason.trim()) return setError(lost ? 'Phải ghi lý do thua.' : 'Phải ghi lý do chuyển giai đoạn.');
    setSubmitting(true);
    try {
      await onConfirm(reason.trim());
    } catch (cause) {
      setError(describeStageError(cause, 'Không chuyển được giai đoạn.'));
      setSubmitting(false);
    }
  }
  return (
    <CrmDialog open danger={lost} title={lost ? 'Chuyển dự án bán hàng sang Thua' : `Chuyển dự án bán hàng sang ${stage?.name}`} subtitle={name} submitLabel={lost ? 'Xác nhận thua' : 'Xác nhận chuyển'} submitting={submitting} error={error} onClose={onClose} onSubmit={() => void submit()}>
      <Field label={lost ? 'Lý do thua' : 'Lý do chuyển giai đoạn'} required>
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
  const { people, capabilities, currentUserId } = useCrm();
  const canWrite = useCanWrite();
  const [detail, setDetail] = useState<OpportunityDetail>();
  const [plan, setPlan] = useState<OpportunityStagePlan>();
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [losing, setLosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState('');
  const [checks, setChecks] = useState<readonly StageRequirementCheck[]>([]);
  const [moveError, setMoveError] = useState<string>();

  useEffect(() => {
    setDetail(undefined);
    getOpportunity(opportunityId)
      .then(setDetail)
      .catch((cause) => setError(errorMessage(cause, 'Không tải được dự án bán hàng.')));
  }, [opportunityId]);

  // Kế hoạch giai đoạn: tải lại khi dự án đổi giai đoạn (version đổi).
  useEffect(() => {
    if (!detail) return;
    let alive = true;
    getStagePlan(detail.id)
      .then((next) => alive && setPlan(next))
      .catch(() => alive && setPlan(undefined));
    return () => {
      alive = false;
    };
  }, [detail?.id, detail?.version]);

  // Điều kiện của giai đoạn đích đang chọn: hiện trước khi bấm chuyển.
  useEffect(() => {
    setChecks([]);
    setMoveError(undefined);
    if (!detail || !target) return;
    let alive = true;
    getStageRequirements(detail.id, target)
      .then((next) => alive && setChecks(next))
      .catch(() => alive && setChecks([]));
    return () => {
      alive = false;
    };
  }, [detail?.id, detail?.version, target]);

  async function move(stage: string, reason?: string, askReason = false) {
    if (!detail) return;
    setBusy(true);
    setMoveError(undefined);
    try {
      const next = await changeOpportunityStage(detail.id, { stage, reason, version: detail.version });
      setDetail(next);
      setLosing(false);
      setTarget('');
      onChanged();
    } catch (cause) {
      if (askReason) throw cause;
      setMoveError(describeStageError(cause, 'Không chuyển được giai đoạn.'));
    } finally {
      setBusy(false);
    }
  }

  const targets = detail?.nextStages ?? [];
  const targetStage = targets.find((stage) => stage.code === target);
  
  const open = detail ? detail.stageInfo.semantic === 'OPEN' : false;
  // Ẩn nút chuyển giai đoạn với người không phải chủ, không đảm nhận giai đoạn hiện tại, không có crm.manage (server vẫn trả 403).
  const canLeave = detail ? canLeaveCurrentStage(capabilities, currentUserId, detail, plan?.items) : false;
  const canEditPlan = detail ? canEditStageAssignee(capabilities, currentUserId, detail) : false;
  const blocking = checks.filter((check) => check.required && check.met === false);
  const hints = checks.filter((check) => !check.required && check.met === false);

  return (
    <Drawer open size={720} title={detail ? detail.name : 'Dự án bán hàng'} onClose={onClose} destroyOnHidden>
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
              <StatusPill tone={stageTone(detail.stageInfo.semantic)}>{detail.stageInfo.name}</StatusPill>
            </dd>
            <dt>Luồng</dt>
            <dd>{detail.pipeline.name}
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
          {canWrite && (canLeave || open) ? (
            <div className={styles.toolbar}>
              {targets.length && canLeave ? (
                <>
                  <SearchableSelect
                    className={styles.filter}
                    options={stageOptions(targets)}
                    value={target}
                    placeholder="Chọn giai đoạn tiếp theo"
                    onChange={setTarget}
                  />
                  <button
                    type="button"
                    disabled={busy || !targetStage}
                    className={targetStage?.semantic === 'LOST' ? styles.buttonDangerGhost : styles.buttonGhost}
                    onClick={() => {
                      if (!targetStage) return;
                      if (stageNeedsReason({ semantic: targetStage.semantic, requirements: checks.map((check) => ({ ...check, sortOrder: 0 })) })) setLosing(true);
                      else void move(targetStage.code);
                    }}
                  >
                    Chuyển giai đoạn
                  </button>
                </>
              ) : null}
              {open ? (
                <button type="button" className={styles.buttonGhost} onClick={() => setEditing(true)}>
                  Sửa
                </button>
              ) : null}
            </div>
          ) : null}
          {moveError ? <p className={styles.alert}>{moveError}</p> : null}
          {blocking.length ? (
            <div className={styles.alert}>
              <strong>Chưa đủ điều kiện chuyển sang {targetStage?.name}:</strong>
              <ul>
                {blocking.map((check) => (
                  <li key={`${check.kind}:${check.ref}`}>{check.message}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {hints.length ? (
            <div className={styles.muted}>
              <strong>Nên có:</strong>
              <ul>
                {hints.map((check) => (
                  <li key={`${check.kind}:${check.ref}`}>{check.message}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <StagePlanPanel opportunity={detail} plan={plan} canEdit={canWrite && canEditPlan} canSkip={canWrite && canLeave} onPlan={(next) => {
            setPlan(next);
            getOpportunity(detail.id).then(setDetail).catch(() => undefined);
          }} />
          <OpportunityQuotes opportunity={detail} refresh={detail.version} onOpenQuote={onOpenQuote} />
          <h4 className={styles.sectionTitle}>Lịch sử giai đoạn</h4>
          <ol className={styles.timeline}>
            {detail.history.map((entry) => (
              <li key={entry.id} className={styles.timelineItem}>
                <div>
                  <div className={styles.timelineTitle}>
                    {entry.kind === 'SKIP'
                      ? `Bỏ qua giai đoạn ${entry.toStageName ?? stageLabelByCode(entry.toStage)}`
                      : `${entry.fromStage ? `${entry.fromStageName ?? stageLabelByCode(entry.fromStage)} → ` : 'Tạo ở '}${entry.toStageName ?? stageLabelByCode(entry.toStage)}`}
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
        <LostReasonDialog name={detail.name} stage={targetStage} onClose={() => setLosing(false)} onConfirm={(reason) => move(target, reason, true)} />
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

  const open = opportunity.stageInfo.semantic === 'OPEN';
  const needsAcceptedQuote = opportunity.nextStages.some((stage) => stage.semantic === 'WON');
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
      {needsAcceptedQuote && !quotes.some((quote) => quote.status === 'ACCEPTED') ? (
        <p className={styles.muted}>Cần một báo giá được khách chấp nhận trước khi chuyển sang giai đoạn Thắng.</p>
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
