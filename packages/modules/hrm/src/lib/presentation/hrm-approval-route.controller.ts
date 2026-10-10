import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { HrmMissingSchemaInterceptor } from '../infrastructure/hrm-missing-schema.interceptor.js';
import type { Request } from 'express';
import type { Pool } from 'pg';
import type {
  ApprovalRouteConfigResult,
  ApprovalRoutePreview,
} from '@enterprise-platform/contracts-hrm';
import { RequirePermission } from '../infrastructure/hrm-access.guard.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import {
  applyApprovalRoute,
  buildApprovalRouteItems,
  loadApprovalRouteRows,
  parseSetApprovalRoute,
  previewApprovalRoute,
  procedureIdsInUse,
  resolveProcedureNames,
} from '../infrastructure/hrm-approval-route.js';
import { procedureUnavailable } from '../infrastructure/hrm-procedure-api.js';
import { normalizeHrmRequestKind } from '../infrastructure/hrm-procedure-links.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { requireUuid } from '../infrastructure/hrm-validation.js';
import { procedureDefinitions } from '../infrastructure/hrm-work-references.js';

/**
 * Hai cách duyệt đơn: Quản lý trực tiếp (mặc định) hoặc Theo quy trình (Procedure Engine).
 * Cấu hình lưu ở `request_procedure_bindings` (xem infrastructure/hrm-approval-route.ts); đây chỉ là lớp HTTP
 * để màn "Duyệt đơn" đọc, ghi cách duyệt theo loại đơn và theo từng lý do, và để người làm đơn xem trước người duyệt.
 */
@UseInterceptors(HrmMissingSchemaInterceptor)
@Controller('v1')
export class HrmApprovalRouteController {
  constructor(private readonly ctx: HrmContextService) {}

  /** Cách duyệt của mọi loại đơn và của từng lý do (đơn nghỉ, làm thêm giờ, công tác, giải trình công, đổi ca). */
  @RequirePermission('hrm.automation.manage')
  @Get('approval-config')
  async getConfig(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.automation.manage',
    );
    return { data: await this.configResult(pool, tenantId) };
  }

  /** Đặt cách duyệt cho một loại đơn hoặc một lý do; trả lại toàn bộ danh sách đã cập nhật. */
  @RequirePermission('hrm.automation.manage')
  @Put('approval-config')
  async putConfig(@Req() req: Request, @Body() body: unknown) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.automation.manage',
    );
    const route = parseSetApprovalRoute(body);
    if (route.mode === 'PROCEDURE') {
      // Cùng kiểm tra với POST operations/workflow-rules: Procedure dùng được và quy trình đã công bố của tenant.
      if (!(await this.ctx.procedureAvailable(tenantId)))
        throw procedureUnavailable();
      if (
        !(await procedureDefinitions(req, tenantId)).some(
          (definition) => definition.id === route.definitionId,
        )
      )
        throw new BadRequestException(
          'Quy trình phải được công bố và thuộc tenant hiện tại',
        );
    }
    const warnings = await hrmTransaction(pool, (db) =>
      applyApprovalRoute(db, { tenantId, actorId: principal.userId, route }),
    );
    return { data: await this.configResult(pool, tenantId, warnings) };
  }

  /** Người duyệt dự kiến của một đơn (cho người làm đơn xem trước khi gửi). */
  @RequirePermission('hrm.read')
  @Get('approval-route')
  async getRoute(
    @Req() req: Request,
    @Query('kind') kind?: string,
    @Query('employeeId') employeeId?: string,
    @Query('reasonId') reasonId?: string,
  ): Promise<{ data: ApprovalRoutePreview }> {
    if (!kind?.trim()) throw new BadRequestException('Cần chọn loại đơn');
    const requestKind = normalizeHrmRequestKind(kind.trim());
    const target = employeeId?.trim()
      ? requireUuid(employeeId.trim(), 'Nhân viên')
      : undefined;
    const reason = reasonId?.trim()
      ? requireUuid(reasonId.trim(), 'Lý do')
      : null;
    const { pool, tenantId, employeeId: subjectId } = await this.subject(
      req,
      target,
    );
    return {
      data: await previewApprovalRoute(pool, {
        tenantId,
        kind: requestKind,
        employeeId: subjectId,
        reasonId: reason,
      }),
    };
  }

  /** Chính chủ (hrm.self.read) hoặc người xem hộ người khác (hrm.request.read hoặc hrm.request.manage). */
  private async subject(req: Request, employeeId?: string) {
    const context = await this.ctx.getContext(req, 'hrm.read');
    if (
      employeeId &&
      (this.ctx.has(context, 'hrm.request.read') ||
        this.ctx.has(context, 'hrm.request.manage'))
    )
      return { ...context, employeeId };
    return this.ctx.getRequestContext(
      req,
      employeeId,
      'hrm.request.read',
      'hrm.self.read',
    );
  }

  private async configResult(
    pool: Pool,
    tenantId: string,
    warnings?: readonly string[],
  ): Promise<ApprovalRouteConfigResult> {
    const rows = await loadApprovalRouteRows(pool, tenantId);
    const procedureAvailable = await this.ctx.procedureAvailable(tenantId);
    const ids = procedureIdsInUse(rows);
    // Procedure tắt thì không gọi mạng tra tên; dòng PROCEDURE hiện procedureName = null.
    const names =
      procedureAvailable && ids.length
        ? await resolveProcedureNames(tenantId, ids)
        : new Map<string, string>();
    return {
      items: buildApprovalRouteItems(rows, names),
      procedureAvailable,
      ...(warnings ? { warnings } : {}),
    };
  }
}
