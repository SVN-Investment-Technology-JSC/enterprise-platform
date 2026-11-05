'use client';

import type { CrmCatalogMaterial, PriceListDetail, PriceListItem } from '@enterprise-platform/contracts-crm';
import { toast } from '@enterprise-platform/shared-ui';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CrmDialog, Field } from '../components/crm-ui';
import { useDebounced } from '../components/use-debounced';
import { errorMessage, searchCatalog, updatePriceListItem, upsertPriceListItems } from '../crm-api';
import styles from '../sales.module.scss';
import { formatMoney } from '../sales.model';
import { buildPriceListItems, newPriceRow, parseNumber, type PriceRowDraft } from './pricing.model';

/** Nhóm ở màn Hàng hóa của Kho: hàng hoá hay dịch vụ (mã `kind` của Kho). */
const kindLabel = (kind: string | null) => (kind === 'SERVICE' ? 'Dịch vụ' : 'Hàng hóa');

/**
 * Thêm dòng giá: chọn một hoặc nhiều mặt hàng từ danh mục Kho (id, mã, tên, đơn vị lấy theo Kho,
 * không gõ tay), mỗi mặt hàng một hàng; chỉ đơn giá và thuế suất nhập tay (cho phép số thập phân).
 * Mặt hàng và đơn vị đã có trong bảng giá thì được cập nhật giá.
 */
export function AddPriceItemsDialog({
  priceListId,
  onClose,
  onSaved,
}: {
  priceListId: string;
  onClose: () => void;
  onSaved: (detail: PriceListDetail) => void;
}) {
  const [search, setSearch] = useState('');
  const [catalog, setCatalog] = useState<readonly CrmCatalogMaterial[]>([]);
  const [rows, setRows] = useState<readonly PriceRowDraft[]>([]);
  const [invalidIds, setInvalidIds] = useState<readonly string[]>([]);
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
        setCatalog(result);
        setError(undefined);
      })
      .catch((cause) => active && setError(errorMessage(cause, 'Không tải được danh mục Kho.')))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [q]);

  const touch = (next: readonly PriceRowDraft[]) => {
    setRows(next);
    setInvalidIds([]);
    setError(undefined);
  };
  const add = (materials: readonly CrmCatalogMaterial[]) => {
    const have = new Set(rows.map((row) => row.material.id));
    const fresh = materials.filter((material) => !have.has(material.id)).map((material) => newPriceRow(material));
    if (fresh.length) touch([...rows, ...fresh]);
  };
  const remove = (ids: readonly string[]) => touch(rows.filter((row) => !ids.includes(row.material.id)));
  const patch = (id: string, change: Partial<Pick<PriceRowDraft, 'unit' | 'price' | 'vat'>>) =>
    touch(rows.map((row) => (row.material.id === id ? { ...row, ...change } : row)));

  const catalogColumns: ColumnsType<CrmCatalogMaterial> = [
    { title: 'Mã', dataIndex: 'code', width: 150, render: (value: string) => <span className={styles.mono}>{value}</span> },
    { title: 'Tên', dataIndex: 'name', ellipsis: true },
    { title: 'Nhóm', dataIndex: 'kind', width: 100, render: (value: string | null) => kindLabel(value) },
    { title: 'Phân loại', dataIndex: 'tradeCategory', width: 140, ellipsis: true, render: (value: string | null | undefined) => value ?? '—' },
    { title: 'ĐVT', dataIndex: 'unit', width: 90 },
    {
      title: 'Giá vốn bình quân',
      dataIndex: 'avgCost',
      width: 150,
      align: 'right',
      render: (value: number | null) => (value === null ? '—' : formatMoney(value)),
    },
    {
      title: 'Giá bán đề xuất (Kho)',
      dataIndex: 'salePrice',
      width: 150,
      align: 'right',
      render: (value: number | null | undefined) => (value === null || value === undefined ? '—' : formatMoney(value)),
    },
  ];

  const rowColumns: ColumnsType<PriceRowDraft> = [
    { title: 'Mã', key: 'code', width: 130, render: (_: unknown, row) => <span className={styles.mono}>{row.material.code}</span> },
    { title: 'Tên mặt hàng', key: 'name', ellipsis: true, render: (_: unknown, row) => row.material.name },
    {
      title: 'Giá vốn bình quân',
      key: 'avgCost',
      width: 150,
      align: 'right',
      render: (_: unknown, row) => (row.material.avgCost == null ? '—' : formatMoney(row.material.avgCost)),
    },
    {
      title: 'Giá bán đề xuất (Kho)',
      key: 'salePrice',
      width: 150,
      align: 'right',
      render: (_: unknown, row) => (row.material.salePrice == null ? '—' : formatMoney(row.material.salePrice)),
    },
    {
      title: 'ĐVT',
      key: 'unit',
      width: 90,
      render: (_: unknown, row) =>
        row.material.unit?.trim() ? (
          row.material.unit
        ) : (
          <input
            className={styles.input}
            aria-label={`Đơn vị tính ${row.material.code}`}
            aria-invalid={invalidIds.includes(row.material.id) || undefined}
            maxLength={50}
            value={row.unit}
            onChange={(event) => patch(row.material.id, { unit: event.target.value })}
          />
        ),
    },
    {
      title: 'Đơn giá (VND)',
      key: 'price',
      width: 150,
      render: (_: unknown, row) => (
        <input
          className={styles.input}
          inputMode="decimal"
          aria-label={`Đơn giá ${row.material.code}`}
          aria-invalid={invalidIds.includes(row.material.id) || undefined}
          value={row.price}
          onChange={(event) => patch(row.material.id, { price: event.target.value })}
        />
      ),
    },
    {
      title: 'Thuế suất (%)',
      key: 'vat',
      width: 110,
      render: (_: unknown, row) => (
        <input
          className={styles.input}
          inputMode="decimal"
          aria-label={`Thuế suất ${row.material.code}`}
          aria-invalid={invalidIds.includes(row.material.id) || undefined}
          value={row.vat}
          onChange={(event) => patch(row.material.id, { vat: event.target.value })}
        />
      ),
    },
    {
      title: '',
      key: 'remove',
      width: 44,
      render: (_: unknown, row) => (
        <button type="button" className={styles.iconButton} aria-label={`Bỏ ${row.material.code}`} onClick={() => remove([row.material.id])}>
          <X size={14} />
        </button>
      ),
    },
  ];

  async function submit() {
    const built = buildPriceListItems(rows);
    if (!built.ok) {
      setInvalidIds(built.invalidIds);
      return setError(built.error);
    }
    setSaving(true);
    setError(undefined);
    try {
      const detail = await upsertPriceListItems(priceListId, { items: built.items });
      toast.success(`Đã lưu ${built.items.length} dòng giá.`);
      onSaved(detail);
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được dòng giá.'));
      setSaving(false);
    }
  }

  return (
    <CrmDialog
      open
      extraWide
      title="Thêm dòng giá"
      subtitle="Chọn một hoặc nhiều mặt hàng từ danh mục Kho, rồi nhập đơn giá và thuế suất cho từng mặt hàng."
      submitLabel={rows.length ? `Lưu ${rows.length} dòng giá` : 'Lưu'}
      submitting={saving}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <input
        className={styles.input}
        type="search"
        placeholder="Tìm theo mã hoặc tên mặt hàng…"
        maxLength={100}
        autoFocus
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <Table<CrmCatalogMaterial>
        size="small"
        rowKey="id"
        loading={loading}
        columns={catalogColumns}
        dataSource={[...catalog]}
        pagination={false}
        scroll={{ y: 240 }}
        rowSelection={{
          type: 'checkbox',
          selectedRowKeys: rows.map((row) => row.material.id),
          onSelect: (record, selected) => (selected ? add([record]) : remove([record.id])),
          onSelectAll: (selected, _selectedRows, changed) => (selected ? add(changed) : remove(changed.map((material) => material.id))),
        }}
        onRow={(row) => ({
          onClick: () => (rows.some((entry) => entry.material.id === row.id) ? remove([row.id]) : add([row])),
        })}
        locale={{ emptyText: loading ? 'Đang tải…' : 'Không có mặt hàng nào.' }}
      />
      {rows.length ? (
        <>
          <h4 className={styles.muted}>Mặt hàng đã chọn ({rows.length})</h4>
          <Table<PriceRowDraft>
            size="small"
            rowKey={(row) => row.material.id}
            columns={rowColumns}
            dataSource={[...rows]}
            pagination={false}
            scroll={{ y: 280 }}
          />
        </>
      ) : null}
    </CrmDialog>
  );
}

