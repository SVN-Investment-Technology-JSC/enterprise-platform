'use client';

import type { CrmDocument, CrmDocumentDetail, CrmDocumentEntityType, CrmDocumentFolder, CrmDocumentType } from '@enterprise-platform/contracts-crm';
import { Popconfirm, SearchableSelect, formatDateTime, toast } from '@enterprise-platform/shared-ui';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CrmDialog, Field, StatusPill } from '../components/crm-ui';
import {
  deleteDocument,
  errorMessage,
  getDocument,
  listDocumentFolders,
  listDocumentTypes,
  listDocuments,
  lockDocument,
  setDocumentAudience,
  unlockDocument,
  updateDocument,
} from '../crm-api';
import { personName } from '../sales.model';
import { useCrm } from '../crm-context';
import styles from '../sales.module.scss';
import { FolderDialog, NewVersionDialog, UploadDocumentDialog, VersionList, audienceOptions, openDownload } from './document-dialogs';
import {
  DOCUMENT_AUDIENCE_LABELS,
  FOLDER_ALL,
  FOLDER_ROOT,
  documentActions,
  folderLabel,
  folderOptions,
  formatBytes,
  isLocked,
} from './documents.model';

/**
 * Thành phần "Tài liệu" dùng chung cho mọi đối tượng CRM: danh sách, thư mục, tải lên trực tiếp lên URL ký,
 * phiên bản, khoá, đối tượng xem. Nút ẩn theo quyền tài liệu; máy chủ vẫn kiểm lại.
 */
