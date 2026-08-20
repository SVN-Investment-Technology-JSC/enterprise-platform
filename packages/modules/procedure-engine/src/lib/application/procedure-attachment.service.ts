import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { S3ObjectStorage, type ObjectStoragePort } from '@enterprise-platform/adapter-storage';
import {
  PROCEDURE_ATTACHMENT_MAX_BYTES,
  PROCEDURE_ATTACHMENT_TYPES,
  type CreateProcedureAttachmentRequest,
  type CreateProcedureAttachmentResponse,
  type ProcedureAttachment,
  type ProcedureInstance,
} from '@enterprise-platform/contracts-procedure-engine';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { ProcedureEngineError } from '../domain/procedure-engine.error.js';
import {
  deriveProcedureAuthorization,
  isProcedureParticipant,
  type ProcedureActor,
} from '../domain/procedure-authorization.js';

interface AttachmentRow {
  id:string;instance_id:string;step_instance_id:string|null;subtask_id:string|null;object_key:string;
  file_name:string;content_type:string;size_bytes:string|null;uploaded_by:string;created_at:Date;
}

export class ProcedureAttachmentService {
  constructor(
    private readonly references: TenantDatabaseRegistry,
    private readonly pools: PostgresPoolRegistry,
    private readonly storage: ObjectStoragePort = new S3ObjectStorage({
      endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9010',
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
    if (!instance) throw new ProcedureEngineError('not_found', 'Không tìm thấy hồ sơ.');
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
    const stepInstanceId = subtask?.stepInstanceId ?? instance.currentStepId ?? null;

    const id=randomUUID();
    const safeName=input.fileName.trim().replace(/[^a-zA-Z0-9._-]+/g,'-');
    const objectKey=`tenants/${actor.tenantId}/procedure/${instanceId}/${id}-${safeName}`;
    const result=await pool.query<AttachmentRow>(`INSERT INTO procedure_schema.attachments
      (id,instance_id,step_instance_id,subtask_id,object_key,file_name,content_type,size_bytes,uploaded_by)
      SELECT $1,i.id,$3,$9,$4,$5,$6,$7,$8 FROM procedure_schema.instances i WHERE i.id=$2 RETURNING *`,
      [id,instanceId,stepInstanceId,objectKey,input.fileName.trim(),input.contentType.trim(),input.sizeBytes??null,actor.userId,input.subtaskId??null]);
    const row=result.rows[0];
    if(!row) throw new ProcedureEngineError('not_found','Không tìm thấy phiên quy trình.');
    const expiresInSeconds=300;
    return {attachment:this.map(row),uploadUrl:await this.storage.createUploadUrl({key:objectKey,contentType:input.contentType,expiresInSeconds}),expiresInSeconds};
  }

  /**
   * Xoá mọi đính kèm của một hồ sơ.
   *
   * Cần khi xoá hẳn hồ sơ: `attachments` là bảng duy nhất `synchronizeNormalized`
   * không dựng lại, và FK của nó trỏ vào `instances` — để lại sẽ vỡ ràng buộc
   * lúc commit. Object trong kho lưu trữ vẫn để lại, dọn riêng.
   */
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

  private map(row:AttachmentRow):ProcedureAttachment{return {id:row.id,instanceId:row.instance_id,stepInstanceId:row.step_instance_id??undefined,subtaskId:row.subtask_id??undefined,fileName:row.file_name,contentType:row.content_type,sizeBytes:row.size_bytes?Number(row.size_bytes):undefined,uploadedBy:row.uploaded_by,createdAt:row.created_at.toISOString()}}
}
