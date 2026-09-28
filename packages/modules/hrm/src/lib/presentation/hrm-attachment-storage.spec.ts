import { S3ObjectStorage } from '@enterprise-platform/adapter-storage';
import { HrmAttachmentController } from './hrm-attachment.controller';
jest.mock('@enterprise-platform/adapter-storage', () => ({
  S3ObjectStorage: jest.fn(),
}));
jest.mock('../infrastructure/hrm-context.service.js', () => ({
  HrmContextService: class {},
}));
describe('HRM local attachment storage configuration', () => {
  const keys = [
    'NODE_ENV',
    'S3_ENDPOINT',
    'S3_INTERNAL_ENDPOINT',
    'S3_PUBLIC_ENDPOINT',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
  ];
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const key of keys) delete process.env[key];
    jest.clearAllMocks();
  });
  afterEach(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
  it('uses compose-local storage defaults during development', () => {
    process.env.NODE_ENV = 'development';
    new HrmAttachmentController({} as any);
    expect(S3ObjectStorage).toHaveBeenCalledWith(
      expect.objectContaining({
        internalEndpoint: 'http://localhost:9010',
        publicEndpoint: 'http://localhost:9010',
        accessKeyId: 'platform',
        secretAccessKey: 'platform-development-secret',
      }),
    );
  });
  it('never supplies development credentials to a production or remote endpoint', () => {
    process.env.NODE_ENV = 'production';
    new HrmAttachmentController({} as any);
    expect(S3ObjectStorage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        accessKeyId: undefined,
        secretAccessKey: undefined,
      }),
    );
    process.env.NODE_ENV = 'development';
    process.env.S3_ENDPOINT = 'https://objects.example.test';
    new HrmAttachmentController({} as any);
    expect(S3ObjectStorage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        internalEndpoint: 'https://objects.example.test',
        accessKeyId: undefined,
        secretAccessKey: undefined,
      }),
    );
  });
});
