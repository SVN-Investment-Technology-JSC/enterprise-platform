import {
  isAllowedPushEndpoint,
  type DeletePushSubscriptionRequest,
  type PushConfig,
  type SavePushSubscriptionRequest,
} from '@enterprise-platform/contracts-chat';
import { TenantCoreAccess } from '@enterprise-platform/platform-identity';
import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { pushConfig } from './push-config.js';
import { deleteSubscription, saveSubscription } from './push.store.js';

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

function key(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string' || value.length < min || value.length > max || !BASE64URL.test(value)) {
    throw new BadRequestException(`${field} không hợp lệ.`);
  }
  return value;
}

/**
 * Đăng ký nhận thông báo đẩy của trình duyệt (để báo tin nhắn chat cả khi đã đóng tab). Mọi người dùng doanh nghiệp
 * đều dùng được; mỗi người chỉ sửa được đăng ký của chính mình.
 */
@Controller('platform/v1/push')
export class PushController {
  constructor(private readonly access: TenantCoreAccess) {}

  @Get('config')
  async config(@Req() request: Request): Promise<PushConfig> {
    await this.access.principal(request);
    return pushConfig();
  }

  @Put('subscription')
  @HttpCode(204)
  async save(@Req() request: Request, @Body() body: SavePushSubscriptionRequest): Promise<void> {
    const principal = await this.access.principal(request);
    this.access.requireCsrf(request);
    if (!pushConfig().enabled) throw new BadRequestException('Máy chủ chưa bật thông báo đẩy.');
    if (!isAllowedPushEndpoint(body?.endpoint)) throw new BadRequestException('Địa chỉ nhận thông báo không hợp lệ.');
    const p256dh = key(body?.keys?.p256dh, 'Khoá mã hoá', 80, 200);
    const auth = key(body?.keys?.auth, 'Khoá xác thực', 16, 100);
    const userAgent = (request.get('user-agent') ?? '').slice(0, 300) || null;
    await this.access.transaction(principal.tenantId, (db) =>
      saveSubscription(db, { userId: principal.userId, endpoint: body.endpoint, p256dh, auth, userAgent }),
    );
  }

  @Delete('subscription')
  @HttpCode(204)
  async remove(@Req() request: Request, @Body() body: DeletePushSubscriptionRequest): Promise<void> {
    const principal = await this.access.principal(request);
    this.access.requireCsrf(request);
    if (typeof body?.endpoint !== 'string' || body.endpoint.length > 2048) throw new BadRequestException('Địa chỉ nhận thông báo không hợp lệ.');
    await deleteSubscription(await this.access.pool(principal.tenantId), principal.userId, body.endpoint);
  }
}
