// Phiên HTTP cho script seed: đăng nhập qua API auth thật, giữ cookie, gửi CSRF cho thao tác ghi như web app.
// Web app (packages/shared/ui authFetch) gửi cookie ep_access và header x-csrf-token = cookie ep_csrf.

export class HttpError extends Error {
  constructor(method, url, status, body) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body);
    super(`${method} ${url} -> ${status}: ${detail?.slice(0, 500)}`);
    this.status = status;
    this.body = body;
  }
}

async function parseBody(response) {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Gọi API không có phiên (dùng cho route /v1/internal/ với x-service-token). */
export async function request(method, url, { body, headers = {}, expect } = {}) {
  const response = await fetch(url, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await parseBody(response);
  if (!response.ok && !(expect ?? []).includes(response.status)) throw new HttpError(method, url, response.status, data);
  return { status: response.status, data };
}

export class Session {
  /** @param {string} platformApi ví dụ http://localhost:3333/api */
  constructor(platformApi, label) {
    this.platformApi = platformApi.replace(/\/$/, '');
    this.label = label;
    this.cookies = new Map();
    this.principal = undefined;
  }

  static async login(platformApi, { email, password, portal }) {
    const session = new Session(platformApi, email);
    const { data } = await session.call('POST', `${session.platformApi}/auth/v1/login`, {
      body: { email, password, portal },
    });
    session.principal = data?.principal;
    if (!session.cookies.get('ep_access')) throw new Error(`Đăng nhập ${email} không trả cookie ep_access.`);
    return session;
  }

  storeCookies(response) {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const index = pair.indexOf('=');
      if (index <= 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value) this.cookies.set(name, decodeURIComponent(value));
      else this.cookies.delete(name);
    }
  }

  cookieHeader() {
    return [...this.cookies].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('; ');
  }

  /**
   * @param {string} method
   * @param {string} url URL đầy đủ
   * @param {{ body?: unknown, expect?: number[], headers?: Record<string,string> }} [options]
   *   `expect`: mã lỗi được chấp nhận (trả về thay vì ném).
   */
  async call(method, url, { body, expect = [], headers = {} } = {}) {
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const csrf = this.cookies.get('ep_csrf');
    const response = await fetch(url, {
      method,
      redirect: 'manual',
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.cookies.size ? { cookie: this.cookieHeader() } : {}),
        ...(mutation && csrf ? { 'x-csrf-token': csrf } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    this.storeCookies(response);
    const data = await parseBody(response);
    if (!response.ok && !expect.includes(response.status)) throw new HttpError(method, url, response.status, data);
    return { status: response.status, data };
  }

  get(url, options) {
    return this.call('GET', url, options).then((r) => r.data);
  }
  post(url, body, options) {
    return this.call('POST', url, { ...options, body }).then((r) => r.data);
  }
  put(url, body, options) {
    return this.call('PUT', url, { ...options, body }).then((r) => r.data);
  }
  patch(url, body, options) {
    return this.call('PATCH', url, { ...options, body }).then((r) => r.data);
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
