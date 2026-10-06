export function notificationDeepLink(value: string | undefined): string | undefined {
  if (!value?.startsWith('/') || value.startsWith('//') || /\\|%5c/i.test(value)) return undefined;
  const base = 'https://notification.invalid';
  let url: URL;
  try { url = new URL(value, base); } catch { return undefined; }
  if (url.origin !== base) return undefined;
  const path = url.pathname;
  const routes: readonly [RegExp, (id: string) => string][] = [
    [/^\/procedures\/instances\/([^/]+)$/, (id) => `/modules/procedure#workspace/${id}`],
    [/^\/workspace\/work-items\/([^/]+)$/, (id) => `/modules/workspace#my-work/work-item/${id}`],
    [/^\/workspace\/calendar\/([^/]+)$/, (id) => `/modules/workspace#my-work/calendar/${id}`],
    [/^\/workspace\/projects\/([^/]+)$/, (id) => `/modules/workspace?project=${id}#projects`],
    [/^\/workspace\/documents\/([^/]+)$/, (id) => `/modules/workspace#documents/${id}`],
    [/^\/workspace\/chat\/([^/]+)$/, (id) => `/modules/workspace#my-work/mention/${encodeURIComponent(url.searchParams.get('message') ?? id)}`],
    [/^\/hrm\/requests\/([^/]+)$/, (id) => `/modules/hrm/requests?request=${id}`],
    [/^\/hrm\/payslips\/([^/]+)$/, (id) => `/modules/hrm/payslips?selected=${id}`],
    [/^\/maintenance\/occurrences\/([^/]+)$/, (id) => `/modules/maintenance#history/${id}`],
    [/^\/inventory\/materials\/([^/]+)$/, (id) => `/modules/inventory#stock/${id}`],
  ];
  for (const [pattern, route] of routes) {
    const match = path.match(pattern);
    if (match) {
      try { return route(encodeURIComponent(decodeURIComponent(match[1]))); }
      catch { return undefined; }
    }
  }
  if (path === '/account/security') return '/tenant/login';
  if (path === '/settings/modules') return '/applications';
  if (['/workspace', '/inventory', '/maintenance'].includes(path)) return `/modules${path}${url.search}${url.hash}`;
  if (/^\/modules\/(procedure|workspace|hrm|inventory|maintenance)(\/|$)/.test(path) ||
      ['/applications', '/tenant/login'].includes(path)) return `${path}${url.search}${url.hash}`;
  return undefined;
}
