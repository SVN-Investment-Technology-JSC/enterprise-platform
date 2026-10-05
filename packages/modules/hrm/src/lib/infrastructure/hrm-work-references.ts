import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  PROCEDURE_UNAVAILABLE_MESSAGE,
  procedureFetch,
} from './hrm-procedure-fetch.js';

export interface WorkItem {
  id: string;
  code: string;
  title: string;
  status: string;
  subtasks?: { id: string; title?: string; name?: string }[];
}
export async function procedureDefinitions(
  req: Request,
  tenantId: string,
): Promise<{ id: string; code: string; name: string }[]> {
  const base =
    process.env.PROCEDURE_API_URL || 'http://localhost:3334/api/procedure';
  const response = await procedureFetch(
    `${base.replace(/\/$/, '')}/v1/workspace`,
    {
      headers: {
        cookie: req.headers.cookie || '',
        ...(req.headers.authorization
          ? { authorization: req.headers.authorization }
          : {}),
      },
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    },
  );
  if (!response.ok)
    throw new ForbiddenException(
      'Cần quyền truy cập Procedure để chọn quy trình',
    );
  const workspace = (await response.json()) as {
    tenantId: string;
    definitions: { id: string; code: string; name: string; status: string }[];
  };
  if (workspace.tenantId !== tenantId || !Array.isArray(workspace.definitions))
    throw new ForbiddenException('Quy trình không khớp tenant');
  return workspace.definitions
    .filter((d) => d.status === 'published')
    .map(({ id, code, name }) => ({ id, code, name }));
}
/** Read through the owning module's authorization boundary, never through its tenant tables. */
export async function workReferences(
  req: Request,
  tenantId: string,
): Promise<WorkItem[]> {
  const base =
    process.env.PROCEDURE_API_URL || 'http://localhost:3334/api/procedure';
  let response: Response;
  try {
    response = await fetch(`${base.replace(/\/$/, '')}/v1/workspace`, {
      headers: {
        cookie: req.headers.cookie || '',
        ...(req.headers.authorization
          ? { authorization: req.headers.authorization }
          : {}),
      },
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    });
  } catch {
    throw new ServiceUnavailableException(PROCEDURE_UNAVAILABLE_MESSAGE);
  }
  if (response.status === 401 || response.status === 403)
    throw new ForbiddenException(
      'Tài khoản chưa có quyền truy cập đầu việc liên kết',
    );
  if (!response.ok)
    throw new ServiceUnavailableException(
      'Module công việc chưa trả được danh mục liên kết',
    );
  const workspace = (await response.json()) as {
    tenantId: string;
    instances: WorkItem[];
  };
  if (workspace.tenantId !== tenantId || !Array.isArray(workspace.instances))
    throw new ForbiddenException('Dữ liệu đầu việc không khớp tenant');
  return workspace.instances.map((i) => ({
    id: i.id,
    code: i.code,
    title: i.title,
    status: i.status,
    subtasks: i.subtasks?.map((s) => ({
      id: s.id,
      title: s.title || s.name || s.id,
    })),
  }));
}
