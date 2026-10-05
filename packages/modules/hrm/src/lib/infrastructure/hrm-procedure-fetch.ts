import { ServiceUnavailableException } from '@nestjs/common';

export const PROCEDURE_UNAVAILABLE_MESSAGE =
  'Không kết nối được Procedure Engine';

/**
 * fetch tới Procedure API; lỗi mạng (ECONNREFUSED, fetch failed, timeout)
 * trả 503 có thông báo rõ thay vì 500 thô. Mã HTTP trả về từ Procedure được
 * giữ nguyên cho người gọi tự xử lý.
 */
export async function procedureFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new ServiceUnavailableException(PROCEDURE_UNAVAILABLE_MESSAGE);
  }
}
