'use client';

import {
  CONTRACT_STATUS_LABELS,
  CONTRACT_TYPE_LABELS,
  type ContractDetail,
  type ContractStatus,
  type ContractSummary,
  type ContractType,
  type CustomerSummary,
  type SaveContractRequest,
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
import { createContract, errorMessage, listContracts, listCustomers, updateContract } from '../crm-api';
import { labelOptions, peopleOptions, useCrm } from '../crm-context';
import { CONTRACT_STATUS_TONE, formatDay } from '../fulfillment.model';
import { parseNumber } from '../pricing/pricing.model';
import { formatMoney, personName } from '../sales.model';
import styles from '../sales.module.scss';

/** Được lập, sửa, xác nhận hợp đồng (`crm.contract.write`). */
export function useCanWriteContract(): boolean {
  const { capabilities } = useCrm();
  return capabilities.isTenantAdmin || capabilities.canWriteContract;
}

/**
 * Danh sách hợp đồng trong phạm vi dữ liệu (T4-15): tìm theo mã, tên hợp đồng,
 * tên khách; lọc loại, trạng thái, người phụ trách, sắp hết hạn trong 30 ngày.
 */
export function ContractsPage({ onOpen }: { onOpen: (id: string) => void }) {
  const { people } = useCrm();
  const canWrite = useCanWriteContract();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [expiring, setExpiring] = useState(false);
  const [creating, setCreating] = useState(false);
  const q = useDebounced(search.trim(), 350);
  const filter = { q, status, type, ownerUserId, expiring };
  const list = useKeysetPage(JSON.stringify(filter), (cursor) =>
    listContracts({
      q,
      status: (status || undefined) as ContractStatus | undefined,
      type: (type || undefined) as ContractType | undefined,
      ownerUserId,
      expiringWithinDays: expiring ? 30 : undefined,
      cursor,
      limit: 30,
    }),
  );

  const columns = useMemo<ColumnsType<ContractSummary>>(
    () => [
      { title: 'Mã', dataIndex: 'code', width: 120, render: (value: string) => <span className={styles.mono}>{value}</span> },
      { title: 'Tên hợp đồng', dataIndex: 'title', ellipsis: true },
      { title: 'Loại', dataIndex: 'type', width: 170, render: (value: ContractType) => CONTRACT_TYPE_LABELS[value] },
      { title: 'Khách hàng', key: 'customer', width: 220, ellipsis: true, render: (_: unknown, row) => `${row.customerCode} - ${row.customerName}` },
      {
        title: 'Trạng thái',
        dataIndex: 'status',
        width: 120,
        render: (value: ContractStatus) => <StatusPill tone={CONTRACT_STATUS_TONE[value]}>{CONTRACT_STATUS_LABELS[value]}</StatusPill>,
      },
      {
        title: 'Hiệu lực',
        key: 'validity',
        width: 200,
        render: (_: unknown, row) => `${formatDay(row.validFrom)} - ${row.validTo ? formatDay(row.validTo) : 'không thời hạn'}`,
      },
      { title: 'Giá trị', dataIndex: 'value', width: 150, align: 'right', render: (value: number) => formatMoney(value) },
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
    <section className={styles.tableCard} aria-label="Danh sách hợp đồng">
      <div className={styles.toolbar}>
        {canWrite ? (
          <button type="button" className={styles.buttonPrimary} onClick={() => setCreating(true)}>
            <Plus size={14} /> Lập hợp đồng
          </button>
        ) : null}
        <input
          className={`${styles.input} ${styles.search}`}
          type="search"
          placeholder="Tìm theo mã, tên hợp đồng, tên khách…"
          value={search}
          maxLength={100}
          onChange={(event) => setSearch(event.target.value)}
        />
        <SearchableSelect className={styles.filter} options={labelOptions(CONTRACT_TYPE_LABELS)} value={type} placeholder="Mọi loại" clearable onChange={setType} />
        <SearchableSelect className={styles.filter} options={labelOptions(CONTRACT_STATUS_LABELS)} value={status} placeholder="Mọi trạng thái" clearable onChange={setStatus} />
        <SearchableSelect className={styles.filter} options={peopleOptions(people)} value={ownerUserId} placeholder="Mọi người phụ trách" clearable onChange={setOwnerUserId} />
        <label className={styles.checkbox}>
          <input type="checkbox" checked={expiring} onChange={(event) => setExpiring(event.target.checked)} />
          Sắp hết hạn (30 ngày)
        </label>
      </div>
      {list.error ? <p className={styles.alert}>{list.error}</p> : null}
      <Table<ContractSummary>
        size="small"
        rowKey="id"
        loading={list.loading}
        columns={columns}
        dataSource={[...list.items]}
        pagination={false}
        scroll={{ x: 1300 }}
        onRow={(row) => ({ onDoubleClick: () => onOpen(row.id) })}
        locale={{ emptyText: list.loading ? 'Đang tải…' : 'Chưa có hợp đồng nào.' }}
      />
      <KeysetPager page={list.page} count={list.items.length} hasNext={list.hasNext} loading={list.loading} noun="hợp đồng" onPrevious={list.previous} onNext={list.next} />
      {creating ? (
        <ContractFormDialog
          onClose={() => setCreating(false)}
          onSaved={(detail) => {
            setCreating(false);
            onOpen(detail.id);
          }}
        />
      ) : null}
    </section>
  );
}

/** Lập hợp đồng (phần đầu; dòng giá khung, đợt thanh toán thêm ở màn chi tiết) hoặc sửa phần đầu hợp đồng Nháp. */
export function ContractFormDialog({
  contract,
  onClose,
  onSaved,
}: {
  contract?: ContractDetail;
  onClose: () => void;
  onSaved: (detail: ContractDetail) => void;
}) {
  const { people } = useCrm();
  const [customers, setCustomers] = useState<readonly CustomerSummary[]>([]);
  const [type, setType] = useState<string>(contract?.type ?? 'SALE');
  const [customerId, setCustomerId] = useState(contract?.customerId ?? '');
  const [title, setTitle] = useState(contract?.title ?? '');
  const [signedDate, setSignedDate] = useState(contract?.signedDate ?? '');
  const [validFrom, setValidFrom] = useState(contract?.validFrom ?? '');
  const [validTo, setValidTo] = useState(contract?.validTo ?? '');
  const [value, setValue] = useState(contract ? String(contract.value) : '');
  const [warrantyMonths, setWarrantyMonths] = useState(contract?.warrantyMonths === null || !contract ? '' : String(contract.warrantyMonths));
  const [warehouseCode, setWarehouseCode] = useState(contract?.warehouseCode ?? '');
  const [ownerUserId, setOwnerUserId] = useState(contract?.ownerUserId ?? '');
  const [note, setNote] = useState(contract?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    listCustomers({ limit: 100 })
      .then((page) => setCustomers(page.items))
      .catch(() => undefined);
  }, []);

  const customerOptions = useMemo(() => {
    const options = customers.map((item) => ({ value: item.id, label: item.name, badge: item.code }));
    if (contract && !options.some((option) => option.value === contract.customerId)) {
      options.unshift({ value: contract.customerId, label: contract.customerName, badge: contract.customerCode });
    }
    return options;
  }, [customers, contract]);

  async function save() {
    if (!customerId) return setError('Vui lòng chọn khách hàng.');
    if (!title.trim()) return setError('Vui lòng nhập tên hợp đồng.');
    if (!validFrom) return setError('Vui lòng nhập ngày bắt đầu hiệu lực.');
    const amount = value.trim() ? parseNumber(value) : null;
    if (amount === undefined) return setError('Giá trị hợp đồng không hợp lệ.');
    const body: SaveContractRequest = {
      type: type as ContractType,
      customerId,
      title: title.trim(),
      signedDate: signedDate || null,
      validFrom,
      validTo: validTo || null,
      value: amount,
      warrantyMonths: warrantyMonths.trim() ? Number(warrantyMonths) : null,
      warehouseCode: warehouseCode.trim() || null,
      ownerUserId: ownerUserId || null,
      note: note.trim() || null,
    };
    setSaving(true);
    setError(undefined);
    try {
      const saved = contract ? await updateContract(contract.id, { ...body, revision: contract.revision }) : await createContract(body);
      toast.success(contract ? 'Đã lưu hợp đồng.' : `Đã lập hợp đồng ${saved.code}.`);
      onSaved(saved);
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được hợp đồng.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <CrmDialog
      open
      wide
      title={contract ? `Sửa hợp đồng ${contract.code}` : 'Lập hợp đồng'}
      subtitle="Dòng giá khung và đợt thanh toán nhập ở màn chi tiết"
      submitLabel={contract ? 'Lưu' : 'Lập hợp đồng'}
      submitting={saving}
      error={error}
      onClose={onClose}
      onSubmit={() => void save()}
    >
      <div className={styles.fieldGrid}>
        <Field label="Loại hợp đồng" required>
          <SearchableSelect options={labelOptions(CONTRACT_TYPE_LABELS)} value={type} onChange={setType} />
        </Field>
        <Field label="Khách hàng" required>
          <SearchableSelect options={customerOptions} value={customerId} placeholder="Chọn khách hàng" onChange={setCustomerId} />
        </Field>
        <Field label="Tên hợp đồng" required wide>
          <input className={styles.input} maxLength={300} value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label="Ngày ký">
          <DatePickerInput value={signedDate || undefined} onChange={setSignedDate} height={38} aria-label="Ngày ký" />
        </Field>
        <Field label="Hiệu lực từ" required>
          <DatePickerInput value={validFrom || undefined} onChange={setValidFrom} height={38} aria-label="Hiệu lực từ" />
        </Field>
        <Field label="Hiệu lực đến" hint="Bỏ trống: không thời hạn">
          <DatePickerInput value={validTo || undefined} onChange={setValidTo} height={38} aria-label="Hiệu lực đến" />
        </Field>
        <Field label="Giá trị hợp đồng (VND)" hint="Bỏ trống: cộng thành tiền gồm VAT của các dòng có số lượng">
          <input className={styles.input} inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} />
        </Field>
        <Field label="Bảo hành (tháng)">
          <input className={styles.input} inputMode="numeric" value={warrantyMonths} onChange={(event) => setWarrantyMonths(event.target.value.replace(/[^\d]/g, ''))} />
        </Field>
        <Field label="Mã kho giữ hàng" hint="Bắt buộc trước khi xác nhận nếu có dòng hàng tồn kho có số lượng">
          <input className={styles.input} maxLength={50} value={warehouseCode} onChange={(event) => setWarehouseCode(event.target.value.toUpperCase())} />
        </Field>
        <Field label="Người phụ trách" hint="Bỏ trống: chính bạn">
          <SearchableSelect options={peopleOptions(people)} value={ownerUserId} placeholder="Chính bạn" clearable onChange={setOwnerUserId} />
        </Field>
        <Field label="Ghi chú" wide>
          <textarea className={styles.textarea} rows={3} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
    </CrmDialog>
  );
}
