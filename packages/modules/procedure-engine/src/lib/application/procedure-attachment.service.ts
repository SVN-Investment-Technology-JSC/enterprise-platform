import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { S3ObjectStorage, type ObjectStoragePort } from '@enterprise-platform/adapter-storage';
import {
  PROCEDURE_ATTACHMENT_MAX_BYTES,
  PROCEDURE_ATTACHMENT_TYPES,
  PROCEDURE_SYSTEM_ACTOR_ID,
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
  /**
   * Đính kèm một tệp do HỆ THỐNG sinh ra, không qua người dùng.
   *
   * Khác `create` ở hai chỗ, và cả hai đều có lý do:
   *  - Không kiểm quyền theo actor: đây là hệ thống tự gắn bảng kê vào đơn nó
   *    vừa mở, không có người nào đang bấm để mà xét vai.
   *  - Tự PUT nội dung lên storage thay vì trả URL cho client.
   *
   * Dùng URL ký trước rồi tự `fetch` PUT, chứ không thêm `putObject` vào
   * `ObjectStoragePort`: adapter đó dùng chung với core nên là vùng phải hỏi
   * trước. Đường này đạt cùng kết quả mà nằm gọn trong module.
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

    const uploadUrl = await this.storage.createUploadUrl({
      key: objectKey,
      contentType: input.contentType,
      expiresInSeconds: 300,
    });
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': input.contentType },
      body: input.body,
    });
    if (!response.ok) {
      // Dòng đính kèm trỏ vào object không tồn tại thì tệ hơn là không có dòng
      // nào: người dùng bấm tải về và nhận lỗi khó hiểu.
      await pool.query(`DELETE FROM procedure_schema.attachments WHERE id=$1`, [id]);
      throw new ProcedureEngineError('conflict', `Không tải được bảng kê lên kho tệp (${response.status}).`);
    }
    return this.map(row);
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

  private map(row:AttachmentRow):ProcedureAttachment{return {id:row.id,instanceId:row.instance_id,stepInstanceId:row.step_instance_id??undefined,subtaskId:row.subtask_id??undefined,fileName:row.file_name,contentType:row.content_type,sizeBytes:row.size_bytes?Number(row.size_bytes):undefined,uploadedBy:row.uploaded_by,createdAt:row.created_at.toISOString()}}
}
