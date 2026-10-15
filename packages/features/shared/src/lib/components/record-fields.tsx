'use client';

import {
  SHARED_DOCUMENT_KINDS,
  SHARED_DOCUMENT_KIND_LABELS,
  type SharedDocumentKind,
  type SharedFolder,
  type SharedRecordMeta,
} from '@enterprise-platform/contracts-shared';
import { SearchableSelect, type SearchableSelectOption } from '@enterprise-platform/shared-ui';
import { folderLabel } from '../library.model';
import styles from '../shared.module.scss';
import { Field } from './dialog';

/** Thông tin hồ sơ đang nhập: chuỗi rỗng là bỏ trống. */
export interface RecordDraft {
  docKind: SharedDocumentKind | '';
  docNumber: string;
  partner: string;
  issuedOn: string;
  effectiveTo: string;
}

export const KIND_OPTIONS: readonly SearchableSelectOption[] = SHARED_DOCUMENT_KINDS.map((kind) => ({
  value: kind,
  label: SHARED_DOCUMENT_KIND_LABELS[kind],
}));

export function recordDraft(meta?: SharedRecordMeta): RecordDraft {
  return {
    docKind: meta?.docKind ?? '',
    docNumber: meta?.docNumber ?? '',
    partner: meta?.partner ?? '',
    issuedOn: meta?.issuedOn ?? '',
    effectiveTo: meta?.effectiveTo ?? '',
  };
}

/** Bản nháp → thân yêu cầu. Trường trống gửi chuỗi rỗng để server xoá giá trị cũ. */
export function recordPayload(draft: RecordDraft): SharedRecordMeta {
  return {
    // Chuỗi rỗng (không phải `undefined`) thì server mới xoá loại cũ.
    docKind: draft.docKind as SharedDocumentKind,
    docNumber: draft.docNumber.trim(),
    partner: draft.partner.trim(),
    issuedOn: draft.issuedOn,
    effectiveTo: draft.effectiveTo,
  };
}

/** Ô chọn thư mục, nhãn là cả đường dẫn để phân biệt thư mục trùng tên. */
export function folderOptions(
  folders: readonly SharedFolder[],
  exclude: ReadonlySet<string> = new Set(),
): SearchableSelectOption[] {
  return folders
    .filter((folder) => !exclude.has(folder.id))
    .map((folder) => ({ value: folder.id, label: folderLabel(folders, folder.id) }));
}

export function RecordFields({
  draft,
  onChange,
  issuedLabel = 'Ngày ký, ban hành',
}: {
  readonly draft: RecordDraft;
  readonly onChange: (next: RecordDraft) => void;
  readonly issuedLabel?: string;
}) {
  const set = <K extends keyof RecordDraft>(key: K, value: RecordDraft[K]) =>
    onChange({ ...draft, [key]: value });
  return (
    <>
      <div className={styles.fieldRow}>
        <Field label="Loại hồ sơ">
          <SearchableSelect
            options={KIND_OPTIONS}
            value={draft.docKind}
            placeholder="Không phân loại"
            clearable
            onChange={(value) => set('docKind', value as SharedDocumentKind | '')}
          />
        </Field>
        <Field label="Số hiệu">
          <input
            value={draft.docNumber}
            maxLength={120}
            onChange={(event) => set('docNumber', event.target.value)}
          />
        </Field>
      </div>
      <Field label="Đối tác, nơi ban hành">
        <input
          value={draft.partner}
          maxLength={240}
          onChange={(event) => set('partner', event.target.value)}
        />
      </Field>
      <div className={styles.fieldRow}>
        <Field label={issuedLabel}>
          <input
            type="date"
            value={draft.issuedOn}
            onChange={(event) => set('issuedOn', event.target.value)}
          />
        </Field>
        <Field label="Hiệu lực đến">
          <input
            type="date"
            value={draft.effectiveTo}
            onChange={(event) => set('effectiveTo', event.target.value)}
          />
        </Field>
      </div>
    </>
  );
}
