import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Pool } from 'pg';
import type { HrmRequestKind } from '@enterprise-platform/contracts-hrm';
import { requireUuid } from './hrm-validation.js';
import { assertLifecycleVersion } from './hrm-lifecycle.js';

export interface HrmDraftRef {
  id: string;
  expectedUpdatedAt: string;
}
export type DraftSubmission = { draftId?: string; expectedUpdatedAt?: string };

export function draftPayload(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Buffer.byteLength(JSON.stringify(value), 'utf8') > 64000
  )
    throw new BadRequestException(
      'Nội dung nháp phải là biểu mẫu hợp lệ, tối đa 64 KB.',
    );
  const result = { ...value } as Record<string, unknown>;
  // Identity and lifecycle metadata are always assigned by the server.
  for (const key of [
    'employeeId',
    'tenantId',
    'draftId',
    'expectedUpdatedAt',
    'status',
    'revision',
    'id',
    'createdBy',
    'submittedRequestId',
  ])
    delete result[key];
  return result;
}

export function mapDraft(row: Record<string, unknown>) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    kind: row.request_kind,
    status: row.status,
    revision: row.revision,
    payload: row.payload,
    submittedRequestId: row.submitted_request_id,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

/** Load the authoritative saved form; submitHrmRequest locks/checks its version again. */
export async function resolveDraftSubmission<T extends object>(
  pool: Pool,
  tenantId: string,
  employeeId: string,
  kind: HrmRequestKind,
  body: T & DraftSubmission,
): Promise<{ body: T; draft?: HrmDraftRef }> {
  if (!body.draftId) return { body };
  requireUuid(body.draftId, 'Bản nháp');
  const row = (
    await pool.query(
      "SELECT * FROM hrm_schema.request_drafts WHERE tenant_id=$1 AND employee_id=$2 AND request_kind=$3 AND id=$4 AND status<>'DELETED'",
      [tenantId, employeeId, kind, body.draftId],
    )
  ).rows[0];
  if (!row) throw new NotFoundException('Không tìm thấy bản nháp');
  if (row.status === 'DRAFT')
    assertLifecycleVersion(row, body.expectedUpdatedAt);
  return {
    body: { ...row.payload, employeeId } as T,
    draft: {
      id: row.id,
      expectedUpdatedAt: new Date(row.updated_at).toISOString(),
    },
  };
}
