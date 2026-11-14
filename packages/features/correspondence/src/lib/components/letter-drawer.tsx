'use client';

import {
  DELIVERY_STATUS_LABELS,
  LETTER_DIRECTION_LABELS,
  type CorrespondenceConfig,
  type CorrespondenceDirectory,
  type LetterDetail,
  type LetterStep,
} from '@enterprise-platform/contracts-correspondence';
import { CloseGuard, formatDateTime, toast } from '@enterprise-platform/shared-ui';
import { CornerUpLeft, Pencil, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { errorMessage, loadLetter } from '../correspondence-api';
import { dueText, formatDay, localToday, stageTone, urgencyTone } from '../correspondence.model';
import styles from '../correspondence.module.scss';
import { AssignmentsSection } from './assignments-section';
import { AttachmentsSection } from './attachments-section';
import { CommentsSection } from './comments-section';
import { EditLetterDialog } from './edit-letter-dialog';
import { FilePreview, type PreviewTarget } from './file-preview';
import { FlowStepper } from './flow-stepper';
import { LetterActionPanel } from './letter-actions';
import { OutgoingDialog } from './outgoing-dialog';

/**
 * Ngăn chi tiết một công văn, trượt từ cạnh phải: tiến trình theo quy trình, thao tác của
 * bước hiện tại, phòng ban, ý kiến duyệt, trao đổi, tệp và lịch sử. Bấm ra ngoài, nút Đóng
 * hay Esc đều đóng; đang nhập dở thì hỏi lại trước.
 */
export function LetterDrawer({
  letterId,
  config,
  directory,
  currentUserId,
  onClose,
  onChanged,
  onOpenLetter,
}: {
  readonly letterId: string;
  readonly config: CorrespondenceConfig;
  readonly directory?: CorrespondenceDirectory;
  readonly currentUserId?: string;
  readonly onClose: () => void;
  /** Công văn vừa đổi (bước, tệp): danh sách và tổng quan tải lại. */
  readonly onChanged: () => void;
  readonly onOpenLetter: (letterId: string) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [letter, setLetter] = useState<LetterDetail>();
  const [error, setError] = useState<string>();
  const [actionDirty, setActionDirty] = useState(false);
  const [responseDirty, setResponseDirty] = useState(false);
  const [commentDirty, setCommentDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);
  const [preview, setPreview] = useState<PreviewTarget>();
  const dirty = actionDirty || responseDirty || commentDirty;
  const closeButton = useRef<HTMLButtonElement>(null);
  // Chỉ đóng khi cả lúc nhấn và lúc thả chuột đều ở vùng tối bên ngoài ngăn (kéo chọn chữ từ
  // trong ngăn ra ngoài không làm đóng). Hộp thoại con, xem trước tệp, danh sách chọn là portal
  // riêng nên bấm vào chúng không trùng vùng tối này.
  const pressedOutside = useRef(false);

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
      if (event.key === 'Escape' && !dirty && !editing && !replying && !preview) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, editing, replying, preview, onClose]);

  const applied = useCallback(
    (next: LetterDetail, message: string) => {
      setLetter(next);
      setActionDirty(false);
      setResponseDirty(false);
      setCommentDirty(false);
      toast.success(message);
      onChanged();
    },
    [onChanged],
  );
  const filesChanged = useCallback(() => {
    reload();
    onChanged();
  }, [reload, onChanged]);

  const outsideDown = (event: MouseEvent<HTMLDivElement>) => {
    pressedOutside.current = event.target === event.currentTarget;
  };
  const outsideClick = (event: MouseEvent<HTMLDivElement>) => {
    const outside = pressedOutside.current && event.target === event.currentTarget;
    pressedOutside.current = false;
    if (!outside || editing || replying || preview) return;
    // Đang nhập dở: mở hỏi xác nhận ngay tại nút X thay vì đóng mất nội dung.
    if (dirty) closeButton.current?.click();
    else onClose();
  };

  if (!mounted) return null;
  const today = localToday();
  const due = letter ? dueText(letter, today) : undefined;
  const tag = (tone: string, label: string) => <span className={`${styles.tag} ${styles[`tone-${tone}`]}`}>{label}</span>;
  const incoming = letter?.direction === 'incoming';

  return createPortal(
    <div className={styles.overlay} role="presentation" onMouseDown={outsideDown} onClick={outsideClick}>
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label="Chi tiết công văn">
        <header className={styles.drawerHead}>
          <div className={styles.drawerTitle}>
            {letter ? (
              <>
                <div className={styles.drawerTags}>
                  {tag(incoming ? 'info' : 'neutral', `${LETTER_DIRECTION_LABELS[letter.direction]} ${letter.displayNo}`)}
                  {tag(stageTone(letter.stage), letter.stageLabel)}
                  {letter.urgencyHighlight ? tag(urgencyTone(letter), letter.urgencyName) : null}
                  {letter.restricted ? tag('danger', letter.confidentialityName) : null}
                </div>
                <h1>{letter.subject}</h1>
                <p className={styles.muted} style={{ margin: 0 }}>
                  {incoming
                    ? `${letter.senderOrg}${letter.senderRef ? ` · ${letter.senderRef}` : ''}`
                    : `${letter.authorUnitName ?? letter.senderOrg} → ${letter.recipient ?? ''}`}
                </p>
              </>
            ) : (
              <p className={styles.muted}>{error ?? 'Đang tải…'}</p>
            )}
          </div>
          <div className={styles.headActions}>
            {letter?.actions.reply ? (
              <button type="button" className={styles.buttonSmall} onClick={() => setReplying(true)}>
                <CornerUpLeft size={13} /> Soạn trả lời
              </button>
            ) : null}
            {letter?.actions.edit ? (
              <button type="button" className={styles.buttonSmall} onClick={() => setEditing(true)}>
                <Pencil size={13} /> Sửa thông tin
              </button>
            ) : null}
            <CloseGuard dirty={dirty} onClose={onClose}>
              <button ref={closeButton} type="button" className={styles.iconButton} aria-label="Đóng">
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
            <FlowStepper nodes={letter.flow} workflowName={letter.workflowName} cancelled={letter.stage === 'cancelled'} />

            <LetterActionPanel
              letter={letter}
              config={config}
              directory={directory}
              onDone={applied}
              onDirtyChange={setActionDirty}
              onRemoved={(message) => {
                toast.success(message);
                onChanged();
                onClose();
              }}
            />

            <section className={`${styles.card} ${styles.meta}`}>
              {incoming ? (
                <>
                  <div>
                    <span>Ngày đến</span>
                    {formatDay(letter.receivedOn)}
                  </div>
                  <div>
                    <span>Ngày văn bản</span>
                    {formatDay(letter.senderDate) || 'Không ghi'}
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <span>Người soạn · Phòng ban</span>
                    {[letter.authorName, letter.authorUnitName].filter(Boolean).join(' · ') || 'Không rõ'}
                  </div>
                  <div>
                    <span>Nơi nhận</span>
                    {letter.recipient ?? 'Chưa ghi'}
                  </div>
                </>
              )}
              <div>
                <span>{incoming ? 'Hạn xử lý' : 'Hạn ban hành'}</span>
                {formatDay(letter.dueOn) || 'Không đặt'}
                {due ? <span className={`${styles.hint} ${styles[`hint-${due.tone}`] ?? ''}`}>{due.text}</span> : null}
              </div>
              <div>
                <span>Loại văn bản</span>
                {letter.kindName}
              </div>
              <div>
                <span>Độ khẩn · Độ mật</span>
                {letter.urgencyName} · {letter.confidentialityName}
              </div>
              <div>
                <span>{incoming ? 'Văn thư tiếp nhận' : 'Số dự thảo'}</span>
                {incoming ? (letter.receivedByName ?? 'Không rõ') : letter.incomingNo}
              </div>
              {letter.relatedLetterId ? (
                <div>
                  <span>Trả lời công văn đến</span>
                  <button type="button" className={styles.buttonLink} onClick={() => onOpenLetter(letter.relatedLetterId as string)}>
                    Số {letter.relatedLetterNo ?? ''}
                  </button>
                </div>
              ) : null}
              {letter.outgoingNo ? (
                <div>
                  <span>Số ban hành</span>
                  {letter.outgoingNo} · {formatDay(letter.publishedOn)}
                  {letter.deliveryMethod ? ` · ${letter.deliveryMethod}` : ''}
                </div>
              ) : null}
              {letter.deliveryStatus ? (
                <div>
                  <span>Tình trạng gửi</span>
                  {DELIVERY_STATUS_LABELS[letter.deliveryStatus]}
                  {letter.deliveredOn ? ` · ${formatDay(letter.deliveredOn)}` : ''}
                </div>
              ) : null}
              {letter.archiveCode ? (
                <div>
                  <span>Số hồ sơ lưu trữ</span>
                  {letter.archiveCode} · {formatDay(letter.archivedOn)}
                </div>
              ) : null}
              {letter.cancelReason ? (
                <div className={styles.metaWide}>
                  <span>Lý do huỷ</span>
                  {letter.cancelReason}
                </div>
              ) : null}
            </section>

            {letter.assignments.length > 0 ? (
              <AssignmentsSection
                letter={letter}
                directory={directory}
                onDone={applied}
                onDirtyChange={setResponseDirty}
                onFilesChanged={filesChanged}
                onPreview={setPreview}
              />
            ) : null}

            {letter.steps.some((step) => step.actedAt || step.status === 'active') ? <StepsSection steps={letter.steps} /> : null}

            <CommentsSection letter={letter} directory={directory} currentUserId={currentUserId} onDone={applied} onDirtyChange={setCommentDirty} />

            <AttachmentsSection letter={letter} onPreview={setPreview} onChanged={filesChanged} />

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
            <OutgoingDialog
              open={replying}
              config={config}
              directory={directory}
              replyTo={{ letterId: letter.id, number: letter.displayNo, subject: letter.subject, senderOrg: letter.senderOrg, kind: letter.kind }}
              onClose={() => setReplying(false)}
              onCreated={(id) => {
                setReplying(false);
                onChanged();
                onOpenLetter(id);
              }}
            />
          </>
        ) : null}
      </aside>
      <FilePreview target={preview} onClose={() => setPreview(undefined)} />
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------ ý kiến các bước duyệt */

