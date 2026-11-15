'use client';

import { createContext, useContext } from 'react';
import type { WorkspaceStatus } from './workspace-api';

/**
 * Quyền Workspace của người đang đăng nhập, lấy từ `capabilities` của `GET /v1/status`.
 *
 * Chỉ để ẩn hoặc khoá nút cho đỡ bấm rồi nhận 403; server vẫn kiểm lại mọi lời gọi ghi.
 */
export interface WorkspacePermissions {
  /** `workspace.task.write`: ghi dự án, công việc, việc độc lập, khách hàng, hợp đồng. */
  readonly canWriteTasks: boolean;
  /** `workspace.project.create`: tạo dự án mới. */
  readonly canCreateProject: boolean;
}

/** Mặc định khi chưa có provider hoặc server cũ chưa trả cờ: giữ hành vi cũ (server vẫn chặn). */
const ALL_ALLOWED: WorkspacePermissions = { canWriteTasks: true, canCreateProject: true };

/** Đổi `capabilities` của server thành quyền giao diện; thiếu cờ (server cũ) thì coi là có. */
export function workspacePermissionsFrom(status: WorkspaceStatus | undefined): WorkspacePermissions {
  const capabilities = status?.capabilities;
  if (!capabilities) return ALL_ALLOWED;
  return {
    canWriteTasks: capabilities.canWriteTasks !== false,
    canCreateProject: capabilities.canCreateProject !== false,
  };
}

const WorkspacePermissionsContext = createContext<WorkspacePermissions>(ALL_ALLOWED);

export const WorkspacePermissionsProvider = WorkspacePermissionsContext.Provider;

export function useWorkspacePermissions(): WorkspacePermissions {
  return useContext(WorkspacePermissionsContext);
}

/** Chú thích cho người chỉ có quyền xem. */
export const WORKSPACE_READ_ONLY_HINT = 'Bạn chỉ có quyền xem trong Workspace; các nút ghi đã được ẩn.';