export function DocumentsPanel({
  entityType,
  entityId,
  showTitle = false,
}: {
  entityType: CrmDocumentEntityType;
  entityId: string;
  /** Hiện tiêu đề "Tài liệu" (khối nằm giữa các khối khác, không phải tab riêng). */
  showTitle?: boolean;
}) {
  const { capabilities, currentUserId, people } = useCrm();
  const [documents, setDocuments] = useState<CrmDocument[]>();
  const [folders, setFolders] = useState<CrmDocumentFolder[]>([]);
  const [types, setTypes] = useState<CrmDocumentType[]>([]);
  const [error, setError] = useState<string>();
  const [folderFilter, setFolderFilter] = useState(FOLDER_ALL);
  const [typeFilter, setTypeFilter] = useState('');
  const [audienceFilter, setAudienceFilter] = useState('');
  const [uploading, setUploading] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [openId, setOpenId] = useState<string>();

  const foldersChoices = useMemo(() => folderOptions(folders), [folders]);
  const folderFilterOptions = useMemo(() => [{ value: FOLDER_ROOT, label: 'Thư mục gốc' }, ...foldersChoices], [foldersChoices]);

  const load = useCallback(() => {
    listDocuments({
      entityType,
      entityId,
      folderId: folderFilter || undefined,
      documentTypeId: typeFilter || undefined,
      audience: (audienceFilter || undefined) as CrmDocument['audience'] | undefined,
    })
      .then((next) => {
        setDocuments(next);
        setError(undefined);
      })
      .catch((cause) => {
        setDocuments([]);
        setError(errorMessage(cause, 'Không tải được danh sách tài liệu.'));
      });
  }, [entityType, entityId, folderFilter, typeFilter, audienceFilter]);

  useEffect(() => load(), [load]);
  useEffect(() => {
    listDocumentFolders(entityType, entityId).then(setFolders).catch(() => undefined);
  }, [entityType, entityId]);
  useEffect(() => {
    // Người không có quyền cấu hình vẫn cần danh sách loại để lọc; lỗi thì chỉ mất ô chọn loại.
    listDocumentTypes().then(setTypes).catch(() => undefined);
  }, []);

  async function act(task: () => Promise<unknown>, success: string) {
    try {
      await task();
      toast.success(success);
      load();
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không thực hiện được thao tác.'));
    }
  }

  const columns: ColumnsType<CrmDocument> = [
    {
      title: 'Tài liệu',
      dataIndex: 'name',
      ellipsis: true,
      render: (_: unknown, row) => (
        <button type="button" className={styles.rowAction} onClick={() => setOpenId(row.id)}>
          {row.name}
        </button>
      ),
    },
    { title: 'Loại', key: 'type', width: 150, ellipsis: true, render: (_: unknown, row) => row.documentType?.name ?? '' },
    { title: 'Thư mục', key: 'folder', width: 160, ellipsis: true, render: (_: unknown, row) => folderLabel(row.folderId, foldersChoices) },
    {
      title: 'Phiên bản',
      key: 'version',
      width: 130,
      render: (_: unknown, row) => (row.currentVersionNo ? `Bản ${row.currentVersionNo} · ${formatBytes(row.sizeBytes)}` : 'Chưa có file'),
    },
    {
      title: 'Đối tượng xem',
      dataIndex: 'audience',
      width: 140,
      render: (value: CrmDocument['audience']) => <StatusPill tone={value === 'customer' ? 'info' : 'neutral'}>{DOCUMENT_AUDIENCE_LABELS[value]}</StatusPill>,
    },
    {
      title: 'Khoá',
      key: 'lock',
      width: 150,
      render: (_: unknown, row) => (isLocked(row) ? <StatusPill tone="warning">{`Đang khoá · ${personName(people, row.lockedByUserId)}`}</StatusPill> : ''),
    },
    { title: 'Cập nhật', dataIndex: 'updatedAt', width: 150, render: (value: string) => formatDateTime(value) },
    {
      title: '',
      key: 'actions',
      width: 250,
      render: (_: unknown, row) => {
        const actions = documentActions(row, capabilities, currentUserId);
        return (
          <span className={styles.rowActions}>
            {row.currentVersionNo ? (
              <button type="button" className={styles.rowAction} onClick={() => void openDownload(row.id)}>
                Tải xuống
              </button>
            ) : null}
            {actions.lock ? (
              <button type="button" className={styles.rowAction} onClick={() => void act(() => lockDocument(row.id), 'Đã khoá tài liệu.')}>
                Khoá
              </button>
            ) : null}
            {actions.unlock ? (
              <button type="button" className={styles.rowAction} onClick={() => void act(() => unlockDocument(row.id), 'Đã mở khoá tài liệu.')}>
                Mở khoá
              </button>
            ) : null}
            {actions.remove ? (
              <Popconfirm
                title="Xoá tài liệu?"
                description="Tài liệu và mọi phiên bản sẽ không còn hiện trong danh sách."
                okText="Xoá"
                cancelText="Huỷ"
                onConfirm={() => act(() => deleteDocument(row.id), 'Đã xoá tài liệu.')}
              >
                <button type="button" className={styles.rowAction}>
                  Xoá
                </button>
              </Popconfirm>
            ) : null}
          </span>
        );
      },
    },
  ];

  return (
    <section className={styles.tableCard} aria-label="Tài liệu">
      {showTitle ? <h3 className={styles.sectionTitle}>Tài liệu</h3> : null}
      <div className={styles.toolbar}>
        {capabilities.canWriteDocument ? (
          <>
            <button type="button" className={styles.buttonPrimary} onClick={() => setUploading(true)}>
              <Plus size={14} /> Tải tài liệu lên
            </button>
            <button type="button" className={styles.buttonGhost} onClick={() => setCreatingFolder(true)}>
              Thư mục mới
            </button>
          </>
        ) : null}
        <SearchableSelect className={styles.filter} options={folderFilterOptions} value={folderFilter} placeholder="Mọi thư mục" clearable emptyText="Không có thư mục phù hợp" onChange={setFolderFilter} />
        <SearchableSelect
          className={styles.filter}
          options={types.map((type) => ({ value: type.id, label: type.name, badge: type.code }))}
          value={typeFilter}
          placeholder="Mọi loại tài liệu"
          clearable
          emptyText="Không có loại tài liệu phù hợp"
          onChange={setTypeFilter}
        />
        <SearchableSelect className={styles.filter} options={audienceOptions} value={audienceFilter} placeholder="Mọi đối tượng xem" clearable onChange={setAudienceFilter} />
      </div>
      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}
      <Table<CrmDocument>
        size="small"
        rowKey="id"
        loading={documents === undefined}
        columns={columns}
        dataSource={documents ?? []}
        pagination={false}
        scroll={{ x: 1100 }}
        locale={{
          emptyText: documents === undefined ? 'Đang tải…' : capabilities.canWriteDocument ? 'Chưa có tài liệu nào. Bấm "Tải tài liệu lên" để thêm.' : 'Chưa có tài liệu nào.',
        }}
      />
      {uploading ? (
        <UploadDocumentDialog
          entityType={entityType}
          entityId={entityId}
          folderId={folderFilter && folderFilter !== FOLDER_ROOT ? folderFilter : null}
          types={types}
          folderChoices={foldersChoices}
          onClose={() => setUploading(false)}
          onUploaded={() => {
            setUploading(false);
            load();
          }}
        />
      ) : null}
      {creatingFolder ? (
        <FolderDialog
          entityType={entityType}
          entityId={entityId}
          parentId={folderFilter && folderFilter !== FOLDER_ROOT ? folderFilter : null}
          folderChoices={foldersChoices}
          onClose={() => setCreatingFolder(false)}
          onCreated={(folder) => {
            setFolders((current) => [...current, folder]);
            setCreatingFolder(false);
            toast.success('Đã tạo thư mục.');
          }}
        />
      ) : null}
      {openId ? (
        <DocumentDetailDialog
          id={openId}
          types={types}
          onClose={() => setOpenId(undefined)}
          onChanged={load}
        />
      ) : null}
    </section>
  );
}

