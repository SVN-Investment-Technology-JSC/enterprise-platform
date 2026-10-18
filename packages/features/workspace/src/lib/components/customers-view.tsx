'use client';

import {
  CONTRACT_STATUSES,
  type Contract,
  type ContractStatus,
  type CreateContractRequest,
  type CreateCustomerRequest,
  type Customer,
  type CustomerSummary,
  type UpdateContractRequest,
  type UpdateCustomerRequest,
} from '@enterprise-platform/contracts-workspace';
import { Popconfirm, SearchableSelect } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatVnd, formatVndWhileTyping, parseVndInput, toVndInput } from '../money';
import * as api from '../workspace-api';
import { CONTRACT_STATUS_LABELS, CONTRACT_STATUS_TONE, formatDate } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Dialog, Field } from './dialog';

const messageOf = (cause: unknown, fallback: string): string =>
  (cause as { message?: string })?.message ?? fallback;

/** Huy hiệu trạng thái hợp đồng, cùng kiểu với các huy hiệu khác trong module. */
function ContractStatusBadge({ status }: { status: ContractStatus }) {
  const tone = CONTRACT_STATUS_TONE[status];
  return (
    <span className={styles.pill} style={{ background: tone.bg, color: tone.fg }}>
      {CONTRACT_STATUS_LABELS[status]}
    </span>
  );
}

export interface CustomersViewProps {
  /**
   * Bật chế độ "ngữ cảnh dự án": chỉ hiện đúng một khách hàng (của dự án đang
   * mở), không có danh sách trái và không có nút "Thêm khách hàng". Vắng prop
   * này là trang Khách hàng đầy đủ như cũ.
   */
  readonly scoped?: boolean;
  /** Khách hàng chủ quản của dự án đang mở; rỗng nghĩa là dự án chưa gắn khách hàng. */
  readonly scopeCustomerId?: string;
}