const STEP_STATUS: Readonly<Record<LetterStep['status'], { label: string; tone: string }>> = {
  waiting: { label: 'Chưa tới', tone: 'tone-muted' },
  active: { label: 'Đang chờ duyệt', tone: 'tone-warning' },
  done: { label: 'Đạt', tone: 'tone-success' },
  skipped: { label: 'Dừng', tone: 'tone-muted' },
};

/** Kết quả từng bước duyệt: ai duyệt, đạt hay không đạt (trả lại), ý kiến. */
function StepsSection({ steps }: { readonly steps: readonly LetterStep[] }) {
  return (
    <section className={styles.card}>
      <h2>Ý kiến các bước duyệt</h2>
      <div className={styles.list}>
        {steps.map((step) => {
          const returned = step.decision === 'returned' && step.status !== 'done';
          const status = returned ? { label: 'Không đạt', tone: 'tone-danger' } : STEP_STATUS[step.status];
          return (
            <div key={step.id} className={styles.listRow}>
              <div className={styles.listMain}>
                <b>
                  {step.seq}. {step.name}
                </b>
                {step.status === 'active' && step.assignees.length > 0 ? (
                  <span className={styles.hint}>Người duyệt: {step.assignees.map((item) => item.name ?? 'Người dùng').join(', ')}</span>
                ) : null}
                {step.actedAt ? (
                  <span className={styles.hint}>
                    {returned ? 'Trả lại' : 'Đạt'} · {step.actedByName ?? 'Người dùng'} lúc {formatDateTime(step.actedAt)}
                  </span>
                ) : null}
                {step.note ? <p>{step.note}</p> : null}
              </div>
              <span className={`${styles.tag} ${styles[status.tone]}`}>{status.label}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
