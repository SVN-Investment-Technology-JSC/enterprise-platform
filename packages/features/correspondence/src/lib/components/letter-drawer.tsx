'use client';

import {
  ATTACHMENT_KIND_LABELS,
  LETTER_CONFIDENTIALITY_LABELS,
  LETTER_FLOW_LABELS,
  LETTER_KIND_LABELS,
  LETTER_URGENCY_LABELS,
  stageIndex,
  type AttachmentKind,
  type CorrespondenceDirectory,
  type LetterAssignment,
  type LetterAttachment,
  type LetterDetail,
} from '@enterprise-platform/contracts-correspondence';
import { CloseGuard, formatDateTime, Popconfirm, toast } from '@enterprise-platform/shared-ui';
import { Check, Download, Eye, Pencil, Trash2, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  deleteAttachment,
  errorMessage,
  loadLetter,
  openAttachment,
  respondLetter,
  uploadAttachment,
} from '../correspondence-api';
import { dueText, formatBytes, formatDay, isPreviewable, localToday, stageLabel, stageTone, urgencyTone } from '../correspondence.model';
import styles from '../correspondence.module.scss';
import { EditLetterDialog } from './edit-letter-dialog';
import { LetterActionPanel } from './letter-actions';

/**
 * Ngăn chi tiết một công văn, trượt từ cạnh phải. Có ô nhập liệu (ý kiến, phản hồi) nên
 * bấm ra ngoài không đóng; nút Đóng và Esc hỏi lại khi đang nhập dở.
 */
