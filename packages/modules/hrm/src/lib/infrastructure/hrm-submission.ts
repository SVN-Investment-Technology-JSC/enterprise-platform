import type { Pool, PoolClient } from 'pg';
import type {
  HrmProcedureLink,
  HrmRequestKind,
  HrmSubmission,
} from '@enterprise-platform/contracts-hrm';
import {
  HRM_REQUEST_TABLES,
  prepareHrmProcedureLink,
  mapHrmProcedureLink,
} from './hrm-procedure-links.js';
import {
  applyFieldMappings,
  defaultFieldMappings,
  formFieldValues,
  type HrmFieldMapping,
} from './hrm-field-mappings.js';
import { hrmTransaction } from './hrm-transaction.js';
import { lockEmployee } from './hrm-time.js';
import { ConflictException } from '@nestjs/common';
import { assertLifecycleVersion, lifecycleAudit } from './hrm-lifecycle.js';
import type { HrmDraftRef } from './hrm-request-drafts.js';
import {
  isAwaitingApproval,
  notifyApproversOfDirectRequest,
} from './hrm-approval-notification.js';

type Submission = Omit<HrmSubmission, 'requestId' | 'revision'> & {
  draft?: HrmDraftRef;
};
type Starter = {
  startOrResume(
    pool: Pool,
    linkId: string,
    tenantId: string,
  ): Promise<HrmProcedureLink>;
};

/**
 * Thuộc tính gửi sang Procedure = thuộc tính người nộp + giá trị hệ thống theo ánh xạ của binding
 * (FIX-E-05). Không truyền `mappings` thì dùng bảng mặc định (tương thích hành vi mã cố định cũ);
 * `extraValues` bổ sung giá trị ngữ cảnh (phòng ban, chức danh...) đã tải sẵn.
 */
export function submissionAttributes(
  input: Pick<Submission, 'kind' | 'attributes'>,
  row: Record<string, unknown>,
  mappings: readonly HrmFieldMapping[] = defaultFieldMappings(
    input.kind as HrmRequestKind,
  ),
  extraValues: Record<string, unknown> = {},
): Record<string, unknown> {
  return applyFieldMappings(
    input.attributes,
    { ...formFieldValues(input.kind as HrmRequestKind, row), ...extraValues },
    mappings,
  );
}

export async function submitHrmRequest(
  pool: Pool,
  bridge: Starter,
  input: Submission,
  create: (db: PoolClient) => Promise<Record<string, unknown>>,
): Promise<{ row: Record<string, unknown>; link: HrmProcedureLink | null }> {
  const prepared = await hrmTransaction(pool, async (db) => {
    await lockEmployee(db, input.tenantId, input.employeeId);
    const draft = input.draft
      ? (
          await db.query(
            'SELECT * FROM hrm_schema.request_drafts WHERE tenant_id=$1 AND employee_id=$2 AND request_kind=$3 AND id=$4 FOR UPDATE',
            [input.tenantId, input.employeeId, input.kind, input.draft.id],
          )
        ).rows[0]
      : null;
    if (input.draft) {
      if (!draft || draft.status === 'DELETED')
        throw new ConflictException('Bản nháp đã bị xóa; vui lòng tải lại.');
      if (draft.status === 'SUBMITTED') {
        const row = (
          await db.query(
            `SELECT * FROM hrm_schema.${HRM_REQUEST_TABLES[input.kind]} WHERE tenant_id=$1 AND id=$2`,
            [input.tenantId, draft.submitted_request_id],
          )
        ).rows[0];
        if (!row)
          throw new ConflictException('Không tìm thấy đơn đã gửi từ bản nháp.');
        const linkRow = (
          await db.query(
            'SELECT * FROM hrm_schema.procedure_links WHERE tenant_id=$1 AND request_kind=$2 AND request_id=$3 ORDER BY revision DESC LIMIT 1',
            [input.tenantId, input.kind, row.id],
          )
        ).rows[0];
        return { row, link: linkRow ? mapHrmProcedureLink(linkRow) : null };
      }
      assertLifecycleVersion(draft, input.draft.expectedUpdatedAt);
    }
    const employee = await db.query(
      'SELECT employment_status FROM hrm_schema.employee_profiles WHERE tenant_id=$1 AND employee_id=$2',
      [input.tenantId, input.employeeId],
    );
    if (
      ['RESIGNED', 'TERMINATED'].includes(employee.rows[0]?.employment_status)
    ) {
      throw new ConflictException(
        'Hồ sơ nhân viên đã ngừng hoạt động; không thể tạo đơn HRM mới.',
      );
    }
    const row = await create(db);
    if (draft) {
      await db.query(
        "UPDATE hrm_schema.request_drafts SET status='SUBMITTED',submitted_request_id=$3,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE tenant_id=$1 AND id=$2",
        [input.tenantId, draft.id, row.id],
      );
      await lifecycleAudit(
        db,
        input.tenantId,
        input.initiatedBy,
        'REQUEST_DRAFT_SUBMITTED',
        draft.id,
        { kind: input.kind, requestId: row.id, revision: draft.revision },
      );
    }
    // Drafts and swaps waiting for a peer have no Procedure side effects.
    if (
      row.status === 'DRAFT' ||
      (input.kind === 'shift_change' &&
        row.swap_with_employee_id &&
        !row.swap_peer_confirmed)
    )
      return { row, link: null };
    let subTypeCode = input.subTypeCode;
    if (input.kind === 'leave')
      subTypeCode = (
        await db.query(
          'SELECT code FROM hrm_schema.leave_types WHERE tenant_id=$1 AND id=$2',
          [input.tenantId, row.leave_type_id],
        )
      ).rows[0]?.code;
    if (input.kind === 'business_trip')
      subTypeCode = String(row.business_trip_type);
    if (input.kind === 'ot') subTypeCode = String(row.ot_type);
    const link = await prepareHrmProcedureLink(db, {
      ...input,
      subTypeCode,
      requestId: row.id as string,
      revision: Number(row.revision ?? 1),
      attributes: input.attributes,
      fieldRow: row,
    });
    // Đơn qua Procedure được báo bằng `procedure.assignment.created`; chỉ đơn DIRECT mới cần báo ở đây.
    if (!link && isAwaitingApproval(row.status))
      await notifyApproversOfDirectRequest(db, {
        tenantId: input.tenantId,
        requestId: row.id as string,
        requestKind: input.kind,
        employeeId: input.employeeId,
        actorUserId: input.initiatedBy,
      });
    return { row, link };
  });
  if (!prepared.link) return prepared;
  const link = await bridge.startOrResume(
    pool,
    prepared.link.id,
    input.tenantId,
  );
  const row = (
    await pool.query(
      `SELECT * FROM hrm_schema.${HRM_REQUEST_TABLES[input.kind]} WHERE tenant_id=$1 AND id=$2`,
      [input.tenantId, prepared.row.id],
    )
  ).rows[0];
  return { row, link };
}
