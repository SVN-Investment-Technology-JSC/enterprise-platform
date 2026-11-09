'use client';

/**
 * Mục "Tổ chức báo giá" ở đầu cột trái màn lập và sửa báo giá, trên Thông tin chung (plan mục 16.4, D3-26, D3-29). Chọn
 * tổ chức thì chép thông tin của tổ chức và hiện dạng chỉ xem; chọn "Nhập thủ công" thì mới hiện các ô để người lập tự
 * nhập cho riêng báo giá. Không còn Nháp hoặc không có quyền lập báo giá: chỉ xem.
 */
import type { SalesOrganizationSummary } from '@enterprise-platform/contracts-crm';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { useRef, useState } from 'react';
import { Field } from '../components/crm-ui';
import { errorMessage } from '../crm-api';
import styles from '../sales.module.scss';
import {
  EMPTY_SELLER_TEXTS,
  MANUAL_ORGANIZATION,
  SELLER_EXTRA_FIELDS,
  SELLER_FIELDS,
  SELLER_MAIN_FIELDS,
  sellerFieldLabel,
  sellerFieldLimit,
  sellerStateFromOrganization,
  type SellerField,
  type SellerState,
} from './quote-seller.model';
import { loadSalesOrganization } from './use-sales-organizations';

export const SELLER_SECTION_TITLE = 'Tổ chức báo giá';
export const NO_ORGANIZATION_TEXT = 'Không chọn tổ chức';
export const MANUAL_ORGANIZATION_TEXT = 'Nhập thủ công';

export function QuoteSellerSection({
  value,
  onChange,
  editable,
  organizations,
  organizationName,
  errors = {},
}: {
  value: SellerState;
  onChange: (next: SellerState) => void;
  /** Báo giá còn Nháp và người xem được lập báo giá. */
  editable: boolean;
  /** Tổ chức đang bật (ô chọn). */
  organizations: readonly SalesOrganizationSummary[];
  /** Tên tổ chức đã lưu trên báo giá, để hiện khi tổ chức đó đã tắt (không còn trong danh sách). */
  organizationName?: string | null;
  errors?: Partial<Record<SellerField, string>>;
}) {
  const latest = useRef(value);
  latest.current = value;
  const [moreOpen, setMoreOpen] = useState(() => SELLER_EXTRA_FIELDS.some((field) => value.seller[field].trim()));
  const [refreshing, setRefreshing] = useState(false);
  const showMore = moreOpen || SELLER_EXTRA_FIELDS.some((field) => Boolean(errors[field]));

  const manual = value.organizationId === MANUAL_ORGANIZATION;
  const selected = organizations.find((item) => item.id === value.organizationId);
  const selectedName = manual ? MANUAL_ORGANIZATION_TEXT : (selected?.name ?? organizationName ?? null);
  const options = organizations.map((item) => ({
    value: item.id,
    label: item.name,
    description: [item.isDefault ? 'Mặc định' : '', item.taxCode ? `MST ${item.taxCode}` : ''].filter(Boolean).join(' · ') || undefined,
  }));
  if (value.organizationId && !manual && !selected) {
    options.push({ value: value.organizationId, label: selectedName ?? 'Tổ chức đã tắt', description: 'Đã tắt' });
  }
  options.push({ value: MANUAL_ORGANIZATION, label: MANUAL_ORGANIZATION_TEXT, description: 'Tự nhập thông tin công ty cho riêng báo giá này' });

  function choose(id: string) {
    if (!id) return onChange({ organizationId: '', seller: EMPTY_SELLER_TEXTS });
    // Chuyển sang nhập thủ công: giữ thông tin đang có (của tổ chức vừa chọn) làm điểm bắt đầu để sửa.
    if (id === MANUAL_ORGANIZATION) return onChange({ organizationId: MANUAL_ORGANIZATION, seller: latest.current.seller });
    const found = organizations.find((item) => item.id === id);
    if (found) return onChange(sellerStateFromOrganization(found));
    void refresh(id);
  }

  async function refresh(id = latest.current.organizationId) {
    if (!id || id === MANUAL_ORGANIZATION) return;
    setRefreshing(true);
    try {
      const organization = await loadSalesOrganization(id);
      onChange(sellerStateFromOrganization(organization));
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không tải được thông tin tổ chức báo giá.'));
    } finally {
      setRefreshing(false);
    }
  }

  function recopy() {
    const found = organizations.find((item) => item.id === value.organizationId);
    if (found) onChange(sellerStateFromOrganization(found));
    else void refresh();
  }

  const setField = (field: SellerField, text: string) =>
    onChange({ ...latest.current, seller: { ...latest.current.seller, [field]: text } });

  const input = (field: SellerField, wide = false) => (
    <Field key={field} label={sellerFieldLabel(field)} error={errors[field]} wide={wide}>
      <input
        className={styles.input}
        value={value.seller[field]}
        maxLength={sellerFieldLimit(field)}
        aria-invalid={errors[field] ? true : undefined}
        onChange={(event) => setField(field, event.target.value)}
      />
    </Field>
  );

  const filled = SELLER_FIELDS.filter((field) => value.seller[field].trim());
  const facts = (
    <dl className={styles.facts}>
      {filled.map((field) => (
        <FactRow key={field} label={sellerFieldLabel(field)} value={value.seller[field]} />
      ))}
    </dl>
  );

  if (!editable) {
    return (
      <section className={styles.panel} aria-label={SELLER_SECTION_TITLE}>
        <h3 className={styles.sectionTitle}>{SELLER_SECTION_TITLE}</h3>
        <dl className={styles.facts}>
          <dt>Tổ chức</dt>
          <dd>{selectedName ?? <span className={styles.muted}>{NO_ORGANIZATION_TEXT}</span>}</dd>
          {filled.map((field) => (
            <FactRow key={field} label={sellerFieldLabel(field)} value={value.seller[field]} />
          ))}
        </dl>
      </section>
    );
  }

  return (
    <section className={styles.panel} aria-label={SELLER_SECTION_TITLE}>
      <h3 className={styles.sectionTitle}>{SELLER_SECTION_TITLE}</h3>
      <div className={styles.fieldGrid}>
        <Field
          label="Tổ chức"
          hint="Chọn tổ chức thì đầu trang in theo thông tin của tổ chức; chọn Nhập thủ công để tự nhập cho riêng báo giá này"
          wide
        >
          <SearchableSelect options={options} value={value.organizationId} placeholder={NO_ORGANIZATION_TEXT} clearable onChange={choose} />
        </Field>
        {manual ? SELLER_MAIN_FIELDS.map((field) => input(field, field === 'name' || field === 'address')) : null}
        {manual && showMore ? SELLER_EXTRA_FIELDS.map((field) => input(field)) : null}
      </div>
      {manual ? (
        <div className={styles.toolbar}>
          <button type="button" className={styles.linkButton} aria-expanded={showMore} onClick={() => setMoreOpen(!showMore)}>
            {showMore ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
            {showMore ? ' Ẩn thông tin thêm' : ' Thêm thông tin'}
          </button>
          {showMore ? null : <span className={styles.muted}>Tên viết tắt, website, tài khoản ngân hàng, người đại diện.</span>}
        </div>
      ) : value.organizationId ? (
        <>
          {facts}
          <div className={styles.toolbar}>
            <button
              type="button"
              className={styles.buttonGhost}
              disabled={refreshing}
              title="Chép lại thông tin mới nhất của tổ chức đang chọn"
              onClick={recopy}
            >
              <RefreshCw size={14} aria-hidden="true" /> Lấy lại từ tổ chức
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
