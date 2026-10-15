'use client';

import {
  formatBytes,
  SHARED_DOCUMENT_MAX_BYTES,
  type SharedDocumentSummary,
} from '@enterprise-platform/contracts-shared';
import { useEffect, useState } from 'react';
import * as api from '../shared-api';
import { Dialog, Field } from './dialog';
import { FILE_ACCEPT } from './upload-dialog';

export interface VersionDialogProps {
  readonly target?: SharedDocumentSummary;
  readonly onClose: () => void;
  readonly onUploaded: () => void;
}

/** Tải phiên bản mới; phiên bản cũ giữ nguyên, không ghi đè. */
export function VersionDialog({ target, onClose, onUploaded }: VersionDialogProps) {
  const [file, setFile] = useState<File>();
  const [changeNote, setChangeNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!target) return;
    setFile(undefined);
    setChangeNote('');
    setSubmitting(false);
    setError(undefined);
  }, [target]);

  const tooLarge = file && file.size > SHARED_DOCUMENT_MAX_BYTES;

  const submit = async () => {
    if (!target || !file) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await api.uploadVersion(target.id, file, changeNote.trim());
      onUploaded();
      onClose();
    } catch (cause) {
      setError(api.errorMessage(cause, 'Không tải được phiên bản mới.'));
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={Boolean(target)}
      title={`Phiên bản mới — ${target?.name ?? ''}`}
      submitLabel="Tải lên phiên bản"
      submitting={submitting}
      submitDisabled={!file || !changeNote.trim() || Boolean(tooLarge)}
      error={error ?? (tooLarge ? `Tệp vượt quá ${formatBytes(SHARED_DOCUMENT_MAX_BYTES)}.` : undefined)}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field label="Tệp" required>
        <input type="file" accept={FILE_ACCEPT} onChange={(event) => setFile(event.target.files?.[0])} />
      </Field>
      <Field label="Nội dung thay đổi" required>
        <textarea
          rows={3}
          value={changeNote}
          maxLength={1000}
          onChange={(event) => setChangeNote(event.target.value)}
        />
      </Field>
    </Dialog>
  );
}
