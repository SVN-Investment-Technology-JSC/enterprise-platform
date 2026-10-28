'use client';

import {
  SALES_ORDER_SOURCE_LABELS,
  SALES_ORDER_STATUS_LABELS,
  type ContractSummary,
  type CustomerSummary,
  type SalesOrderSource,
  type SalesOrderStatus,
  type SalesOrderSummary,
} from '@enterprise-platform/contracts-crm';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CrmDialog, Field, KeysetPager, StatusPill } from '../components/crm-ui';
import { useDebounced } from '../components/use-debounced';
import { useKeysetPage } from '../components/use-keyset-page';
import { createOrder, errorMessage, listContracts, listCustomers, listOrders } from '../crm-api';
import { labelOptions, peopleOptions, useCrm } from '../crm-context';
import { ORDER_STATUS_TONE, formatDay } from '../fulfillment.model';
import { formatMoney, personName } from '../sales.model';
import styles from '../sales.module.scss';

/** Được lập, xác nhận đơn bán (`crm.order.write`). */
export function useCanWriteOrder(): boolean {
  const { capabilities } = useCrm();
  return capabilities.isTenantAdmin || capabilities.canWriteOrder;
}

/**
 * Danh sách đơn bán trong phạm vi dữ liệu (T4-16): cờ giao trễ (đợt quá ngày dự
 * kiến chưa xuất kho), bộ lọc "chỉ đơn giao trễ" (ORD-06), trạng thái, người
 * phụ trách.
 */
export function OrdersPage({ onOpen }: { onOpen: (id: string) => void }) {
  const { people } = useCrm();
  const canWrite = useCanWriteOrder();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [late, setLate] = useState(false);
  const [creating, setCreating] = useState(false);
  const q = useDebounced(search.trim(), 350);
  const filter = { q, status, ownerUserId, late };
  const list = useKeysetPage(JSON.stringify(filter), (cursor) =>
    listOrders({ q, status: (status || undefined) as SalesOrderStatus | undefined, ownerUserId, late: late || undefined, cursor, limit: 30 }),
  );

  const columns = useMemo<ColumnsType<SalesOrderSummary>>(
    () => [
      {
        title: 'Mã',
        dataIndex: 'code',
        width: 150,
        render: (value: string, row) => (
          <span className={styles.cellWithPill}>
            <span className={styles.mono}>{value}</span>
            {row.late ? <StatusPill tone="danger">Giao trễ</StatusPill> : null}
          </span>
        ),
      },
      { title: 'Khách hàng', key: 'customer', ellipsis: true, render: (_: unknown, row) => `${row.customerCode} - ${row.customerName}` },
      {
        title: 'Nguồn',
        key: 'source',
        width: 190,
        render: (_: unknown, row) =>
          `${SALES_ORDER_SOURCE_LABELS[row.source as SalesOrderSource]}${row.contractCode ? ` · ${row.contractCode}` : ''}${row.quoteCode ? ` · ${row.quoteCode}` : ''}`,
      },
      {
        title: 'Trạng thái',
        dataIndex: 'status',
        width: 160,
        render: (value: SalesOrderStatus) => <StatusPill tone={ORDER_STATUS_TONE[value]}>{SALES_ORDER_STATUS_LABELS[value]}</StatusPill>,
      },
      { title: 'Ngày đơn', dataIndex: 'orderDate', width: 110, render: (value: string) => formatDay(value) },
      { title: 'Giao dự kiến', dataIndex: 'expectedDeliveryDate', width: 120, render: (value: string | null) => formatDay(value) },
      { title: 'Tổng cộng', dataIndex: 'totalAmount', width: 150, align: 'right', render: (value: number) => formatMoney(value) },
      {
        title: 'Còn phải thu',
        dataIndex: 'outstanding',
        width: 140,
        align: 'right',
        render: (value: number | null | undefined) => (value ? formatMoney(value) : ''),
      },
      { title: 'Người phụ trách', dataIndex: 'ownerUserId', width: 160, ellipsis: true, render: (value: string) => personName(people, value) },
      {
        title: '',
        key: 'actions',
        width: 70,
        render: (_: unknown, row) => (
          <button type="button" className={styles.rowAction} onClick={() => onOpen(row.id)}>
            Mở
          </button>
        ),
      },
    ],
    [people, onOpen],
  );

  return (
    <section className={styles.tableCard} aria-label="Danh sách đơn bán">
      <div className={styles.toolbar}>
        {canWrite ? (
          <button type="button" className={styles.buttonPrimary} onClick={() => setCreating(true)}>
            <Plus size={14} /> Lập đơn bán
          </button>
        ) : null}
        <input
          className={`${styles.input} ${styles.search}`}
          type="search"
          placeholder="Tìm theo mã đơn, tên khách…"
          value={search}
          maxLength={100}
          onChange={(event) => setSearch(event.target.value)}
        />
        <SearchableSelect className={styles.filter} options={labelOptions(SALES_ORDER_STATUS_LABELS)} value={status} placeholder="Mọi trạng thái" clearable onChange={setStatus} />
        <SearchableSelect className={styles.filter} options={peopleOptions(people)} value={ownerUserId} placeholder="Mọi người phụ trách" clearable onChange={setOwnerUserId} />
        <label className={styles.checkbox}>
          <input type="checkbox" checked={late} onChange={(event) => setLate(event.target.checked)} />
          Chỉ đơn giao trễ
        </label>
      </div>
      {list.error ? <p className={styles.alert}>{list.error}</p> : null}
      <Table<SalesOrderSummary>
        size="small"
        rowKey="id"
        loading={list.loading}
        columns={columns}
        dataSource={[...list.items]}
        pagination={false}
        scroll={{ x: 1440 }}
        onRow={(row) => ({ onDoubleClick: () => onOpen(row.id) })}
        locale={{ emptyText: list.loading ? 'Đang tải…' : 'Chưa có đơn bán nào.' }}
      />
      <KeysetPager page={list.page} count={list.items.length} hasNext={list.hasNext} loading={list.loading} noun="đơn" onPrevious={list.previous} onNext={list.next} />
      {creating ? (
        <CreateOrderDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            onOpen(id);
          }}
        />
      ) : null}
    </section>
  );
}

