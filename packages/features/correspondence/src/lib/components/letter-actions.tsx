'use client';

import {
  DELIVERY_STATUSES,
  DELIVERY_STATUS_LABELS,
  REVOKE_KINDS,
  REVOKE_KIND_LABELS,
  returnTargetLabel,
  type CorrespondenceConfig,
  type CorrespondenceDirectory,
  type DeliveryStatus,
  type LetterDetail,
  type ReturnTarget,
  type RevokeKind,
  type StepChoice,
} from '@enterprise-platform/contracts-correspondence';
import { Popconfirm, SearchableSelect, formatDateTime } from '@enterprise-platform/shared-ui';
import { Ban, CheckCircle2, ShieldX, Trash2, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  approveLetter,
  cancelLetter,
  completeLetter,
  decideRevoke,
  dispatchLetter,
  errorMessage,
  loadStepChoice,
  publishLetter,
  removeLetter,
  requestRevoke,
  returnLetter,
  sendToClerk,
  submitLetter,
  updateDelivery,
  withdrawRevoke,
} from '../correspondence-api';
import { catalogOptions, formatDay, localToday, plannedWorkflow } from '../correspondence.model';
import styles from '../correspondence.module.scss';
import { CheckGroup, Field, FormDialog, SelectField } from './form-dialog';

interface ActionProps {
  readonly letter: LetterDetail;
  readonly config: CorrespondenceConfig;
  readonly directory?: CorrespondenceDirectory;
  readonly onDone: (next: LetterDetail, message: string) => void;
  readonly onDirtyChange: (dirty: boolean) => void;
  /** Công văn đã bị xoá khỏi Văn thư: ngăn chi tiết đóng lại. */
  readonly onRemoved?: (message: string) => void;
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
 * nhóm" của quy trình). Không cần chọn thì `null`; đang tải thì `undefined`.
 */
function useStepChoice(letterId: string, kind?: string) {
  const [choice, setChoice] = useState<StepChoice | null>();
  useEffect(() => {
    let active = true;
    setChoice(undefined);
    loadStepChoice(letterId, kind)
      .then((next) => active && setChoice(next))
      .catch(() => active && setChoice(null));
    return () => {
      active = false;
    };
  }, [letterId, kind]);
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
    <SelectField label={`Người duyệt bước "${choice.stepName}"`} required>
      <SearchableSelect
        options={choice.candidates.map((candidate) => ({ value: candidate.userId, label: candidate.name, description: candidate.detail }))}
        value={value}
        placeholder="Chọn người duyệt"
        emptyText="Nhóm người của bước này đang trống. Kiểm cấu hình quy trình, sơ đồ tổ chức hoặc phân quyền."
        onChange={onChange}
      />
    </SelectField>
  );
}