export function LetterDrawer({
  letterId,
  directory,
  onClose,
  onChanged,
}: {
  readonly letterId: string;
  readonly directory?: CorrespondenceDirectory;
  readonly onClose: () => void;
  /** Công văn vừa đổi (bước, tệp): danh sách và tổng quan tải lại. */
  readonly onChanged: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [letter, setLetter] = useState<LetterDetail>();
  const [error, setError] = useState<string>();
  const [actionDirty, setActionDirty] = useState(false);
  const [responseDirty, setResponseDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const dirty = actionDirty || responseDirty;

  useEffect(() => setMounted(true), []);

  const reload = useCallback(() => {
    loadLetter(letterId)
      .then((next) => {
        setLetter(next);
        setError(undefined);
      })
      .catch((cause) => setError(errorMessage(cause, 'Không tải được công văn.')));
  }, [letterId]);

  useEffect(() => {
    setLetter(undefined);
    reload();
  }, [reload]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !dirty && !editing) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, editing, onClose]);

  const applied = useCallback(
    (next: LetterDetail, message: string) => {
      setLetter(next);
      setActionDirty(false);
      setResponseDirty(false);
      toast.success(message);
      onChanged();
    },
    [onChanged],
  );

  if (!mounted) return null;
  const today = localToday();
  const current = letter ? stageIndex(letter.stage) : -1;
  const due = letter ? dueText(letter, today) : undefined;
  const tag = (tone: string, label: string) => <span className={`${styles.tag} ${styles[`tone-${tone}`]}`}>{label}</span>;

  return createPortal(
    <div className={styles.overlay} role="presentation">
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label="Chi tiết công văn">
        <header className={styles.drawerHead}>
          <div style={{ minWidth: 0 }}>
            {letter ? (
              <>
                <div className={styles.drawerTags}>
                  {tag('neutral', `Số đến ${letter.incomingNo}`)}
                  {tag(stageTone(letter.stage), stageLabel(letter.stage))}
                  {letter.urgency !== 'normal' ? tag(urgencyTone(letter.urgency), LETTER_URGENCY_LABELS[letter.urgency]) : null}
                  {letter.confidentiality === 'confidential' ? tag('danger', 'Mật') : null}
                </div>
                <h1>{letter.subject}</h1>
                <p className={styles.muted} style={{ margin: 0 }}>
                  {letter.senderOrg}
                  {letter.senderRef ? ` · ${letter.senderRef}` : ''}
                </p>
              </>
            ) : (
              <p className={styles.muted}>{error ?? 'Đang tải…'}</p>
            )}
          </div>
          <div className={styles.headActions}>
            {letter?.actions.edit ? (
              <button type="button" className={styles.buttonSmall} onClick={() => setEditing(true)}>
                <Pencil size={13} /> Sửa thông tin
              </button>
            ) : null}
            <CloseGuard dirty={dirty} onClose={onClose}>
              <button type="button" className={styles.iconButton} aria-label="Đóng">
                <X size={16} />
              </button>
            </CloseGuard>
          </div>
        </header>

        {error && letter ? (
          <p role="alert" className={styles.alert}>
            {error}
          </p>
        ) : null}

        {letter ? (
          <>
            {letter.stage !== 'cancelled' ? (
              <ol className={styles.steps} aria-label="Tiến trình xử lý">
                {LETTER_FLOW_LABELS.map((label, index) => {
                  const done = index < current;
                  const active = index === current;
                  return (
                    <li
                      key={label}
                      className={`${styles.step} ${done ? styles.stepDone : ''} ${active ? styles.stepCurrent : ''}`}
                      aria-current={active ? 'step' : undefined}
                      style={{ listStyle: 'none' }}
                    >
                      <i>{done ? <Check size={12} /> : index + 1}</i>
                      {label}
                    </li>
                  );
                })}
              </ol>
            ) : null}

            <section className={`${styles.card} ${styles.meta}`}>
              <div>
                <span>Ngày đến</span>
                {formatDay(letter.receivedOn)}
              </div>
              <div>
                <span>Hạn xử lý</span>
                {formatDay(letter.dueOn) || 'Không đặt'}
                {due ? <span className={`${styles.hint} ${styles[`hint-${due.tone}`] ?? ''}`}>{due.text}</span> : null}
              </div>
              <div>
                <span>Loại văn bản</span>
                {LETTER_KIND_LABELS[letter.kind]}
              </div>
              <div>
                <span>Độ khẩn · Độ mật</span>
                {LETTER_URGENCY_LABELS[letter.urgency]} · {LETTER_CONFIDENTIALITY_LABELS[letter.confidentiality]}
              </div>
              <div>
                <span>Ngày văn bản</span>
                {formatDay(letter.senderDate) || 'Không ghi'}
              </div>
              <div>
                <span>Văn thư tiếp nhận</span>
                {letter.receivedByName ?? 'Không rõ'}
              </div>
              {letter.leaderUserId ? (
                <div>
                  <span>Lãnh đạo phụ trách</span>
                  {letter.leaderName ?? 'Không rõ'}
                </div>
              ) : null}
              {letter.outgoingNo ? (
                <div>
                  <span>Số phát hành</span>
                  {letter.outgoingNo} · {formatDay(letter.publishedOn)} · {letter.recipient}
                </div>
              ) : null}
              {letter.archiveCode ? (
                <div>
                  <span>Số hồ sơ lưu trữ</span>
                  {letter.archiveCode}
                </div>
              ) : null}
              {letter.instruction ? (
                <div className={styles.metaWide}>
                  <span>Ý kiến chỉ đạo</span>
                  {letter.instruction}
                </div>
              ) : null}
              {letter.approvalNote ? (
                <div className={styles.metaWide}>
                  <span>Ý kiến duyệt</span>
                  {letter.approvalNote}
                </div>
              ) : null}
            </section>

            <LetterActionPanel letter={letter} directory={directory} onDone={applied} onDirtyChange={setActionDirty} />

            {letter.assignments.length > 0 ? (
              <AssignmentsSection letter={letter} onDone={applied} onDirtyChange={setResponseDirty} onFilesChanged={reload} />
            ) : null}

            <AttachmentsSection letter={letter} onChanged={() => { reload(); onChanged(); }} />

            <section className={styles.card}>
              <h2>Lịch sử xử lý</h2>
              <ol className={styles.log}>
                {[...letter.history].reverse().map((entry) => (
                  <li key={entry.id}>
                    <b>{entry.summary}</b>
                    <small>
                      {entry.actorName ?? (entry.actorUserId ? 'Người dùng' : 'Hệ thống')} lúc {formatDateTime(entry.at)}
                    </small>
                    {entry.note ? <p>{entry.note}</p> : null}
                  </li>
                ))}
              </ol>
            </section>

            <EditLetterDialog
              open={editing}
              letter={letter}
              onClose={() => setEditing(false)}
              onSaved={(next) => {
                setEditing(false);
                applied(next, 'Đã lưu thông tin công văn.');
              }}
            />
          </>
        ) : null}
      </aside>
    </div>,
    document.body,
  );
}

/* --------------------------------------------------------- phòng ban */

