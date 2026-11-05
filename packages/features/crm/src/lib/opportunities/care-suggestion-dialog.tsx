'use client';

import type { OpportunityDetail } from '@enterprise-platform/contracts-crm';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { useState } from 'react';
import { CrmDialog, Field } from '../components/crm-ui';
import { createActivity, errorMessage } from '../crm-api';
import { peopleOptions, useCrm } from '../crm-context';
import styles from '../sales.module.scss';
import {
  buildCareActivityRequest,
  defaultCareDate,
  defaultCareDescription,
  defaultCareSubject,
} from './care-suggestion.model';

/**
 * Gợi ý tạo lịch chăm sóc lại sau khi dự án Thua (P2F-01, quyết định P2-D3: chỉ gợi ý).
 * "Bỏ qua" đóng hộp thoại và không tạo gì; "Tạo lịch" tạo một hoạt động gắn dự án (và khách của dự án).
 */
export function CareSuggestionDialog({
  opportunity,
  onClose,
}: {
  opportunity: Pick<OpportunityDetail, 'id' | 'name' | 'ownerUserId'>;
  onClose: () => void;
}) {
  const { people } = useCrm();
  const [assigneeUserId, setAssigneeUserId] = useState(opportunity.ownerUserId);
  const [date, setDate] = useState(() => defaultCareDate());
  const [subject, setSubject] = useState(() => defaultCareSubject(opportunity.name));
  const [description, setDescription] = useState(() => defaultCareDescription());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    const request = buildCareActivityRequest({ opportunityId: opportunity.id, subject, description, assigneeUserId, date });
    if ('error' in request) return setError(request.error);
    setSubmitting(true);
    setError(undefined);
    try {
      await createActivity(request);
      toast.success('Đã tạo lịch chăm sóc lại.');
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, 'Không tạo được lịch chăm sóc.'));
      setSubmitting(false);
    }
  }

  return (
    <CrmDialog
      open
      title="Tạo lịch chăm sóc lại"
      subtitle={`Dự án "${opportunity.name}" đã chuyển sang Thua. Bạn có muốn hẹn lịch chăm sóc lại khách không?`}
      submitLabel="Tạo lịch"
      cancelLabel="Bỏ qua"
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <div className={styles.fieldGrid}>
        <Field label="Người phụ trách" required>
          <SearchableSelect options={peopleOptions(people)} value={assigneeUserId} placeholder="Chọn người" onChange={setAssigneeUserId} />
        </Field>
        <Field label="Ngày chăm sóc" required>
          <DatePickerInput value={date || undefined} onChange={setDate} height={38} aria-label="Ngày chăm sóc" />
        </Field>
        <Field label="Nội dung" required wide>
          <input className={styles.input} value={subject} maxLength={300} onChange={(event) => setSubject(event.target.value)} />
        </Field>
        <Field label="Ghi chú" wide>
          <textarea className={styles.textarea} rows={3} value={description} maxLength={4000} onChange={(event) => setDescription(event.target.value)} />
        </Field>
      </div>
    </CrmDialog>
  );
}
