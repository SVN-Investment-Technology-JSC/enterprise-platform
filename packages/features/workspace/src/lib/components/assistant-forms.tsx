'use client';

import {
  WORKSPACE_ASSISTANT_ACTIONS,
  type ProjectMember,
  type ProjectSummary,
} from '@enterprise-platform/contracts-workspace';
import {
  useAssistantAction,
  type AssistantActionContext,
} from '@enterprise-platform/feature-module-shell';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  eventDraftToForm,
  standaloneTaskDraftToForm,
  workItemDraftToForm,
  workspaceHref,
} from '../assistant-drafts';
import * as api from '../workspace-api';
import { EventForm } from './event-form';
import { StandaloneTaskForm } from './standalone-task-form';
import { WorkItemForm } from './work-item-form';

type Kind = 'event' | 'work-item' | 'standalone-task';

interface Session {
  readonly kind: Kind;
  readonly context: AssistantActionContext;
  /** Bản nháp Trợ lý vừa gửi; lần đầu là giá trị ban đầu, các lần sau chỉ gộp ô có mặt. */
  readonly draft: Partial<Record<string, unknown>>;
  readonly seq: number;
}

export interface WorkspaceAssistantFormsProps {
  readonly currentUserId: string;
  /** Có giá trị khi người dùng chưa tạo được gì ở Workspace (thiếu quyền ghi, dữ liệu đang khởi tạo). */
  readonly unavailableMessage?: string;
  /** Đã lưu một bản ghi: màn hình đang mở nạp lại dữ liệu. */
  readonly onSaved: () => void;
}

function draftProjectId(draft: Partial<Record<string, unknown>>): string | undefined {
  return typeof draft.projectId === 'string' && draft.projectId.trim()
    ? draft.projectId.trim()
    : undefined;
}

/**
 * Form tạo của Workspace mà Trợ lý Savina mở với bản nháp: cuộc họp hoặc sự kiện, công việc trong dự án, việc ngoài dự
 * án. Dựng ở gốc màn hình nên chạy được từ mọi trang của phân hệ; form và API là của chính phân hệ, người dùng xem lại
 * rồi bấm lưu như khi tự nhập.
 */
