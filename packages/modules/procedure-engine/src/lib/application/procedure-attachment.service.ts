import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { S3ObjectStorage, type ObjectStoragePort } from '@enterprise-platform/adapter-storage';
import type { CreateProcedureAttachmentRequest, CreateProcedureAttachmentResponse, ProcedureAttachment } from '@enterprise-platform/contracts-procedure-engine';
import { randomUUID } from 'node:crypto';
import { ProcedureEngineError } from '../domain/procedure-engine.error.js';
import type { ProcedureActor } from '../domain/procedure-authorization.js';

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

  async create(actor: ProcedureActor, instanceId: string, input: CreateProcedureAttachmentRequest): Promise<CreateProcedureAttachmentResponse> {
    if (!input.fileName?.trim() || !input.contentType?.trim()) throw new ProcedureEngineError('validation','Tên file và content type là bắt buộc.');
    if ((input.sizeBytes ?? 0) > 50*1024*1024) throw new ProcedureEngineError('validation','File đính kèm không vượt quá 50 MB.');
    const pool=await this.pools.forTenant(this.references.require(actor.tenantId));
    const id=randomUUID();
    const safeName=input.fileName.trim().replace(/[^a-zA-Z0-9._-]+/g,'-');
    const objectKey=`tenants/${actor.tenantId}/procedure/${instanceId}/${id}-${safeName}`;
    const result=await pool.query<AttachmentRow>(`INSERT INTO procedure_schema.attachments
      (id,instance_id,step_instance_id,subtask_id,object_key,file_name,content_type,size_bytes,uploaded_by)
      SELECT $1,i.id,$3,$9,$4,$5,$6,$7,$8 FROM procedure_schema.instances i WHERE i.id=$2 RETURNING *`,
      [id,instanceId,input.stepInstanceId??null,objectKey,input.fileName.trim(),input.contentType.trim(),input.sizeBytes??null,actor.userId,input.subtaskId??null]);
    const row=result.rows[0];
    if(!row) throw new ProcedureEngineError('not_found','Không tìm thấy phiên quy trình.');
    const expiresInSeconds=300;
    return {attachment:this.map(row),uploadUrl:await this.storage.createUploadUrl({key:objectKey,contentType:input.contentType,expiresInSeconds}),expiresInSeconds};
  }

  async list(actor: ProcedureActor, instanceId: string): Promise<ProcedureAttachment[]> {
    const pool=await this.pools.forTenant(this.references.require(actor.tenantId));
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
