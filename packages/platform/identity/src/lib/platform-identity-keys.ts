import { exportJWK, generateKeyPair, importPKCS8, importSPKI, type JWK } from 'jose';

export const PLATFORM_IDENTITY_KEY_ID = 'platform-core-rs256-v1';

export type PlatformIdentityKeys = {
  privateKey: Awaited<ReturnType<typeof importPKCS8>>;
  publicKey: Awaited<ReturnType<typeof importSPKI>>;
  jwk: JWK;
};

/**
 * Khoá ký JWT của Platform từ `AUTH_PRIVATE_KEY`/`AUTH_PUBLIC_KEY` (PEM, chấp nhận `\n` viết dạng chuỗi).
 *
 * Production thiếu khoá thì ném lỗi (ISS-OPS-015): khoá tự sinh khác nhau giữa các lần khởi động, nhưng `kid` cố định nên
 * phân hệ giữ JWKS cũ và trả 401 cho mọi phiên. Dev/test thiếu khoá thì vẫn tự sinh cặp khoá tạm như cũ.
 */
export async function loadPlatformIdentityKeys(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<PlatformIdentityKeys> {
  const privatePem = env.AUTH_PRIVATE_KEY?.trim() ? env.AUTH_PRIVATE_KEY.replaceAll('\\n', '\n') : undefined;
  const publicPem = env.AUTH_PUBLIC_KEY?.trim() ? env.AUTH_PUBLIC_KEY.replaceAll('\\n', '\n') : undefined;
  if ((!privatePem || !publicPem) && env.NODE_ENV === 'production') {
    const missing = [!privatePem && 'AUTH_PRIVATE_KEY', !publicPem && 'AUTH_PUBLIC_KEY'].filter(Boolean).join(', ');
    throw new Error(
      `api không ký được phiên đăng nhập trong production: thiếu biến môi trường ${missing}. ` +
        'Không tự sinh khoá tạm vì phân hệ sẽ giữ JWKS cũ và từ chối mọi phiên.',
    );
  }
  const pair =
    privatePem && publicPem
      ? {
          privateKey: await importPKCS8(privatePem, 'RS256'),
          publicKey: await importSPKI(publicPem, 'RS256'),
        }
      : await generateKeyPair('RS256', { modulusLength: 2048 });
  const jwk = await exportJWK(pair.publicKey);
  jwk.kid = PLATFORM_IDENTITY_KEY_ID;
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  return { ...pair, jwk };
}
