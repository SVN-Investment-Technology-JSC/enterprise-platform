'use client';

import {
  TENDER_PLAN_STATUS_LABELS,
  TENDER_RESULT_LABELS,
  TENDER_SUBMISSION_METHOD_LABELS,
  type OpportunityDetail,
  type TenderPartner,
  type TenderProfile,
} from '@enterprise-platform/contracts-crm';
import { Popconfirm, formatDateTime, toast } from '@enterprise-platform/shared-ui';
import { useCallback, useEffect, useState } from 'react';
import { CrmDialog, Field, StatusPill } from '../components/crm-ui';
import { ContractFormDialog } from '../contracts/contracts-page';
import { deleteTenderPartner, getTender, tenderPlanAction, type TenderPlanAction } from '../crm-api';
import { useCrm } from '../crm-context';
import { formatMoney, personName } from '../sales.model';
import styles from '../sales.module.scss';
import { PartnerDialog, ResultDialog, TenderFormDialog } from './tender-dialogs';
import { TENDER_PLAN_STATUS_TONE, isTenderConflict, tenderActions, tenderErrorMessage } from './tender.model';

const DONE: Record<TenderPlanAction, string> = {
  submit: 'Đã trình duyệt phương án chào thầu.',
  approve: 'Đã duyệt phương án chào thầu.',
  reject: 'Đã từ chối phương án chào thầu.',
};

/**
 * Khối "Hồ sơ thầu" trong ngăn chi tiết dự án luồng Chào thầu: thông tin gói thầu, liên danh, duyệt phương án
 * (các vòng), kết quả Trúng/Trượt và hợp đồng từ kết quả trúng. `version` của hồ sơ chống ghi đè: 409 thì tải lại.
 */
