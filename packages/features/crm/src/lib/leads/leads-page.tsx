'use client';

import { LEAD_STATUS_LABELS, type Lead, type LeadStatus } from '@enterprise-platform/contracts-crm';
import { SearchableSelect, formatDate, toast } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CrmDialog, Field, KeysetPager, StatusPill } from '../components/crm-ui';
import { useDebounced } from '../components/use-debounced';
import { useKeysetPage } from '../components/use-keyset-page';
import { convertLead, createLead, errorMessage, listLeads, updateLead } from '../crm-api';
import { labelOptions, peopleOptions, useCanWrite, useCrm } from '../crm-context';
import { personName, taxCodeLooksValid } from '../sales.model';
import styles from '../sales.module.scss';

const STATUS_TONE: Record<LeadStatus, 'info' | 'warning' | 'neutral' | 'success'> = {
  NEW: 'info',
  WORKING: 'warning',
  DISQUALIFIED: 'neutral',
  CONVERTED: 'success',
};
const EDITABLE_STATUS_LABELS = {
  NEW: LEAD_STATUS_LABELS.NEW,
  WORKING: LEAD_STATUS_LABELS.WORKING,
  DISQUALIFIED: LEAD_STATUS_LABELS.DISQUALIFIED,
};

/**
 * Lead: danh sách, thêm, sửa và "Chuyển thành khách hàng và cơ hội" (một thao
 * tác, một transaction ở server; MST trùng khách có sẵn thì gắn vào khách đó).
 */
export function LeadsPage({ onOpenCustomer, onOpenOpportunity }: { onOpenCustomer: (id: string) => void; onOpenOpportunity: (id: string) => void }) {
  const { people } = useCrm();
  const canWrite = useCanWrite();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [editing, setEditing] = useState<Lead | 'new' | null>(null);
  const [converting, setConverting] = useState<Lead | null>(null);
  const q = useDebounced(search.trim(), 350);
  const list = useKeysetPage(JSON.stringify({ q, status, ownerUserId }), (cursor) =>
    listLeads({ q, status: (status || undefined) as LeadStatus | undefined, ownerUserId, cursor, limit: 30 }),
  );

  const columns = useMemo<ColumnsType<Lead>>(
    () => [
      { title: 'Tên lead', dataIndex: 'name', ellipsis: true },
      { title: 'Người liên hệ', dataIndex: 'contactName', width: 160, ellipsis: true },
      { title: 'Điện thoại', dataIndex: 'phone', width: 130 },
      { title: 'MST', dataIndex: 'taxCode', width: 140, render: (value: string | null) => <span className={styles.mono}>{value ?? ''}</span> },
      { title: 'Nguồn', dataIndex: 'source', width: 130, ellipsis: true },
      { title: 'Trạng thái', dataIndex: 'status', width: 150, render: (value: LeadStatus) => <StatusPill tone={STATUS_TONE[value]}>{LEAD_STATUS_LABELS[value]}</StatusPill> },
      { title: 'Người phụ trách', dataIndex: 'ownerUserId', width: 160, ellipsis: true, render: (value: string) => personName(people, value) },
      { title: 'Ngày tạo', dataIndex: 'createdAt', width: 110, render: (value: string) => formatDate(value) },
      {
        title: '',
        key: 'actions',
        width: 270,
        render: (_: unknown, row) =>
          row.status === 'CONVERTED' ? (
            <span className={styles.rowActions}>
              {row.convertedCustomerId ? (
                <button type="button" className={styles.rowAction} onClick={() => onOpenCustomer(row.convertedCustomerId as string)}>
                  Khách hàng
                </button>
              ) : null}
              {row.convertedOpportunityId ? (
                <button type="button" className={styles.rowAction} onClick={() => onOpenOpportunity(row.convertedOpportunityId as string)}>
                  Cơ hội
                </button>
              ) : null}
            </span>
          ) : canWrite ? (
            <span className={styles.rowActions}>
              {row.status !== 'DISQUALIFIED' ? (
                <button type="button" className={styles.rowActionPrimary} onClick={() => setConverting(row)}>
                  Chuyển thành khách hàng và cơ hội
                </button>
              ) : null}
              <button type="button" className={styles.rowAction} onClick={() => setEditing(row)}>
                Sửa
              </button>
            </span>
          ) : null,
      },
    ],
    [people, canWrite, onOpenCustomer, onOpenOpportunity],
  );

  return (
    <section className={styles.tableCard} aria-label="Lead">
      <div className={styles.toolbar}>
        {canWrite ? (
          <button type="button" className={styles.buttonPrimary} onClick={() => setEditing('new')}>
            <Plus size={14} /> Thêm lead
          </button>
        ) : null}
        <input className={`${styles.input} ${styles.search}`} type="search" placeholder="Tìm theo tên, mã số thuế…" maxLength={100} value={search} onChange={(event) => setSearch(event.target.value)} />
        <SearchableSelect className={styles.filter} options={labelOptions(LEAD_STATUS_LABELS)} value={status} placeholder="Mọi trạng thái" clearable onChange={setStatus} />
        <SearchableSelect className={styles.filter} options={peopleOptions(people)} value={ownerUserId} placeholder="Mọi người phụ trách" clearable onChange={setOwnerUserId} />
      </div>
      {list.error ? <p className={styles.alert}>{list.error}</p> : null}
      <Table<Lead>
        size="small"
        rowKey="id"
        loading={list.loading}
        columns={columns}
        dataSource={[...list.items]}
        pagination={false}
        scroll={{ x: 1400 }}
        locale={{ emptyText: list.loading ? 'Đang tải…' : 'Chưa có lead nào.' }}
      />
      <KeysetPager page={list.page} count={list.items.length} hasNext={list.hasNext} loading={list.loading} noun="lead" onPrevious={list.previous} onNext={list.next} />
      {editing ? (
        <LeadFormDialog
          lead={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
          }}
        />
      ) : null}
      {converting ? (
        <ConvertLeadDialog
          lead={converting}
          onClose={() => setConverting(null)}
          onConverted={(opportunityId) => {
            setConverting(null);
            list.reload();
            onOpenOpportunity(opportunityId);
          }}
        />
      ) : null}
    </section>
  );
}

