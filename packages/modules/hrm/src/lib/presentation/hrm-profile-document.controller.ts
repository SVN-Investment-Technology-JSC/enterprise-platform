import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import {
  applyDocumentChanges,
  loadProfileDocuments,
  parseDocumentChanges,
} from '../infrastructure/hrm-profile-documents.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { lockEmployee } from '../infrastructure/hrm-time.js';
import { requireDate, requireUuid } from '../infrastructure/hrm-validation.js';

@Controller('v1')
export class HrmProfileDocumentController {
  constructor(private readonly ctx: HrmContextService) {}

  /** Ảnh thẻ, CCCD và bằng cấp của một nhân sự; nhân sự thường chỉ xem được hồ sơ của mình. */
  @Get('employees/:employeeId/profile-documents')
  async list(@Req() req: Request, @Param('employeeId') employeeId: string) {
    const { pool, tenantId, employeeId: visible } = await this.ctx.scoped(
      req,
      'hrm.employee.read',
      requireUuid(employeeId, 'employeeId'),
    );
    const data = await loadProfileDocuments(pool, tenantId, visible ?? employeeId);
    return { data };
  }

  /** HR và nhân sự tự cập nhật giấy tờ trực tiếp trên hồ sơ cá nhân. */
  @Post('employees/:employeeId/profile-documents')
  async apply(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
    @Body() body: { documentChanges?: unknown; identityCardExpiryDate?: string | null },
  ) {
    const id = requireUuid(employeeId, 'employeeId');
    const { pool, tenantId, principal } = await this.ctx.getRequestContext(
      req,
      id,
      'hrm.employee.manage',
      'hrm.self.profile.write',
    );
    const changes = parseDocumentChanges(body.documentChanges);
    if (body.identityCardExpiryDate)
      requireDate(body.identityCardExpiryDate, 'Ngày hết hạn CCCD');
    await hrmTransaction(pool, async (db) => {
      await lockEmployee(db, tenantId, id);
      if (body.identityCardExpiryDate !== undefined)
        await db.query(
          `UPDATE hrm_schema.employee_profiles SET identity_card_expiry_date=$3,updated_by=$4,updated_at=now() WHERE tenant_id=$1 AND employee_id=$2`,
          [tenantId, id, body.identityCardExpiryDate || null, principal.userId],
        );
      await applyDocumentChanges(db, tenantId, id, principal.userId, changes);
    });
    return { data: await loadProfileDocuments(pool, tenantId, id) };
  }
}
