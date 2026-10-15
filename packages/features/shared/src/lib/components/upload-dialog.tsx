'use client';

import {
  formatBytes,
  SHARED_ALLOWED_CONTENT_TYPES,
  SHARED_CONFIDENTIALITY_LABELS,
  SHARED_CONFIDENTIALITY_LEVELS,
  SHARED_DOCUMENT_MAX_BYTES,
  type SharedConfidentiality,
  type SharedFolder,
} from '@enterprise-platform/contracts-shared';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { useEffect, useMemo, useState } from 'react';
import { nameFromFile, parseTags } from '../library.model';
import * as api from '../shared-api';
import styles from '../shared.module.scss';
import { Dialog, Field, SelectField } from './dialog';
import { folderOptions, recordDraft, RecordFields, recordPayload, type RecordDraft } from './record-fields';

export const CONFIDENTIALITY_OPTIONS = SHARED_CONFIDENTIALITY_LEVELS.map((level) => ({
  value: level,
  label: SHARED_CONFIDENTIALITY_LABELS[level],
}));

/** Ô chọn tệp nhận cả phần mở rộng, vì Windows hay để trống kiểu của .dwg, .rar. */
export const FILE_ACCEPT = [
  ...SHARED_ALLOWED_CONTENT_TYPES,
  '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.rtf,.zip,.rar,.dwg,.csv,.txt,.jpg,.jpeg,.png,.gif,.webp',
].join(',');

export interface UploadDialogProps {
  readonly open: boolean;
  readonly folders: readonly SharedFolder[];
  readonly defaultFolderId?: string;
  readonly onClose: () => void;
  /** Gọi sau mỗi lượt có ít nhất một tệp lên xong; `documentId` là tệp cuối. */
  readonly onUploaded: (documentId: string, folderId: string) => void;
}

/**
 * Tải một hay nhiều tệp vào một thư mục. Nhiều tệp thì mỗi tệp thành một tài
 * liệu mang tên tệp; thông tin hồ sơ nhập ở đây áp cho tất cả.
 */
export function UploadDialog({ open, folders, defaultFolderId, onClose, onUploaded }: UploadDialogProps) {
  const [folderId, setFolderId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [confidentiality, setConfidentiality] = useState<SharedConfidentiality>('internal');
  const [tags, setTags] = useState('');
  const [record, setRecord] = useState<RecordDraft>(recordDraft());
  const [progress, setProgress] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setFolderId(defaultFolderId ?? '');
    setFiles([]);
    setName('');
    setDescription('');
    setEffectiveFrom('');
    setConfidentiality('internal');
    setTags('');
    setRecord(recordDraft());
    setProgress(undefined);
    setSubmitting(false);
    setError(undefined);
  }, [open, defaultFolderId]);

  const options = useMemo(() => folderOptions(folders), [folders]);
  const tooLarge = files.find((file) => file.size > SHARED_DOCUMENT_MAX_BYTES);
  const single = files.length === 1;

  const pickFiles = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    setFiles(picked);
    if (picked.length === 1 && !name.trim()) setName(nameFromFile(picked[0].name));
  };

  const submit = async () => {
    setSubmitting(true);
    setError(undefined);
    let lastId: string | undefined;
    try {
      for (const [index, file] of files.entries()) {
        if (files.length > 1) setProgress(`${index + 1} / ${files.length} · ${file.name}`);
        const created = await api.uploadDocument(
          {
            folderId,
            name: single ? name.trim() : nameFromFile(file.name),
            description: description.trim() || undefined,
            effectiveFrom: effectiveFrom || undefined,
            confidentiality,
            tags: parseTags(tags),
            ...recordPayload(record),
          },
          file,
        );
        lastId = created.document.id;
      }
      if (lastId) onUploaded(lastId, folderId);
      onClose();
    } catch (cause) {
      // Tệp đã lên trước đó vẫn giữ; báo lại danh sách để người dùng biết dừng ở đâu.
      if (lastId) onUploaded(lastId, folderId);
      setError(api.errorMessage(cause, 'Không tải tài liệu lên được.'));
      setSubmitting(false);
      setProgress(undefined);
    }
  };

  return (
    <Dialog
      open={open}
      title="Tải tài liệu lên"
      submitLabel={files.length > 1 ? `Tải lên ${files.length} tệp` : 'Tải lên'}
      submitting={submitting}
      submitDisabled={!folderId || files.length === 0 || Boolean(tooLarge) || (single && !name.trim())}
      error={
        error ??
        (tooLarge
          ? `${tooLarge.name} vượt quá ${formatBytes(SHARED_DOCUMENT_MAX_BYTES)}.`
          : undefined)
      }
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <SelectField label="Thư mục" required>
        <SearchableSelect clearable={false} options={options} value={folderId} placeholder="Chọn thư mục" onChange={setFolderId} />
      </SelectField>
      <Field label="Tệp" required>
        <input type="file" multiple accept={FILE_ACCEPT} onChange={(event) => pickFiles(event.target.files)} />
      </Field>
      {files.length > 1 ? (
        <ul className={styles.fileList}>
          {files.map((file) => (
            <li key={`${file.name}-${file.size}`}>
              {file.name} · {formatBytes(file.size)}
            </li>
          ))}
        </ul>
      ) : null}
      {single ? (
        <Field label="Tên tài liệu" required>
          <input value={name} maxLength={255} onChange={(event) => setName(event.target.value)} />
        </Field>
      ) : null}
      <RecordFields draft={record} onChange={setRecord} />
      <div className={styles.fieldRow}>
        <Field label="Hiệu lực từ">
          <input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} />
        </Field>
        <SelectField label="Độ mật">
          <SearchableSelect
            options={CONFIDENTIALITY_OPTIONS}
            value={confidentiality}
            clearable={false}
            onChange={(value) => setConfidentiality((value || 'internal') as SharedConfidentiality)}
          />
        </SelectField>
      </div>
      <Field label="Thẻ">
        <input value={tags} onChange={(event) => setTags(event.target.value)} />
      </Field>
      <Field label="Mô tả">
        <textarea rows={2} value={description} maxLength={4000} onChange={(event) => setDescription(event.target.value)} />
      </Field>
      {progress ? <p className={styles.muted}>{progress}</p> : null}
    </Dialog>
  );
}
