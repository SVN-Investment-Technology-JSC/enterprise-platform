import type { CrmStatus } from '@enterprise-platform/contracts-crm';
import { Controller, Get, HttpException, Inject, Req } from '@nestjs/common';
import { crmCapabilities, type CrmActor } from '../application/crm-actor.js';
import { CRM_DIAGNOSTICS, type CrmDiagnostics } from '../application/crm-store.port.js';
import { CrmError } from '../domain/crm.error.js';

/** Guard gắn danh tính đã xác minh vào request dưới tên `crmActor`. */
export interface CrmRequest {
  crmActor?: CrmActor;
}

@Controller('v1')
export class CrmController {
  constructor(@Inject(CRM_DIAGNOSTICS) private readonly diagnostics: CrmDiagnostics) {}

  /** Mức sẵn sàng của phân hệ và quyền của người đang đăng nhập (chỉ để ẩn hiện). */
  @Get('status')
  status(@Req() request: CrmRequest): Promise<CrmStatus> {
    return this.execute(async () => {
      const actor = this.actor(request);
      const schema = await this.diagnostics.schemaStatus(actor.tenantId);
      return { tenantId: actor.tenantId, ...schema, capabilities: crmCapabilities(actor) };
    });
  }

  private actor(request: CrmRequest): CrmActor {
    if (!request.crmActor) {
      // Guard luôn gắn actor trước khi tới đây; thiếu là cấu hình sai.
      throw new HttpException({ statusCode: 401, code: 'UNAUTHENTICATED', message: 'Chưa đăng nhập.' }, 401);
    }
    return request.crmActor;
  }

  private async execute<TValue>(operation: () => Promise<TValue>): Promise<TValue> {
    try {
      return await operation();
    } catch (error) {
      // Id trên URL không phải UUID: với người gọi, đó là "không tìm thấy".
      if ((error as { code?: string } | null)?.code === '22P02') {
        throw new HttpException(
          { statusCode: 404, code: 'NOT_FOUND', message: 'Không tìm thấy mục được yêu cầu.' },
          404,
        );
      }
      if (!(error instanceof CrmError)) throw error;
      throw new HttpException(
        { statusCode: error.statusCode, code: error.code, message: error.message },
        error.statusCode,
      );
    }
  }
}
