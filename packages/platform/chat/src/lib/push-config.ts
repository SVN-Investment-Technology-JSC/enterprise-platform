import { generateKeyPairSync } from 'node:crypto';
import type { ChatDb } from './chat.store.js';

export interface VapidConfig {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly subject: string;
}

const DEFAULT_SUBJECT = 'mailto:admin@localhost';

function subjectOf(env: NodeJS.ProcessEnv): string {
  return env.WEB_PUSH_SUBJECT?.trim() || DEFAULT_SUBJECT;
}

/** Cặp khoá VAPID đặt qua biến môi trường (dùng chung mọi công ty); thiếu khoá thì null. */
export function vapidFromEnv(env: NodeJS.ProcessEnv = process.env): VapidConfig | null {
  const publicKey = env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: subjectOf(env) };
}

/** Sinh cặp khoá VAPID (ECDSA P-256) dạng base64url: khoá công khai 65 byte (điểm không nén), khoá bí mật 32 byte. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  if (!jwk.x || !jwk.y || !jwk.d) throw new Error('Không sinh được khoá VAPID.');
  const point = Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  return { publicKey: point.toString('base64url'), privateKey: jwk.d };
}

/**
 * Khoá VAPID cho một công ty: ưu tiên biến môi trường; không có thì dùng cặp khoá lưu trong DB của công ty, chưa có thì
 * sinh mới (api và worker cùng sinh một lúc thì chỉ một cặp được giữ). Nhờ vậy triển khai không phải cấu hình gì.
 */
export async function resolveVapid(db: ChatDb, env: NodeJS.ProcessEnv = process.env): Promise<VapidConfig> {
  const configured = vapidFromEnv(env);
  if (configured) return configured;
  const read = async () =>
    (await db.query<{ public_key: string; private_key: string }>(`SELECT public_key, private_key FROM core_schema.web_push_keys WHERE id = 1`))
      .rows[0];
  let row = await read();
  if (!row) {
    const generated = generateVapidKeys();
    await db.query(`INSERT INTO core_schema.web_push_keys (id, public_key, private_key) VALUES (1, $1, $2) ON CONFLICT (id) DO NOTHING`, [
      generated.publicKey,
      generated.privateKey,
    ]);
    row = await read();
  }
  if (!row) throw new Error('Không đọc được khoá VAPID.');
  return { publicKey: row.public_key, privateKey: row.private_key, subject: subjectOf(env) };
}
