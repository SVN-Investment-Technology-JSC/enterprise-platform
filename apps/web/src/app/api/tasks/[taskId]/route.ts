import { NextRequest, NextResponse } from 'next/server';

function getServiceBaseUrl(module: string): string {
  switch (module) {
    case 'hrm':
      return (process.env.HRM_API_BASE_URL ?? 'http://localhost:3339').trim().replace(/\/$/, '');
    case 'procedure':
      return (process.env.PROCEDURE_API_BASE_URL ?? 'http://localhost:3334').trim().replace(/\/$/, '');
    case 'inventory':
      return (process.env.INVENTORY_API_BASE_URL ?? 'http://localhost:3336').trim().replace(/\/$/, '');
    default:
      return (process.env.API_BASE_URL ?? 'http://localhost:3333').trim().replace(/\/$/, '');
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ taskId: string }> | { taskId: string } },
) {
  const params = await Promise.resolve(context.params);
  const rawTaskId = params?.taskId;
  if (!rawTaskId) {
    return NextResponse.json({ message: 'Thiếu mã tác vụ (taskId).' }, { status: 400 });
  }

  const decoded = decodeURIComponent(rawTaskId);
  const parts = decoded.split(':');
  const mod = parts.length >= 2 ? parts[0] : 'unknown';
  const baseUrl = getServiceBaseUrl(mod);

  let targetUrl: string;
  if (parts.length >= 3) {
    const [, kind, ...rest] = parts;
    const id = rest.join(':');
    targetUrl = `${baseUrl}/api/${encodeURIComponent(mod)}/v1/tasks/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`;
  } else if (parts.length === 2) {
    const [, id] = parts;
    targetUrl = `${baseUrl}/api/${encodeURIComponent(mod)}/v1/tasks/${encodeURIComponent(id)}`;
  } else {
    targetUrl = `${baseUrl}/api/tasks/${encodeURIComponent(decoded)}`;
  }

  const forwardHeaders: Record<string, string> = {
    'Content-Type': request.headers.get('content-type') || 'application/json',
  };
  const cookie = request.headers.get('cookie');
  if (cookie) forwardHeaders.cookie = cookie;

  const auth = request.headers.get('authorization');
  if (auth) forwardHeaders.authorization = auth;

  const tenant = request.headers.get('x-tenant-id');
  if (tenant) forwardHeaders['x-tenant-id'] = tenant;

  try {
    const backendRes = await fetch(targetUrl, {
      method: 'GET',
      headers: forwardHeaders,
      cache: 'no-store',
    });

    const bodyText = await backendRes.text();
    return new NextResponse(bodyText, {
      status: backendRes.status,
      headers: {
        'Content-Type': backendRes.headers.get('content-type') || 'application/json',
      },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { message: (err as Error)?.message || 'Không thể kết nối đến máy chủ phân hệ.' },
      { status: 502 },
    );
  }
}