export function TenderPanel({
  opportunity,
  onChanged,
  onOpenContract,
}: {
  opportunity: OpportunityDetail;
  onChanged: () => void;
  onOpenContract?: (id: string) => void;
}) {
  const { capabilities, people, currentUserId } = useCrm();
  const [profile, setProfile] = useState<TenderProfile | null | undefined>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'form' | 'result' | 'reject' | 'contract'>();
  const [partner, setPartner] = useState<TenderPartner | 'new'>();

  const reload = useCallback(async () => {
    try {
      setProfile(await getTender(opportunity.id));
      setError(undefined);
    } catch (cause) {
      setError(tenderErrorMessage(cause, 'Không tải được hồ sơ thầu.'));
    }
  }, [opportunity.id]);

  useEffect(() => {
    setProfile(undefined);
    void reload();
  }, [reload]);

  /** Nhận hồ sơ mới từ server sau một thao tác; `changed` báo cho ngăn chi tiết tải lại (giai đoạn có thể đổi). */
  const adopt = (next: TenderProfile, changed = false) => {
    setProfile(next);
    setError(undefined);
    if (changed) onChanged();
  };

  async function runAction(work: () => Promise<TenderProfile>, success: string, changed = false): Promise<boolean> {
    setBusy(true);
    setError(undefined);
    try {
      adopt(await work(), changed);
      toast.success(success);
      return true;
    } catch (cause) {
      const message = tenderErrorMessage(cause, 'Không thực hiện được thao tác.');
      setError(message);
      toast.error(message);
      if (isTenderConflict(cause)) await reload();
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (profile === undefined && !error) return null;
  const canCreate = capabilities.isTenantAdmin || capabilities.canWriteOpportunity;

  if (!profile) {
    return (
      <section className={styles.panel} aria-label="Hồ sơ thầu">
        <h4 className={styles.sectionTitle}>Hồ sơ thầu</h4>
        {error ? <p className={styles.alert}>{error}</p> : null}
        <p className={styles.muted}>Dự án này chưa có hồ sơ thầu.</p>
        {canCreate && opportunity.stageInfo.semantic === 'OPEN' ? (
          <div className={styles.toolbar}>
            <button type="button" className={styles.buttonPrimary} onClick={() => setDialog('form')}>
              Tạo hồ sơ thầu
            </button>
          </div>
        ) : null}
        {dialog === 'form' ? (
          <TenderFormDialog
            opportunityId={opportunity.id}
            onClose={() => setDialog(undefined)}
            onSaved={(saved) => {
              setDialog(undefined);
              adopt(saved, true);
            }}
          />
        ) : null}
      </section>
    );
  }

  const actions = tenderActions(profile, capabilities, currentUserId);
  const can = (action: (typeof actions)[number]) => actions.includes(action);
  const plan = profile.plan;
  const id = opportunity.id;

  return (
    <section className={styles.panel} aria-label="Hồ sơ thầu">
      <div className={styles.detailHead}>
        <h4 className={styles.sectionTitle}>Hồ sơ thầu</h4>
        {profile.result ? (
          <StatusPill tone={profile.result === 'WON' ? 'success' : 'danger'}>{TENDER_RESULT_LABELS[profile.result]}</StatusPill>
        ) : null}
      </div>
      {error ? <p className={styles.alert}>{error}</p> : null}
      <dl className={styles.facts}>
        <dt>Tên gói thầu</dt>
        <dd>{profile.packageName}</dd>
        <dt>Bên mời thầu</dt>
        <dd>{profile.inviterName}</dd>
        <dt>Mã gói thầu</dt>
        <dd>{profile.packageCode ?? ''}</dd>
        <dt>Hạn nộp</dt>
        <dd>{profile.submissionDeadline ? formatDateTime(profile.submissionDeadline) : ''}</dd>
        <dt>Hình thức nộp</dt>
        <dd>{profile.submissionMethod ? TENDER_SUBMISSION_METHOD_LABELS[profile.submissionMethod] : ''}</dd>
        <dt>Người nộp</dt>
        <dd>{profile.submitterUserId ? personName(people, profile.submitterUserId) : ''}</dd>
        <dt>Đã nộp lúc</dt>
        <dd>{profile.submittedAt ? formatDateTime(profile.submittedAt) : ''}</dd>
        <dt>Liên danh</dt>
        <dd>{profile.hasJointVenture ? 'Có' : 'Không'}</dd>
        <dt>Kịch bản chọn</dt>
        <dd style={{ whiteSpace: 'pre-wrap' }}>{profile.scenario ?? ''}</dd>
      </dl>
      {can('edit') ? (
        <div className={styles.toolbar}>
          <button type="button" className={styles.buttonGhost} onClick={() => setDialog('form')}>
            Sửa hồ sơ thầu
          </button>
        </div>
      ) : null}

      {profile.hasJointVenture ? (
        <>
          <h4 className={styles.sectionTitle}>Đối tác liên danh</h4>
          {profile.partners.length ? (
            <ul className={styles.timeline}>
              {profile.partners.map((item) => (
                <li key={item.id} className={styles.timelineItem}>
                  <div>
                    <div className={styles.timelineTitle}>{item.name}</div>
                    {item.scope ? <div className={styles.muted}>Phạm vi: {item.scope}</div> : null}
                  </div>
                  {can('partners') ? (
                    <div className={styles.rowActions}>
                      <button type="button" className={styles.rowAction} onClick={() => setPartner(item)}>
                        Sửa
                      </button>
                      <Popconfirm
                        title="Xoá đối tác này khỏi liên danh?"
                        okText="Xoá"
                        cancelText="Huỷ"
                        onConfirm={() => runAction(() => deleteTenderPartner(id, item.id), 'Đã xoá đối tác.').then(() => undefined)}
                      >
                        <button type="button" className={styles.rowActionDanger} disabled={busy}>
                          Xoá
                        </button>
                      </Popconfirm>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>Chưa có đối tác. Cần ít nhất một đối tác trước khi trình duyệt phương án.</p>
          )}
          {can('partners') ? (
            <div className={styles.toolbar}>
              <button type="button" className={styles.buttonGhost} onClick={() => setPartner('new')}>
                Thêm đối tác
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      <h4 className={styles.sectionTitle}>Duyệt phương án chào thầu</h4>
      <p>
        <StatusPill tone={TENDER_PLAN_STATUS_TONE[plan.status]}>{TENDER_PLAN_STATUS_LABELS[plan.status]}</StatusPill>{' '}
        <span className={styles.muted}>Vòng {plan.roundNo || 1}</span>
      </p>
      {plan.status === 'REJECTED' && plan.decisionReason ? (
        <p className={styles.warning} role="status">
          Bị từ chối{plan.decidedBy ? ` bởi ${personName(people, plan.decidedBy)}` : ''}: {plan.decisionReason}
        </p>
      ) : null}
      {profile.planLocked ? (
        <p className={styles.muted}>Phương án đang chờ duyệt nên khoá sửa kịch bản, liên danh và đối tác.</p>
      ) : null}
      {plan.status === 'APPROVED' ? (
        <p className={styles.muted}>Sửa kịch bản, liên danh hoặc đối tác sẽ đưa phương án về trạng thái đang soạn để duyệt lại.</p>
      ) : null}
      {plan.procedureInstanceCode ? <p className={styles.muted}>Hồ sơ Quy trình: {plan.procedureInstanceCode}</p> : null}
      {actions.some((item) => item === 'submit' || item === 'approve' || item === 'reject') ? (
        <div className={styles.toolbar}>
          {can('submit') ? (
            <button
              type="button"
              className={styles.buttonPrimary}
              disabled={busy}
              onClick={() => void runAction(() => tenderPlanAction(id, 'submit', { version: profile.version }), DONE.submit)}
            >
              Trình duyệt phương án
            </button>
          ) : null}
          {can('approve') ? (
            <Popconfirm
              title="Duyệt phương án chào thầu?"
              okText="Duyệt"
              cancelText="Huỷ"
              onConfirm={() => runAction(() => tenderPlanAction(id, 'approve', { version: profile.version }), DONE.approve).then(() => undefined)}
            >
              <button type="button" className={styles.buttonPrimary} disabled={busy}>
                Duyệt phương án
              </button>
            </Popconfirm>
          ) : null}
          {can('reject') ? (
            <button type="button" className={styles.buttonDangerGhost} disabled={busy} onClick={() => setDialog('reject')}>
              Từ chối phương án
            </button>
          ) : null}
        </div>
      ) : null}
      {profile.rounds.length ? (
        <ol className={styles.timeline}>
          {profile.rounds.map((round) => (
            <li key={round.id} className={styles.timelineItem}>
              <div>
                <div className={styles.timelineTitle}>
                  Vòng {round.roundNo}:{' '}
                  {round.decision === 'APPROVED' ? 'Đã duyệt' : round.decision === 'REJECTED' ? 'Bị từ chối' : 'Chờ duyệt'}
                  {round.via === 'PROCEDURE' ? ' (qua Quy trình)' : ''}
                </div>
                {round.reason ? <div className={styles.muted}>Lý do: {round.reason}</div> : null}
                <div className={styles.timelineMeta}>
                  Trình {formatDateTime(round.submittedAt)} bởi {personName(people, round.submittedBy)}
                  {round.decidedAt ? ` · Quyết định ${formatDateTime(round.decidedAt)}${round.decidedBy ? ` bởi ${personName(people, round.decidedBy)}` : ''}` : ''}
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      <h4 className={styles.sectionTitle}>Kết quả thầu</h4>
      {profile.result ? (
        <dl className={styles.facts}>
          <dt>Kết quả</dt>
          <dd>{TENDER_RESULT_LABELS[profile.result]}</dd>
          {profile.winningPrice !== null ? (
            <>
              <dt>Giá trúng thầu</dt>
              <dd>{formatMoney(profile.winningPrice)}</dd>
            </>
          ) : null}
          {profile.winnerName ? (
            <>
              <dt>Đơn vị trúng thầu</dt>
              <dd>{profile.winnerName}</dd>
            </>
          ) : null}
          {profile.lostReason ? (
            <>
              <dt>Lý do trượt</dt>
              <dd>{profile.lostReason}</dd>
            </>
          ) : null}
          {profile.resultRecordedAt ? (
            <>
              <dt>Ghi nhận</dt>
              <dd>
                {formatDateTime(profile.resultRecordedAt)}
                {profile.resultRecordedBy ? ` · ${personName(people, profile.resultRecordedBy)}` : ''}
              </dd>
            </>
          ) : null}
        </dl>
      ) : (
        <p className={styles.muted}>Chưa có kết quả. Ghi Trúng hoặc Trượt sẽ chuyển dự án sang giai đoạn tương ứng; Trúng cần phương án đã duyệt.</p>
      )}
      {can('result') ? (
        <div className={styles.toolbar}>
          <button type="button" className={styles.buttonGhost} disabled={busy} onClick={() => setDialog('result')}>
            Ghi kết quả thầu
          </button>
        </div>
      ) : null}
      {profile.result === 'WON' && profile.contractDraft ? (
        <div className={styles.toolbar}>
          <button type="button" className={styles.buttonPrimary} onClick={() => setDialog('contract')}>
            Tạo hợp đồng từ kết quả trúng
          </button>
        </div>
      ) : null}

      {dialog === 'form' ? (
        <TenderFormDialog
          opportunityId={id}
          profile={profile}
          onClose={() => setDialog(undefined)}
          onSaved={(saved) => {
            setDialog(undefined);
            adopt(saved, true);
          }}
          onConflict={reload}
        />
      ) : null}
      {partner ? (
        <PartnerDialog
          opportunityId={id}
          partner={partner === 'new' ? undefined : partner}
          onClose={() => setPartner(undefined)}
          onSaved={(saved) => {
            setPartner(undefined);
            adopt(saved);
          }}
        />
      ) : null}
      {dialog === 'result' ? (
        <ResultDialog
          opportunityId={id}
          profile={profile}
          onClose={() => setDialog(undefined)}
          onSaved={(saved) => {
            setDialog(undefined);
            adopt(saved, true);
          }}
          onConflict={reload}
        />
      ) : null}
      {dialog === 'reject' ? (
        <RejectDialog
          onClose={() => setDialog(undefined)}
          onConfirm={async (reason) => {
            const done = await runAction(() => tenderPlanAction(id, 'reject', { version: profile.version, reason }), DONE.reject);
            if (done) setDialog(undefined);
          }}
        />
      ) : null}
      {dialog === 'contract' && profile.contractDraft ? (
        <ContractFormDialog
          draft={profile.contractDraft}
          onClose={() => setDialog(undefined)}
          onSaved={(saved) => {
            setDialog(undefined);
            onOpenContract?.(saved.id);
          }}
        />
      ) : null}
    </section>
  );
}

function RejectDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  return (
    <CrmDialog
      open
      danger
      title="Từ chối phương án chào thầu"
      submitLabel="Từ chối"
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={async () => {
        if (!reason.trim()) return setError('Vui lòng nhập lý do từ chối.');
        setSubmitting(true);
        try {
          await onConfirm(reason.trim());
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <Field label="Lý do từ chối" required wide>
        <textarea className={styles.textarea} rows={4} value={reason} maxLength={2000} autoFocus onChange={(event) => setReason(event.target.value)} />
      </Field>
    </CrmDialog>
  );
}