function Panel({ title, tone, children }: { readonly title: string; readonly tone?: 'done' | 'muted'; readonly children: ReactNode }) {
  return (
    <section className={`${styles.action} ${tone === 'done' ? styles.actionDone : tone === 'muted' ? styles.actionMuted : ''}`}>
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

/** Các bước duyệt sẽ áp dụng, đọc theo cấu hình; người dùng không chọn quy trình. */
function PlannedSteps({ config, letter, kind }: { readonly config: CorrespondenceConfig; readonly letter: LetterDetail; readonly kind: string }) {
  const workflow = plannedWorkflow(config, letter.direction, kind);
  if (!workflow) {
    return <p className={styles.notice}>Chưa có quy trình duyệt đang dùng cho luồng này. Nhờ người quản trị vào Cấu hình đặt quy trình mặc định.</p>;
  }
  return (
    <p className={styles.plan}>
      <span>Bước duyệt tiếp theo (theo cấu hình):</span>{' '}
      {workflow.steps.length > 0 ? workflow.steps.map((step) => step.name).join(' → ') : 'không cần duyệt'}
    </p>
  );
}

/** Ô thao tác của bước hiện tại, theo đúng quyền người xem có ở bước đó. */
export function LetterActionPanel(props: ActionProps) {
  const { letter, onDirtyChange } = props;
  const actions = letter.actions;
  useEffect(() => onDirtyChange(false), [letter.stage, letter.currentStepName, onDirtyChange]);

  if (letter.stage === 'archived') return <ArchivedPanel {...props} />;
  if (letter.stage === 'revoking') return <RevokingPanel {...props} />;
  if (letter.stage === 'cancelled') return <CancelledPanel {...props} />;
  if (actions.dispatch) return <DispatchForm {...props} />;
  if (actions.sendToClerk) return <SendToClerkForm {...props} />;
  if (actions.submit) return <SubmitForm {...props} />;
  if (actions.approve) return <ApproveForm {...props} />;
  if (actions.complete) return <CompleteForm {...props} />;
  if (actions.publish) return <PublishForm {...props} />;
  return <WaitingNote {...props} />;
}

function WaitingNote({ letter, onDone }: ActionProps) {
  const pending = letter.assignments.filter((item) => item.status === 'pending');
  const who = letter.currentAssigneeNames.join(', ') || 'người được giao';
  const text = (() => {
    switch (letter.stage) {
      case 'received':
        return 'Văn thư đang phân loại và giao phòng ban xử lý.';
      case 'processing':
        return pending.length > 0
          ? `Đang chờ ${pending.map((item) => (item.handlerName ? `${item.unitName} (${item.handlerName})` : item.unitName)).join(', ')} gửi kết quả.`
          : 'Các phòng ban đã gửi đủ kết quả.';
      case 'drafting':
        return `${letter.authorName ?? 'Người soạn'} đang soạn thảo.`;
      case 'checking':
        return 'Văn thư đang kiểm tra thể thức.';
      case 'reviewing':
        return `Bước "${letter.currentStepName ?? ''}" đang chờ ${who}.`;
      case 'closing':
        return 'Đã duyệt xong, chờ văn thư hoàn tất và lưu trữ.';
      case 'publishing':
        return 'Đã duyệt xong, chờ văn thư đánh số và ban hành.';
      default:
        return '';
    }
  })();
  return (
    <Panel title="Bước hiện tại" tone="muted">
      <p className={styles.muted} style={{ margin: 0 }}>
        {text}
      </p>
      {letter.actions.returnTargets.length > 0 || letter.actions.cancel ? (
        <div className={styles.formActions}>
          <CancelButton letter={letter} onDone={onDone} />
          <ReturnControl letter={letter} onDone={onDone} label="Trả lại văn thư" />
        </div>
      ) : null}
    </Panel>
  );
}

function CancelButton({ letter, onDone }: Pick<ActionProps, 'letter' | 'onDone'>) {
  const [open, setOpen] = useState(false);
  if (!letter.actions.cancel) return null;
  return (
    <>
      <button type="button" className={styles.buttonDanger} onClick={() => setOpen(true)}>
        <Ban size={14} /> Huỷ công văn
      </button>
      <ReasonDialog
        open={open}
        letter={letter}
        title="Huỷ công văn"
        subtitle={`Công văn ${letter.displayNo} dừng xử lý, mọi người liên quan được báo. Số đã cấp vẫn giữ trong sổ.`}
        reasonLabel="Lý do huỷ"
        placeholder="Ví dụ: cơ quan gửi đã thu hồi, vào sổ trùng"
        submitLabel="Huỷ công văn"
        tone="danger"
        onClose={() => setOpen(false)}
        onSubmit={async ({ reason }) => {
          const next = await cancelLetter(letter.id, reason);
          setOpen(false);
          onDone(next, 'Đã huỷ công văn.');
        }}
      />
    </>
  );
}

/** "Không đạt / Trả lại": chọn nơi trả về (mặc định theo cấu hình bước) và ghi lý do. */
function ReturnControl({
  letter,
  onDone,
  label = 'Không đạt, trả lại',
  dialogTitle,
  warning = false,
}: Pick<ActionProps, 'letter' | 'onDone'> & {
  readonly label?: string;
  readonly dialogTitle?: string;
  /** Nút vàng (thao tác chính của bước duyệt) thay vì nút viền. */
  readonly warning?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (letter.actions.returnTargets.length === 0) return null;
  return (
    <>
      <button type="button" className={warning ? styles.buttonWarning : styles.buttonGhost} onClick={() => setOpen(true)}>
        <Undo2 size={14} /> {label}
      </button>
      <ReasonDialog
        open={open}
        letter={letter}
        title={dialogTitle ?? label}
        subtitle="Công văn quay về nơi được chọn kèm lý do; người nhận được báo ngay."
        reasonLabel="Lý do"
        placeholder="Nêu rõ cần sửa, bổ sung gì"
        submitLabel="Xác nhận trả lại"
        tone="warning"
        withTarget
        onClose={() => setOpen(false)}
        onSubmit={async ({ reason, target, assignmentIds }) => {
          if (!target) return;
          const next = await returnLetter(letter.id, { target, reason, assignmentIds });
          setOpen(false);
          onDone(next, `Đã trả về ${returnTargetLabel(target, letter.direction).toLowerCase()}.`);
        }}
      />
    </>
  );
}

/**
 * Hộp thoại nhập lý do dùng chung cho Huỷ và Trả lại: cùng khổ, cùng cách nhập, nút xác nhận
 * theo màu thao tác (đỏ huỷ, vàng trả lại). Trả lại thì chọn nơi trả về và phòng ban phải làm lại.
 */
function ReasonDialog({
  open,
  letter,
  title,
  subtitle,
  reasonLabel,
  placeholder,
  submitLabel,
  tone,
  withTarget = false,
  onClose,
  onSubmit,
}: {
  readonly open: boolean;
  readonly letter: LetterDetail;
  readonly title: string;
  readonly subtitle: string;
  readonly reasonLabel: string;
  readonly placeholder: string;
  readonly submitLabel: string;
  readonly tone: 'danger' | 'warning';
  readonly withTarget?: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (input: { reason: string; target?: ReturnTarget; assignmentIds?: string[] }) => Promise<void>;
}) {
  const targets = letter.actions.returnTargets;
  const initialTarget = letter.actions.defaultReturnTarget ?? targets[0] ?? '';
  const [reason, setReason] = useState('');
  const [target, setTarget] = useState<ReturnTarget | ''>(initialTarget);
  const [units, setUnits] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!open) return;
    setReason('');
    setTarget(initialTarget);
    setUnits([]);
    setError(undefined);
  }, [open, initialTarget]);

  const toUnits = withTarget && target === 'handlers' && letter.direction === 'incoming' && letter.assignments.length > 1;
  const submit = async () => {
    if (!reason.trim()) {
      setError(`Nhập ${reasonLabel.toLowerCase()}.`);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit({
        reason,
        target: withTarget && target ? target : undefined,
        assignmentIds: toUnits && units.length > 0 ? units : undefined,
      });
    } catch (cause) {
      setError(errorMessage(cause, 'Không thực hiện được thao tác.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog
      open={open}
      title={title}
      subtitle={subtitle}
      submitLabel={submitLabel}
      submitting={busy}
      submitDisabled={!reason.trim() || (withTarget && !target)}
      dirty={reason.trim() !== ''}
      tone={tone}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      {withTarget ? (
        targets.length > 1 ? (
          <SelectField label="Trả về" required>
            <SearchableSelect
              options={targets.map((value) => ({
                value,
                label: returnTargetLabel(value, letter.direction),
                description: value === letter.actions.defaultReturnTarget ? 'Mặc định của bước theo cấu hình' : undefined,
              }))}
              value={target}
              searchInDropdown
              hideDropdownSearch
              onChange={(value) => setTarget(value as ReturnTarget)}
            />
          </SelectField>
        ) : (
          <p className={styles.plan}>
            <span>Trả về:</span> {targets[0] ? returnTargetLabel(targets[0], letter.direction) : ''}
          </p>
        )
      ) : null}
      {toUnits ? (
        <CheckGroup label="Phòng ban phải làm lại (bỏ trống là mọi phòng)">
          {letter.assignments.map((item) => (
            <label key={item.id} className={styles.checkRow}>
              <input
                type="checkbox"
                checked={units.includes(item.id)}
                onChange={(event) => setUnits((current) => (event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id)))}
              />
              {item.unitName}
            </label>
          ))}
        </CheckGroup>
      ) : null}
      <Field label={reasonLabel} required>
        <textarea value={reason} maxLength={4000} rows={4} autoFocus placeholder={placeholder} onChange={(event) => setReason(event.target.value)} />
      </Field>
    </FormDialog>
  );
}

/* ---------------------------------------------------------------- công văn đến */

interface UnitPick {
  readonly unitId: string;
  readonly handlerUserId: string;
}

/** Văn thư phân loại, chọn phòng ban (cả phòng hay một người xử lý) và giao. */
function DispatchForm({ letter, config, directory, onDone, onDirtyChange }: ActionProps) {
  const [kind, setKind] = useState(letter.kind);
  const [urgency, setUrgency] = useState(letter.urgency);
  const [confidentiality, setConfidentiality] = useState(letter.confidentiality);
  const initialUnits = useMemo<UnitPick[]>(
    () =>
      letter.assignments.length > 0
        ? letter.assignments.map((item) => ({ unitId: item.unitId, handlerUserId: item.handlerUserId ?? '' }))
        : (config.catalog.find((item) => item.kind === 'letter_type' && item.code === letter.kind)?.defaultUnitIds ?? []).map((unitId) => ({
            unitId,
            handlerUserId: '',
          })),
    [letter, config.catalog],
  );
  const [units, setUnits] = useState<UnitPick[]>(initialUnits);
  const [dueOn, setDueOn] = useState(letter.dueOn ?? localToday());
  const [note, setNote] = useState('');
  const [assignee, setAssignee] = useState('');
  const choice = useStepChoice(letter.id, kind);
  const { busy, error, run } = useRunner(onDone);
  const mustPickHandler = config.settings.dispatchMode === 'handler';
  useEffect(
    () => onDirtyChange(note.trim() !== '' || assignee !== '' || JSON.stringify(units) !== JSON.stringify(initialUnits)),
    [note, assignee, units, initialUnits, onDirtyChange],
  );
  useEffect(() => setAssignee(''), [kind]);

  const changeKind = (value: string) => {
    setKind(value);
    // Chưa chọn phòng nào thì gợi ý phòng ban của loại văn bản.
    if (units.length === 0) {
      const suggested = config.catalog.find((item) => item.kind === 'letter_type' && item.code === value)?.defaultUnitIds ?? [];
      setUnits(suggested.map((unitId) => ({ unitId, handlerUserId: '' })));
    }
  };

  const all = directory?.units ?? [];
  const byId = new Map(all.map((unit) => [unit.id, unit]));
  const missingHandler = mustPickHandler && units.some((unit) => !unit.handlerUserId);
  return (
    <Panel title="Văn thư: phân loại và giao phòng ban xử lý">
      <div className={styles.form}>
        <div className={styles.formRow3}>
          <SelectField label="Loại văn bản" required>
            <SearchableSelect options={catalogOptions(config.catalog, 'letter_type', letter.kind)} value={kind} onChange={changeKind} />
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
          <SelectField label="Độ mật">
            <SearchableSelect
              options={catalogOptions(config.catalog, 'confidentiality', letter.confidentiality)}
              value={confidentiality}
              searchInDropdown
              hideDropdownSearch
              onChange={setConfidentiality}
            />
          </SelectField>
        </div>
        <SelectField label="Phòng ban xử lý" required>
          <SearchableSelect
            options={all
              .filter((unit) => !units.some((item) => item.unitId === unit.id))
              .map((unit) => ({ value: unit.id, label: unit.name, description: [unit.path, `${unit.members.length} người`].filter(Boolean).join(' · ') }))}
            value=""
            placeholder="Tìm và thêm phòng ban theo sơ đồ tổ chức"
            emptyText={directory?.degraded ? 'Chưa đọc được sơ đồ tổ chức, thử lại sau.' : 'Không còn phòng ban nào để thêm.'}
            onChange={(value) => value && setUnits((current) => [...current, { unitId: value, handlerUserId: '' }])}
          />
        </SelectField>
        {units.length > 0 ? (
          <div className={styles.unitPicks}>
            {units.map((pick) => {
              const unit = byId.get(pick.unitId);
              const members = unit?.members ?? [];
              const heads = members.filter((member) => member.isHead);
              return (
                <div key={pick.unitId} className={styles.unitPick}>
                  <div className={styles.unitPickHead}>
                    <div className={styles.listMain}>
                      <b>{unit?.name ?? 'Phòng ban không còn trong sơ đồ'}</b>
                      <span className={styles.hint}>
                        {members.length} người · Trưởng đơn vị: {heads.map((member) => member.name).join(', ') || 'chưa có'}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label={`Bỏ ${unit?.name ?? 'phòng ban'}`}
                      onClick={() => setUnits((current) => current.filter((item) => item.unitId !== pick.unitId))}
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <SearchableSelect
                    options={members.map((member) => ({
                      value: member.userId,
                      label: member.name,
                      description: [member.positionName, member.isHead ? 'Trưởng đơn vị' : undefined].filter(Boolean).join(' · ') || undefined,
                    }))}
                    value={pick.handlerUserId}
                    placeholder={mustPickHandler ? 'Chọn người xử lý (bắt buộc)' : 'Cả phòng cùng nhận (hoặc chọn một người xử lý)'}
                    clearable
                    emptyText="Phòng chưa có ai trong sơ đồ tổ chức."
                    onChange={(value) =>
                      setUnits((current) => current.map((item) => (item.unitId === pick.unitId ? { ...item, handlerUserId: value ?? '' } : item)))
                    }
                  />
                </div>
              );
            })}
          </div>
        ) : null}
        <div className={styles.formRow}>
          <Field label="Hạn xử lý">
            <input type="date" value={dueOn} min={letter.receivedOn} onChange={(event) => setDueOn(event.target.value)} />
          </Field>
          <Field label="Ghi chú cho phòng ban">
            <input value={note} maxLength={4000} placeholder="Yêu cầu, lưu ý khi xử lý" onChange={(event) => setNote(event.target.value)} />
          </Field>
        </div>
        <PlannedSteps config={config} letter={letter} kind={kind} />
        <ChoiceField choice={choice} value={assignee} onChange={setAssignee} />
        <ErrorLine error={error} />
        <div className={styles.formActions}>
          <CancelButton letter={letter} onDone={onDone} />
          <button
            type="button"
            className={styles.buttonPrimary}
            disabled={busy || !kind || !urgency || units.length === 0 || missingHandler || choice === undefined || (Boolean(choice) && !assignee)}
            title={missingHandler ? 'Cấu hình yêu cầu chọn một người xử lý cho mỗi phòng' : undefined}
            onClick={() =>
              run(
                () =>
                  dispatchLetter(letter.id, {
                    kind,
                    urgency,
                    confidentiality,
                    units: units.map((item) => ({ unitId: item.unitId, handlerUserId: item.handlerUserId || undefined })),
                    dueOn: dueOn || undefined,
                    note: note || undefined,
                    assigneeUserId: assignee || undefined,
                  }),
                `Đã giao ${units.length} phòng ban xử lý.`,
              )
            }
          >
            Giao xử lý
          </button>
        </div>
      </div>
    </Panel>
  );
}

function CompleteForm({ letter, onDone, onDirtyChange }: ActionProps) {
  const [note, setNote] = useState('');
  const { busy, error, run } = useRunner(onDone);
  useEffect(() => onDirtyChange(note.trim() !== ''), [note, onDirtyChange]);
  return (
    <Panel title="Văn thư: hoàn tất và lưu trữ">
      <div className={styles.form}>
        <p className={styles.muted} style={{ margin: 0 }}>
          Phòng ban đã xử lý và lãnh đạo đã duyệt. Kiểm kết quả ở mục Phòng ban xử lý; hoàn tất để cấp số hồ sơ, ghi lên thư
          mục hồ sơ trong kho lưu trữ.
        </p>
        <Field label="Ghi chú hoàn tất">
          <textarea value={note} maxLength={4000} rows={2} placeholder="Ví dụ: đã gửi văn bản trả lời số …" onChange={(event) => setNote(event.target.value)} />
        </Field>
        <ErrorLine error={error} />
        <div className={styles.formActions}>
          <ReturnControl letter={letter} onDone={onDone} />
          <button type="button" className={styles.buttonPrimary} disabled={busy} onClick={() => run(() => completeLetter(letter.id, note || undefined), 'Đã hoàn tất, lưu trữ hồ sơ.')}>
            Hoàn tất, lưu trữ
          </button>
        </div>
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------- công văn đi */

function SendToClerkForm({ letter, onDone, onDirtyChange }: ActionProps) {
  const [note, setNote] = useState('');
  const { busy, error, run } = useRunner(onDone);
  useEffect(() => onDirtyChange(note.trim() !== ''), [note, onDirtyChange]);
  const drafts = letter.attachments.filter((item) => item.kind === 'draft').length;
  return (
    <Panel title="Soạn thảo: gửi văn thư kiểm tra">
      <div className={styles.form}>
        <p className={styles.muted} style={{ margin: 0 }}>
          {drafts > 0 ? `Đã có ${drafts} tệp dự thảo.` : 'Tải tệp dự thảo ở mục Tệp của hồ sơ trước khi gửi.'} Văn thư kiểm tra thể thức
          rồi trình duyệt theo quy trình cấu hình.
        </p>
        <Field label="Ghi chú cho văn thư">
          <textarea value={note} maxLength={2000} rows={2} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <ErrorLine error={error} />
        <div className={styles.formActions}>
          <CancelButton letter={letter} onDone={onDone} />
          <button type="button" className={styles.buttonPrimary} disabled={busy} onClick={() => run(() => sendToClerk(letter.id, note || undefined), 'Đã gửi văn thư kiểm tra.')}>
            Gửi văn thư kiểm tra
          </button>
        </div>
      </div>
    </Panel>
  );
}

/** Văn thư kiểm tra thể thức: đạt thì trình duyệt theo quy trình cấu hình, không đạt thì trả người soạn. */
function SubmitForm({ letter, config, onDone, onDirtyChange }: ActionProps) {
  const [assignee, setAssignee] = useState('');
  const [note, setNote] = useState('');
  const choice = useStepChoice(letter.id);
  const { busy, error, run } = useRunner(onDone);
  useEffect(() => onDirtyChange(note.trim() !== '' || assignee !== ''), [note, assignee, onDirtyChange]);
  const workflow = plannedWorkflow(config, 'outgoing', letter.kind);
  return (
    <Panel title="Văn thư: kiểm tra thể thức">
      <div className={styles.form}>
        <PlannedSteps config={config} letter={letter} kind={letter.kind} />
        <ChoiceField choice={choice} value={assignee} onChange={setAssignee} />
        <Field label="Ghi chú khi trình">
          <textarea value={note} maxLength={2000} rows={2} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <ErrorLine error={error} />
        <div className={styles.formActions}>
          <CancelButton letter={letter} onDone={onDone} />
          <ReturnControl letter={letter} onDone={onDone} label="Không đạt, trả người soạn" />
          <button
            type="button"
            className={styles.buttonPrimary}
            disabled={busy || !workflow || choice === undefined || (Boolean(choice) && !assignee)}
            onClick={() =>
              run(
                () => submitLetter(letter.id, { assigneeUserId: assignee || undefined, note: note || undefined }),
                workflow && workflow.steps.length > 0 ? 'Đã trình duyệt.' : 'Đã chuyển ban hành.',
              )
            }
          >
            {workflow && workflow.steps.length === 0 ? 'Đạt, chuyển ban hành' : 'Đạt, trình duyệt'}
          </button>
        </div>
      </div>
    </Panel>
  );
}

function PublishForm({ letter, onDone, onDirtyChange }: ActionProps) {
  const [recipient, setRecipient] = useState(letter.recipient ?? '');
  const [publishedOn, setPublishedOn] = useState(localToday());
  const [deliveryMethod, setDeliveryMethod] = useState('');
  const [note, setNote] = useState('');
  const { busy, error, run } = useRunner(onDone);
  useEffect(
    () => onDirtyChange(recipient !== (letter.recipient ?? '') || deliveryMethod.trim() !== '' || note.trim() !== ''),
    [recipient, deliveryMethod, note, letter, onDirtyChange],
  );
  const signed = letter.attachments.some((item) => item.kind === 'outgoing');
  return (
    <Panel title="Văn thư: đánh số, ban hành">
      <div className={styles.form}>
        {!signed ? <p className={styles.notice}>Chưa có bản ban hành đã ký. Tải ở mục Tệp của hồ sơ (trước hoặc sau khi đánh số).</p> : null}
        <div className={styles.formRow}>
          <Field label="Nơi nhận" required>
            <input value={recipient} maxLength={255} onChange={(event) => setRecipient(event.target.value)} />
          </Field>
          <Field label="Ngày ban hành">
            <input type="date" value={publishedOn} onChange={(event) => setPublishedOn(event.target.value)} />
          </Field>
        </div>
        <div className={styles.formRow}>
          <Field label="Hình thức gửi">
            <input value={deliveryMethod} maxLength={120} placeholder="Bưu điện, thư điện tử, trục liên thông…" onChange={(event) => setDeliveryMethod(event.target.value)} />
          </Field>
          <Field label="Ghi chú">
            <input value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </div>
        <ErrorLine error={error} />
        <div className={styles.formActions}>
          <ReturnControl letter={letter} onDone={onDone} />
          <button
            type="button"
            className={styles.buttonPrimary}
            disabled={busy || !recipient.trim()}
            onClick={() =>
              run(
                () => publishLetter(letter.id, { recipient, publishedOn: publishedOn || undefined, deliveryMethod: deliveryMethod || undefined, note: note || undefined }),
                'Đã đánh số, ban hành và lưu trữ.',
              )
            }
          >
            Đánh số, ban hành
          </button>
        </div>
      </div>
    </Panel>
  );
}

function ArchivedPanel({ letter, onDone, onDirtyChange }: ActionProps) {
  const [status, setStatus] = useState<DeliveryStatus>(letter.deliveryStatus ?? 'sent');
  // Ô ngày điền sẵn hôm nay; chỉ tính là đã sửa khi khác ngày ban đầu đó.
  const initialDelivered = letter.deliveredOn ?? localToday();
  const [deliveredOn, setDeliveredOn] = useState(initialDelivered);
  const [note, setNote] = useState('');
  const { busy, error, run } = useRunner(onDone);
  useEffect(
    () => onDirtyChange(status !== (letter.deliveryStatus ?? 'sent') || deliveredOn !== initialDelivered || note.trim() !== ''),
    [status, deliveredOn, initialDelivered, note, letter, onDirtyChange],
  );
  return (
    <Panel title="Hồ sơ đã lưu trữ" tone="done">
      <p className={styles.muted} style={{ margin: 0 }}>
        Số hồ sơ {letter.archiveCode}, ngày {formatDay(letter.archivedOn)}.
        {letter.outgoingNo ? ` Ban hành số ${letter.outgoingNo} ngày ${formatDay(letter.publishedOn)} gửi ${letter.recipient}.` : ''}
        {letter.completionNote ? ` ${letter.completionNote}` : ''} Tệp xem ở mục Tệp của hồ sơ hay Kho lưu trữ.
      </p>
      {letter.actions.updateDelivery ? (
        <div className={styles.form}>
          <div className={styles.formRow3}>
            <SelectField label="Tình trạng gửi">
              <SearchableSelect
                options={DELIVERY_STATUSES.map((value) => ({ value, label: DELIVERY_STATUS_LABELS[value] }))}
                value={status}
                searchInDropdown
                hideDropdownSearch
                onChange={(value) => setStatus(value as DeliveryStatus)}
              />
            </SelectField>
            <Field label="Ngày">
              <input type="date" value={deliveredOn} onChange={(event) => setDeliveredOn(event.target.value)} />
            </Field>
            <Field label="Ghi chú">
              <input value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} />
            </Field>
          </div>
          <ErrorLine error={error} />
          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.buttonGhost}
              disabled={busy}
              onClick={() =>
                run(() => updateDelivery(letter.id, { status, deliveredOn: deliveredOn || undefined, note: note || undefined }), 'Đã cập nhật tình trạng gửi.')
              }
            >
              Cập nhật tình trạng gửi
            </button>
          </div>
        </div>
      ) : letter.deliveryStatus ? (
        <p className={styles.muted} style={{ margin: '6px 0 0' }}>
          Tình trạng gửi: {DELIVERY_STATUS_LABELS[letter.deliveryStatus]}
          {letter.deliveredOn ? ` · ${formatDay(letter.deliveredOn)}` : ''}
        </p>
      ) : null}
      {letter.actions.requestRevoke ? (
        <div className={styles.formActions}>
          <RevokeRequestButton letter={letter} onDone={onDone} />
        </div>
      ) : null}
    </Panel>
  );
}

/**
 * Văn thư đề nghị huỷ công văn đã ban hành / hoàn tất: chọn thu hồi hay sửa đổi, thay thế và ghi
 * lý do; người có thẩm quyền ở bước duyệt cuối của quy trình xác nhận.
 */
function RevokeRequestButton({ letter, onDone }: Pick<ActionProps, 'letter' | 'onDone'>) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<RevokeKind>('recall');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!open) return;
    setKind('recall');
    setReason('');
    setError(undefined);
  }, [open]);
  const approver = [...letter.steps].reverse().find((step) => step.status === 'done');
  const submit = async () => {
    if (!reason.trim()) {
      setError('Nhập lý do.');
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const next = await requestRevoke(letter.id, { kind, reason });
      setOpen(false);
      onDone(next, next.stage === 'cancelled' ? 'Đã huỷ công văn.' : 'Đã gửi đề nghị huỷ, chờ người có thẩm quyền xác nhận.');
    } catch (cause) {
      setError(errorMessage(cause, 'Không gửi được đề nghị huỷ.'));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <>
      <button type="button" className={styles.buttonDanger} onClick={() => setOpen(true)}>
        <ShieldX size={14} /> Đề nghị huỷ công văn
      </button>
      <FormDialog
        open={open}
        title="Đề nghị huỷ công văn"
        subtitle={
          approver
            ? `Công văn ${letter.displayNo} đã ${letter.direction === 'outgoing' ? 'ban hành' : 'hoàn tất'}. Đề nghị chuyển tới người có thẩm quyền của bước "${approver.name}" xác nhận; chưa xác nhận thì công văn vẫn giữ nguyên.`
            : `Công văn ${letter.displayNo} không qua bước duyệt nào nên huỷ ngay khi gửi.`
        }
        submitLabel={approver ? 'Gửi đề nghị' : 'Huỷ công văn'}
        tone="danger"
        submitting={submitting}
        dirty={reason.trim() !== ''}
        error={error}
        onClose={() => setOpen(false)}
        onSubmit={() => void submit()}
      >
        <div className={styles.field} role="radiogroup" aria-label="Hình thức">
          <span className={styles.fieldLabel}>
            Hình thức<span className={styles.required}> *</span>
          </span>
          <div className={styles.choiceRow}>
            {REVOKE_KINDS.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={kind === value}
                className={kind === value ? `${styles.choice} ${styles.choiceActive}` : styles.choice}
                onClick={() => setKind(value)}
              >
                <b>{REVOKE_KIND_LABELS[value]}</b>
                <span>{value === 'recall' ? 'Công văn hết hiệu lực, thu hồi về.' : 'Huỷ để thay bằng văn bản sửa đổi, ban hành lại.'}</span>
              </button>
            ))}
          </div>
        </div>
        <Field label="Lý do" required>
          <textarea
            value={reason}
            maxLength={2000}
            rows={4}
            autoFocus
            placeholder="Ví dụ: sai số liệu tại mục 2, cần ban hành văn bản thay thế"
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </FormDialog>
    </>
  );
}

