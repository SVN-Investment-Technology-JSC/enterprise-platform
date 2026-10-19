'use client';

import type {
  ProcedureDefinition,
  ProcedureWorkspace,
  StartProcedureInstanceRequest,
} from '@enterprise-platform/contracts-procedure-engine';
import { PROCEDURE_ASSISTANT_ACTIONS } from '@enterprise-platform/contracts-procedure-engine';
import {
  AssistantFormHost,
  useAssistantAction,
  type AssistantActionContext,
} from '@enterprise-platform/feature-module-shell';
import { useEffect, useMemo, useState } from 'react';
import { startDraftToPrefill, type StartPrefillValues } from '../assistant-start-draft';
import { loadProcedureWorkspace, startProcedureInstance } from '../procedure-api';
import styles from './procedure-assistant-form.module.scss';
import { StartInstanceForm, type StartProcedureInput } from './start-instance-form';

const START_INSTANCE = PROCEDURE_ASSISTANT_ACTIONS.startInstance.key;

/**
 * Trang form nhúng của Quy trình (`/modules/procedure/assistant/form`). Card Trợ lý trong khung chat đặt trang này
 * trong iframe: chính form "Tạo đơn / yêu cầu" của màn Hồ sơ xử lý hiện ngay trong card, điền sẵn bản nháp, mở hồ sơ
 * bằng API của Quy trình. Trang ERP phía sau không chuyển trang.
 */
export function ProcedureAssistantFormPage() {
  return (
    <AssistantFormHost>
      <StartInstanceAssistantForm />
    </AssistantFormHost>
  );
}

type Draft = Readonly<Record<string, unknown>>;

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function StartInstanceAssistantForm() {
  /** Quy trình đã công bố, quyền mở hồ sơ và người đang đăng nhập: đúng những gì form tạo đơn cần. */
  const [workspace, setWorkspace] = useState<ProcedureWorkspace>();
  const [loadError, setLoadError] = useState<string>();
  const [request, setRequest] = useState<AssistantActionContext>();
  /** Bản nháp nhận từ card, chờ danh sách quy trình nạp xong mới đổi thành giá trị form. */
  const [drafts, setDrafts] = useState<readonly Draft[]>([]);
  /** Giá trị điền sẵn; `revision` tăng mỗi lần Trợ lý sửa tiếp, form chỉ ghi đè các ô có trong lần sửa đó. */
  const [prefill, setPrefill] = useState<{
    readonly revision: number;
    readonly values: StartPrefillValues;
  }>();
  const [busy, setBusy] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  const [savedLabel, setSavedLabel] = useState<string>();
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    let active = true;
    loadProcedureWorkspace().then(
      (loaded) => {
        if (active) setWorkspace(loaded);
      },
      (cause: unknown) => {
        if (active) setLoadError(messageOf(cause, 'Không tải được danh sách quy trình.'));
      },
    );
    return () => {
      active = false;
    };
  }, []);

  useAssistantAction(START_INSTANCE, (draft, context) => {
    setRequest(context);
    setDrafts((list) => [...list, draft]);
  });

  const published = useMemo(
    () => (workspace?.definitions ?? []).filter((definition) => definition.status === 'published'),
    [workspace],
  );
  const problem =
    loadError ??
    (!workspace
      ? undefined
      : !workspace.permissions.canCreateInstances
        ? 'Bạn không có quyền tạo đơn theo quy trình.'
        : published.length === 0
          ? 'Chưa có quy trình nào được công bố.'
          : undefined);

  // Không mở được form: báo về card (card hiện lý do), không để người dùng nhập rồi mới bị chặn lúc lưu.
  useEffect(() => {
    if (request && problem) request.report('unavailable', { message: problem });
  }, [request, problem]);

  useEffect(() => {
    if (!request || !workspace || problem || drafts.length === 0) return;
    setDrafts([]);
    const ids = published.map((definition) => definition.id);
    setPrefill((current) => {
      // Quy trình đến qua `variant` và giữ nguyên qua mọi lần sửa tiếp của cùng yêu cầu: chỉ áp ở lần đầu, để lần
      // sửa tiếp không đè quy trình người dùng đã tự chọn lại.
      const variant = current ? undefined : request.variant;
      const values = drafts.reduce<StartPrefillValues>(
        (merged, draft) => ({ ...merged, ...startDraftToPrefill(draft, variant, ids) }),
        {},
      );
      return { revision: current ? current.revision + 1 : 0, values };
    });
  }, [request, workspace, problem, drafts, published]);

  const cancel = () => {
    request?.report('cancelled');
    setClosed(true);
  };

  const start = async (definition: ProcedureDefinition, input: StartProcedureInput) => {
    setBusy(`start:${definition.id}`);
    setSaveError(undefined);
    try {
      // Cùng request như màn Hồ sơ xử lý: gắn dự án thì gửi kèm công việc, Workspace tự tạo khi nhận sự kiện.
      const { workItem, ...schedule } = input;
      let workspaceLink: StartProcedureInstanceRequest['workspaceLink'];
      if (workItem) {
        const { projectCode, projectId, ...draft } = workItem;
        workspaceLink = { projectId, projectCode, workItem: draft };
      }
      const instance = await startProcedureInstance(definition.id, {
        ...schedule,
        title: input.title.trim(),
        ...(workspaceLink ? { workspaceLink } : {}),
      });
      const label = `${instance.code} · ${instance.title}`;
      request?.report('saved', {
        id: instance.id,
        label,
        href: `/modules/procedure#workspace/${encodeURIComponent(instance.id)}`,
      });
      setSavedLabel(label);
    } catch (cause) {
      // Form vẫn mở với những gì đã nhập để sửa rồi gửi lại.
      setSaveError(messageOf(cause, 'Không mở được hồ sơ.'));
    } finally {
      setBusy(undefined);
    }
  };

  if (closed) return null;
  if (savedLabel)
    return (
      <p role="status" className={styles.status}>
        Đã mở hồ sơ {savedLabel}.
      </p>
    );
  if (problem)
    return (
      <p role="alert" className={styles.problem}>
        {problem}
      </p>
    );
  if (!workspace || !prefill)
    return (
      <p role="status" className={styles.status}>
        Đang tải…
      </p>
    );

  return (
    <StartInstanceForm
      open
      onClose={cancel}
      definitions={published}
      busy={busy}
      onStart={start}
      actorId={workspace.actor.id}
      actorName={workspace.actor.name}
      prefill={prefill}
      error={saveError}
    />
  );
}
