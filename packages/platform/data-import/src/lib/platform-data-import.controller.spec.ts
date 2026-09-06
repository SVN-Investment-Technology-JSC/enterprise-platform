import type { PlatformIdentityService } from '@enterprise-platform/platform-identity';
import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { PlatformDataImportController } from './platform-data-import.controller.js';
import type { PlatformDataImportService } from './platform-data-import.service.js';

jest.mock('@enterprise-platform/platform-identity', () => ({}));

describe('PlatformDataImportController', () => {
  let controller: PlatformDataImportController;

  beforeEach(() => {
    controller = new PlatformDataImportController(
      {} as unknown as PlatformDataImportService,
      {} as unknown as PlatformIdentityService,
    );
  });

  it('rejects an anonymous upload before reading its files', async () => {
    await expect(
      controller.preview(
        { headers: {}, cookies: {} } as unknown as Request,
        { tenantId: 'tenant-1' },
        [],
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
