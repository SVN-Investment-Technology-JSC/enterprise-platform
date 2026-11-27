'use client';

import {
  CRM_LIST_PAGE_SIZE,
  CONTRACT_STATUS_LABELS,
  CONTRACT_TYPE_LABELS,
  type ContractDetail,
  type ContractLine,
  type ContractQuotePreview,
  type ContractStatus,
  type ContractSummary,
  type ContractType,
  type CustomerSummary,
  type QuoteSummary,
  type SaveContractRequest,
} from '@enterprise-platform/contracts-crm';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CrmDialog, Field, ListPager, rowOpener, StatusPill } from '../components/crm-ui';
import { useDebounced } from '../components/use-debounced';
import { usePagedList } from '../components/use-paged-list';
import { WarehouseSelect } from '../components/warehouse-select';
import { createContract, errorMessage, getContractQuotePreview, listContracts, listCustomers, listQuotes, updateContract } from '../crm-api';
import { labelOptions, peopleOptions, useCrm } from '../crm-context';
import { CONTRACT_STATUS_TONE, formatDay, formatQuantity } from '../fulfillment.model';
import { formatPercent, parseNumber } from '../pricing/pricing.model';
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
  const list = usePagedList(JSON.stringify(filter), CRM_LIST_PAGE_SIZE, (page) =>
    listContracts({
      q,
      status: (status || undefined) as ContractStatus | undefined,
      type: (type || undefined) as ContractType | undefined,
      ownerUserId,
      expiringWithinDays: expiring ? 30 : undefined,
      page,
      limit: CRM_LIST_PAGE_SIZE,
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
        onRow={(row) => rowOpener(() => onOpen(row.id))}
        locale={{ emptyText: list.loading ? 'Đang tải…' : 'Chưa có hợp đồng nào.' }}
      />
      <ListPager page={list.page} total={list.total} pageSize={list.pageSize} loading={list.loading} noun="hợp đồng" onChange={list.goTo} />
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

/** Dòng hợp đồng sẽ lấy từ báo giá (chỉ xem). */
const QUOTE_LINE_COLUMNS: ColumnsType<ContractLine> = [
  { title: '#', dataIndex: 'lineNo', width: 44, align: 'right' },
  {
    title: 'Mặt hàng',
    key: 'material',
    render: (_: unknown, row) => (
      <span>
        <span className={styles.mono}>{row.materialCode}</span> {row.materialName}
      </span>
    ),
  },
  { title: 'SL', key: 'quantity', width: 110, align: 'right', render: (_: unknown, row) => `${formatQuantity(row.quantity)} ${row.unit}` },
  { title: 'Đơn giá', dataIndex: 'unitPrice', width: 130, align: 'right', render: (value: number) => formatMoney(value) },
  { title: 'VAT', dataIndex: 'vatRate', width: 70, align: 'right', render: (value: number) => formatPercent(value) },
  { title: 'Thành tiền', dataIndex: 'lineAmount', width: 140, align: 'right', render: (value: number | null) => (value === null ? '' : formatMoney(value)) },
];

/**
 * Lập hợp đồng (phần đầu; dòng giá khung, đợt thanh toán thêm ở màn chi tiết) hoặc sửa phần đầu hợp đồng Nháp. Khi lập
 * mới có thể gắn một báo giá khách đã chấp nhận: dòng hàng lấy từ báo giá như khi chuyển báo giá (xem trước ngay trong
 * form), giá trị bỏ trống thì lấy tổng báo giá.
 */
export function ContractFormDialog({
  contract,
  draft,
  onClose,
  onSaved,
}: {
  contract?: ContractDetail;
  /** Giá trị điền sẵn khi lập mới (ví dụ từ kết quả trúng thầu). */
  draft?: Pick<SaveContractRequest, 'type' | 'customerId' | 'title' | 'value' | 'validFrom' | 'ownerUserId'>;
  onClose: () => void;
  onSaved: (detail: ContractDetail) => void;
}) {
  const { people } = useCrm();
  const [customers, setCustomers] = useState<readonly CustomerSummary[]>([]);
  const [type, setType] = useState<string>(contract?.type ?? draft?.type ?? 'SALE');
  const [customerId, setCustomerId] = useState(contract?.customerId ?? draft?.customerId ?? '');
  const [title, setTitle] = useState(contract?.title ?? draft?.title ?? '');
  const [signedDate, setSignedDate] = useState(contract?.signedDate ?? '');
  const [validFrom, setValidFrom] = useState(contract?.validFrom ?? draft?.validFrom ?? '');
  const [validTo, setValidTo] = useState(contract?.validTo ?? '');
  const [value, setValue] = useState(contract ? String(contract.value) : draft?.value != null ? String(draft.value) : '');
  const [warrantyMonths, setWarrantyMonths] = useState(contract?.warrantyMonths === null || !contract ? '' : String(contract.warrantyMonths));
  const [warehouseCode, setWarehouseCode] = useState(contract?.warehouseCode ?? '');
  const [ownerUserId, setOwnerUserId] = useState(contract?.ownerUserId ?? draft?.ownerUserId ?? '');
  const [note, setNote] = useState(contract?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  // Báo giá gắn khi lập mới (không bắt buộc); sửa hợp đồng không gắn được báo giá.
  const [quoteId, setQuoteId] = useState('');
  const [quotePreview, setQuotePreview] = useState<ContractQuotePreview>();
  const [quoteSearch, setQuoteSearch] = useState('');
  const [quoteResults, setQuoteResults] = useState<readonly QuoteSummary[]>([]);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const quoteQuery = useDebounced(quoteSearch.trim(), 300);
  /** Báo giá vừa chọn sau cùng: kết quả xem trước của lần chọn cũ về muộn thì bỏ. */
  const pickedQuote = useRef('');

  useEffect(() => {
    listCustomers({ limit: 100 })
      .then((page) => setCustomers(page.items))
      .catch(() => undefined);
  }, []);

  // Tìm ở máy chủ: chỉ báo giá gắn được (khách đã chấp nhận, chưa chuyển hay gắn hợp đồng), theo khách đang chọn.
  useEffect(() => {
    if (contract) return;
    let alive = true;
    setQuoteLoading(true);
    listQuotes({ contractLinkable: true, customerId: customerId || undefined, q: quoteQuery || undefined, limit: 20 })
      .then((page) => alive && setQuoteResults(page.items))
      .catch(() => alive && setQuoteResults([]))
      .finally(() => alive && setQuoteLoading(false));
    return () => {
      alive = false;
    };
  }, [contract, customerId, quoteQuery]);

  const customerOptions = useMemo(() => {
    const options = customers.map((item) => ({ value: item.id, label: item.name, badge: item.code }));
    if (contract && !options.some((option) => option.value === contract.customerId)) {
      options.unshift({ value: contract.customerId, label: contract.customerName, badge: contract.customerCode });
    }
    if (quotePreview && !options.some((option) => option.value === quotePreview.customerId)) {
      options.unshift({ value: quotePreview.customerId, label: quotePreview.customerName, badge: quotePreview.customerCode });
    }
    return options;
  }, [customers, contract, quotePreview]);

  const quoteOptions = useMemo(() => {
    const options = quoteResults.map((item) => ({
      value: item.id,
      label: item.quoteName || `Báo giá ${item.code}`,
      badge: item.code,
      description: `${item.customerName} - ${formatMoney(item.totalAmount)}`,
    }));
    if (quotePreview && !options.some((option) => option.value === quotePreview.quoteId)) {
      options.unshift({
        value: quotePreview.quoteId,
        label: quotePreview.quoteName || `Báo giá ${quotePreview.quoteCode}`,
        badge: quotePreview.quoteCode,
        description: `${quotePreview.customerName} - ${formatMoney(quotePreview.totalAmount)}`,
      });
    }
    return options;
  }, [quoteResults, quotePreview]);

  /** Chọn báo giá: đọc dòng sẽ gắn; chưa chọn khách thì lấy khách của báo giá, chưa có tên thì đặt tên theo báo giá. */
  async function chooseQuote(next: string) {
    pickedQuote.current = next;
    setQuoteId(next);
    // Bỏ chọn: bỏ gắn báo giá; hợp đồng lập không có dòng như trước.
    if (!next) return setQuotePreview(undefined);
    setError(undefined);
    try {
      const preview = await getContractQuotePreview(next);
      if (pickedQuote.current !== next) return;
      setQuotePreview(preview);
      if (!customerId) setCustomerId(preview.customerId);
      if (!title.trim()) setTitle(`Hợp đồng theo báo giá ${preview.quoteCode}`);
    } catch (cause) {
      if (pickedQuote.current !== next) return;
      pickedQuote.current = '';
      setQuoteId('');
      setQuotePreview(undefined);
      setError(errorMessage(cause, 'Không đọc được báo giá.'));
    }
  }

  function chooseCustomer(next: string) {
    setCustomerId(next);
    // Báo giá phải cùng khách với hợp đồng: đổi sang khách khác thì bỏ gắn báo giá.
    if (quoteId && quotePreview && next !== quotePreview.customerId) {
      pickedQuote.current = '';
      setQuoteId('');
      setQuotePreview(undefined);
    }
  }

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
      // Chỉ khi lập mới; dòng do máy chủ lấy từ phiên bản khách chấp nhận.
      ...(contract ? {} : { quoteId: quoteId || null }),
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
      subtitle={
        quotePreview ? 'Dòng hàng lấy từ báo giá đã chọn; đợt thanh toán nhập ở màn chi tiết' : 'Dòng giá khung và đợt thanh toán nhập ở màn chi tiết'
      }
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
          <SearchableSelect options={customerOptions} value={customerId} placeholder="Chọn khách hàng" onChange={chooseCustomer} />
        </Field>
        {contract ? null : (
          <Field label="Báo giá" wide hint="Không bắt buộc. Chọn báo giá khách đã chấp nhận để lấy dòng hàng của báo giá vào hợp đồng.">
            <SearchableSelect
              options={quoteOptions}
              value={quoteId}
              placeholder="Không gắn báo giá"
              searchPlaceholder="Tìm theo mã báo giá, tên khách…"
              emptyText={quoteLoading ? 'Đang tìm…' : customerId ? 'Khách này chưa có báo giá đã chấp nhận nào gắn được.' : 'Không có báo giá đã chấp nhận nào gắn được.'}
              clearable
              onSearchChange={setQuoteSearch}
              onChange={(next) => void chooseQuote(next)}
            />
          </Field>
        )}
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
        <Field
          label="Giá trị hợp đồng (VND)"
          hint={
            quotePreview
              ? `Bỏ trống: lấy tổng báo giá ${formatMoney(quotePreview.totalAmount)}`
              : 'Bỏ trống: cộng thành tiền gồm VAT của các dòng có số lượng'
          }
        >
          <input className={styles.input} inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} />
        </Field>
        <Field label="Bảo hành (tháng)">
          <input className={styles.input} inputMode="numeric" value={warrantyMonths} onChange={(event) => setWarrantyMonths(event.target.value.replace(/[^\d]/g, ''))} />
        </Field>
        <Field label="Kho giữ hàng mặc định" hint="Dòng không chọn kho riêng sẽ giữ hàng ở kho này khi xác nhận; chọn kho từng dòng ở bảng dòng hàng">
          <WarehouseSelect value={warehouseCode} onChange={(code) => setWarehouseCode(code ?? '')} placeholder="Chọn kho mặc định" />
        </Field>
        <Field label="Người phụ trách" hint="Bỏ trống: chính bạn">
          <SearchableSelect options={peopleOptions(people)} value={ownerUserId} placeholder="Chính bạn" clearable onChange={setOwnerUserId} />
        </Field>
        <Field label="Ghi chú" wide>
          <textarea className={styles.textarea} rows={3} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
      {quotePreview ? (
        <section aria-label="Dòng hàng từ báo giá">
          <h3 className={styles.sectionTitle}>Dòng hàng từ báo giá {quotePreview.quoteCode}</h3>
          <p className={styles.muted}>
            Hợp đồng nhận {quotePreview.lines.length} dòng của phiên bản {quotePreview.versionNo} khách đã chấp nhận (dòng trùng mặt hàng được gộp),
            tổng báo giá {formatMoney(quotePreview.totalAmount)}. Bỏ chọn báo giá để lập hợp đồng không gắn báo giá.
          </p>
          <Table<ContractLine>
            size="small"
            rowKey="id"
            columns={QUOTE_LINE_COLUMNS}
            dataSource={[...quotePreview.lines]}
            pagination={false}
            scroll={{ x: 640 }}
          />
        </section>
      ) : null}
    </CrmDialog>
  );
}
