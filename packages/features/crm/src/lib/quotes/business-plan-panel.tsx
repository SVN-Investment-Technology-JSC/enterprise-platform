'use client';

import {
  BUSINESS_PLAN_COST_KIND_LABELS,
  BUSINESS_PLAN_STATUS_LABELS,
  BUSINESS_PLAN_DEVIATION_MODE_LABELS,
  BUSINESS_PLAN_LINES_MAX,
  type BusinessPlanDetail,
  type QuoteDetail,
} from '@enterprise-platform/contracts-crm';
import { Popconfirm, SearchableSelect, formatDateTime, toast } from '@enterprise-platform/shared-ui';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CrmDialog, Field, StatusPill } from '../components/crm-ui';
import { businessPlanAction, getBusinessPlan, saveBusinessPlan, type BusinessPlanAction } from '../crm-api';
import { labelOptions, useCrm } from '../crm-context';
import { formatPercent } from '../pricing/pricing.model';
import { formatMoney, personName } from '../sales.model';
import styles from '../sales.module.scss';
import local from '../pricing/pricing.module.scss';
import {
  BUSINESS_PLAN_STATUS_TONE,
  buildPlanLines,
  copySourceVersion,
  draftTotal,
  draftsFromPlan,
  isPlanConflict,
  planActions,
  planConflictMessage,
  planDirty,
  planReasons,
  type PlanLineDraft,
} from './business-plan.model';

const KIND_OPTIONS = labelOptions(BUSINESS_PLAN_COST_KIND_LABELS);
const ROW = { display: 'grid', gridTemplateColumns: '200px 1fr 170px 60px', gap: 8, alignItems: 'center' } as const;
let draftSeq = 0;
const newKey = () => `new-${(draftSeq += 1)}`;

/**
 * Khối "Phương án kinh doanh" của phiên bản báo giá đang xem: dòng chi phí, tổng doanh thu, giá vốn, chi phí, lợi
 * nhuận, trạng thái duyệt và các vòng duyệt. Người không có quyền xem giá vốn chỉ thấy doanh thu và tiền hàng.
 * `version` của PAKD chống ghi đè: 409 thì tải lại và báo.
 */
