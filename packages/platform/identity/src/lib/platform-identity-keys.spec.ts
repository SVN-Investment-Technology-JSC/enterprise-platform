import { generateKeyPair, importPKCS8, importSPKI } from 'jose';
import { loadPlatformIdentityKeys, PLATFORM_IDENTITY_KEY_ID } from './platform-identity-keys';

// jose là ESM thuần, Jest của repo không biên dịch được bản thật; giả lập đủ cho phần nạp khoá.
jest.mock('jose', () => ({
  exportJWK: jest.fn(async () => ({ kty: 'RSA', n: 'n', e: 'AQAB' })),
  generateKeyPair: jest.fn(async () => ({ privateKey: { generated: 'private' }, publicKey: { generated: 'public' } })),
  importPKCS8: jest.fn(async (pem: string) => ({ imported: pem })),
  importSPKI: jest.fn(async (pem: string) => ({ imported: pem })),
}));

const generate = generateKeyPair as jest.Mock;

describe('loadPlatformIdentityKeys', () => {
  beforeEach(() => jest.clearAllMocks());

  it('OPS015-04: production thiếu AUTH_PRIVATE_KEY thì ném lỗi nêu tên biến, không tự sinh khoá', async () => {
    await expect(
      loadPlatformIdentityKeys({ NODE_ENV: 'production', AUTH_PUBLIC_KEY: 'public-pem' }),
    ).rejects.toThrow(/thiếu biến môi trường AUTH_PRIVATE_KEY\./);
    expect(generate).not.toHaveBeenCalled();
  });

  it('OPS015-04: production thiếu cả hai khoá (hoặc chỉ có khoảng trắng) thì nêu cả hai', async () => {
    await expect(
      loadPlatformIdentityKeys({ NODE_ENV: 'production', AUTH_PRIVATE_KEY: '  ' }),
    ).rejects.toThrow(/AUTH_PRIVATE_KEY, AUTH_PUBLIC_KEY/);
    expect(generate).not.toHaveBeenCalled();
  });

  it('OPS015-05: dev thiếu khoá thì vẫn tự sinh cặp khoá tạm như cũ', async () => {
    const keys = await loadPlatformIdentityKeys({ NODE_ENV: 'development' });
    expect(generate).toHaveBeenCalledWith('RS256', { modulusLength: 2048 });
    expect(keys.privateKey).toEqual({ generated: 'private' });
    expect(keys.jwk).toMatchObject({ kid: PLATFORM_IDENTITY_KEY_ID, alg: 'RS256', use: 'sig' });
  });

  it('production đủ khoá thì nạp khoá (đổi \\n dạng chuỗi thành xuống dòng), không tự sinh', async () => {
    const keys = await loadPlatformIdentityKeys({
      NODE_ENV: 'production',
      AUTH_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
      AUTH_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\\nxyz\\n-----END PUBLIC KEY-----',
    });
    expect(generate).not.toHaveBeenCalled();
    expect(importPKCS8).toHaveBeenCalledWith('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----', 'RS256');
    expect(importSPKI).toHaveBeenCalledWith('-----BEGIN PUBLIC KEY-----\nxyz\n-----END PUBLIC KEY-----', 'RS256');
    expect(keys.jwk.kid).toBe(PLATFORM_IDENTITY_KEY_ID);
  });
});
