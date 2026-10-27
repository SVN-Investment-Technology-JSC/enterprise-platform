'use client';

import {
  CUSTOMER_KIND_LABELS,
  OPPORTUNITY_STAGE_LABELS,
  type CustomerContact,
  type CustomerDetail as CustomerDetailData,
  type OpportunityStage,
  type OpportunitySummary,
} from '@enterprise-platform/contracts-crm';
import { Popconfirm, formatDate, toast } from '@enterprise-platform/shared-ui';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ArrowLeft, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityPanel } from '../activities/activity-panel';
import { CrmDialog, Field, KeysetPager, StatusPill } from '../components/crm-ui';
import { useKeysetPage } from '../components/use-keyset-page';
import {
  addContact,
  deleteContact,
  errorMessage,
  getCustomer,
  listOpportunities,
  setPrimaryContact,
  updateContact,
} from '../crm-api';
import { useCanWrite, useCrm } from '../crm-context';
import { formatMoney, personName } from '../sales.model';
import styles from '../sales.module.scss';
import { OpportunityFormDialog } from '../opportunities/opportunity-dialogs';
import { CustomerFormDialog } from './customer-form';
import { KIND_TONE } from './customer-list';
import { CustomerTimeline } from './customer-timeline';

type Tab = 'info' | 'contacts' | 'opportunities' | 'activities' | 'timeline';

const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'info', label: 'Thông tin' },
  { id: 'contacts', label: 'Người liên hệ' },
  { id: 'opportunities', label: 'Cơ hội' },
  { id: 'activities', label: 'Hoạt động' },
  { id: 'timeline', label: 'Dòng thời gian' },
];

/** Hồ sơ khách hàng: thông tin, người liên hệ, cơ hội, hoạt động, dòng thời gian. */
export function CustomerDetail({
  customerId,
  onBack,
  onOpenOpportunity,
  onOpenQuote,
  onOpenContract,
  onOpenOrder,
}: {
  customerId: string;
  onBack: () => void;
  onOpenOpportunity: (id: string) => void;
  onOpenQuote?: (id: string) => void;
  onOpenContract?: (id: string) => void;
  onOpenOrder?: (id: string) => void;
}) {
  const { people } = useCrm();
  const canWrite = useCanWrite();
  const [customer, setCustomer] = useState<CustomerDetailData>();
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<Tab>('info');
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    getCustomer(customerId)
      .then((next) => {
        setCustomer(next);
        setError(undefined);
      })
      .catch((cause) => setError(errorMessage(cause, 'Không tải được khách hàng.')));
  }, [customerId]);

  useEffect(() => load(), [load]);

  if (error) {
    return (
      <div className={styles.page}>
        <button type="button" className={styles.buttonGhost} onClick={onBack}>
          <ArrowLeft size={14} /> Danh sách khách hàng
        </button>
        <p className={styles.alert}>{error}</p>
      </div>
    );
  }
  if (!customer) return <p className={styles.muted}>Đang tải…</p>;

  return (
    <div className={styles.page}>
      <header className={styles.detailHead}>
        <button type="button" className={styles.iconButton} aria-label="Danh sách khách hàng" onClick={onBack}>
          <ArrowLeft size={16} />
        </button>
        <div className={styles.detailTitle}>
          <span className={styles.mono}>{customer.code}</span>
          <h2>{customer.name}</h2>
          <StatusPill tone={KIND_TONE[customer.kind]}>{CUSTOMER_KIND_LABELS[customer.kind]}</StatusPill>
        </div>
        {canWrite ? (
          <button type="button" className={styles.buttonGhost} onClick={() => setEditing(true)}>
            Sửa
          </button>
        ) : null}
      </header>
      <nav className={styles.tabs} role="tablist" aria-label="Hồ sơ khách hàng">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? styles.tabActive : styles.tab}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.id === 'contacts' ? ` (${customer.contacts.length})` : ''}
          </button>
        ))}
      </nav>
      {tab === 'info' ? (
        <section className={styles.panel}>
          <dl className={styles.facts}>
            <dt>Mã số thuế</dt>
            <dd className={styles.mono}>{customer.taxCode ?? ''}</dd>
            <dt>Nhóm</dt>
            <dd>{customer.groupName ?? ''}</dd>
            <dt>Người phụ trách</dt>
            <dd>{personName(people, customer.ownerUserId)}</dd>
            <dt>Địa chỉ</dt>
            <dd>{customer.address ?? ''}</dd>
            <dt>Tỉnh/thành, khu vực</dt>
            <dd>{[customer.province, customer.region].filter(Boolean).join(' · ')}</dd>
            <dt>Ngành</dt>
            <dd>{customer.industry ?? ''}</dd>
            <dt>Điện thoại, email</dt>
            <dd>{[customer.phone, customer.email].filter(Boolean).join(' · ')}</dd>
            <dt>Hạn mức tín dụng</dt>
            <dd>{formatMoney(customer.creditLimit)}</dd>
            <dt>Thời hạn thanh toán</dt>
            <dd>{customer.paymentTermDays === null ? '' : `${customer.paymentTermDays} ngày`}</dd>
            <dt>Ghi chú</dt>
            <dd>{customer.note ?? ''}</dd>
            <dt>Ngày tạo</dt>
            <dd>{formatDate(customer.createdAt)}</dd>
          </dl>
        </section>
      ) : null}
      {tab === 'contacts' ? <ContactsTab customer={customer} onChanged={setCustomer} /> : null}
      {tab === 'opportunities' ? <CustomerOpportunities customer={customer} onOpen={onOpenOpportunity} /> : null}
      {tab === 'activities' ? <ActivityPanel scope={{ customerId: customer.id }} /> : null}
      {tab === 'timeline' ? <CustomerTimeline
          customerId={customer.id}
          onOpenOpportunity={onOpenOpportunity}
          onOpenQuote={onOpenQuote}
          onOpenContract={onOpenContract}
          onOpenOrder={onOpenOrder}
        /> : null}
      {editing ? (
        <CustomerFormDialog
          customer={customer}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setCustomer(saved);
            setEditing(false);
          }}
        />
      ) : null}
    </div>
  );
}

