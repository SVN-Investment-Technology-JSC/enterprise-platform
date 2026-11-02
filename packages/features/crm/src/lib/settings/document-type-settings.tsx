'use client';

import type { CrmDocumentType } from '@enterprise-platform/contracts-crm';
import { toast } from '@enterprise-platform/shared-ui';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CrmDialog, Field } from '../components/crm-ui';
import { createDocumentType, errorMessage, listDocumentTypes, updateDocumentType } from '../crm-api';
import styles from '../sales.module.scss';
import { documentTypeFormError, normalizeDocumentTypeCode, sortDocumentTypes } from './document-type.model';

/** Loại tài liệu của kho tài liệu CRM. Thẻ này chỉ nằm trong Cấu hình (`crm.manage`); server kiểm quyền lại. */
export function DocumentTypeSettings() {
  const [items, setItems] = useState<CrmDocumentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<CrmDocumentType | 'new' | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    listDocumentTypes(true)
      .then((rows) => {
        setItems(sortDocumentTypes(rows));
        setError(undefined);
      })
      .catch((cause) => setError(errorMessage(cause, 'Không tải được loại tài liệu.')))
      .finally(() => setLoading(false));
  }, []);
  useEffect(reload, [reload]);

  async function toggle(row: CrmDocumentType) {
    try {
      await updateDocumentType(row.id, { active: !row.active });
      toast.success(row.active ? 'Đã tắt loại tài liệu.' : 'Đã bật lại loại tài liệu.');
      reload();
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không cập nhật được loại tài liệu.'));
    }
  }

  const columns = useMemo<ColumnsType<CrmDocumentType>>(
    () => [
      { title: 'Mã', dataIndex: 'code', width: 180, render: (value: string) => <span className={styles.mono}>{value}</span> },
      { title: 'Tên loại', dataIndex: 'name' },
      { title: 'Mô tả', dataIndex: 'description', ellipsis: true },
      { title: 'Thứ tự', dataIndex: 'sortOrder', width: 90, align: 'right' },
      {
        title: 'Trạng thái',
        dataIndex: 'active',
        width: 120,
        render: (active: boolean) => <span className={`${styles.pill} ${active ? styles.pill_success : styles.pill_neutral}`}>{active ? 'Đang dùng' : 'Đã tắt'}</span>,
      },
      {
        title: '',
        key: 'actions',
        width: 140,
        render: (_: unknown, row) => (
          <span className={styles.rowActions}>
            <button type="button" className={styles.rowAction} onClick={() => setEditing(row)}>
              Sửa
            </button>
            <button type="button" className={row.active ? styles.rowActionDanger : styles.rowAction} onClick={() => void toggle(row)}>
              {row.active ? 'Tắt' : 'Bật'}
            </button>
          </span>
        ),
      },
    ],
    [reload],
  );

  return (
    <section className={styles.tableCard} aria-label="Loại tài liệu">
      <div className={styles.toolbar}>
        <h2 className={styles.title}>Loại tài liệu</h2>
        <button type="button" className={styles.buttonPrimary} onClick={() => setEditing('new')}>
          <Plus size={14} /> Thêm loại
        </button>
      </div>
      <p className={styles.muted}>Loại đã tắt không được chọn cho tài liệu mới; tài liệu cũ vẫn giữ loại đó.</p>
      {error ? <p className={styles.alert}>{error}</p> : null}
      <Table<CrmDocumentType> size="small" rowKey="id" loading={loading} columns={columns} dataSource={items} pagination={false} locale={{ emptyText: 'Chưa có loại tài liệu nào.' }} />
      {editing ? (
        <DocumentTypeDialog
          row={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : null}
    </section>
  );
}

function DocumentTypeDialog({ row, onClose, onSaved }: { row?: CrmDocumentType; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(row?.code ?? '');
  const [name, setName] = useState(row?.name ?? '');
  const [description, setDescription] = useState(row?.description ?? '');
  const [sortOrder, setSortOrder] = useState(row ? String(row.sortOrder) : '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    const invalid = documentTypeFormError({ code: row ? undefined : code, name, sortOrder });
    if (invalid) return setError(invalid);
    setSubmitting(true);
    setError(undefined);
    const order = sortOrder.trim() === '' ? undefined : Number(sortOrder);
    try {
      if (row) await updateDocumentType(row.id, { name: name.trim(), description: description.trim() || null, sortOrder: order });
      else await createDocumentType({ code: normalizeDocumentTypeCode(code), name: name.trim(), description: description.trim() || null, sortOrder: order });
      toast.success('Đã lưu loại tài liệu.');
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được loại tài liệu.'));
      setSubmitting(false);
    }
  }

  return (
    <CrmDialog open title={row ? 'Sửa loại tài liệu' : 'Thêm loại tài liệu'} submitting={submitting} error={error} onClose={onClose} onSubmit={() => void submit()}>
      <div className={styles.fieldGrid}>
        <Field label="Mã loại" required hint={row ? 'Không đổi sau khi tạo' : 'Chữ hoa, số, gạch dưới, 2 đến 32 ký tự'}>
          <input className={styles.input} value={code} maxLength={32} disabled={!!row} autoFocus={!row} onChange={(event) => setCode(event.target.value)} />
        </Field>
        <Field label="Tên loại" required>
          <input className={styles.input} value={name} maxLength={200} autoFocus={!!row} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Thứ tự hiển thị">
          <input className={styles.input} inputMode="numeric" value={sortOrder} maxLength={6} onChange={(event) => setSortOrder(event.target.value.replace(/[^\d]/g, ''))} />
        </Field>
        <Field label="Mô tả" wide>
          <textarea className={styles.textarea} rows={2} value={description} maxLength={1000} onChange={(event) => setDescription(event.target.value)} />
        </Field>
      </div>
    </CrmDialog>
  );
}
