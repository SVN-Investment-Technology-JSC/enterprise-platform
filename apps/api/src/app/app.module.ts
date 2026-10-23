import { PlatformBrandModule } from '@enterprise-platform/platform-brand';
import { PlatformChatModule } from '@enterprise-platform/platform-chat';
import { PlatformDataImportModule } from '@enterprise-platform/platform-data-import';
import { PlatformIdentityModule } from '@enterprise-platform/platform-identity';
import { PlatformProfileModule } from '@enterprise-platform/platform-profile';
import { PlatformTenancyModule } from '@enterprise-platform/platform-tenancy';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    PlatformIdentityModule,
    PlatformBrandModule,
    PlatformDataImportModule,
    PlatformTenancyModule,
    // Chat nội bộ và ảnh đại diện: tính năng core, chạy cho mọi tenant không phụ thuộc phân hệ nào.
    PlatformProfileModule,
    PlatformChatModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
