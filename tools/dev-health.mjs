const gatewayUrl = (process.env.DEV_GATEWAY_URL ?? 'http://localhost:8080')
  .trim()
  .replace(/\/$/, '');
const timeoutMs = Number(process.env.DEV_STATUS_TIMEOUT_MS ?? 5_000);

const checks = [
  {
    service: 'Platform Web',
    path: '/',
  },
  {
    service: 'Platform API',
    path: '/api',
  },
  {
    service: 'Procedure Web',
    path: '/modules/procedure',
    validate: (body) =>
      typeof body === 'string' &&
      !body.includes('Procedure Engine đang bảo trì'),
    failureDetail: (body) =>
      typeof body === 'string' && body.includes('Procedure Engine đang bảo trì')
        ? 'Maintenance fallback is active'
        : 'Unexpected Procedure Web response',
  },
  {
    service: 'Procedure API · live',
    path: '/api/procedure/health/live',
    validate: (body) => body?.status === 'ok' && body?.service === 'procedure-api',
  },
  {
    service: 'Procedure API · ready',
    path: '/api/procedure/health/ready',
    validate: (body) => body?.status === 'ready' && body?.service === 'procedure-api',
  },
  {
    service: 'Maintenance Web',
    path: '/modules/maintenance',
    validate: (body) => typeof body === 'string' && !body.includes('Maintenance đang bảo trì'),
    failureDetail: (body) => typeof body === 'string' && body.includes('Maintenance đang bảo trì')
      ? 'Maintenance fallback is active' : 'Unexpected Maintenance Web response',
  },
  {
    service: 'Maintenance API · live',
    path: '/api/maintenance/health/live',
    validate: (body) => body?.status === 'live' && body?.service === 'maintenance-api',
  },
  {
    service: 'Maintenance API · ready',
    path: '/api/maintenance/health/ready',
    validate: (body) => body?.status === 'ready' && body?.service === 'maintenance-api',
  },
];

async function checkService(check) {
  const url = `${gatewayUrl}${check.path}`;
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const contentType = response.headers.get('content-type') ?? '';
    const body = contentType.includes('application/json')
      ? await response.json().catch(() => undefined)
      : await response.text().catch(() => undefined);
    const validBody = check.validate ? check.validate(body) : true;
    const healthy = response.ok && validBody;
    return {
      service: check.service,
      status: healthy ? 'UP' : 'DOWN',
      http: response.status,
      latency: `${Math.round(performance.now() - startedAt)} ms`,
      url,
      detail: healthy
        ? ''
        : check.failureDetail
          ? check.failureDetail(body)
        : typeof body?.message === 'string'
          ? body.message
          : validBody
            ? `HTTP ${response.status}`
            : 'Unexpected health response',
    };
  } catch (error) {
    return {
      service: check.service,
      status: 'DOWN',
      http: '—',
      latency: `${Math.round(performance.now() - startedAt)} ms`,
      url,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

const results = await Promise.all(checks.map(checkService));
console.table(results);

const unavailable = results.filter((result) => result.status !== 'UP');
if (unavailable.length > 0) {
  console.error(
    `Development stack is not ready: ${unavailable.map((result) => result.service).join(', ')}.`,
  );
  process.exitCode = 1;
} else {
  console.log('Development stack is ready.');
}
