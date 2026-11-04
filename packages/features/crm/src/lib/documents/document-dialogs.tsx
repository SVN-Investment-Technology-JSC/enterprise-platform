'use client';

import {
  CRM_DOCUMENT_AUDIENCES,
  type CrmDocument,
  type CrmDocumentAudience,
  type CrmDocumentDetail,
  type CrmDocumentEntityType,
  type CrmDocumentFolder,
  type CrmDocumentType,
} from '@enterprise-platform/contracts-crm';
import { SearchableSelect, formatDateTime, toast } from '@enterprise-platform/shared-ui';
import { useReducer, useRef, useState } from 'react';
import { CrmDialog, Field } from '../components/crm-ui';
import {
  completeDocumentUpload,
  createDocument,
  createDocumentFolder,
  createDocumentVersion,
  errorMessage,
  getDocumentDownload,
} from '../crm-api';
import { personName } from '../sales.model';
import { useCrm } from '../crm-context';
import styles from '../sales.module.scss';
import local from './documents.module.scss';
import {
  DOCUMENT_AUDIENCE_LABELS,
  UPLOAD_IDLE,
  formatBytes,
  isUploadBusy,
  uploadPhaseLabel,
  uploadReducer,
  type FolderOption,
} from './documents.model';
import { runUpload } from './run-upload';
import { putFileToSignedUrl } from './upload-file';

export const audienceOptions = CRM_DOCUMENT_AUDIENCES.map((value) => ({ value, label: DOCUMENT_AUDIENCE_LABELS[value] }));

/** Mở file bằng URL ký ngắn hạn (mỗi lần bấm xin URL mới, không lưu lại). */
export async function openDownload(documentId: string, version?: number): Promise<void> {
  try {
    const ticket = await getDocumentDownload(documentId, version);
    window.open(ticket.downloadUrl, '_blank', 'noopener');
  } catch (cause) {
    toast.error(errorMessage(cause, 'Không tải xuống được tài liệu.'));
  }
}

function UploadProgress({ state }: { state: ReturnType<typeof uploadReducer> }) {
  if (state.phase === 'idle') return null;
  return (
    <div aria-live="polite">
      {state.phase === 'uploading' || state.phase === 'confirming' ? (
        <div className={local.progressTrack} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.percent}>
          <div className={local.progressBar} style={{ width: `${state.percent}%` }} />
        </div>
      ) : null}
      {state.phase !== 'error' ? <p className={styles.muted}>{uploadPhaseLabel(state)}</p> : null}
    </div>
  );
}

