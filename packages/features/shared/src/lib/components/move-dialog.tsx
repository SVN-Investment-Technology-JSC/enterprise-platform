'use client';

import type {
  SharedDocumentSummary,
  SharedFolder,
  SharedTrashItem,
  SharedTrashRestoreResult,
} from '@enterprise-platform/contracts-shared';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { useEffect, useMemo, useState } from 'react';
import { branchIds } from '../library.model';
import * as api from '../shared-api';
import { Dialog, SelectField } from './dialog';
import { folderOptions } from './record-fields';

const ROOT = '__root__';

/** Cái được chuyển: tài liệu, thư mục, hay một mục Thùng rác cần chỗ khác để khôi phục. */
export type MoveTarget =
  | { readonly kind: 'document'; readonly document: SharedDocumentSummary }
  | { readonly kind: 'folder'; readonly folder: SharedFolder }
  | { readonly kind: 'restore'; readonly item: SharedTrashItem };

export interface MoveDialogProps {
  readonly target?: MoveTarget;
  readonly folders: readonly SharedFolder[];
  /** Chuyển thư mục là việc của quản trị kho; họ mới được chọn gốc kho làm chỗ đến. */
  readonly canManage: boolean;
  /** Thư mục được chọn làm chỗ đến: có quyền ghi (chuyển tài liệu) hay quyền xoá (khôi phục). */
  readonly allowed: (folder: SharedFolder, target: MoveTarget) => boolean;
  readonly onClose: () => void;
  /** `restored` chỉ có khi khôi phục; tên có thể đã được thêm hậu tố vì trùng. */
  readonly onDone: (restored?: SharedTrashRestoreResult) => void;
}

function nameOf(target: MoveTarget): string {
  if (target.kind === 'document') return target.document.name;
  if (target.kind === 'folder') return target.folder.name;
  return target.item.name;
}

/** Chọn thư mục đích: để chuyển tài liệu, chuyển thư mục, hay khôi phục khi chỗ cũ không còn. */
export function MoveDialog({ target, folders, canManage, allowed, onClose, onDone }: MoveDialogProps) {
  const [destination, setDestination] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!target) return;
    setDestination('');
    setSubmitting(false);
    setError(undefined);
  }, [target]);

  const options = useMemo(() => {
    if (!target) return [];
    const pick = (folder: SharedFolder) => allowed(folder, target);
    if (target.kind === 'folder') {
      // Không chuyển vào chính nó hay thư mục con của nó, và bỏ chỗ đang nằm.
      const exclude = branchIds(folders, target.folder.id);
      if (target.folder.parentId) exclude.add(target.folder.parentId);
      const list = folderOptions(folders, exclude, pick);
      return target.folder.parentId && canManage ? [{ value: ROOT, label: 'Tài liệu công ty (gốc)' }, ...list] : list;
    }
    const exclude = new Set<string>(target.kind === 'document' ? [target.document.folderId] : []);
    return folderOptions(folders, exclude, pick);
  }, [target, folders, canManage, allowed]);

  if (!target) return null;

  const restoring = target.kind === 'restore';

  const submit = async () => {
    setSubmitting(true);
    setError(undefined);
    try {
      if (target.kind === 'document') {
        await api.updateDocument(target.document.id, { folderId: destination });
        onDone();
      } else if (target.kind === 'folder') {
        await api.updateFolder(target.folder.id, { parentId: destination === ROOT ? null : destination });
        onDone();
      } else {
        onDone(await api.restoreFromTrash(target.item, { targetFolderId: destination }));
      }
      onClose();
    } catch (cause) {
      setError(api.errorMessage(cause, restoring ? 'Không khôi phục được.' : 'Không chuyển được.'));
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      title={`${restoring ? 'Khôi phục vào thư mục' : 'Di chuyển tới thư mục'} — ${nameOf(target)}`}
      submitLabel={restoring ? 'Khôi phục' : 'Chuyển'}
      submitting={submitting}
      submitDisabled={!destination}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <SelectField label="Thư mục đích" required>
        <SearchableSelect
          options={options}
          value={destination}
          clearable={false}
          placeholder="Chọn thư mục"
          onChange={setDestination}
        />
      </SelectField>
    </Dialog>
  );
}
