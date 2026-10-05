import {
  BadRequestException,
  Body,
  Controller,
  ConflictException,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { S3ObjectStorage } from '@enterprise-platform/adapter-storage';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { requireText, requireUuid } from '../infrastructure/hrm-validation.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { lockEmployee } from '../infrastructure/hrm-time.js';
import { lifecycleAudit } from '../infrastructure/hrm-lifecycle.js';

const types: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};
const PROFILE_DOCUMENT_TYPES = ['PHOTO', 'ID_CARD_FRONT', 'ID_CARD_BACK', 'QUALIFICATION'];
const CONFIDENTIAL_DOCUMENT_TYPES = ['ID_CARD_FRONT', 'ID_CARD_BACK'];
function storageOptions() {
  const internalEndpoint =
    process.env.S3_INTERNAL_ENDPOINT ?? process.env.S3_ENDPOINT;
  const publicEndpoint =
    process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT;
  const localDevelopment =
    process.env.NODE_ENV === 'development' &&
    [internalEndpoint, publicEndpoint].every(
      (endpoint) =>
        !endpoint ||
        /^http:\/\/(localhost|127\.0\.0\.1):9010\/?$/.test(endpoint),
    );
  return {
    internalEndpoint:
      internalEndpoint ??
      (localDevelopment ? 'http://localhost:9010' : undefined),
    publicEndpoint:
      publicEndpoint ??
      (localDevelopment ? 'http://localhost:9010' : undefined),
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? 'enterprise-platform',
    accessKeyId:
      process.env.S3_ACCESS_KEY_ID ??
      (localDevelopment ? 'platform' : undefined),
    secretAccessKey:
      process.env.S3_SECRET_ACCESS_KEY ??
      (localDevelopment ? 'platform-development-secret' : undefined),
  };
}
@Controller('v1/attachments')
export class HrmAttachmentController {
  private readonly storage = new S3ObjectStorage(storageOptions());
  constructor(private readonly ctx: HrmContextService) {}

