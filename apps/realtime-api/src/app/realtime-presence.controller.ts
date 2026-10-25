import type { PresenceSnapshot } from '@enterprise-platform/contracts-realtime';
import { Controller, Get, Inject, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { RealtimePresence } from './realtime-presence';
import type { RealtimeAuthClient } from './realtime-runtime';
import { REALTIME_AUTH_CLIENT } from './realtime-tokens';

/**
 * Ảnh chụp trạng thái trực tuyến của cả công ty, cho khung chat lúc mở và khi nối lại (tín hiệu
 * `core.presence.changed` chỉ báo phần thay đổi). Chỉ trả id người dùng và thời điểm cuối còn kết nối.
 */
@Controller('realtime/v1')
export class RealtimePresenceController {
  constructor(
    @Inject(REALTIME_AUTH_CLIENT) private readonly auth: RealtimeAuthClient,
    private readonly presence: RealtimePresence,
  ) {}

  @Get('presence')
  async snapshot(@Req() request: Request): Promise<PresenceSnapshot> {
    let tenantId: string;
    try {
      tenantId = (await this.auth.authenticate(request.headers.cookie)).tenantId;
    } catch {
      throw new UnauthorizedException('Phiên đăng nhập đã hết hạn.');
    }
    try {
      return await this.presence.snapshot(tenantId);
    } catch {
      // Valkey tạm lỗi: coi như chưa biết ai trực tuyến, không làm hỏng khung chat.
      return { online: [], lastSeen: {} };
    }
  }
}
