'use client';

import {
  QUOTE_ADJUSTMENT_MODE_LABELS,
  CUSTOM_FIELD_TYPES,
  CUSTOM_FIELD_TYPE_LABELS,
  QUOTE_CODE_PATTERN_HELP,
  type CustomFieldDefinition,
  type CustomFieldType,
  type QuoteAdjustmentMode,
  type QuoteCodeSettings,
  type QuoteTemplate,
  type QuoteType,
} from '@enterprise-platform/contracts-crm';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { CrmDialog, Field } from '../components/crm-ui';
import { useCrm } from '../crm-context';
import {
  createCustomField,
  createQuoteTemplate,
  createQuoteType,
  errorMessage,
  listQuoteCustomFields,
  listQuoteTemplates,
  listQuoteTypes,
  loadQuoteCodeSettings,
  saveQuoteCodeSettings,
  updateCustomField,
  updateQuoteTemplate,
  updateQuoteType,
} from '../crm-api';
import { LayoutDesigner } from '../quote-layout/layout-designer';
import styles from '../sales.module.scss';
import {
  ADJUSTMENT_MODE_HELP,
  QUOTE_CODE_TOKENS,
  adjustmentModeOptions,
  customFieldError,
  parseFieldOptions,
  previewQuoteCode,
  quoteCodePatternError,
  quoteFormNameError,
  sortQuoteForms,
} from './quote-form.model';

/** Mẫu báo giá, loại báo giá và mã báo giá. Chỉ nằm trong Cấu hình (`crm.manage`); server kiểm quyền lại. */
export function QuoteFormSettings() {
  return (
    <>
      <QuoteTemplates />
      <QuoteTypes />
      <QuoteCodePanel />
      <QuoteCustomFields />
    </>
  );
}

const statusPill = (active: boolean) => (
  <span
    className={`${styles.pill} ${active ? styles.pill_success : styles.pill_neutral}`}
  >
    {active ? 'Đang dùng' : 'Đã tắt'}
  </span>
);
const defaultPill = (isDefault: boolean) =>
  isDefault ? (
    <span className={`${styles.pill} ${styles.pill_success}`}>Mặc định</span>
  ) : null;

