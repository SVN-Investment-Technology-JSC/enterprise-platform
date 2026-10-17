'use client';

import type { SharedFolder } from '@enterprise-platform/contracts-shared';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { useEffect, useMemo, useState } from 'react';
import { branchIds } from '../library.model';
import * as api from '../shared-api';
import { Dialog, Field, SelectField } from './dialog';
import { folderOptions, recordDraft, RecordFields, recordPayload, type RecordDraft } from './record-fields';

const ROOT = '__root__';

export interface FolderDialogProps {
  /** `undefined` là đóng; `{ folder }` là sửa, `{ parentId }` là tạo mới. */
  readonly target?: { readonly folder?: SharedFolder; readonly parentId?: string };
  readonly folders: readonly SharedFolder[];
  /** Chỉ người quản trị kho mới tạo thư mục gốc và chuyển thư mục. */
  readonly canManage: boolean;
  /** Thư mục người dùng tạo được thư mục con bên trong (quyền ghi). */
  readonly writable: (folder: SharedFolder) => boolean;
  readonly onClose: () => void;
  readonly onSaved: (folder: SharedFolder) => void;
}

export function FolderDialog({ target, folders, canManage, writable, onClose, onSaved }: FolderDialogProps) {
  const editing = target?.folder;
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [note, setNote] = useState('');
  const [record, setRecord] = useState<RecordDraft>(recordDraft());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!target) return;
    setName(target.folder?.name ?? '');
    setParent(target.folder ? (target.folder.parentId ?? ROOT) : (target.parentId ?? (canManage ? ROOT : '')));
    setNote(target.folder?.note ?? '');
    setRecord(recordDraft(target.folder));
    setSubmitting(false);
    setError(undefined);
  }, [target, canManage]);

  const parentOptions = useMemo(() => {
    const exclude = editing ? branchIds(folders, editing.id) : new Set<string>();
    // Tạo mới: chỉ những thư mục có quyền ghi. Sửa: chỗ đặt chỉ quản trị kho đổi, giữ cả cây để hiện đúng chỗ cũ.
    const options = folderOptions(folders, exclude, editing ? undefined : writable);
    return canManage ? [{ value: ROOT, label: 'Tài liệu công ty (gốc)' }, ...options] : options;
  }, [folders, editing, canManage, writable]);

  const submit = async () => {
    setSubmitting(true);
    setError(undefined);
    const parentId = parent === ROOT ? undefined : parent;
    try {
      const saved = editing
        ? await api.updateFolder(editing.id, {
            name: name.trim(),
            note: note.trim(),
            ...recordPayload(record),
            ...(canManage && (editing.parentId ?? ROOT) !== parent ? { parentId: parentId ?? null } : {}),
          })
        : await api.createFolder({
            name: name.trim(),
            parentId,
            note: note.trim() || undefined,
            ...recordPayload(record),
          });
      onSaved(saved);
      onClose();
    } catch (cause) {
      setError(api.errorMessage(cause, 'Không lưu được thư mục.'));
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={Boolean(target)}
      title={editing ? `Sửa thư mục — ${editing.name}` : 'Thư mục mới'}
      submitLabel={editing ? 'Lưu' : 'Tạo thư mục'}
      submitting={submitting}
      submitDisabled={!name.trim() || !parent}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field label="Tên thư mục" required>
        <input value={name} maxLength={180} autoFocus onChange={(event) => setName(event.target.value)} />
      </Field>
      <SelectField label="Nằm trong" required>
        <SearchableSelect
          options={parentOptions}
          value={parent}
          clearable={false}
          placeholder="Chọn thư mục"
          disabled={Boolean(editing) && !canManage}
          onChange={setParent}
        />
      </SelectField>
      <RecordFields draft={record} onChange={setRecord} />
      <Field label="Ghi chú">
        <textarea rows={2} value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} />
      </Field>
    </Dialog>
  );
}
