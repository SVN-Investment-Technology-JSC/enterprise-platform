'use client';

import type { OpportunityDetail, OpportunityStagePlan, OpportunityStagePlanItem } from '@enterprise-platform/contracts-crm';
import { SearchableSelect, formatDate, formatDateTime, toast } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { useState } from 'react';
import { CrmDialog, Field, StatusPill } from '../components/crm-ui';
import { errorMessage, skipStage, updateStageAssignee } from '../crm-api';
import { peopleOptions, useCrm } from '../crm-context';
import {
  STAGE_PLAN_STATUS_LABELS,
  canSkipPlanItem,
  isDueOverdue,
  personName,
  stageAssigneeWarning,
  stagePlanTone,
} from '../sales.model';
import styles from '../sales.module.scss';

/**
 * Kế hoạch giai đoạn của dự án: người đảm nhận, trạng thái, hạn. Chủ dự án hoặc quản trị bán hàng
 * đổi người; người đủ điều kiện rời giai đoạn hiện tại bỏ qua được giai đoạn cho phép bỏ qua.
 */
export function StagePlanPanel({
  opportunity,
  plan,
  canEdit,
  canSkip,
  onPlan,
}: {
  opportunity: Pick<OpportunityDetail, 'id' | 'name' | 'stageInfo'>;
  plan: OpportunityStagePlan | undefined;
  canEdit: boolean;
  canSkip: boolean;
  onPlan: (plan: OpportunityStagePlan) => void;
}) {
  const { people } = useCrm();
  const [editing, setEditing] = useState<OpportunityStagePlanItem>();
  const [skipping, setSkipping] = useState<OpportunityStagePlanItem>();
  const open = opportunity.stageInfo.semantic === 'OPEN';
  const items = plan?.items ?? [];
  const missing = items.filter((item) => stageAssigneeWarning(item) && item.status !== 'SKIPPED' && item.status !== 'DONE');

  return (
    <>
      <h4 className={styles.sectionTitle}>Kế hoạch giai đoạn</h4>
      {!plan ? <p className={styles.muted}>Đang tải…</p> : null}
      {missing.length ? (
        <p className={styles.alert} role="status">
          {missing.length} giai đoạn chưa có người đảm nhận. Chủ dự án hoặc quản trị bán hàng có thể chọn người cho từng giai đoạn.
        </p>
      ) : null}
      {items.length ? (
        <ol className={styles.timeline} aria-label="Kế hoạch giai đoạn">
          {items.map((item) => {
            const warning = stageAssigneeWarning(item);
            const overdue = item.status !== 'DONE' && item.status !== 'SKIPPED' && isDueOverdue(item.dueDate);
            return (
              <li key={item.stage.id} className={styles.timelineItem}>
                <div>
                  <div className={styles.timelineTitle}>
                    {item.stage.name} <StatusPill tone={stagePlanTone(item.status)}>{STAGE_PLAN_STATUS_LABELS[item.status]}</StatusPill>
                  </div>
                  <div className={styles.timelineMeta}>
                    Người đảm nhận: {item.assigneeUserId ? personName(people, item.assigneeUserId) : 'Chưa có'}
                    {item.dueDate ? ` · Hạn: ${formatDate(item.dueDate)}${overdue ? ' (quá hạn)' : ''}` : ''}
                  </div>
                  {warning && item.status !== 'SKIPPED' && item.status !== 'DONE' ? <div className={styles.fieldError}>{warning}</div> : null}
                  {item.status === 'SKIPPED' ? (
                    <div className={styles.muted}>
                      Lý do bỏ qua: {item.skippedReason ?? ''}
                      {item.skippedAt ? ` · ${formatDateTime(item.skippedAt)}` : ''}
                      {item.skippedBy ? ` · ${personName(people, item.skippedBy)}` : ''}
                    </div>
                  ) : null}
                  {(canEdit && open && item.status !== 'DONE' && item.status !== 'SKIPPED') || (canSkip && canSkipPlanItem(item, open)) ? (
                    <span className={styles.rowActions}>
                      {canEdit && open && item.status !== 'DONE' && item.status !== 'SKIPPED' ? (
                        <button type="button" className={styles.rowAction} onClick={() => setEditing(item)}>
                          Đổi người đảm nhận
                        </button>
                      ) : null}
                      {canSkip && canSkipPlanItem(item, open) ? (
                        <button type="button" className={styles.rowActionDanger} onClick={() => setSkipping(item)}>
                          Bỏ qua giai đoạn
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : plan ? (
        <p className={styles.muted}>Chưa có kế hoạch giai đoạn.</p>
      ) : null}
      {editing ? (
        <AssigneeDialog
          opportunityId={opportunity.id}
          item={editing}
          onClose={() => setEditing(undefined)}
          onSaved={(next) => {
            onPlan(next);
            setEditing(undefined);
            toast.success('Đã cập nhật người đảm nhận.');
          }}
        />
      ) : null}
      {skipping ? (
        <SkipStageDialog
          opportunityId={opportunity.id}
          item={skipping}
          onClose={() => setSkipping(undefined)}
          onSaved={(next) => {
            onPlan(next);
            setSkipping(undefined);
            toast.success('Đã bỏ qua giai đoạn.');
          }}
        />
      ) : null}
    </>
  );
}

function AssigneeDialog({
  opportunityId,
  item,
  onClose,
  onSaved,
}: {
  opportunityId: string;
  item: OpportunityStagePlanItem;
  onClose: () => void;
  onSaved: (plan: OpportunityStagePlan) => void;
}) {
  const { people } = useCrm();
  const [assignee, setAssignee] = useState(item.assigneeUserId ?? '');
  const [dueDate, setDueDate] = useState(item.dueDate ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  async function submit() {
    setSubmitting(true);
    setError(undefined);
    try {
      onSaved(await updateStageAssignee(opportunityId, item.stage.id, { assigneeUserId: assignee || null, dueDate: dueDate || null }));
    } catch (cause) {
      setError(errorMessage(cause, 'Không đổi được người đảm nhận.'));
      setSubmitting(false);
    }
  }
  return (
    <CrmDialog open title={`Người đảm nhận: ${item.stage.name}`} submitting={submitting} error={error} onClose={onClose} onSubmit={() => void submit()}>
      <div className={styles.fieldGrid}>
        <Field label="Người đảm nhận" hint="Bỏ trống để bỏ gán" wide>
          <SearchableSelect options={peopleOptions(people)} value={assignee} placeholder="Chọn người đảm nhận" emptyText="Không tìm thấy người" clearable onChange={setAssignee} />
        </Field>
        <Field label="Hạn hoàn thành" wide>
          <DatePickerInput value={dueDate || undefined} onChange={setDueDate} height={38} aria-label="Hạn hoàn thành giai đoạn" />
        </Field>
      </div>
    </CrmDialog>
  );
}

function SkipStageDialog({
  opportunityId,
  item,
  onClose,
  onSaved,
}: {
  opportunityId: string;
  item: OpportunityStagePlanItem;
  onClose: () => void;
  onSaved: (plan: OpportunityStagePlan) => void;
}) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  async function submit() {
    if (!reason.trim()) return setError('Vui lòng ghi lý do bỏ qua giai đoạn.');
    setSubmitting(true);
    setError(undefined);
    try {
      onSaved(await skipStage(opportunityId, item.stage.id, { reason: reason.trim() }));
    } catch (cause) {
      setError(errorMessage(cause, 'Không bỏ qua được giai đoạn.'));
      setSubmitting(false);
    }
  }
  return (
    <CrmDialog open danger title={`Bỏ qua giai đoạn ${item.stage.name}`} submitLabel="Xác nhận bỏ qua" submitting={submitting} error={error} onClose={onClose} onSubmit={() => void submit()}>
      <Field label="Lý do bỏ qua" required>
        <textarea className={styles.textarea} rows={3} value={reason} maxLength={2000} autoFocus onChange={(event) => setReason(event.target.value)} />
      </Field>
    </CrmDialog>
  );
}
