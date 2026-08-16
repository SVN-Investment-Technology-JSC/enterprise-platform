import type { ObjectStoragePort } from './adapter-storage.js';

describe('object storage port', () => {
  it('allows an S3-compatible implementation', async () => {
    const storage: ObjectStoragePort = {
      createUploadUrl: async ({ key }) => `https://storage.local/${key}`,
      createDownloadUrl: async (key) => `https://storage.local/${key}`,
    };
    await expect(
      storage.createUploadUrl({
        key: 'tenant/file.pdf',
        contentType: 'application/pdf',
      }),
    ).resolves.toContain('file.pdf');
  });
});

