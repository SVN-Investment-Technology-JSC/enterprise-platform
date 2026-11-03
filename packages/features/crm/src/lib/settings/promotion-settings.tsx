'use client';

import {
  PROMOTION_DISCOUNT_TYPES,
  PROMOTION_KIND_LABELS,
  PROMOTION_KINDS,
  type PromotionCatalogItem,
  type PromotionDiscountType,
  type PromotionKind,
} from '@enterprise-platform/contracts-crm';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CrmDialog, Field } from '../components/crm-ui';
import {
  createPromotionCatalog,
  errorMessage,
  listPromotionCatalog,
  updatePromotionCatalog,
} from '../crm-api';
import {
  EMPTY_PROMOTION_FORM,
  PROMOTION_DISCOUNT_LABELS,
  promotionFormError,
  promotionFormToRequest,
  promotionStateLabel,
  promotionToForm,
  promotionValidityLabel,
  promotionValueLabel,
  todayIso,
  type PromotionFormValues,
} from '../promotions.model';
import styles from '../sales.module.scss';

const kindOptions = PROMOTION_KINDS.map((kind) => ({
  value: kind,
  label: PROMOTION_KIND_LABELS[kind],
}));
const discountOptions = PROMOTION_DISCOUNT_TYPES.map((type) => ({
  value: type,
  label: PROMOTION_DISCOUNT_LABELS[type],
}));

