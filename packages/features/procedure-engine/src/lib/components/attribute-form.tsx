'use client';

import {
  FINANCE_VOUCHER_SOURCE_ATTRIBUTE_CODES,
  formatAttributeValue,
  isBlankAttributeValue,
  type ProcedureAttachment,
  type ProcedureAttributeDefinition,
  type ProcedureAttributeValue,
  type ProcedureInstance,
} from '@enterprise-platform/contracts-procedure-engine';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { FileText, Info } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatGroupedInput } from './grouped-number';
import type { PayeeMode, PayeePicker } from './use-payee-picker';
import styles from './attribute-form.module.scss';

export type AttributeDraft = Record<string, ProcedureAttributeValue | null>;

interface Slot {
  readonly key: string;
  readonly definition: ProcedureAttributeDefinition;
  readonly scopeLabel: string;
  /** Ô của một bước (vắng là thông tin chung của hồ sơ): để cửa sổ hồ sơ chỉ ghi "từ bước N" khi ô thuộc bước khác. */
  readonly step?: { readonly definitionStepId: string; readonly order: number };
}

/** Mọi ô thuộc tính của hồ sơ, kèm khoá lưu giá trị (cùng quy ước với server). */
export function attributeSlots(instance: ProcedureInstance): Slot[] {
  const slots: Slot[] = [];
  for (const definition of instance.flow?.attributes ?? []) {
    slots.push({ key: `process:${definition.code}`, definition, scopeLabel: 'Thông tin chung' });
  }
  for (const step of [...instance.steps].sort((left, right) => left.order - right.order)) {
    for (const definition of step.attributes ?? []) {
      slots.push({
        key: `step:${step.definitionStepId}:${definition.code}`,
        definition,
        scopeLabel: step.name,
        step: { definitionStepId: step.definitionStepId, order: step.order },
      });
    }
  }
  return slots;
}

/** Có ô nào người này được nhập lúc này không (cùng điều kiện hiện khối "Thông tin cần nhập" và nút Lưu nháp). */
export function hasEditableAttributes(instance: ProcedureInstance): boolean {
  const editable = new Set(instance.authorization?.editableAttributeKeys ?? []);
  return attributeSlots(instance).some((slot) => editable.has(slot.key));
}

const numberFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

