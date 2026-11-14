'use client';

import type { CatalogItem, CorrespondenceConfig, CorrespondenceDirectory } from '@enterprise-platform/contracts-correspondence';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createOutgoing, errorMessage, uploadAttachment } from '../correspondence-api';
import { catalogOptions, flowLabels, localToday, plannedWorkflow } from '../correspondence.model';
import styles from '../correspondence.module.scss';
import { CatalogField } from './catalog-field';
import { Field, FilePickField, FormDialog, SelectField } from './form-dialog';

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
  canQuickAdd = false,
  onCatalogAdded,
}: {
  readonly open: boolean;
  readonly config: CorrespondenceConfig;
  readonly directory?: CorrespondenceDirectory;
  readonly replyTo?: ReplyTo;
  readonly onClose: () => void;
  readonly onCreated: (letterId: string) => void;
  /** Được thêm nhanh danh mục bằng nút "+". */
  readonly canQuickAdd?: boolean;
  readonly onCatalogAdded?: (item: CatalogItem) => void;
}) {
  // Mặc định phòng của người soạn, xếp lên đầu; chọn lại được mọi phòng trong sơ đồ tổ chức.
  const unitOptions = useMemo(() => {
    const mine = new Set(directory?.myUnitIds ?? []);
    return [...(directory?.units ?? [])]
      .sort((left, right) => Number(mine.has(right.id)) - Number(mine.has(left.id)) || left.name.localeCompare(right.name, 'vi'))
      .map((unit) => ({
        value: unit.id,
        label: unit.name,
        description: [mine.has(unit.id) ? 'Phòng của bạn' : undefined, unit.path || undefined].filter(Boolean).join(' · ') || undefined,
      }));
  }, [directory]);
  const initial = useMemo<OutgoingForm>(
    () => ({
      subject: replyTo ? `V/v trả lời công văn số ${replyTo.number}: ${replyTo.subject}`.slice(0, 1000) : '',
      recipient: replyTo?.senderOrg ?? '',
      dueOn: localToday(),
      kind: replyTo?.kind ?? catalogOptions(config.catalog, 'letter_type')[0]?.value ?? '',
      urgency: catalogOptions(config.catalog, 'urgency')[0]?.value ?? '',
      confidentiality: catalogOptions(config.catalog, 'confidentiality')[0]?.value ?? '',
      authorUnitId: directory?.myUnitIds[0] ?? '',
    }),
    [config, directory, replyTo],
  );
  const [form, setForm] = useState(initial);
  // Mở hộp thoại thì làm mới form; cấu hình đổi lúc đang nhập (thêm nhanh danh mục) thì giữ nguyên.
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setForm(initialRef.current);
    setFiles([]);
    setError(undefined);
  }, [open]);

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
      wide
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
            options={unitOptions}
            value={form.authorUnitId}
            placeholder="Chọn phòng ban soạn thảo"
            emptyText={directory?.degraded ? 'Chưa đọc được sơ đồ tổ chức, thử lại sau.' : 'Sơ đồ tổ chức chưa có phòng ban.'}
            onChange={(value) => set('authorUnitId', value)}
          />
        </SelectField>
      </div>
      <div className={styles.formRow3}>
        <CatalogField
          label="Loại văn bản"
          kind="letter_type"
          catalog={config.catalog}
          value={form.kind}
          canAdd={canQuickAdd}
          onAdded={onCatalogAdded}
          onChange={(value) => set('kind', value)}
        />
        <CatalogField
          label="Độ khẩn"
          kind="urgency"
          catalog={config.catalog}
          value={form.urgency}
          canAdd={canQuickAdd}
          onAdded={onCatalogAdded}
          onChange={(value) => set('urgency', value)}
        />
        <CatalogField
          label="Độ mật"
          kind="confidentiality"
          catalog={config.catalog}
          value={form.confidentiality}
          canAdd={canQuickAdd}
          onAdded={onCatalogAdded}
          onChange={(value) => set('confidentiality', value)}
        />
      </div>
      <div className={styles.formRow}>
        <Field label="Hạn ban hành">
          <input type="date" value={form.dueOn} min={localToday()} onChange={(event) => set('dueOn', event.target.value)} />
        </Field>
        <FilePickField label="Tệp dự thảo" files={files} hint="Tệp Word, PDF của dự thảo" onChange={setFiles} />
      </div>
      <p className={styles.plan}>
        <span>Quy trình (theo cấu hình):</span>{' '}
        {workflow ? flowLabels(workflow, 'outgoing').join(' → ') : 'chưa có quy trình đang dùng, nhờ người quản trị vào Cấu hình đặt quy trình mặc định'}
      </p>
    </FormDialog>
  );
}
