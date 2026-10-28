'use client';

import {
  CRM_DUPLICATE_TAX_CODE,
  CUSTOMER_KIND_LABELS,
  type CustomerDetail,
  type CustomerKind,
  type TaxCodeMatch,
} from '@enterprise-platform/contracts-crm';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { useEffect, useState } from 'react';
import { CrmDialog, Field } from '../components/crm-ui';
import {
  createCustomer,
  errorMessage,
  findTaxCodeMatches,
  updateCustomer,
  type CrmApiError,
} from '../crm-api';
import { groupOptions, labelOptions, peopleOptions, useCrm } from '../crm-context';
import { taxCodeLooksValid } from '../sales.model';
import styles from '../sales.module.scss';

interface FormState {
  code: string;
  name: string;
  taxCode: string;
  address: string;
  province: string;
  region: string;
  industry: string;
  phone: string;
  email: string;
  groupId: string;
  kind: CustomerKind;
  creditLimit: string;
  paymentTermDays: string;
  note: string;
  ownerUserId: string;
}

function initialState(customer?: CustomerDetail): FormState {
  return {
    code: customer?.code ?? '',
    name: customer?.name ?? '',
    taxCode: customer?.taxCode ?? '',
    address: customer?.address ?? '',
    province: customer?.province ?? '',
    region: customer?.region ?? '',
    industry: customer?.industry ?? '',
    phone: customer?.phone ?? '',
    email: customer?.email ?? '',
    groupId: customer?.groupId ?? '',
    kind: customer?.kind ?? 'LEAD_CUSTOMER',
    creditLimit: customer?.creditLimit === null || customer?.creditLimit === undefined ? '' : String(customer.creditLimit),
    paymentTermDays:
      customer?.paymentTermDays === null || customer?.paymentTermDays === undefined ? '' : String(customer.paymentTermDays),
    note: customer?.note ?? '',
    ownerUserId: customer?.ownerUserId ?? '',
  };
}

const text = (value: string) => (value.trim() ? value.trim() : null);
const number = (value: string) => (value.trim() ? Number(value) : null);

/**
 * Thêm hoặc sửa khách hàng. MST kiểm định dạng ngay khi nhập; trùng MST với
 * khách khác thì hiện cảnh báo kèm khách đã có, người dùng bấm "Vẫn lưu" mới
 * lưu (server trả 409 `DUPLICATE_TAX_CODE` cho tới khi có xác nhận).
 */
