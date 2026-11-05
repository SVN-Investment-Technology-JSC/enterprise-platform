/** Lỗi mạng hoặc server DB đang khởi động lại/ngắt kết nối; thử lại có thể thành công. */
const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '08000',
  '08003',
  '08006',
]);

export function isTransientConnectionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code === 'string' && TRANSIENT_CODES.has(code)) return true;
  return typeof message === 'string' && /connection terminated|connection.*reset/i.test(message);
}

/**
 * Chạy `operation`, thử lại đúng một lần nếu lỗi là đứt kết nối.
 *
 * Chỉ dùng cho thao tác đọc hoặc idempotent: thử lại một lệnh ghi đã chạy được một nửa có thể ghi hai lần.
 * Pool của pg bỏ kết nối đã chết, nên lần thử lại lấy một kết nối mới.
 */
export async function retryOnConnectionError<T>(
  operation: () => Promise<T>,
  delayMs = 50,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isTransientConnectionError(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return operation();
  }
}
