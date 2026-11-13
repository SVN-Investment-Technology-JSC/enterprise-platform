'use client';

import {
  LETTER_CONFIDENTIALITIES,
  LETTER_CONFIDENTIALITY_LABELS,
  LETTER_KINDS,
  LETTER_KIND_LABELS,
  LETTER_URGENCIES,
  LETTER_URGENCY_LABELS,
  type CorrespondenceSettings,
  type LetterConfidentiality,
  type LetterKind,
  type LetterUrgency,
} from '@enterprise-platform/contracts-correspondence';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { useEffect, useMemo, useState } from 'react';
import { createLetter, errorMessage, uploadAttachment } from '../correspondence-api';
import { localToday } from '../correspondence.model';
import styles from '../correspondence.module.scss';
import { Field, FormDialog, SelectField } from './form-dialog';

interface IntakeForm {
  senderOrg: string;
  senderRef: string;
  senderDate: string;
  subject: string;
  receivedOn: string;
  dueOn: string;
  kind: LetterKind;
  urgency: LetterUrgency;
  confidentiality: LetterConfidentiality;
}

function emptyForm(settings: CorrespondenceSettings): IntakeForm {
  const today = localToday();
  const due = new Date(`${today}T00:00:00`);
  due.setDate(due.getDate() + settings.defaultDueDays);
  return {
    senderOrg: '',
    senderRef: '',
    senderDate: '',
    subject: '',
    receivedOn: today,
    dueOn: settings.defaultDueDays > 0 ? localToday(due) : '',
    kind: 'other',
    urgency: 'normal',
    confidentiality: 'normal',
  };
}

const options = <T extends string>(values: readonly T[], labels: Readonly<Record<T, string>>) =>
  values.map((value) => ({ value, label: labels[value] }));

/** Văn thư tiếp nhận công văn đến: vào sổ, cấp số đến, kèm bản quét nếu có. */
export function IntakeDialog({
  open,
  settings,
  onClose,
  onCreated,
}: {
  readonly open: boolean;
  readonly settings: CorrespondenceSettings;
  readonly onClose: () => void;
  readonly onCreated: (letterId: string) => void;
}) {
  const initial = useMemo(() => emptyForm(settings), [settings]);
  const [form, setForm] = useState<IntakeForm>(initial);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setForm(initial);
    setFiles([]);
    setError(undefined);
  }, [open, initial]);

  const dirty = files.length > 0 || (Object.keys(initial) as (keyof IntakeForm)[]).some((key) => form[key] !== initial[key]);
  const set = <K extends keyof IntakeForm>(key: K, value: IntakeForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    if (!form.senderOrg.trim() || !form.subject.trim()) {
      setError('Nhập cơ quan gửi và trích yếu nội dung.');
      return;
    }
    if (form.dueOn && form.dueOn < form.receivedOn) {
      setError('Hạn xử lý không được trước ngày đến.');
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const letter = await createLetter({
        senderOrg: form.senderOrg,
        senderRef: form.senderRef || undefined,
        senderDate: form.senderDate || undefined,
        subject: form.subject,
        receivedOn: form.receivedOn || undefined,
        dueOn: form.dueOn || undefined,
        kind: form.kind,
        urgency: form.urgency,
        confidentiality: form.confidentiality,
      });
      let failed = 0;
      for (const file of files) {
        try {
          await uploadAttachment(letter.id, file, 'incoming');
        } catch (cause) {
          failed += 1;
          toast.error(errorMessage(cause, `Không tải được tệp ${file.name}.`));
        }
      }
      toast.success(
        failed > 0
          ? `Đã vào sổ công văn đến số ${letter.incomingNo}; ${failed} tệp chưa tải lên được, tải lại trong hồ sơ.`
          : `Đã vào sổ công văn đến số ${letter.incomingNo}.`,
      );
      onCreated(letter.id);
    } catch (cause) {
      setError(errorMessage(cause, 'Không vào sổ được công văn.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormDialog
      open={open}
      title="Tiếp nhận công văn đến"
      subtitle="Vào sổ và cấp số đến. Bản quét công văn lưu trong kho tài liệu của Hệ dùng chung."
      submitLabel="Vào sổ công văn"
      submitting={submitting}
      dirty={dirty}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field label="Cơ quan, đơn vị gửi" required>
        <input
          value={form.senderOrg}
          maxLength={255}
          autoFocus
          placeholder="Sở Kế hoạch và Đầu tư Đà Nẵng"
          onChange={(event) => set('senderOrg', event.target.value)}
        />
      </Field>
      <div className={styles.formRow}>
        <Field label="Số, ký hiệu văn bản">
          <input
            value={form.senderRef}
            maxLength={120}
            placeholder="1234/SKHĐT-QLDA"
            onChange={(event) => set('senderRef', event.target.value)}
          />
        </Field>
        <Field label="Ngày văn bản">
          <input type="date" value={form.senderDate} onChange={(event) => set('senderDate', event.target.value)} />
        </Field>
      </div>
      <Field label="Trích yếu nội dung" required>
        <textarea
          value={form.subject}
          maxLength={1000}
          rows={3}
          placeholder="Đề nghị báo cáo tình hình thực hiện dự án đầu tư quý IV năm 2026"
          onChange={(event) => set('subject', event.target.value)}
        />
      </Field>
      <div className={styles.formRow}>
        <Field label="Ngày đến" required>
          <input type="date" value={form.receivedOn} onChange={(event) => set('receivedOn', event.target.value)} />
        </Field>
        <Field label="Hạn xử lý">
          <input type="date" value={form.dueOn} onChange={(event) => set('dueOn', event.target.value)} />
        </Field>
      </div>
      <div className={styles.formRow}>
        <SelectField label="Loại văn bản">
          <SearchableSelect
            options={options(LETTER_KINDS, LETTER_KIND_LABELS)}
            value={form.kind}
            searchInDropdown
            hideDropdownSearch
            onChange={(value) => set('kind', (value || 'other') as LetterKind)}
          />
        </SelectField>
        <SelectField label="Độ khẩn">
          <SearchableSelect
            options={options(LETTER_URGENCIES, LETTER_URGENCY_LABELS)}
            value={form.urgency}
            searchInDropdown
            hideDropdownSearch
            onChange={(value) => set('urgency', (value || 'normal') as LetterUrgency)}
          />
        </SelectField>
      </div>
      <div className={styles.formRow}>
        <SelectField label="Độ mật">
          <SearchableSelect
            options={options(LETTER_CONFIDENTIALITIES, LETTER_CONFIDENTIALITY_LABELS)}
            value={form.confidentiality}
            searchInDropdown
            hideDropdownSearch
            onChange={(value) => set('confidentiality', (value || 'normal') as LetterConfidentiality)}
          />
        </SelectField>
        <Field label="Bản quét công văn">
          <input
            type="file"
            multiple
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
          />
        </Field>
      </div>
    </FormDialog>
  );
}
