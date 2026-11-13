'use client';

import {
  LETTER_CONFIDENTIALITIES,
  LETTER_CONFIDENTIALITY_LABELS,
  LETTER_KINDS,
  LETTER_KIND_LABELS,
  LETTER_URGENCIES,
  LETTER_URGENCY_LABELS,
  type CorrespondenceDirectory,
  type LetterConfidentiality,
  type LetterDetail,
  type LetterKind,
  type LetterUrgency,
} from '@enterprise-platform/contracts-correspondence';
import { Popconfirm, SearchableSelect } from '@enterprise-platform/shared-ui';
import { X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import {
  approveLetter,
  archiveLetter,
  cancelLetter,
  classifyLetter,
  closeForInfo,
  directLetter,
  errorMessage,
  publishLetter,
  requestRevision,
  returnLetter,
  submitLetter,
} from '../correspondence-api';
import { formatDay, localToday } from '../correspondence.model';
import styles from '../correspondence.module.scss';
import { Field, SelectField } from './form-dialog';

interface ActionProps {
  readonly letter: LetterDetail;
  readonly directory?: CorrespondenceDirectory;
  readonly onDone: (next: LetterDetail, message: string) => void;
  readonly onDirtyChange: (dirty: boolean) => void;
}

const options = <T extends string>(values: readonly T[], labels: Readonly<Record<T, string>>) =>
  values.map((value) => ({ value, label: labels[value] }));

/** Chạy một thao tác chuyển bước; lỗi hiện ngay dưới form. */
function useRunner(onDone: ActionProps['onDone']) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = async (operation: () => Promise<LetterDetail>, message: string) => {
    setBusy(true);
    setError(undefined);
    try {
      onDone(await operation(), message);
    } catch (cause) {
      setError(errorMessage(cause, 'Không thực hiện được thao tác.'));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function Panel({ title, done = false, children }: { readonly title: string; readonly done?: boolean; readonly children: ReactNode }) {
  return (
    <section className={done ? `${styles.action} ${styles.actionDone}` : styles.action}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function ErrorLine({ error }: { readonly error?: string }) {
  return error ? (
    <p role="alert" className={styles.alert}>
      {error}
    </p>
  ) : null;
}

/** Ô thao tác của bước hiện tại, theo đúng quyền người xem có ở bước đó. */
export function LetterActionPanel(props: ActionProps) {
  const { letter } = props;
  const actions = letter.actions;
  const { onDirtyChange } = props;
  // Đổi bước thì form cũ biến mất: không còn gì đang nhập dở.
  useEffect(() => onDirtyChange(false), [letter.stage, onDirtyChange]);

  if (letter.stage === 'archived') {
    return (
      <Panel title="Hồ sơ đã lưu trữ" done>
        <p className={styles.muted} style={{ margin: 0 }}>
          Số lưu trữ {letter.archiveCode}, ngày {formatDay(letter.archivedOn)}. Tệp của hồ sơ nằm trong kho tài liệu của
          Hệ dùng chung, thư mục Văn thư.
        </p>
        {letter.sharedFolderId ? (
          <p style={{ margin: '8px 0 0' }}>
            <a className={styles.buttonLink} href={`/modules/shared#library/${encodeURIComponent(letter.sharedFolderId)}`}>
              Mở thư mục hồ sơ trong Hệ dùng chung
            </a>
          </p>
        ) : null}
      </Panel>
    );
  }
  if (letter.stage === 'cancelled') {
    return (
      <Panel title="Công văn đã huỷ khỏi sổ">
        <p className={styles.muted} style={{ margin: 0 }}>
          Lý do: {letter.cancelReason}
        </p>
      </Panel>
    );
  }
  if (actions.classify) return <ClassifyForm {...props} />;
  if (actions.submit) return <SubmitForm {...props} />;
  if (actions.direct) return <DirectForm {...props} />;
  if (actions.approve) return <ReviewForm {...props} />;
  if (actions.publish) return <PublishForm {...props} />;
  if (actions.archive) return <ArchiveForm {...props} />;
  return <WaitingNote letter={letter} />;
}

function WaitingNote({ letter }: { readonly letter: LetterDetail }) {
  const pending = letter.assignments.filter((item) => item.status === 'pending');
  const text = (() => {
    switch (letter.stage) {
      case 'received':
      case 'registered':
        return 'Văn thư đang phân loại và trình lãnh đạo.';
      case 'directing':
        return `Đang chờ ${letter.leaderName ?? 'lãnh đạo'} cho ý kiến chỉ đạo.`;
      case 'processing':
        return pending.length > 0
          ? `Đang chờ ${pending.map((item) => item.unitName).join(', ')} gửi văn bản phản hồi.`
          : 'Các phòng ban đã phản hồi đủ.';
      case 'reviewing':
        return `Đang chờ ${letter.leaderName ?? 'lãnh đạo'} duyệt văn bản phản hồi.`;
      case 'publishing':
        return 'Văn bản đã được duyệt, văn thư đang cấp số và phát hành.';
      case 'closing':
        return 'Văn thư đang đóng hồ sơ để lưu trữ.';
      default:
        return '';
    }
  })();
  return (
    <Panel title="Bước hiện tại">
      <p className={styles.muted} style={{ margin: 0 }}>
        {text}
      </p>
    </Panel>
  );
}

function CancelButton({ letter, onDone }: Pick<ActionProps, 'letter' | 'onDone'>) {
  const { busy, run } = useRunner(onDone);
  if (!letter.actions.cancel) return null;
  return (
    <Popconfirm
      title="Huỷ công văn khỏi sổ?"
      description="Công văn sẽ không đi tiếp trên luồng xử lý. Số đến đã cấp được giữ lại."
      okText="Huỷ công văn"
      cancelText="Không"
      okType="danger"
      reasonRequired
      reasonLabel="Lý do huỷ"
      placement="top"
      onConfirm={(reason) => run(() => cancelLetter(letter.id, reason ?? ''), 'Đã huỷ công văn khỏi sổ.')}
    >
      <button type="button" className={styles.buttonDanger} disabled={busy}>
        Huỷ công văn
      </button>
    </Popconfirm>
  );
}

function ClassifyForm({ letter, onDone, onDirtyChange }: ActionProps) {
  const [kind, setKind] = useState<LetterKind>(letter.kind);
  const [urgency, setUrgency] = useState<LetterUrgency>(letter.urgency);
  const [confidentiality, setConfidentiality] = useState<LetterConfidentiality>(letter.confidentiality);
  const { busy, error, run } = useRunner(onDone);
  useEffect(
    () => onDirtyChange(kind !== letter.kind || urgency !== letter.urgency || confidentiality !== letter.confidentiality),
    [kind, urgency, confidentiality, letter, onDirtyChange],
  );
  return (
    <Panel title="Văn thư: phân loại và vào sổ">
      <div className={styles.form}>
        <div className={styles.formRow}>
          <SelectField label="Loại văn bản" required>
            <SearchableSelect
              options={options(LETTER_KINDS, LETTER_KIND_LABELS)}
              value={kind}
              searchInDropdown
              hideDropdownSearch
              onChange={(value) => setKind((value || 'other') as LetterKind)}
            />
          </SelectField>
          <SelectField label="Độ khẩn" required>
            <SearchableSelect
              options={options(LETTER_URGENCIES, LETTER_URGENCY_LABELS)}
              value={urgency}
              searchInDropdown
              hideDropdownSearch
              onChange={(value) => setUrgency((value || 'normal') as LetterUrgency)}
            />
          </SelectField>
        </div>
        <SelectField label="Độ mật">
          <SearchableSelect
            options={options(LETTER_CONFIDENTIALITIES, LETTER_CONFIDENTIALITY_LABELS)}
            value={confidentiality}
            searchInDropdown
            hideDropdownSearch
            onChange={(value) => setConfidentiality((value || 'normal') as LetterConfidentiality)}
          />
        </SelectField>
        <ErrorLine error={error} />
        <div className={styles.formActions}>
          <CancelButton letter={letter} onDone={onDone} />
          <button
            type="button"
            className={styles.buttonPrimary}
            disabled={busy}
            onClick={() => run(() => classifyLetter(letter.id, { kind, urgency, confidentiality }), 'Đã phân loại, vào sổ.')}
          >
            Phân loại và vào sổ
          </button>
        </div>
      </div>
    </Panel>
  );
}

function SubmitForm({ letter, directory, onDone, onDirtyChange }: ActionProps) {
  const [leader, setLeader] = useState(letter.leaderUserId ?? '');
  const [note, setNote] = useState('');
  const { busy, error, run } = useRunner(onDone);
  useEffect(() => onDirtyChange(note.trim() !== '' || leader !== (letter.leaderUserId ?? '')), [note, leader, letter, onDirtyChange]);
  const leaders = directory?.leaders ?? [];
  return (
    <Panel title="Văn thư: trình lãnh đạo">
      <div className={styles.form}>
        <SelectField label="Lãnh đạo phụ trách" required>
          <SearchableSelect
            options={leaders.map((item) => ({ value: item.userId, label: item.name }))}
            value={leader}
            placeholder="Chọn lãnh đạo chỉ đạo công văn này"
            emptyText="Chưa ai được cấp quyền chỉ đạo công văn. Quản trị tenant cấp quyền này ở Phân quyền."
            onChange={setLeader}
          />
        </SelectField>
        <Field label="Ghi chú cho lãnh đạo">
          <textarea value={note} maxLength={2000} rows={2} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <ErrorLine error={error} />
        <div className={styles.formActions}>
          <CancelButton letter={letter} onDone={onDone} />
          <button
            type="button"
            className={styles.buttonPrimary}
            disabled={busy || !leader}
            onClick={() => run(() => submitLetter(letter.id, leader, note || undefined), 'Đã trình lãnh đạo.')}
          >
            Trình lãnh đạo
          </button>
        </div>
      </div>
    </Panel>
  );
}

function DirectForm({ letter, directory, onDone, onDirtyChange }: ActionProps) {
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [instruction, setInstruction] = useState('Các phòng liên quan nghiên cứu, soạn dự thảo phản hồi và gửi lại đúng hạn.');
  const [dueOn, setDueOn] = useState(letter.dueOn ?? '');
  const { busy, error, run } = useRunner(onDone);
  useEffect(() => onDirtyChange(unitIds.length > 0), [unitIds, onDirtyChange]);
  const units = directory?.units ?? [];
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  return (
    <Panel title="Lãnh đạo: chỉ đạo và giao phòng ban xử lý">
      <div className={styles.form}>
        <SelectField label="Phòng ban xử lý" required>
          <SearchableSelect
            options={units
              .filter((unit) => !unitIds.includes(unit.id))
              .map((unit) => ({ value: unit.id, label: unit.name, description: unit.path || undefined }))}
            value=""
            placeholder="Tìm và thêm phòng ban"
            emptyText={directory?.degraded ? 'Chưa đọc được sơ đồ tổ chức, thử lại sau.' : 'Không còn phòng ban nào để thêm.'}
            onChange={(value) => value && setUnitIds((current) => [...current, value])}
          />
          {unitIds.length > 0 ? (
            <div className={styles.unitChips}>
              {unitIds.map((unitId) => (
                <span key={unitId} className={styles.unitChip}>
                  {byId.get(unitId)?.name ?? unitId}
                  <button
                    type="button"
                    aria-label={`Bỏ ${byId.get(unitId)?.name ?? 'phòng ban'}`}
                    onClick={() => setUnitIds((current) => current.filter((id) => id !== unitId))}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </SelectField>
        <Field label="Ý kiến chỉ đạo" required>
          <textarea value={instruction} maxLength={4000} rows={3} onChange={(event) => setInstruction(event.target.value)} />
        </Field>
        <Field label="Hạn xử lý">
          <input type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
        </Field>
        <ErrorLine error={error} />
        <div className={styles.formActions}>
          <Popconfirm
            title="Trả lại văn thư?"
            description="Công văn quay về văn thư để trình lại (ví dụ trình nhầm người)."
            okText="Trả lại"
            okType="warning"
            reasonRequired
            reasonLabel="Lý do trả lại"
            placement="top"
            onConfirm={(reason) => run(() => returnLetter(letter.id, reason ?? ''), 'Đã trả lại văn thư.')}
          >
            <button type="button" className={styles.buttonGhost} disabled={busy}>
              Trả lại văn thư
            </button>
          </Popconfirm>
          <Popconfirm
            title="Lưu để biết?"
            description="Không cần phòng ban phản hồi; công văn chuyển thẳng sang văn thư lưu trữ. Ý kiến chỉ đạo ở trên được ghi kèm."
            okText="Lưu để biết"
            okType="primary"
            placement="top"
            onConfirm={() => run(() => closeForInfo(letter.id, instruction || undefined), 'Đã chuyển văn thư lưu trữ.')}
          >
            <button type="button" className={styles.buttonGhost} disabled={busy}>
              Lưu để biết
            </button>
          </Popconfirm>
          <button
            type="button"
            className={styles.buttonPrimary}
            disabled={busy || unitIds.length === 0 || !instruction.trim()}
            onClick={() =>
              run(
                () => directLetter(letter.id, { unitIds, instruction, dueOn: dueOn || undefined }),
                `Đã giao ${unitIds.length} phòng ban xử lý.`,
              )
            }
          >
            Giao nhiệm vụ
          </button>
        </div>
      </div>
    </Panel>
  );
}

function ReviewForm({ letter, onDone, onDirtyChange }: ActionProps) {
  const [note, setNote] = useState('');
  const [revise, setRevise] = useState<string[]>(letter.assignments.map((item) => item.id));
  const { busy, error, run } = useRunner(onDone);
  useEffect(() => onDirtyChange(note.trim() !== ''), [note, onDirtyChange]);
  return (
    <Panel title="Lãnh đạo: duyệt văn bản phản hồi">
      <div className={styles.form}>
        <p className={styles.muted} style={{ margin: 0 }}>
          Phản hồi từ: {letter.assignments.map((item) => item.unitName).join(', ')}. Xem nội dung và dự thảo ở mục Phòng ban xử lý
          bên dưới.
        </p>
        <Field label="Ý kiến duyệt hoặc nội dung cần sửa">
          <textarea value={note} maxLength={4000} rows={3} onChange={(event) => setNote(event.target.value)} />
        </Field>
        {letter.assignments.length > 1 ? (
          <div className={styles.field} role="group" aria-label="Phòng ban cần sửa">
            <span className={styles.fieldLabel}>Phòng ban cần sửa (khi yêu cầu chỉnh sửa)</span>
            {letter.assignments.map((item) => (
              <label key={item.id} className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={revise.includes(item.id)}
                  onChange={(event) =>
                    setRevise((current) =>
                      event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id),
                    )
                  }
                />
                {item.unitName}
              </label>
            ))}
          </div>
        ) : null}
        <ErrorLine error={error} />
        <div className={styles.formActions}>
          <button
            type="button"
            className={styles.buttonGhost}
            disabled={busy || !note.trim() || revise.length === 0}
            title={!note.trim() ? 'Ghi nội dung cần sửa vào ô ở trên' : undefined}
            onClick={() =>
              run(
                () => requestRevision(letter.id, { reason: note, assignmentIds: revise }),
                'Đã trả lại phòng ban để sửa.',
              )
            }
          >
            Yêu cầu chỉnh sửa
          </button>
          <button
            type="button"
            className={styles.buttonPrimary}
            disabled={busy}
            onClick={() => run(() => approveLetter(letter.id, note || undefined), 'Đã duyệt văn bản phản hồi.')}
          >
            Duyệt và ký
          </button>
        </div>
      </div>
    </Panel>
  );
}

function PublishForm({ letter, onDone, onDirtyChange }: ActionProps) {
  const [recipient, setRecipient] = useState(letter.senderOrg);
  const [publishedOn, setPublishedOn] = useState(localToday());
  const { busy, error, run } = useRunner(onDone);
  useEffect(() => onDirtyChange(recipient !== letter.senderOrg), [recipient, letter, onDirtyChange]);
  return (
    <Panel title="Văn thư: cấp số và phát hành">
      <div className={styles.form}>
        <p className={styles.muted} style={{ margin: 0 }}>
          Tải bản đã ký lên mục Tệp của hồ sơ (loại Bản phát hành) trước hoặc sau khi cấp số.
        </p>
        <div className={styles.formRow}>
          <Field label="Nơi nhận" required>
            <input value={recipient} maxLength={255} onChange={(event) => setRecipient(event.target.value)} />
          </Field>
          <Field label="Ngày phát hành">
            <input type="date" value={publishedOn} onChange={(event) => setPublishedOn(event.target.value)} />
          </Field>
        </div>
        <ErrorLine error={error} />
        <div className={styles.formActions}>
          <button
            type="button"
            className={styles.buttonPrimary}
            disabled={busy || !recipient.trim()}
            onClick={() =>
              run(() => publishLetter(letter.id, { recipient, publishedOn: publishedOn || undefined }), 'Đã cấp số và phát hành.')
            }
          >
            Cấp số và phát hành
          </button>
        </div>
      </div>
    </Panel>
  );
}

function ArchiveForm({ letter, onDone, onDirtyChange }: ActionProps) {
  const [note, setNote] = useState('');
  const { busy, error, run } = useRunner(onDone);
  useEffect(() => onDirtyChange(note.trim() !== ''), [note, onDirtyChange]);
  return (
    <Panel title="Văn thư: đóng hồ sơ">
      <div className={styles.form}>
        <p className={styles.muted} style={{ margin: 0 }}>
          {letter.outgoingNo
            ? `Văn bản ${letter.outgoingNo} đã phát hành tới ${letter.recipient}. `
            : 'Lãnh đạo cho lưu để biết, không cần phản hồi. '}
          Đóng hồ sơ để cấp số lưu trữ; số này được ghi lên thư mục hồ sơ trong Hệ dùng chung.
        </p>
        <Field label="Ghi chú lưu trữ">
          <textarea value={note} maxLength={2000} rows={2} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <ErrorLine error={error} />
        <div className={styles.formActions}>
          <button
            type="button"
            className={styles.buttonPrimary}
            disabled={busy}
            onClick={() => run(() => archiveLetter(letter.id, note || undefined), 'Đã lưu trữ hồ sơ.')}
          >
            Lưu trữ hồ sơ
          </button>
        </div>
      </div>
    </Panel>
  );
}
