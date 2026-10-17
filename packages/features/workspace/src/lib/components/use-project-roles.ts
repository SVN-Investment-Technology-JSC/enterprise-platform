'use client';

import {
  PROJECT_ROLES,
  type ProjectRoleDefinition,
  type ProjectRoleList,
} from '@enterprise-platform/contracts-workspace';
import { useEffect, useMemo, useState } from 'react';
import { ROLE_LABELS } from '../workspace-labels';
import * as api from '../workspace-api';

/**
 * Một lần tải danh sách vai trò cho cả trang, như `useDirectory`.
 *
 * Vai trò do tenant định nghĩa ở Cài đặt; nhiều nơi (hộp thành viên, tổng
 * quan, đầu node) cần tên vai. Lưu ở Cài đặt thì gọi `publishProjectRoles` để
 * mọi nơi đang mở nhận bản mới.
 */
let pending: Promise<ProjectRoleList> | undefined;
const listeners = new Set<(value: ProjectRoleList) => void>();

function loadOnce(): Promise<ProjectRoleList> {
  pending ??= api.listProjectRoles().catch(() => {
    pending = undefined;
    return { items: [], canEdit: false };
  });
  return pending;
}

/** Thay bản đang giữ bằng danh sách vừa lưu và báo cho mọi nơi đang dùng. */
export function publishProjectRoles(value: ProjectRoleList): void {
  pending = Promise.resolve(value);
  listeners.forEach((listener) => listener(value));
}

export interface ProjectRolesView {
  readonly roles: readonly ProjectRoleDefinition[];
  readonly canEdit: boolean;
  readonly loaded: boolean;
  /** Tên vai; vai lạ (đã xoá, server cũ) rơi về nhãn mặc định hoặc chính khoá. */
  readonly labelOf: (key: string | undefined) => string;
}

export function useProjectRoles(): ProjectRolesView {
  const [snapshot, setSnapshot] = useState<ProjectRoleList>();

  useEffect(() => {
    let alive = true;
    const listener = (value: ProjectRoleList) => {
      if (alive) setSnapshot(value);
    };
    listeners.add(listener);
    void loadOnce().then(listener);
    return () => {
      alive = false;
      listeners.delete(listener);
    };
  }, []);

  return useMemo(() => {
    const roles = snapshot?.items ?? [];
    const byKey = new Map(roles.map((role) => [role.key, role.name]));
    return {
      roles,
      canEdit: snapshot?.canEdit ?? false,
      loaded: snapshot !== undefined,
      labelOf: (key) =>
        key
          ? (byKey.get(key) ?? (ROLE_LABELS as Readonly<Record<string, string>>)[key] ?? key)
          : '—',
    };
  }, [snapshot]);
}

/**
 * Lựa chọn vai trò cho ô chọn. Chưa tải được danh sách thì dùng bốn vai hệ
 * thống, để hộp thoại vẫn dùng được.
 */
export function roleOptions(
  view: ProjectRolesView,
  includeOwner: boolean,
): { value: string; label: string }[] {
  const keys = view.roles.length > 0 ? view.roles.map((role) => role.key) : PROJECT_ROLES;
  return keys
    .filter((key) => includeOwner || key !== 'owner')
    .map((key) => ({ value: key, label: view.labelOf(key) }));
}
