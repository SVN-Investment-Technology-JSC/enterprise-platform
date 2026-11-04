'use client';

import {
  CRM_DUPLICATE_TAX_CODE,
  DEFAULT_CUSTOMER_KIND,
  type CustomerDetail,
  type CustomerGroup,
  type CustomerKind,
  type CustomerKindOption,
  type TaxCodeMatch,
} from '@enterprise-platform/contracts-crm';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { useEffect, useState } from 'react';
import { CrmDialog, Field } from '../components/crm-ui';
import {
  createCustomer,
  createGroup,
  createKind,
  errorMessage,
  findTaxCodeMatches,
  updateCustomer,
  type CrmApiError,
} from '../crm-api';
import { groupOptions, kindOptions, peopleOptions, useCrm } from '../crm-context';
import { groupCodeFromName, normalizeGroupName, taxCodeLooksValid } from '../sales.model';
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
    kind: customer?.kind ?? DEFAULT_CUSTOMER_KIND,
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
  const { people, groups, kinds, capabilities, reloadGroups, reloadKinds } = useCrm();
  const canManageGroups = capabilities.isTenantAdmin || capabilities.canManage;
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [creatingKind, setCreatingKind] = useState(false);
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
    <>
    <CrmDialog
      open
      wide
      title={customer ? `Sửa khách hàng ${customer.code}` : 'Thêm khách hàng'}
      subtitle={customer ? undefined : 'Để trống mã để hệ thống tự sinh theo quy tắc cấu hình.'}
      submitLabel={matches.length ? 'Vẫn lưu' : 'Lưu'}
      submitting={submitting}
      error={error}
      notice={duplicateNotice}
      onClose={creatingGroup || creatingKind ? () => undefined : onClose}
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
            options={kindOptions(kinds)}
            value={form.kind}
            placeholder="Chọn phân loại"
            footerAction={canManageGroups ? { label: 'Tạo phân loại mới', onClick: () => setCreatingKind(true) } : undefined}
            onChange={(value) => set('kind', value || DEFAULT_CUSTOMER_KIND)}
          />
        </Field>
        <Field label="Nhóm khách hàng">
          <SearchableSelect
            options={groupOptions(groups)}
            value={form.groupId}
            placeholder="Chọn nhóm"
            emptyText={canManageGroups ? 'Chưa có nhóm nào' : 'Chưa có nhóm nào. Hãy nhờ quản trị viên tạo nhóm trong Cài đặt.'}
            clearable
            footerAction={canManageGroups ? { label: 'Tạo nhóm mới', onClick: () => setCreatingGroup(true) } : undefined}
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
    {creatingGroup ? (
      <QuickGroupDialog
        groups={groups}
        onClose={() => setCreatingGroup(false)}
        onCreated={(group) => {
          reloadGroups();
          set('groupId', group.id);
          setCreatingGroup(false);
        }}
      />
    ) : null}
    {creatingKind ? (
      <QuickKindDialog
        kinds={kinds}
        onClose={() => setCreatingKind(false)}
        onCreated={(kind) => {
          reloadKinds();
          set('kind', kind.code);
          setCreatingKind(false);
        }}
      />
    ) : null}
    </>
  );
}

/**
 * Hộp thoại rút gọn tạo nhóm khách hàng ngay trong form khách. Mã nhóm sinh từ tên; tên trùng nhóm đã có thì báo lỗi,
 * không đóng form khách nên nội dung đã nhập còn nguyên.
 */
function QuickGroupDialog({
  groups,
  onClose,
  onCreated,
}: {
  groups: readonly CustomerGroup[];
  onClose: () => void;
  onCreated: (group: CustomerGroup) => void;
}) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return setError('Vui lòng nhập tên nhóm.');
    const code = groupCodeFromName(trimmed);
    if (!code) return setError('Tên nhóm cần có ít nhất một chữ cái hoặc chữ số.');
    if (groups.some((group) => normalizeGroupName(group.name) === normalizeGroupName(trimmed))) {
      return setError('Nhóm khách hàng này đã tồn tại. Hãy chọn nhóm có sẵn hoặc đặt tên khác.');
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const group = await createGroup({ code, name: trimmed, description: null });
      toast.success('Đã tạo nhóm khách hàng.');
      onCreated(group);
    } catch (cause) {
      setError(
        (cause as CrmApiError).code === 'GROUP_CODE_EXISTS'
          ? 'Nhóm khách hàng này đã tồn tại. Hãy chọn nhóm có sẵn hoặc đặt tên khác.'
          : errorMessage(cause, 'Không tạo được nhóm.'),
      );
      setSubmitting(false);
    }
  }

  return (
    <CrmDialog open title="Tạo nhóm khách hàng" submitting={submitting} error={error} onClose={onClose} onSubmit={() => void submit()}>
      <Field label="Tên nhóm" required>
        <input className={styles.input} value={name} maxLength={200} autoFocus onChange={(event) => setName(event.target.value)} />
      </Field>
    </CrmDialog>
  );
}

/** Hộp thoại rút gọn tạo phân loại khách hàng ngay trong form khách, cùng cách với tạo nhóm. */
function QuickKindDialog({
  kinds,
  onClose,
  onCreated,
}: {
  kinds: readonly CustomerKindOption[];
  onClose: () => void;
  onCreated: (kind: CustomerKindOption) => void;
}) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return setError('Vui lòng nhập tên phân loại.');
    const code = groupCodeFromName(trimmed);
    if (!code) return setError('Tên phân loại cần có ít nhất một chữ cái hoặc chữ số.');
    if (kinds.some((kind) => normalizeGroupName(kind.name) === normalizeGroupName(trimmed))) {
      return setError('Phân loại này đã tồn tại. Hãy chọn phân loại có sẵn hoặc đặt tên khác.');
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const kind = await createKind({ code, name: trimmed, description: null });
      toast.success('Đã tạo phân loại khách hàng.');
      onCreated(kind);
    } catch (cause) {
      setError(
        (cause as CrmApiError).code === 'KIND_CODE_EXISTS'
          ? 'Phân loại này đã tồn tại. Hãy chọn phân loại có sẵn hoặc đặt tên khác.'
          : errorMessage(cause, 'Không tạo được phân loại.'),
      );
      setSubmitting(false);
    }
  }

  return (
    <CrmDialog open title="Tạo phân loại khách hàng" submitting={submitting} error={error} onClose={onClose} onSubmit={() => void submit()}>
      <Field label="Tên phân loại" required>
        <input className={styles.input} value={name} maxLength={200} autoFocus onChange={(event) => setName(event.target.value)} />
      </Field>
    </CrmDialog>
  );
}