function RevokeSummary({ letter }: { readonly letter: LetterDetail }) {
  const revoke = letter.revoke;
  if (!revoke) return null;
  return (
    <dl className={styles.revokeInfo}>
      <div>
        <dt>Hình thức</dt>
        <dd>{revoke.kindLabel}</dd>
      </div>
      <div>
        <dt>Người đề nghị</dt>
        <dd>
          {revoke.requestedByName ?? 'Văn thư'}
          {revoke.requestedAt ? ` · ${formatDateTime(revoke.requestedAt)}` : ''}
        </dd>
      </div>
      <div className={styles.revokeWide}>
        <dt>Lý do</dt>
        <dd>{revoke.reason}</dd>
      </div>
      {letter.stage === 'revoking' ? (
        <div className={styles.revokeWide}>
          <dt>Người xác nhận</dt>
          <dd>{revoke.approverNames.join(', ') || 'Người có thẩm quyền của bước duyệt cuối'}</dd>
        </div>
      ) : null}
    </dl>
  );
}

/** Đề nghị huỷ đang chờ: người có thẩm quyền đồng ý / không; văn thư rút đề nghị. */
function RevokingPanel({ letter, onDone, onDirtyChange }: ActionProps) {
  const [note, setNote] = useState('');
  const { busy, error, run } = useRunner(onDone);
  const actions = letter.actions;
  useEffect(() => onDirtyChange(note.trim() !== ''), [note, onDirtyChange]);
  return (
    <Panel title="Đề nghị huỷ công văn">
      <RevokeSummary letter={letter} />
      {actions.decideRevoke ? (
        <div className={styles.form}>
          <Field label="Ý kiến (nếu có)">
            <textarea value={note} maxLength={2000} rows={2} placeholder="Ý kiến kèm theo quyết định" onChange={(event) => setNote(event.target.value)} />
          </Field>
          <ErrorLine error={error} />
          <div className={styles.formActions}>
            <Popconfirm
              title="Giữ nguyên công văn?"
              description="Đề nghị huỷ bị từ chối, công văn về lại đã lưu trữ."
              okText="Không huỷ"
              cancelText="Xem lại"
              okType="primary"
              placement="top-end"
              disabled={busy}
              onConfirm={() => run(() => decideRevoke(letter.id, { approve: false, note: note || undefined }), 'Đã giữ nguyên công văn.')}
            >
              <button type="button" className={styles.buttonGhost} disabled={busy}>
                Không huỷ
              </button>
            </Popconfirm>
            <Popconfirm
              title="Đồng ý huỷ công văn này?"
              description={`Công văn ${letter.displayNo} chuyển sang đã huỷ; mọi người liên quan được báo.`}
              okText="Đồng ý huỷ"
              cancelText="Xem lại"
              okType="danger"
              placement="top-end"
              disabled={busy}
              onConfirm={() => run(() => decideRevoke(letter.id, { approve: true, note: note || undefined }), 'Đã đồng ý huỷ công văn.')}
            >
              <button type="button" className={styles.buttonDangerSolid} disabled={busy}>
                <Ban size={14} /> Đồng ý huỷ
              </button>
            </Popconfirm>
          </div>
        </div>
      ) : (
        <>
          <p className={styles.sectionNote}>Đang chờ người có thẩm quyền xác nhận. Công văn vẫn giữ nguyên cho tới khi được đồng ý huỷ.</p>
          <ErrorLine error={error} />
          {actions.withdrawRevoke ? (
            <div className={styles.formActions}>
              <Popconfirm
                title="Rút đề nghị huỷ?"
                description="Công văn về lại đã lưu trữ; người xác nhận được báo không cần xử lý nữa."
                okText="Rút đề nghị"
                cancelText="Xem lại"
                okType="warning"
                placement="top-end"
                disabled={busy}
                onConfirm={() => run(() => withdrawRevoke(letter.id), 'Đã rút đề nghị huỷ.')}
              >
                <button type="button" className={styles.buttonGhost} disabled={busy}>
                  <Undo2 size={14} /> Rút đề nghị
                </button>
              </Popconfirm>
            </div>
          ) : null}
        </>
      )}
    </Panel>
  );
}