export function WorkspaceAssistantForms({
  currentUserId,
  unavailableMessage,
  onSaved,
}: WorkspaceAssistantFormsProps) {
  const [session, setSessionState] = useState<Session>();
  /** Bản đang mở, đọc được ngay trong lúc xử lý lệnh; `saved` không đi qua state để form không bị gộp lại bản nháp. */
  const sessionRef = useRef<(Session & { saved?: boolean }) | undefined>(undefined);
  const setSession = useCallback((next: Session | undefined) => {
    sessionRef.current = next;
    setSessionState(next);
  }, []);

  /** Dự án của sự kiện hoặc công việc: từ bản nháp, hoặc người dùng đổi trên form. */
  const [projectId, setProjectId] = useState<string>();
  const [project, setProject] = useState<ProjectSummary>();
  const [members, setMembers] = useState<readonly ProjectMember[]>();
  const [parentOptions, setParentOptions] = useState<{ id: string; label: string }[]>([]);
  const [projectList, setProjectList] = useState<readonly ProjectSummary[]>([]);

  const openWith = (kind: Kind) => (draft: Partial<Record<string, unknown>>, context: AssistantActionContext) => {
    if (unavailableMessage) {
      context.report('unavailable', { message: unavailableMessage });
      return;
    }
    const current = sessionRef.current;
    const nextProjectId = kind === 'standalone-task' ? undefined : draftProjectId(draft);
    if (current && current.kind === kind && current.context.requestId === context.requestId) {
      // Đã lưu rồi thì không sửa tiếp form đang hiện cảnh báo.
      if (current.saved) return;
      setSession({ ...current, draft, seq: current.seq + 1 });
      if (nextProjectId) setProjectId(nextProjectId);
      return;
    }
    // Lệnh mới thay form Trợ lý đang mở: form cũ coi như đóng mà không lưu.
    if (current && !current.saved) current.context.report('cancelled');
    setSession({ kind, context, draft, seq: 1 });
    setProjectId(nextProjectId);
  };

  // Bản nháp theo tên trường của CreateEventRequest, CreateWorkItemRequest, CreateStandaloneTaskRequest; giá trị chưa
  // được tin, các hàm đổi sang ô form tự kiểm.
  useAssistantAction(WORKSPACE_ASSISTANT_ACTIONS.createEvent.key, openWith('event'));
  useAssistantAction(WORKSPACE_ASSISTANT_ACTIONS.createWorkItem.key, openWith('work-item'));
  useAssistantAction(WORKSPACE_ASSISTANT_ACTIONS.createStandaloneTask.key, openWith('standalone-task'));

  const kind = session?.kind;

  // Ô "Dự án" của form công việc cần danh sách dự án người dùng thấy được.
  useEffect(() => {
    if (kind !== 'work-item') return;
    let alive = true;
    api
      .listAllProjects(20)
      .then((items) => {
        if (alive) setProjectList(items);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [kind]);

  // Thành viên và cây công việc của dự án đang chọn: nguồn của ô người phụ trách, người được mời, công việc cha.
  useEffect(() => {
    setProject(undefined);
    setMembers(undefined);
    setParentOptions([]);
    if (!projectId || (kind !== 'event' && kind !== 'work-item')) return;
    let alive = true;
    api
      .listMembers(projectId)
      .then((result) => {
        if (alive) setMembers(result.items);
      })
      .catch(() => undefined);
    if (kind === 'event') {
      api
        .getProject(projectId)
        .then((summary) => {
          if (alive) setProject(summary);
        })
        .catch(() => undefined);
    } else {
      api
        .listWorkItems(projectId)
        .then((tree) => {
          if (!alive) return;
          setParentOptions(
            tree.items
              .filter((item) => item.status !== 'cancelled')
              .map((item) => ({ id: item.id, label: `${item.code} · ${item.title}` })),
          );
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [projectId, kind]);

  const eventPrefill = useMemo(
    () =>
      session?.kind === 'event'
        ? {
            values: eventDraftToForm(session.draft, { organizerUserId: currentUserId || undefined }),
            seq: session.seq,
          }
        : undefined,
    [session, currentUserId],
  );
  const workItemPrefill = useMemo(
    () =>
      session?.kind === 'work-item'
        ? {
            values: workItemDraftToForm(session.draft, {
              // Không nói người phụ trách thì chọn sẵn chính người dùng, chỉ ở lần mở đầu.
              defaultAssigneeUserId: session.seq === 1 ? currentUserId || undefined : undefined,
            }),
            seq: session.seq,
          }
        : undefined,
    [session, currentUserId],
  );
  const taskPrefill = useMemo(
    () =>
      session?.kind === 'standalone-task'
        ? {
            values: standaloneTaskDraftToForm(session.draft, {
              defaultAssigneeUserId: session.seq === 1 ? currentUserId || undefined : undefined,
            }),
            seq: session.seq,
          }
        : undefined,
    [session, currentUserId],
  );

  const markSaved = (detail: { id: string; label: string; href: string }) => {
    const current = sessionRef.current;
    if (!current) return;
    sessionRef.current = { ...current, saved: true };
    current.context.report('saved', detail);
    onSaved();
  };

  const close = () => {
    const current = sessionRef.current;
    if (current && !current.saved) current.context.report('cancelled');
    setSession(undefined);
    setProjectId(undefined);
  };

  return (
    <>
      <EventForm
        open={kind === 'event'}
        currentUserId={currentUserId}
        memberUserIds={projectId ? (members ?? []).map((member) => member.userId) : undefined}
        prefill={eventPrefill}
        projectLabel={projectId && project ? `${project.code}-${project.name}` : undefined}
        loadDetail={api.getEvent}
        onClose={close}
        onCreate={async (input) => {
          const result = await api.createEvent({ ...input, projectId });
          markSaved({
            id: result.event.id,
            label: result.event.title,
            href: workspaceHref.event(result.event.id, result.event.projectId ?? projectId),
          });
          return [...result.warnings];
        }}
        // Form của Trợ lý chỉ tạo mới; ba hàm dưới chỉ để thoả kiểu dữ liệu.
        onUpdate={async () => []}
        onCancelEvent={async () => undefined}
        onRespond={async () => undefined}
      />

      <WorkItemForm
        open={kind === 'work-item'}
        members={members ?? []}
        currentUserId={currentUserId}
        canAssignOthers
        projectOptions={projectList.map((option) => ({
          id: option.id,
          label: `${option.code}-${option.name}`,
        }))}
        onProjectChange={(next) => setProjectId(next || undefined)}
        parentOptions={parentOptions}
        prefill={workItemPrefill}
        onClose={close}
        onCreate={async (input, procedureDefinitionId) => {
          if (!projectId) throw new Error('Hãy chọn dự án cho công việc.');
          const created = await api.createWorkItem({ ...input, projectId, procedureDefinitionId });
          markSaved({
            id: created.id,
            label: `${created.code} · ${created.title}`,
            href: workspaceHref.workItem(created.id, created.projectId),
          });
        }}
        onUpdate={async () => undefined}
      />

      <StandaloneTaskForm
        open={kind === 'standalone-task'}
        prefill={taskPrefill}
        onClose={close}
        onSubmit={async (input) => {
          const created = await api.createStandaloneTask(input);
          markSaved({
            id: created.task.id,
            label: `${created.task.code} · ${created.task.title}`,
            href: workspaceHref.standaloneTask(created.task.id),
          });
          close();
        }}
      />
    </>
  );
}