  @Post()
  async create(
    @Req() req: Request,
    @Body()
    body: {
      employeeId?: string;
      fileName: string;
      contentType: string;
      sizeBytes: number;
      documentType?: string;
    },
  ) {
    const documentType = body.documentType;
    if (documentType !== undefined && !PROFILE_DOCUMENT_TYPES.includes(documentType))
      throw new BadRequestException('Loại giấy tờ không hợp lệ');
    // Giấy tờ hồ sơ: HR tải thay cho nhân sự bằng quyền quản lý hồ sơ; nhân sự tự tải cho mình.
    const { pool, tenantId, principal, employeeId } = documentType
      ? await this.ctx.getRequestContext(
          req,
          body.employeeId,
          'hrm.employee.manage',
          'hrm.self.request',
        )
      : await this.ctx.getRequestContext(req, body.employeeId);
    const name = requireText(body.fileName, 'Tên tệp', 255);
    const extension = name.split('.').pop()?.toLowerCase() || '';
    if (
      types[extension] !== body.contentType ||
      !Number.isInteger(body.sizeBytes) ||
      body.sizeBytes < 1 ||
      body.sizeBytes > 10485760
    )
      throw new BadRequestException(
        'Chứng từ phải là PDF, PNG, JPEG hoặc WEBP, tối đa 10 MB',
      );
    if (documentType === 'PHOTO' && !body.contentType.startsWith('image/'))
      throw new BadRequestException('Ảnh thẻ phải là PNG, JPEG hoặc WEBP');
    const id = randomUUID(),
      key = `tenants/${tenantId}/hrm/${employeeId}/${id}.${extension}`;
    const uploadUrl = await this.storage.createUploadUrl({
      key,
      contentType: body.contentType,
      expiresInSeconds: 300,
    });
    await pool.query(
      `INSERT INTO hrm_schema.attachments(id,tenant_id,employee_id,file_name,object_key,content_type,size_bytes,uploaded_by,document_type,is_confidential) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        tenantId,
        employeeId,
        name,
        key,
        body.contentType,
        body.sizeBytes,
        principal.userId,
        documentType ?? null,
        CONFIDENTIAL_DOCUMENT_TYPES.includes(documentType ?? ''),
      ],
    );
    return { data: { id, uploadUrl, contentType: body.contentType } };
  }
  private async owned(req: Request, id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.read',
    );
    const result = await pool.query(
      `SELECT * FROM hrm_schema.attachments WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL`,
      [tenantId, requireUuid(id, 'id')],
    );
    if (!result.rows[0]) throw new NotFoundException('Không tìm thấy chứng từ');
    await this.ctx.getRequestContext(
      req,
      result.rows[0].employee_id,
      req.method === 'GET' ? 'hrm.request.read' : 'hrm.request.manage',
      req.method === 'GET' ? 'hrm.self.read' : 'hrm.self.request',
    );
    return { pool, tenantId, principal, file: result.rows[0] };
  }
  @Post(':id/complete')
  async complete(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, file } = await this.owned(req, id);
    if (file.status === 'READY') return { data: { id, status: 'READY' } };
    let metadata;
    try {
      metadata = await this.storage.objectMetadata(file.object_key);
    } catch {
      throw new BadRequestException('Tệp chưa tải lên kho lưu trữ thành công');
    }
    if (
      metadata.sizeBytes !== file.size_bytes ||
      metadata.contentType !== file.content_type
    )
      throw new BadRequestException(
        'Kích thước hoặc định dạng tệp không khớp khai báo',
      );
    const updated = await pool.query(
      `UPDATE hrm_schema.attachments SET status='READY',verified_at=now() WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING id`,
      [tenantId, id],
    );
    if (!updated.rowCount) throw new NotFoundException('Chứng từ đã được gỡ');
    return { data: { id, status: 'READY' } };
  }
  @Get(':id/download')
  async download(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal, file } = await this.owned(req, id);
    if (file.status !== 'READY')
      throw new BadRequestException('Tệp chưa xác nhận tải lên');
    if (file.is_confidential) {
      // Ảnh CCCD, hộ chiếu: chỉ chính chủ hoặc người quản lý hồ sơ, và mỗi lần tải đều ghi nhật ký.
      const own = await pool.query(
        `SELECT 1 FROM core_schema.employees WHERE tenant_id=$1 AND id=$2 AND user_id=$3 AND deleted_at IS NULL`,
        [tenantId, file.employee_id, principal.userId],
      );
      if (!own.rowCount && !this.ctx.has({ principal }, 'hrm.employee.manage'))
        throw new ForbiddenException('Không có quyền xem giấy tờ nhạy cảm');
      await lifecycleAudit(pool, tenantId, principal.userId, 'SENSITIVE_ATTACHMENT_DOWNLOADED', id, {
        employeeId: file.employee_id,
        documentType: file.document_type,
      });
    }
    return {
      data: {
        fileName: file.file_name,
        url: await this.storage.createDownloadUrl(file.object_key, 120),
      },
    };
  }

  @Delete(':id')
  async remove(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    const { pool, tenantId, principal, file } = await this.owned(req, id);
    requireText(body.reason, 'Lý do gỡ chứng từ', 2000);
    const changedDrafts = await hrmTransaction(pool, async (db) => {
      await lockEmployee(db, tenantId, file.employee_id);
      const current = await db.query(
        'SELECT * FROM hrm_schema.attachments WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',
        [tenantId, id],
      );
      if (!current.rowCount) throw new NotFoundException('Chứng từ đã được gỡ');
      const used = await db.query(
        'SELECT id FROM hrm_schema.leave_requests WHERE tenant_id=$1 AND attachment_file_id=$2 LIMIT 1',
        [tenantId, id],
      );
      if (used.rowCount)
        throw new ConflictException(
          'Chứng từ đã thuộc đơn được gửi; giữ bản gốc để truy vết',
        );
      const inProfile = await db.query(
        `SELECT 1 FROM hrm_schema.employee_profiles WHERE tenant_id=$1 AND $2 IN (photo_attachment_id,identity_card_front_attachment_id,identity_card_back_attachment_id)
         UNION ALL SELECT 1 FROM hrm_schema.employee_qualifications WHERE tenant_id=$1 AND attachment_id=$2 AND deleted_at IS NULL LIMIT 1`,
        [tenantId, id],
      );
      if (inProfile.rowCount)
        throw new ConflictException(
          'Tệp đang là giấy tờ hiện hành của hồ sơ; hãy thay bằng bản mới qua đơn điều chỉnh',
        );
      const drafts = await db.query(
        `UPDATE hrm_schema.request_drafts SET payload=payload-'attachmentFileId',revision=revision+1,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE tenant_id=$1 AND employee_id=$2 AND status='DRAFT' AND payload->>'attachmentFileId'=$3 RETURNING id,revision,updated_at`,
        [tenantId, file.employee_id, id],
      );
      await db.query(
        'UPDATE hrm_schema.attachments SET deleted_at=now(),deleted_by=$3,delete_reason=$4 WHERE tenant_id=$1 AND id=$2',
        [tenantId, id, principal.userId, body.reason],
      );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'ATTACHMENT_REMOVED',
        id,
        { before: current.rows[0], reason: body.reason, drafts: drafts.rows },
      );
      return drafts.rows.map((row) => ({
        id: row.id,
        revision: row.revision,
        updatedAt: new Date(row.updated_at).toISOString(),
      }));
    });
    return { data: { id, deleted: true, changedDrafts } };
  }
}
