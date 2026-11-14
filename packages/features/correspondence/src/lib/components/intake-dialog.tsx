'use client';

import {
  ENVELOPE_STATUSES,
  ENVELOPE_STATUS_LABELS,
  type CatalogItem,
  type CorrespondenceConfig,
  type CorrespondenceDirectory,
  type EnvelopeStatus,
} from '@enterprise-platform/contracts-correspondence';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createLetter, errorMessage, uploadAttachment } from '../correspondence-api';
import { catalogOptions, flowLabels, localToday, plannedWorkflow } from '../correspondence.model';
import styles from '../correspondence.module.scss';
import { CatalogField } from './catalog-field';
import { CheckGroup, Field, FilePickField, FormDialog, SelectField } from './form-dialog';

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
  envelopeStatus: EnvelopeStatus;
  sealed: boolean;
  pageCount: string;
  copyCount: string;
  addressedTo: string;
  addressedUserId: string;
}

/** Hạn mặc định: số ngày của loại văn bản, không đặt thì theo cấu hình sổ; không có số ngày thì là ngày đến. */
function defaultDue(config: CorrespondenceConfig, kind: string, receivedOn: string): string {
  const typeDays = config.catalog.find((item) => item.kind === 'letter_type' && item.code === kind)?.defaultDueDays;
  const days = typeDays ?? config.settings.defaultDueDays;
  if (!receivedOn) return '';
  if (!days) return receivedOn;
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
    senderDate: today,
    subject: '',
    receivedOn: today,
    dueOn: defaultDue(config, kind, today),
    kind,
    urgency: catalogOptions(config.catalog, 'urgency')[0]?.value ?? '',
    confidentiality: catalogOptions(config.catalog, 'confidentiality')[0]?.value ?? '',
    envelopeStatus: 'intact',
    sealed: false,
    pageCount: '',
    copyCount: '',
    addressedTo: '',
    addressedUserId: '',
  };
}

/** Văn thư tiếp nhận công văn đến: vào sổ, cấp số đến, kèm bản quét nếu có. */
export function IntakeDialog({
  open,
  config,
  directory,
  onClose,
  onCreated,
  canQuickAdd = false,
  onCatalogAdded,
}: {
  readonly open: boolean;
  readonly config: CorrespondenceConfig;
  /** Người trong tenant, để chọn người nhận khi văn bản gửi đích danh. */
  readonly directory?: CorrespondenceDirectory;
  readonly onClose: () => void;
  readonly onCreated: (letterId: string) => void;
  /** Được thêm nhanh danh mục bằng nút "+". */
  readonly canQuickAdd?: boolean;
  readonly onCatalogAdded?: (item: CatalogItem) => void;
}) {
  const initial = useMemo(() => emptyForm(config), [config]);
  // Mở hộp thoại thì làm mới form; cấu hình đổi lúc đang nhập (thêm nhanh danh mục) thì giữ nguyên.
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const [form, setForm] = useState<IntakeForm>(initial);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setForm(initialRef.current);
    setFiles([]);
    setError(undefined);
  }, [open]);

  const dirty = files.length > 0 || (Object.keys(initial) as (keyof IntakeForm)[]).some((key) => form[key] !== initial[key]);
  const set = <K extends keyof IntakeForm>(key: K, value: IntakeForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const workflow = plannedWorkflow(config, 'incoming', form.kind);

  const restricted = Boolean(config.catalog.find((item) => item.kind === 'confidentiality' && item.code === form.confidentiality)?.restricted);

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
        envelopeStatus: form.envelopeStatus,
        sealed: restricted ? form.sealed : undefined,
        pageCount: form.pageCount === '' ? undefined : Number(form.pageCount),
        copyCount: form.copyCount === '' ? undefined : Number(form.copyCount),
        addressedTo: form.addressedTo.trim() || undefined,
        addressedUserId: form.addressedUserId || undefined,
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
      wide
      title="Tiếp nhận công văn đến"
      subtitle="Vào sổ, cấp số đến; sau đó văn thư phân loại và giao phòng ban xử lý. Bản quét lưu trong kho tài liệu của Hệ dùng chung."
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
      <div className={styles.formRow3}>
        <Field label="Số, ký hiệu văn bản">
          <input value={form.senderRef} maxLength={120} placeholder="1234/SKHĐT-QLDA" onChange={(event) => set('senderRef', event.target.value)} />
        </Field>
        <Field label="Ngày văn bản">
          <input type="date" value={form.senderDate} onChange={(event) => set('senderDate', event.target.value)} />
        </Field>
        <Field label="Ngày đến" required>
          <input type="date" value={form.receivedOn} onChange={(event) => set('receivedOn', event.target.value)} />
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
      <div className={styles.formRow3}>
        <CatalogField
          label="Loại văn bản"
          kind="letter_type"
          catalog={config.catalog}
          value={form.kind}
          canAdd={canQuickAdd}
          onAdded={onCatalogAdded}
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
      <fieldset className={styles.fieldset}>
        <legend>Phân loại sơ bộ</legend>
        <div className={styles.formRow3}>
          <SelectField label="Tình trạng bì">
            <SearchableSelect
              options={ENVELOPE_STATUSES.map((value) => ({ value, label: ENVELOPE_STATUS_LABELS[value] }))}
              value={form.envelopeStatus}
              searchInDropdown
              hideDropdownSearch
              onChange={(value) => value && set('envelopeStatus', value as EnvelopeStatus)}
            />
          </SelectField>
          <Field label="Số tờ">
            <input type="number" min={0} max={10000} value={form.pageCount} onChange={(event) => set('pageCount', event.target.value)} />
          </Field>
          <Field label="Số bản">
            <input type="number" min={0} max={1000} value={form.copyCount} onChange={(event) => set('copyCount', event.target.value)} />
          </Field>
        </div>
        {restricted ? (
          <CheckGroup label="Văn bản mật">
            <label className={styles.checkRow}>
              <input type="checkbox" checked={form.sealed} onChange={(event) => set('sealed', event.target.checked)} />
              Dấu niêm phong còn nguyên
            </label>
          </CheckGroup>
        ) : null}
        <div className={styles.formRow}>
          <Field label="Gửi đích danh (cá nhân, tổ chức đoàn thể)">
            <input
              value={form.addressedTo}
              maxLength={255}
              placeholder="Để trống nếu gửi cơ quan"
              onChange={(event) => set('addressedTo', event.target.value)}
            />
          </Field>
          <SelectField label="Người nhận đích danh trong hệ thống">
            <SearchableSelect
              options={(directory?.people ?? []).map((person) => ({ value: person.userId, label: person.name }))}
              value={form.addressedUserId}
              placeholder="Chọn nếu người nhận có tài khoản"
              clearable
              onChange={(value) => set('addressedUserId', value ?? '')}
            />
            <span className={styles.hint}>Người này nhận thông báo và xem được công văn.</span>
          </SelectField>
        </div>
      </fieldset>
      <div className={styles.formRow}>
        <Field label="Hạn xử lý">
          <input type="date" value={form.dueOn} min={form.receivedOn} onChange={(event) => set('dueOn', event.target.value)} />
        </Field>
        <FilePickField label="Bản quét công văn" files={files} hint="PDF, ảnh hay tệp Word của công văn" onChange={setFiles} />
      </div>
      <p className={styles.plan}>
        <span>Quy trình (theo cấu hình):</span>{' '}
        {workflow ? flowLabels(workflow, 'incoming').join(' → ') : 'chưa có quy trình đang dùng, nhờ người quản trị vào Cấu hình đặt quy trình mặc định'}
      </p>
    </FormDialog>
  );
}
