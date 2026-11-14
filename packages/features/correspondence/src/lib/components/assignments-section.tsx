'use client';

import type { CorrespondenceDirectory, LetterAssignment, LetterDetail } from '@enterprise-platform/contracts-correspondence';
import { formatDateTime, SearchableSelect } from '@enterprise-platform/shared-ui';
import { UserCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { assignHandler, errorMessage, respondLetter } from '../correspondence-api';
import styles from '../correspondence.module.scss';
import { FileRows, UploadButton } from './attachments-section';
import type { PreviewTarget } from './file-preview';

/**
 * Phòng ban xử lý công văn đến: ai nhận (cả phòng hay người được phân công), trưởng phòng
 * phân công người xử lý, người xử lý gửi kết quả kèm tệp.
 */
export function AssignmentsSection({
  letter,
  directory,
  onDone,
  onDirtyChange,
  onFilesChanged,
  onPreview,
}: {
  readonly letter: LetterDetail;
  readonly directory?: CorrespondenceDirectory;
  readonly onDone: (next: LetterDetail, message: string) => void;
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly onFilesChanged: () => void;
  readonly onPreview: (target: PreviewTarget) => void;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [handlers, setHandlers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => onDirtyChange(Object.values(notes).some((note) => note.trim() !== '')), [notes, onDirtyChange]);

  const respond = async (assignment: LetterAssignment) => {
    setBusy(assignment.id);
    setError(undefined);
    try {
      const next = await respondLetter(letter.id, assignment.id, notes[assignment.id] ?? '');
      setNotes((current) => ({ ...current, [assignment.id]: '' }));
      onDone(next, `${assignment.unitName} đã gửi kết quả xử lý.`);
    } catch (cause) {
      setError(errorMessage(cause, 'Không gửi được kết quả.'));
    } finally {
      setBusy(undefined);
    }
  };

  const assign = async (assignment: LetterAssignment) => {
    const handlerUserId = handlers[assignment.id];
    if (!handlerUserId) return;
    setBusy(assignment.id);
    setError(undefined);
    try {
      const next = await assignHandler(letter.id, assignment.id, { handlerUserId });
      setHandlers((current) => ({ ...current, [assignment.id]: '' }));
      onDone(next, `${assignment.unitName}: đã phân công người xử lý.`);
    } catch (cause) {
      setError(errorMessage(cause, 'Không phân công được.'));
    } finally {
      setBusy(undefined);
    }
  };

  const done = letter.assignments.filter((item) => item.status === 'submitted').length;
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>Phòng ban xử lý</h2>
        <span className={styles.muted}>
          Đã gửi kết quả {done}/{letter.assignments.length}
        </span>
      </div>
      {letter.instruction ? (
        <p className={styles.instruction}>
          {letter.directive?.note && letter.directive.note === letter.instruction ? 'Bút phê' : 'Ghi chú khi giao'}: {letter.instruction}
        </p>
      ) : null}
      <div className={styles.list}>
        {letter.assignments.map((assignment) => {
          const results = letter.attachments.filter((item) => item.assignmentId === assignment.id);
          const members = directory?.units.find((unit) => unit.id === assignment.unitId)?.members ?? [];
          return (
            <div key={assignment.id} className={styles.assignment}>
              <div className={styles.assignmentHead}>
                <div className={styles.listMain}>
                  <b>
                    {assignment.unitName}{' '}
                    <span className={`${styles.tag} ${styles[assignment.role === 'lead' ? 'tone-info' : 'tone-neutral']}`}>
                      {assignment.role === 'lead' ? 'Chủ trì' : 'Phối hợp'}
                    </span>
                  </b>
                  <span className={styles.hint}>
                    {assignment.handlerName ? (
                      <>
                        <UserCheck size={12} /> Người xử lý: {assignment.handlerName}
                      </>
                    ) : (
                      'Cả phòng cùng nhận, chưa phân công người xử lý'
                    )}
                    {assignment.headNames.length > 0 ? ` · Trưởng đơn vị: ${assignment.headNames.join(', ')}` : ''}
                  </span>
                  {assignment.round > 1 ? <span className={styles.hint}>Lượt xử lý thứ {assignment.round}</span> : null}
                </div>
                <span className={`${styles.tag} ${styles[assignment.status === 'submitted' ? 'tone-success' : 'tone-warning']}`}>
                  {assignment.status === 'submitted' ? 'Đã gửi kết quả' : 'Đang xử lý'}
                </span>
              </div>
              {assignment.revisionReason && assignment.status === 'pending' ? (
                <p className={styles.notice}>Không đạt, cần xử lý lại: {assignment.revisionReason}</p>
              ) : null}
              {assignment.responseNote ? (
                <div className={styles.response}>
                  <p>{assignment.responseNote}</p>
                  {assignment.submittedAt ? (
                    <span className={styles.hint}>
                      {assignment.submittedByName ?? 'Người dùng'} gửi lúc {formatDateTime(assignment.submittedAt)}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {results.length > 0 ? <FileRows letter={letter} files={results} onPreview={onPreview} onChanged={onFilesChanged} /> : null}
              {assignment.canAssignHandler ? (
                <div className={styles.inlineForm}>
                  <div className={styles.inlineGrow}>
                    <SearchableSelect
                      options={members.map((member) => ({
                        value: member.userId,
                        label: member.name,
                        description: [member.positionName, member.isHead ? 'Trưởng đơn vị' : undefined].filter(Boolean).join(' · ') || undefined,
                      }))}
                      value={handlers[assignment.id] ?? ''}
                      placeholder={assignment.handlerName ? 'Đổi người xử lý' : 'Phân công một người xử lý'}
                      emptyText="Phòng chưa có ai trong sơ đồ tổ chức."
                      onChange={(value) => setHandlers((current) => ({ ...current, [assignment.id]: value }))}
                    />
                  </div>
                  <button
                    type="button"
                    className={styles.buttonGhost}
                    disabled={busy === assignment.id || !handlers[assignment.id]}
                    onClick={() => void assign(assignment)}
                  >
                    Phân công
                  </button>
                </div>
              ) : null}
              {assignment.canRespond ? (
                <div className={styles.form}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>
                      Kết quả xử lý của {assignment.unitName}
                      <span className={styles.required}> *</span>
                    </span>
                    <textarea
                      value={notes[assignment.id] ?? ''}
                      maxLength={4000}
                      rows={3}
                      placeholder="Tóm tắt nội dung đã xử lý, số liệu, ý kiến đề xuất trình lãnh đạo"
                      onChange={(event) => setNotes((current) => ({ ...current, [assignment.id]: event.target.value }))}
                    />
                  </label>
                  <div className={styles.formActions}>
                    <UploadButton label="Tải tệp kết quả" letterId={letter.id} kind="draft" assignmentId={assignment.id} onUploaded={onFilesChanged} />
                    <button
                      type="button"
                      className={styles.buttonPrimary}
                      disabled={busy === assignment.id || !(notes[assignment.id] ?? '').trim()}
                      onClick={() => void respond(assignment)}
                    >
                      Gửi kết quả
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
