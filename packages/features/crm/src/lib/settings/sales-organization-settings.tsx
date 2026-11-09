'use client';

/**
 * Cấu hình, thẻ "Tổ chức báo giá" (plan mục 16.4, task P3C6-05, D3-24, D3-25): danh mục công ty con, pháp nhân phát hành
 * báo giá. Bảng tên, MST, điện thoại, mặc định, trạng thái; thêm, sửa, đặt mặc định, tắt hoặc bật, xoá. Hộp thoại có đủ
 * trường, kiểm bằng `validateSalesOrganization` trước khi gọi API; logo tải như ảnh của trình thiết kế bố cục.
 * Server kiểm quyền `crm.manage` và kiểm lại dữ liệu.
 */
import {
  SALES_ORGANIZATION_FIELD_LABELS,
  SALES_ORGANIZATION_LIMITS,
  SALES_ORGANIZATION_REQUIRED_FIELDS,
  validateSalesOrganization,
  type SalesOrganization,
  type SalesOrganizationError,
  type SalesOrganizationField,
  type SalesOrganizationSummary,
  type SaveSalesOrganizationRequest,
} from '@enterprise-platform/contracts-crm';
import { Popconfirm, toast } from '@enterprise-platform/shared-ui';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ImagePlus, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CrmDialog, Field } from '../components/crm-ui';
import {
  createSalesOrganization,
  deleteSalesOrganization,
  errorMessage,
  getSalesOrganization,
  listSalesOrganizations,
  updateSalesOrganization,
  type CrmApiError,
} from '../crm-api';
import { useCrm } from '../crm-context';
import { readLayoutImage } from '../quote-layout/layout-image';
import { clearSalesOrganizationCache } from '../quotes/use-sales-organizations';
import styles from '../sales.module.scss';
import local from './sales-organization-settings.module.scss';

type TextField = keyof typeof SALES_ORGANIZATION_LIMITS;
type FormTexts = Readonly<Record<TextField, string>>;

/** Thứ tự ô trong hộp thoại; ô rộng chiếm cả hàng. */
const FORM_FIELDS: readonly { field: TextField; wide?: boolean }[] = [
  { field: 'name', wide: true },
  { field: 'shortName' },
  { field: 'code' },
  { field: 'taxCode' },
  { field: 'phone' },
  { field: 'address', wide: true },
  { field: 'email' },
  { field: 'website' },
  { field: 'bankAccount' },
  { field: 'bankName' },
  { field: 'representative' },
  { field: 'representativeTitle' },
];

const REQUIRED = new Set<string>(SALES_ORGANIZATION_REQUIRED_FIELDS);

const label = (field: SalesOrganizationField) => SALES_ORGANIZATION_FIELD_LABELS[field];

function textsOf(row?: SalesOrganization): FormTexts {
  return Object.fromEntries(FORM_FIELDS.map(({ field }) => [field, row?.[field] ?? ''])) as FormTexts;
}

/** Thân tạo hoặc sửa: đủ các trường (PATCH gửi đủ như tạo). */
export function organizationBody(
  texts: FormTexts,
  extra: { logo: string | null; isDefault: boolean; active: boolean; sortOrder: string },
): SaveSalesOrganizationRequest {
  const optional = (value: string) => value.trim() || null;
  return {
    code: optional(texts.code),
    name: texts.name.trim(),
    shortName: optional(texts.shortName),
    address: texts.address.trim(),
    taxCode: texts.taxCode.trim(),
    phone: texts.phone.trim(),
    email: texts.email.trim(),
    website: optional(texts.website),
    bankAccount: optional(texts.bankAccount),
    bankName: optional(texts.bankName),
    representative: optional(texts.representative),
    representativeTitle: optional(texts.representativeTitle),
    logo: extra.logo,
    isDefault: extra.isDefault,
    active: extra.active,
    sortOrder: extra.sortOrder.trim() === '' ? 0 : Number(extra.sortOrder),
  };
}

