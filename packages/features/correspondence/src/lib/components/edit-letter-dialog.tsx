'use client';

import type { CorrespondenceDirectory, LetterDetail } from '@enterprise-platform/contracts-correspondence';
import { useEffect, useMemo, useState } from 'react';
import { errorMessage, updateLetter } from '../correspondence-api';
import styles from '../correspondence.module.scss';
import { Field, FormDialog } from './form-dialog';
import { IntakeCheckFields, intakeCheckOf, intakeCheckPayload, type IntakeCheckValue } from './intake-check-fields';

interface EditForm {
  senderOrg: string;
  senderRef: string;
  senderDate: string;
  subject: string;
  receivedOn: string;
  dueOn: string;
  recipient: string;
  check: IntakeCheckValue;
}

function formOf(letter: LetterDetail): EditForm {
  return {
    check: intakeCheckOf(letter),
    senderOrg: letter.senderOrg,
    senderRef: letter.senderRef ?? '',
    senderDate: letter.senderDate ?? '',
    subject: letter.subject,
    receivedOn: letter.receivedOn,
    dueOn: letter.dueOn ?? '',
    recipient: letter.recipient ?? '',
  };
}

/** Sửa thông tin công văn khi còn mở: công văn đến sửa thông tin vào sổ, công văn đi sửa trích yếu, nơi nhận, hạn. */
export function EditLetterDialog({
  open,
  letter,
  directory,
  onClose,
  onSaved,
}: {
  readonly open: boolean;
  readonly letter: LetterDetail;
  /** Người trong tenant, để chọn người nhận đích danh. */
  readonly directory?: CorrespondenceDirectory;
  readonly onClose: () => void;
  readonly onSaved: (next: LetterDetail) => void;
}) {
  const initial = useMemo(() => formOf(letter), [letter]);
  const [form, setForm] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setForm(initial);
    setError(undefined);
  }, [open, initial]);

  const incoming = letter.direction === 'incoming';
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = (key: Exclude<keyof EditForm, 'check'>, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    setSubmitting(true);
    setError(undefined);
    try {
      onSaved(
        await updateLetter(
          letter.id,
          incoming
            ? {
                senderOrg: form.senderOrg,
                senderRef: form.senderRef,
                senderDate: form.senderDate,
                subject: form.subject,
                receivedOn: form.receivedOn,
                dueOn: form.dueOn,
                ...intakeCheckPayload(form.check, letter.restricted),
              }
            : { subject: form.subject, recipient: form.recipient, dueOn: form.dueOn },
        ),
      );
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được thông tin công văn.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormDialog
      open={open}
      title="Sửa thông tin công văn"
      subtitle={incoming ? `Số đến ${letter.incomingNo}. Số đến đã cấp không đổi.` : `Số ${letter.displayNo}. Số đã cấp không đổi.`}
      submitLabel="Lưu thay đổi"
      submitting={submitting}
      submitDisabled={!dirty}
      dirty={dirty}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      {incoming ? (
        <>
          <Field label="Cơ quan, đơn vị gửi" required>
            <input value={form.senderOrg} maxLength={255} onChange={(event) => set('senderOrg', event.target.value)} />
          </Field>
          <div className={styles.formRow}>
            <Field label="Số, ký hiệu văn bản">
              <input value={form.senderRef} maxLength={120} onChange={(event) => set('senderRef', event.target.value)} />
            </Field>
            <Field label="Ngày văn bản">
              <input type="date" value={form.senderDate} onChange={(event) => set('senderDate', event.target.value)} />
            </Field>
          </div>
        </>
      ) : null}
      <Field label="Trích yếu nội dung" required>
        <textarea value={form.subject} maxLength={1000} rows={3} onChange={(event) => set('subject', event.target.value)} />
      </Field>
      {incoming ? (
        <div className={styles.formRow}>
          <Field label="Ngày đến" required>
            <input type="date" value={form.receivedOn} onChange={(event) => set('receivedOn', event.target.value)} />
          </Field>
          <Field label="Hạn xử lý">
            <input type="date" value={form.dueOn} onChange={(event) => set('dueOn', event.target.value)} />
          </Field>
        </div>
      ) : null}
      {incoming ? (
        <IntakeCheckFields
          value={form.check}
          restricted={letter.restricted}
          directory={directory}
          onChange={(patch) => setForm((current) => ({ ...current, check: { ...current.check, ...patch } }))}
        />
      ) : (
        <div className={styles.formRow}>
          <Field label="Nơi nhận" required>
            <input value={form.recipient} maxLength={255} onChange={(event) => set('recipient', event.target.value)} />
          </Field>
          <Field label="Hạn ban hành">
            <input type="date" value={form.dueOn} onChange={(event) => set('dueOn', event.target.value)} />
          </Field>
        </div>
      )}
    </FormDialog>
  );
}