/** Công văn đã huỷ: lý do; văn thư xoá được khỏi Văn thư. */
function CancelledPanel({ letter, onRemoved }: ActionProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const remove = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await removeLetter(letter.id);
      onRemoved?.(`Đã xoá công văn ${letter.displayNo}.`);
    } catch (cause) {
      setError(errorMessage(cause, 'Không xoá được công văn.'));
      setBusy(false);
    }
  };
  return (
    <Panel title="Công văn đã huỷ" tone="muted">
      {letter.revoke ? <RevokeSummary letter={letter} /> : <p className={styles.sectionNote}>Lý do: {letter.cancelReason}</p>}
      <ErrorLine error={error} />
      {letter.actions.remove ? (
        <div className={styles.formActions}>
          <Popconfirm
            title="Xoá công văn khỏi Văn thư?"
            description="Công văn không còn trong danh sách, kho lưu trữ và báo cáo; tệp chuyển vào Thùng rác của Hệ dùng chung. Số đã cấp không cấp lại."
            okText="Xoá công văn"
            cancelText="Giữ lại"
            okType="danger"
            placement="top-end"
            disabled={busy}
            onConfirm={() => remove()}
          >
            <button type="button" className={styles.buttonDanger} disabled={busy}>
              <Trash2 size={14} /> Xoá công văn
            </button>
          </Popconfirm>
        </div>
      ) : null}
    </Panel>
  );
}