/** Tải lên tài liệu mới vào một đối tượng. */
export function UploadDocumentDialog({
  entityType,
  entityId,
  folderId,
  types,
  folderChoices,
  onClose,
  onUploaded,
}: {
  entityType: CrmDocumentEntityType;
  entityId: string;
  folderId: string | null;
  types: readonly CrmDocumentType[];
  folderChoices: readonly FolderOption[];
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [file, setFile] = useState<File>();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [documentTypeId, setDocumentTypeId] = useState('');
  const [folder, setFolder] = useState(folderId ?? '');
  const [audience, setAudience] = useState<CrmDocumentAudience>('internal');
  const [fileError, setFileError] = useState<string>();
  const [state, dispatch] = useReducer(uploadReducer, UPLOAD_IDLE);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = isUploadBusy(state);

  async function submit() {
    if (!file) {
      setFileError('Chọn file cần tải lên.');
      return;
    }
    const result = await runUpload(file, {
      dispatch,
      requestTicket: async (meta) => {
        const created = await createDocument({
          entityType,
          entityId,
          folderId: folder || null,
          documentTypeId: documentTypeId || null,
          name: name.trim() || undefined,
          description: description.trim() || null,
          audience,
          ...meta,
        });
        return { uploadUrl: created.uploadUrl, versionId: created.version.id, documentId: created.document.id };
      },
      put: putFileToSignedUrl,
      complete: (documentId, versionId, sizeBytes) => completeDocumentUpload(documentId, versionId, { sizeBytes }),
    });
    if (result) {
      toast.success('Đã tải tài liệu lên.');
      onUploaded();
    }
  }

  return (
    <CrmDialog
      open
      title="Tải tài liệu lên"
      submitLabel="Tải lên"
      submitting={busy}
      error={state.phase === 'error' ? state.error : undefined}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <div className={local.dropZone}>
        <input
          ref={inputRef}
          type="file"
          aria-label="Chọn file"
          disabled={busy}
          onChange={(event) => {
            const picked = event.target.files?.[0];
            setFile(picked);
            setFileError(undefined);
            dispatch({ type: 'reset' });
          }}
        />
        {file ? <span className={styles.muted}>{file.name} · {formatBytes(file.size)}</span> : <span className={styles.muted}>Tối đa 50 MB. PDF, Word, Excel, PowerPoint, ZIP, ảnh, CSV, văn bản.</span>}
        {fileError ? <span className={styles.fieldError}>{fileError}</span> : null}
      </div>
      <div className={styles.fieldGrid}>
        <Field label="Tên tài liệu" hint="Để trống thì lấy tên file.">
          <input className={styles.input} value={name} maxLength={200} disabled={busy} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Loại tài liệu">
          <SearchableSelect
            options={types.filter((type) => type.active).map((type) => ({ value: type.id, label: type.name, badge: type.code }))}
            value={documentTypeId}
            placeholder="Chọn loại tài liệu"
            emptyText="Không có loại tài liệu phù hợp"
            clearable
            onChange={setDocumentTypeId}
          />
        </Field>
        <Field label="Thư mục">
          <SearchableSelect options={[...folderChoices]} value={folder} placeholder="Thư mục gốc" emptyText="Không có thư mục phù hợp" clearable onChange={setFolder} />
        </Field>
        <Field label="Đối tượng xem">
          <SearchableSelect options={audienceOptions} value={audience} onChange={(value) => setAudience((value || 'internal') as CrmDocumentAudience)} />
        </Field>
        <Field label="Mô tả" wide>
          <textarea className={styles.textarea} rows={2} maxLength={500} value={description} disabled={busy} onChange={(event) => setDescription(event.target.value)} />
        </Field>
      </div>
      <UploadProgress state={state} />
    </CrmDialog>
  );
}

/** Tải lên phiên bản mới của một tài liệu; lý do thay đổi là bắt buộc. */
export function NewVersionDialog({
  document,
  onClose,
  onUploaded,
}: {
  document: CrmDocument;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [file, setFile] = useState<File>();
  const [changeNote, setChangeNote] = useState('');
  const [formError, setFormError] = useState<string>();
  const [state, dispatch] = useReducer(uploadReducer, UPLOAD_IDLE);
  const busy = isUploadBusy(state);

  async function submit() {
    if (!file) return setFormError('Chọn file của phiên bản mới.');
    if (!changeNote.trim()) return setFormError('Nhập lý do có phiên bản mới.');
    setFormError(undefined);
    const result = await runUpload(file, {
      dispatch,
      requestTicket: async (meta) => {
        const ticket = await createDocumentVersion(document.id, { ...meta, changeNote: changeNote.trim() });
        return { uploadUrl: ticket.uploadUrl, versionId: ticket.version.id, documentId: document.id };
      },
      put: putFileToSignedUrl,
      complete: (documentId, versionId, sizeBytes) => completeDocumentUpload(documentId, versionId, { sizeBytes }),
    });
    if (result) {
      toast.success('Đã tải phiên bản mới lên.');
      onUploaded();
    }
  }

  return (
    <CrmDialog
      open
      title="Phiên bản mới"
      subtitle={document.name}
      submitLabel="Tải lên"
      submitting={busy}
      error={formError ?? (state.phase === 'error' ? state.error : undefined)}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <div className={local.dropZone}>
        <input
          type="file"
          aria-label="Chọn file phiên bản mới"
          disabled={busy}
          onChange={(event) => {
            setFile(event.target.files?.[0]);
            dispatch({ type: 'reset' });
          }}
        />
        {file ? <span className={styles.muted}>{file.name} · {formatBytes(file.size)}</span> : null}
      </div>
      <Field label="Lý do thay đổi" required wide>
        <textarea className={styles.textarea} rows={2} maxLength={500} value={changeNote} disabled={busy} onChange={(event) => setChangeNote(event.target.value)} />
      </Field>
      <UploadProgress state={state} />
    </CrmDialog>
  );
}

/** Tạo thư mục (tối đa 5 cấp, máy chủ kiểm). */
export function FolderDialog({
  entityType,
  entityId,
  parentId,
  folderChoices,
  onClose,
  onCreated,
}: {
  entityType: CrmDocumentEntityType;
  entityId: string;
  parentId: string | null;
  folderChoices: readonly FolderOption[];
  onClose: () => void;
  onCreated: (folder: CrmDocumentFolder) => void;
}) {
  const [name, setName] = useState('');
  const [parent, setParent] = useState(parentId ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    if (!name.trim()) return setError('Nhập tên thư mục.');
    setSubmitting(true);
    try {
      onCreated(await createDocumentFolder({ entityType, entityId, parentId: parent || null, name: name.trim() }));
    } catch (cause) {
      setError(errorMessage(cause, 'Không tạo được thư mục.'));
      setSubmitting(false);
    }
  }

  return (
    <CrmDialog open title="Thư mục mới" submitLabel="Tạo" submitting={submitting} error={error} onClose={onClose} onSubmit={() => void submit()}>
      <Field label="Tên thư mục" required>
        <input className={styles.input} value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="Nằm trong">
        <SearchableSelect options={[...folderChoices]} value={parent} placeholder="Thư mục gốc" clearable emptyText="Không có thư mục phù hợp" onChange={setParent} />
      </Field>
    </CrmDialog>
  );
}

/** Danh sách phiên bản của một tài liệu, mới nhất trước; tải xuống từng bản. */
export function VersionList({ detail }: { detail: CrmDocumentDetail }) {
  const { people } = useCrm();
  const done = detail.versions.filter((version) => version.uploadedAt);
  if (done.length === 0) return <p className={styles.muted}>Chưa có phiên bản nào được xác nhận.</p>;
  return (
    <ul className={local.versionList}>
      {done.map((version) => (
        <li key={version.id} className={local.versionItem}>
          <div>
            <div className={local.fileName}>
              <strong>Bản {version.versionNo}</strong> · {version.fileName} · {formatBytes(version.sizeBytes)}
            </div>
            <div className={styles.muted}>
              {formatDateTime(version.uploadedAt as string)} · {personName(people, version.createdBy)}
              {version.changeNote ? ` · ${version.changeNote}` : ''}
            </div>
          </div>
          <button type="button" className={styles.rowAction} onClick={() => void openDownload(detail.id, version.versionNo)}>
            Tải xuống
          </button>
        </li>
      ))}
    </ul>
  );
}
