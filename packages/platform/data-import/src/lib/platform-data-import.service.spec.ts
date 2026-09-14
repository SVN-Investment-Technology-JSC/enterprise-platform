import type { PlatformIdentityService } from '@enterprise-platform/platform-identity';
import { PlatformDataImportService } from './platform-data-import.service.js';

jest.mock('@enterprise-platform/platform-identity', () => ({}));

describe('PlatformDataImportService', () => {
  let service: PlatformDataImportService;

  beforeEach(() => {
    service = new PlatformDataImportService(
      {} as unknown as PlatformIdentityService,
    );
  });

  it('rejects an import without source files before accessing tenant data', async () => {
    await expect(service.preview('tenant-1', [])).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringContaining('XLSX hoặc CSV'),
      }),
    });
  });
});