/** Chi tiết tài liệu: sửa thông tin, đối tượng xem, khoá, phiên bản. */
function DocumentDetailDialog({
  id,
  types,
  onClose,
  onChanged,
}: {
  id: string;
  types: readonly CrmDocumentType[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { capabilities, currentUserId } = useCrm();
  const [detail, setDetail] = useState<CrmDocumentDetail>();
  const [error, setError] = useState<string>();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [typeId, setTypeId] = useState('');
  const [saving, setSaving] = useState(false);
  const [versioning, setVersioning] = useState(false);

  const load = useCallback(
    () =>
      getDocument(id)
        .then((next) => {
          setDetail(next);
          setName(next.name);
          setDescription(next.description ?? '');
          setTypeId(next.documentType?.id ?? '');
          setError(undefined);
        })
        .catch((cause) => setError(errorMessage(cause, 'Không tải được tài liệu.'))),
    [id],
  );
  useEffect(() => void load(), [load]);

  const actions = detail ? documentActions(detail, capabilities, currentUserId) : undefined;

  async function save() {
    if (!name.trim()) return setError('Nhập tên tài liệu.');
    setSaving(true);
    try {
      await updateDocument(id, { name: name.trim(), description: description.trim() || null, documentTypeId: typeId || null });
      toast.success('Đã lưu tài liệu.');
      onChanged();
      await load();
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được tài liệu.'));
    } finally {
      setSaving(false);
    }
  }

  async function run(task: () => Promise<unknown>, success: string) {
    try {
      await task();
      toast.success(success);
      onChanged();
      await load();
    } catch (cause) {
      setError(errorMessage(cause, 'Không thực hiện được thao tác.'));
    }
  }

  return (
    <CrmDialog
      open
      wide
      title="Chi tiết tài liệu"
      subtitle={detail?.name}
      submitLabel={actions?.edit ? 'Lưu' : 'Đóng'}
      submitting={saving}
      error={error}
      onClose={onClose}
      onSubmit={() => (actions?.edit ? void save() : onClose())}
    >
      {!detail ? (
        <p className={styles.muted}>{error ? '' : 'Đang tải…'}</p>
      ) : (
        <>
          <div className={styles.fieldGrid}>
            <Field label="Tên tài liệu" required>
              <input className={styles.input} value={name} maxLength={200} disabled={!actions?.edit} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="Loại tài liệu">
              <SearchableSelect
                options={types.filter((type) => type.active || type.id === typeId).map((type) => ({ value: type.id, label: type.name, badge: type.code }))}
                value={typeId}
                placeholder="Chọn loại tài liệu"
                clearable
                disabled={!actions?.edit}
                onChange={setTypeId}
              />
            </Field>
            <Field label="Đối tượng xem">
              <SearchableSelect
                options={audienceOptions}
                value={detail.audience}
                disabled={!actions?.audience}
                onChange={(value) => value && value !== detail.audience && void run(() => setDocumentAudience(id, value as CrmDocument['audience']), 'Đã đổi đối tượng xem.')}
              />
            </Field>
            <Field label="Mô tả" wide>
              <textarea className={styles.textarea} rows={2} maxLength={500} value={description} disabled={!actions?.edit} onChange={(event) => setDescription(event.target.value)} />
            </Field>
          </div>
          <div className={styles.toolbar}>
            {actions?.newVersion ? (
              <button type="button" className={styles.buttonGhost} onClick={() => setVersioning(true)}>
                Tải phiên bản mới
              </button>
            ) : null}
            {actions?.lock ? (
              <button type="button" className={styles.buttonGhost} onClick={() => void run(() => lockDocument(id), 'Đã khoá tài liệu.')}>
                Khoá tài liệu
              </button>
            ) : null}
            {actions?.unlock ? (
              <button type="button" className={styles.buttonGhost} onClick={() => void run(() => unlockDocument(id), 'Đã mở khoá tài liệu.')}>
                Mở khoá
              </button>
            ) : null}
          </div>
          <h4 className={styles.sectionTitle}>Phiên bản</h4>
          <VersionList detail={detail} />
          {versioning ? (
            <NewVersionDialog
              document={detail}
              onClose={() => setVersioning(false)}
              onUploaded={() => {
                setVersioning(false);
                onChanged();
                void load();
              }}
            />
          ) : null}
        </>
      )}
    </CrmDialog>
  );
}
