'use client';

import type { CorrespondenceConfig, CorrespondenceDirectory } from '@enterprise-platform/contracts-correspondence';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { useEffect, useMemo, useState } from 'react';
import { createOutgoing, errorMessage, uploadAttachment } from '../correspondence-api';
import { catalogOptions, localToday, plannedWorkflow } from '../correspondence.model';
import styles from '../correspondence.module.scss';
import { Field, FormDialog, SelectField } from './form-dialog';

interface OutgoingForm {
  subject: string;
  recipient: string;
  dueOn: string;
  kind: string;
  urgency: string;
  confidentiality: string;
  authorUnitId: string;
}

/** Công văn đi trả lời một công văn đến. */
export interface ReplyTo {
  readonly letterId: string;
  readonly number: string;
  readonly subject: string;
  readonly senderOrg: string;
  readonly kind: string;
}

/**
 * Phòng ban soạn công văn đi: số dự thảo cấp ngay, đơn vị soạn thảo lấy theo sơ đồ tổ chức,
 * dự thảo lưu trong kho tài liệu của Hệ dùng chung. Có thể trả lời một công văn đến.
 */
export function OutgoingDialog({
  open,
  config,
  directory,
  replyTo,
  onClose,
  onCreated,
}: {
  readonly open: boolean;
  readonly config: CorrespondenceConfig;
  readonly directory?: CorrespondenceDirectory;
  readonly replyTo?: ReplyTo;
  readonly onClose: () => void;
  readonly onCreated: (letterId: string) => void;
}) {
  const myUnits = useMemo(
    () => (directory?.units ?? []).filter((unit) => directory?.myUnitIds.includes(unit.id)),
    [directory],
  );
  const initial = useMemo<OutgoingForm>(
    () => ({
      subject: replyTo ? `V/v trả lời công văn số ${replyTo.number}: ${replyTo.subject}`.slice(0, 1000) : '',
      recipient: replyTo?.senderOrg ?? '',
      dueOn: '',
      kind: replyTo?.kind ?? catalogOptions(config.catalog, 'letter_type')[0]?.value ?? '',
      urgency: catalogOptions(config.catalog, 'urgency')[0]?.value ?? '',
      confidentiality: catalogOptions(config.catalog, 'confidentiality')[0]?.value ?? '',
      authorUnitId: directory?.myUnitIds[0] ?? '',
    }),
    [config, directory, replyTo],
  );
  const [form, setForm] = useState(initial);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setForm(initial);
    setFiles([]);
    setError(undefined);
  }, [open, initial]);

  const dirty = files.length > 0 || (Object.keys(initial) as (keyof OutgoingForm)[]).some((key) => form[key] !== initial[key]);
  const set = <K extends keyof OutgoingForm>(key: K, value: OutgoingForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const workflow = plannedWorkflow(config, 'outgoing', form.kind);

  const submit = async () => {
    if (!form.subject.trim() || !form.recipient.trim()) {
      setError('Nhập trích yếu và nơi nhận.');
      return;
    }
    if (form.dueOn && form.dueOn < localToday()) {
      setError('Hạn ban hành không được trước hôm nay.');
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const letter = await createOutgoing({
        subject: form.subject,
        recipient: form.recipient,
        dueOn: form.dueOn || undefined,
        kind: form.kind,
        urgency: form.urgency,
        confidentiality: form.confidentiality,
        authorUnitId: form.authorUnitId || undefined,
        relatedLetterId: replyTo?.letterId,
      });
      let failed = 0;
      for (const file of files) {
        try {
          await uploadAttachment(letter.id, file, 'draft');
        } catch (cause) {
          failed += 1;
          toast.error(errorMessage(cause, `Không tải được tệp ${file.name}.`));
        }
      }
      toast.success(
        failed > 0
          ? `Đã tạo công văn đi, số dự thảo ${letter.displayNo}; ${failed} tệp chưa tải lên được, tải lại trong hồ sơ.`
          : `Đã tạo công văn đi, số dự thảo ${letter.displayNo}.`,
      );
      onCreated(letter.id);
    } catch (cause) {
      setError(errorMessage(cause, 'Không tạo được công văn đi.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormDialog
      open={open}
      title={replyTo ? 'Soạn công văn trả lời' : 'Soạn công văn đi'}
      subtitle={
        replyTo
          ? `Trả lời công văn đến số ${replyTo.number}. Gửi văn thư kiểm tra khi dự thảo xong.`
          : 'Cấp số dự thảo; gửi văn thư kiểm tra khi dự thảo xong. Số đi cấp khi văn thư ban hành.'
      }
      submitLabel="Tạo dự thảo"
      submitting={submitting}
      dirty={dirty}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field label="Trích yếu nội dung" required>
        <textarea
          value={form.subject}
          maxLength={1000}
          rows={3}
          autoFocus
          placeholder="V/v báo cáo tình hình triển khai dự án quý IV năm 2026"
          onChange={(event) => set('subject', event.target.value)}
        />
      </Field>
      <div className={styles.formRow}>
        <Field label="Nơi nhận" required>
          <input value={form.recipient} maxLength={255} placeholder="Sở Kế hoạch và Đầu tư Đà Nẵng" onChange={(event) => set('recipient', event.target.value)} />
        </Field>
        <SelectField label="Phòng ban soạn thảo">
          <SearchableSelect
            options={myUnits.map((unit) => ({ value: unit.id, label: unit.name, description: unit.path || undefined }))}
            value={form.authorUnitId}
            placeholder={myUnits.length === 0 ? 'Bạn chưa thuộc phòng ban nào trong sơ đồ tổ chức' : 'Chọn phòng ban'}
            emptyText="Bạn chưa thuộc phòng ban nào trong sơ đồ tổ chức."
            searchInDropdown
            hideDropdownSearch
            onChange={(value) => set('authorUnitId', value)}
          />
        </SelectField>
      </div>
      <div className={styles.formRow3}>
        <SelectField label="Loại văn bản">
          <SearchableSelect
            options={catalogOptions(config.catalog, 'letter_type')}
            value={form.kind}
            emptyText="Chưa có loại văn bản. Vào Cấu hình để thêm."
            onChange={(value) => set('kind', value)}
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
        <SelectField label="Độ mật">
          <SearchableSelect
            options={catalogOptions(config.catalog, 'confidentiality')}
            value={form.confidentiality}
            searchInDropdown
            hideDropdownSearch
            onChange={(value) => set('confidentiality', value)}
          />
        </SelectField>
      </div>
      <div className={styles.formRow}>
        <Field label="Hạn ban hành">
          <input type="date" value={form.dueOn} min={localToday()} onChange={(event) => set('dueOn', event.target.value)} />
        </Field>
        <Field label="Tệp dự thảo">
          <input type="file" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
        </Field>
      </div>
      <p className={styles.plan}>
        <span>Quy trình duyệt (theo cấu hình):</span> Phòng ban soạn thảo → Văn thư kiểm tra
        {workflow && workflow.steps.length > 0 ? ` → ${workflow.steps.map((step) => step.name).join(' → ')}` : ''} → Văn thư ban hành → Lưu trữ
      </p>
    </FormDialog>
  );
}
