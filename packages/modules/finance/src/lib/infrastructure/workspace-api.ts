import type { InternalProjectOptionList, InternalWorkItemOption } from '@enterprise-platform/contracts-workspace';
import { FinanceError } from '../domain/finance.error.js';
import type { ForwardedSession } from './procedure-api.js';

/**
 * Client gọi Workspace qua API của nó (không đọc workspace_schema). Dùng để:
 *  - tra dự án/công việc khi gắn hạch toán và dự án liên quan (service token, cả tenant: kế toán không nhất thiết là thành viên dự án);
 *  - hỏi người dùng có được xem thu chi của một dự án không, theo chính quy tắc của Workspace (phiên người dùng).
 * Lỗi mạng, tắt entitlement hay sai token đều quy về một lỗi "Workspace không khả dụng" có mã ổn định.
 */
export const WORKSPACE_UNAVAILABLE_CODE = 'FINANCE_WORKSPACE_UNAVAILABLE';

export const workspaceUnavailable = (message = 'Workspace đang không khả dụng nên chưa xác nhận được dự án/công việc; thử lại sau.') =>
  new FinanceError(WORKSPACE_UNAVAILABLE_CODE, message, 409);

const baseUrl = () => (process.env.WORKSPACE_API_URL || 'http://localhost:3337/api/workspace').replace(/\/$/, '');

function serviceHeaders(tenantId: string): Record<string, string> {
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!token) throw workspaceUnavailable('Chưa cấu hình INTERNAL_SERVICE_TOKEN.');
  return { 'x-tenant-id': tenantId, 'x-service-token': token };
}

async function get(path: string, headers: Record<string, string>, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(`${baseUrl()}${path}`, { redirect: 'error', headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw workspaceUnavailable();
  }
}

/** Lấy JSON của một lời gọi dịch vụ; 404 trả null, mọi trạng thái lỗi khác (401/403/5xx) là Workspace không khả dụng. */
async function serviceJson<T>(tenantId: string, path: string): Promise<T | null> {
  const response = await get(path, serviceHeaders(tenantId), 6000);
  if (response.status === 404) return null;
  if (!response.ok) throw workspaceUnavailable();
  try {
    return (await response.json()) as T;
  } catch {
    throw workspaceUnavailable();
  }
}

export interface WorkspaceProjectRef {
  id: string;
  code: string;
  name: string;
  status: string;
}

export interface WorkspaceWorkItemRef {
  id: string;
  code: string;
  title: string;
  status: string;
  project: { id: string };
}

export const fetchWorkspaceProject = (tenantId: string, projectId: string) =>
  serviceJson<WorkspaceProjectRef>(tenantId, `/v1/internal/projects/${encodeURIComponent(projectId)}`);

export const fetchWorkspaceWorkItem = (tenantId: string, workItemId: string) =>
  serviceJson<WorkspaceWorkItemRef>(tenantId, `/v1/internal/work-items/${encodeURIComponent(workItemId)}`);

export async function listWorkspaceProjects(tenantId: string, search: string | undefined): Promise<InternalProjectOptionList> {
  const query = search?.trim() ? `?search=${encodeURIComponent(search.trim().slice(0, 100))}` : '';
  return (await serviceJson<InternalProjectOptionList>(tenantId, `/v1/internal/projects${query}`)) ?? { items: [], truncated: false };
}

/** Công việc của dự án; null khi dự án không tồn tại. */
export async function listWorkspaceWorkItems(tenantId: string, projectId: string): Promise<InternalWorkItemOption[] | null> {
  const body = await serviceJson<{ items: InternalWorkItemOption[] }>(tenantId, `/v1/internal/projects/${encodeURIComponent(projectId)}/work-items`);
  return body ? body.items : null;
}

function userHeaders(session: ForwardedSession): Record<string, string> {
  const headers: Record<string, string> = {};
  if (session.cookie) headers['cookie'] = session.cookie;
  if (session.authorization) headers['authorization'] = session.authorization;
  return headers;
}

export type ProjectFinanceAccess = 'ALLOWED' | 'FORBIDDEN' | 'NOT_FOUND';

/**
 * Người dùng có được xem tài chính của dự án không — do Workspace quyết (chủ nhiệm, quản lý dự án, quản trị viên tenant):
 * chi tiết dự án chỉ chứa `finance` với những người đó. Tài chính không tự suy luận lại vai trò trong dự án.
 */
export async function projectFinanceAccess(session: ForwardedSession, projectId: string): Promise<ProjectFinanceAccess> {
  const response = await get(`/v1/projects/${encodeURIComponent(projectId)}`, userHeaders(session), 6000);
  if (response.status === 404) return 'NOT_FOUND';
  if (response.status === 403) return 'FORBIDDEN';
  if (!response.ok) throw workspaceUnavailable();
  try {
    const body = (await response.json()) as { finance?: unknown };
    return body.finance ? 'ALLOWED' : 'FORBIDDEN';
  } catch {
    throw workspaceUnavailable();
  }
}
