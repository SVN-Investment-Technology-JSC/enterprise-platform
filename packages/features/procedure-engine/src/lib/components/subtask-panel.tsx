'use client';

import type { TenantOrganizationSnapshot } from '@enterprise-platform/contracts-organization';
import type {
  ProcedureAttachment,
  ProcedureInstance,
  ProcedureSubtask,
  ProcedureSubtaskInput,
} from '@enterprise-platform/contracts-procedure-engine';
import { useMemo, useRef, useState } from 'react';
import styles from './workspace-board.module.scss';

const STATUS_LABEL: Record<ProcedureSubtask['status'], string> = {
  open: 'Chưa làm',
  in_progress: 'Đang làm',
  completed: 'Xong',
  cancelled: 'Bỏ',
};

/** Nhãn của một đầu việc trong template lấy từ Kho — template không có kiểu chặt. */
function templateLabel(entry: Record<string, unknown>, index: number): string {
  for (const key of ['name', 'title', 'step', 'label']) {
    const value = entry[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return `Đầu việc ${index + 1}`;
}

function templateKey(entry: Record<string, unknown>): string | undefined {
  const value = entry['key'];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Chia đều 100 rồi dồn phần dư vào phần tử cuối, tránh tổng lệch 99.99. */
function evenWeights(count: number): number[] {
  if (count === 0) return [];
  const base = Math.floor(10_000 / count);
  const shares = new Array(count).fill(base);
  shares[count - 1] += 10_000 - base * count;
  return shares.map((share) => share / 100);
}

/**
 * Phân rã công việc của vai trò E — E(x) trong mô hình RACI+E.
 *
 * Danh sách đầu việc đã đóng băng vào phân công E lúc công bố, lấy từ hồ sơ thiết
 * bị bên Kho. Người phụ trách đơn vị (giữ E) chia trọng số và giao từng đầu việc
 * cho thành viên đơn vị mình; mỗi người phải đính kèm bằng chứng trước khi đánh
 * dấu xong, và bước chỉ kết thúc khi mọi đầu việc đã được xử lý.
 */
export function SubtaskPanel({
  instance,
  organization,
  actorId,
  busy,
  attachments,
  onSeed,
  onSetItems,
  onComplete,
  onCancel,
  onUpload,
}: {
  instance: ProcedureInstance;
  organization?: TenantOrganizationSnapshot;
  actorId?: string;
  busy?: string;
  attachments: readonly ProcedureAttachment[];
  onSeed: () => void;
  onSetItems: (items: ProcedureSubtaskInput[]) => void;
  onComplete: (subtaskId: string) => void;
  onCancel: (subtaskId: string) => void;
  onUpload: (subtaskId: string, file: File) => void;
}) {
  const step = instance.steps.find((item) => item.id === instance.currentStepId);
  const eAssignment = step?.assignments.find((item) => item.role === 'E');
  const template = (eAssignment?.eTaskConfig?.taskTemplate ?? []) as Record<string, unknown>[];

  const subtasks = useMemo(
    () => (instance.subtasks ?? []).filter((item) => item.stepInstanceId === step?.id),
    [instance.subtasks, step?.id],
  );

  /**
   * Người có thể nhận đầu việc: thành viên của đơn vị mà vai trò E đại diện, cộng
   * thành viên của mọi đơn vị mà chính người đang xem đang phụ trách.
   *
   * Vế thứ hai là cần thiết: một trưởng đơn vị giữ E vẫn phải giao được việc cho
   * cấp dưới của mình, kể cả khi E được gán đích danh họ thay vì gán ở cấp đơn vị.
   */
  const candidates = useMemo(() => {
    const members = organization?.members ?? [];
    if (members.length === 0) return [];

    const unitIds = new Set<string>();
    if (eAssignment?.subjectType === 'organization_unit') unitIds.add(eAssignment.subjectId);
    for (const member of members) {
      if (member.isHead && member.userId === actorId && member.unitId) unitIds.add(member.unitId);
    }
    if (unitIds.size === 0) return [];

    const seen = new Set<string>();
    return members
      .filter((member) => {
        if (!member.unitId || !unitIds.has(member.unitId)) return false;
        if (seen.has(member.userId)) return false;
        seen.add(member.userId);
        return true;
      })
      .sort((left, right) => left.displayName.localeCompare(right.displayName, 'vi'));
  }, [organization, eAssignment, actorId]);

  const evidenceOf = (subtaskId: string) =>
    attachments.filter((item) => item.subtaskId === subtaskId);

  const [draft, setDraft] = useState<ProcedureSubtaskInput[]>();
  const fileInputs = useRef(new Map<string, HTMLInputElement | null>());

  const canManage = instance.authorization?.canManageSubtasks ?? false;
  const mine = new Set(instance.authorization?.mySubtaskIds ?? []);

  if (!step || !eAssignment) return null;

  const total = (draft ?? []).reduce((sum, item) => sum + (Number(item.weight) || 0), 0);
  const resolved = subtasks.filter(
    (item) => item.status === 'completed' || item.status === 'cancelled',
  ).length;
  const doneWeight = subtasks
    .filter((item) => item.status === 'completed')
    .reduce((sum, item) => sum + item.weight, 0);

  const openEditor = () => {
    if (subtasks.length > 0) {
      setDraft(
        subtasks.map((item) => ({
          title: item.title,
          weight: item.weight,
          assigneeId: item.assigneeId,
          assigneeName: item.assigneeName,
        })),
      );
      return;
    }
    const weights = evenWeights(template.length);
    const base: ProcedureSubtaskInput[] = template.map((entry, index) => ({
      title: templateLabel(entry, index),
      weight: weights[index],
    }));
    setDraft(base.length > 0 ? base : [{ title: '', weight: 100 }]);
  };

  const patchDraft = (index: number, change: Partial<ProcedureSubtaskInput>) =>
    setDraft((rows) =>
      (rows ?? []).map((row, position) => (position === index ? { ...row, ...change } : row)),
    );

  return (
    <article className={styles.panel}>
      <header className={styles.actionHead}>
        <h3 className={styles.panelTitle}>
          <i className={`${styles.role} ${styles.roleE}`}>E</i> Phân rã công việc
        </h3>
        {subtasks.length > 0 ? (
          <span className={styles.stepBadge}>
            {resolved}/{subtasks.length} xử lý · {Math.round(doneWeight * 100) / 100}% khối lượng
          </span>
        ) : null}
      </header>

      <p className={styles.panelHint}>
        {template.length > 0 ? (
          <>
            Thiết bị <strong>{eAssignment.eTaskConfig?.assetCode}</strong> có {template.length} đầu
            việc mặc định, đã đóng băng khi công bố quy trình. Giao từng đầu việc cho thành viên
            đơn vị bạn phụ trách; mỗi người phải đính kèm bằng chứng trước khi đánh dấu xong.
          </>
        ) : (
          <>
            Phân công E ở bước này chưa có danh sách đầu việc từ Kho — hãy tự nhập các đầu việc và
            trọng số.
          </>
        )}
      </p>

      {template.length > 0 && subtasks.length === 0 && draft === undefined ? (
        <ol className={styles.templateList}>
          {template.map((entry, index) => (
            <li key={index}>
              {templateKey(entry) ? (
                <span className={styles.taskKey}>{templateKey(entry)}</span>
              ) : null}
              {templateLabel(entry, index)}
            </li>
          ))}
        </ol>
      ) : null}

      {subtasks.length > 0 ? (
        <ul className={styles.subtaskList}>
          {subtasks.map((subtask) => {
            const evidence = evidenceOf(subtask.id);
            const isMine = mine.has(subtask.id);
            const pending = subtask.status !== 'completed' && subtask.status !== 'cancelled';
            const canFinish = (canManage || isMine) && pending;

            return (
              <li key={subtask.id} className={styles[`sub_${subtask.status}`]}>
                <div className={styles.subtaskHead}>
                  <span className={styles.subtaskWeight}>{subtask.weight}%</span>
                  <span className={styles.subtaskTitle}>
                    {subtask.title}
                    {isMine ? <em className={styles.mineTag}>việc của bạn</em> : null}
                  </span>
                  <span className={styles.subtaskStatus}>{STATUS_LABEL[subtask.status]}</span>
                </div>

                <div className={styles.subtaskMeta}>
                  <span>
                    {subtask.assigneeName ??
                      (subtask.assigneeId ? 'Đã giao' : 'Chưa giao cho ai')}
                  </span>
                  <span>
                    {evidence.length > 0
                      ? `${evidence.length} tài liệu`
                      : pending
                        ? 'chưa có tài liệu'
                        : ''}
                  </span>
                </div>

                {evidence.length > 0 ? (
                  <ul className={styles.evidenceList}>
                    {evidence.map((file) => (
                      <li key={file.id}>
                        {file.downloadUrl ? (
                          <a href={file.downloadUrl} target="_blank" rel="noreferrer">
                            {file.fileName}
                          </a>
                        ) : (
                          file.fileName
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {canFinish ? (
                  <div className={styles.subtaskActions}>
                    <input
                      type="file"
                      hidden
                      ref={(element) => {
                        fileInputs.current.set(subtask.id, element);
                      }}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) onUpload(subtask.id, file);
                        event.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      disabled={busy === `upload:${subtask.id}`}
                      onClick={() => fileInputs.current.get(subtask.id)?.click()}
                    >
                      {busy === `upload:${subtask.id}` ? 'Đang tải…' : '+ Đính kèm'}
                    </button>
                    <button
                      type="button"
                      disabled={busy === `subtask-done:${subtask.id}` || evidence.length === 0}
                      title={
                        evidence.length === 0
                          ? 'Phải đính kèm ít nhất một tài liệu làm bằng chứng trước khi đánh dấu xong.'
                          : undefined
                      }
                      onClick={() => onComplete(subtask.id)}
                    >
                      Xong
                    </button>
                    {canManage ? (
                      <button
                        type="button"
                        disabled={busy === `subtask-cancel:${subtask.id}`}
                        onClick={() => onCancel(subtask.id)}
                      >
                        Bỏ
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {!canManage ? (
        mine.size === 0 ? (
          <p className={styles.panelHint}>
            Chỉ người phụ trách đơn vị (giữ vai trò E) mới phân rã được công việc.
          </p>
        ) : null
      ) : draft !== undefined ? (
        <div className={styles.subtaskEditor}>
          {draft.map((item, index) => (
            <div key={index} className={styles.subtaskDraft}>
              <div className={styles.subtaskRow}>
                <input
                  placeholder="Tên đầu việc"
                  value={item.title}
                  onChange={(event) => patchDraft(index, { title: event.target.value })}
                />
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  aria-label="Trọng số phần trăm"
                  value={item.weight}
                  onChange={(event) => patchDraft(index, { weight: Number(event.target.value) })}
                />
                <button
                  type="button"
                  className={styles.subtaskRemove}
                  aria-label="Xoá đầu việc"
                  onClick={() => setDraft((rows) => (rows ?? []).filter((_, p) => p !== index))}
                >
                  ×
                </button>
              </div>
              <select
                className={styles.assigneeSelect}
                value={item.assigneeId ?? ''}
                onChange={(event) => {
                  const member = candidates.find((c) => c.userId === event.target.value);
                  patchDraft(index, {
                    assigneeId: member?.userId,
                    assigneeName: member?.displayName,
                  });
                }}
              >
                <option value="">— Chưa giao cho ai —</option>
                {candidates.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.displayName}
                    {member.positionName ? ` · ${member.positionName}` : ''}
                  </option>
                ))}
              </select>
            </div>
          ))}

          {candidates.length === 0 ? (
            <p className={styles.panelHint}>
              Không tìm thấy nhân sự nào để giao việc: bạn chưa được đặt làm người phụ trách đơn vị
              nào, và vai trò E ở bước này cũng không gán ở cấp đơn vị. Vẫn lưu được phân rã, nhưng
              bạn phải tự thực hiện.
            </p>
          ) : null}

          <div className={styles.subtaskFoot}>
            <button
              type="button"
              className={styles.ghost}
              onClick={() => setDraft((rows) => [...(rows ?? []), { title: '', weight: 0 }])}
            >
              + Đầu việc
            </button>
            <span className={total === 100 ? styles.totalOk : styles.totalBad}>
              Tổng {Math.round(total * 100) / 100}/100
            </span>
          </div>

          <div className={styles.actionRow}>
            <button
              type="button"
              className={styles.primary}
              disabled={busy === 'subtasks' || Math.round(total * 100) !== 10_000}
              onClick={() => {
                onSetItems((draft ?? []).filter((item) => item.title.trim() && item.weight > 0));
                setDraft(undefined);
              }}
            >
              Lưu phân rã
            </button>
            <button type="button" className={styles.ghost} onClick={() => setDraft(undefined)}>
              Huỷ
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.actionRow}>
          {subtasks.length === 0 && template.length > 0 ? (
            <button
              type="button"
              className={styles.primary}
              disabled={busy === 'subtasks'}
              onClick={onSeed}
              title="Tạo đầu việc theo danh sách của thiết bị, trọng số theo thời lượng."
            >
              Nạp {template.length} đầu việc từ thiết bị
            </button>
          ) : null}
          <button type="button" className={styles.ghost} onClick={openEditor}>
            {subtasks.length === 0 ? 'Tự nhập đầu việc' : 'Sửa phân rã & giao việc'}
          </button>
        </div>
      )}
    </article>
  );
}
