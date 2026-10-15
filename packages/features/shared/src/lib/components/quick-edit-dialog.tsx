'use client';

import type { SharedDocumentSummary, SharedFolder } from '@enterprise-platform/contracts-shared';
import { useEffect, useState } from 'react';
import { parseTags } from '../library.model';
import * as api from '../shared-api';
import styles from '../shared.module.scss';
import { Dialog, Field } from './dialog';

export type QuickEditField = 'name' | 'description' | 'tags' | 'validity';

/** Một trường của tài liệu hay thư mục, sửa riêng lẻ từ menu chuột phải. */
export type QuickEditTarget =
  | { readonly kind: 'document'; readonly field: QuickEditField; readonly document: SharedDocumentSummary }
  | { readonly kind: 'folder'; readonly field: 'name' | 'description'; readonly folder: SharedFolder };

const TITLES: Readonly<Record<QuickEditField, string>> = {
  name: 'Thay đổi tên',
  description: 'Cập nhật mô tả',
  tags: 'Thẻ',
  validity: 'Quản lý hiệu lực',
};

export interface QuickEditDialogProps {
  readonly target?: QuickEditTarget;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

function initialText(target: QuickEditTarget): string {
  if (target.kind === 'folder') return target.field === 'name' ? target.folder.name : (target.folder.note ?? '');
  const { document } = target;
  if (target.field === 'name') return document.name;
  if (target.field === 'description') return document.description ?? '';
  if (target.field === 'tags') return document.tags.join(', ');
  return '';
}

/** Giá trị đang nhập còn giống giá trị cũ: không có gì để lưu. */
function isUnchanged(
  target: QuickEditTarget,
  draft: { text: string; effectiveFrom: string; effectiveTo: string },
): boolean {
  if (target.field === 'validity') {
    return (
      target.kind === 'document' &&
      draft.effectiveFrom === (target.document.effectiveFrom ?? '') &&
      draft.effectiveTo === (target.document.effectiveTo ?? '')
    );
  }
  if (target.field === 'tags') {
    return target.kind === 'document' && JSON.stringify(parseTags(draft.text)) === JSON.stringify(target.document.tags);
  }
  return draft.text.trim() === initialText(target).trim();
}

/**
 * Sửa một trường: đổi tên, mô tả, thẻ hay hiệu lực. Chỉ gửi đúng trường đó —
 * những trường còn lại server giữ nguyên.
 */
export function QuickEditDialog({ target, onClose, onSaved }: QuickEditDialogProps) {
  const [text, setText] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!target) return;
    setText(initialText(target));
    setEffectiveFrom(target.kind === 'document' ? (target.document.effectiveFrom ?? '') : '');
    setEffectiveTo(target.kind === 'document' ? (target.document.effectiveTo ?? '') : '');
    setSubmitting(false);
    setError(undefined);
  }, [target]);

  if (!target) return null;

  const subject = target.kind === 'document' ? target.document.name : target.folder.name;
  const validity = target.field === 'validity';
  const required = target.field === 'name';
  const unchanged = isUnchanged(target, { text, effectiveFrom, effectiveTo });
  const misordered = validity && Boolean(effectiveFrom && effectiveTo && effectiveTo < effectiveFrom);

  const submit = async () => {
    setSubmitting(true);
    setError(undefined);
    try {
      if (target.kind === 'folder') {
        await api.updateFolder(target.folder.id, target.field === 'name' ? { name: text.trim() } : { note: text.trim() });
      } else if (target.field === 'name') {
        await api.updateDocument(target.document.id, { name: text.trim() });
      } else if (target.field === 'description') {
        await api.updateDocument(target.document.id, { description: text.trim() });
      } else if (target.field === 'tags') {
        await api.updateDocument(target.document.id, { tags: parseTags(text) });
      } else {
        await api.updateDocument(target.document.id, { effectiveFrom, effectiveTo });
      }
      onSaved();
      onClose();
    } catch (cause) {
      setError(api.errorMessage(cause, 'Không lưu được thay đổi.'));
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      title={`${TITLES[target.field]} — ${subject}`}
      submitting={submitting}
      submitDisabled={unchanged || misordered || (required && !text.trim())}
      error={error ?? (misordered ? 'Hiệu lực đến phải sau hiệu lực từ.' : undefined)}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      {validity ? (
        <div className={styles.fieldRow}>
          <Field label="Hiệu lực từ">
            <input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} />
          </Field>
          <Field label="Hiệu lực đến">
            <input type="date" value={effectiveTo} onChange={(event) => setEffectiveTo(event.target.value)} />
          </Field>
        </div>
      ) : target.field === 'description' ? (
        <Field label={target.kind === 'folder' ? 'Ghi chú' : 'Mô tả'}>
          <textarea
            rows={4}
            value={text}
            autoFocus
            maxLength={target.kind === 'folder' ? 2000 : 4000}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
      ) : target.field === 'tags' ? (
        <Field label="Thẻ">
          <input value={text} autoFocus onChange={(event) => setText(event.target.value)} />
        </Field>
      ) : (
        <Field label={target.kind === 'folder' ? 'Tên thư mục' : 'Tên tài liệu'} required>
          <input
            value={text}
            autoFocus
            maxLength={target.kind === 'folder' ? 180 : 255}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
      )}
    </Dialog>
  );
}