/** Sửa một dòng giá: mặt hàng và đơn vị cố định, chỉ đổi đơn giá và thuế suất. */
export function EditPriceItemDialog({
  priceListId,
  item,
  onClose,
  onSaved,
}: {
  priceListId: string;
  item: PriceListItem;
  onClose: () => void;
  onSaved: (detail: PriceListDetail) => void;
}) {
  const [price, setPrice] = useState(String(item.price));
  const [vat, setVat] = useState(String(item.vatRate));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    const parsedPrice = parseNumber(price);
    const parsedVat = parseNumber(vat);
    if (parsedPrice === undefined || parsedPrice < 0) return setError('Đơn giá phải là số không âm.');
    if (parsedVat === undefined || parsedVat < 0 || parsedVat > 100) return setError('Thuế suất phải là số từ 0 đến 100.');
    setSubmitting(true);
    setError(undefined);
    try {
      const detail = await updatePriceListItem(priceListId, item.id, {
        materialId: item.materialId,
        materialCode: item.materialCode,
        materialName: item.materialName,
        unit: item.unit,
        price: parsedPrice,
        vatRate: parsedVat,
      });
      toast.success('Đã lưu dòng giá.');
      onSaved(detail);
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được dòng giá.'));
      setSubmitting(false);
    }
  }

  return (
    <CrmDialog
      open
      title="Sửa dòng giá"
      subtitle={`${item.materialCode} · ${item.materialName} (${item.unit}). Mặt hàng lấy từ Kho nên chỉ đổi được đơn giá và thuế suất.`}
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <div className={styles.fieldGrid}>
        <Field label="Đơn giá (VND)" required>
          <input className={styles.input} inputMode="decimal" value={price} autoFocus onChange={(event) => setPrice(event.target.value)} />
        </Field>
        <Field label="Thuế suất (%)" required hint="Từ 0 đến 100, cho phép số thập phân">
          <input className={styles.input} inputMode="decimal" value={vat} onChange={(event) => setVat(event.target.value)} />
        </Field>
      </div>
    </CrmDialog>
  );
}