function parseNumber(text: string): number | undefined {
  // Người dùng Việt gõ "1.000.000" (dấu chấm phân tách nghìn) hoặc "12,5" (dấu phẩy thập phân).
  const cleaned = text.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  if (!cleaned) return undefined;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Ô số tự chèn dấu chấm ngăn nghìn ngay khi gõ, để số tiền lớn như 1.000.000.000
 * không bị đọc nhầm. Giá trị chỉ gửi lên khi rời ô, như trước.
 */
function GroupedNumberInput({
  initial,
  disabled,
  onCommit,
}: {
  initial: number | undefined;
  disabled?: boolean;
  onCommit: (value: number | undefined) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const [text, setText] = useState(() => (initial === undefined ? '' : numberFormat.format(initial)));

  // React đưa con trỏ về cuối khi chuỗi hiển thị đổi; đặt lại về chỗ đã tính.
  useLayoutEffect(() => {
    const input = ref.current;
    if (input && caret.current !== null && document.activeElement === input) {
      input.setSelectionRange(caret.current, caret.current);
    }
    caret.current = null;
  });

  return (
    <input
      ref={ref}
      className={styles.input}
      inputMode="decimal"
      autoComplete="off"
      value={text}
      disabled={disabled}
      onChange={(event) => {
        const input = event.target;
        const next = formatGroupedInput(input.value, input.selectionStart ?? input.value.length);
        caret.current = next.caret;
        setText(next.text);
      }}
      onBlur={() => onCommit(parseNumber(text))}
    />
  );
}

function FieldInput({
  definition,
  value,
  disabled,
  members,
  attachments,
  onChange,
  selectHeight,
}: {
  definition: ProcedureAttributeDefinition;
  value: ProcedureAttributeValue | null | undefined;
  disabled?: boolean;
  members: readonly { userId: string; displayName: string }[];
  attachments: readonly ProcedureAttachment[];
  onChange: (next: ProcedureAttributeValue | null) => void;
  /** Chiều cao ô chọn (cửa sổ hồ sơ: 36px cho bằng các ô nhập khác); vắng là mặc định của ô chọn. */
  selectHeight?: number;
}) {
  switch (definition.type) {
    case 'text':
      return (
        <input
          className={styles.input}
          value={value?.type === 'text' ? value.value : ''}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value ? { type: 'text', value: event.target.value } : null)}
        />
      );
    case 'number':
    case 'money':
    case 'percent': {
      const current = value && (value.type === 'number' || value.type === 'money' || value.type === 'percent') ? value.value : undefined;
      return (
        <div className={styles.numberBox}>
          <GroupedNumberInput
            // Giá trị đổi từ ngoài (lưu nháp, tải lại hồ sơ) thì dựng lại ô với chuỗi mới.
            key={current === undefined ? 'empty' : String(current)}
            initial={current}
            disabled={disabled}
            onCommit={(parsed) =>
              onChange(parsed === undefined ? null : { type: definition.type as 'number' | 'money' | 'percent', value: parsed })
            }
          />
          {definition.type === 'money' ? <span className={styles.unit}>đ</span> : null}
          {definition.type === 'percent' ? <span className={styles.unit}>%</span> : null}
        </div>
      );
    }
    case 'date':
      return (
        <DatePickerInput
          height={36}
          value={value?.type === 'date' ? value.value : ''}
          disabled={disabled}
          onChange={(next) => onChange(next ? { type: 'date', value: next } : null)}
        />
      );
    case 'select':
      return (
        <SearchableSelect
          options={(definition.options ?? []).map((option) => ({ value: option.code, label: option.label }))}
          value={value?.type === 'select' ? value.value : ''}
          placeholder="Chọn…"
          height={selectHeight}
          disabled={disabled}
          onChange={(next) => onChange(next ? { type: 'select', value: next } : null)}
        />
      );
    case 'boolean': {
      const current = value?.type === 'boolean' ? value.value : undefined;
      return (
        <div className={styles.toggle} role="radiogroup" aria-label={definition.name}>
          {[true, false].map((option) => (
            <button
              key={String(option)}
              type="button"
              role="radio"
              aria-checked={current === option}
              className={current === option ? styles.toggleOn : undefined}
              disabled={disabled}
              onClick={() => onChange(current === option ? null : { type: 'boolean', value: option })}
            >
              {option ? 'Có' : 'Không'}
            </button>
          ))}
        </div>
      );
    }
    case 'user':
      return (
        <SearchableSelect
          options={members.map((member) => ({ value: member.userId, label: member.displayName }))}
          value={value?.type === 'user' ? value.value : ''}
          placeholder="Chọn người…"
          height={selectHeight}
          disabled={disabled}
          onChange={(next) =>
            onChange(
              next
                ? { type: 'user', value: next, label: members.find((member) => member.userId === next)?.displayName }
                : null,
            )
          }
        />
      );
    case 'file': {
      const chosen = new Set(value?.type === 'file' ? value.value : []);
      if (!attachments.length) {
        return <p className={styles.hint}>Chưa có tệp nào trong hồ sơ.</p>;
      }
      return (
        <div className={styles.fileList}>
          {attachments.map((file) => (
            <label key={file.id}>
              <input
                type="checkbox"
                checked={chosen.has(file.id)}
                disabled={disabled}
                onChange={(event) => {
                  const next = new Set(chosen);
                  if (event.target.checked) next.add(file.id);
                  else next.delete(file.id);
                  onChange(next.size ? { type: 'file', value: [...next] } : null);
                }}
              />
              <span>{file.fileName}</span>
            </label>
          ))}
        </div>
      );
    }
  }
}