export function CustomerFormDialog({
  customer,
  onClose,
  onSaved,
}: {
  customer?: CustomerDetail;
  onClose: () => void;
  onSaved: (customer: CustomerDetail) => void;
}) {
  const { people, groups } = useCrm();
  const [form, setForm] = useState<FormState>(() => initialState(customer));
  const [matches, setMatches] = useState<readonly TaxCodeMatch[]>([]);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const taxCodeError = taxCodeLooksValid(form.taxCode) ? undefined : 'Mã số thuế gồm 10 số hoặc 10 số-3 số.';

  // Cảnh báo trùng MST ngay khi nhập xong một MST hợp lệ.
  useEffect(() => {
    setConfirmDuplicate(false);
    const value = form.taxCode.trim();
    if (!value || !taxCodeLooksValid(value) || value === customer?.taxCode) {
      setMatches([]);
      return;
    }
    const timer = setTimeout(() => {
      findTaxCodeMatches(value, customer?.id).then(setMatches).catch(() => setMatches([]));
    }, 400);
    return () => clearTimeout(timer);
  }, [form.taxCode, customer?.id, customer?.taxCode]);

  async function submit() {
    if (!form.name.trim()) return setError('Vui lòng nhập tên khách hàng.');
    if (taxCodeError) return setError(taxCodeError);
    setSubmitting(true);
    setError(undefined);
    const fields = {
      name: form.name.trim(),
      taxCode: text(form.taxCode),
      address: text(form.address),
      province: text(form.province),
      region: text(form.region),
      industry: text(form.industry),
      phone: text(form.phone),
      email: text(form.email),
      groupId: form.groupId || null,
      kind: form.kind,
      creditLimit: number(form.creditLimit),
      paymentTermDays: number(form.paymentTermDays),
      note: text(form.note),
      ownerUserId: form.ownerUserId || null,
      confirmDuplicateTaxCode: confirmDuplicate || matches.length > 0,
    };
    try {
      const saved = customer
        ? await updateCustomer(customer.id, { ...fields, code: form.code.trim() || customer.code, version: customer.version })
        : await createCustomer({ ...fields, code: text(form.code) });
      toast.success(customer ? 'Đã lưu khách hàng.' : `Đã tạo khách hàng ${saved.code}.`);
      onSaved(saved);
    } catch (cause) {
      const apiError = cause as CrmApiError;
      if (apiError.code === CRM_DUPLICATE_TAX_CODE) {
        setMatches(apiError.matches ?? []);
        setConfirmDuplicate(true);
      } else {
        setError(errorMessage(cause, 'Không lưu được khách hàng.'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const duplicateNotice = matches.length ? (
    <div className={styles.warning} role="alert">
      <strong>Mã số thuế đã có ở khách hàng khác:</strong>
      <ul>
        {matches.map((match) => (
          <li key={match.id}>
            {match.code} - {match.name}
          </li>
        ))}
      </ul>
      <span>Bấm "Vẫn lưu" nếu đây đúng là một khách hàng khác (ví dụ chi nhánh).</span>
    </div>
  ) : null;

  return (
    <CrmDialog
      open
      wide
      title={customer ? `Sửa khách hàng ${customer.code}` : 'Thêm khách hàng'}
      subtitle={customer ? undefined : 'Để trống mã để hệ thống tự sinh theo quy tắc cấu hình.'}
      submitLabel={matches.length ? 'Vẫn lưu' : 'Lưu'}
      submitting={submitting}
      error={error}
      notice={duplicateNotice}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <div className={styles.fieldGrid}>
        <Field label="Mã khách hàng" hint={customer ? undefined : 'Tự sinh nếu để trống'}>
          <input className={styles.input} value={form.code} maxLength={50} onChange={(event) => set('code', event.target.value)} />
        </Field>
        <Field label="Tên khách hàng" required>
          <input className={styles.input} value={form.name} maxLength={300} autoFocus onChange={(event) => set('name', event.target.value)} />
        </Field>
        <Field label="Mã số thuế" error={taxCodeError}>
          <input className={styles.input} value={form.taxCode} maxLength={14} placeholder="0101234567 hoặc 0101234567-001" onChange={(event) => set('taxCode', event.target.value)} />
        </Field>
        <Field label="Phân loại">
          <SearchableSelect
            options={labelOptions(CUSTOMER_KIND_LABELS)}
            value={form.kind}
            onChange={(value) => set('kind', (value || 'LEAD_CUSTOMER') as CustomerKind)}
          />
        </Field>
        <Field label="Nhóm khách hàng">
          <SearchableSelect
            options={groupOptions(groups)}
            value={form.groupId}
            placeholder="Chọn nhóm"
            emptyText="Chưa có nhóm nào"
            clearable
            onChange={(value) => set('groupId', value)}
          />
        </Field>
        <Field label="Người phụ trách" hint={customer ? undefined : 'Mặc định là bạn'}>
          <SearchableSelect
            options={peopleOptions(people)}
            value={form.ownerUserId}
            placeholder="Chọn người phụ trách"
            clearable
            onChange={(value) => set('ownerUserId', value)}
          />
        </Field>
        <Field label="Tỉnh/thành">
          <input className={styles.input} value={form.province} maxLength={100} onChange={(event) => set('province', event.target.value)} />
        </Field>
        <Field label="Khu vực">
          <input className={styles.input} value={form.region} maxLength={100} onChange={(event) => set('region', event.target.value)} />
        </Field>
        <Field label="Ngành">
          <input className={styles.input} value={form.industry} maxLength={100} onChange={(event) => set('industry', event.target.value)} />
        </Field>
        <Field label="Điện thoại">
          <input className={styles.input} value={form.phone} maxLength={50} onChange={(event) => set('phone', event.target.value)} />
        </Field>
        <Field label="Email">
          <input className={styles.input} type="email" value={form.email} maxLength={200} onChange={(event) => set('email', event.target.value)} />
        </Field>
        <Field label="Hạn mức tín dụng (đồng)">
          <input className={styles.input} inputMode="numeric" value={form.creditLimit} onChange={(event) => set('creditLimit', event.target.value.replace(/[^\d]/g, ''))} />
        </Field>
        <Field label="Thời hạn thanh toán (ngày)">
          <input className={styles.input} inputMode="numeric" value={form.paymentTermDays} onChange={(event) => set('paymentTermDays', event.target.value.replace(/[^\d]/g, ''))} />
        </Field>
        <Field label="Địa chỉ" wide>
          <input className={styles.input} value={form.address} maxLength={500} onChange={(event) => set('address', event.target.value)} />
        </Field>
        <Field label="Ghi chú" wide>
          <textarea className={styles.textarea} rows={3} value={form.note} maxLength={2000} onChange={(event) => set('note', event.target.value)} />
        </Field>
      </div>
    </CrmDialog>
  );
}
