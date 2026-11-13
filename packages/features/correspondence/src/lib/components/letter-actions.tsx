'use client';

import type {
  CorrespondenceConfig,
  CorrespondenceDirectory,
  LetterDetail,
  StepChoice,
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
  loadStepChoice,
  publishLetter,
  requestRevision,
  returnLetter,
  submitLetter,
} from '../correspondence-api';
import { catalogOptions, formatDay, localToday } from '../correspondence.model';
import styles from '../correspondence.module.scss';
import { Field, SelectField } from './form-dialog';

interface ActionProps {
  readonly letter: LetterDetail;
  readonly config: CorrespondenceConfig;
  readonly directory?: CorrespondenceDirectory;
  readonly onDone: (next: LetterDetail, message: string) => void;
  readonly onDirtyChange: (dirty: boolean) => void;
}

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

/**
 * Người duyệt của bước sắp bắt đầu khi bước đó để người thao tác chọn (luật "chọn trong
 * nhóm" của quy trình). Không cần chọn thì không hiện gì và báo `null`.
 */
function useStepChoice(letterId: string, workflowId?: string, enabled = true) {
  const [choice, setChoice] = useState<StepChoice | null>();
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    setChoice(undefined);
    loadStepChoice(letterId, workflowId)
      .then((next) => active && setChoice(next))
      .catch(() => active && setChoice(null));
    return () => {
      active = false;
    };
  }, [letterId, workflowId, enabled]);
  return choice;
}