export function BusinessPlanPanel({ detail, onChanged }: { detail: QuoteDetail; onChanged?: () => void }) {
  const { capabilities, people, currentUserId } = useCrm();
  const versionNo = detail.version.versionNo;
  const [plan, setPlan] = useState<BusinessPlanDetail | null | undefined>(detail.businessPlan);
  const [drafts, setDrafts] = useState<PlanLineDraft[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [rejecting, setRejecting] = useState(false);

  function adopt(next: BusinessPlanDetail | null | undefined) {
    setPlan(next);
    setDrafts(next ? draftsFromPlan(next) : []);
    setNote(next?.note ?? '');
  }

  // Đổi phiên bản hoặc báo giá được tải lại: lấy PAKD theo báo giá mới.
  useEffect(() => {
    adopt(detail.businessPlan);
    setError(undefined);
  }, [detail.businessPlan, versionNo]);

  const write = capabilities.isTenantAdmin || capabilities.canWriteQuote;
  const isCurrent = versionNo === detail.currentVersion;
  const copyFrom = copySourceVersion(
    detail.versions.map((entry) => entry.versionNo),
    versionNo,
  );
  const costVisible = plan ? plan.costVisible : capabilities.canViewQuoteCost;

  async function reload() {
    try {
      adopt(await getBusinessPlan(detail.id, versionNo));
    } catch {
      /* giữ nguyên dữ liệu đang có */
    }
  }

  /** Chạy một thao tác; 409 thì tải lại bản mới nhất và báo. */
  async function run(work: () => Promise<BusinessPlanDetail>, success: string): Promise<boolean> {
    setBusy(true);
    setError(undefined);
    try {
      adopt(await work());
      toast.success(success);
      onChanged?.();
      return true;
    } catch (cause) {
      const message = planConflictMessage(cause, 'Không thực hiện được thao tác.');
      setError(message);
      toast.error(message);
      if (isPlanConflict(cause)) await reload();
      return false;
    } finally {
      setBusy(false);
    }
  }

  function save(): Promise<boolean> {
    const built = buildPlanLines(drafts);
    if (!built.ok) {
      setError(built.message);
      return Promise.resolve(false);
    }
    return run(
      () => saveBusinessPlan(detail.id, versionNo, { version: plan?.version, note: note.trim() || null, lines: built.lines }),
      'Đã lưu phương án kinh doanh.',
    );
  }

  const create = (copyFromVersionNo?: number) =>
    run(() => saveBusinessPlan(detail.id, versionNo, { copyFromVersionNo: copyFromVersionNo ?? null, lines: copyFromVersionNo ? undefined : [] }), 'Đã lập phương án kinh doanh.');

  async function act(action: BusinessPlanAction, reason?: string): Promise<boolean> {
    if (!plan) return false;
    const done: Record<BusinessPlanAction, string> = {
      submit: 'Đã trình duyệt phương án kinh doanh.',
      approve: 'Đã duyệt phương án kinh doanh.',
      reject: 'Đã từ chối phương án kinh doanh.',
    };
    // Trình duyệt phải lưu thay đổi đang soạn trước, để server duyệt đúng số đang thấy.
    let version = plan.version;
    if (action === 'submit' && planDirty(plan, drafts, note)) {
      const built = buildPlanLines(drafts);
      if (!built.ok) {
        setError(built.message);
        return false;
      }
      setBusy(true);
      try {
        const saved = await saveBusinessPlan(detail.id, versionNo, { version, note: note.trim() || null, lines: built.lines });
        version = saved.version;
      } catch (cause) {
        const message = planConflictMessage(cause, 'Không lưu được phương án kinh doanh.');
        setError(message);
        toast.error(message);
        if (isPlanConflict(cause)) await reload();
        setBusy(false);
        return false;
      }
      setBusy(false);
    }
    return run(() => businessPlanAction(detail.id, versionNo, action, { version, reason }), done[action]);
  }

  if (plan === undefined) return null;

  // Chưa lập PAKD.
  if (plan === null) {
    const canCreate = write && isCurrent && detail.version.status === 'DRAFT';
    return (
      <section className={styles.panel} aria-label="Phương án kinh doanh">
        <h3 className={styles.sectionTitle}>Phương án kinh doanh</h3>
        <p className={styles.muted}>Phiên bản {versionNo} chưa có phương án kinh doanh.</p>
        {error ? <p className={styles.alert}>{error}</p> : null}
        <PlanReasons detail={detail} />
        {canCreate ? (
          <div className={styles.toolbar}>
            <button type="button" className={styles.buttonPrimary} disabled={busy} onClick={() => void create()}>
              Lập phương án kinh doanh
            </button>
            {copyFrom !== undefined ? (
              <button type="button" className={styles.buttonGhost} disabled={busy} onClick={() => void create(copyFrom)}>
                Lập và chép từ phiên bản {copyFrom}
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  }

  const actions = planActions(plan, capabilities, currentUserId);
  const editing = actions.includes('save');
  const dirty = planDirty(plan, drafts, note);
  const total = editing ? draftTotal(drafts) : plan.figures?.extraCostTotal ?? 0;
  const shown = plan.figures;
  const deviation = plan.deviation;

  return (
    <section className={styles.panel} aria-label="Phương án kinh doanh">
      <div className={styles.detailHead}>
        <h3 className={styles.sectionTitle}>Phương án kinh doanh · phiên bản {plan.quoteVersionNo}</h3>
        <StatusPill tone={BUSINESS_PLAN_STATUS_TONE[plan.status]}>{BUSINESS_PLAN_STATUS_LABELS[plan.status]}</StatusPill>
      </div>
      {plan.status === 'REJECTED' && plan.decisionReason ? (
        <p className={styles.warning} role="status">
          Bị từ chối{plan.decidedBy ? ` bởi ${personName(people, plan.decidedBy)}` : ''}: {plan.decisionReason}
        </p>
      ) : null}
      {deviation?.exceeded ? (
        <p className={styles.warning} role="status">
          Lệch ngưỡng so với phương án đã duyệt ở phiên bản {deviation.baselineVersionNo} ({BUSINESS_PLAN_DEVIATION_MODE_LABELS[deviation.mode].toLowerCase()}):{' '}
          {deviation.deviationPercent === null ? 'không tính được mức lệch' : `lệch ${formatPercent(deviation.deviationPercent)}`}, vượt ngưỡng{' '}
          {formatPercent(deviation.thresholdPercent)}. Cần trình duyệt lại.
        </p>
      ) : null}
      <PlanReasons detail={detail} />
      {!costVisible ? <p className={styles.muted}>Bạn không có quyền xem giá vốn và lợi nhuận nên các số này được ẩn.</p> : null}
      {error ? <p className={styles.alert}>{error}</p> : null}

      {costVisible ? (
        <div>
          <div role="table" aria-label="Dòng chi phí" style={{ display: 'grid', gap: 6 }}>
            <div role="row" className={styles.muted} style={{ ...ROW, fontWeight: 600 }}>
              <span role="columnheader">Loại</span>
              <span role="columnheader">Diễn giải</span>
              <span role="columnheader" style={{ textAlign: 'right' }}>
                Số tiền
              </span>
              <span />
            </div>
            {(editing ? drafts : draftsFromPlan(plan)).map((draft, index) => (
              <div role="row" key={draft.key} style={ROW}>
                {editing ? (
                  <>
                    <SearchableSelect
                      options={KIND_OPTIONS}
                      value={draft.kind}
                      onChange={(value) => setDrafts((list) => list.map((item, at) => (at === index ? { ...item, kind: value as PlanLineDraft['kind'] } : item)))}
                    />
                    <input
                      className={styles.input}
                      aria-label={`Diễn giải dòng ${index + 1}`}
                      maxLength={500}
                      value={draft.description}
                      onChange={(event) => setDrafts((list) => list.map((item, at) => (at === index ? { ...item, description: event.target.value } : item)))}
                    />
                    <input
                      className={styles.input}
                      style={{ textAlign: 'right' }}
                      aria-label={`Số tiền dòng ${index + 1}`}
                      inputMode="decimal"
                      value={draft.amount}
                      onChange={(event) => setDrafts((list) => list.map((item, at) => (at === index ? { ...item, amount: event.target.value } : item)))}
                    />
                    <button type="button" className={styles.rowActionDanger} onClick={() => setDrafts((list) => list.filter((_, at) => at !== index))}>
                      Xoá
                    </button>
                  </>
                ) : (
                  <>
                    <span>{BUSINESS_PLAN_COST_KIND_LABELS[draft.kind]}</span>
                    <span>{draft.description}</span>
                    <span style={{ textAlign: 'right' }}>{formatMoney(Number(draft.amount))}</span>
                    <span />
                  </>
                )}
              </div>
            ))}
            {(editing ? drafts : plan.lines).length === 0 ? <p className={styles.muted}>Chưa có dòng chi phí.</p> : null}
          </div>
          {editing ? (
            <div className={styles.toolbar}>
              <button
                type="button"
                className={styles.buttonGhost}
                disabled={busy || drafts.length >= BUSINESS_PLAN_LINES_MAX}
                onClick={() => setDrafts((list) => [...list, { key: newKey(), kind: 'OTHER', description: '', amount: '' }])}
              >
                <Plus size={14} /> Thêm dòng chi phí
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {editing ? (
        <Field label="Ghi chú" wide>
          <textarea className={styles.textarea} rows={2} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      ) : plan.note ? (
        <p className={styles.muted}>Ghi chú: {plan.note}</p>
      ) : null}

      <dl className={local.totals}>
        <dt>Tiền hàng theo giá gốc</dt>
        <dd>{formatMoney(plan.visibleFigures.grossAmount)}</dd>
        <dt>Chiết khấu ({formatPercent(plan.visibleFigures.discountPercent)})</dt>
        <dd>{formatMoney(plan.visibleFigures.discountAmount)}</dd>
        <dt>Tổng doanh thu</dt>
        <dd>{formatMoney(plan.visibleFigures.revenue)}</dd>
        {costVisible && shown ? (
          <>
            <dt>Giá vốn hàng</dt>
            <dd>{formatMoney(shown.goodsCost)}</dd>
            <dt>Tổng chi phí của phương án</dt>
            <dd>{formatMoney(editing ? total : shown.extraCostTotal)}</dd>
            <dt>Tổng giá vốn và chi phí</dt>
            <dd>{formatMoney(shown.totalCost)}</dd>
            <dt className={local.grandTotal}>Lợi nhuận</dt>
            <dd className={local.grandTotal}>
              {formatMoney(shown.profit)}
              {shown.marginPercent === null ? '' : ` (tỷ suất ${formatPercent(shown.marginPercent)})`}
            </dd>
          </>
        ) : null}
      </dl>
      {editing && dirty && costVisible ? <p className={styles.muted}>Có thay đổi chưa lưu; số liệu lợi nhuận cập nhật sau khi lưu.</p> : null}

      {actions.length ? (
        <div className={styles.toolbar}>
          {actions.includes('save') ? (
            <button type="button" className={styles.buttonGhost} disabled={busy || !dirty} onClick={() => void save()}>
              Lưu phương án
            </button>
          ) : null}
          {actions.includes('submit') ? (
            <button type="button" className={styles.buttonPrimary} disabled={busy} onClick={() => void act('submit')}>
              Trình duyệt phương án
            </button>
          ) : null}
          {actions.includes('approve') ? (
            <Popconfirm
              title="Duyệt phương án kinh doanh?"
              okText="Duyệt"
              cancelText="Huỷ"
              onConfirm={() => act('approve').then(() => undefined)}
            >
              <button type="button" className={styles.buttonPrimary} disabled={busy}>
                Duyệt phương án
              </button>
            </Popconfirm>
          ) : null}
          {actions.includes('reject') ? (
            <button type="button" className={styles.buttonDangerGhost} disabled={busy} onClick={() => setRejecting(true)}>
              Từ chối phương án
            </button>
          ) : null}
        </div>
      ) : null}

      {plan.rounds.length ? (
        <>
          <h4 className={styles.sectionTitle}>Các vòng duyệt</h4>
          <ol className={styles.timeline}>
            {plan.rounds.map((round) => (
              <li key={`${round.roundNo}-${round.quoteVersionNo}`} className={styles.timelineItem}>
                <div>
                  <div className={styles.timelineTitle}>
                    Vòng {round.roundNo} · phiên bản {round.quoteVersionNo}:{' '}
                    {round.decision === 'APPROVED' ? 'Đã duyệt' : round.decision === 'REJECTED' ? 'Từ chối' : 'Chờ duyệt'}
                  </div>
                  {round.reason ? <div className={styles.muted}>{round.reason}</div> : null}
                  {round.figures ? (
                    <div className={styles.muted}>
                      Lúc trình: doanh thu {formatMoney(round.figures.revenue)}, lợi nhuận {formatMoney(round.figures.profit)}
                    </div>
                  ) : null}
                  <div className={styles.timelineMeta}>
                    Trình {formatDateTime(round.submittedAt)} · {personName(people, round.submittedBy)}
                    {round.decidedAt ? ` · Quyết định ${formatDateTime(round.decidedAt)} · ${round.decidedBy ? personName(people, round.decidedBy) : ''}` : ''}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : null}

      {rejecting ? (
        <ReasonPrompt
          onClose={() => setRejecting(false)}
          onConfirm={async (reason) => {
            if (await act('reject', reason)) setRejecting(false);
          }}
        />
      ) : null}
    </section>
  );
}

/** Lý do cần duyệt liên quan phương án kinh doanh (lệch ngưỡng, cần duyệt phương án). */
function PlanReasons({ detail }: { detail: QuoteDetail }) {
  const reasons = planReasons([...(detail.approvalCheck ?? []), ...detail.version.approvalReasons]);
  if (!reasons.length) return null;
  return (
    <div className={styles.warning} role="status">
      <ul>
        {reasons.map((reason) => (
          <li key={`${reason.code}-${reason.message}`}>{reason.message}</li>
        ))}
      </ul>
    </div>
  );
}

function ReasonPrompt({ onClose, onConfirm }: { onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  async function save() {
    if (!reason.trim()) return setError('Vui lòng ghi lý do.');
    setSaving(true);
    try {
      await onConfirm(reason.trim());
    } finally {
      setSaving(false);
    }
  }
  return (
    <CrmDialog open danger title="Từ chối phương án kinh doanh" submitLabel="Xác nhận" submitting={saving} error={error} onClose={onClose} onSubmit={() => void save()}>
      <Field label="Lý do" required wide>
        <textarea className={styles.textarea} rows={3} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
    </CrmDialog>
  );
}