/* ---------------------------------------------------------------- duyệt */

/** Bước tiếp theo trên thanh tiến trình, để hỏi xác nhận nói rõ công văn sẽ đi đâu. */
function nextStepLabel(letter: LetterDetail): string | undefined {
  const at = letter.flow.findIndex((node) => node.state === 'current');
  return at >= 0 ? letter.flow[at + 1]?.label : undefined;
}

/**
 * Bước duyệt: một thao tác. "Duyệt" hỏi xác nhận ngay tại nút (tránh bấm nhầm) rồi chuyển bước;
 * "Không đạt" mở hộp thoại chọn nơi trả về và bắt nhập lý do.
 */
function ApproveForm({ letter, onDone, onDirtyChange }: ActionProps) {
  const [note, setNote] = useState('');
  const [next, setNext] = useState('');
  const choice = useStepChoice(letter.id);
  const { busy, error, run } = useRunner(onDone);
  useEffect(() => onDirtyChange(note.trim() !== '' || next !== ''), [note, next, onDirtyChange]);
  const ready = !busy && choice !== undefined && (!choice || Boolean(next));
  const after = nextStepLabel(letter);
  return (
    <Panel title={letter.currentStepName ?? 'Duyệt'}>
      <div className={styles.form}>
        {letter.direction === 'incoming' && letter.assignments.length > 0 ? (
          <p className={styles.sectionNote}>
            Kết quả của {letter.assignments.map((item) => item.unitName).join(', ')} ở mục Phòng ban xử lý bên dưới.
          </p>
        ) : null}
        <Field label="Ý kiến (nếu có)">
          <textarea value={note} maxLength={4000} rows={3} placeholder="Ý kiến kèm theo khi duyệt" onChange={(event) => setNote(event.target.value)} />
        </Field>
        <ChoiceField choice={choice} value={next} onChange={setNext} />
        <ErrorLine error={error} />
        <div className={styles.formActions}>
          <ReturnControl letter={letter} onDone={onDone} label="Không đạt" dialogTitle="Không đạt, trả lại" warning />
          <Popconfirm
            title="Duyệt công văn này?"
            description={after ? `Công văn chuyển sang bước "${after}".` : 'Công văn chuyển sang bước tiếp theo.'}
            okText="Duyệt"
            cancelText="Xem lại"
            okType="primary"
            placement="top-end"
            disabled={!ready}
            onConfirm={() => run(() => approveLetter(letter.id, { note: note || undefined, nextAssigneeUserId: next || undefined }), 'Đã duyệt, chuyển bước tiếp theo.')}
          >
            <button type="button" className={styles.buttonPrimary} disabled={!ready}>
              <CheckCircle2 size={15} /> Duyệt
            </button>
          </Popconfirm>
        </div>
      </div>
    </Panel>
  );
}