function AssignmentsSection({
  letter,
  onDone,
  onDirtyChange,
  onFilesChanged,
}: {
  readonly letter: LetterDetail;
  readonly onDone: (next: LetterDetail, message: string) => void;
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly onFilesChanged: () => void;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => onDirtyChange(Object.values(notes).some((note) => note.trim() !== '')), [notes, onDirtyChange]);

  const respond = async (assignment: LetterAssignment) => {
    setBusy(assignment.id);
    setError(undefined);
    try {
      const next = await respondLetter(letter.id, assignment.id, notes[assignment.id] ?? '');
      setNotes((current) => ({ ...current, [assignment.id]: '' }));
      onDone(next, `${assignment.unitName} đã gửi văn bản phản hồi.`);
    } catch (cause) {
      setError(errorMessage(cause, 'Không gửi được phản hồi.'));
    } finally {
      setBusy(undefined);
    }
  };

  const done = letter.assignments.filter((item) => item.status === 'submitted').length;
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>Phòng ban xử lý</h2>
        <span className={styles.muted} style={{ fontSize: 12.5 }}>
          Đã phản hồi {done}/{letter.assignments.length}
        </span>
      </div>
      <div className={styles.list}>
        {letter.assignments.map((assignment) => {
          const drafts = letter.attachments.filter((item) => item.assignmentId === assignment.id);
          return (
            <div key={assignment.id} className={styles.listRow} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div className={styles.listMain}>
                  <b>{assignment.unitName}</b>
                  {assignment.round > 1 ? <span className={styles.hint}>Lượt {assignment.round}</span> : null}
                </div>
                <span
                  className={`${styles.tag} ${styles[assignment.status === 'submitted' ? 'tone-success' : 'tone-warning']}`}
                >
                  {assignment.status === 'submitted' ? 'Đã gửi phản hồi' : 'Chờ phản hồi'}
                </span>
              </div>
              {assignment.revisionReason && assignment.status === 'pending' ? (
                <p className={styles.notice} style={{ marginTop: 8 }}>
                  Lãnh đạo yêu cầu sửa: {assignment.revisionReason}
                </p>
              ) : null}
              {assignment.responseNote ? (
                <div className={styles.listMain}>
                  <p>{assignment.responseNote}</p>
                  {assignment.submittedAt ? (
                    <span className={styles.hint}>
                      {assignment.submittedByName ?? 'Người dùng'} gửi lúc {formatDateTime(assignment.submittedAt)}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {drafts.length > 0 ? <FileRows letter={letter} files={drafts} onChanged={onFilesChanged} /> : null}
              {assignment.canRespond ? (
                <div className={styles.form}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>
                      Nội dung phản hồi của {assignment.unitName}
                      <span className={styles.required}> *</span>
                    </span>
                    <textarea
                      value={notes[assignment.id] ?? ''}
                      maxLength={4000}
                      rows={3}
                      placeholder="Tóm tắt ý kiến, số liệu hoặc nội dung dự thảo gửi lãnh đạo"
                      onChange={(event) => setNotes((current) => ({ ...current, [assignment.id]: event.target.value }))}
                    />
                  </label>
                  <div className={styles.formActions}>
                    <UploadButton
                      label="Tải dự thảo phản hồi"
                      letterId={letter.id}
                      kind="draft"
                      assignmentId={assignment.id}
                      onUploaded={onFilesChanged}
                    />
                    <button
                      type="button"
                      className={styles.buttonPrimary}
                      disabled={busy === assignment.id || !(notes[assignment.id] ?? '').trim()}
                      onClick={() => void respond(assignment)}
                    >
                      Gửi văn bản phản hồi
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}
    </section>
  );
}

/* ---------------------------------------------------------------- tệp */

const UPLOAD_KINDS: readonly AttachmentKind[] = ['incoming', 'outgoing', 'reference'];

function AttachmentsSection({ letter, onChanged }: { readonly letter: LetterDetail; readonly onChanged: () => void }) {
  const files = letter.attachments.filter((item) => item.kind !== 'draft');
  const kinds = UPLOAD_KINDS.filter((kind) => letter.actions.attachKinds.includes(kind));
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>Tệp của hồ sơ</h2>
        <span className={styles.muted} style={{ fontSize: 12.5 }}>
          Lưu tại Hệ dùng chung
        </span>
      </div>
      {files.length > 0 ? (
        <FileRows letter={letter} files={files} onChanged={onChanged} />
      ) : (
        <p className={styles.muted} style={{ margin: 0, fontSize: 13 }}>
          Chưa có tệp nào. Dự thảo của phòng ban nằm ở mục Phòng ban xử lý.
        </p>
      )}
      {kinds.length > 0 ? (
        <div className={styles.uploadBar}>
          {kinds.map((kind) => (
            <UploadButton key={kind} label={`Tải lên ${ATTACHMENT_KIND_LABELS[kind].toLowerCase()}`} letterId={letter.id} kind={kind} onUploaded={onChanged} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function FileRows({
  letter,
  files,
  onChanged,
}: {
  readonly letter: LetterDetail;
  readonly files: readonly LetterAttachment[];
  readonly onChanged: () => void;
}) {
  const open = (file: LetterAttachment, mode: 'preview' | 'download') =>
    openAttachment(letter.id, file.id, mode).catch((cause) => toast.error(errorMessage(cause, 'Không mở được tệp.')));
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
      {files.map((file) => (
        <div key={file.id} className={styles.listRow}>
          <div className={styles.listMain}>
            <b>{file.fileName}</b>
            <span className={styles.hint}>
              {ATTACHMENT_KIND_LABELS[file.kind]} · {formatBytes(file.sizeBytes)} · {file.uploadedByName ?? 'Người dùng'} ·{' '}
              {formatDateTime(file.createdAt)}
            </span>
          </div>
          <div className={styles.listActions}>
            {file.sizeBytes !== undefined && isPreviewable(file.contentType) ? (
              <button type="button" className={styles.buttonSmall} onClick={() => void open(file, 'preview')}>
                <Eye size={13} /> Xem
              </button>
            ) : null}
            {file.sizeBytes !== undefined ? (
              <button type="button" className={styles.buttonSmall} onClick={() => void open(file, 'download')}>
                <Download size={13} /> Tải về
              </button>
            ) : null}
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
      ))}
    </div>
  );
}

function UploadButton({
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