function ContactsTab({ customer, onChanged }: { customer: CustomerDetailData; onChanged: (customer: CustomerDetailData) => void }) {
  const canWrite = useCanWrite();
  const [editing, setEditing] = useState<CustomerContact | 'new' | null>(null);

  const run = useCallback(
    async (operation: () => Promise<CustomerDetailData>, success: string) => {
      try {
        onChanged(await operation());
        toast.success(success);
      } catch (cause) {
        toast.error(errorMessage(cause, 'Không lưu được người liên hệ.'));
      }
    },
    [onChanged],
  );

  const columns = useMemo<ColumnsType<CustomerContact>>(
    () => [
      {
        title: 'Họ tên',
        dataIndex: 'fullName',
        render: (value: string, row) => (
          <span className={styles.cellWithPill}>
            {value}
            {row.isPrimary ? <StatusPill tone="success">Liên hệ chính</StatusPill> : null}
          </span>
        ),
      },
      { title: 'Chức vụ', dataIndex: 'title', width: 160 },
      { title: 'Điện thoại', dataIndex: 'phone', width: 140 },
      { title: 'Email', dataIndex: 'email', width: 200, ellipsis: true },
      {
        title: '',
        key: 'actions',
        width: 230,
        render: (_: unknown, row) =>
          canWrite ? (
            <span className={styles.rowActions}>
              {!row.isPrimary ? (
                <button type="button" className={styles.rowAction} onClick={() => void run(() => setPrimaryContact(customer.id, row.id), 'Đã đổi người liên hệ chính.')}>
                  Đặt làm chính
                </button>
              ) : null}
              <button type="button" className={styles.rowAction} onClick={() => setEditing(row)}>
                Sửa
              </button>
              <Popconfirm
                title="Xoá người liên hệ này?"
                description={row.isPrimary ? 'Người liên hệ cũ nhất còn lại sẽ thành người liên hệ chính.' : undefined}
                okText="Xoá"
                cancelText="Huỷ"
                okType="danger"
                onConfirm={() => run(() => deleteContact(customer.id, row.id), 'Đã xoá người liên hệ.')}
              >
                <button type="button" className={styles.rowActionDanger}>
                  Xoá
                </button>
              </Popconfirm>
            </span>
          ) : null,
      },
    ],
    [canWrite, customer.id, run],
  );

  return (
    <section className={styles.tableCard}>
      {canWrite ? (
        <div className={styles.toolbar}>
          <button type="button" className={styles.buttonPrimary} onClick={() => setEditing('new')}>
            <Plus size={14} /> Thêm người liên hệ
          </button>
        </div>
      ) : null}
      <Table<CustomerContact>
        size="small"
        rowKey="id"
        columns={columns}
        dataSource={[...customer.contacts]}
        pagination={false}
        scroll={{ x: 900 }}
        locale={{ emptyText: 'Chưa có người liên hệ.' }}
      />
      {editing ? (
        <ContactDialog
          contact={editing === 'new' ? undefined : editing}
          first={customer.contacts.length === 0}
          onClose={() => setEditing(null)}
          onSubmit={async (body) => {
            const saved = editing === 'new' ? await addContact(customer.id, body) : await updateContact(customer.id, editing.id, body);
            onChanged(saved);
            setEditing(null);
            toast.success('Đã lưu người liên hệ.');
          }}
        />
      ) : null}
    </section>
  );
}

