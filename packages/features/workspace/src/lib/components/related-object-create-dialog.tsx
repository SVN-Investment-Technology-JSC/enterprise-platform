'use client';

import type {
  RelatedObjectCandidate,
  RelatedObjectCreateForm,
  RelatedObjectCreatePreview,
  RelatedObjectFormField,
  RelatedObjectPreview,
} from '@enterprise-platform/contracts-workspace';
import { SearchableSelect, toast, type SearchableSelectOption } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { formatVndWhileTyping } from '../money';
import {
  applyPreviewFill,
  confirmationOf,
  createDraftError,
  createErrorMessage,
  createRequestOf,
  dependentReferenceKeys,
  formatPreviewCell,
  initialCreateDraft,
  isCreateFieldRequired,
  referenceFiltersOf,
  type CreateDraftLabels,
  type CreateDraftValues,
} from '../related-object-create.model';
import { candidateDescription, relatedDisplayLabel } from '../related-objects.model';
import * as api from '../workspace-api';
import styles from '../workspace.module.scss';
import { Dialog, Field } from './dialog';

/** Chờ một nhịp sau phím cuối rồi mới hỏi nơi lưu hồ sơ, để không gọi mỗi phím. */
const SEARCH_DEBOUNCE_MS = 300;

export interface RelatedObjectCreateDialogProps {
  /** Khoá loại cần tạo, ví dụ `crm.contract`; vắng là hộp thoại đóng. */
  readonly kind?: string;
  /** Tên loại để làm tiêu đề trong lúc chờ form, ví dụ "Hợp đồng bán". */
  readonly kindLabel?: string;
  readonly onClose: () => void;
  /** Hồ sơ vừa tạo ở module gốc (chưa gắn vào đâu). */
  readonly onCreated: (created: RelatedObjectPreview) => void;
}

/**
 * Hộp thoại "Tạo mới" một hồ sơ ở module khác, ngay trong form đang mở.
 *
 * Form do module gốc mô tả (ô, nhãn, bắt buộc, danh sách chọn); hộp thoại chỉ vẽ theo kiểu ô dùng chung: chọn bằng
 * `SearchableSelect`, ngày bằng ô lịch chung, tiền VND có dấu chấm ngăn nghìn. Lưu là gửi cho module gốc tạo dưới
 * phiên của người dùng; module gốc từ chối (thiếu quyền, sai dữ liệu) thì hiện đúng câu của nó tại đây. Cần xác nhận
 * (ví dụ trùng mã số thuế) thì hiện danh sách cảnh báo, nút đổi thành "Vẫn lưu".
 *
 * Ô tham chiếu có `filters` tìm kèm giá trị ô nguồn (ví dụ báo giá theo khách đang chọn); người dùng đổi ô nguồn thì
 * bỏ lựa chọn cũ của ô tham chiếu. Ô có `preview` hỏi module gốc bản xem trước mỗi khi chọn (ví dụ dòng hàng sẽ nhận
 * từ báo giá), vẽ bảng chỉ đọc dưới ô và điền các ô còn trống theo `fill`; module gốc từ chối giá trị thì hiện câu của
 * nó và bỏ giá trị đó. Hộp thoại không biết nội dung các ô này là gì.
 *
 * Thường mở chồng lên một form khác: bọc trong một khối chặn `submit` lan ra form bên dưới, và tự xử lý Esc để Esc
 * không đóng luôn form bên dưới.
 */
