'use client';

import {
  QUOTE_ADJUSTMENT_MODE_LABELS,
  QUOTE_LINK_TARGET_LABELS,
  QUOTE_LINK_TARGET_TYPES,
  type CustomFieldDefinition,
  type QuoteFollower,
  type QuoteLink,
  type QuoteLinkTargetType,
  type QuoteTemplate,
  type QuoteType,
} from '@enterprise-platform/contracts-crm';
import { Popconfirm, SearchableSelect, toast, type SearchableSelectOption } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Field } from '../components/crm-ui';
import {
  addQuoteFollower,
  addQuoteLink,
  errorMessage,
  generateQuoteCode,
  listContracts,
  listCustomers,
  listOpportunities,
  listOrders,
  listQuoteCustomFields,
  listQuoteFollowers,
  listQuoteLinks,
  listQuoteTemplates,
  listQuoteTypes,
  listQuotes,
  removeQuoteFollower,
  removeQuoteLink,
} from '../crm-api';
import { peopleOptions, useCrm } from '../crm-context';
import { personName } from '../sales.model';
import styles from '../sales.module.scss';
import {
  activeFields,
  hasLink,
  lockedOrderField,
  newFeeRow,
  quoteFormErrorMessage,
  setOrderAmountField,
  type CustomFieldTexts,
  type FeeRow,
  type OrderAmountText,
} from './quote-form-edit.model';

