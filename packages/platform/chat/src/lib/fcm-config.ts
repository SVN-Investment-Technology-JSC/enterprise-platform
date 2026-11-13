import { readFileSync } from 'node:fs';

export interface FcmServiceAccountConfig {
  readonly projectId: string;
  readonly clientEmail: string;
  readonly privateKey: string;
}

function readField(record: Record<string, unknown>, snakeKey: string, camelKey: string): string {
  const value = record[snakeKey] ?? record[camelKey];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Đọc cấu hình Firebase Service Account từ biến môi trường `FIREBASE_SERVICE_ACCOUNT` (chuỗi JSON một dòng)
 * hoặc đường dẫn tệp `FIREBASE_SERVICE_ACCOUNT_PATH`. Chưa đặt thì trả `null` để môi trường local/test tự tắt êm.
 */
export function fcmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): FcmServiceAccountConfig | null {
  const inline = env.FIREBASE_SERVICE_ACCOUNT?.trim();
  const filePath = env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  const raw = inline || (filePath ? readFileSync(filePath, 'utf8').trim() : '');
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT không phải chuỗi JSON hợp lệ.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT phải là đối tượng JSON của Service Account.');
  }
  const record = parsed as Record<string, unknown>;
  const projectId = readField(record, 'project_id', 'projectId');
  const clientEmail = readField(record, 'client_email', 'clientEmail');
  const privateKey = readField(record, 'private_key', 'privateKey').replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT thiếu project_id, client_email hoặc private_key.');
  }
  return { projectId, clientEmail, privateKey };
}

let bootLogged = false;

/** In log xác nhận trạng thái FCM một lần khi khởi động tiến trình. */
export function logFcmBootStatus(
  env: NodeJS.ProcessEnv = process.env,
  logger: Pick<Console, 'info' | 'warn'> = console,
): FcmServiceAccountConfig | null {
  try {
    const config = fcmConfigFromEnv(env);
    if (config && !bootLogged) {
      bootLogged = true;
      logger.info('[push] FCM push bật ✓');
    }
    return config;
  } catch (error) {
    logger.warn('[push] Không nạp được cấu hình FCM:', error instanceof Error ? error.message : String(error));
    return null;
  }
}
