'use client';

/**
 * Khối "Cập nhật thông tin báo giá" ngay trên màn báo giá (thay hộp thoại cũ): ngày tính giá, vận chuyển, chiết khấu và
 * thuế tổng đơn, khoản phí, Ghi chú (in ở mục Ghi chú của báo giá), trường tuỳ biến. Thu gọn hoặc mở rộng bằng nút ở
 * tiêu đề; nhập trực tiếp, lưu chung với các thay đổi khác bằng nút Lưu. Báo giá không còn sửa được thì chỉ xem.
 */
import type { CustomFieldDefinition, QuoteAdjustmentMode, QuoteVersion } from '@enterprise-platform/contracts-crm';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Fragment } from 'react';
import { Field } from '../components/crm-ui';
import { formatPercent } from '../pricing/pricing.model';
import { formatMoney } from '../sales.model';
import styles from '../sales.module.scss';
import { CustomFieldsEditor, FeesEditor, OrderAmountField } from './quote-form-parts';
import { activeFields, type QuoteDetailsState } from './quote-form-edit.model';

export const QUOTE_DETAILS_TITLE = 'Cập nhật thông tin báo giá';
/** Neo của ô chiết khấu tổng đơn (nút "Sửa % chiết khấu" cuộn tới đây). */
export const ORDER_DISCOUNT_ANCHOR = 'quote-order-discount';
const NOTE_HINT = 'In vào mục "Ghi chú" của báo giá (trên các điều khoản)';

export function QuoteDetailsBlock({
  open,
  onToggle,
  editable,
  value,
  onChange,
  fields,
  missing,
  modes,
  version,
}: {
  open: boolean;
  onToggle: () => void;
  editable: boolean;
  value: QuoteDetailsState;
  onChange: (next: QuoteDetailsState) => void;
  fields: readonly CustomFieldDefinition[];
  /** Tên trường tuỳ biến bắt buộc còn trống (sau khi bấm Lưu). */
  missing: readonly string[];
  /** Chế độ của mẫu đang chọn trên màn: chiết khấu, thuế tổng đơn chỉ nhập khi mẫu tính theo tổng đơn. */
  modes: { readonly discount: QuoteAdjustmentMode; readonly tax: QuoteAdjustmentMode };
  /** Bản đã lưu, để hiện khi chỉ xem. */
  version: QuoteVersion;
}) {
  const set = (patch: Partial<QuoteDetailsState>) => onChange({ ...value, ...patch });
  return (
    <section className={styles.detailsBlock} aria-label={QUOTE_DETAILS_TITLE}>
      <button type="button" className={styles.detailsToggle} aria-expanded={open} onClick={onToggle}>
        {open ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
        <span>{QUOTE_DETAILS_TITLE}</span>
        {open ? null : (
          <span className={styles.muted}>Ngày tính giá, vận chuyển, chiết khấu và thuế tổng đơn, phí, ghi chú, trường tuỳ biến</span>
        )}
      </button>
      {!open ? null : editable ? (
        <div className={styles.detailsBody}>
          <h4 className={styles.sectionTitle}>Nội dung báo giá</h4>
          <div className={styles.fieldGrid}>
            <Field label="Ngày tính giá" hint="Bỏ trống: tính theo ngày hôm nay">
              <DatePickerInput value={value.priceDate || undefined} onChange={(next) => set({ priceDate: next })} height={38} placeholder="Hôm nay" aria-label="Ngày tính giá" />
            </Field>
            <Field label="Phí vận chuyển thu khách (VND)">
              <input className={styles.input} inputMode="decimal" value={value.shipping} onChange={(event) => set({ shipping: event.target.value })} />
            </Field>
            <Field label="Thuế suất vận chuyển (%)">
              <input className={styles.input} inputMode="decimal" value={value.shippingVat} onChange={(event) => set({ shippingVat: event.target.value })} />
            </Field>
            <Field label="Chi phí vận chuyển bên bán chịu (VND)" hint="Trừ vào lợi nhuận; bỏ trống là bằng phí thu khách">
              <input className={styles.input} inputMode="decimal" value={value.shippingCost} onChange={(event) => set({ shippingCost: event.target.value })} />
            </Field>
          </div>
          <div id={ORDER_DISCOUNT_ANCHOR}>
            <OrderAmountField
              label="Chiết khấu"
              value={value.discount}
              allowed={modes.discount === 'ORDER'}
              lineHint="mẫu báo giá này tính chiết khấu theo dòng (chính sách và ghi đè trên từng dòng hàng). Chọn mẫu tính theo tổng đơn để nhập một lần cho cả báo giá."
              onChange={(discount) => set({ discount })}
            />
          </div>
          <OrderAmountField
            label="Thuế"
            value={value.tax}
            allowed={modes.tax === 'ORDER'}
            lineHint="mẫu báo giá này tính thuế theo dòng (VAT của từng mặt hàng). Chọn mẫu tính theo tổng đơn để nhập một lần cho cả báo giá."
            onChange={(tax) => set({ tax })}
          />
          <FeesEditor rows={value.fees} onChange={(fees) => set({ fees })} />
          <Field label="Ghi chú" hint={NOTE_HINT} wide>
            <textarea className={styles.textarea} rows={3} maxLength={4000} value={value.note} onChange={(event) => set({ note: event.target.value })} />
          </Field>
          <h4 className={styles.sectionTitle}>Trường tuỳ biến</h4>
          <CustomFieldsEditor definitions={fields} texts={value.custom} missing={[...missing]} onChange={(custom) => set({ custom })} />
          <p className={styles.muted}>Bấm Lưu ở thanh dưới để lưu cùng các thay đổi khác.</p>
        </div>
      ) : (
        <div className={styles.detailsBody}>
          <dl className={styles.facts}>
            <dt>Ngày tính giá</dt>
            <dd>{version.priceDate ? version.priceDate.split('-').reverse().join('/') : 'Theo ngày lập'}</dd>
            <dt>Phí vận chuyển</dt>
            <dd>{version.shipping.amount ? `${formatMoney(version.shipping.amount)} (VAT ${formatPercent(version.shipping.vatRate)})` : 'Không có'}</dd>
            {version.form.fees.map((fee, index) => (
              <Fragment key={`${fee.feeType}-${index}`}>
                <dt>{fee.feeType || `Khoản phí ${index + 1}`}</dt>
                <dd>{formatMoney(fee.amount)}</dd>
              </Fragment>
            ))}
            <dt>Ghi chú</dt>
            <dd style={{ whiteSpace: 'pre-wrap' }}>{version.note || <span className={styles.muted}>Chưa có ghi chú.</span>}</dd>
            {activeFields(fields).map((field) => (
              <Fragment key={field.id}>
                <dt>{field.name}</dt>
                <dd style={{ whiteSpace: 'pre-wrap' }}>
                  {version.form.customFields[field.id] === undefined ? <span className={styles.muted}>Chưa nhập</span> : String(version.form.customFields[field.id])}
                </dd>
              </Fragment>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
