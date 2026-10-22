import { PostgresPoolRegistry, TenantDatabaseRegistry, inTransaction } from '@enterprise-platform/adapter-database';
import { createIntegrationEvent } from '@enterprise-platform/contracts-integration';
import { S3ObjectStorage, TENANT_UPLOAD_URL_TTL_SECONDS, type ObjectStoragePort } from '@enterprise-platform/adapter-storage';
import {
  PROCEDURE_ATTACHMENT_MAX_BYTES,
  PROCEDURE_ATTACHMENT_TYPES,
  PROCEDURE_SYSTEM_ACTOR_ID,
  type CreateProcedureAttachmentRequest,
  type CreateProcedureAttachmentResponse,
  type ProcedureAttachment,
  type ProcedureInstance,
} from '@enterprise-platform/contracts-procedure-engine';
import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { ProcedureEngineError } from '../domain/procedure-engine.error.js';
import {
  canSupplementProcedureInstance,
  deriveProcedureAuthorization,
  isProcedureParticipant,
  type ProcedureActor,
} from '../domain/procedure-authorization.js';
import {
  ATTACHMENT_ADDED_EVENT,
  type AttachmentAddedPayload,
} from '../domain/procedure-workspace-link.js';

interface AttachmentRow {
  id:string;instance_id:string;step_instance_id:string|null;subtask_id:string|null;object_key:string;
  file_name:string;content_type:string;size_bytes:string|null;uploaded_by:string;created_at:Date;
}

export class ProcedureAttachmentService {
  constructor(
    private readonly references: TenantDatabaseRegistry,
    private readonly pools: PostgresPoolRegistry,
    private readonly storage: ObjectStoragePort = new S3ObjectStorage({
      internalEndpoint: process.env.S3_INTERNAL_ENDPOINT ?? process.env.S3_ENDPOINT ?? 'http://localhost:9010',
      publicEndpoint: process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT ?? 'http://localhost:9010',
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: process.env.S3_BUCKET ?? 'enterprise-platform',
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'platform',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'platform-development-secret',
    }),
  ) {}

  /**
   * Đọc hồ sơ từ snapshot để soát quyền.
   *
   * Đọc thẳng bảng thay vì gọi ProcedureEngineApplication: application đã phụ
   * thuộc service này (làm SubtaskEvidenceCounter), gọi ngược lại sẽ thành vòng.
   */
  private async loadInstance(pool: Pool, instanceId: string): Promise<ProcedureInstance> {
    const result = await pool.query<{ snapshot: ProcedureInstance }>(
      `SELECT snapshot FROM procedure_schema.instances WHERE id = $1`, [instanceId]);
    const instance = result.rows[0]?.snapshot;
    // Đơn đã xoá (xoá mềm) coi như không tồn tại: không đọc, không đính kèm thêm.
    if (!instance || instance.deletion) throw new ProcedureEngineError('not_found', 'Không tìm thấy hồ sơ.');
    return instance;
  }

