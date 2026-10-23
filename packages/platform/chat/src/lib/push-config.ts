import type { PushConfig } from '@enterprise-platform/contracts-chat';

export interface VapidConfig {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly subject: string;
}

/** Cấu hình VAPID từ biến môi trường; thiếu khoá thì null (tính năng thông báo đẩy tắt). */
export function vapidFromEnv(env: NodeJS.ProcessEnv = process.env): VapidConfig | null {
  const publicKey = env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: env.WEB_PUSH_SUBJECT?.trim() || 'mailto:admin@localhost' };
}

/** Khoá công khai VAPID trả cho trình duyệt; bỏ trống khoá thì tính năng thông báo đẩy tắt. */
export function pushConfig(env: NodeJS.ProcessEnv = process.env): PushConfig {
  const vapid = vapidFromEnv(env);
  return vapid ? { enabled: true, publicKey: vapid.publicKey } : { enabled: false, publicKey: null };
}
