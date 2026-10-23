import { CHAT_SERVICE_WORKER_PATH, PUSH_API_ROOT, type PushConfig } from '@enterprise-platform/contracts-chat';
import { authFetch } from '@enterprise-platform/shared-ui';

/**
 * Đăng ký nhận thông báo đẩy (Web Push) cho trình duyệt này: báo tin chat cả khi người dùng đã đóng hết tab ERP.
 * - `active`: đã đăng ký; `unsupported`: trình duyệt/không phải HTTPS; `disabled`: máy chủ chưa cấu hình;
 *   `no-permission`: chưa được phép hiện thông báo; `error`: lỗi khi đăng ký (thử lại ở lần mở trang sau).
 */
export type PushState = 'active' | 'unsupported' | 'disabled' | 'no-permission' | 'error' | 'off';

/** Trình duyệt này đang nhận push cho ai: đổi người dùng thì phải đăng ký lại để không nhận tin của người trước. */
const OWNER_KEY = 'ep-push-owner';

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext === true &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof window.Notification !== 'undefined'
  );
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function sameKey(subscription: PushSubscription, publicKey: string): boolean {
  const current = subscription.options?.applicationServerKey;
  if (!current) return true;
  const expected = base64UrlToBytes(publicKey);
  const actual = new Uint8Array(current);
  return actual.length === expected.length && actual.every((byte, index) => byte === expected[index]);
}

function readOwner(): string | null {
  try {
    return window.localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

function writeOwner(owner: string | null): void {
  try {
    if (owner) window.localStorage.setItem(OWNER_KEY, owner);
    else window.localStorage.removeItem(OWNER_KEY);
  } catch {
    // Bộ nhớ cục bộ bị chặn: lần sau đăng ký lại, không hại gì.
  }
}

async function loadConfig(): Promise<PushConfig> {
  const response = await authFetch(`${PUSH_API_ROOT}/config`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as PushConfig;
}

/** Đảm bảo trình duyệt đang nhận push cho `owner` (id người dùng). Gọi lại nhiều lần không sao (cập nhật đăng ký). */
export async function syncPushSubscription(owner: string): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (window.Notification.permission !== 'granted') return 'no-permission';
  try {
    const config = await loadConfig();
    if (!config.enabled || !config.publicKey) return 'disabled';
    await navigator.serviceWorker.register(CHAT_SERVICE_WORKER_PATH, { scope: '/' });
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && (readOwner() !== owner || !sameKey(subscription, config.publicKey))) {
      await subscription.unsubscribe().catch(() => undefined);
      subscription = null;
    }
    subscription ??= await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(config.publicKey),
    });
    const json = subscription.toJSON();
    const response = await authFetch(`${PUSH_API_ROOT}/subscription`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
    });
    if (!response.ok) return 'error';
    writeOwner(owner);
    return 'active';
  } catch {
    return 'error';
  }
}

/** Ngừng nhận push trên trình duyệt này (tắt thông báo Windows trong cài đặt chat). */
export async function disablePushSubscription(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    await authFetch(`${PUSH_API_ROOT}/subscription`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    }).catch(() => undefined);
    await subscription.unsubscribe();
  } catch {
    // Cố gắng tốt nhất.
  } finally {
    writeOwner(null);
  }
}