/** Mẫu, loại và định nghĩa trường tuỳ biến đang dùng. Tải lỗi thì để rỗng: báo giá cũ vẫn lập, sửa được. */
export function useQuoteFormLookups() {
  const [templates, setTemplates] = useState<readonly QuoteTemplate[]>([]);
  const [types, setTypes] = useState<readonly QuoteType[]>([]);
  const [fields, setFields] = useState<readonly CustomFieldDefinition[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([
      listQuoteTemplates().catch(() => []),
      listQuoteTypes().catch(() => []),
      listQuoteCustomFields().catch(() => []),
    ]).then(([nextTemplates, nextTypes, nextFields]) => {
      if (!active) return;
      setTemplates(nextTemplates);
      setTypes(nextTypes);
      setFields(nextFields);
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);
  return { templates, types, fields, loaded };
}

/** Tên báo giá, mã, ngày, hiệu lực, mẫu, loại. */
export interface GeneralState {
  readonly code: string;
  readonly name: string;
  readonly quoteDate: string;
  readonly validUntil: string;
  readonly templateId: string;
  readonly typeId: string;
}

export function GeneralFields({
  value,
  onChange,
  templates,
  types,
  codeEditable,
  generateCode,
  nameError,
  showTemplate = true,
}: {
  value: GeneralState;
  onChange: (next: GeneralState) => void;
  templates: readonly QuoteTemplate[];
  types: readonly QuoteType[];
  /** Chỉ khi báo giá còn Nháp (hoặc đang lập mới). */
  codeEditable: boolean;
  /** Đang lập mới: mã để trống thì hệ thống sinh, nút "Sinh lại" điền mã kế tiếp để xem. */
  generateCode: boolean;
  nameError?: string;
  /** `false` ở màn báo giá 2 cột: ô chọn mẫu nằm ở đầu khung xem trước (`TemplatePicker`), cạnh nút Xuất. */
  showTemplate?: boolean;
}) {
  const [generating, setGenerating] = useState(false);
  // Giá trị mới nhất: "Sinh lại" chờ API, trong lúc đó người dùng có thể gõ ô khác; ghép mã vào giá trị cũ lúc bấm sẽ làm
  // mất phần vừa gõ.
  const latest = useRef(value);
  latest.current = value;
  const set = (patch: Partial<GeneralState>) => onChange({ ...latest.current, ...patch });

  async function regenerate() {
    setGenerating(true);
    try {
      const { code } = await generateQuoteCode();
      set({ code });
    } catch (cause) {
      toast.error(quoteFormErrorMessage(cause, 'Không sinh được mã báo giá.'));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className={styles.fieldGrid}>
      <Field
        label="Mã báo giá"
        hint={generateCode ? 'Bỏ trống: hệ thống tự sinh khi lập. Có thể sửa mã khi còn Nháp.' : 'Chỉ sửa được khi báo giá còn Nháp.'}
      >
        <span className={styles.rowActions}>
          <input
            className={styles.input}
            value={value.code}
            maxLength={64}
            disabled={!codeEditable}
            aria-label="Mã báo giá"
            onChange={(event) => set({ code: event.target.value })}
          />
          {codeEditable ? (
            <button type="button" className={styles.buttonGhost} disabled={generating} onClick={() => void regenerate()}>
              Sinh lại
            </button>
          ) : null}
        </span>
      </Field>
      <Field label="Tên báo giá" required error={nameError}>
        <input
          className={styles.input}
          value={value.name}
          maxLength={200}
          aria-invalid={nameError ? true : undefined}
          onChange={(event) => set({ name: event.target.value })}
        />
      </Field>
      <Field label="Ngày báo giá">
        <DatePickerInput value={value.quoteDate || undefined} onChange={(next) => set({ quoteDate: next })} height={38} aria-label="Ngày báo giá" />
      </Field>
      <Field label="Hiệu lực đến" hint="Bỏ trống: 30 ngày kể từ hôm nay">
        <DatePickerInput value={value.validUntil || undefined} onChange={(next) => set({ validUntil: next })} height={38} aria-label="Hiệu lực đến" />
      </Field>
      {showTemplate ? (
        <Field label="Mẫu báo giá" hint={TEMPLATE_HINT}>
          <SearchableSelect
            options={templateOptions(templates)}
            value={value.templateId}
            placeholder="Mẫu mặc định"
            clearable={false}
            onChange={(next) => set({ templateId: next })}
          />
        </Field>
      ) : null}
      <Field label="Loại báo giá">
        <SearchableSelect
          options={types.map((item) => ({ value: item.id, label: item.name }))}
          value={value.typeId}
          placeholder="Loại mặc định"
          clearable={false}
          onChange={(next) => set({ typeId: next })}
        />
      </Field>
    </div>
  );
}

const modeText = (template: QuoteTemplate) =>
  `Chiết khấu ${QUOTE_ADJUSTMENT_MODE_LABELS[template.discountMode].toLowerCase()}, thuế ${QUOTE_ADJUSTMENT_MODE_LABELS[template.taxMode].toLowerCase()}`;

const TEMPLATE_HINT = 'Mẫu quyết định bố cục in và chiết khấu, thuế tính theo dòng hay theo tổng đơn';

const templateOptions = (templates: readonly QuoteTemplate[]): SearchableSelectOption[] =>
  templates.map((item) => ({ value: item.id, label: item.name, description: modeText(item) }));

/**
 * Ô chọn mẫu ở đầu khung xem trước màn báo giá 2 cột (cạnh nút Xuất): đổi mẫu là khung xem trước đổi ngay, chưa cần Lưu.
 */
export function TemplatePicker({
  templates,
  value,
  onChange,
  className,
}: {
  templates: readonly QuoteTemplate[];
  value: string;
  onChange: (templateId: string) => void;
  className?: string;
}) {
  return (
    <label className={className} title={TEMPLATE_HINT}>
      <span>Mẫu</span>
      <SearchableSelect
        name="templateId"
        options={templateOptions(templates)}
        value={value}
        placeholder="Mẫu mặc định"
        clearable={false}
        height={32}
        onChange={onChange}
      />
    </label>
  );
}

/** Chiết khấu hoặc thuế tổng đơn: % HOẶC số tiền; mẫu theo dòng thì khoá và giải thích. */
export function OrderAmountField({
  label,
  value,
  allowed,
  lineHint,
  onChange,
}: {
  label: string;
  value: OrderAmountText;
  allowed: boolean;
  lineHint: string;
  onChange: (next: OrderAmountText) => void;
}) {
  if (!allowed) {
    return (
      <div className={styles.muted} data-testid={`order-${label}-locked`}>
        <strong>{label} tổng đơn:</strong> {lineHint}
      </div>
    );
  }
  const locked = lockedOrderField(value);
  return (
    <div className={styles.fieldGrid}>
      <Field label={`${label} tổng đơn (%)`} hint="Nhập phần trăm hoặc số tiền, không nhập cả hai">
        <input
          className={styles.input}
          inputMode="decimal"
          value={value.percent}
          disabled={locked === 'percent'}
          aria-label={`${label} tổng đơn theo phần trăm`}
          onChange={(event) => onChange(setOrderAmountField(value, 'percent', event.target.value))}
        />
      </Field>
      <Field label={`${label} tổng đơn (VND)`}>
        <input
          className={styles.input}
          inputMode="decimal"
          value={value.amount}
          disabled={locked === 'amount'}
          aria-label={`${label} tổng đơn theo số tiền`}
          onChange={(event) => onChange(setOrderAmountField(value, 'amount', event.target.value))}
        />
      </Field>
    </div>
  );
}

/** Phí trên cả hợp đồng: nhiều khoản, thêm, sửa, xoá. */
export function FeesEditor({ rows, onChange }: { rows: readonly FeeRow[]; onChange: (next: FeeRow[]) => void }) {
  const patch = (key: string, change: Partial<FeeRow>) => onChange(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  return (
    <div>
      <div className={styles.sectionTitle}>Phí trên cả hợp đồng</div>
      {rows.length ? null : <p className={styles.muted}>Chưa có khoản phí nào.</p>}
      {rows.map((row, index) => (
        <div key={row.key} className={styles.fieldGrid}>
          <Field label={`Khoản phí ${index + 1}`}>
            <input
              className={styles.input}
              value={row.feeType}
              maxLength={200}
              placeholder="Loại phí"
              aria-label={`Loại phí ${index + 1}`}
              onChange={(event) => patch(row.key, { feeType: event.target.value })}
            />
          </Field>
          <Field label="Số tiền (VND)">
            <span className={styles.rowActions}>
              <input
                className={styles.input}
                inputMode="decimal"
                value={row.amount}
                aria-label={`Số tiền phí ${index + 1}`}
                onChange={(event) => patch(row.key, { amount: event.target.value })}
              />
              <button type="button" className={styles.rowActionDanger} onClick={() => onChange(rows.filter((item) => item.key !== row.key))}>
                Xoá
              </button>
            </span>
          </Field>
        </div>
      ))}
      <button type="button" className={styles.buttonGhost} onClick={() => onChange([...rows, newFeeRow()])}>
        <Plus size={14} /> Thêm khoản phí
      </button>
    </div>
  );
}

/** Trường tuỳ biến vẽ theo định nghĩa; trường bắt buộc đánh dấu *. */
export function CustomFieldsEditor({
  definitions,
  texts,
  missing,
  onChange,
}: {
  definitions: readonly CustomFieldDefinition[];
  texts: CustomFieldTexts;
  /** Tên trường bắt buộc còn thiếu (sau khi bấm lưu). */
  missing: readonly string[];
  onChange: (next: CustomFieldTexts) => void;
}) {
  const fields = activeFields(definitions);
  if (!fields.length) return <p className={styles.muted}>Chưa có trường tuỳ biến nào. Quản trị viên thêm trong Cấu hình, thẻ "Mẫu và loại báo giá".</p>;
  const set = (id: string, text: string) => onChange({ ...texts, [id]: text });
  return (
    <div className={styles.fieldGrid}>
      {fields.map((field) => {
        const text = texts[field.id] ?? '';
        const error = missing.includes(field.name) ? 'Trường bắt buộc.' : undefined;
        return (
          <Field key={field.id} label={field.name} required={field.required} error={error}>
            {field.fieldType === 'SELECT' ? (
              <SearchableSelect
                options={field.options.map((option) => ({ value: option, label: option }))}
                value={text}
                placeholder="Chọn giá trị"
                clearable={!field.required}
                onChange={(next) => set(field.id, next)}
              />
            ) : field.fieldType === 'DATE' ? (
              <DatePickerInput value={text || undefined} onChange={(next) => set(field.id, next)} height={38} aria-label={field.name} />
            ) : (
              <input
                className={styles.input}
                inputMode={field.fieldType === 'NUMBER' ? 'decimal' : undefined}
                value={text}
                maxLength={field.fieldType === 'TEXT' ? 1000 : 30}
                aria-label={field.name}
                aria-invalid={error ? true : undefined}
                onChange={(event) => set(field.id, event.target.value)}
              />
            )}
          </Field>
        );
      })}
    </div>
  );
}

/** Người theo dõi: thêm, bỏ ngay (mỗi thao tác là một lần gọi API). */
export function FollowersPanel({ quoteId, editable }: { quoteId: string; editable: boolean }) {
  const { people } = useCrm();
  const [followers, setFollowers] = useState<readonly QuoteFollower[]>([]);
  const [picked, setPicked] = useState('');
  const [error, setError] = useState<string>();

  const reload = useCallback(
    () =>
      listQuoteFollowers(quoteId)
        .then((rows) => {
          setFollowers(rows);
          setError(undefined);
        })
        .catch((cause) => setError(errorMessage(cause, 'Không tải được người theo dõi.'))),
    [quoteId],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  const taken = new Set(followers.map((item) => item.userId));
  async function add(userId: string) {
    if (!userId) return;
    try {
      await addQuoteFollower(quoteId, userId);
      setPicked('');
      await reload();
    } catch (cause) {
      toast.error(quoteFormErrorMessage(cause, 'Không thêm được người theo dõi.'));
    }
  }
  async function remove(userId: string) {
    try {
      await removeQuoteFollower(quoteId, userId);
      await reload();
    } catch (cause) {
      toast.error(quoteFormErrorMessage(cause, 'Không bỏ được người theo dõi.'));
    }
  }

  return (
    <div>
      {error ? <p className={styles.alert}>{error}</p> : null}
      {followers.length ? (
        <ul>
          {followers.map((item) => (
            <li key={item.userId}>
              {personName(people, item.userId)}{' '}
              {editable ? (
                <button type="button" className={styles.rowActionDanger} onClick={() => void remove(item.userId)}>
                  Bỏ theo dõi
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.muted}>Chưa có người theo dõi. Người theo dõi nhận thông báo khi báo giá gửi duyệt hoặc đổi trạng thái.</p>
      )}
      {editable ? (
        <SearchableSelect
          options={peopleOptions(people).filter((option) => !taken.has(option.value))}
          value={picked}
          placeholder="Thêm người theo dõi"
          onChange={(next) => {
            setPicked(next);
            void add(next);
          }}
        />
      ) : null}
    </div>
  );
}

const targetOptions = QUOTE_LINK_TARGET_TYPES.map((type) => ({ value: type, label: QUOTE_LINK_TARGET_LABELS[type] }));

async function loadTargets(type: QuoteLinkTargetType): Promise<SearchableSelectOption[]> {
  switch (type) {
    case 'CUSTOMER':
      return (await listCustomers({ limit: 100 })).items.map((item) => ({ value: item.id, label: item.name, badge: item.code }));
    case 'OPPORTUNITY':
      return (await listOpportunities({ limit: 100 })).items.map((item) => ({ value: item.id, label: item.name, description: item.customerName }));
    case 'CONTRACT':
      return (await listContracts({ limit: 100 })).items.map((item) => ({ value: item.id, label: item.title, badge: item.code, description: item.customerName }));
    case 'SALES_ORDER':
      return (await listOrders({ limit: 100 })).items.map((item) => ({ value: item.id, label: item.code, description: item.customerName }));
    case 'QUOTE':
      return (await listQuotes({ limit: 100 })).items.map((item) => ({ value: item.id, label: item.quoteName || item.code, badge: item.code, description: item.customerName }));
  }
}

/** Đối tượng liên quan: chọn loại rồi chọn đối tượng; thêm, xoá ngay. */
export function LinksPanel({ quoteId, editable }: { quoteId: string; editable: boolean }) {
  const [links, setLinks] = useState<readonly QuoteLink[]>([]);
  const [type, setType] = useState<QuoteLinkTargetType>();
  const [options, setOptions] = useState<readonly SearchableSelectOption[]>([]);
  const [target, setTarget] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const reload = useCallback(
    () =>
      listQuoteLinks(quoteId)
        .then((rows) => {
          setLinks(rows);
          setError(undefined);
        })
        .catch((cause) => setError(errorMessage(cause, 'Không tải được đối tượng liên quan.'))),
    [quoteId],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!type) return;
    let active = true;
    setLoading(true);
    setTarget('');
    loadTargets(type)
      .then((rows) => active && setOptions(rows))
      .catch(() => active && setOptions([]))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [type]);

  async function add() {
    if (!type || !target) return;
    if (hasLink(links, type, target)) {
      toast.error('Đối tượng này đã được liên kết.');
      return;
    }
    try {
      await addQuoteLink(quoteId, { targetType: type, targetId: target });
      setTarget('');
      await reload();
    } catch (cause) {
      toast.error(quoteFormErrorMessage(cause, 'Không thêm được đối tượng liên quan.'));
    }
  }

  return (
    <div>
      {error ? <p className={styles.alert}>{error}</p> : null}
      {links.length ? (
        <ul>
          {links.map((link) => (
            <li key={link.id}>
              {QUOTE_LINK_TARGET_LABELS[link.targetType]}: {link.targetLabel}{' '}
              {editable ? (
                <Popconfirm
                  title="Bỏ liên kết này?"
                  okText="Bỏ"
                  cancelText="Huỷ"
                  okType="danger"
                  onConfirm={() =>
                    removeQuoteLink(quoteId, link.id)
                      .then(() => reload())
                      .then(() => undefined)
                      .catch((cause) => {
                        toast.error(quoteFormErrorMessage(cause, 'Không bỏ được liên kết.'));
                      })
                  }
                >
                  <button type="button" className={styles.rowActionDanger}>
                    Bỏ
                  </button>
                </Popconfirm>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.muted}>Chưa liên kết với đối tượng nào.</p>
      )}
      {editable ? (
        <div className={styles.fieldGrid}>
          <Field label="Loại đối tượng">
            <SearchableSelect options={targetOptions} value={type ?? ''} placeholder="Chọn loại" onChange={(next) => setType((next || undefined) as QuoteLinkTargetType | undefined)} />
          </Field>
          <Field label="Đối tượng">
            <span className={styles.rowActions}>
              <SearchableSelect
                options={[...options]}
                value={target}
                placeholder={loading ? 'Đang tải…' : 'Tìm và chọn đối tượng'}
                disabled={!type}
                onChange={setTarget}
              />
              <button type="button" className={styles.buttonGhost} disabled={!type || !target} onClick={() => void add()}>
                Thêm
              </button>
            </span>
          </Field>
        </div>
      ) : null}
    </div>
  );
}
