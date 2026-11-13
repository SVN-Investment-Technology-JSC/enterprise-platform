'use client';

import type { CorrespondenceConfig } from '@enterprise-platform/contracts-correspondence';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { useEffect, useMemo, useState } from 'react';
import { createLetter, errorMessage, uploadAttachment } from '../correspondence-api';
import { catalogOptions, localToday } from '../correspondence.model';
import styles from '../correspondence.module.scss';
import { Field, FormDialog, SelectField } from './form-dialog';

interface IntakeForm {
  senderOrg: string;
  senderRef: string;
  senderDate: string;
  subject: string;
  receivedOn: string;
  dueOn: string;
  kind: string;
  urgency: string;
  confidentiality: string;
}

/** Hạn mặc định: số ngày của loại văn bản, không đặt thì theo cấu hình sổ. */
function defaultDue(config: CorrespondenceConfig, kind: string, receivedOn: string): string {
  const typeDays = config.catalog.find((item) => item.kind === 'letter_type' && item.code === kind)?.defaultDueDays;
  const days = typeDays ?? config.settings.defaultDueDays;
  if (!days || !receivedOn) return '';
  const due = new Date(`${receivedOn}T00:00:00`);
  due.setDate(due.getDate() + days);
  return localToday(due);
}

function emptyForm(config: CorrespondenceConfig): IntakeForm {
  const today = localToday();
  const kind = catalogOptions(config.catalog, 'letter_type')[0]?.value ?? '';
  return {
    senderOrg: '',
    senderRef: '',
    senderDate: '',
    subject: '',
    receivedOn: today,
    dueOn: defaultDue(config, kind, today),
    kind,
    urgency: catalogOptions(config.catalog, 'urgency')[0]?.value ?? '',
    confidentiality: catalogOptions(config.catalog, 'confidentiality')[0]?.value ?? '',
  };
}

/** Văn thư tiếp nhận công văn đến: vào sổ, cấp số đến, kèm bản quét nếu có. */
export function IntakeDialog({
  open,
  config,
  onClose,
  onCreated,
}: {
  readonly open: boolean;
  readonly config: CorrespondenceConfig;
  readonly onClose: () => void;
  readonly onCreated: (letterId: string) => void;
}) {
  const initial = useMemo(() => emptyForm(config), [config]);
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
            options={catalogOptions(config.catalog, 'letter_type')}
            value={form.kind}
            emptyText="Chưa có loại văn bản. Vào Cấu hình để thêm."
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                kind: value,
                // Hạn chưa sửa tay thì theo số ngày của loại văn bản mới.
                dueOn:
                  current.dueOn === defaultDue(config, current.kind, current.receivedOn)
                    ? defaultDue(config, value, current.receivedOn)
                    : current.dueOn,
              }))
            }
          />
        </SelectField>
        <SelectField label="Độ khẩn">
          <SearchableSelect
            options={catalogOptions(config.catalog, 'urgency')}
            value={form.urgency}
            searchInDropdown
            hideDropdownSearch
            onChange={(value) => set('urgency', value)}
          />
        </SelectField>
      </div>
      <div className={styles.formRow}>
        <SelectField label="Độ mật">
          <SearchableSelect
            options={catalogOptions(config.catalog, 'confidentiality')}
            value={form.confidentiality}
            searchInDropdown
            hideDropdownSearch
            onChange={(value) => set('confidentiality', value)}
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