function ContactDialog({
  contact,
  first,
  onClose,
  onSubmit,
}: {
  contact?: CustomerContact;
  first: boolean;
  onClose: () => void;
  onSubmit: (body: { fullName: string; title: string | null; phone: string | null; email: string | null; note: string | null; isPrimary: boolean }) => Promise<void>;
}) {
  const [fullName, setFullName] = useState(contact?.fullName ?? '');
  const [title, setTitle] = useState(contact?.title ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [email, setEmail] = useState(contact?.email ?? '');
  const [note, setNote] = useState(contact?.note ?? '');
  const [isPrimary, setIsPrimary] = useState(contact?.isPrimary ?? first);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  async function submit() {
    if (!fullName.trim()) return setError('Vui lòng nhập họ tên người liên hệ.');
    setSubmitting(true);
    setError(undefined);
    try {
      await onSubmit({
        fullName: fullName.trim(),
        title: title.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        note: note.trim() || null,
        isPrimary,
      });
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được người liên hệ.'));
      setSubmitting(false);
    }
  }
  return (
    <CrmDialog open title={contact ? 'Sửa người liên hệ' : 'Thêm người liên hệ'} submitting={submitting} error={error} onClose={onClose} onSubmit={() => void submit()}>
      <div className={styles.fieldGrid}>
        <Field label="Họ tên" required>
          <input className={styles.input} value={fullName} maxLength={200} autoFocus onChange={(event) => setFullName(event.target.value)} />
        </Field>
        <Field label="Chức vụ">
          <input className={styles.input} value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label="Điện thoại">
          <input className={styles.input} value={phone} maxLength={50} onChange={(event) => setPhone(event.target.value)} />
        </Field>
        <Field label="Email">
          <input className={styles.input} type="email" value={email} maxLength={200} onChange={(event) => setEmail(event.target.value)} />
        </Field>
        <Field label="Ghi chú" wide>
          <textarea className={styles.textarea} rows={2} value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
      <label className={styles.checkbox}>
        <input type="checkbox" checked={isPrimary} disabled={contact?.isPrimary || first} onChange={(event) => setIsPrimary(event.target.checked)} />
        Người liên hệ chính
        {first ? <span className={styles.fieldHint}> (người liên hệ đầu tiên luôn là người chính)</span> : null}
      </label>
    </CrmDialog>
  );
}

function CustomerOpportunities({ customer, onOpen }: { customer: CustomerDetailData; onOpen: (id: string) => void }) {
  const { people } = useCrm();
  const canWrite = useCanWrite();
  const [creating, setCreating] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const list = useKeysetPage(`${customer.id}:${refresh}`, (cursor) => listOpportunities({ customerId: customer.id, cursor, limit: 20 }));
  const columns = useMemo<ColumnsType<OpportunitySummary>>(
    () => [
      { title: 'Cơ hội', dataIndex: 'name', ellipsis: true },
      {
        title: 'Giai đoạn',
        dataIndex: 'stage',
        width: 150,
        render: (value: OpportunityStage) => (
          <StatusPill tone={value === 'WON' ? 'success' : value === 'LOST' ? 'danger' : 'info'}>{OPPORTUNITY_STAGE_LABELS[value]}</StatusPill>
        ),
      },
      { title: 'Giá trị dự kiến', dataIndex: 'expectedValue', width: 150, align: 'right', render: (value: number | null) => formatMoney(value) },
      { title: 'Người phụ trách', dataIndex: 'ownerUserId', width: 160, render: (value: string) => personName(people, value) },
      {
        title: '',
        key: 'actions',
        width: 70,
        render: (_: unknown, row) => (
          <button type="button" className={styles.rowAction} onClick={() => onOpen(row.id)}>
            Xem
          </button>
        ),
      },
    ],
    [people, onOpen],
  );
  return (
    <section className={styles.tableCard}>
      {canWrite ? (
        <div className={styles.toolbar}>
          <button type="button" className={styles.buttonPrimary} onClick={() => setCreating(true)}>
            <Plus size={14} /> Thêm cơ hội
          </button>
        </div>
      ) : null}
      {list.error ? <p className={styles.alert}>{list.error}</p> : null}
      <Table<OpportunitySummary>
        size="small"
        rowKey="id"
        loading={list.loading}
        columns={columns}
        dataSource={[...list.items]}
        pagination={false}
        locale={{ emptyText: list.loading ? 'Đang tải…' : 'Chưa có cơ hội nào.' }}
      />
      <KeysetPager page={list.page} count={list.items.length} hasNext={list.hasNext} loading={list.loading} noun="cơ hội" onPrevious={list.previous} onNext={list.next} />
      {creating ? (
        <OpportunityFormDialog
          customer={customer}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            setRefresh((value) => value + 1);
          }}
        />
      ) : null}
    </section>
  );
}