export function CustomersView({ scoped = false, scopeCustomerId }: CustomersViewProps = {}) {
  const [customers, setCustomers] = useState<readonly CustomerSummary[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<{
    customer: Customer;
    contracts: readonly Contract[];
  }>();
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string>();

  const [customerForm, setCustomerForm] = useState<{ open: boolean; edit?: Customer }>({
    open: false,
  });
  const [contractForm, setContractForm] = useState<{ open: boolean; edit?: Contract }>({
    open: false,
  });

  const reloadList = useCallback(async (query: string) => {
    try {
      const items = await api.listCustomers(query || undefined);
      setCustomers(items);
      setError(undefined);
    } catch (cause) {
      setError(messageOf(cause, 'Không tải được danh sách khách hàng.'));
    } finally {
      setListLoaded(true);
    }
  }, []);

  // Gõ vào ô tìm kiếm thì hỏi lại server, nhưng chờ một nhịp để không gọi mỗi phím.
  useEffect(() => {
    const timer = setTimeout(() => void reloadList(search), 250);
    return () => clearTimeout(timer);
  }, [search, reloadList]);

  const openCustomer = useCallback(async (id: string) => {
    setSelectedId(id);
    setLoadingDetail(true);
    try {
      const data = await api.getCustomer(id);
      setDetail({ customer: data.customer, contracts: data.contracts });
      setError(undefined);
    } catch (cause) {
      setDetail(undefined);
      setError(messageOf(cause, 'Không tải được khách hàng.'));
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const refreshDetail = useCallback(async () => {
    if (selectedId) await openCustomer(selectedId);
  }, [selectedId, openCustomer]);

  // Ngữ cảnh dự án: mở thẳng khách hàng của dự án đang xem, không qua danh sách.
  useEffect(() => {
    if (scoped && scopeCustomerId) void openCustomer(scopeCustomerId);
  }, [scoped, scopeCustomerId, openCustomer]);

  const selectedSummary = useMemo(
    () => customers.find((customer) => customer.id === selectedId),
    [customers, selectedId],
  );

  /* ----------------------------------------------------- Khách hàng (CRUD) */

  const handleCreateCustomer = useCallback(
    async (body: CreateCustomerRequest) => {
      const created = await api.createCustomer(body);
      await reloadList(search);
      await openCustomer(created.id);
    },
    [reloadList, search, openCustomer],
  );

  const handleUpdateCustomer = useCallback(
    async (id: string, body: UpdateCustomerRequest) => {
      await api.updateCustomer(id, body);
      await reloadList(search);
      await refreshDetail();
    },
    [reloadList, search, refreshDetail],
  );

  const handleDeleteCustomer = useCallback(
    async (id: string) => {
      try {
        await api.deleteCustomer(id);
        setDetail(undefined);
        setSelectedId(undefined);
        await reloadList(search);
        setError(undefined);
      } catch (cause) {
        // Server chặn khi khách hàng còn hợp đồng hoặc dự án: nói rõ cho người dùng.
        setError(messageOf(cause, 'Không xoá được khách hàng.'));
      }
    },
    [reloadList, search],
  );

  /* -------------------------------------------------------- Hợp đồng (CRUD) */

  const handleCreateContract = useCallback(
    async (body: CreateContractRequest) => {
      await api.createContract(body);
      await refreshDetail();
      await reloadList(search);
    },
    [refreshDetail, reloadList, search],
  );

  const handleUpdateContract = useCallback(
    async (id: string, body: UpdateContractRequest) => {
      await api.updateContract(id, body);
      await refreshDetail();
    },
    [refreshDetail],
  );

  const handleDeleteContract = useCallback(
    async (id: string) => {
      try {
        await api.deleteContract(id);
        await refreshDetail();
        await reloadList(search);
        setError(undefined);
      } catch (cause) {
        setError(messageOf(cause, 'Không xoá được hợp đồng.'));
      }
    },
    [refreshDetail, reloadList, search],
  );

  /* ------------------------------------------------------------- Render */

  return (
    <div className={scoped ? styles.scopePane : styles.taskSplit}>
      {scoped ? null : (
      <section className={styles.taskListPane} aria-label="Danh sách khách hàng">
        <div className={styles.taskListHead}>
          <button
            type="button"
            className={styles.buttonPrimary}
            onClick={() => setCustomerForm({ open: true })}
          >
            <Plus size={15} /> Thêm khách hàng
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Tải lại"
            title="Tải lại"
            onClick={() => void reloadList(search)}
          >
            <RefreshCw size={15} />
          </button>
        </div>

        <div className={styles.taskListFilters} style={{ gridTemplateColumns: '1fr' }}>
          <label className={styles.taskSearch}>
            <Search size={14} aria-hidden />
            <input
              value={search}
              placeholder="Tìm theo mã hoặc tên"
              aria-label="Tìm khách hàng"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>

        {error && !detail ? (
          <p role="alert" className={styles.alert}>
            {error}
          </p>
        ) : null}

        <ul className={styles.taskList}>
          {customers.map((customer) => {
            const active = customer.id === selectedId;
            return (
              <li key={customer.id}>
                <button
                  type="button"
                  className={active ? styles.taskRowActive : styles.taskRow}
                  onClick={() => void openCustomer(customer.id)}
                >
                  <span className={styles.taskRowTitle}>
                    <span className={styles.treeCode}>{customer.code}</span>
                    {customer.name}
                  </span>
                  <span className={styles.taskRowMeta}>
                    <span className={styles.muted}>{customer.contractCount} hợp đồng</span>
                    <span className={styles.muted}>·</span>
                    <span className={styles.muted}>{customer.projectCount} dự án</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {listLoaded && customers.length === 0 ? (
          <p className={styles.emptyRow}>
            {search ? 'Không có khách hàng nào khớp.' : 'Chưa có khách hàng nào.'}
          </p>
        ) : null}
        {!listLoaded ? <p className={styles.emptyRow}>Đang tải…</p> : null}
      </section>
      )}

      <section className={styles.taskDetailPane} aria-label="Chi tiết khách hàng">
        {!selectedId ? (
          <div className={styles.emptyState}>
            <p>
              {scoped
                ? 'Dự án này chưa gắn khách hàng.'
                : 'Chọn một khách hàng để xem chi tiết và hợp đồng.'}
            </p>
          </div>
        ) : loadingDetail && !detail ? (
          <p className={styles.muted}>Đang tải khách hàng…</p>
        ) : detail ? (
          <div className={styles.taskDetail}>
            {error ? (
              <p role="alert" className={styles.alert}>
                {error}
              </p>
            ) : null}

            <header className={styles.panelHeadRow}>
              <div>
                <h2 className={styles.detailHeading}>Khách hàng</h2>
                <div className={styles.taskRowTitle}>
                  <span className={styles.treeCode}>{detail.customer.code}</span>
                  {detail.customer.name}
                </div>
                <p className={styles.muted}>
                  {selectedSummary?.contractCount ?? detail.contracts.length} hợp đồng ·{' '}
                  {selectedSummary?.projectCount ?? 0} dự án
                </p>
              </div>
              <div className={styles.rowActions}>
                <button
                  type="button"
                  className={styles.buttonGhost}
                  onClick={() => setCustomerForm({ open: true, edit: detail.customer })}
                >
                  <Pencil size={15} /> Sửa
                </button>
                <Popconfirm
                  title="Xoá khách hàng?"
                  description="Chỉ xoá được khi khách hàng chưa có hợp đồng và dự án nào."
                  okText="Xoá"
                  okType="danger"
                  placement="bottom-end"
                  onConfirm={() => handleDeleteCustomer(detail.customer.id)}
                >
                  <button type="button" className={styles.buttonDanger}>
                    <Trash2 size={15} /> Xoá
                  </button>
                </Popconfirm>
              </div>
            </header>

            {detail.customer.note ? (
              <p className={styles.description}>{detail.customer.note}</p>
            ) : null}

            <div className={styles.panelHeadRow}>
              <h3 className={styles.subHeading}>Hợp đồng</h3>
              <button
                type="button"
                className={styles.buttonSmall}
                onClick={() => setContractForm({ open: true })}
              >
                <Plus size={14} /> Thêm hợp đồng
              </button>
            </div>

            {detail.contracts.length === 0 ? (
              <p className={styles.emptyRow}>Khách hàng này chưa có hợp đồng nào.</p>
            ) : (
              <div className={styles.tableCard}>
                <div className={styles.tableScroll}>
                  <table className={`${styles.table} ${styles.contractTable}`}>
                    <thead>
                      <tr>
                        <th>Mã</th>
                        <th>Tên hợp đồng</th>
                        <th>Trạng thái</th>
                        <th className={styles.numeric}>Giá trị</th>
                        <th>Ngày ký</th>
                        <th aria-label="Thao tác" />
                      </tr>
                    </thead>
                    <tbody>
                      {detail.contracts.map((contract) => (
                        <tr key={contract.id}>
                          <td className={styles.cellNowrap}>{contract.code}</td>
                          <td className={styles.contractName}>{contract.name}</td>
                          <td>
                            <ContractStatusBadge status={contract.status} />
                          </td>
                          <td className={styles.numeric}>{formatVnd(contract.value)}</td>
                          <td className={styles.cellNowrap}>
                            {contract.signedDate ? formatDate(contract.signedDate) : '—'}
                          </td>
                          <td>
                            <div className={styles.rowActions}>
                              <button
                                type="button"
                                className={styles.iconButton}
                                aria-label="Sửa hợp đồng"
                                title="Sửa"
                                onClick={() => setContractForm({ open: true, edit: contract })}
                              >
                                <Pencil size={15} />
                              </button>
                              <Popconfirm
                                title="Xoá hợp đồng?"
                                description="Hợp đồng bị xoá hẳn, không hoàn tác được."
                                okText="Xoá"
                                okType="danger"
                                placement="bottom-end"
                                onConfirm={() => handleDeleteContract(contract.id)}
                              >
                                <button
                                  type="button"
                                  className={styles.iconButton}
                                  aria-label="Xoá hợp đồng"
                                  title="Xoá"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </Popconfirm>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <p>{error ?? 'Không tải được khách hàng.'}</p>
          </div>
        )}
      </section>

      <CustomerFormDialog
        open={customerForm.open}
        customer={customerForm.edit}
        onClose={() => setCustomerForm({ open: false })}
        onCreate={handleCreateCustomer}
        onUpdate={(body) =>
          customerForm.edit
            ? handleUpdateCustomer(customerForm.edit.id, body)
            : Promise.resolve()
        }
      />

      <ContractFormDialog
        open={contractForm.open}
        contract={contractForm.edit}
        customerId={detail?.customer.id ?? ''}
        onClose={() => setContractForm({ open: false })}
        onCreate={handleCreateContract}
        onUpdate={(body) =>
          contractForm.edit
            ? handleUpdateContract(contractForm.edit.id, body)
            : Promise.resolve()
        }
      />
    </div>
  );
}

/* ========================================================================= */

interface CustomerFormDialogProps {
  readonly open: boolean;
  /** Rỗng nghĩa là tạo mới; có nghĩa là sửa khách hàng đó. */
  readonly customer?: Customer;
  readonly onClose: () => void;
  readonly onCreate: (body: CreateCustomerRequest) => Promise<void>;
  readonly onUpdate: (body: UpdateCustomerRequest) => Promise<void>;
}

function CustomerFormDialog({
  open,
  customer,
  onClose,
  onCreate,
  onUpdate,
}: CustomerFormDialogProps) {
  const [form, setForm] = useState({ code: '', name: '', note: '' });
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(
      customer
        ? { code: customer.code, name: customer.name, note: customer.note ?? '' }
        : { code: '', name: '', note: '' },
    );
    setError(undefined);
    setSubmitting(false);
  }, [open, customer]);

  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));

  const submit = async () => {
    setError(undefined);
    setSubmitting(true);
    try {
      if (customer) {
        await onUpdate({ name: form.name, note: form.note.trim() || null });
      } else {
        await onCreate({
          code: form.code.trim(),
          name: form.name,
          note: form.note.trim() || undefined,
        });
      }
      onClose();
    } catch (cause) {
      setError(messageOf(cause, 'Không lưu được khách hàng.'));
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={customer ? 'Sửa khách hàng' : 'Khách hàng mới'}
      subtitle={customer ? `Mã khách hàng ${customer.code} không thay đổi được.` : undefined}
      submitLabel={customer ? 'Lưu thay đổi' : 'Tạo khách hàng'}
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      {customer ? null : (
        <Field label="Mã khách hàng" required hint="Chữ in hoa, số và dấu gạch ngang. Ví dụ: KH-001.">
          <input
            value={form.code}
            required
            maxLength={32}
            onChange={(event) => set({ code: event.target.value.toUpperCase() })}
          />
        </Field>
      )}

      <Field label="Tên khách hàng" required>
        <input
          value={form.name}
          required
          maxLength={180}
          onChange={(event) => set({ name: event.target.value })}
        />
      </Field>

      <Field label="Ghi chú">
        <textarea
          rows={3}
          value={form.note}
          onChange={(event) => set({ note: event.target.value })}
        />
      </Field>
    </Dialog>
  );
}

/* ========================================================================= */

interface ContractFormDialogProps {
  readonly open: boolean;
  /** Rỗng nghĩa là tạo mới; có nghĩa là sửa hợp đồng đó. */
  readonly contract?: Contract;
  /** Khách hàng chủ quản khi tạo hợp đồng mới. */
  readonly customerId: string;
  readonly onClose: () => void;
  readonly onCreate: (body: CreateContractRequest) => Promise<void>;
  readonly onUpdate: (body: UpdateContractRequest) => Promise<void>;
}

interface ContractFormState {
  code: string;
  name: string;
  status: ContractStatus;
  /** Chuỗi người dùng gõ, có dấu chấm ngăn nghìn; đọc bằng `parseVndInput`. */
  value: string;
  signedDate: string;
  note: string;
}

const emptyContractForm = (): ContractFormState => ({
  code: '',
  name: '',
  status: 'draft',
  value: '',
  signedDate: '',
  note: '',
});

function ContractFormDialog({
  open,
  contract,
  customerId,
  onClose,
  onCreate,
  onUpdate,
}: ContractFormDialogProps) {
  const [form, setForm] = useState<ContractFormState>(emptyContractForm());
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(
      contract
        ? {
            code: contract.code,
            name: contract.name,
            status: contract.status,
            value: toVndInput(contract.value),
            signedDate: contract.signedDate?.slice(0, 10) ?? '',
            note: contract.note ?? '',
          }
        : emptyContractForm(),
    );
    setError(undefined);
    setSubmitting(false);
  }, [open, contract]);

  const set = (patch: Partial<ContractFormState>) =>
    setForm((current) => ({ ...current, ...patch }));

  const submit = async () => {
    setError(undefined);

    // Chuỗi rỗng là "không đặt"; chuỗi không đọc được phải báo lỗi chứ không lưu sai.
    const parsed = parseVndInput(form.value);
    if (parsed === undefined) {
      setError('Giá trị hợp đồng: không đọc được số.');
      return;
    }
    if ((parsed ?? 0) < 0) {
      setError('Giá trị hợp đồng không được là số âm.');
      return;
    }

    setSubmitting(true);
    try {
      if (contract) {
        await onUpdate({
          name: form.name,
          status: form.status,
          // `null` xoá giá trị đã đặt; số đọc được thì ghi đè.
          value: parsed,
          signedDate: form.signedDate || null,
          note: form.note.trim() || null,
        });
      } else {
        await onCreate({
          customerId,
          code: form.code.trim(),
          name: form.name,
          status: form.status,
          value: parsed ?? undefined,
          signedDate: form.signedDate || undefined,
          note: form.note.trim() || undefined,
        });
      }
      onClose();
    } catch (cause) {
      setError(messageOf(cause, 'Không lưu được hợp đồng.'));
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={contract ? 'Sửa hợp đồng' : 'Hợp đồng mới'}
      subtitle={
        contract ? `Mã hợp đồng ${contract.code} không thay đổi được.` : undefined
      }
      submitLabel={contract ? 'Lưu thay đổi' : 'Tạo hợp đồng'}
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      {contract ? null : (
        <Field label="Mã hợp đồng" required hint="Chữ in hoa, số và dấu gạch ngang. Ví dụ: HD-2026-001.">
          <input
            value={form.code}
            required
            maxLength={32}
            onChange={(event) => set({ code: event.target.value.toUpperCase() })}
          />
        </Field>
      )}

      <Field label="Tên hợp đồng" required>
        <input
          value={form.name}
          required
          maxLength={180}
          onChange={(event) => set({ name: event.target.value })}
        />
      </Field>

      <div className={styles.fieldRow}>
        <Field label="Trạng thái">
          <SearchableSelect
            options={CONTRACT_STATUSES.map((status) => ({
              value: status,
              label: CONTRACT_STATUS_LABELS[status],
            }))}
            value={form.status}
            onChange={(value) => set({ status: value as ContractStatus })}
          />
        </Field>
        <Field label="Giá trị (VND)" hint="Bỏ trống nếu chưa có.">
          <input
            inputMode="decimal"
            value={form.value}
            placeholder="Ví dụ 2.500.000.000"
            onChange={(event) => set({ value: formatVndWhileTyping(event.target.value) })}
          />
        </Field>
      </div>

      <Field label="Ngày ký">
        <DatePickerInput
          height={38}
          value={form.signedDate}
          onChange={(value) => set({ signedDate: value })}
        />
      </Field>

      <Field label="Ghi chú">
        <textarea
          rows={3}
          value={form.note}
          onChange={(event) => set({ note: event.target.value })}
        />
      </Field>
    </Dialog>
  );
}