/** Lựa chọn giữ tên đang lưu không khớp thành viên nào (dữ liệu cũ, người ngoài đã gõ trước đây). */
const KEEP_PAYEE_TEXT = '__payee_text__';

/** Gợi ý khi hồ sơ nhân sự của người nhận không có (hoặc người đang nhập không được xem) STK, ngân hàng. */
const PAYEE_HINT = 'Chưa có STK trong hồ sơ nhân sự hoặc bạn không có quyền xem; nhập tay nếu cần.';

/** Ô chữ dài (nội dung, mô tả, diễn giải...) theo nhãn hay mã: cửa sổ hồ sơ vẽ thành ô nhiều dòng trọn bề ngang lưới. */
const LONG_TEXT_NAME = /^(nội dung|mô tả|diễn giải|ghi chú|lý do)/iu;
const LONG_TEXT_CODE = /^(noi_dung|mo_ta|dien_giai|ghi_chu|ly_do|content|description)/i;

/**
 * Khoá các ô chữ dài của hồ sơ: ô "nội dung" mà bước Tài chính lấy làm nội dung phiếu (theo ánh xạ đã khai, hay cùng bộ mã
 * `FINANCE_VOUCHER_SOURCE_ATTRIBUTE_CODES.content`), cùng mọi ô chữ có mã / nhãn rõ là chữ dài. Chỉ để trình bày.
 */
export function longTextSlotKeys(instance: ProcedureInstance): Set<string> {
  const mapped = instance.steps.find((step) => step.integration?.voucherKind === 'PAYMENT')?.integration?.mapping?.content;
  const contentCodes = new Set(FINANCE_VOUCHER_SOURCE_ATTRIBUTE_CODES.content.map((code) => code.toLowerCase()));
  const keys = new Set<string>();
  for (const slot of attributeSlots(instance)) {
    if (slot.definition.type !== 'text') continue;
    const code = slot.definition.code.toLowerCase();
    if (
      slot.key === mapped ||
      contentCodes.has(code) ||
      LONG_TEXT_CODE.test(code) ||
      LONG_TEXT_NAME.test(slot.definition.name.trim())
    ) {
      keys.add(slot.key);
    }
  }
  return keys;
}

/** Chữ dài hơn ngần này ký tự (hay có xuống dòng) thì khối giá trị chỉ đọc cho trọn bề ngang. */
const LONG_VALUE_LENGTH = 60;

const PAYEE_VALUE_FIELDS = ['counterpartyName', 'counterpartyAccountNo', 'counterpartyBank'] as const;

/**
 * Khoá các ô người nhận tiền (Người nhận, STK, Ngân hàng) để khối giá trị chỉ đọc xếp liền nhau, theo thứ tự đó. Cùng
 * cách nhận ra như lúc nhập (ánh xạ của bước lập phiếu chi, không có thì bộ mã chuẩn) nhưng không cần ô đang mở. Không có
 * ô "Người nhận" thì không gom. Chỉ để trình bày.
 */
function readonlyPayeeKeys(instance: ProcedureInstance): string[] {
  const textSlots = attributeSlots(instance).filter((slot) => slot.definition.type === 'text');
  const mapping = instance.steps.find((step) => step.integration?.voucherKind === 'PAYMENT')?.integration?.mapping ?? {};
  const keys: string[] = [];
  for (const field of PAYEE_VALUE_FIELDS) {
    const mapped = mapping[field];
    const key = mapped
      ? textSlots.find((slot) => slot.key === mapped)?.key
      : FINANCE_VOUCHER_SOURCE_ATTRIBUTE_CODES[field]
          .map((code) => textSlots.find((slot) => slot.definition.code.toLowerCase() === code && !keys.includes(slot.key)))
          .find(Boolean)?.key;
    if (field === 'counterpartyName' && !key) return [];
    if (key) keys.push(key);
  }
  return keys;
}

