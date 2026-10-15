'use client';

import type {
  SharedConfidentiality,
  SharedDocumentSummary,
  SharedFolder,
} from '@enterprise-platform/contracts-shared';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { useEffect, useMemo, useState } from 'react';
import { parseTags } from '../library.model';
import * as api from '../shared-api';
import styles from '../shared.module.scss';
import { Dialog, Field, SelectField } from './dialog';
import { folderOptions, recordDraft, RecordFields, recordPayload, type RecordDraft } from './record-fields';
import { CONFIDENTIALITY_OPTIONS } from './upload-dialog';

export interface DocumentDialogProps {
  readonly target?: SharedDocumentSummary;
  readonly folders: readonly SharedFolder[];
  readonly onClose: () => void;
  readonly onSaved: (document: SharedDocumentSummary) => void;
}

/** Sửa thông tin tài liệu, kể cả chuyển sang thư mục khác. Tệp không đổi. */
export function DocumentDialog({ target, folders, onClose, onSaved }: DocumentDialogProps) {
  const [name, setName] = useState('');
  const [folderId, setFolderId] = useState('');
  const [description, setDescription] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [confidentiality, setConfidentiality] = useState<SharedConfidentiality>('internal');
  const [tags, setTags] = useState('');
  const [record, setRecord] = useState<RecordDraft>(recordDraft());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!target) return;
    setName(target.name);
    setFolderId(target.folderId);
    setDescription(target.description ?? '');
    setEffectiveFrom(target.effectiveFrom ?? '');
    setConfidentiality(target.confidentiality);
    setTags(target.tags.join(', '));
    setRecord(recordDraft(target));
    setSubmitting(false);
    setError(undefined);
  }, [target]);

  const options = useMemo(() => folderOptions(folders), [folders]);

  const submit = async () => {
    if (!target) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const saved = await api.updateDocument(target.id, {
        name: name.trim(),
        description: description.trim(),
        effectiveFrom,
        confidentiality,
        tags: parseTags(tags),
        ...recordPayload(record),
        ...(folderId !== target.folderId ? { folderId } : {}),
      });
      onSaved(saved);
      onClose();
    } catch (cause) {
      setError(api.errorMessage(cause, 'Không lưu được thông tin tài liệu.'));
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={Boolean(target)}
      title="Thông tin tài liệu"
      submitting={submitting}
      submitDisabled={!name.trim() || !folderId}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field label="Tên tài liệu" required>
        <input value={name} maxLength={255} onChange={(event) => setName(event.target.value)} />
      </Field>
      <SelectField label="Thư mục" required>
        <SearchableSelect clearable={false} options={options} value={folderId} onChange={setFolderId} />
      </SelectField>
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
        <textarea rows={3} value={description} maxLength={4000} onChange={(event) => setDescription(event.target.value)} />
      </Field>
    </Dialog>
  );
}
