'use client';

import {
  TENDER_RESULT_LABELS,
  TENDER_SUBMISSION_METHOD_LABELS,
  type TenderPartner,
  type TenderProfile,
} from '@enterprise-platform/contracts-crm';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { useState } from 'react';
import { CrmDialog, Field } from '../components/crm-ui';
import { addTenderPartner, createTender, recordTenderResult, updateTender, updateTenderPartner } from '../crm-api';
import { labelOptions, peopleOptions, useCrm } from '../crm-context';
import styles from '../sales.module.scss';
import {
  EMPTY_TENDER_DRAFT,
  buildCreateRequest,
  buildResultRequest,
  buildUpdateRequest,
  draftFromProfile,
  isTenderConflict,
  tenderErrorMessage,
  type TenderDraft,
} from './tender.model';

const METHOD_OPTIONS = labelOptions(TENDER_SUBMISSION_METHOD_LABELS);
const RESULT_OPTIONS = labelOptions(TENDER_RESULT_LABELS);
const digits = (value: string) => value.replace(/[^\d]/g, '');

/** Tạo hồ sơ thầu (chưa có `profile`) hoặc sửa các trường. */
export function TenderFormDialog({
  opportunityId,
  profile,
  onClose,
  onSaved,
  onConflict,
}: {
  opportunityId: string;
  profile?: TenderProfile;
  onClose: () => void;
  onSaved: (saved: TenderProfile) => void;
  onConflict?: () => Promise<void>;
}) {
  const { people } = useCrm();
  const [draft, setDraft] = useState<TenderDraft>(profile ? draftFromProfile(profile) : EMPTY_TENDER_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const set = (patch: Partial<TenderDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const hasPartners = (profile?.partners.length ?? 0) > 0;

  async function submit() {
    setError(undefined);
    let work: () => Promise<TenderProfile>;
    if (profile) {
      const built = buildUpdateRequest(draft, profile);
      if (!built.ok) return setError(built.message);
      work = () => updateTender(opportunityId, built.body);
    } else {
      const built = buildCreateRequest(draft);
      if (!built.ok) return setError(built.message);
      work = () => createTender(opportunityId, built.body);
    }
    setSubmitting(true);
    try {
      const saved = await work();
      toast.success(profile ? 'Đã lưu hồ sơ thầu.' : 'Đã tạo hồ sơ thầu.');
      onSaved(saved);
    } catch (cause) {
      setError(tenderErrorMessage(cause, 'Không lưu được hồ sơ thầu.'));
      if (isTenderConflict(cause)) await onConflict?.();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <CrmDialog
      open
      wide
      title={profile ? 'Sửa hồ sơ thầu' : 'Tạo hồ sơ thầu'}
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field label="Tên gói thầu" required>
        <input className={styles.input} value={draft.packageName} maxLength={300} autoFocus onChange={(event) => set({ packageName: event.target.value })} />
      </Field>
      <Field label="Bên mời thầu" required>
        <input className={styles.input} value={draft.inviterName} maxLength={300} onChange={(event) => set({ inviterName: event.target.value })} />
      </Field>
      <Field label="Mã gói thầu">
        <input className={styles.input} value={draft.packageCode} maxLength={100} onChange={(event) => set({ packageCode: event.target.value })} />
      </Field>
      <Field label="Hạn nộp">
        <input className={styles.input} type="datetime-local" value={draft.submissionDeadline} onChange={(event) => set({ submissionDeadline: event.target.value })} />
      </Field>
      <Field label="Hình thức nộp">
        <SearchableSelect options={METHOD_OPTIONS} value={draft.submissionMethod} placeholder="Chọn hình thức nộp" clearable onChange={(value) => set({ submissionMethod: value })} />
      </Field>
      <Field label="Người nộp">
        <SearchableSelect options={peopleOptions(people)} value={draft.submitterUserId} placeholder="Chọn người nộp" clearable onChange={(value) => set({ submitterUserId: value })} />
      </Field>
      <Field label="Liên danh" hint={hasPartners ? 'Hãy xoá danh sách đối tác trước khi bỏ chọn liên danh.' : undefined}>
        <label>
          <input type="checkbox" checked={draft.hasJointVenture} disabled={hasPartners} onChange={(event) => set({ hasJointVenture: event.target.checked })} /> Có liên danh
        </label>
      </Field>
      <Field label="Kịch bản chọn" wide hint="Nội dung phương án chào thầu đưa đi duyệt.">
        <textarea className={styles.textarea} rows={4} value={draft.scenario} maxLength={4000} onChange={(event) => set({ scenario: event.target.value })} />
      </Field>
    </CrmDialog>
  );
}

/** Thêm hoặc sửa đối tác liên danh. */
export function PartnerDialog({
  opportunityId,
  partner,
  onClose,
  onSaved,
}: {
  opportunityId: string;
  partner?: TenderPartner;
  onClose: () => void;
  onSaved: (saved: TenderProfile) => void;
}) {
  const [name, setName] = useState(partner?.name ?? '');
  const [scope, setScope] = useState(partner?.scope ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    if (!name.trim()) return setError('Vui lòng nhập tên đối tác.');
    const body = { name: name.trim(), scope: scope.trim() || null };
    setSubmitting(true);
    setError(undefined);
    try {
      const saved = partner ? await updateTenderPartner(opportunityId, partner.id, body) : await addTenderPartner(opportunityId, body);
      toast.success(partner ? 'Đã lưu đối tác.' : 'Đã thêm đối tác.');
      onSaved(saved);
    } catch (cause) {
      setError(tenderErrorMessage(cause, 'Không lưu được đối tác.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <CrmDialog open title={partner ? 'Sửa đối tác liên danh' : 'Thêm đối tác liên danh'} submitting={submitting} error={error} onClose={onClose} onSubmit={() => void submit()}>
      <Field label="Tên đối tác" required>
        <input className={styles.input} value={name} maxLength={300} autoFocus onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="Phạm vi đảm nhận">
        <input className={styles.input} value={scope} maxLength={1000} onChange={(event) => setScope(event.target.value)} />
      </Field>
    </CrmDialog>
  );
}

/** Ghi kết quả thầu: Trúng cần giá trúng, Trượt cần lý do. */
export function ResultDialog({
  opportunityId,
  profile,
  onClose,
  onSaved,
  onConflict,
}: {
  opportunityId: string;
  profile: TenderProfile;
  onClose: () => void;
  onSaved: (saved: TenderProfile) => void;
  onConflict?: () => Promise<void>;
}) {
  const [result, setResult] = useState<string>('WON');
  const [winningPrice, setWinningPrice] = useState('');
  const [winnerName, setWinnerName] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const won = result === 'WON';

  async function submit() {
    const built = buildResultRequest({ result: won ? 'WON' : 'LOST', winningPrice, winnerName, reason }, profile.version);
    if (!built.ok) return setError(built.message);
    setSubmitting(true);
    setError(undefined);
    try {
      const saved = await recordTenderResult(opportunityId, built.body);
      toast.success(won ? 'Đã ghi kết quả: trúng thầu.' : 'Đã ghi kết quả: trượt thầu.');
      onSaved(saved);
    } catch (cause) {
      setError(tenderErrorMessage(cause, 'Không ghi được kết quả thầu.'));
      if (isTenderConflict(cause)) await onConflict?.();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <CrmDialog
      open
      danger={!won}
      title="Ghi kết quả thầu"
      subtitle="Dự án sẽ chuyển sang giai đoạn Trúng hoặc Trượt tương ứng."
      submitLabel="Ghi kết quả"
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field label="Kết quả" required>
        <SearchableSelect options={RESULT_OPTIONS} value={result} onChange={setResult} />
      </Field>
      {won ? (
        <Field label="Giá trúng thầu (đồng)" required>
          <input className={styles.input} inputMode="numeric" value={winningPrice} autoFocus onChange={(event) => setWinningPrice(digits(event.target.value))} />
        </Field>
      ) : null}
      <Field label="Đơn vị trúng thầu">
        <input className={styles.input} value={winnerName} maxLength={300} onChange={(event) => setWinnerName(event.target.value)} />
      </Field>
      {!won ? (
        <Field label="Lý do trượt" required wide>
          <textarea className={styles.textarea} rows={3} value={reason} maxLength={2000} autoFocus onChange={(event) => setReason(event.target.value)} />
        </Field>
      ) : null}
    </CrmDialog>
  );
}
