'use client';

import {
  PRICE_SOURCE_LABELS,
  type CustomerSummary,
  type PricedLine,
  type PriceListItem,
  type PricingResult,
  type QuotePreviewLine,
} from '@enterprise-platform/contracts-crm';
import { SearchableSelect, type SearchableSelectOption } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { StatusPill } from '../components/crm-ui';
import { errorMessage, getPriceList, listCustomers, listPriceLists, previewQuote } from '../crm-api';
import { groupOptions, useCrm } from '../crm-context';
import styles from '../sales.module.scss';
import local from './pricing.module.scss';
import { formatMoney, formatPercent, parseNumber } from './pricing.model';

interface LineDraft {
  readonly key: number;
  materialId: string;
  unit: string;
  quantity: string;
  category: string;
  overrideUnitPrice: string;
  overrideDiscountPercent: string;
}

type Material = Pick<PriceListItem, 'materialId' | 'materialCode' | 'materialName' | 'unit'>;

let lineKey = 0;
function emptyLine(): LineDraft {
  lineKey += 1;
  return { key: lineKey, materialId: '', unit: '', quantity: '1', category: '', overrideUnitPrice: '', overrideDiscountPercent: '' };
}

/**
 * "Thử tính giá": gọi `POST /pricing/quote-preview` để quản trị bán hàng kiểm
 * bảng giá và chính sách vừa cấu hình áp đúng (TC-UAT-04) trước khi báo giá dùng.
 * Mặt hàng chọn trong các dòng của bảng giá hiện có.
 */