  async create(actor: ProcedureActor, instanceId: string, input: CreateProcedureAttachmentRequest): Promise<CreateProcedureAttachmentResponse> {
    if (!input.fileName?.trim() || !input.contentType?.trim()) throw new ProcedureEngineError('validation','Tên file và content type là bắt buộc.');
    if ((input.sizeBytes ?? 0) > PROCEDURE_ATTACHMENT_MAX_BYTES) {
      throw new ProcedureEngineError('validation','File đính kèm không vượt quá 50 MB.');
    }

    // Đuôi tệp và content-type phải cùng nói một thứ. `sizeBytes` thì client khai
    // và ta KHÔNG kiểm chứng được: URL ký trước chỉ ghim Bucket/Key/ContentType,
    // không ghim độ dài. Muốn chặn dung lượng thật phải chuyển sang presigned POST
    // với content-length-range — đó là việc của adapter-storage, không làm ở đây.
    const extension = input.fileName.trim().split('.').pop()?.toLowerCase() ?? '';
    const expected = PROCEDURE_ATTACHMENT_TYPES[extension];
    if (!expected) {
      throw new ProcedureEngineError('validation',
        `Định dạng .${extension || '?'} không được phép. Chấp nhận: ${[...new Set(Object.keys(PROCEDURE_ATTACHMENT_TYPES))].join(', ')}.`);
    }
    if (input.contentType.trim() !== expected) {
      throw new ProcedureEngineError('validation',
        `Loại tệp khai báo (${input.contentType.trim()}) không khớp đuôi .${extension}.`);
    }

    const pool=await this.pools.forTenant(this.references.require(actor.tenantId));

    const instance = await this.loadInstance(pool, instanceId);
    let stepInstanceId: string | null;
    if (input.supplement) {
      // Bổ sung: mọi người tham gia đơn trừ người chỉ có vai I; không gắn vào bước nào nên hiện thẻ
      // "Bổ sung" thay vì "Bước N".
      if (input.subtaskId) {
        throw new ProcedureEngineError('validation', 'Tài liệu bổ sung không gắn vào đầu việc.');
      }
      if (!canSupplementProcedureInstance(instance, actor)) {
        throw new ProcedureEngineError('forbidden',
          'Chỉ người tham gia xử lý đơn mới bổ sung được tài liệu (người xem thì không).');
      }
      stepInstanceId = null;
    } else {
      const authorization = deriveProcedureAuthorization(instance, actor);
      if (!authorization.canManageSubtasks && authorization.availableActions.length === 0) {
        throw new ProcedureEngineError('forbidden',
          'Chỉ người đang có phần việc ở bước hiện tại mới đính kèm được tài liệu.');
      }

      // Bước được đóng dấu ở server. Tin stepInstanceId của client thì ai cũng gắn
      // được tệp vào bước bất kỳ, kể cả bước của hồ sơ khác.
      const subtask = input.subtaskId
        ? (instance.subtasks ?? []).find((item) => item.id === input.subtaskId)
        : undefined;
      if (input.subtaskId && !subtask) {
        throw new ProcedureEngineError('not_found', 'Không tìm thấy đầu việc để đính kèm.');
      }
      stepInstanceId = subtask?.stepInstanceId ?? instance.currentStepId ?? null;
    }

    const id=randomUUID();
    const safeName=input.fileName.trim().replace(/[^a-zA-Z0-9._-]+/g,'-');
    const objectKey=`tenants/${actor.tenantId}/procedure/${instanceId}/${id}-${safeName}`;
    const result=await pool.query<AttachmentRow>(`INSERT INTO procedure_schema.attachments
      (id,instance_id,step_instance_id,subtask_id,object_key,file_name,content_type,size_bytes,uploaded_by)
      SELECT $1,i.id,$3,$9,$4,$5,$6,$7,$8 FROM procedure_schema.instances i WHERE i.id=$2 RETURNING *`,
      [id,instanceId,stepInstanceId,objectKey,input.fileName.trim(),input.contentType.trim(),input.sizeBytes??null,actor.userId,input.subtaskId??null]);
    const row=result.rows[0];
    if(!row) throw new ProcedureEngineError('not_found','Không tìm thấy phiên quy trình.');
    const expiresInSeconds = TENANT_UPLOAD_URL_TTL_SECONDS;
    return {attachment:this.map(row),uploadUrl:await this.storage.createUploadUrl({key:objectKey,contentType:input.contentType,expiresInSeconds}),expiresInSeconds};
  }