export function RelatedObjectCreateDialog({ kind, kindLabel, onClose, onCreated }: RelatedObjectCreateDialogProps) {
  const open = Boolean(kind);
  const [form, setForm] = useState<RelatedObjectCreateForm>();
  const [loadError, setLoadError] = useState<string>();
  const [values, setValues] = useState<CreateDraftValues>({});
  const [labels, setLabels] = useState<CreateDraftLabels>({});
  const [dirty, setDirty] = useState(false);
  const [confirmation, setConfirmation] = useState<{ message: string; warnings: readonly string[] }>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [previews, setPreviews] = useState<Readonly<Record<string, RelatedObjectCreatePreview>>>({});
  const [previewLoading, setPreviewLoading] = useState<Readonly<Record<string, boolean>>>({});
  /** Giá trị vừa hỏi xem trước sau cùng của từng ô: kết quả của lần chọn cũ về muộn thì bỏ. */
  const previewRequest = useRef<Record<string, string>>({});
  // Bản mới nhất của giá trị, nhãn để điền theo bản xem trước khi kết quả về (sau một lượt chờ mạng).
  const valuesRef = useRef(values);
  const labelsRef = useRef(labels);
  valuesRef.current = values;
  labelsRef.current = labels;

  // Mỗi lần mở: hỏi module gốc form mới nhất (danh sách chọn như người phụ trách, nhóm khách có thể đã đổi).
  useEffect(() => {
    if (!kind) return;
    let alive = true;
    setForm(undefined);
    setLoadError(undefined);
    setValues({});
    setLabels({});
    setDirty(false);
    setConfirmation(undefined);
    setSubmitting(false);
    setError(undefined);
    setPreviews({});
    setPreviewLoading({});
    previewRequest.current = {};
    api
      .getRelatedObjectCreateForm(kind)
      .then((loaded) => {
        if (!alive) return;
        const draft = initialCreateDraft(loaded);
        setForm(loaded);
        setValues(draft.values);
        setLabels(draft.labels);
      })
      .catch((cause) => alive && setLoadError(createErrorMessage(cause, 'Không mở được form tạo mới lúc này.')));
    return () => {
      alive = false;
    };
  }, [kind]);

  // Esc: chỉ hộp thoại này xử lý, không lan tới form bên dưới. Đã nhập gì thì Esc không đóng (tránh mất dữ liệu).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (!submitting && !dirty) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, submitting, dirty, onClose]);

  const dropPreview = (key: string) => {
    previewRequest.current[key] = '';
    setPreviews((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setPreviewLoading((current) => ({ ...current, [key]: false }));
  };

  /** Hỏi module gốc bản xem trước cho giá trị vừa chọn; điền ô còn trống theo `fill`. */
  const loadPreview = async (field: RelatedObjectFormField, value: string) => {
    if (!kind || !form) return;
    if (!value) return dropPreview(field.key);
    previewRequest.current[field.key] = value;
    setPreviewLoading((current) => ({ ...current, [field.key]: true }));
    try {
      const preview = await api.getRelatedObjectCreatePreview(kind, field.key, value);
      if (previewRequest.current[field.key] !== value) return;
      setPreviews((current) => ({ ...current, [field.key]: preview }));
      const filled = applyPreviewFill(form, preview, valuesRef.current, labelsRef.current);
      if (filled.filled.length > 0) {
        setValues(filled.values);
        setLabels(filled.labels);
      }
    } catch (cause) {
      if (previewRequest.current[field.key] !== value) return;
      // Giá trị không dùng được (ví dụ báo giá đã gắn hợp đồng khác): bỏ chọn và hiện câu của module gốc.
      dropPreview(field.key);
      setValues((current) => ({ ...current, [field.key]: '' }));
      setLabels((current) => ({ ...current, [field.key]: '' }));
      setError(createErrorMessage(cause, 'Không đọc được bản xem trước.'));
    } finally {
      if (previewRequest.current[field.key] === value) setPreviewLoading((current) => ({ ...current, [field.key]: false }));
    }
  };

  const set = (key: string, value: string, label?: string) => {
    // Ô tham chiếu lọc theo ô này: đổi sang giá trị khác thì lựa chọn cũ của chúng có thể không còn hợp, bỏ đi.
    const dependents =
      form && value !== (values[key] ?? '')
        ? dependentReferenceKeys(form, key).filter((dependent) => (values[dependent] ?? '') !== '')
        : [];
    setValues((current) => {
      const next = { ...current, [key]: value };
      for (const dependent of dependents) next[dependent] = '';
      return next;
    });
    if (label !== undefined || dependents.length > 0) {
      setLabels((current) => {
        const next = label === undefined ? { ...current } : { ...current, [key]: label };
        for (const dependent of dependents) next[dependent] = '';
        return next;
      });
    }
    for (const dependent of dependents) dropPreview(dependent);
    setDirty(true);
    // Đổi dữ liệu thì cảnh báo cũ không còn đúng: lần lưu sau hỏi lại module gốc.
    setConfirmation(undefined);
    setError(undefined);
    const field = form?.fields.find((entry) => entry.key === key);
    if (field?.preview) void loadPreview(field, value);
  };

  const submit = async () => {
    if (!kind || !form || submitting) return;
    const invalid = createDraftError(form, values);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const created = await api.createRelatedObjectRecord(kind, createRequestOf(form, values, Boolean(confirmation)));
      toast.success(`Đã tạo ${relatedDisplayLabel(created.code, created.label)}.`);
      onCreated(created);
    } catch (cause) {
      const needsConfirm = confirmationOf(cause);
      if (needsConfirm) {
        setConfirmation(needsConfirm);
        setError(needsConfirm.message);
      } else {
        setError(createErrorMessage(cause));
      }
    } finally {
      setSubmitting(false);
    }
  };

  /** Chặn `submit` lan qua cây React ra form bên dưới (hộp thoại dựng qua portal nhưng sự kiện vẫn nổi theo cây). */
  const stopSubmit = (event: FormEvent) => event.stopPropagation();

  return (
    <div style={{ display: 'contents' }} onSubmit={stopSubmit}>
      <Dialog
        open={open}
        title={form?.title ?? (kindLabel ? `Tạo ${kindLabel.toLocaleLowerCase('vi')}` : 'Tạo hồ sơ mới')}
        subtitle={form?.subtitle}
        size="wide"
        submitLabel={confirmation ? 'Vẫn lưu' : (form?.submitLabel ?? 'Tạo')}
        submittingLabel="Đang tạo…"
        submitting={submitting}
        submitDisabled={!form}
        error={error}
        onClose={onClose}
        onSubmit={() => void submit()}
      >
        {loadError ? (
          <p role="alert" className={styles.alert}>
            {loadError}
          </p>
        ) : !form ? (
          <p className={styles.fieldHint}>Đang tải form…</p>
        ) : (
          <div className={styles.formGrid}>
            {form.fields.map((field) => (
              <Fragment key={field.key}>
                <Field
                  label={field.label}
                  hint={field.hint}
                  required={isCreateFieldRequired(field, values)}
                  className={field.wide || field.type === 'textarea' ? styles.formSpanAll : undefined}
                >
                  <CreateFieldInput
                    field={field}
                    value={values[field.key] ?? ''}
                    label={labels[field.key]}
                    filters={field.type === 'reference' ? referenceFiltersOf(field, values) : undefined}
                    disabled={submitting}
                    onChange={(value, label) => set(field.key, value, label)}
                  />
                </Field>
                {field.preview && previewLoading[field.key] && !previews[field.key] ? (
                  <p className={`${styles.fieldHint} ${styles.formSpanAll}`}>Đang tải bản xem trước…</p>
                ) : null}
                {field.preview && previews[field.key] ? <CreatePreviewTable preview={previews[field.key]} label={field.label} /> : null}
              </Fragment>
            ))}
            {confirmation ? (
              <div role="alert" className={`${styles.notice} ${styles.formSpanAll}`}>
                <strong>{confirmation.message}</strong>
                {confirmation.warnings.length > 0 ? (
                  <ul>
                    {confirmation.warnings.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                ) : null}
                <span>Bấm "Vẫn lưu" nếu đây đúng là một hồ sơ khác.</span>
              </div>
            ) : null}
          </div>
        )}
      </Dialog>
    </div>
  );
}

/** Bảng xem trước chỉ đọc dưới ô (ví dụ dòng hàng hợp đồng sẽ nhận từ báo giá). */
function CreatePreviewTable({ preview, label }: { readonly preview: RelatedObjectCreatePreview; readonly label: string }) {
  return (
    <section className={`${styles.formSpanAll} ${styles.createPreview}`} aria-label={preview.title ?? label}>
      {preview.title ? <strong>{preview.title}</strong> : null}
      {preview.note ? <p className={styles.fieldHint}>{preview.note}</p> : null}
      {preview.columns.length > 0 ? (
        <div className={styles.tableCard}>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {preview.columns.map((column) => (
                    <th key={column.key} className={column.type === 'text' ? undefined : styles.numeric}>
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.length === 0 ? (
                  <tr>
                    <td colSpan={preview.columns.length} className={styles.fieldHint}>
                      Không có dòng nào.
                    </td>
                  </tr>
                ) : (
                  preview.rows.map((row, index) => (
                    <tr key={index}>
                      {preview.columns.map((column) => (
                        <td key={column.key} className={column.type === 'text' ? undefined : styles.numeric}>
                          {formatPreviewCell(row[column.key], column.type)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}

interface CreateFieldInputProps {
  readonly field: RelatedObjectFormField;
  readonly value: string;
  /** Nhãn đã chọn của ô tham chiếu. */
  readonly label?: string;
  /** Ô tham chiếu: tham số lọc theo giá trị hiện tại của form. */
  readonly filters?: Readonly<Record<string, string>>;
  readonly disabled?: boolean;
  readonly onChange: (value: string, label?: string) => void;
}

/** Một ô theo kiểu module gốc khai báo. */
function CreateFieldInput({ field, value, label, filters, disabled, onChange }: CreateFieldInputProps) {
  switch (field.type) {
    case 'textarea':
      return (
        <textarea
          rows={3}
          value={value}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          aria-label={field.label}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case 'date':
      return (
        <DatePickerInput
          height={38}
          value={value || undefined}
          aria-label={field.label}
          disabled={disabled}
          onChange={(next) => onChange(next)}
        />
      );
    case 'money':
      return (
        <input
          inputMode="decimal"
          value={value}
          placeholder={field.placeholder ?? 'Ví dụ 2.500.000.000'}
          aria-label={field.label}
          disabled={disabled}
          onChange={(event) => onChange(formatVndWhileTyping(event.target.value))}
        />
      );
    case 'number':
      return (
        <input
          inputMode="numeric"
          value={value}
          placeholder={field.placeholder}
          aria-label={field.label}
          disabled={disabled}
          onChange={(event) =>
            onChange(event.target.value.replace((field.min ?? 0) < 0 ? /[^\d-]/g : /[^\d]/g, ''))
          }
        />
      );
    case 'select':
      return (
        <SearchableSelect
          options={(field.options ?? []).map((option) => ({
            value: option.value,
            label: option.label,
            badge: option.hint,
          }))}
          value={value}
          placeholder={field.placeholder ?? 'Chọn…'}
          emptyText="Không có lựa chọn nào khớp."
          disabled={disabled}
          clearable={!field.required}
          onChange={(next) => onChange(next)}
        />
      );
    case 'reference':
      return field.reference ? (
        <ReferenceInput
          kind={field.reference}
          field={field}
          value={value}
          label={label}
          filters={filters}
          disabled={disabled}
          onChange={onChange}
        />
      ) : null;
    default:
      return (
        <input
          value={value}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          aria-label={field.label}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}

/**
 * Ô chọn một hồ sơ cùng module (ví dụ khách hàng của hợp đồng), tìm qua đúng đường tìm của "Đối tượng liên quan".
 * Có tham số lọc thì gửi kèm, và tìm lại mỗi khi chúng đổi.
 */
function ReferenceInput({
  kind,
  field,
  value,
  label,
  filters,
  disabled,
  onChange,
}: CreateFieldInputProps & { readonly kind: string }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly RelatedObjectCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  // So theo nội dung, không theo đối tượng: form vẽ lại không làm tìm lại khi lọc không đổi.
  const filterKey = JSON.stringify(filters ?? {});

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const active = JSON.parse(filterKey) as Record<string, string>;
    const timer = setTimeout(
      () =>
        void (Object.keys(active).length > 0
          ? api.searchRelatedObjects(kind, query, active)
          : api.searchRelatedObjects(kind, query))
          .then((result) => {
            if (!alive) return;
            setResults(result.items);
            setError(undefined);
          })
          .catch((cause) => {
            if (!alive) return;
            setResults([]);
            setError(createErrorMessage(cause, 'Không tìm được hồ sơ lúc này.'));
          })
          .finally(() => alive && setLoading(false)),
      query ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [kind, query, filterKey]);

  const options = useMemo(() => {
    const list: SearchableSelectOption[] = results.map((candidate) => ({
      value: candidate.id,
      label: relatedDisplayLabel(candidate.code, candidate.label),
      description: candidateDescription(candidate.hint, candidate.status),
    }));
    if (value && !list.some((option) => option.value === value)) list.unshift({ value, label: label || value });
    return list;
  }, [results, value, label]);

  return (
    <SearchableSelect
      options={options}
      value={value}
      placeholder={field.placeholder ?? 'Gõ mã hoặc tên để tìm…'}
      emptyText={loading ? 'Đang tìm…' : (error ?? 'Không có hồ sơ nào khớp.')}
      disabled={disabled}
      clearable={!field.required}
      onSearchChange={setQuery}
      onChange={(next) => {
        if (!next) return onChange('', '');
        onChange(next, options.find((option) => option.value === next)?.label ?? next);
      }}
    />
  );
}