/** Một giá trị đã nhập cần hiện chỉ đọc. `step` vắng là thông tin chung của hồ sơ. */
export interface AttributeValueItem {
  readonly key: string;
  readonly definition: ProcedureAttributeDefinition;
  readonly value: ProcedureAttributeValue | null | undefined;
  readonly step?: { readonly definitionStepId: string; readonly order: number };
}

/** Mọi giá trị đã nhập của hồ sơ, theo thứ tự khai báo (thông tin chung trước, rồi từng bước). */
export function attributeValueItems(instance: ProcedureInstance): AttributeValueItem[] {
  return attributeSlots(instance).map((slot) => ({ ...slot, value: instance.attributeValues?.[slot.key]?.value }));
}

/** Giá trị chỉ đọc: số tiền "3.000.000 đ", ngày dd/mm/yyyy, Có / Không, tên người, tệp là đường dẫn / thẻ tệp. */
function ReadonlyValue({
  item,
  value,
  members,
  attachments,
}: {
  item: AttributeValueItem;
  value: ProcedureAttributeValue;
  members: readonly { userId: string; displayName: string }[];
  attachments: readonly ProcedureAttachment[];
}) {
  if (value.type === 'user') {
    return <>{value.label ?? members.find((member) => member.userId === value.value)?.displayName ?? value.value}</>;
  }
  if (value.type === 'file') {
    const known = value.value.flatMap((id) => attachments.filter((file) => file.id === id));
    const missing = value.value.length - known.length;
    return (
      <span className={styles.valueFiles}>
        {known.map((file) =>
          file.downloadUrl ? (
            <a key={file.id} className={styles.valueFile} href={file.downloadUrl} target="_blank" rel="noreferrer">
              <FileText size={12} aria-hidden />
              {file.fileName}
            </a>
          ) : (
            <span key={file.id} className={styles.valueFile}>
              <FileText size={12} aria-hidden />
              {file.fileName}
            </span>
          ),
        )}
        {missing > 0 ? <span>{known.length ? `+${missing} tệp` : `${missing} tệp`}</span> : null}
      </span>
    );
  }
  return <>{formatAttributeValue(value, item.definition)}</>;
}

/**
 * Khối "Thông tin đã nhập" dùng chung cho mọi chỗ hiện giá trị chỉ đọc (khung xử lý bước đang làm, thẻ bước đã qua trên
 * tiến trình, popup xem lại bước; giao diện mới, giao diện cũ và khung nhúng). Cùng lưới co giãn với lưới ô nhập: ô ngắn
 * (tiền, số, ngày, chọn, người, có / không, chữ ngắn) mỗi ô tối thiểu 200px; chữ dài (ô nội dung, mô tả, ghi chú... như
 * lúc nhập, hay chữ dài hơn 60 ký tự / có xuống dòng) trọn bề ngang, giữ xuống dòng, không cắt; khối người nhận tiền
 * (Người nhận, STK, Ngân hàng) đứng liền nhau ở hàng riêng. Ô trống không hiện. Không ghi "Thông tin chung"; chỉ ghi
 * "bước N" (chữ nhỏ nhạt) khi ô thuộc bước khác với bước của thẻ đang hiện (`contextStepId`, id bước định nghĩa).
 */
