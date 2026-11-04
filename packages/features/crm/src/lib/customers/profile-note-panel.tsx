'use client';

import { CUSTOMER_PROFILE_NOTE_MAX, type CustomerDetail } from '@enterprise-platform/contracts-crm';
import { useState } from 'react';
import { parseNoteInput } from '../care-notes.model';
import { CrmDialog, Field } from '../components/crm-ui';
import { errorMessage, saveCustomerProfile } from '../crm-api';
import styles from '../sales.module.scss';

/** Khối ghi chú tự do "Chân dung khách hàng" ở tab Thông tin của hồ sơ khách (P2F-03). */
export function ProfileNotePanel({
  customer,
  canEdit,
  onSaved,
}: {
  customer: CustomerDetail;
  canEdit: boolean;
  onSaved: (saved: CustomerDetail) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  function open() {
    setText(customer.profileNote ?? '');
    setError(undefined);
    setEditing(true);
  }

  async function submit() {
    const parsed = parseNoteInput(text, CUSTOMER_PROFILE_NOTE_MAX, 'Chân dung khách hàng');
    if (!parsed.ok) return setError(parsed.message);
    setSubmitting(true);
    setError(undefined);
    try {
      onSaved(await saveCustomerProfile(customer.id, { profileNote: parsed.value, version: customer.version }));
      setEditing(false);
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được chân dung khách hàng.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h4 className={styles.sectionTitle}>Chân dung khách hàng</h4>
      <p style={{ whiteSpace: 'pre-wrap' }}>{customer.profileNote ?? 'Chưa có ghi chú. Ghi đặc điểm, thói quen mua, người quyết định, lưu ý khi chăm sóc.'}</p>
      {canEdit ? (
        <div className={styles.toolbar}>
          <button type="button" className={styles.buttonGhost} onClick={open}>
            Sửa chân dung
          </button>
        </div>
      ) : null}
      <CrmDialog open={editing} title="Chân dung khách hàng" submitting={submitting} error={error} onClose={() => setEditing(false)} onSubmit={submit}>
        <Field label="Ghi chú tự do" wide hint={`Tối đa ${CUSTOMER_PROFILE_NOTE_MAX} ký tự`}>
          <textarea className={styles.textarea} rows={8} maxLength={CUSTOMER_PROFILE_NOTE_MAX} value={text} onChange={(event) => setText(event.target.value)} />
        </Field>
      </CrmDialog>
    </div>
  );
}
