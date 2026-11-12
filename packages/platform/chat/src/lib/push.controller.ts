import {
  isAllowedPushEndpoint,
  isFcmPlatform,
  isValidFcmToken,
  type DeleteFcmDeviceRequest,
  type DeletePushSubscriptionRequest,
  type FcmPushStatus,
  type PushConfig,
  type RegisterFcmDeviceRequest,
  type SavePushSubscriptionRequest,
} from '@enterprise-platform/contracts-chat';
import { TenantCoreAccess } from '@enterprise-platform/platform-identity';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  OnModuleInit,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { fcmConfigFromEnv, logFcmBootStatus } from './fcm-config.js';
import { countUserFcmTokens, deleteFcmDeviceToken, saveFcmDeviceToken } from './fcm.store.js';
import { resolveVapid } from './push-config.js';
import { deleteSubscription, saveSubscription } from './push.store.js';

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

function key(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string' || value.length < min || value.length > max || !BASE64URL.test(value)) {
    throw new BadRequestException(`${field} không hợp lệ.`);
  }
  return value;
}

function optionalDeviceId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new BadRequestException('Mã thiết bị không hợp lệ.');
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 200) throw new BadRequestException('Mã thiết bị tối đa 200 ký tự.');
  return trimmed;
}

function isFcmConfigured(): boolean {
  try {
    return Boolean(fcmConfigFromEnv());
  } catch {
    return false;
  }
}

/**
 * Đăng ký nhận thông báo đẩy của trình duyệt (Web Push) và thiết bị di động (Firebase Cloud Messaging - FCM).
 * Mọi người dùng doanh nghiệp đều dùng được; mỗi người chỉ đọc và sửa được đăng ký thiết bị của chính mình.
 */
@Controller('platform/v1/push')
export class PushController implements OnModuleInit {
  constructor(private readonly access: TenantCoreAccess) {}

  onModuleInit(): void {
    logFcmBootStatus();
  }

  @Get('config')
  async config(@Req() request: Request): Promise<PushConfig> {
    const principal = await this.access.principal(request);
    const vapid = await resolveVapid(await this.access.pool(principal.tenantId));
    return { enabled: true, publicKey: vapid.publicKey };
  }

  @Put('subscription')
  @HttpCode(204)
  async save(@Req() request: Request, @Body() body: SavePushSubscriptionRequest): Promise<void> {
    const principal = await this.access.principal(request);
    this.access.requireCsrf(request);
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

  @Get('status')
  async status(@Req() request: Request): Promise<FcmPushStatus> {
    const principal = await this.access.principal(request);
    const tokens = await countUserFcmTokens(await this.access.pool(principal.tenantId), principal.userId);
    return { enabled: isFcmConfigured(), tokens };
  }

  @Post('devices')
  @HttpCode(204)
  async registerDevice(@Req() request: Request, @Body() body: RegisterFcmDeviceRequest): Promise<void> {
    const principal = await this.access.principal(request);
    this.access.requireCsrf(request);
    if (!isValidFcmToken(body?.token)) {
      throw new BadRequestException('Token nhận thông báo FCM không hợp lệ.');
    }
    if (!isFcmPlatform(body?.platform)) {
      throw new BadRequestException('Nền tảng thiết bị phải là ios hoặc android.');
    }
    const deviceId = optionalDeviceId(body?.deviceId);
    const userAgent = (request.get('user-agent') ?? '').slice(0, 300) || null;
    await this.access.transaction(principal.tenantId, (db) =>
      saveFcmDeviceToken(db, {
        userId: principal.userId,
        sessionId: principal.sessionId,
        token: body.token,
        platform: body.platform,
        deviceId,
        userAgent,
      }),
    );
  }

  @Delete('devices')
  @HttpCode(204)
  async removeDevice(@Req() request: Request, @Body() body?: DeleteFcmDeviceRequest): Promise<void> {
    const principal = await this.access.principal(request);
    this.access.requireCsrf(request);
    const token = body?.token !== undefined ? body.token : null;
    if (token !== null && !isValidFcmToken(token)) {
      throw new BadRequestException('Token nhận thông báo FCM không hợp lệ.');
    }
    const deviceId = optionalDeviceId(body?.deviceId);
    await deleteFcmDeviceToken(await this.access.pool(principal.tenantId), {
      userId: principal.userId,
      sessionId: principal.sessionId,
      token,
      deviceId,
    });
  }
}