function QuoteTemplates() {
  const [items, setItems] = useState<QuoteTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<QuoteTemplate | 'new' | null>(null);
  const [designing, setDesigning] = useState<QuoteTemplate | null>(null);
  const { capabilities } = useCrm();
  // Trình thiết kế bố cục chỉ cho `crm.manage`; server kiểm quyền lại khi lưu.
  const canDesign = capabilities.isTenantAdmin || capabilities.canManage;

  const reload = useCallback(() => {
    setLoading(true);
    listQuoteTemplates(true)
      .then((rows) => {
        setItems(sortQuoteForms(rows));
        setError(undefined);
      })
      .catch((cause) =>
        setError(errorMessage(cause, 'Không tải được mẫu báo giá.')),
      )
      .finally(() => setLoading(false));
  }, []);
  useEffect(reload, [reload]);

  async function patch(
    row: QuoteTemplate,
    change: { active?: boolean; isDefault?: boolean },
    done: string,
  ) {
    try {
      await updateQuoteTemplate(row.id, {
        name: row.name,
        discountMode: row.discountMode,
        taxMode: row.taxMode,
        description: row.description,
        sortOrder: row.sortOrder,
        active: row.active,
        isDefault: row.isDefault,
        ...change,
      });
      toast.success(done);
      reload();
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không cập nhật được mẫu báo giá.'));
    }
  }

  const columns: ColumnsType<QuoteTemplate> = [
    {
      title: 'Tên mẫu',
      dataIndex: 'name',
      render: (value: string, row) => (
        <span>
          {value} {defaultPill(row.isDefault)}
        </span>
      ),
    },
    {
      title: 'Chiết khấu',
      dataIndex: 'discountMode',
      width: 140,
      render: (mode: QuoteAdjustmentMode) => QUOTE_ADJUSTMENT_MODE_LABELS[mode],
    },
    {
      title: 'Thuế',
      dataIndex: 'taxMode',
      width: 140,
      render: (mode: QuoteAdjustmentMode) => QUOTE_ADJUSTMENT_MODE_LABELS[mode],
    },
    { title: 'Mô tả', dataIndex: 'description', ellipsis: true },
    {
      title: 'Bố cục',
      dataIndex: 'hasLayout',
      width: 120,
      render: (hasLayout: boolean) => (
        <span
          className={`${styles.pill} ${hasLayout ? styles.pill_success : styles.pill_neutral}`}
        >
          {hasLayout ? 'Đã thiết kế' : 'Mặc định'}
        </span>
      ),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'active',
      width: 110,
      render: statusPill,
    },
    {
      title: '',
      key: 'actions',
      width: canDesign ? 340 : 220,
      render: (_: unknown, row) => (
        <span className={styles.rowActions}>
          <button
            type="button"
            className={styles.rowAction}
            onClick={() => setEditing(row)}
          >
            Sửa
          </button>
          {canDesign ? (
            <button
              type="button"
              className={styles.rowAction}
              onClick={() => setDesigning(row)}
            >
              Thiết kế bố cục
            </button>
          ) : null}
          {!row.isDefault && row.active ? (
            <button
              type="button"
              className={styles.rowAction}
              onClick={() =>
                void patch(row, { isDefault: true }, 'Đã đặt mẫu mặc định.')
              }
            >
              Đặt mặc định
            </button>
          ) : null}
          <button
            type="button"
            className={row.active ? styles.rowActionDanger : styles.rowAction}
            onClick={() =>
              void patch(
                row,
                { active: !row.active },
                row.active ? 'Đã tắt mẫu báo giá.' : 'Đã bật lại mẫu báo giá.',
              )
            }
          >
            {row.active ? 'Tắt' : 'Bật'}
          </button>
        </span>
      ),
    },
  ];

  return (
    <section className={styles.tableCard} aria-label="Mẫu báo giá">
      <div className={styles.toolbar}>
        <h2 className={styles.title}>Mẫu báo giá</h2>
        <button
          type="button"
          className={styles.buttonPrimary}
          onClick={() => setEditing('new')}
        >
          <Plus size={14} /> Thêm mẫu
        </button>
      </div>
      <p className={styles.muted}>
        {ADJUSTMENT_MODE_HELP.LINE} {ADJUSTMENT_MODE_HELP.ORDER} Báo giá đã tạo
        giữ nguyên chế độ của mẫu lúc tạo.
      </p>
      {error ? <p className={styles.alert}>{error}</p> : null}
      <Table<QuoteTemplate>
        size="small"
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={false}
        locale={{ emptyText: 'Chưa có mẫu báo giá nào.' }}
      />
      {editing ? (
        <TemplateDialog
          row={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : null}
      {designing && canDesign ? (
        <LayoutDesigner
          template={designing}
          onClose={() => setDesigning(null)}
          onSaved={reload}
        />
      ) : null}
    </section>
  );
}

function TemplateDialog({
  row,
  onClose,
  onSaved,
}: {
  row?: QuoteTemplate;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(row?.name ?? '');
  const [discountMode, setDiscountMode] = useState<QuoteAdjustmentMode>(
    row?.discountMode ?? 'LINE',
  );
  const [taxMode, setTaxMode] = useState<QuoteAdjustmentMode>(
    row?.taxMode ?? 'LINE',
  );
  const [description, setDescription] = useState(row?.description ?? '');
  const [sortOrder, setSortOrder] = useState(row ? String(row.sortOrder) : '');
  const [isDefault, setIsDefault] = useState(row?.isDefault ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    const invalid = quoteFormNameError(name, sortOrder, 'mẫu');
    if (invalid) return setError(invalid);
    setSubmitting(true);
    setError(undefined);
    const body = {
      name: name.trim(),
      discountMode,
      taxMode,
      description: description.trim() || null,
      sortOrder: sortOrder.trim() === '' ? undefined : Number(sortOrder),
      active: row?.active ?? true,
      isDefault,
    };
    try {
      if (row) await updateQuoteTemplate(row.id, body);
      else await createQuoteTemplate(body);
      toast.success('Đã lưu mẫu báo giá.');
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được mẫu báo giá.'));
      setSubmitting(false);
    }
  }

  return (
    <CrmDialog
      open
      title={row ? 'Sửa mẫu báo giá' : 'Thêm mẫu báo giá'}
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <div className={styles.fieldGrid}>
        <Field label="Tên mẫu" required wide>
          <input
            className={styles.input}
            value={name}
            maxLength={200}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field
          label="Chế độ chiết khấu"
          hint={ADJUSTMENT_MODE_HELP[discountMode]}
        >
          <SearchableSelect
            options={adjustmentModeOptions}
            value={discountMode}
            onChange={(value) =>
              setDiscountMode((value || 'LINE') as QuoteAdjustmentMode)
            }
          />
        </Field>
        <Field label="Chế độ thuế" hint={ADJUSTMENT_MODE_HELP[taxMode]}>
          <SearchableSelect
            options={adjustmentModeOptions}
            value={taxMode}
            onChange={(value) =>
              setTaxMode((value || 'LINE') as QuoteAdjustmentMode)
            }
          />
        </Field>
        <Field label="Thứ tự hiển thị">
          <input
            className={styles.input}
            inputMode="numeric"
            value={sortOrder}
            maxLength={6}
            onChange={(event) =>
              setSortOrder(event.target.value.replace(/[^\d]/g, ''))
            }
          />
        </Field>
        <Field
          label="Mẫu mặc định"
          hint="Báo giá mới dùng mẫu này nếu người tạo không chọn"
        >
          <label>
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(event) => setIsDefault(event.target.checked)}
            />{' '}
            Đặt làm mặc định
          </label>
        </Field>
        <Field label="Mô tả" wide>
          <textarea
            className={styles.textarea}
            rows={2}
            value={description}
            maxLength={1000}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
      </div>
    </CrmDialog>
  );
}

function QuoteTypes() {
  const [items, setItems] = useState<QuoteType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<QuoteType | 'new' | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    listQuoteTypes(true)
      .then((rows) => {
        setItems(sortQuoteForms(rows));
        setError(undefined);
      })
      .catch((cause) =>
        setError(errorMessage(cause, 'Không tải được loại báo giá.')),
      )
      .finally(() => setLoading(false));
  }, []);
  useEffect(reload, [reload]);

  async function patch(
    row: QuoteType,
    change: { active?: boolean; isDefault?: boolean },
    done: string,
  ) {
    try {
      await updateQuoteType(row.id, {
        name: row.name,
        description: row.description,
        sortOrder: row.sortOrder,
        active: row.active,
        isDefault: row.isDefault,
        ...change,
      });
      toast.success(done);
      reload();
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không cập nhật được loại báo giá.'));
    }
  }

  const columns: ColumnsType<QuoteType> = [
    {
      title: 'Tên loại',
      dataIndex: 'name',
      render: (value: string, row) => (
        <span>
          {value} {defaultPill(row.isDefault)}
        </span>
      ),
    },
    { title: 'Mô tả', dataIndex: 'description', ellipsis: true },
    { title: 'Thứ tự', dataIndex: 'sortOrder', width: 90, align: 'right' },
    {
      title: 'Trạng thái',
      dataIndex: 'active',
      width: 110,
      render: statusPill,
    },
    {
      title: '',
      key: 'actions',
      width: 220,
      render: (_: unknown, row) => (
        <span className={styles.rowActions}>
          <button
            type="button"
            className={styles.rowAction}
            onClick={() => setEditing(row)}
          >
            Sửa
          </button>
          {!row.isDefault && row.active ? (
            <button
              type="button"
              className={styles.rowAction}
              onClick={() =>
                void patch(row, { isDefault: true }, 'Đã đặt loại mặc định.')
              }
            >
              Đặt mặc định
            </button>
          ) : null}
          <button
            type="button"
            className={row.active ? styles.rowActionDanger : styles.rowAction}
            onClick={() =>
              void patch(
                row,
                { active: !row.active },
                row.active
                  ? 'Đã tắt loại báo giá.'
                  : 'Đã bật lại loại báo giá.',
              )
            }
          >
            {row.active ? 'Tắt' : 'Bật'}
          </button>
        </span>
      ),
    },
  ];

  return (
    <section className={styles.tableCard} aria-label="Loại báo giá">
      <div className={styles.toolbar}>
        <h2 className={styles.title}>Loại báo giá</h2>
        <button
          type="button"
          className={styles.buttonPrimary}
          onClick={() => setEditing('new')}
        >
          <Plus size={14} /> Thêm loại
        </button>
      </div>
      <p className={styles.muted}>
        Loại đã tắt không được chọn cho báo giá mới; báo giá cũ vẫn giữ loại đó.
      </p>
      {error ? <p className={styles.alert}>{error}</p> : null}
      <Table<QuoteType>
        size="small"
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={false}
        locale={{ emptyText: 'Chưa có loại báo giá nào.' }}
      />
      {editing ? (
        <TypeDialog
          row={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : null}
    </section>
  );
}

function TypeDialog({
  row,
  onClose,
  onSaved,
}: {
  row?: QuoteType;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(row?.name ?? '');
  const [description, setDescription] = useState(row?.description ?? '');
  const [sortOrder, setSortOrder] = useState(row ? String(row.sortOrder) : '');
  const [isDefault, setIsDefault] = useState(row?.isDefault ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    const invalid = quoteFormNameError(name, sortOrder, 'loại');
    if (invalid) return setError(invalid);
    setSubmitting(true);
    setError(undefined);
    const body = {
      name: name.trim(),
      description: description.trim() || null,
      sortOrder: sortOrder.trim() === '' ? undefined : Number(sortOrder),
      active: row?.active ?? true,
      isDefault,
    };
    try {
      if (row) await updateQuoteType(row.id, body);
      else await createQuoteType(body);
      toast.success('Đã lưu loại báo giá.');
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được loại báo giá.'));
      setSubmitting(false);
    }
  }

  return (
    <CrmDialog
      open
      title={row ? 'Sửa loại báo giá' : 'Thêm loại báo giá'}
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <div className={styles.fieldGrid}>
        <Field label="Tên loại" required>
          <input
            className={styles.input}
            value={name}
            maxLength={200}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Thứ tự hiển thị">
          <input
            className={styles.input}
            inputMode="numeric"
            value={sortOrder}
            maxLength={6}
            onChange={(event) =>
              setSortOrder(event.target.value.replace(/[^\d]/g, ''))
            }
          />
        </Field>
        <Field label="Loại mặc định">
          <label>
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(event) => setIsDefault(event.target.checked)}
            />{' '}
            Đặt làm mặc định
          </label>
        </Field>
        <Field label="Mô tả" wide>
          <textarea
            className={styles.textarea}
            rows={2}
            value={description}
            maxLength={1000}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
      </div>
    </CrmDialog>
  );
}

function QuoteCodePanel() {
  const [settings, setSettings] = useState<QuoteCodeSettings>();
  const [pattern, setPattern] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    loadQuoteCodeSettings()
      .then((value) => {
        setSettings(value);
        setPattern(value.pattern ?? '');
      })
      .catch((cause) =>
        setError(errorMessage(cause, 'Không tải được cấu hình mã báo giá.')),
      );
  }, []);

  const invalid = quoteCodePatternError(pattern);
  const preview = previewQuoteCode(pattern);

  async function save() {
    if (invalid) return setError(invalid);
    setSaving(true);
    setError(undefined);
    try {
      const value = await saveQuoteCodeSettings({
        pattern: pattern.trim() || null,
      });
      setSettings(value);
      setPattern(value.pattern ?? '');
      toast.success('Đã lưu mẫu mã báo giá.');
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được mẫu mã báo giá.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.panel} aria-label="Mã báo giá">
      <h2 className={styles.title}>Mã báo giá</h2>
      {error ? <p className={styles.alert}>{error}</p> : null}
      {settings ? (
        <form
          className={styles.fieldGrid}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Field
            label="Mẫu mã"
            wide
            hint="Để trống để dùng mã mặc định BG, 2 số cuối của năm và 5 chữ số. Ví dụ: {yyyymmdd}/BG//{seq}"
          >
            <input
              className={styles.input}
              value={pattern}
              maxLength={60}
              onChange={(event) => setPattern(event.target.value)}
            />
          </Field>
          <Field label="Xem trước (số thứ tự minh hoạ)">
            <input
              className={`${styles.input} ${styles.mono}`}
              readOnly
              value={invalid ? invalid : (preview ?? settings.example)}
              aria-invalid={!!invalid}
            />
          </Field>
          <Field label="Mã sinh ra nếu tạo ngay" hint="Chỉ xem, chưa chiếm số">
            <input
              className={`${styles.input} ${styles.mono}`}
              readOnly
              value={settings.example}
            />
          </Field>
          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.buttonGhost}
              onClick={() => setShowHelp((value) => !value)}
            >
              {showHelp ? 'Ẩn hướng dẫn token' : 'Hướng dẫn token'}
            </button>
            <button
              type="submit"
              className={styles.buttonPrimary}
              disabled={saving || !!invalid}
            >
              {saving ? 'Đang lưu…' : 'Lưu mẫu mã'}
            </button>
          </div>
          {showHelp ? (
            <div style={{ gridColumn: '1 / -1' }}>
              <p className={styles.muted}>{QUOTE_CODE_PATTERN_HELP}</p>
              <ul>
                {QUOTE_CODE_TOKENS.map((item) => (
                  <li key={item.token}>
                    <span className={styles.mono}>{item.token}</span>:{' '}
                    {item.meaning}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}

const fieldTypeOptions = CUSTOM_FIELD_TYPES.map((type) => ({
  value: type,
  label: CUSTOM_FIELD_TYPE_LABELS[type],
}));

/** Trường tuỳ biến của báo giá: thêm, sửa, tắt; kiểu, lựa chọn, bắt buộc, thứ tự (P2I-06). */
function QuoteCustomFields() {
  const [items, setItems] = useState<CustomFieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<CustomFieldDefinition | 'new' | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    listQuoteCustomFields()
      .then((rows) => {
        setItems(sortQuoteForms(rows.map((row) => ({ ...row, isDefault: false }))));
        setError(undefined);
      })
      .catch((cause) => setError(errorMessage(cause, 'Không tải được trường tuỳ biến.')))
      .finally(() => setLoading(false));
  }, []);
  useEffect(reload, [reload]);

  async function toggle(row: CustomFieldDefinition) {
    try {
      await updateCustomField(row.id, {
        name: row.name,
        fieldType: row.fieldType,
        options: row.options,
        required: row.required,
        sortOrder: row.sortOrder,
        active: !row.active,
      });
      toast.success(row.active ? 'Đã tắt trường.' : 'Đã bật trường.');
      reload();
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không cập nhật được trường tuỳ biến.'));
    }
  }

  const columns: ColumnsType<CustomFieldDefinition> = [
    { title: 'Tên trường', dataIndex: 'name' },
    {
      title: 'Kiểu',
      dataIndex: 'fieldType',
      width: 130,
      render: (value: CustomFieldType) => CUSTOM_FIELD_TYPE_LABELS[value],
    },
    {
      title: 'Lựa chọn',
      dataIndex: 'options',
      ellipsis: true,
      render: (value: readonly string[]) => value.join(', '),
    },
    {
      title: 'Bắt buộc',
      dataIndex: 'required',
      width: 100,
      render: (value: boolean) => (value ? 'Có' : 'Không'),
    },
    { title: 'Thứ tự', dataIndex: 'sortOrder', width: 90, align: 'right' },
    { title: 'Trạng thái', dataIndex: 'active', width: 110, render: statusPill },
    {
      title: '',
      key: 'actions',
      width: 140,
      render: (_: unknown, row) => (
        <span className={styles.rowActions}>
          <button type="button" className={styles.rowAction} onClick={() => setEditing(row)}>
            Sửa
          </button>
          <button type="button" className={styles.rowAction} onClick={() => void toggle(row)}>
            {row.active ? 'Tắt' : 'Bật'}
          </button>
        </span>
      ),
    },
  ];

  return (
    <section className={styles.tableCard} aria-label="Trường tuỳ biến của báo giá">
      <div className={styles.toolbar}>
        <h3 className={styles.sectionTitle}>Trường tuỳ biến của báo giá</h3>
        <button type="button" className={styles.buttonPrimary} onClick={() => setEditing('new')}>
          <Plus size={14} /> Thêm trường
        </button>
      </div>
      <p className={styles.muted}>
        Trường hiện ở form báo giá. Tắt trường thì không nhập được nữa nhưng giá trị đã lưu được giữ nguyên.
      </p>
      {error ? <p className={styles.alert}>{error}</p> : null}
      <Table<CustomFieldDefinition>
        size="small"
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={false}
        locale={{ emptyText: 'Chưa có trường tuỳ biến nào.' }}
      />
      {editing ? (
        <CustomFieldDialog
          row={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : null}
    </section>
  );
}

function CustomFieldDialog({
  row,
  onClose,
  onSaved,
}: {
  row?: CustomFieldDefinition;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(row?.name ?? '');
  const [fieldType, setFieldType] = useState<CustomFieldType>(row?.fieldType ?? 'TEXT');
  const [optionsText, setOptionsText] = useState(row?.options.join('\n') ?? '');
  const [required, setRequired] = useState(row?.required ?? false);
  const [sortOrder, setSortOrder] = useState(row ? String(row.sortOrder) : '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    const invalid = customFieldError({ name, fieldType, optionsText, sortOrder });
    if (invalid) return setError(invalid);
    setSubmitting(true);
    setError(undefined);
    const body = {
      name: name.trim(),
      fieldType,
      options: fieldType === 'SELECT' ? parseFieldOptions(optionsText) : [],
      required,
      sortOrder: sortOrder.trim() === '' ? undefined : Number(sortOrder),
      active: row?.active ?? true,
    };
    try {
      if (row) await updateCustomField(row.id, body);
      else await createCustomField(body);
      toast.success('Đã lưu trường tuỳ biến.');
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được trường tuỳ biến.'));
      setSubmitting(false);
    }
  }

  return (
    <CrmDialog
      open
      title={row ? 'Sửa trường tuỳ biến' : 'Thêm trường tuỳ biến'}
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <div className={styles.fieldGrid}>
        <Field label="Tên trường" required>
          <input
            className={styles.input}
            value={name}
            maxLength={200}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Kiểu dữ liệu" required>
          <SearchableSelect
            options={fieldTypeOptions}
            value={fieldType}
            clearable={false}
            onChange={(next) => setFieldType(next as CustomFieldType)}
          />
        </Field>
        {fieldType === 'SELECT' ? (
          <Field label="Các lựa chọn" required wide hint="Mỗi dòng một lựa chọn.">
            <textarea
              className={styles.textarea}
              rows={4}
              value={optionsText}
              onChange={(event) => setOptionsText(event.target.value)}
            />
          </Field>
        ) : null}
        <Field label="Thứ tự hiển thị">
          <input
            className={styles.input}
            inputMode="numeric"
            value={sortOrder}
            maxLength={6}
            onChange={(event) => setSortOrder(event.target.value.replace(/[^\d]/g, ''))}
          />
        </Field>
        <Field label="Bắt buộc">
          <label>
            <input
              type="checkbox"
              checked={required}
              onChange={(event) => setRequired(event.target.checked)}
            />{' '}
            Bắt buộc nhập khi cập nhật báo giá
          </label>
        </Field>
      </div>
    </CrmDialog>
  );
}