export function AttributeValues({
  instance,
  items,
  contextStepId,
  members = [],
  attachments = [],
  heading,
  className,
}: {
  instance: ProcedureInstance;
  items: readonly AttributeValueItem[];
  contextStepId?: string;
  members?: readonly { userId: string; displayName: string }[];
  attachments?: readonly ProcedureAttachment[];
  /** Tiêu đề nhỏ phía trên (vd "Thông tin đã nhập"); vắng thì không có. */
  heading?: string;
  className?: string;
}) {
  const visible = items.filter(
    (item): item is AttributeValueItem & { value: ProcedureAttributeValue } =>
      Boolean(item.value) && !isBlankAttributeValue(item.value ?? undefined),
  );
  if (!visible.length) return null;
  const longKeys = longTextSlotKeys(instance);
  const payeeOrder = readonlyPayeeKeys(instance).filter((key) => visible.some((item) => item.key === key));
  const payeeKeys = new Set(payeeOrder);
  const isLong = (item: (typeof visible)[number]) =>
    !payeeKeys.has(item.key) &&
    item.value.type === 'text' &&
    (longKeys.has(item.key) || item.value.value.length > LONG_VALUE_LENGTH || item.value.value.includes('\n'));
  const ordered = [
    ...visible.filter((item) => !payeeKeys.has(item.key) && !isLong(item)),
    ...visible.filter(isLong),
    ...payeeOrder.flatMap((key) => visible.filter((item) => item.key === key)),
  ];
  const scopeHint = (item: AttributeValueItem) =>
    item.step && item.step.definitionStepId !== contextStepId ? `bước ${item.step.order}` : undefined;
  return (
    <section
      className={className ? `${styles.values} ${className}` : styles.values}
      aria-label={heading ?? 'Thông tin đã nhập'}
      data-attribute-values=""
    >
      {heading ? <h4 className={styles.valuesHead}>{heading}</h4> : null}
      <dl className={styles.valuesGrid}>
        {ordered.map((item) => {
          const long = isLong(item);
          const payee = payeeKeys.has(item.key);
          const hint = scopeHint(item);
          const numeric = ['money', 'number', 'percent', 'date'].includes(item.value.type);
          return (
            <div
              key={item.key}
              className={[
                styles.valueItem,
                long ? styles.valueItemLong : '',
                payee && item.key === payeeOrder[0] ? styles.valueItemPayeeStart : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-value-key={item.key}
              data-long={long ? '' : undefined}
              data-payee={payee ? '' : undefined}
            >
              <dt className={styles.valueLabel}>
                {item.definition.name}
                {hint ? <small className={styles.valueScope}>{hint}</small> : null}
              </dt>
              <dd className={numeric ? `${styles.valueText} ${styles.valueNumeric}` : styles.valueText}>
                <ReadonlyValue item={item} value={item.value} members={members} attachments={attachments} />
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

/** Ô chữ nhiều dòng của cửa sổ hồ sơ: 3 dòng, tự cao theo nội dung tới khoảng 8 dòng rồi cuộn. Giá trị vẫn là chữ thường. */
function LongTextInput({
  value,
  disabled,
  onChange,
}: {
  value: ProcedureAttributeValue | null | undefined;
  disabled?: boolean;
  onChange: (next: ProcedureAttributeValue | null) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const text = value?.type === 'text' ? value.value : '';
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
  }, [text]);
  return (
    <textarea
      ref={ref}
      className={styles.textarea}
      rows={3}
      value={text}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value ? { type: 'text', value: event.target.value } : null)}
    />
  );
}

const PAYEE_MODES: readonly (readonly [PayeeMode, string])[] = [
  ['employee', 'Nhân viên'],
  ['external', 'Khách hàng / bên ngoài'],
];

/** Chọn loại người nhận "Nhân viên | Khách hàng / bên ngoài" (cao 28px), nằm ở hàng nhãn của ô Người nhận. */
function PayeeModeSwitch({ picker, disabled }: { picker: PayeePicker; disabled?: boolean }) {
  return (
    <div className={styles.payeeMode} role="radiogroup" aria-label="Loại người nhận">
      {PAYEE_MODES.map(([mode, label]) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={picker.mode === mode}
          className={picker.mode === mode ? styles.payeeModeOn : undefined}
          disabled={disabled}
          onClick={() => picker.setMode(mode)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * Ô tên người nhận của cửa sổ hồ sơ: nhân viên thì ô chọn thành viên (như cũ); bên ngoài thì ô chữ gõ tay, cùng kích thước.
 * Vừa tự đổi sang bên ngoài thì đưa con trỏ vào ô tên.
 */
function PayeeNameField({
  value,
  members,
  picker,
  disabled,
  onChange,
}: {
  value: ProcedureAttributeValue | null | undefined;
  members: readonly { userId: string; displayName: string }[];
  picker: PayeePicker;
  disabled?: boolean;
  onChange: (next: ProcedureAttributeValue | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const external = picker.mode === 'external';
  useEffect(() => {
    if (external && picker.modeChosen) inputRef.current?.focus();
  }, [external, picker.modeChosen]);
  if (!external) return <PayeeNameSelect value={value} members={members} picker={picker} disabled={disabled} height={36} />;
  return (
    <input
      ref={inputRef}
      className={styles.input}
      autoComplete="off"
      placeholder="Tên khách hàng, nhà cung cấp, đơn vị…"
      value={value?.type === 'text' ? value.value : ''}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value ? { type: 'text', value: event.target.value } : null)}
    />
  );
}

/**
 * Ô "Người nhận" của hồ sơ thanh toán: chọn trong thành viên tổ chức, có tìm, bỏ chọn được. Giá trị lưu vẫn là chữ
 * (tên hiển thị) như ô văn bản cũ.
 */
function PayeeNameSelect({
  value,
  members,
  picker,
  disabled,
  height,
}: {
  value: ProcedureAttributeValue | null | undefined;
  members: readonly { userId: string; displayName: string }[];
  picker: PayeePicker;
  disabled?: boolean;
  height?: number;
}) {
  const text = value?.type === 'text' ? value.value : '';
  const chosen = members.find((member) => member.userId === picker.selectedUserId && member.displayName === text);
  const selected = chosen?.userId ?? members.find((member) => member.displayName === text)?.userId;
  const keep = !selected && text.trim() ? { value: KEEP_PAYEE_TEXT, label: text, description: 'Đã nhập trước đây' } : null;
  const options = members.map((member) => ({ value: member.userId, label: member.displayName }));
  return (
    <SearchableSelect
      options={keep ? [keep, ...options] : options}
      value={selected ?? (keep ? KEEP_PAYEE_TEXT : '')}
      placeholder="Chọn người nhận…"
      height={height}
      disabled={disabled}
      clearable
      onChange={(next) => {
        if (next !== KEEP_PAYEE_TEXT) picker.choose(next || null);
      }}
    />
  );
}

/**
 * Ô nhập thuộc tính trong khung xử lý.
 *
 * Chỉ mở ô nằm trong `editableAttributeKeys` do server tính; các giá trị đã
 * nhập ở bước trước hiện dạng chỉ đọc để người duyệt thấy căn cứ.
 */
export function AttributeForm({
  instance,
  draft,
  onChange,
  onSaveDraft,
  busy,
  members,
  attachments,
  payee,
  variant = 'default',
}: {
  /**
   * Chỉ đổi cách trình bày: `modal` (cửa sổ hồ sơ của giao diện mới) bỏ khung lồng, tiêu đề riêng và nút Lưu nháp (giá trị
   * vừa nhập đi cùng Hoàn tất / Phê duyệt); mọi ô của bước chung MỘT lưới co giãn, xếp: ô ngắn (số tiền, ngày, số, chọn...)
   * trước, rồi ô chữ dài (nội dung...) thành ô nhiều dòng trọn bề ngang, rồi khối người nhận tiền (chọn "Nhân viên |
   * Khách hàng / bên ngoài" + Người nhận, STK, Ngân hàng) bắt đầu hàng mới; trong mỗi nhóm giữ thứ tự khai báo. Chỉ ghi phạm
   * vi khi ô thuộc bước khác; gợi ý thiếu STK là biểu tượng có chú thích cạnh nhãn.
   */
  variant?: 'default' | 'modal';
  instance: ProcedureInstance;
  draft: AttributeDraft;
  onChange: (next: AttributeDraft) => void;
  onSaveDraft?: () => void;
  busy?: boolean;
  members: readonly { userId: string; displayName: string }[];
  attachments: readonly ProcedureAttachment[];
  /** Hồ sơ thanh toán: ô "Người nhận" thành ô chọn nhân sự (xem `usePayeePicker`). */
  payee?: PayeePicker | null;
}) {
  const editable = new Set(instance.authorization?.editableAttributeKeys ?? []);
  const slots = attributeSlots(instance);
  const open = slots.filter((slot) => editable.has(slot.key));
  // Ô trống không hiện ở khối chỉ đọc.
  const readonly = slots.filter(
    (slot) => !editable.has(slot.key) && !isBlankAttributeValue(instance.attributeValues?.[slot.key]?.value),
  );
  if (!open.length && !readonly.length) return null;
  const currentDefinitionStepId = instance.steps.find((step) => step.id === instance.currentStepId)?.definitionStepId;
  // Giá trị đã nhập (ô không mở cho người này): cùng một khối chỉ đọc ở cả hai cách trình bày.
  const readonlyValues = (className?: string) => (
    <AttributeValues
      instance={instance}
      items={readonly.map((slot) => ({ ...slot, value: instance.attributeValues?.[slot.key]?.value }))}
      contextStepId={currentDefinitionStepId}
      members={members}
      attachments={attachments}
      heading="Thông tin đã nhập"
      className={className}
    />
  );

  const valueOf = (key: string) =>
    key in draft ? draft[key] : instance.attributeValues?.[key]?.value;
  const dirty = Object.keys(draft).length > 0;
  // Gợi ý thiếu STK đặt dưới ô STK (không có ô STK thì dưới ô ngân hàng).
  const payeeHintKey = payee?.missingBankInfo ? (payee.slots.accountNo ?? payee.slots.bank) : undefined;

  // `selectHeight`: cửa sổ hồ sơ cho ô chọn cao bằng các ô nhập khác (36px).
  const control = (slot: Slot, selectHeight?: number) =>
    payee && slot.key === payee.slots.name && slot.definition.type === 'text' ? (
      <PayeeNameSelect value={valueOf(slot.key)} members={members} picker={payee} disabled={busy} height={selectHeight} />
    ) : (
      <FieldInput
        definition={slot.definition}
        value={valueOf(slot.key)}
        disabled={busy}
        members={members}
        attachments={attachments}
        onChange={(next) => onChange({ ...draft, [slot.key]: next })}
        selectHeight={selectHeight}
      />
    );
  const hint = (slot: Slot) =>
    slot.key === payeeHintKey ? <small className={styles.hint}>{PAYEE_HINT}</small> : null;

  if (variant === 'modal') {
    // Thông tin chung và ô của chính bước đang làm: không ghi phạm vi.
    const scopeTag = (slot: Slot) =>
      slot.step && slot.step.definitionStepId !== currentDefinitionStepId ? `từ bước ${slot.step.order}` : undefined;
    const payeeKeys = new Set(
      payee ? [payee.slots.name, payee.slots.accountNo, payee.slots.bank].filter((key): key is string => Boolean(key)) : [],
    );
    const longKeys = longTextSlotKeys(instance);
    const isLong = (slot: Slot) => longKeys.has(slot.key) && !payeeKeys.has(slot.key);
    // Thứ tự: ô ngắn, ô chữ dài, rồi khối người nhận tiền (Người nhận, STK, Ngân hàng); trong mỗi nhóm giữ thứ tự khai báo.
    const payeeOrder = payee ? [payee.slots.name, payee.slots.accountNo, payee.slots.bank] : [];
    const ordered = [
      ...open.filter((slot) => !payeeKeys.has(slot.key) && !isLong(slot)),
      ...open.filter(isLong),
      ...payeeOrder.flatMap((key) => open.filter((slot) => slot.key === key)),
    ];
    // Gợi ý thiếu STK: biểu tượng có chú thích cạnh nhãn ô STK (không có ô STK thì ô ngân hàng), chỉ khi người nhận là
    // nhân viên. Luôn vẽ, chỉ ẩn / hiện, nên đổi người nhận không thêm bớt phần tử, không đẩy lệch các ô cùng hàng.
    const hintSlot = payee ? (payee.slots.accountNo ?? payee.slots.bank) : undefined;
    const hintOn = Boolean(payee?.missingBankInfo) && payee?.mode === 'employee';
    const labelText = (slot: Slot) => {
      const tag = scopeTag(slot);
      return (
        <>
          {slot.definition.name}
          {slot.definition.required ? <em aria-label="bắt buộc">*</em> : null}
          {tag ? <small>{tag}</small> : null}
        </>
      );
    };
    const field = (slot: Slot) => {
      // Ô tên người nhận: nút chọn loại người nhận nằm ở hàng nhãn, NGOÀI thẻ label (tên ô nhập vẫn chỉ là "Người nhận").
      if (payee && slot.key === payee.slots.name && slot.definition.type === 'text') {
        return (
          <div key={slot.key} className={`${styles.modalField} ${styles.payeeCell}`} data-payee-cell="">
            <PayeeModeSwitch picker={payee} disabled={busy} />
            <label className={styles.payeeLabel}>
              <span className={styles.modalLabel}>{labelText(slot)}</span>
              <div className={styles.payeeControl} data-payee-control="">
                <PayeeNameField
                  value={valueOf(slot.key)}
                  members={members}
                  picker={payee}
                  disabled={busy}
                  onChange={(next) => onChange({ ...draft, [slot.key]: next })}
                />
              </div>
            </label>
          </div>
        );
      }
      const long = isLong(slot);
      return (
        <label key={slot.key} className={long ? `${styles.modalField} ${styles.modalFieldFull}` : styles.modalField}>
          <span className={styles.modalLabel}>
            {labelText(slot)}
            {slot.key === hintSlot ? (
              <span
                className={hintOn ? styles.hintIcon : `${styles.hintIcon} ${styles.hintIconOff}`}
                role={hintOn ? 'img' : undefined}
                aria-label={hintOn ? PAYEE_HINT : undefined}
                aria-hidden={hintOn ? undefined : true}
                title={hintOn ? PAYEE_HINT : undefined}
                data-payee-hint={hintOn ? 'on' : 'off'}
              >
                <Info size={13} aria-hidden />
              </span>
            ) : null}
          </span>
          {long ? (
            <LongTextInput
              value={valueOf(slot.key)}
              disabled={busy}
              onChange={(next) => onChange({ ...draft, [slot.key]: next })}
            />
          ) : (
            control(slot, 36)
          )}
        </label>
      );
    };
    return (
      <section className={styles.modalForm} aria-label="Thông tin của hồ sơ">
        {open.length ? (
          <div className={styles.modalGrid} data-fields-grid="">
            {ordered.map((slot) => field(slot))}
          </div>
        ) : null}
        {readonly.length ? readonlyValues(open.length ? styles.valuesSplit : undefined) : null}
      </section>
    );
  }

  return (
    <section className={styles.form} aria-label="Thông tin của hồ sơ">
      {open.length ? (
        <>
          <header className={styles.header}>
            <strong>Thông tin cần nhập</strong>
            {onSaveDraft ? (
              <button type="button" className={styles.saveDraft} disabled={!dirty || busy} onClick={onSaveDraft}>
                Lưu nháp
              </button>
            ) : null}
          </header>
          <div className={styles.grid}>
            {open.map((slot) => (
              <label key={slot.key} className={styles.field}>
                <span className={styles.label}>
                  {slot.definition.name}
                  {slot.definition.required ? <em aria-label="bắt buộc">*</em> : null}
                  <small>{slot.scopeLabel}</small>
                </span>
                {control(slot)}
                {hint(slot)}
              </label>
            ))}
          </div>
        </>
      ) : null}
      {readonly.length ? readonlyValues(open.length ? styles.valuesSplit : undefined) : null}
    </section>
  );
}
