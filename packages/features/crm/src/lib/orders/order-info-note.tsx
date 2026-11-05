'use client';

import { ORDER_INFO_NOTE_MAX, type SalesOrderDetail } from '@enterprise-platform/contracts-crm';
import { formatDateTime } from '@enterprise-platform/shared-ui';
import { useState } from 'react';
import { parseNoteInput } from '../care-notes.model';
import { CrmDialog, Field } from '../components/crm-ui';
import { errorMessage, saveOrderInfoNote } from '../crm-api';
import { useCrm } from '../crm-context';
import { personName } from '../sales.model';
import styles from '../sales.module.scss';

/** Khối "Ghi chú thông tin đơn hàng" ở chi tiết đơn bán: hiện người ghi và thời điểm (P2F-03). */
export function OrderInfoNote({
  order,
  canEdit,
  onSaved,
}: {
  order: SalesOrderDetail;
  canEdit: boolean;
  onSaved: (saved: SalesOrderDetail) => void;
}) {
  const { people } = useCrm();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const editable = canEdit && order.status !== 'CANCELLED';

  function open() {
    setText(order.infoNote ?? '');
    setError(undefined);
    setEditing(true);
  }

  async function submit() {
    const parsed = parseNoteInput(text, ORDER_INFO_NOTE_MAX, 'Ghi chú thông tin đơn hàng');
    if (!parsed.ok) return setError(parsed.message);
    setSubmitting(true);
    setError(undefined);
    try {
      onSaved(await saveOrderInfoNote(order.id, { revision: order.revision, infoNote: parsed.value }));
      setEditing(false);
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được ghi chú.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <h4 className={styles.sectionTitle}>Ghi chú thông tin đơn hàng</h4>
      <p style={{ whiteSpace: 'pre-wrap' }}>{order.infoNote ?? 'Chưa có ghi chú.'}</p>
      {order.infoNote && order.infoNotedAt ? (
        <p className={styles.muted}>
          {order.infoNotedBy ? personName(people, order.infoNotedBy) : 'Hệ thống'} · {formatDateTime(order.infoNotedAt)}
        </p>
      ) : null}
      {editable ? (
        <div className={styles.toolbar}>
          <button type="button" className={styles.buttonGhost} onClick={open}>
            {order.infoNote ? 'Sửa ghi chú' : 'Thêm ghi chú'}
          </button>
        </div>
      ) : null}
      <CrmDialog open={editing} title="Ghi chú thông tin đơn hàng" submitting={submitting} error={error} onClose={() => setEditing(false)} onSubmit={submit}>
        <Field label="Ghi chú" wide hint={`Tối đa ${ORDER_INFO_NOTE_MAX} ký tự`}>
          <textarea className={styles.textarea} rows={6} maxLength={ORDER_INFO_NOTE_MAX} value={text} onChange={(event) => setText(event.target.value)} />
        </Field>
      </CrmDialog>
    </>
  );
}