/** Lập đơn trực tiếp cho khách, hoặc từ hợp đồng đang hiệu lực (giá khung của hợp đồng). Dòng thêm ở màn chi tiết. */
function CreateOrderDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [customers, setCustomers] = useState<readonly CustomerSummary[]>([]);
  const [contracts, setContracts] = useState<readonly ContractSummary[]>([]);
  const [contractId, setContractId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [warehouseCode, setWarehouseCode] = useState('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    listCustomers({ limit: 100 })
      .then((page) => setCustomers(page.items))
      .catch(() => undefined);
    listContracts({ status: 'ACTIVE', limit: 100 })
      .then((page) => setContracts(page.items))
      .catch(() => undefined);
  }, []);

  async function save() {
    if (!contractId && !customerId) return setError('Vui lòng chọn khách hàng hoặc hợp đồng.');
    setSaving(true);
    setError(undefined);
    try {
      const created = await createOrder({
        contractId: contractId || null,
        customerId: contractId ? null : customerId,
        warehouseCode: warehouseCode.trim() || null,
        expectedDeliveryDate: expectedDeliveryDate || null,
        deliveryAddress: deliveryAddress.trim() || null,
        note: note.trim() || null,
      });
      toast.success(`Đã lập đơn ${created.code}.`);
      onCreated(created.id);
    } catch (cause) {
      setError(errorMessage(cause, 'Không lập được đơn bán.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <CrmDialog open title="Lập đơn bán" subtitle="Dòng hàng thêm ở màn chi tiết đơn" submitLabel="Lập đơn" submitting={saving} error={error} onClose={onClose} onSubmit={() => void save()}>
      <div className={styles.fieldGrid}>
        <Field label="Từ hợp đồng" hint="Đơn dùng giá khung và khách của hợp đồng">
          <SearchableSelect
            options={contracts.map((item) => ({ value: item.id, label: item.title, badge: item.code, description: item.customerName }))}
            value={contractId}
            placeholder="Không gắn hợp đồng"
            clearable
            onChange={setContractId}
          />
        </Field>
        <Field label="Hoặc khách hàng">
          <SearchableSelect
            options={customers.map((item) => ({ value: item.id, label: item.name, badge: item.code }))}
            value={contractId ? '' : customerId}
            placeholder="Chọn khách hàng"
            disabled={Boolean(contractId)}
            clearable
            onChange={setCustomerId}
          />
        </Field>
        <Field label="Mã kho giữ hàng" hint="Bỏ trống với đơn từ hợp đồng: dùng kho của hợp đồng">
          <input className={styles.input} maxLength={50} value={warehouseCode} onChange={(event) => setWarehouseCode(event.target.value.toUpperCase())} />
        </Field>
        <Field label="Ngày giao dự kiến" hint="Hạn giữ hàng = ngày giao dự kiến + 2 ngày">
          <DatePickerInput value={expectedDeliveryDate || undefined} onChange={setExpectedDeliveryDate} height={38} aria-label="Ngày giao dự kiến" />
        </Field>
        <Field label="Địa chỉ giao" wide>
          <input className={styles.input} maxLength={500} value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} />
        </Field>
        <Field label="Ghi chú" wide>
          <textarea className={styles.textarea} rows={3} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
    </CrmDialog>
  );
}
