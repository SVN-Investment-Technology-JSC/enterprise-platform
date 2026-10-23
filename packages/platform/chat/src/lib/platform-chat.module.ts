import { S3ObjectStorage, tenantStorageOptions } from '@enterprise-platform/adapter-storage';
import { PlatformIdentityModule, TenantCoreAccess } from '@enterprise-platform/platform-identity';
import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import { PushController } from './push.controller.js';

/**
 * Chat nội bộ của core (`/api/platform/v1/chat`). Dữ liệu ở `chat_schema` trong DB tenant (migration core 0015), tệp
 * đính kèm dưới `tenants/<id>/core/chat/` trong kho đối tượng chung, tín hiệu qua outbox tới realtime-api.
 */
@Module({
  imports: [PlatformIdentityModule],
  controllers: [ChatController, PushController],
  providers: [
    {
      provide: ChatService,
      inject: [TenantCoreAccess],
      useFactory: (access: TenantCoreAccess) => new ChatService(access, new S3ObjectStorage(tenantStorageOptions())),
    },
  ],
  exports: [ChatService],
})
export class PlatformChatModule {}
