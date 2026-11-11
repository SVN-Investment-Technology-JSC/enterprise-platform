'use client';

/**
 * Mục "Tổ chức báo giá" ở đầu cột trái màn lập và sửa báo giá, trên Thông tin chung (plan mục 16.4, D3-26, D3-29). Thu
 * gọn mặc định (tiêu đề ghi tổ chức đang chọn), bấm tiêu đề để mở; có lỗi ở ô thông tin thì tự mở. Chọn
 * tổ chức thì chép thông tin của tổ chức và hiện dạng chỉ xem; chọn "Nhập thủ công" thì mới hiện các ô để người lập tự
 * nhập cho riêng báo giá. Không còn Nháp hoặc không có quyền lập báo giá: chỉ xem.
 */
import { validateSalesOrganization, type SalesOrganizationSummary } from '@enterprise-platform/contracts-crm';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { BookmarkPlus, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { useRef, useState } from 'react';
import { Field } from '../components/crm-ui';
import { createSalesOrganization, errorMessage } from '../crm-api';
import { useCrm } from '../crm-context';
import styles from '../sales.module.scss';
import {
  EMPTY_SELLER_TEXTS,
  MANUAL_ORGANIZATION,
  SELLER_EXTRA_FIELDS,
  SELLER_FIELDS,
  SELLER_MAIN_FIELDS,
  sellerFieldLabel,
  sellerFieldLimit,
  sellerFieldErrorsOf,
  sellerStateFromOrganization,
  type SellerField,
  type SellerState,
} from './quote-seller.model';
import { clearSalesOrganizationCache, loadSalesOrganization } from './use-sales-organizations';

export const SELLER_SECTION_TITLE = 'Tổ chức báo giá';
export const NO_ORGANIZATION_TEXT = 'Không chọn tổ chức';
export const MANUAL_ORGANIZATION_TEXT = 'Nhập thủ công';
export const SAVE_ORGANIZATION_TEXT = 'Lưu thành tổ chức';

export function QuoteSellerSection({
  value,
  onChange,
  editable,
  organizations,
  organizationName,
  errors: parentErrors = {},
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
  const { capabilities } = useCrm();
  // Tạo tổ chức cần quyền quản trị bán hàng (server kiểm lại); người lập báo giá thường không thấy nút lưu.
  const canSaveOrganization = capabilities.isTenantAdmin || capabilities.canManage;
  const [saving, setSaving] = useState(false);
  const [saveErrors, setSaveErrors] = useState<Partial<Record<SellerField, string>>>({});
  /** Tổ chức vừa lưu từ Nhập thủ công, chưa có trong danh sách màn cha tải lúc mở. */
  const [added, setAdded] = useState<readonly SalesOrganizationSummary[]>([]);
  const errors = { ...saveErrors, ...parentErrors };
  const allOrganizations = [...organizations, ...added.filter((item) => !organizations.some((row) => row.id === item.id))];
  const [moreOpen, setMoreOpen] = useState(() => SELLER_EXTRA_FIELDS.some((field) => value.seller[field].trim()));
  const [refreshing, setRefreshing] = useState(false);
  // Thu gọn mặc định; có lỗi ở ô thông tin tổ chức thì luôn mở để thấy ô cần sửa.
  const [expanded, setExpanded] = useState(false);
  const showMore = moreOpen || SELLER_EXTRA_FIELDS.some((field) => Boolean(errors[field]));
  const open = expanded || Object.values(errors).some(Boolean);

  const manual = value.organizationId === MANUAL_ORGANIZATION;
  const selected = allOrganizations.find((item) => item.id === value.organizationId);
  const selectedName = manual ? MANUAL_ORGANIZATION_TEXT : (selected?.name ?? organizationName ?? null);
  const options = allOrganizations.map((item) => ({
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
    const found = allOrganizations.find((item) => item.id === id);
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
    const found = allOrganizations.find((item) => item.id === value.organizationId);
    if (found) onChange(sellerStateFromOrganization(found));
    else void refresh();
  }

  const setField = (field: SellerField, text: string) => {
    if (saveErrors[field]) setSaveErrors((current) => ({ ...current, [field]: undefined }));
    onChange({ ...latest.current, seller: { ...latest.current.seller, [field]: text } });
  };

  /**
   * Lưu thông tin đang nhập thủ công thành tổ chức báo giá để lần sau chọn lại; lưu xong báo giá chuyển sang chọn tổ
   * chức đó (thông tin không đổi nên đầu trang in như cũ). Thiếu trường bắt buộc của tổ chức thì báo ngay tại ô.
   */
  async function saveAsOrganization() {
    const checked = validateSalesOrganization(latest.current.seller);
    if (!checked.ok) {
      const next: Partial<Record<SellerField, string>> = {};
      for (const error of checked.errors) {
        if ((SELLER_FIELDS as readonly string[]).includes(error.field) && !next[error.field as SellerField]) next[error.field as SellerField] = error.message;
      }
      setSaveErrors(next);
      if (Object.keys(next).some((field) => (SELLER_EXTRA_FIELDS as readonly string[]).includes(field))) setMoreOpen(true);
      toast.error(checked.errors[0]?.message ?? 'Thông tin tổ chức chưa hợp lệ.');
      return;
    }
    setSaving(true);
    setSaveErrors({});
    try {
      const created = await createSalesOrganization({ ...checked.organization, code: null, logo: null });
      clearSalesOrganizationCache();
      setAdded((rows) => [...rows, created]);
      onChange(sellerStateFromOrganization(created));
      toast.success(`Đã lưu tổ chức "${created.name}" để dùng lần sau.`);
    } catch (cause) {
      setSaveErrors(sellerFieldErrorsOf(cause));
      toast.error(errorMessage(cause, 'Không lưu được tổ chức báo giá.'));
    } finally {
      setSaving(false);
    }
  }

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

  const header = (
    <button type="button" className={styles.detailsToggle} aria-expanded={open} onClick={() => setExpanded(!open)}>
      {open ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
      <span>{SELLER_SECTION_TITLE}</span>
      {open ? null : <span className={styles.muted}>{selectedName ?? NO_ORGANIZATION_TEXT}</span>}
    </button>
  );

  if (!editable) {
    return (
      <section className={styles.panel} aria-label={SELLER_SECTION_TITLE}>
        {header}
        {open ? (
          <dl className={styles.facts}>
            <dt>Tổ chức</dt>
            <dd>{selectedName ?? <span className={styles.muted}>{NO_ORGANIZATION_TEXT}</span>}</dd>
            {filled.map((field) => (
              <FactRow key={field} label={sellerFieldLabel(field)} value={value.seller[field]} />
            ))}
          </dl>
        ) : null}
      </section>
    );
  }

  return (
    <section className={styles.panel} aria-label={SELLER_SECTION_TITLE}>
      {header}
      {open ? (
        <>
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
              {canSaveOrganization ? (
                <button
                  type="button"
                  className={`${styles.buttonGhost} ${styles.pushRight}`}
                  disabled={saving}
                  title="Lưu thông tin đang nhập thành tổ chức báo giá trong Cấu hình để lần sau chọn lại"
                  onClick={() => void saveAsOrganization()}
                >
                  <BookmarkPlus size={14} aria-hidden="true" /> {SAVE_ORGANIZATION_TEXT}
                </button>
              ) : null}
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
