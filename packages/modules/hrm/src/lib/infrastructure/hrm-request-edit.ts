import { cascadeOvertimeGroupStatus } from './hrm-overtime.js';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { HrmRequestKind } from '@enterprise-platform/contracts-hrm';
import { HRM_REQUEST_TABLES } from './hrm-procedure-links.js';
import { assertLifecycleVersion, lifecycleAudit } from './hrm-lifecycle.js';
import { transitionLeave } from './hrm-leave-operations.js';

/**
 * Sửa đơn chưa duyệt (chỉ đơn duyệt trực tiếp): gửi lại nội dung đã chỉnh qua chính API tạo đơn, kèm `replaces`.
 * Đơn cũ bị hủy và đơn mới thay chỗ trong cùng giao dịch, nên mọi kiểm tra lúc tạo (hạn mức, trùng đơn, quỹ phép, tháng khóa
 * công...) chạy lại đúng như đơn mới, còn việc hủy đơn cũ trả lại phần quỹ đang giữ chỗ.
 */
export interface RequestReplacement {
  readonly id: string;
  readonly expectedUpdatedAt?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Đọc `replaces` từ nội dung gửi lên; không có nghĩa là tạo đơn mới. */
export function readReplacement(body: unknown): RequestReplacement | undefined {
  const raw = (body as { replaces?: unknown } | null | undefined)?.replaces;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const id = typeof raw === 'string' ? raw : (raw as { id?: unknown }).id;
  if (typeof id !== 'string' || !UUID.test(id))
    throw new BadRequestException('Đơn cần sửa không hợp lệ');
  const expected =
    typeof raw === 'object' ? (raw as { expectedUpdatedAt?: unknown }).expectedUpdatedAt : undefined;
  return { id, ...(typeof expected === 'string' ? { expectedUpdatedAt: expected } : {}) };
}

/** Còn sửa được: đang chờ duyệt và chưa nối quy trình Procedure. */
const EDITABLE_STATUSES = ['PENDING', 'PEER_CONFIRMED'];

/** Khóa và hủy đơn cũ để đơn mới thay chỗ. Gọi trong giao dịch của người gửi, trước khi tạo đơn mới. */
export async function supersedeRequest(
  db: PoolClient,
  input: { tenantId: string; kind: HrmRequestKind; employeeId: string; actorId: string },
  replacement: RequestReplacement,
): Promise<void> {
  const table = HRM_REQUEST_TABLES[input.kind];
  const old = (
    await db.query(`SELECT * FROM hrm_schema.${table} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [
      input.tenantId,
      replacement.id,
    ])
  ).rows[0];
  if (!old || old.employee_id !== input.employeeId)
    throw new NotFoundException('Không tìm thấy đơn cần sửa');
  if (!EDITABLE_STATUSES.includes(old.status))
    throw new ConflictException({
      code: 'HRM_REQUEST_NOT_EDITABLE',
      message: 'Đơn đã được xử lý hoặc đã hủy nên không thể sửa.',
    });
  const linked = await db.query(
    `SELECT 1 FROM hrm_schema.procedure_links WHERE tenant_id=$1 AND request_kind=$2 AND request_id=$3 LIMIT 1`,
    [input.tenantId, input.kind, replacement.id],
  );
  if (linked.rowCount)
    throw new ConflictException({
      code: 'HRM_REQUEST_NOT_EDITABLE',
      message: 'Đơn đang duyệt theo quy trình nên chưa sửa trực tiếp được; hãy rút đơn rồi gửi lại.',
    });
  // Cột `updated_at` không có ở mọi bảng đơn; có thì kiểm phiên bản để không ghi đè thay đổi của người khác.
  if (old.updated_at && replacement.expectedUpdatedAt !== undefined)
    assertLifecycleVersion(old, replacement.expectedUpdatedAt);
  if (input.kind === 'leave')
    await transitionLeave(db, input.tenantId, input.actorId, replacement.id, 'CANCELLED', 'Người gửi sửa đơn');
  else {
    await db.query(`UPDATE hrm_schema.${table} SET status='CANCELLED' WHERE tenant_id=$1 AND id=$2`, [
      input.tenantId,
      replacement.id,
    ]);
    // Đơn làm thêm nhiều khoảng: các khoảng còn chờ cùng nhóm cũng phải hủy, tránh để lại khoảng mồ côi.
    if (input.kind === 'ot') await cascadeOvertimeGroupStatus(db, input.tenantId, input.actorId, replacement.id, 'CANCELLED');
  }
}

/** Nối đơn cũ với đơn mới: ghi vết, chuyển luồng trao đổi sang đơn mới và để lại một dòng báo đã sửa. */
export async function linkReplacement(
  db: PoolClient,
  input: { tenantId: string; kind: HrmRequestKind; actorId: string; newRequestId: string },
  replacement: RequestReplacement,
): Promise<void> {
  await db.query(
    `INSERT INTO hrm_schema.request_replacements (tenant_id,request_kind,old_request_id,new_request_id,actor_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [input.tenantId, input.kind, replacement.id, input.newRequestId, input.actorId],
  );
  await db.query(
    `UPDATE hrm_schema.request_comments SET request_id=$4
      WHERE tenant_id=$1 AND request_kind=$2 AND request_id=$3`,
    [input.tenantId, input.kind, replacement.id, input.newRequestId],
  );
  const author = (
    await db.query(
      `SELECT full_name FROM core_schema.employees WHERE tenant_id=$1 AND user_id=$2 AND deleted_at IS NULL LIMIT 1`,
      [input.tenantId, input.actorId],
    )
  ).rows[0];
  await db.query(
    `INSERT INTO hrm_schema.request_comments (tenant_id,request_kind,request_id,author_user_id,author_name,kind,body)
     VALUES ($1,$2,$3,$4,$5,'COMMENT',$6)`,
    [
      input.tenantId,
      input.kind,
      input.newRequestId,
      input.actorId,
      String(author?.full_name ?? 'Người gửi đơn'),
      'Đã chỉnh sửa đơn; nội dung bên trên là của bản trước.',
    ],
  );
  await lifecycleAudit(db, input.tenantId, input.actorId, 'REQUEST_EDITED', replacement.id, {
    kind: input.kind,
    replacementId: input.newRequestId,
  });
}