function LeadFormDialog({ lead, onClose, onSaved }: { lead?: Lead; onClose: () => void; onSaved: () => void }) {
  const { people } = useCrm();
  const [form, setForm] = useState({
    name: lead?.name ?? '',
    contactName: lead?.contactName ?? '',
    taxCode: lead?.taxCode ?? '',
    phone: lead?.phone ?? '',
    email: lead?.email ?? '',
    source: lead?.source ?? '',
    need: lead?.need ?? '',
    note: lead?.note ?? '',
    ownerUserId: lead?.ownerUserId ?? '',
    status: (lead?.status ?? 'NEW') as Exclude<LeadStatus, 'CONVERTED'>,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const taxCodeError = taxCodeLooksValid(form.taxCode) ? undefined : 'Mã số thuế gồm 10 số hoặc 10 số-3 số.';

  async function submit() {
    if (!form.name.trim()) return setError('Vui lòng nhập tên lead.');
    if (taxCodeError) return setError(taxCodeError);
    setSubmitting(true);
    setError(undefined);
    const nullable = (value: string) => value.trim() || null;
    const fields = {
      name: form.name.trim(),
      contactName: nullable(form.contactName),
      taxCode: nullable(form.taxCode),
      phone: nullable(form.phone),
      email: nullable(form.email),
      source: nullable(form.source),
      need: nullable(form.need),
      note: nullable(form.note),
      ownerUserId: form.ownerUserId || null,
    };
    try {
      if (lead) await updateLead(lead.id, { ...fields, status: form.status, version: lead.version });
      else await createLead(fields);
      toast.success('Đã lưu lead.');
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được lead.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <CrmDialog open wide title={lead ? 'Sửa lead' : 'Thêm lead'} submitting={submitting} error={error} onClose={onClose} onSubmit={() => void submit()}>
      <div className={styles.fieldGrid}>
        <Field label="Tên lead (công ty hoặc cá nhân)" required wide>
          <input className={styles.input} value={form.name} maxLength={300} autoFocus onChange={(event) => set('name', event.target.value)} />
        </Field>
        <Field label="Người liên hệ">
          <input className={styles.input} value={form.contactName} maxLength={200} onChange={(event) => set('contactName', event.target.value)} />
        </Field>
        <Field label="Mã số thuế" error={taxCodeError}>
          <input className={styles.input} value={form.taxCode} maxLength={14} onChange={(event) => set('taxCode', event.target.value)} />
        </Field>
        <Field label="Điện thoại">
          <input className={styles.input} value={form.phone} maxLength={50} onChange={(event) => set('phone', event.target.value)} />
        </Field>
        <Field label="Email">
          <input className={styles.input} type="email" value={form.email} maxLength={200} onChange={(event) => set('email', event.target.value)} />
        </Field>
        <Field label="Nguồn" hint="Ví dụ: Sự kiện, Website, Giới thiệu">
          <input className={styles.input} value={form.source} maxLength={100} onChange={(event) => set('source', event.target.value)} />
        </Field>
        <Field label="Người phụ trách" hint={lead ? undefined : 'Mặc định là bạn'}>
          <SearchableSelect options={peopleOptions(people)} value={form.ownerUserId} placeholder="Chọn người phụ trách" clearable onChange={(value) => set('ownerUserId', value)} />
        </Field>
        {lead ? (
          <Field label="Trạng thái">
            <SearchableSelect options={labelOptions(EDITABLE_STATUS_LABELS)} value={form.status} onChange={(value) => set('status', value || 'NEW')} />
          </Field>
        ) : null}
        <Field label="Nhu cầu" wide>
          <textarea className={styles.textarea} rows={3} value={form.need} maxLength={4000} onChange={(event) => set('need', event.target.value)} />
        </Field>
        <Field label="Ghi chú" wide>
          <textarea className={styles.textarea} rows={2} value={form.note} maxLength={2000} onChange={(event) => set('note', event.target.value)} />
        </Field>
      </div>
    </CrmDialog>
  );
}

function ConvertLeadDialog({ lead, onClose, onConverted }: { lead: Lead; onClose: () => void; onConverted: (opportunityId: string) => void }) {
  const [opportunityName, setOpportunityName] = useState(lead.name);
  const [expectedValue, setExpectedValue] = useState('');
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  async function submit() {
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await convertLead(lead.id, {
        opportunityName: opportunityName.trim() || null,
        expectedValue: expectedValue ? Number(expectedValue) : null,
        expectedCloseDate: expectedCloseDate || null,
      });
      toast.success(
        result.attachedToExistingCustomer
          ? 'Đã tạo cơ hội và gắn vào khách hàng có cùng mã số thuế.'
          : 'Đã tạo khách hàng và cơ hội từ lead.',
      );
      onConverted(result.opportunityId);
    } catch (cause) {
      setError(errorMessage(cause, 'Không chuyển đổi được lead.'));
      setSubmitting(false);
    }
  }
  return (
    <CrmDialog
      open
      title="Chuyển thành khách hàng và cơ hội"
      subtitle="Tạo khách hàng (hoặc gắn vào khách có cùng mã số thuế) và một cơ hội ở giai đoạn Mới."
      submitLabel="Chuyển đổi"
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <div className={styles.fieldGrid}>
        <Field label="Tên cơ hội" wide>
          <input className={styles.input} value={opportunityName} maxLength={300} autoFocus onChange={(event) => setOpportunityName(event.target.value)} />
        </Field>
        <Field label="Giá trị dự kiến (đồng)">
          <input className={styles.input} inputMode="numeric" value={expectedValue} onChange={(event) => setExpectedValue(event.target.value.replace(/[^\d]/g, ''))} />
        </Field>
        <Field label="Ngày chốt dự kiến">
          <DatePickerInput value={expectedCloseDate || undefined} onChange={setExpectedCloseDate} height={38} aria-label="Ngày chốt dự kiến" />
        </Field>
      </div>
    </CrmDialog>
  );
}
