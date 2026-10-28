'use client';

import type { CrmCatalogMaterial } from '@enterprise-platform/contracts-crm';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { errorMessage, searchCatalog } from '../crm-api';
import { formatQuantity } from '../fulfillment.model';
import { parseNumber } from '../pricing/pricing.model';
import { formatMoney } from '../sales.model';
import styles from '../sales.module.scss';
import { CrmDialog, Field } from './crm-ui';
import { useDebounced } from './use-debounced';

export interface PickedMaterial {
  readonly material: CrmCatalogMaterial;
  /** Rỗng khi cho phép bỏ trống (giá khung không số lượng). */
  readonly quantity: number | null;
  /** Có khi hộp thoại hỏi giá (dòng hợp đồng). */
  readonly unitPrice: number | null;
  readonly vatRate: number | null;
}

/**
 * Chọn một mặt hàng từ danh mục Kho (`GET /catalog/materials`) kèm tồn khả
 * dụng, giá vốn bình quân; nhập số lượng và (với dòng hợp đồng) giá khung, thuế.
 */
export function MaterialPickerDialog({
  title,
  withPrice = false,
  quantityOptional = false,
  onClose,
  onPick,
}: {
  title: string;
  withPrice?: boolean;
  quantityOptional?: boolean;
  onClose: () => void;
  onPick: (picked: PickedMaterial) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<readonly CrmCatalogMaterial[]>([]);
  const [selected, setSelected] = useState<CrmCatalogMaterial>();
  const [quantity, setQuantity] = useState(quantityOptional ? '' : '1');
  const [price, setPrice] = useState('');
  const [vat, setVat] = useState('10');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const q = useDebounced(search.trim(), 300);

  useEffect(() => {
    let active = true;
    setLoading(true);
    searchCatalog(q)
      .then((result) => {
        if (!active) return;
        setItems(result);
        setError(undefined);
      })
      .catch((cause) => active && setError(errorMessage(cause, 'Không tải được danh mục Kho.')))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [q]);

  const columns: ColumnsType<CrmCatalogMaterial> = [
    { title: 'Mã', dataIndex: 'code', width: 130, render: (value: string) => <span className={styles.mono}>{value}</span> },
    { title: 'Tên', dataIndex: 'name', ellipsis: true },
    { title: 'ĐVT', dataIndex: 'unit', width: 70 },
    {
      title: 'Tồn khả dụng',
      dataIndex: 'totalAvailable',
      width: 110,
      align: 'right',
      render: (value: number | null, row) => (row.kind === 'SERVICE' ? <span className={styles.muted}>Dịch vụ</span> : formatQuantity(value ?? 0)),
    },
    { title: 'Giá vốn BQ', dataIndex: 'avgCost', width: 120, align: 'right', render: (value: number | null) => (value === null ? '' : formatMoney(value)) },
  ];

  async function save() {
    if (!selected) return setError('Vui lòng chọn một mặt hàng.');
    const amount = quantity.trim() ? parseNumber(quantity) : undefined;
    if (!quantityOptional || quantity.trim()) {
      if (amount === undefined || amount <= 0) return setError('Số lượng phải lớn hơn 0.');
    }
    const unitPrice = withPrice ? parseNumber(price) : undefined;
    if (withPrice && (unitPrice === undefined || unitPrice < 0)) return setError('Vui lòng nhập giá khung không âm.');
    setSaving(true);
    try {
      await onPick({
        material: selected,
        quantity: amount ?? null,
        unitPrice: unitPrice ?? null,
        vatRate: withPrice ? (parseNumber(vat) ?? null) : null,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <CrmDialog open wide title={title} subtitle="Mặt hàng lấy từ danh mục Kho" submitLabel="Thêm dòng" submitting={saving} error={error} onClose={onClose} onSubmit={() => void save()}>
      <input
        className={`${styles.input} ${styles.search}`}
        type="search"
        placeholder="Tìm theo mã hoặc tên mặt hàng…"
        maxLength={100}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <Table<CrmCatalogMaterial>
        size="small"
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={[...items]}
        pagination={false}
        scroll={{ y: 260 }}
        rowSelection={{ type: 'radio', selectedRowKeys: selected ? [selected.id] : [], onChange: (_keys, rows) => setSelected(rows[0]) }}
        onRow={(row) => ({ onClick: () => setSelected(row) })}
        locale={{ emptyText: loading ? 'Đang tải…' : 'Không có mặt hàng nào.' }}
      />
      <div className={styles.fieldGrid}>
        <Field
          label="Số lượng"
          required={!quantityOptional}
          hint={quantityOptional ? 'Bỏ trống với hợp đồng khung, nguyên tắc (chỉ chốt giá)' : selected?.unit ? `Đơn vị: ${selected.unit}` : undefined}
        >
          <input className={styles.input} inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        </Field>
        {withPrice ? (
          <>
            <Field label="Giá khung trước VAT (VND)" required>
              <input className={styles.input} inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
            </Field>
            <Field label="Thuế suất (%)">
              <input className={styles.input} inputMode="decimal" value={vat} onChange={(event) => setVat(event.target.value)} />
            </Field>
          </>
        ) : null}
      </div>
    </CrmDialog>
  );
}
