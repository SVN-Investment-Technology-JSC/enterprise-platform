import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { HrmCustodyAsset } from '@enterprise-platform/contracts-hrm';

export const INVENTORY_UNAVAILABLE_CODE = 'INVENTORY_UNAVAILABLE';

function inventoryUnavailable() {
  return new ServiceUnavailableException({
    code: INVENTORY_UNAVAILABLE_CODE,
    message: 'Không kết nối được phân hệ Kho. Vui lòng thử lại sau.',
  });
}

function baseUrl() {
  return (
    process.env.INVENTORY_API_URL || 'http://localhost:3336/api/inventory'
  ).replace(/\/$/, '');
}

/**
 * Gọi API nội bộ của Kho bằng service token; HRM không đọc hay ghi `inventory_schema`. Lỗi mạng, token, 5xx, 401, 403
 * và 429 thành 503 `INVENTORY_UNAVAILABLE`; Kho từ chối (4xx khác) thì giữ thông điệp tiếng Việt của Kho.
 */
async function inventoryCall(
  tenantId: string,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown } = { method: 'GET' },
): Promise<unknown> {
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!token) throw inventoryUnavailable();
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method: init.method,
      headers: {
        'x-tenant-id': tenantId,
        'x-service-token': token,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw inventoryUnavailable();
  }
  if (!response.ok) {
    if ([401, 403, 408, 429].includes(response.status) || response.status >= 500)
      throw inventoryUnavailable();
    const body = (await response.json().catch(() => ({}))) as {
      code?: unknown;
      message?: unknown;
    };
    const message = (
      Array.isArray(body.message)
        ? body.message.join('; ')
        : typeof body.message === 'string'
          ? body.message
          : `Kho từ chối yêu cầu (mã ${response.status}).`
    ).slice(0, 2000);
    const payload = {
      code: typeof body.code === 'string' ? body.code : 'INVENTORY_REJECTED',
      message,
    };
    if (response.status === 404) throw new NotFoundException(payload);
    if (response.status === 409) throw new ConflictException(payload);
    throw new UnprocessableEntityException(payload);
  }
  try {
    return await response.json();
  } catch {
    throw inventoryUnavailable();
  }
}

function assets(body: unknown): HrmCustodyAsset[] {
  const list = Array.isArray(body)
    ? body
    : (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(list)) throw inventoryUnavailable();
  return list as HrmCustodyAsset[];
}

export async function listCustodyOfEmployee(
  tenantId: string,
  employeeId: string,
): Promise<HrmCustodyAsset[]> {
  return assets(
    await inventoryCall(
      tenantId,
      `/v1/internal/custody/employees/${encodeURIComponent(employeeId)}`,
    ),
  );
}

export async function listAssignableCustody(
  tenantId: string,
): Promise<HrmCustodyAsset[]> {
  return assets(await inventoryCall(tenantId, '/v1/internal/custody/assignable'));
}

/** `employeeId = null` là thu hồi. */
export async function setCustody(
  tenantId: string,
  materialCode: string,
  employeeId: string | null,
): Promise<void> {
  await inventoryCall(tenantId, '/v1/internal/custody/assign', {
    method: 'POST',
    body: { materialCode, employeeId },
  });
}
