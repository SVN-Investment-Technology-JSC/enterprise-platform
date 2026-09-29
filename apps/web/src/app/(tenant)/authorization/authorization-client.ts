'use client';

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
  const response = await fetch(`/api/platform/v1/${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      Array.isArray(error.message)
        ? error.message.join(' ')
        : (error.message ??
          `Không thể thực hiện thao tác (${response.status}).`),
    );
  }
  return (await response.json()) as T;
}
export const searchText = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
