'use client';

import { authFetch, readApiRequestError } from '@enterprise-platform/shared-ui';

export async function authorizationRequest<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const csrf = decodeURIComponent(
    document.cookie
      .split('; ')
      .find((x) => x.startsWith('ep_csrf='))
      ?.split('=')
      .slice(1)
      .join('=') ?? '',
  );
  const response = await authFetch(`/api/platform/v1/${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // Giữ câu tiếng Việt server trả; 403 không kèm câu thì dùng câu "chưa được cấp quyền" thay cho mã HTTP.
  if (!response.ok) throw await readApiRequestError(response, 'Không thể thực hiện thao tác.');
  return (await response.json()) as T;
}
export const searchText = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
