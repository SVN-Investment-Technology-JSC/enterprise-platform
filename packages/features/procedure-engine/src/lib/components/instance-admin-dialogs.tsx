'use client';

import type {
  ProcedureInstance,
  RelinkProcedureWorkspaceRequest,
} from '@enterprise-platform/contracts-procedure-engine';
import { MinimalPopupForm, SearchableSelect } from '@enterprise-platform/shared-ui';
import { useEffect, useState } from 'react';
import {
  loadProjectWorkItems,
  loadRelatedProjects,
  type ProjectWorkItemOption,
  type RelatedProject,
} from '../workspace-api';
import { WorkItemTreePicker } from './work-item-tree-picker';
import styles from './workspace-board.module.scss';

const errorText = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

/**
 * Xoá đơn (xoá mềm): bắt buộc lý do. Đơn biến mất khỏi mọi màn hình, lịch sử xử lý vẫn lưu để tra
 * cứu; công việc liên kết trong dự án bị xoá theo.
 */
export function DeleteInstanceDialog({
  instance,
  onClose,
  onDelete,
}: {
  readonly instance: ProcedureInstance;
  readonly onClose: () => void;
  readonly onDelete: (instanceId: string, reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const link = instance.workspaceLink;

  return (
    <MinimalPopupForm
      isOpen
      title="Xoá đơn"
      subtitle={`${instance.code} · ${instance.title}`}
      onClose={onClose}
      maxWidth={560}
    >
      <form
        className={styles.createFormBody}
        onSubmit={(event) => {
          event.preventDefault();
          const text = reason.trim();
          if (text.length < 3) return;
          setBusy(true);
          setError(undefined);
          onDelete(instance.id, text)
            .then(onClose)
            .catch((cause: unknown) => setError(errorText(cause, 'Không xoá được đơn.')))
            .finally(() => setBusy(false));
        }}
      >
        <p className={styles.reversalNote}>
          Đơn biến mất khỏi danh sách của mọi người; lịch sử xử lý và lý do xoá vẫn được lưu để tra
          cứu.
          {instance.status === 'running' ? ' Đơn đang chạy sẽ được huỷ trước khi xoá.' : ''}
          {link?.status === 'linked' && link.workItemCode
            ? ` Công việc ${link.workItemCode} của dự án ${link.projectCode} bị xoá theo; tài liệu đã đưa sang dự án vẫn giữ.`
            : instance.sourceType === 'workspace_work_item'
              ? ' Công việc liên kết trong dự án bị xoá theo; tài liệu đã đưa sang dự án vẫn giữ.'
              : ''}
        </p>

        <div className={styles.createFieldGroup}>
          <label className={styles.createFieldLabel} htmlFor="delete-reason">
            Lý do xoá <span className={styles.createRequiredStar}>*</span>
          </label>
          <textarea
            id="delete-reason"
            className={styles.createTextInput}
            rows={3}
            maxLength={1000}
            placeholder="VD: Lập nhầm đơn, đã lập lại đơn khác"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            autoFocus
          />
        </div>

        {error ? (
          <p className={styles.createScheduleError} role="alert">
            {error}
          </p>
        ) : null}

        <div className={styles.createFormActions}>
          <button type="button" className={styles.createCancelBtn} onClick={onClose}>
            Đóng
          </button>
          <button
            type="submit"
            className={styles.createSubmitBtn}
            disabled={busy || reason.trim().length < 3}
          >
            {busy ? 'Đang xoá…' : 'Xoá đơn'}
          </button>
        </div>
      </form>
    </MinimalPopupForm>
  );
}

/**
 * Đổi dự án / công việc: chọn dự án mới (dự án người dùng tham gia và còn ghi được) và công việc cha trên cây WBS.
 * Workspace tạo công việc mới, chuyển tài liệu của công việc cũ sang rồi xoá công việc cũ; hồ sơ hiện
 * "đang chờ" cho tới khi Workspace trả lời. Hồ sơ mở từ công việc "Theo quy trình" cũng đổi được: công việc cũ là
 * công việc nguồn của hồ sơ.
 */
export function RelinkWorkspaceDialog({
  instance,
  onClose,
  onRelink,
}: {
  readonly instance: ProcedureInstance;
  readonly onClose: () => void;
  readonly onRelink: (instanceId: string, input: RelinkProcedureWorkspaceRequest) => Promise<void>;
}) {
  const [projects, setProjects] = useState<readonly RelatedProject[]>();
  const [projectId, setProjectId] = useState('');
  const [items, setItems] = useState<readonly ProjectWorkItemOption[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [parentId, setParentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const currentId =
    instance.workspaceLink?.status === 'linked'
      ? instance.workspaceLink.workItemId
      : instance.sourceType === 'workspace_work_item'
        ? instance.sourceId
        : undefined;

  useEffect(() => {
    void loadRelatedProjects().then(setProjects);
  }, []);

  useEffect(() => {
    setParentId('');
    setItems([]);
    if (!projectId) {
      setItemsLoading(false);
      return;
    }
    let alive = true;
    setItemsLoading(true);
    void loadProjectWorkItems(projectId)
      .then((loaded) => {
        if (alive) setItems(loaded);
      })
      .finally(() => {
        if (alive) setItemsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const project = projects?.find((entry) => entry.id === projectId);

  return (
    <MinimalPopupForm
      isOpen
      title="Đổi dự án / công việc"
      subtitle={`${instance.code} · ${instance.title}`}
      onClose={onClose}
      maxWidth={860}
    >
      <form
        className={styles.createFormBody}
        onSubmit={(event) => {
          event.preventDefault();
          if (!project) return;
          setBusy(true);
          setError(undefined);
          onRelink(instance.id, {
            projectId: project.id,
            projectCode: project.code,
            parentId: parentId || undefined,
          })
            .then(onClose)
            .catch((cause: unknown) =>
              setError(errorText(cause, 'Không đổi được dự án / công việc liên kết.')),
            )
            .finally(() => setBusy(false));
        }}
      >
        <div className={styles.createFieldGroup}>
          <label className={styles.createFieldLabel}>
            Dự án mới <span className={styles.createRequiredStar}>*</span>
          </label>
          <SearchableSelect
            options={(projects ?? []).map((entry) => ({
              value: entry.id,
              label: `${entry.code} · ${entry.name}`,
            }))}
            value={projectId}
            placeholder={projects === undefined ? 'Đang tải dự án…' : 'Chọn dự án…'}
            emptyText="Bạn chưa tham gia dự án nào còn mở."
            onChange={setProjectId}
          />
        </div>

        <div className={styles.createFieldGroup}>
          <label className={styles.createFieldLabel}>Công việc cha</label>
          {/* Công việc đang liên kết (cùng nhánh con) sẽ bị xoá nên không làm công việc cha được. */}
          <WorkItemTreePicker
            label="Công việc cha"
            items={items}
            value={parentId}
            loading={itemsLoading}
            disabled={!projectId}
            disabledText="Chọn dự án mới trước, rồi chọn công việc cha (bỏ trống là gốc dự án)."
            excludeId={currentId}
            onChange={setParentId}
          />
        </div>

        {error ? (
          <p className={styles.createScheduleError} role="alert">
            {error}
          </p>
        ) : null}

        <div className={styles.createFormActions}>
          <button type="button" className={styles.createCancelBtn} onClick={onClose}>
            Đóng
          </button>
          <button type="submit" className={styles.createSubmitBtn} disabled={busy || !project}>
            {busy ? 'Đang gửi…' : 'Đổi dự án / công việc'}
          </button>
        </div>
      </form>
    </MinimalPopupForm>
  );
}