/** Thân sửa từ chi tiết đã lưu, đè phần đổi (đặt mặc định, tắt, bật). */
function bodyFromSaved(row: SalesOrganization, change: { isDefault?: boolean; active?: boolean }): SaveSalesOrganizationRequest {
  return {
    ...organizationBody(textsOf(row), { logo: row.logo, isDefault: row.isDefault, active: row.active, sortOrder: String(row.sortOrder) }),
    ...change,
  };
}

/** Lỗi đầu tiên theo từng trường. */
function errorMap(errors: readonly SalesOrganizationError[] | undefined): Partial<Record<SalesOrganizationField, string>> {
  const map: Partial<Record<SalesOrganizationField, string>> = {};
  for (const error of errors ?? []) if (!map[error.field]) map[error.field] = error.message;
  return map;
}

const statusPill = (active: boolean) => (
  <span className={`${styles.pill} ${active ? styles.pill_success : styles.pill_neutral}`}>{active ? 'Đang dùng' : 'Đã tắt'}</span>
);

export function SalesOrganizationSettings() {
  const { capabilities } = useCrm();
  const canManage = capabilities.isTenantAdmin || capabilities.canManage;
  const [items, setItems] = useState<SalesOrganizationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<SalesOrganizationSummary | 'new' | null>(null);
  const [busyId, setBusyId] = useState<string>();

  const reload = useCallback(() => {
    setLoading(true);
    listSalesOrganizations(true)
      .then((rows) => {
        setItems([...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi')));
        setError(undefined);
      })
      .catch((cause) => setError(errorMessage(cause, 'Không tải được danh sách tổ chức báo giá.')))
      .finally(() => setLoading(false));
  }, []);
  useEffect(reload, [reload]);

  /** Sau mọi thay đổi: tải lại bảng và bỏ cache để màn báo giá trong phiên đọc bản mới. */
  const changed = useCallback(() => {
    clearSalesOrganizationCache();
    reload();
  }, [reload]);

  async function patch(row: SalesOrganizationSummary, change: { isDefault?: boolean; active?: boolean }, done: string) {
    setBusyId(row.id);
    try {
      // Danh sách không có logo: đọc chi tiết để gửi đủ trường, không làm mất logo.
      const saved = await getSalesOrganization(row.id);
      await updateSalesOrganization(row.id, bodyFromSaved(saved, change));
      toast.success(done);
      changed();
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không cập nhật được tổ chức báo giá.'));
    } finally {
      setBusyId(undefined);
    }
  }

  async function remove(row: SalesOrganizationSummary) {
    try {
      await deleteSalesOrganization(row.id);
      toast.success('Đã xoá tổ chức báo giá.');
      changed();
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không xoá được tổ chức báo giá.'));
    }
  }

  const columns: ColumnsType<SalesOrganizationSummary> = [
    {
      title: 'Tên',
      dataIndex: 'name',
      render: (value: string, row) => (
        <span>
          {value}
          {row.code ? <span className={styles.muted}> · {row.code}</span> : null}{' '}
          {row.isDefault ? <span className={`${styles.pill} ${styles.pill_success}`}>Mặc định</span> : null}
        </span>
      ),
    },
    { title: 'MST', dataIndex: 'taxCode', width: 150, render: (value: string) => <span className={styles.mono}>{value}</span> },
    { title: 'Điện thoại', dataIndex: 'phone', width: 150 },
    { title: 'Trạng thái', dataIndex: 'active', width: 110, render: statusPill },
  ];
  if (canManage) {
    columns.push({
      title: '',
      key: 'actions',
      width: 300,
      render: (_: unknown, row) => (
        <span className={styles.rowActions}>
          <button type="button" className={styles.rowAction} onClick={() => setEditing(row)}>
            Sửa
          </button>
          {!row.isDefault && row.active ? (
            <button type="button" className={styles.rowAction} disabled={busyId === row.id} onClick={() => void patch(row, { isDefault: true }, 'Đã đặt tổ chức mặc định.')}>
              Đặt mặc định
            </button>
          ) : null}
          <button
            type="button"
            className={row.active ? styles.rowActionDanger : styles.rowAction}
            disabled={busyId === row.id}
            onClick={() =>
              void patch(row, { active: !row.active }, row.active ? 'Đã tắt tổ chức báo giá.' : 'Đã bật lại tổ chức báo giá.')
            }
          >
            {row.active ? 'Tắt' : 'Bật'}
          </button>
          <Popconfirm
            title="Xoá tổ chức báo giá?"
            description={row.inUse ? 'Tổ chức đã có báo giá, chỉ tắt được.' : 'Không hoàn tác được.'}
            okText="Xoá"
            cancelText="Huỷ"
            okType="danger"
            onConfirm={() => remove(row)}
          >
            <button type="button" className={styles.rowActionDanger}>
              Xoá
            </button>
          </Popconfirm>
        </span>
      ),
    });
  }

  return (
    <section className={styles.tableCard} aria-label="Tổ chức báo giá">
      <div className={styles.toolbar}>
        <h2 className={styles.title}>Tổ chức báo giá</h2>
        {canManage ? (
          <button type="button" className={styles.buttonPrimary} onClick={() => setEditing('new')}>
            <Plus size={14} /> Thêm tổ chức
          </button>
        ) : null}
      </div>
      <p className={styles.muted}>
        Công ty con, pháp nhân phát hành báo giá. Người lập báo giá chọn tổ chức; đầu trang bản in lấy tên, địa chỉ, mã số
        thuế, điện thoại, email và logo của tổ chức đó. Báo giá mới chọn sẵn tổ chức mặc định. Tổ chức đã có báo giá không
        xoá được, chỉ tắt.
      </p>
      {error ? <p className={styles.alert}>{error}</p> : null}
      <Table<SalesOrganizationSummary>
        size="small"
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={false}
        locale={{ emptyText: 'Chưa có tổ chức báo giá nào.' }}
      />
      {editing && canManage ? (
        <SalesOrganizationDialog
          row={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            changed();
          }}
        />
      ) : null}
    </section>
  );
}

function SalesOrganizationDialog({ row, onClose, onSaved }: { row?: SalesOrganizationSummary; onClose: () => void; onSaved: () => void }) {
  // Sửa: đọc chi tiết (có logo) trước khi hiện form.
  const [saved, setSaved] = useState<SalesOrganization | null | undefined>(row ? undefined : null);
  const [loadError, setLoadError] = useState<string>();

  useEffect(() => {
    if (!row) return undefined;
    let active = true;
    getSalesOrganization(row.id)
      .then((detail) => active && setSaved(detail))
      .catch((cause) => active && setLoadError(errorMessage(cause, 'Không tải được tổ chức báo giá.')));
    return () => {
      active = false;
    };
  }, [row]);

  if (row && saved === undefined) {
    return (
      <CrmDialog open title="Sửa tổ chức báo giá" error={loadError} submitLabel="Lưu" onClose={onClose} onSubmit={() => undefined}>
        <p className={styles.muted}>{loadError ? 'Đóng hộp thoại rồi thử lại.' : 'Đang tải…'}</p>
      </CrmDialog>
    );
  }
  return <SalesOrganizationForm saved={saved ?? undefined} onClose={onClose} onSaved={onSaved} />;
}

function SalesOrganizationForm({ saved, onClose, onSaved }: { saved?: SalesOrganization; onClose: () => void; onSaved: () => void }) {
  const [texts, setTexts] = useState<FormTexts>(() => textsOf(saved));
  const [logo, setLogo] = useState<string | null>(saved?.logo ?? null);
  const [isDefault, setIsDefault] = useState(saved?.isDefault ?? false);
  const [sortOrder, setSortOrder] = useState(saved ? String(saved.sortOrder) : '');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<SalesOrganizationField, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [logoBusy, setLogoBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const setText = (field: TextField, value: string) => {
    setTexts((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  };

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    setLogoBusy(true);
    const result = await readLayoutImage(file);
    setLogoBusy(false);
    if (result.ok) {
      setLogo(result.dataUrl);
      setFieldErrors((current) => ({ ...current, logo: undefined }));
    } else {
      setFieldErrors((current) => ({ ...current, logo: result.message }));
    }
  }

  async function submit() {
    if (sortOrder.trim() && !/^\d+$/.test(sortOrder.trim())) {
      setFieldErrors({ sortOrder: 'Thứ tự là số nguyên từ 0 đến 9999.' });
      return setError('Thứ tự là số nguyên từ 0 đến 9999.');
    }
    const body = organizationBody(texts, { logo, isDefault, active: saved?.active ?? true, sortOrder });
    const checked = validateSalesOrganization(body);
    if (!checked.ok) {
      setFieldErrors(errorMap(checked.errors));
      return setError(checked.errors[0]?.message);
    }
    setFieldErrors({});
    setError(undefined);
    setSubmitting(true);
    try {
      if (saved) await updateSalesOrganization(saved.id, body);
      else await createSalesOrganization(body);
      toast.success(saved ? 'Đã lưu tổ chức báo giá.' : 'Đã thêm tổ chức báo giá.');
      onSaved();
    } catch (cause) {
      setFieldErrors(errorMap((cause as CrmApiError | undefined)?.fieldErrors));
      setError(errorMessage(cause, 'Không lưu được tổ chức báo giá.'));
      setSubmitting(false);
    }
  }

  return (
    <CrmDialog
      open
      wide
      title={saved ? 'Sửa tổ chức báo giá' : 'Thêm tổ chức báo giá'}
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <div className={styles.fieldGrid}>
        {FORM_FIELDS.map(({ field, wide }) => (
          <Field key={field} label={label(field)} required={REQUIRED.has(field)} error={fieldErrors[field]} wide={wide}>
            <input
              className={styles.input}
              value={texts[field]}
              maxLength={SALES_ORGANIZATION_LIMITS[field]}
              aria-invalid={fieldErrors[field] ? true : undefined}
              autoFocus={field === 'name'}
              onChange={(event) => setText(field, event.target.value)}
            />
          </Field>
        ))}
        <Field label={label('sortOrder')} hint="Số nhỏ đứng trước trong danh sách" error={fieldErrors.sortOrder}>
          <input
            className={styles.input}
            inputMode="numeric"
            value={sortOrder}
            maxLength={4}
            onChange={(event) => setSortOrder(event.target.value.replace(/[^\d]/g, ''))}
          />
        </Field>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Mặc định</span>
          <label className={styles.checkbox}>
            <input type="checkbox" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} />
            Chọn sẵn khi lập báo giá mới
          </label>
        </div>
        <div className={local.logoField}>
          <span className={styles.fieldLabel}>{label('logo')}</span>
          <div className={local.logoRow}>
            <span className={local.logoPreview}>{logo ? <img src={logo} alt="Logo tổ chức" /> : 'Chưa có logo'}</span>
            <button type="button" className={styles.buttonGhost} disabled={logoBusy} onClick={() => fileInput.current?.click()}>
              <ImagePlus size={14} aria-hidden="true" /> {logoBusy ? 'Đang xử lý…' : logo ? 'Đổi logo' : 'Chọn logo'}
            </button>
            {logo ? (
              <button type="button" className={styles.buttonGhost} onClick={() => setLogo(null)}>
                Bỏ logo
              </button>
            ) : null}
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg"
              hidden
              aria-label="Tải logo"
              data-testid="organization-logo-input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                void pickLogo(file);
              }}
            />
          </div>
          {fieldErrors.logo ? (
            <span className={styles.fieldError} role="alert">
              {fieldErrors.logo}
            </span>
          ) : (
            <span className={styles.fieldHint}>PNG hoặc JPEG, tối đa 300 KB; ảnh rộng hơn 1.000 px được tự thu nhỏ.</span>
          )}
        </div>
      </div>
    </CrmDialog>
  );
}
