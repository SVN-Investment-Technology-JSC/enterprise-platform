import type { HrmRequestKind } from '@enterprise-platform/contracts-hrm';
import type { PoolClient } from 'pg';

type Queryable = Pick<PoolClient, 'query'>;

export interface ProcedureLinkInfo {
  procedureInstanceId: string | null;
  procedureRevision: number | null;
  procedureLinkId: string | null;
  procedureSyncStatus: string | null;
}

/**
 * Bổ sung vào danh sách đơn thông tin liên kết Procedure mới nhất của từng đơn (một truy vấn cho cả danh sách):
 * mã instance PE, lần gửi (revision) của liên kết, id và trạng thái đồng bộ. Đơn chưa có liên kết (DIRECT)
 * giữ nguyên, các trường mới là null. Màn Duyệt đơn dùng revision để gọi thao tác duyệt qua PE đúng lần gửi.
 */
export async function attachProcedureLinkInfo<
  T extends { id: string; procedureInstanceId?: string | null },
>(
  db: Queryable,
  tenantId: string,
  kind: HrmRequestKind,
  items: readonly T[],
): Promise<(T & ProcedureLinkInfo)[]> {
  if (!items.length) return [];
  const rows = (
    await db.query(
      `SELECT DISTINCT ON (request_id) request_id,id,revision,instance_id,sync_status
         FROM hrm_schema.procedure_links
        WHERE tenant_id=$1 AND request_kind=$2 AND request_id = ANY($3::uuid[])
        ORDER BY request_id, revision DESC`,
      [tenantId, kind, items.map((item) => item.id)],
    )
  ).rows as {
    request_id: string;
    id: string;
    revision: number;
    instance_id: string | null;
    sync_status: string;
  }[];
  const byRequest = new Map(rows.map((row) => [row.request_id, row]));
  return items.map((item) => {
    const link = byRequest.get(item.id);
    return {
      ...item,
      procedureInstanceId:
        link?.instance_id ?? item.procedureInstanceId ?? null,
      procedureRevision: link ? Number(link.revision) : null,
      procedureLinkId: link?.id ?? null,
      procedureSyncStatus: link?.sync_status ?? null,
    };
  });
}