  /**
   * Xoá mọi đính kèm của một hồ sơ.
   *
   * Cần khi xoá hẳn hồ sơ: `attachments` là bảng duy nhất `synchronizeNormalized`
   * không dựng lại, và FK của nó trỏ vào `instances` — để lại sẽ vỡ ràng buộc
   * lúc commit. Object trong kho lưu trữ vẫn để lại, dọn riêng.
   */
  /**
   * Đính kèm một tệp do HỆ THỐNG sinh ra, không qua người dùng.
   *
   * Khác `create` ở hai chỗ, và cả hai đều có lý do:
   *  - Không kiểm quyền theo actor: đây là hệ thống tự gắn bảng kê vào đơn nó
   *    vừa mở, không có người nào đang bấm để mà xét vai.
   *  - Tự PUT nội dung lên storage thay vì trả URL cho client.
   *
   * Đường ghi này phải dùng endpoint nội bộ. URL ký trước dành cho browser có
   * host public; server không nên vòng ra Internet để tải tệp do chính nó sinh.
   */
  async attachGenerated(
    tenantId: string,
    instanceId: string,
    input: { fileName: string; contentType: string; body: string },
  ): Promise<ProcedureAttachment> {
    const pool = await this.pools.forTenant(this.references.require(tenantId));
    const id = randomUUID();
    const safeName = input.fileName.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
    const objectKey = `tenants/${tenantId}/procedure/${instanceId}/${id}-${safeName}`;

    // `step_instance_id` để NULL có chủ đích. Bảng kê thuộc về CẢ ĐƠN, không
    // thuộc riêng bước nào; và `instances.current_step_id` trỏ vào bảng `steps`
    // của định nghĩa, không phải `step_instances` mà cột đính kèm tham chiếu —
    // nhét nó vào đây là vi phạm khoá ngoại.

    const bytes = Buffer.byteLength(input.body, 'utf8');

    const result = await pool.query<AttachmentRow>(`INSERT INTO procedure_schema.attachments
      (id,instance_id,step_instance_id,subtask_id,object_key,file_name,content_type,size_bytes,uploaded_by)
      SELECT $1,i.id,NULL,NULL,$3,$4,$5,$6,$7 FROM procedure_schema.instances i WHERE i.id=$2 RETURNING *`,
      [id, instanceId, objectKey, safeName, input.contentType, bytes, PROCEDURE_SYSTEM_ACTOR_ID]);
    const row = result.rows[0];
    if (!row) throw new ProcedureEngineError('not_found', 'Không tìm thấy hồ sơ để đính kèm.');

    try {
      await this.storage.putObject({
        key: objectKey,
        contentType: input.contentType,
        body: input.body,
      });
    } catch {
      // Dòng đính kèm trỏ vào object không tồn tại thì tệ hơn là không có dòng
      // nào: người dùng bấm tải về và nhận lỗi khó hiểu.
      await pool.query(`DELETE FROM procedure_schema.attachments WHERE id=$1`, [id]);
      throw new ProcedureEngineError('conflict', 'Không tải được bảng kê lên kho tệp.');
    }
    const instance = await this.loadInstance(pool, instanceId);
    await inTransaction(pool, (client) => this.emitAdded(client, tenantId, instance, row));
    return this.map(row);
  }

  /**
   * Trình duyệt báo đã PUT xong tệp lên kho. Chỉ từ lúc này tệp mới có thật, nên sự kiện sang Workspace
   * phát ở đây chứ không phát lúc tạo dòng (lúc đó tệp có thể không bao giờ tới).
   *
   * Gọi lặp an toàn: Workspace chống trùng theo khoá tệp.
   */
  async complete(actor: ProcedureActor, instanceId: string, attachmentId: string): Promise<ProcedureAttachment> {
    const pool = await this.pools.forTenant(this.references.require(actor.tenantId));
    const instance = await this.loadInstance(pool, instanceId);
    const result = await pool.query<AttachmentRow>(
      `SELECT * FROM procedure_schema.attachments WHERE id=$1 AND instance_id=$2`, [attachmentId, instanceId]);
    const row = result.rows[0];
    // Chỉ người đã tải tệp lên mới báo xong được tệp đó.
    if (!row || row.uploaded_by !== actor.userId) {
      throw new ProcedureEngineError('not_found', 'Không tìm thấy tệp đính kèm.');
    }
    await inTransaction(pool, (client) => this.emitAdded(client, actor.tenantId, instance, row));
    return this.map(row);
  }

  /**
   * Đơn gắn dự án Workspace (đã gắn, đang chờ gắn, hay mở từ công việc) thì báo Workspace có tệp mới để
   * đưa vào thư mục công việc của dự án. Đơn không gắn dự án thì không phát gì.
   */
  private async emitAdded(
    client: PoolClient,
    tenantId: string,
    instance: ProcedureInstance,
    row: AttachmentRow,
  ): Promise<void> {
    if (!instance.workspaceLink && instance.sourceType !== 'workspace_work_item') return;
    // Workspace đã từ chối gắn dự án: không có công việc nào để nhận tệp.
    if (instance.workspaceLink?.status === 'rejected') return;
    const payload: AttachmentAddedPayload = {
      instanceId: instance.id,
      instanceCode: instance.code,
      attachmentId: row.id,
      objectKey: row.object_key,
      fileName: row.file_name,
      contentType: row.content_type,
      sizeBytes: row.size_bytes ? Number(row.size_bytes) : 0,
      uploadedBy: row.uploaded_by,
      originLabel: attachmentOriginLabel(instance, row),
    };
    const event = createIntegrationEvent({
      id: randomUUID(),
      type: ATTACHMENT_ADDED_EVENT,
      version: 1,
      tenantId,
      source: 'procedure-engine',
      correlationId: instance.id,
      payload: { ...payload },
    });
    await client.query(
      `INSERT INTO integration_schema.outbox_events
        (id,aggregate_type,aggregate_id,event_type,event_version,payload,occurred_at)
        VALUES ($1,'procedure-instance',$2,$3,$4,$5::jsonb,$6)`,
      [event.id, instance.id, event.type, event.version, JSON.stringify(event), event.occurredAt],
    );
  }