function ChoiceField({
  choice,
  value,
  onChange,
}: {
  readonly choice: StepChoice | null | undefined;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  if (!choice) return null;
  return (
    <SelectField label={`Người thực hiện bước "${choice.stepName}"`} required>
      <SearchableSelect
        options={choice.candidates.map((candidate) => ({ value: candidate.userId, label: candidate.name, description: candidate.detail }))}
        value={value}
        placeholder="Chọn người"
        emptyText="Nhóm người của bước này đang trống. Kiểm cấu hình quy trình, sơ đồ tổ chức hoặc phân quyền."
        onChange={onChange}
      />
    </SelectField>
  );
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
  const { letter, onDirtyChange } = props;
  const actions = letter.actions;
  useEffect(() => onDirtyChange(false), [letter.stage, letter.currentStepName, onDirtyChange]);

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
  if (actions.approve) return <ApproveForm {...props} />;
  if (actions.publish) return <PublishForm {...props} />;
  if (actions.archive) return <ArchiveForm {...props} />;
  return <WaitingNote letter={letter} />;
}

function WaitingNote({ letter }: { readonly letter: LetterDetail }) {
  const pending = letter.assignments.filter((item) => item.status === 'pending');
  const who = letter.currentAssigneeNames.join(', ') || 'người được giao';
  const text = (() => {
    switch (letter.stage) {
      case 'received':
      case 'registered':
        return 'Văn thư đang phân loại và trình duyệt.';
      case 'reviewing':
      case 'directing':
        return `Bước "${letter.currentStepName ?? ''}" đang chờ ${who}.`;
      case 'processing':
        return pending.length > 0
          ? `Đang chờ ${pending.map((item) => item.unitName).join(', ')} gửi văn bản phản hồi.`
          : 'Các phòng ban đã phản hồi đủ.';
      case 'publishing':
        return 'Đã duyệt xong, đang chờ cấp số và phát hành.';
      case 'closing':
        return 'Đang chờ đóng hồ sơ để lưu trữ.';
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

function ReturnButton({ letter, onDone }: Pick<ActionProps, 'letter' | 'onDone'>) {
  const { busy, run } = useRunner(onDone);
  if (!letter.actions.returnToClerk) return null;
  return (
    <Popconfirm
      title="Trả lại văn thư?"
      description="Công văn quay về văn thư để trình lại (ví dụ trình nhầm người hay nhầm quy trình)."
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
  );
}

function ClassifyForm({ letter, config, onDone, onDirtyChange }: ActionProps) {
  const [kind, setKind] = useState(letter.kind);
  const [urgency, setUrgency] = useState(letter.urgency);
  const [confidentiality, setConfidentiality] = useState(letter.confidentiality);
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
            <SearchableSelect options={catalogOptions(config.catalog, 'letter_type', letter.kind)} value={kind} onChange={setKind} />
          </SelectField>
          <SelectField label="Độ khẩn" required>
            <SearchableSelect
              options={catalogOptions(config.catalog, 'urgency', letter.urgency)}
              value={urgency}
              searchInDropdown
              hideDropdownSearch
              onChange={setUrgency}
            />
          </SelectField>
        </div>
        <SelectField label="Độ mật">
          <SearchableSelect
            options={catalogOptions(config.catalog, 'confidentiality', letter.confidentiality)}
            value={confidentiality}
            searchInDropdown
            hideDropdownSearch
            onChange={setConfidentiality}
          />
        </SelectField>
        <ErrorLine error={error} />
        <div className={styles.formActions}>
          <CancelButton letter={letter} onDone={onDone} />
          <button
            type="button"
            className={styles.buttonPrimary}
            disabled={busy || !kind || !urgency}
            onClick={() => run(() => classifyLetter(letter.id, { kind, urgency, confidentiality }), 'Đã phân loại, vào sổ.')}
          >
            Phân loại và vào sổ
          </button>
        </div>
      </div>
    </Panel>
  );
}

function SubmitForm({ letter, config, onDone, onDirtyChange }: ActionProps) {
  const typeWorkflow = config.catalog.find((item) => item.kind === 'letter_type' && item.code === letter.kind)?.workflowId;
  const active = config.workflows.filter((workflow) => workflow.isActive);
  const initial = active.find((workflow) => workflow.id === typeWorkflow)?.id ?? active.find((workflow) => workflow.isDefault)?.id ?? active[0]?.id ?? '';
  const [workflowId, setWorkflowId] = useState(initial);
  const [assignee, setAssignee] = useState('');
  const [note, setNote] = useState('');
  const choice = useStepChoice(letter.id, workflowId || undefined, Boolean(workflowId));
  const { busy, error, run } = useRunner(onDone);
  useEffect(() => onDirtyChange(note.trim() !== '' || assignee !== ''), [note, assignee, onDirtyChange]);
  useEffect(() => setAssignee(''), [workflowId]);
  const workflow = active.find((item) => item.id === workflowId);
  return (
    <Panel title="Văn thư: trình duyệt">
      <div className={styles.form}>
        <SelectField label="Quy trình duyệt" required>
          <SearchableSelect
            options={active.map((item) => ({
              value: item.id,
              label: item.name,
              description: item.steps.map((step) => step.name).join(' → '),
            }))}
            value={workflowId}
            emptyText="Chưa có quy trình duyệt đang dùng. Vào Cấu hình để tạo."
            onChange={setWorkflowId}
          />
        </SelectField>
        {workflow ? (
          <p className={styles.muted} style={{ margin: 0, fontSize: 12.5 }}>
            Các bước: {workflow.steps.map((step) => step.name).join(' → ')}
          </p>
        ) : null}
        <ChoiceField choice={choice} value={assignee} onChange={setAssignee} />
        <Field label="Ghi chú khi trình">
          <textarea value={note} maxLength={2000} rows={2} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <ErrorLine error={error} />
        <div className={styles.formActions}>
          <CancelButton letter={letter} onDone={onDone} />
          <button
            type="button"
            className={styles.buttonPrimary}
            disabled={busy || !workflowId || choice === undefined || (Boolean(choice) && !assignee)}
            onClick={() =>
              run(
                () => submitLetter(letter.id, { workflowId, assigneeUserId: assignee || undefined, note: note || undefined }),
                'Đã trình duyệt.',
              )
            }
          >
            Trình duyệt
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
  const [next, setNext] = useState('');
  const choice = useStepChoice(letter.id);
  const { busy, error, run } = useRunner(onDone);
  useEffect(() => onDirtyChange(unitIds.length > 0 || next !== ''), [unitIds, next, onDirtyChange]);
  const units = directory?.units ?? [];
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  return (
    <Panel title={`${letter.currentStepName ?? 'Chỉ đạo'}: giao phòng ban xử lý`}>
      <div className={styles.form}>
        <SelectField label="Phòng ban xử lý" required>
          <SearchableSelect
            options={units
              .filter((unit) => !unitIds.includes(unit.id))
              .map((unit) => ({
                value: unit.id,
                label: unit.name,
                description: [unit.path, `${unit.members.length} người`].filter(Boolean).join(' · '),
              }))}
            value=""
            placeholder="Tìm và thêm phòng ban theo sơ đồ tổ chức"
            emptyText={directory?.degraded ? 'Chưa đọc được sơ đồ tổ chức, thử lại sau.' : 'Không còn phòng ban nào để thêm.'}
            onChange={(value) => value && setUnitIds((current) => [...current, value])}
          />
        </SelectField>
        {unitIds.length > 0 ? (
          <div className={styles.list}>
            {unitIds.map((unitId) => {
              const unit = byId.get(unitId);
              const heads = unit?.members.filter((member) => member.isHead) ?? [];
              return (
                <div key={unitId} className={styles.listRow}>
                  <div className={styles.listMain}>
                    <b>{unit?.name ?? unitId}</b>
                    <span className={styles.hint}>
                      Trưởng đơn vị: {heads.map((member) => member.name).join(', ') || 'chưa có (giao cho đơn vị cấp trên)'}
                    </span>
                    <span className={styles.hint}>
                      Thành viên: {unit?.members.map((member) => member.name).join(', ') || 'chưa có ai trong sơ đồ tổ chức'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Bỏ ${unit?.name ?? 'phòng ban'}`}
                    onClick={() => setUnitIds((current) => current.filter((id) => id !== unitId))}
                  >
                    <X size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
        <Field label="Ý kiến chỉ đạo" required>
          <textarea value={instruction} maxLength={4000} rows={3} onChange={(event) => setInstruction(event.target.value)} />
        </Field>
        <Field label="Hạn xử lý">
          <input type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
        </Field>
        <ChoiceField choice={choice} value={next} onChange={setNext} />
        <ErrorLine error={error} />
        <div className={styles.formActions}>
          <ReturnButton letter={letter} onDone={onDone} />
          <Popconfirm
            title="Lưu để biết?"
            description="Không cần phòng ban phản hồi; bỏ các bước còn lại, công văn chuyển sang chờ lưu trữ. Ý kiến chỉ đạo ở trên được ghi kèm."
            okText="Lưu để biết"
            okType="primary"
            placement="top"
            onConfirm={() => run(() => closeForInfo(letter.id, instruction || undefined), 'Đã chuyển sang chờ lưu trữ.')}
          >
            <button type="button" className={styles.buttonGhost} disabled={busy}>
              Lưu để biết
            </button>
          </Popconfirm>
          <button
            type="button"
            className={styles.buttonPrimary}
            disabled={busy || unitIds.length === 0 || !instruction.trim() || choice === undefined || (Boolean(choice) && !next)}
            onClick={() =>
              run(
                () => directLetter(letter.id, { unitIds, instruction, dueOn: dueOn || undefined, nextAssigneeUserId: next || undefined }),
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

/** Bước xem xét (trước chỉ đạo) hay duyệt văn bản phản hồi (sau chỉ đạo) đang chờ người xem. */
function ApproveForm({ letter, onDone, onDirtyChange }: ActionProps) {
  const [note, setNote] = useState('');
  const [next, setNext] = useState('');
  const [revise, setRevise] = useState<string[]>(letter.assignments.map((item) => item.id));
  const choice = useStepChoice(letter.id);
  const { busy, error, run } = useRunner(onDone);
  useEffect(() => onDirtyChange(note.trim() !== '' || next !== ''), [note, next, onDirtyChange]);
  const afterDirect = letter.actions.requestRevision;
  return (
    <Panel title={letter.currentStepName ?? 'Duyệt'}>
      <div className={styles.form}>
        {afterDirect ? (
          <p className={styles.muted} style={{ margin: 0 }}>
            Phản hồi từ: {letter.assignments.map((item) => item.unitName).join(', ')}. Xem nội dung và dự thảo ở mục Phòng ban xử
            lý bên dưới.
          </p>
        ) : null}
        <Field label={afterDirect ? 'Ý kiến duyệt hoặc nội dung cần sửa' : 'Ý kiến'}>
          <textarea value={note} maxLength={4000} rows={3} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <ChoiceField choice={choice} value={next} onChange={setNext} />
        {afterDirect && letter.assignments.length > 1 ? (
          <div className={styles.field} role="group" aria-label="Phòng ban cần sửa">
            <span className={styles.fieldLabel}>Phòng ban cần sửa (khi yêu cầu chỉnh sửa)</span>
            {letter.assignments.map((item) => (
              <label key={item.id} className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={revise.includes(item.id)}
                  onChange={(event) =>
                    setRevise((current) => (event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id)))
                  }
                />
                {item.unitName}
              </label>
            ))}
          </div>
        ) : null}
        <ErrorLine error={error} />
        <div className={styles.formActions}>
          <ReturnButton letter={letter} onDone={onDone} />
          {afterDirect ? (
            <button
              type="button"
              className={styles.buttonGhost}
              disabled={busy || !note.trim() || revise.length === 0}
              title={!note.trim() ? 'Ghi nội dung cần sửa vào ô ở trên' : undefined}
              onClick={() => run(() => requestRevision(letter.id, { reason: note, assignmentIds: revise }), 'Đã trả phòng ban để sửa.')}
            >
              Yêu cầu chỉnh sửa
            </button>
          ) : null}
          <button
            type="button"
            className={styles.buttonPrimary}
            disabled={busy || choice === undefined || (Boolean(choice) && !next)}
            onClick={() =>
              run(
                () => approveLetter(letter.id, { note: note || undefined, nextAssigneeUserId: next || undefined }),
                afterDirect ? 'Đã duyệt.' : 'Đã đồng ý, chuyển bước tiếp theo.',
              )
            }
          >
            {afterDirect ? 'Duyệt' : 'Đồng ý, chuyển tiếp'}
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
            onClick={() => run(() => publishLetter(letter.id, { recipient, publishedOn: publishedOn || undefined }), 'Đã cấp số và phát hành.')}
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
    <Panel title="Đóng hồ sơ">
      <div className={styles.form}>
        <p className={styles.muted} style={{ margin: 0 }}>
          {letter.outgoingNo ? `Văn bản ${letter.outgoingNo} đã phát hành tới ${letter.recipient}. ` : 'Công văn được cho lưu để biết. '}
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
