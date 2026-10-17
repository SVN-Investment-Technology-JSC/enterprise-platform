import {
  toCatalogItem,
  type AssistantAction,
  type AssistantCatalogItem,
} from '@enterprise-platform/contracts-assistant';
import { Controller, Get, Req, type Type } from '@nestjs/common';
import type { Request } from 'express';
import { ModuleAccess } from './module-access';

export interface AssistantCatalogResponse {
  readonly actions: readonly AssistantCatalogItem[];
}

/**
 * Controller `GET v1/assistant/actions` cho API của một phân hệ: trả các thao tác Trợ lý mà người gọi làm được.
 *
 * Mỗi khoá quyền của danh mục được hỏi Platform bằng `ModuleAccess.decision`, đúng đường guard của phân hệ đang dùng,
 * nên kết quả trùng với những gì người đó làm được trên màn hình và đổi ngay khi quản trị đổi quyền. Controller tự
 * xác thực, không dựa vào guard của app (guard HRM chỉ xét controller có tên bắt đầu bằng `Hrm`).
 *
 * @example controllers: [HealthController, assistantActionsController('workspace', WORKSPACE_ASSISTANT_ACTIONS)]
 */
export function assistantActionsController(
  moduleKey: string,
  catalog: Readonly<Record<string, AssistantAction>>,
  access: ModuleAccess = new ModuleAccess({ moduleKey }),
): Type<unknown> {
  const actions = Object.values(catalog);
  const permissions = [...new Set(actions.map((a) => a.permission))];

  @Controller('v1/assistant')
  class AssistantActionsController {
    @Get('actions')
    async list(@Req() request: Request): Promise<AssistantCatalogResponse> {
      const principal = await access.tenantUser(request);
      const decisions = await Promise.all(permissions.map((p) => access.decision(principal, p)));
      const allowed = new Set(permissions.filter((_, i) => decisions[i].allowed));
      return { actions: actions.filter((a) => allowed.has(a.permission)).map(toCatalogItem) };
    }
  }

  return AssistantActionsController;
}