/** Danh mục "Khuyến mãi và chiết khấu" của Cài đặt (`crm.manage`); server kiểm quyền lại. */
export function PromotionSettings() {
  const [items, setItems] = useState<PromotionCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<PromotionCatalogItem | 'new' | null>(
    null,
  );

  const reload = useCallback(() => {
    setLoading(true);
    listPromotionCatalog({ includeInactive: true })
      .then((rows) => {
        setItems(rows);
        setError(undefined);
      })
      .catch((cause) =>
        setError(errorMessage(cause, 'Không tải được danh mục khuyến mãi.')),
      )
      .finally(() => setLoading(false));
  }, []);
  useEffect(reload, [reload]);

  const toggle = useCallback(
    async (row: PromotionCatalogItem) => {
      try {
        await updatePromotionCatalog(row.id, { active: !row.active });
        toast.success(
          row.active ? 'Đã tắt khuyến mãi.' : 'Đã bật lại khuyến mãi.',
        );
        reload();
      } catch (cause) {
        toast.error(errorMessage(cause, 'Không cập nhật được khuyến mãi.'));
      }
    },
    [reload],
  );

  const today = todayIso();
  const columns = useMemo<ColumnsType<PromotionCatalogItem>>(
    () => [
      {
        title: 'Mã',
        dataIndex: 'code',
        width: 150,
        render: (value: string) => <span className={styles.mono}>{value}</span>,
      },
      { title: 'Tên', dataIndex: 'name', ellipsis: true },
      {
        title: 'Loại',
        dataIndex: 'kind',
        width: 190,
        render: (value: PromotionKind) => PROMOTION_KIND_LABELS[value],
      },
      {
        title: 'Mức giảm',
        key: 'value',
        width: 150,
        align: 'right',
        render: (_: unknown, row) => promotionValueLabel(row),
      },
      {
        title: 'Hiệu lực',
        key: 'validity',
        width: 190,
        render: (_: unknown, row) => promotionValidityLabel(row),
      },
      {
        title: 'Trạng thái',
        key: 'state',
        width: 140,
        render: (_: unknown, row) => (
          <span
            className={`${styles.pill} ${row.effective ? styles.pill_success : row.active ? styles.pill_warning : styles.pill_neutral}`}
          >
            {promotionStateLabel(row, today)}
          </span>
        ),
      },
      {
        title: '',
        key: 'actions',
        width: 130,
        render: (_: unknown, row) => (
          <span className={styles.rowActions}>
            <button
              type="button"
              className={styles.rowAction}
              onClick={() => setEditing(row)}
            >
              Sửa
            </button>
            <button
              type="button"
              className={row.active ? styles.rowActionDanger : styles.rowAction}
              onClick={() => void toggle(row)}
            >
              {row.active ? 'Tắt' : 'Bật'}
            </button>
          </span>
        ),
      },
    ],
    [today, toggle],
  );

  return (
    <section className={styles.tableCard} aria-label="Khuyến mãi và chiết khấu">
      <div className={styles.toolbar}>
        <h2 className={styles.title}>Khuyến mãi và chiết khấu</h2>
        <button
          type="button"
          className={styles.buttonPrimary}
          onClick={() => setEditing('new')}
        >
          <Plus size={14} /> Thêm khuyến mãi
        </button>
      </div>
      <p className={styles.muted}>
        Danh mục để chọn cho từng dự án và báo giá. Khuyến mãi chỉ là thông tin
        kèm theo, không tự trừ vào tổng báo giá. Mục đã tắt hoặc hết hạn không
        chọn được thêm.
      </p>
      {error ? <p className={styles.alert}>{error}</p> : null}
      <Table<PromotionCatalogItem>
        size="small"
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={false}
        locale={{ emptyText: 'Chưa có khuyến mãi nào trong danh mục.' }}
      />
      {editing ? (
        <PromotionDialog
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

function PromotionDialog({
  row,
  onClose,
  onSaved,
}: {
  row?: PromotionCatalogItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<PromotionFormValues>(
    row ? promotionToForm(row) : EMPTY_PROMOTION_FORM,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const patch = (next: Partial<PromotionFormValues>) =>
    setForm((current) => ({ ...current, ...next }));

  async function submit() {
    const invalid = promotionFormError(form);
    if (invalid) return setError(invalid);
    setSubmitting(true);
    setError(undefined);
    try {
      const body = promotionFormToRequest(form);
      if (row) await updatePromotionCatalog(row.id, body);
      else await createPromotionCatalog(body);
      toast.success('Đã lưu khuyến mãi.');
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được khuyến mãi.'));
      setSubmitting(false);
    }
  }

  return (
    <CrmDialog
      open
      title={row ? 'Sửa khuyến mãi' : 'Thêm khuyến mãi'}
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <div className={styles.fieldGrid}>
        <Field label="Loại" required>
          <SearchableSelect
            options={kindOptions}
            value={form.kind}
            onChange={(next) => next && patch({ kind: next as PromotionKind })}
          />
        </Field>
        <Field label="Mã" required>
          <input
            aria-label="Mã"
            className={styles.input}
            value={form.code}
            maxLength={40}
            onChange={(event) => patch({ code: event.target.value })}
          />
        </Field>
        <Field label="Tên" required wide>
          <input
            aria-label="Tên"
            className={styles.input}
            value={form.name}
            maxLength={200}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </Field>
        <Field label="Cách giảm" required>
          <SearchableSelect
            options={discountOptions}
            value={form.discountType}
            onChange={(next) =>
              next && patch({ discountType: next as PromotionDiscountType })
            }
          />
        </Field>
        <Field
          label={
            form.discountType === 'PERCENT' ? 'Giá trị (%)' : 'Giá trị (đồng)'
          }
          hint={form.discountType === 'NONE' ? 'Không áp dụng' : undefined}
        >
          <input
            aria-label="Giá trị"
            className={styles.input}
            inputMode="decimal"
            value={form.discountType === 'NONE' ? '' : form.value}
            disabled={form.discountType === 'NONE'}
            onChange={(event) =>
              patch({ value: event.target.value.replace(/[^\d.]/g, '') })
            }
          />
        </Field>
        <Field label="Hiệu lực từ ngày">
          <input
            aria-label="Hiệu lực từ ngày"
            type="date"
            className={styles.input}
            value={form.validFrom}
            onChange={(event) => patch({ validFrom: event.target.value })}
          />
        </Field>
        <Field label="Hiệu lực đến ngày">
          <input
            aria-label="Hiệu lực đến ngày"
            type="date"
            className={styles.input}
            value={form.validTo}
            onChange={(event) => patch({ validTo: event.target.value })}
          />
        </Field>
        <Field label="Mô tả" wide>
          <textarea
            className={styles.textarea}
            rows={2}
            value={form.description}
            maxLength={1000}
            onChange={(event) => patch({ description: event.target.value })}
          />
        </Field>
      </div>
    </CrmDialog>
  );
}