  async deleteForInstance(tenantId: string, instanceId: string): Promise<number> {
    const pool = await this.pools.forTenant(this.references.require(tenantId));
    const result = await pool.query(
      `DELETE FROM procedure_schema.attachments WHERE instance_id = $1`,
      [instanceId],
    );
    return result.rowCount ?? 0;
  }

  async list(actor: ProcedureActor, instanceId: string): Promise<ProcedureAttachment[]> {
    const pool=await this.pools.forTenant(this.references.require(actor.tenantId));

    // Tệp thuộc về từng hồ sơ: chỉ người có mặt trong hồ sơ mới xem được. Quản trị
    // thấy mọi hồ sơ nên vị từ này đã bao gồm họ. Cố ý KHÔNG đòi hồ sơ còn chạy —
    // hồ sơ đóng rồi vẫn phải tra cứu lại được tài liệu.
    const instance = await this.loadInstance(pool, instanceId);
    if (!isProcedureParticipant(instance, actor)) {
      throw new ProcedureEngineError('forbidden', 'Bạn không có mặt trong hồ sơ này.');
    }

    const result=await pool.query<AttachmentRow>(`SELECT * FROM procedure_schema.attachments WHERE instance_id=$1 ORDER BY created_at DESC`,[instanceId]);
    return Promise.all(result.rows.map(async(row)=>({...this.map(row),downloadUrl:await this.storage.createDownloadUrl(row.object_key)})));
  }

  /** Bằng chứng đã nộp cho một đầu việc — cửa chặn của completeSubtask. */
  async countForSubtask(tenantId: string, instanceId: string, subtaskId: string): Promise<number> {
    const pool=await this.pools.forTenant(this.references.require(tenantId));
    const result=await pool.query<{count:string}>(
      `SELECT count(*)::text AS count FROM procedure_schema.attachments
        WHERE instance_id=$1 AND subtask_id=$2`,[instanceId,subtaskId]);
    return Number(result.rows[0]?.count ?? 0);
  }

  private map(row:AttachmentRow):ProcedureAttachment{return {id:row.id,instanceId:row.instance_id,stepInstanceId:row.step_instance_id??undefined,subtaskId:row.subtask_id??undefined,fileName:row.file_name,contentType:row.content_type,sizeBytes:row.size_bytes?Number(row.size_bytes):undefined,uploadedBy:row.uploaded_by,createdAt:row.created_at.toISOString(),origin:attachmentOrigin(row)}}
}

/** Tệp không gắn bước: do hệ thống sinh (bảng kê) hay người tham gia bổ sung. */
function attachmentOrigin(row: Pick<AttachmentRow, 'step_instance_id' | 'uploaded_by'>): 'step' | 'supplement' | 'system' {
  if (row.step_instance_id) return 'step';
  return row.uploaded_by === PROCEDURE_SYSTEM_ACTOR_ID ? 'system' : 'supplement';
}

/** Thẻ nguồn của tệp: "Bước N" (số thứ tự bước như màn hình hiện), "Bổ sung" hoặc "Hệ thống". */
export function attachmentOriginLabel(
  instance: Pick<ProcedureInstance, 'steps'>,
  row: Pick<AttachmentRow, 'step_instance_id' | 'uploaded_by'>,
): string {
  const origin = attachmentOrigin(row);
  if (origin === 'system') return 'Hệ thống';
  if (origin === 'supplement') return 'Bổ sung';
  const step = instance.steps.find((candidate) => candidate.id === row.step_instance_id);
  return step ? `Bước ${step.order}` : 'Bước';
}
