'use client';

import type { CrmSettings, CustomerGroup } from '@enterprise-platform/contracts-crm';
import { Popconfirm, toast } from '@enterprise-platform/shared-ui';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CrmDialog, Field } from '../components/crm-ui';
import { createGroup, deleteGroup, errorMessage, loadSettings, saveSettings, updateGroup } from '../crm-api';
import { useCrm } from '../crm-context';
import styles from '../sales.module.scss';
import { DiscountPoliciesPage } from '../pricing/discount-policies-page';
import { PriceListsPage } from '../pricing/price-lists-page';
import { QuotePreviewPanel } from '../pricing/quote-preview-panel';
import { ApprovalSettingsPage } from './approval-settings';

/** Thẻ của trang Cấu hình; id cũng là đoạn hash thứ hai (`#settings/price-lists`). */
export type CrmSettingsTab = 'general' | 'price-lists' | 'discount-policies' | 'quote-preview' | 'approval';

const SETTINGS_TABS: readonly { id: CrmSettingsTab; label: string }[] = [
  { id: 'general', label: 'Chung' },
  { id: 'price-lists', label: 'Bảng giá' },
  { id: 'discount-policies', label: 'Chính sách chiết khấu' },
  { id: 'quote-preview', label: 'Thử tính giá' },
  { id: 'approval', label: 'Duyệt báo giá' },
];

export function settingsTab(value: string | undefined): CrmSettingsTab {
  return SETTINGS_TABS.find((tab) => tab.id === value)?.id ?? 'general';
}

/**
 * Cấu hình của quản trị bán hàng (`crm.manage`): quy tắc mã khách hàng, thời
 * gian nhắc hoạt động trước hạn, nhóm khách hàng; bảng giá, chính sách chiết
 * khấu, thử tính giá; ngưỡng và cách duyệt báo giá. Server kiểm quyền lại.
 */
