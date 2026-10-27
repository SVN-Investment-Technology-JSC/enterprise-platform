'use client';

import { CUSTOMER_KIND_LABELS, type CustomerKind, type CustomerSummary } from '@enterprise-platform/contracts-crm';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { KeysetPager, StatusPill } from '../components/crm-ui';
import { useKeysetPage } from '../components/use-keyset-page';
import { listCustomers } from '../crm-api';
import { groupOptions, labelOptions, peopleOptions, useCanWrite, useCrm } from '../crm-context';
import { personName } from '../sales.model';
import styles from '../sales.module.scss';
import { useDebounced } from '../components/use-debounced';
import { CustomerFormDialog } from './customer-form';

export const KIND_TONE: Record<CustomerKind, 'info' | 'success' | 'neutral'> = {
  LEAD_CUSTOMER: 'info',
  CUSTOMER: 'success',
  INACTIVE: 'neutral',
};

/**
 * Danh sách khách hàng trong phạm vi dữ liệu: tìm theo mã, tên, MST; lọc nhóm,
 * phân loại, người phụ trách. Phân trang keyset (Trước / Sau) để chạy được với
 * hàng chục nghìn khách.
 */
export function CustomerList({ onOpen }: { onOpen: (id: string) => void }) {
  const { people, groups } = useCrm();
  const canWrite = useCanWrite();
  const [search, setSearch] = useState('');
  const [groupId, setGroupId] = useState('');
  const [kind, setKind] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [creating, setCreating] = useState(false);
  const q = useDebounced(search.trim(), 350);

  const filter = { q, groupId, kind: kind as CustomerKind | '', ownerUserId };
  const list = useKeysetPage(JSON.stringify(filter), (cursor) =>
    listCustomers({ q, groupId, kind: (kind || undefined) as CustomerKind | undefined, ownerUserId, cursor, limit: 30 }),
  );

  const columns = useMemo<ColumnsType<CustomerSummary>>(
    () => [
      { title: 'Mã', dataIndex: 'code', width: 130, render: (value: string) => <span className={styles.mono}>{value}</span> },
      { title: 'Tên khách hàng', dataIndex: 'name', ellipsis: true },
      { title: 'MST', dataIndex: 'taxCode', width: 150, render: (value: string | null) => <span className={styles.mono}>{value ?? ''}</span> },
      { title: 'Nhóm', dataIndex: 'groupName', width: 150, ellipsis: true },
      {
        title: 'Phân loại',
        dataIndex: 'kind',
        width: 170,
        render: (value: CustomerKind) => <StatusPill tone={KIND_TONE[value]}>{CUSTOMER_KIND_LABELS[value]}</StatusPill>,
      },
      { title: 'Tỉnh/thành', dataIndex: 'province', width: 120, ellipsis: true },
      { title: 'Liên hệ chính', dataIndex: 'primaryContactName', width: 160, ellipsis: true },
      { title: 'Người phụ trách', dataIndex: 'ownerUserId', width: 170, ellipsis: true, render: (value: string) => personName(people, value) },
      {
        title: '',
        key: 'actions',
        width: 80,
        render: (_: unknown, row) => (
          <button type="button" className={styles.rowAction} onClick={() => onOpen(row.id)}>
            Xem
          </button>
        ),
      },
    ],
    [people, onOpen],
  );

  const filtered = Boolean(search || groupId || kind || ownerUserId);

  return (
    <section className={styles.tableCard} aria-label="Danh sách khách hàng">
      <div className={styles.toolbar}>
        {canWrite ? (
          <button type="button" className={styles.buttonPrimary} onClick={() => setCreating(true)}>
            <Plus size={14} /> Thêm khách hàng
          </button>
        ) : null}
        <input
          className={`${styles.input} ${styles.search}`}
          type="search"
          placeholder="Tìm theo mã, tên, mã số thuế…"
          value={search}
          maxLength={100}
          onChange={(event) => setSearch(event.target.value)}
        />
        <SearchableSelect className={styles.filter} options={groupOptions(groups)} value={groupId} placeholder="Tất cả nhóm" clearable onChange={setGroupId} />
        <SearchableSelect className={styles.filter} options={labelOptions(CUSTOMER_KIND_LABELS)} value={kind} placeholder="Mọi phân loại" clearable onChange={setKind} />
        <SearchableSelect className={styles.filter} options={peopleOptions(people)} value={ownerUserId} placeholder="Mọi người phụ trách" clearable onChange={setOwnerUserId} />
        {filtered ? (
          <button
            type="button"
            className={styles.buttonGhost}
            onClick={() => {
              setSearch('');
              setGroupId('');
              setKind('');
              setOwnerUserId('');
            }}
          >
            Xoá bộ lọc
          </button>
        ) : null}
      </div>
      {list.error ? <p className={styles.alert}>{list.error}</p> : null}
      <Table<CustomerSummary>
        size="small"
        rowKey="id"
        loading={list.loading}
        columns={columns}
        dataSource={[...list.items]}
        pagination={false}
        scroll={{ x: 1200 }}
        onRow={(row) => ({ onDoubleClick: () => onOpen(row.id) })}
        locale={{ emptyText: list.loading ? 'Đang tải…' : 'Không có khách hàng nào.' }}
      />
      <KeysetPager
        page={list.page}
        count={list.items.length}
        hasNext={list.hasNext}
        loading={list.loading}
        noun="khách hàng"
        onPrevious={list.previous}
        onNext={list.next}
      />
      {creating ? (
        <CustomerFormDialog
          onClose={() => setCreating(false)}
          onSaved={(customer) => {
            setCreating(false);
            onOpen(customer.id);
          }}
        />
      ) : null}
    </section>
  );
}
