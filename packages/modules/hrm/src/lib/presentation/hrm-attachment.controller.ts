import {
  BadRequestException,
  Body,
  Controller,
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

const types: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};
@Controller('v1/attachments')
export class HrmAttachmentController {
  private readonly storage = new S3ObjectStorage({
    internalEndpoint:
      process.env.S3_INTERNAL_ENDPOINT ?? process.env.S3_ENDPOINT,
    publicEndpoint: process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? 'enterprise-platform',
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  });
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
    },
  ) {
    const { pool, tenantId, principal, employeeId } =
      await this.ctx.getRequestContext(req, body.employeeId);
    const name = requireText(body.fileName, 'Tên tệp', 255);
    const extension = name.split('.').pop()?.toLowerCase() || '';
    if (
      types[extension] !== body.contentType ||
      !Number.isInteger(body.sizeBytes) ||
      body.sizeBytes < 1 ||
      body.sizeBytes > 10485760
    )
      throw new BadRequestException(
        'Chứng từ phải là PDF, PNG hoặc JPEG, tối đa 10 MB',
      );
    const id = randomUUID(),
      key = `tenants/${tenantId}/hrm/${employeeId}/${id}.${extension}`;
    const uploadUrl = await this.storage.createUploadUrl({
      key,
      contentType: body.contentType,
      expiresInSeconds: 300,
    });
    await pool.query(
      `INSERT INTO hrm_schema.attachments(id,tenant_id,employee_id,file_name,object_key,content_type,size_bytes,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        tenantId,
        employeeId,
        name,
        key,
        body.contentType,
        body.sizeBytes,
        principal.userId,
      ],
    );
    return { data: { id, uploadUrl, contentType: body.contentType } };
  }
  private async owned(req: Request, id: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const result = await pool.query(
      `SELECT * FROM hrm_schema.attachments WHERE tenant_id=$1 AND id=$2`,
      [tenantId, requireUuid(id, 'id')],
    );
    if (!result.rows[0]) throw new NotFoundException('Không tìm thấy chứng từ');
    await this.ctx.getRequestContext(
      req,
      result.rows[0].employee_id,
      req.method === 'GET' ? 'hrm.request.read' : 'hrm.request.manage',
      req.method === 'GET' ? 'hrm.self.read' : 'hrm.self.request',
    );
    return { pool, tenantId, file: result.rows[0] };
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
    await pool.query(
      `UPDATE hrm_schema.attachments SET status='READY',verified_at=now() WHERE tenant_id=$1 AND id=$2`,
      [tenantId, id],
    );
    return { data: { id, status: 'READY' } };
  }
  @Get(':id/download')
  async download(@Req() req: Request, @Param('id') id: string) {
    const { file } = await this.owned(req, id);
    if (file.status !== 'READY')
      throw new BadRequestException('Tệp chưa xác nhận tải lên');
    return {
      data: {
        fileName: file.file_name,
        url: await this.storage.createDownloadUrl(file.object_key, 120),
      },
    };
  }
}
