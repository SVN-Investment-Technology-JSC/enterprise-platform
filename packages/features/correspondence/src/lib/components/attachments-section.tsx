'use client';

import {
  ATTACHMENT_KIND_LABELS,
  type AttachmentKind,
  type LetterAttachment,
  type LetterDetail,
} from '@enterprise-platform/contracts-correspondence';
import { formatDateTime, Popconfirm, toast } from '@enterprise-platform/shared-ui';
import { Download, Eye, FileText, History, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { deleteAttachment, downloadAttachment, errorMessage, uploadAttachment, uploadAttachmentVersion } from '../correspondence-api';
import { formatBytes, previewKind } from '../correspondence.model';
import styles from '../correspondence.module.scss';
import type { PreviewTarget } from './file-preview';

const UPLOAD_LABELS: Readonly<Record<AttachmentKind, string>> = {
  incoming: 'Tải bản quét công văn đến',
  draft: 'Tải dự thảo',
  outgoing: 'Tải bản ban hành đã ký',
  reference: 'Tải tài liệu kèm theo',
};

/** Tệp của hồ sơ (trừ kết quả của từng phòng ban, nằm ở mục Phòng ban xử lý). */
export function AttachmentsSection({
  letter,
  onPreview,
  onChanged,
}: {
  readonly letter: LetterDetail;
  readonly onPreview: (target: PreviewTarget) => void;
  readonly onChanged: () => void;
}) {
  const files = letter.attachments.filter((item) => !item.assignmentId);
  // Kết quả của phòng ban tải ở mục phòng ban; công văn đi thì dự thảo tải ở đây.
  const kinds = letter.actions.attachKinds.filter((kind) => kind !== 'draft' || letter.direction === 'outgoing');
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>Tệp của hồ sơ</h2>
        <span className={styles.muted}>
          Lưu tại Hệ dùng chung, có phiên bản
        </span>
      </div>
      {files.length > 0 ? (
        <FileRows letter={letter} files={files} onPreview={onPreview} onChanged={onChanged} />
      ) : (
        <p className={styles.sectionNote}>
          Chưa có tệp nào.
          {letter.direction === 'incoming' ? ' Kết quả xử lý của phòng ban nằm ở mục Phòng ban xử lý.' : ''}
        </p>
      )}
      {kinds.length > 0 ? (
        <div className={styles.uploadBar}>
          {kinds.map((kind) => (
            <UploadButton key={kind} label={UPLOAD_LABELS[kind]} letterId={letter.id} kind={kind} onUploaded={onChanged} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function FileRows({
  letter,
  files,
  onPreview,
  onChanged,
}: {
  readonly letter: LetterDetail;
  readonly files: readonly LetterAttachment[];
  readonly onPreview: (target: PreviewTarget) => void;
  readonly onChanged: () => void;
}) {
  const remove = async (file: LetterAttachment) => {
    try {
      await deleteAttachment(letter.id, file.id);
      toast.success(`Đã gỡ ${file.fileName}.`);
      onChanged();
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không gỡ được tệp.'));
    }
  };
  return (
    <div className={styles.list}>
      {files.map((file) => {
        const ready = file.sizeBytes !== undefined;
        const viewable = ready && previewKind(file.contentType, file.fileName) !== 'none';
        return (
          <div key={file.id} className={styles.fileRow}>
            <FileText size={18} className={styles.fileIcon} aria-hidden />
            <div className={styles.fileMain}>
              {viewable ? (
                <button type="button" className={styles.fileName} onClick={() => onPreview({ letterId: letter.id, file })}>
                  {file.fileName}
                </button>
              ) : (
                <b>{file.fileName}</b>
              )}
              <span className={styles.hint}>
                {ATTACHMENT_KIND_LABELS[file.kind]} · {file.versionNo > 1 ? `Phiên bản ${file.versionNo} · ` : ''}
                {formatBytes(file.sizeBytes)} · {file.uploadedByName ?? 'Người dùng'} · {formatDateTime(file.createdAt)}
              </span>
            </div>
            <div className={styles.listActions}>
              {ready ? (
                <button type="button" className={styles.buttonSmall} onClick={() => onPreview({ letterId: letter.id, file })}>
                  <Eye size={13} /> Xem
                </button>
              ) : null}
              {ready ? (
                <button
                  type="button"
                  className={styles.buttonSmall}
                  aria-label={`Tải ${file.fileName}`}
                  onClick={() =>
                    void downloadAttachment(letter.id, file.id).catch((cause) => toast.error(errorMessage(cause, 'Không tải được tệp.')))
                  }
                >
                  <Download size={13} />
                </button>
              ) : null}
              {file.canVersion ? <VersionButton letterId={letter.id} file={file} onUploaded={onChanged} /> : null}
              {file.canDelete ? (
                <Popconfirm
                  title="Gỡ tệp khỏi hồ sơ?"
                  description="Tệp chuyển vào Thùng rác của Hệ dùng chung, quản trị kho khôi phục được."
                  okText="Gỡ tệp"
                  okType="danger"
                  placement="left"
                  onConfirm={() => remove(file)}
                >
                  <button type="button" className={styles.buttonSmall} aria-label={`Gỡ ${file.fileName}`}>
                    <Trash2 size={13} />
                  </button>
                </Popconfirm>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function VersionButton({
  letterId,
  file,
  onUploaded,
}: {
  readonly letterId: string;
  readonly file: LetterAttachment;
  readonly onUploaded: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (picked: File | undefined) => {
    if (!picked) return;
    setBusy(true);
    try {
      const next = await uploadAttachmentVersion(letterId, file.id, picked);
      toast.success(`Đã tải phiên bản ${next.versionNo} của ${file.fileName}.`);
      onUploaded();
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không tải được phiên bản mới.'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <>
      <input ref={input} type="file" className={styles.fileInput} onChange={(event) => void upload(event.target.files?.[0])} />
      <button
        type="button"
        className={styles.buttonSmall}
        disabled={busy}
        title="Tải phiên bản mới; phiên bản cũ vẫn giữ trong kho tài liệu"
        onClick={() => input.current?.click()}
      >
        <History size={13} /> {busy ? 'Đang tải…' : 'Phiên bản mới'}
      </button>
    </>
  );
}

export function UploadButton({
  label,
  letterId,
  kind,
  assignmentId,
  onUploaded,
}: {
  readonly label: string;
  readonly letterId: string;
  readonly kind: AttachmentKind;
  readonly assignmentId?: string;
  readonly onUploaded: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (files: readonly File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    let uploaded = 0;
    for (const file of files) {
      try {
        await uploadAttachment(letterId, file, kind, assignmentId);
        uploaded += 1;
      } catch (cause) {
        toast.error(errorMessage(cause, `Không tải được tệp ${file.name}.`));
      }
    }
    setBusy(false);
    if (input.current) input.current.value = '';
    if (uploaded > 0) {
      toast.success(`Đã tải lên ${uploaded} tệp.`);
      onUploaded();
    }
  };
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        className={styles.fileInput}
        onChange={(event) => void upload(Array.from(event.target.files ?? []))}
      />
      <button type="button" className={styles.buttonGhost} disabled={busy} onClick={() => input.current?.click()}>
        <Upload size={14} /> {busy ? 'Đang tải lên…' : label}
      </button>
    </>
  );
}
