'use client';

import {
  QUOTE_STATUS_LABELS,
  type CustomerSummary,
  type OpportunitySummary,
  type QuoteStatus,
  type QuoteSummary,
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
import { createQuote, errorMessage, listCustomers, listOpportunities, listQuotes } from '../crm-api';
import { labelOptions, peopleOptions, useCrm } from '../crm-context';
import { formatMoney, personName } from '../sales.model';
import styles from '../sales.module.scss';
import { QUOTE_STATUS_TONE } from './quote.model';

const formatDate = (value: string | null) => (value ? value.split('-').reverse().join('/') : '');

/** Được lập, sửa báo giá (`crm.quote.write`). */
export function useCanWriteQuote(): boolean {
  const { capabilities } = useCrm();
  return capabilities.isTenantAdmin || capabilities.canWriteQuote;
}

/**
 * Danh sách báo giá trong phạm vi dữ liệu: tìm theo mã báo giá, tên khách; lọc
 * trạng thái, người phụ trách. Phân trang keyset.
 */
export function QuotesPage({ onOpen }: { onOpen: (id: string) => void }) {
  const { people } = useCrm();
  const canWrite = useCanWriteQuote();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [creating, setCreating] = useState(false);
  const q = useDebounced(search.trim(), 350);
  const filter = { q, status, ownerUserId };
  const list = useKeysetPage(JSON.stringify(filter), (cursor) =>
    listQuotes({ q, status: (status || undefined) as QuoteStatus | undefined, ownerUserId, cursor, limit: 30 }),
  );

  const columns = useMemo<ColumnsType<QuoteSummary>>(
    () => [
      { title: 'Mã', dataIndex: 'code', width: 130, render: (value: string) => <span className={styles.mono}>{value}</span> },
      {
        title: 'Khách hàng',
        key: 'customer',
        ellipsis: true,
        render: (_: unknown, row) => `${row.customerCode} - ${row.customerName}`,
      },
      { title: 'Cơ hội', dataIndex: 'opportunityName', width: 200, ellipsis: true },
      { title: 'Phiên bản', dataIndex: 'currentVersion', width: 90, align: 'right', render: (value: number) => `v${value}` },
      {
        title: 'Trạng thái',
        dataIndex: 'status',
        width: 160,
        render: (value: QuoteStatus) => <StatusPill tone={QUOTE_STATUS_TONE[value]}>{QUOTE_STATUS_LABELS[value]}</StatusPill>,
      },
      { title: 'Tổng cộng', dataIndex: 'totalAmount', width: 150, align: 'right', render: (value: number) => formatMoney(value) },
      { title: 'Hiệu lực đến', dataIndex: 'validUntil', width: 120, render: formatDate },
      { title: 'Người phụ trách', dataIndex: 'ownerUserId', width: 170, ellipsis: true, render: (value: string) => personName(people, value) },
      {
        title: '',
        key: 'actions',
        width: 80,
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
    <section className={styles.tableCard} aria-label="Danh sách báo giá">
      <div className={styles.toolbar}>
        {canWrite ? (
          <button type="button" className={styles.buttonPrimary} onClick={() => setCreating(true)}>
            <Plus size={14} /> Lập báo giá
          </button>
        ) : null}
        <input
          className={`${styles.input} ${styles.search}`}
          type="search"
          placeholder="Tìm theo mã báo giá, tên khách…"
          value={search}
          maxLength={100}
          onChange={(event) => setSearch(event.target.value)}
        />
        <SearchableSelect className={styles.filter} options={labelOptions(QUOTE_STATUS_LABELS)} value={status} placeholder="Mọi trạng thái" clearable onChange={setStatus} />
        <SearchableSelect className={styles.filter} options={peopleOptions(people)} value={ownerUserId} placeholder="Mọi người phụ trách" clearable onChange={setOwnerUserId} />
      </div>
      {list.error ? <p className={styles.alert}>{list.error}</p> : null}
      <Table<QuoteSummary>
        size="small"
        rowKey="id"
        loading={list.loading}
        columns={columns}
        dataSource={[...list.items]}
        pagination={false}
        scroll={{ x: 1200 }}
        onRow={(row) => ({ onDoubleClick: () => onOpen(row.id) })}
        locale={{ emptyText: list.loading ? 'Đang tải…' : 'Chưa có báo giá nào.' }}
      />
      <KeysetPager
        page={list.page}
        count={list.items.length}
        hasNext={list.hasNext}
        loading={list.loading}
        noun="báo giá"
        onPrevious={list.previous}
        onNext={list.next}
      />
      {creating ? (
        <CreateQuoteDialog
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

/**
 * Lập báo giá cho một cơ hội (khách lấy theo cơ hội) hoặc thẳng cho một khách.
 * `opportunityId` truyền sẵn khi mở từ màn cơ hội.
 */
export function CreateQuoteDialog({
  opportunityId: fixedOpportunityId,
  onClose,
  onCreated,
}: {
  opportunityId?: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [customers, setCustomers] = useState<readonly CustomerSummary[]>([]);
  const [opportunities, setOpportunities] = useState<readonly OpportunitySummary[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [opportunityId, setOpportunityId] = useState(fixedOpportunityId ?? '');
  const [validUntil, setValidUntil] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (fixedOpportunityId) return;
    listCustomers({ limit: 100 })
      .then((page) => setCustomers(page.items))
      .catch(() => undefined);
    listOpportunities({ limit: 100 })
      .then((page) => setOpportunities(page.items.filter((item) => item.stage !== 'WON' && item.stage !== 'LOST')))
      .catch(() => undefined);
  }, [fixedOpportunityId]);

  async function save() {
    if (!opportunityId && !customerId) return setError('Vui lòng chọn cơ hội hoặc khách hàng.');
    setSaving(true);
    setError(undefined);
    try {
      const created = await createQuote({
        opportunityId: opportunityId || null,
        customerId: opportunityId ? null : customerId,
        validUntil: validUntil || null,
        note: note.trim() || null,
      });
      toast.success(`Đã lập báo giá ${created.code}.`);
      onCreated(created.id);
    } catch (cause) {
      setError(errorMessage(cause, 'Không lập được báo giá.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <CrmDialog open title="Lập báo giá" submitLabel="Lập báo giá" submitting={saving} error={error} onClose={onClose} onSubmit={() => void save()}>
      <div className={styles.fieldGrid}>
        {fixedOpportunityId ? null : (
          <>
            <Field label="Cơ hội" hint="Khách hàng và người phụ trách lấy theo cơ hội">
              <SearchableSelect
                options={opportunities.map((item) => ({ value: item.id, label: item.name, description: item.customerName }))}
                value={opportunityId}
                placeholder="Không gắn cơ hội"
                clearable
                onChange={setOpportunityId}
              />
            </Field>
            <Field label="Hoặc khách hàng">
              <SearchableSelect
                options={customers.map((item) => ({ value: item.id, label: item.name, badge: item.code }))}
                value={opportunityId ? '' : customerId}
                placeholder="Chọn khách hàng"
                disabled={Boolean(opportunityId)}
                clearable
                onChange={setCustomerId}
              />
            </Field>
          </>
        )}
        <Field label="Hiệu lực đến" hint="Bỏ trống: 30 ngày kể từ hôm nay">
          <DatePickerInput value={validUntil || undefined} onChange={setValidUntil} height={38} placeholder="Mặc định 30 ngày" aria-label="Hiệu lực đến" />
        </Field>
        <Field label="Ghi chú" wide>
          <textarea className={styles.textarea} rows={3} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
    </CrmDialog>
  );
}