export function CrmSettingsPage({ tab, onTab }: { tab?: string; onTab?: (tab: CrmSettingsTab) => void }) {
  const current = settingsTab(tab);
  return (
    <div className={styles.page}>
      <nav className={styles.tabs} role="tablist" aria-label="Cấu hình bán hàng">
        {SETTINGS_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={current === item.id}
            className={current === item.id ? styles.tabActive : styles.tab}
            onClick={() => onTab?.(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {current === 'price-lists' ? (
        <PriceListsPage />
      ) : current === 'discount-policies' ? (
        <DiscountPoliciesPage />
      ) : current === 'quote-preview' ? (
        <QuotePreviewPanel />
      ) : current === 'approval' ? (
        <ApprovalSettingsPage />
      ) : (
        <>
          <GeneralSettings />
          <CustomerGroups />
        </>
      )}
    </div>
  );
}

function GeneralSettings() {
  const [settings, setSettings] = useState<CrmSettings>();
  const [prefix, setPrefix] = useState('');
  const [length, setLength] = useState('');
  const [reminder, setReminder] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    loadSettings()
      .then((value) => {
        setSettings(value);
        setPrefix(value.customerCode.prefix);
        setLength(String(value.customerCode.length));
        setReminder(String(value.activityReminderMinutes));
      })
      .catch((cause) => setError(errorMessage(cause, 'Không tải được cấu hình.')));
  }, []);

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      const value = await saveSettings({
        customerCode: { prefix: prefix.trim(), length: Number(length) },
        activityReminderMinutes: Number(reminder),
      });
      setSettings(value);
      toast.success('Đã lưu cấu hình.');
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được cấu hình.'));
    } finally {
      setSaving(false);
    }
  }

  const sample = `${prefix.trim().toUpperCase()}${'1'.padStart(Number(length) || 0, '0')}`;

  return (
    <section className={styles.panel} aria-label="Cấu hình chung">
      <h2 className={styles.title}>Cấu hình chung</h2>
      {error ? <p className={styles.alert}>{error}</p> : null}
      {settings ? (
        <form
          className={styles.fieldGrid}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Field label="Tiền tố mã khách hàng" hint={`Mã kế tiếp có dạng ${sample}`}>
            <input className={styles.input} value={prefix} maxLength={10} onChange={(event) => setPrefix(event.target.value)} />
          </Field>
          <Field label="Số chữ số của mã" hint="Từ 3 đến 12">
            <input className={styles.input} inputMode="numeric" value={length} maxLength={2} onChange={(event) => setLength(event.target.value.replace(/[^\d]/g, ''))} />
          </Field>
          <Field label="Nhắc hoạt động trước hạn (phút)" hint="Người được giao nhận thông báo trước hạn và khi quá hạn">
            <input className={styles.input} inputMode="numeric" value={reminder} maxLength={5} onChange={(event) => setReminder(event.target.value.replace(/[^\d]/g, ''))} />
          </Field>
          <div className={styles.formActions}>
            <button type="submit" className={styles.buttonPrimary} disabled={saving}>
              {saving ? 'Đang lưu…' : 'Lưu cấu hình'}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function CustomerGroups() {
  const { groups, reloadGroups } = useCrm();
  const [editing, setEditing] = useState<CustomerGroup | 'new' | null>(null);

  const columns = useMemo<ColumnsType<CustomerGroup>>(
    () => [
      { title: 'Mã', dataIndex: 'code', width: 140, render: (value: string) => <span className={styles.mono}>{value}</span> },
      { title: 'Tên nhóm', dataIndex: 'name' },
      { title: 'Mô tả', dataIndex: 'description', ellipsis: true },
      { title: 'Số khách', dataIndex: 'customerCount', width: 100, align: 'right' },
      {
        title: '',
        key: 'actions',
        width: 140,
        render: (_: unknown, row) => (
          <span className={styles.rowActions}>
            <button type="button" className={styles.rowAction} onClick={() => setEditing(row)}>
              Sửa
            </button>
            <Popconfirm
              title="Xoá nhóm khách hàng?"
              description={row.customerCount ? 'Nhóm đang có khách hàng nên sẽ không xoá được.' : 'Không hoàn tác được.'}
              okText="Xoá"
              cancelText="Huỷ"
              okType="danger"
              onConfirm={async () => {
                try {
                  await deleteGroup(row.id);
                  toast.success('Đã xoá nhóm.');
                  reloadGroups();
                } catch (cause) {
                  toast.error(errorMessage(cause, 'Không xoá được nhóm.'));
                }
              }}
            >
              <button type="button" className={styles.rowActionDanger}>
                Xoá
              </button>
            </Popconfirm>
          </span>
        ),
      },
    ],
    [reloadGroups],
  );

  return (
    <section className={styles.tableCard} aria-label="Nhóm khách hàng">
      <div className={styles.toolbar}>
        <h2 className={styles.title}>Nhóm khách hàng</h2>
        <button type="button" className={styles.buttonPrimary} onClick={() => setEditing('new')}>
          <Plus size={14} /> Thêm nhóm
        </button>
      </div>
      <Table<CustomerGroup> size="small" rowKey="id" columns={columns} dataSource={[...groups]} pagination={false} locale={{ emptyText: 'Chưa có nhóm nào.' }} />
      {editing ? (
        <GroupDialog
          group={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reloadGroups();
          }}
        />
      ) : null}
    </section>
  );
}

function GroupDialog({ group, onClose, onSaved }: { group?: CustomerGroup; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(group?.code ?? '');
  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  async function submit() {
    if (!code.trim() || !name.trim()) return setError('Vui lòng nhập mã và tên nhóm.');
    setSubmitting(true);
    setError(undefined);
    const body = { code: code.trim(), name: name.trim(), description: description.trim() || null };
    try {
      if (group) await updateGroup(group.id, body);
      else await createGroup(body);
      toast.success('Đã lưu nhóm khách hàng.');
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được nhóm.'));
      setSubmitting(false);
    }
  }
  return (
    <CrmDialog open title={group ? 'Sửa nhóm khách hàng' : 'Thêm nhóm khách hàng'} submitting={submitting} error={error} onClose={onClose} onSubmit={() => void submit()}>
      <div className={styles.fieldGrid}>
        <Field label="Mã nhóm" required>
          <input className={styles.input} value={code} maxLength={50} autoFocus onChange={(event) => setCode(event.target.value)} />
        </Field>
        <Field label="Tên nhóm" required>
          <input className={styles.input} value={name} maxLength={200} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Mô tả" wide>
          <textarea className={styles.textarea} rows={2} value={description} maxLength={1000} onChange={(event) => setDescription(event.target.value)} />
        </Field>
      </div>
    </CrmDialog>
  );
}