export function QuotePreviewPanel() {
  const { groups } = useCrm();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [customers, setCustomers] = useState<readonly CustomerSummary[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [date, setDate] = useState('');
  const [lines, setLines] = useState<LineDraft[]>(() => [emptyLine()]);
  const [shipping, setShipping] = useState('');
  const [shippingVat, setShippingVat] = useState('10');
  const [result, setResult] = useState<PricingResult>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    listCustomers({ limit: 100 })
      .then((page) => setCustomers(page.items))
      .catch(() => undefined);
    // Mặt hàng lấy từ các bảng giá (danh mục Kho chưa có API nội bộ).
    listPriceLists()
      .then((lists) => Promise.all(lists.slice(0, 20).map((list) => getPriceList(list.id))))
      .then((details) => {
        const seen = new Map<string, Material>();
        for (const item of details.flatMap((detail) => detail.items)) {
          const key = `${item.materialId}|${item.unit}`;
          if (!seen.has(key)) seen.set(key, item);
        }
        setMaterials([...seen.values()].sort((left, right) => left.materialCode.localeCompare(right.materialCode)));
      })
      .catch((cause) => setError(errorMessage(cause, 'Không tải được mặt hàng trong bảng giá.')));
  }, []);

  const materialOptions = useMemo<SearchableSelectOption[]>(
    () =>
      materials.map((material) => ({
        value: `${material.materialId}|${material.unit}`,
        label: material.materialName,
        badge: material.materialCode,
        description: material.unit,
      })),
    [materials],
  );
  const customerOptions = customers.map((customer) => ({ value: customer.id, label: customer.name, badge: customer.code }));

  const update = (key: number, patch: Partial<LineDraft>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  async function run() {
    setError(undefined);
    const payload: QuotePreviewLine[] = [];
    for (const [index, line] of lines.entries()) {
      const material = materials.find((entry) => entry.materialId === line.materialId && entry.unit === line.unit);
      if (!line.materialId) return setError(`Dòng ${index + 1}: vui lòng chọn mặt hàng.`);
      payload.push({
        materialId: line.materialId,
        materialCode: material?.materialCode,
        materialName: material?.materialName,
        unit: line.unit,
        category: line.category.trim() || null,
        quantity: parseNumber(line.quantity) ?? Number.NaN,
        overrideUnitPrice: line.overrideUnitPrice.trim() ? (parseNumber(line.overrideUnitPrice) ?? Number.NaN) : null,
        overrideDiscountPercent: line.overrideDiscountPercent.trim()
          ? (parseNumber(line.overrideDiscountPercent) ?? Number.NaN)
          : null,
      });
    }
    const shippingAmount = shipping.trim() ? parseNumber(shipping) : undefined;
    setRunning(true);
    try {
      setResult(
        await previewQuote({
          customerId: customerId || null,
          customerGroupId: customerId ? null : groupId || null,
          date: date || null,
          lines: payload,
          shipping: shippingAmount === undefined ? null : { amount: shippingAmount, vatRate: parseNumber(shippingVat) ?? null },
        }),
      );
    } catch (cause) {
      setResult(undefined);
      setError(errorMessage(cause, 'Không tính được giá.'));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.panel} aria-label="Thử tính giá">
        <h2 className={styles.title}>Thử tính giá</h2>
        <p className={styles.muted}>
          Chạy đúng engine giá mà báo giá dùng, với bảng giá và chính sách đang lưu. Không tạo báo giá.
        </p>
        <div className={styles.fieldGrid}>
          <label className={local.inlineField}>
            Khách hàng
            <SearchableSelect
              options={customerOptions}
              value={customerId}
              placeholder="Chọn khách (nhóm lấy theo hồ sơ)"
              clearable
              onChange={setCustomerId}
            />
          </label>
          <label className={local.inlineField}>
            Hoặc nhóm khách hàng
            <SearchableSelect
              options={groupOptions(groups)}
              value={customerId ? '' : groupId}
              placeholder="Không thuộc nhóm"
              disabled={Boolean(customerId)}
              clearable
              onChange={setGroupId}
            />
          </label>
          <label className={local.inlineField}>
            Ngày tính giá
            <DatePickerInput value={date || undefined} onChange={setDate} height={38} placeholder="Hôm nay" aria-label="Ngày tính giá" />
          </label>
          <span className={local.capForm}>
            <label className={local.inlineField}>
              Phí vận chuyển (VND)
              <input className={styles.input} inputMode="decimal" value={shipping} onChange={(event) => setShipping(event.target.value)} />
            </label>
            <label className={local.inlineField}>
              Thuế suất vận chuyển (%)
              <input className={`${styles.input} ${local.capInput}`} inputMode="decimal" value={shippingVat} onChange={(event) => setShippingVat(event.target.value)} />
            </label>
          </span>
        </div>

        <h3 className={styles.sectionTitle}>Dòng hàng</h3>
        <div className={local.previewLines}>
          {lines.map((line) => (
            <div key={line.key} className={local.previewLine}>
              <label className={local.inlineField}>
                Mặt hàng
                <SearchableSelect
                  options={materialOptions}
                  value={line.materialId ? `${line.materialId}|${line.unit}` : ''}
                  placeholder="Chọn mặt hàng trong bảng giá"
                  emptyText="Chưa có mặt hàng nào trong bảng giá"
                  onChange={(value) => {
                    const [materialId = '', unit = ''] = value.split('|');
                    update(line.key, { materialId, unit });
                  }}
                />
              </label>
              <label className={local.inlineField}>
                Số lượng
                <input className={styles.input} inputMode="decimal" value={line.quantity} onChange={(event) => update(line.key, { quantity: event.target.value })} />
              </label>
              <label className={local.inlineField}>
                Đơn vị tính
                <input className={styles.input} value={line.unit} onChange={(event) => update(line.key, { unit: event.target.value })} />
              </label>
              <label className={local.inlineField}>
                Nhóm hàng
                <input className={styles.input} value={line.category} onChange={(event) => update(line.key, { category: event.target.value })} />
              </label>
              <label className={local.inlineField}>
                Ghi đè đơn giá
                <input className={styles.input} inputMode="decimal" value={line.overrideUnitPrice} onChange={(event) => update(line.key, { overrideUnitPrice: event.target.value })} />
              </label>
              <label className={local.inlineField}>
                Ghi đè CK (%)
                <input className={styles.input} inputMode="decimal" value={line.overrideDiscountPercent} onChange={(event) => update(line.key, { overrideDiscountPercent: event.target.value })} />
              </label>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Bỏ dòng"
                disabled={lines.length === 1}
                onClick={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
        <span className={styles.toolbar}>
          <button type="button" className={styles.buttonGhost} onClick={() => setLines((current) => [...current, emptyLine()])}>
            <Plus size={14} /> Thêm dòng
          </button>
          <button type="button" className={styles.buttonPrimary} disabled={running} onClick={() => void run()}>
            {running ? 'Đang tính…' : 'Tính giá'}
          </button>
        </span>
        {error ? <p role="alert" className={styles.alert}>{error}</p> : null}
      </section>
      {result ? <PreviewResult result={result} /> : null}
    </div>
  );
}

function PreviewResult({ result }: { result: PricingResult }) {
  const columns = useMemo<ColumnsType<PricedLine>>(
    () => [
      {
        title: 'Mặt hàng',
        key: 'material',
        render: (_: unknown, row) => (
          <span>
            <span className={styles.mono}>{row.materialCode ?? ''}</span> {row.materialName ?? ''}
          </span>
        ),
      },
      { title: 'SL', dataIndex: 'quantity', width: 70, align: 'right', render: (value: number, row) => `${formatMoney(value)} ${row.unit}` },
      { title: 'Đơn giá gốc', dataIndex: 'listPrice', width: 120, align: 'right', render: (value: number) => formatMoney(value) },
      {
        title: 'Nguồn giá',
        key: 'source',
        width: 150,
        render: (_: unknown, row) => `${PRICE_SOURCE_LABELS[row.priceSource]}${row.priceReferenceCode ? ` ${row.priceReferenceCode}` : ''}`,
      },
      {
        title: 'Chính sách đã áp',
        key: 'policies',
        render: (_: unknown, row) =>
          row.appliedPolicies.length ? (
            row.appliedPolicies.map((policy) => (
              <span key={policy.policyId} className={local.policyTag}>
                {policy.code}: {formatPercent(policy.percent)}
                {policy.exclusive ? ' (độc quyền)' : ''}
              </span>
            ))
          ) : (
            <span className={styles.muted}>Không có</span>
          ),
      },
      {
        title: 'Chiết khấu',
        key: 'discount',
        width: 150,
        align: 'right',
        render: (_: unknown, row) => (
          <span className={styles.cellWithPill}>
            {formatPercent(row.discountPercent)}
            {row.cappedAt !== null ? <StatusPill tone="warning">Chạm trần</StatusPill> : null}
            {row.overridden ? <StatusPill tone="info">Ghi đè</StatusPill> : null}
          </span>
        ),
      },
      { title: 'Đơn giá sau CK', dataIndex: 'unitPriceAfterDiscount', width: 130, align: 'right', render: (value: number) => formatMoney(value) },
      { title: 'Thành tiền', dataIndex: 'lineAmount', width: 130, align: 'right', render: (value: number) => formatMoney(value) },
      { title: 'VAT', key: 'vat', width: 120, align: 'right', render: (_: unknown, row) => `${formatMoney(row.vatAmount)} (${formatPercent(row.vatRate)})` },
      { title: 'Cộng', dataIndex: 'lineTotal', width: 130, align: 'right', render: (value: number) => formatMoney(value) },
    ],
    [],
  );
  const totals = result.totals;
  return (
    <section className={styles.tableCard} aria-label="Kết quả tính giá">
      <h2 className={styles.title}>Kết quả ngày {result.date.split('-').reverse().join('/')}</h2>
      <p className={styles.muted}>Trần tổng chiết khấu: {formatPercent(result.discountCapPercent)}. Tiền làm tròn đến đồng theo từng dòng.</p>
      <Table<PricedLine> size="small" rowKey="index" columns={columns} dataSource={[...result.lines]} pagination={false} scroll={{ x: 1200 }} />
      <dl className={local.totals}>
        <dt>Tiền hàng theo giá gốc</dt>
        <dd>{formatMoney(totals.grossAmount)}</dd>
        <dt>Chiết khấu</dt>
        <dd>{formatMoney(totals.discountAmount)}</dd>
        <dt>Tiền hàng sau chiết khấu</dt>
        <dd>{formatMoney(totals.netAmount)}</dd>
        {result.shipping ? (
          <>
            <dt>Phí vận chuyển (VAT {formatPercent(result.shipping.vatRate)})</dt>
            <dd>{formatMoney(result.shipping.amount)}</dd>
          </>
        ) : null}
        <dt>Tiền thuế VAT</dt>
        <dd>{formatMoney(totals.vatAmount)}</dd>
        <dt className={local.grandTotal}>Tổng cộng</dt>
        <dd className={local.grandTotal}>{formatMoney(totals.totalAmount)}</dd>
      </dl>
    </section>
  );
}
