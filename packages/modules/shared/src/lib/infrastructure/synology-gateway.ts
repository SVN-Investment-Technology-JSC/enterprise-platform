import type { SharedNasRule } from '@enterprise-platform/contracts-shared';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createHash, randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import type {
  NasCredentials,
  NasDirectorySnapshot,
  NasFileStream,
  NasGateway,
  NasListedEntry,
} from '../application/nas-gateway.port.js';
import {
  SharedNasConflictError,
  SharedNasNotFoundError,
  SharedNasUnavailableError,
  SharedValidationError,
} from '../domain/shared.error.js';

/** Mã lỗi phiên của DSM: hết hạn, bị đăng nhập nơi khác đẩy ra, không thấy phiên. Gặp thì đăng nhập lại một lần. */
const SESSION_ERRORS = new Set([106, 107, 119]);
const SESSION_NAME = 'FileStation';
const CALL_TIMEOUT_MS = 30_000;
const DELETE_WAIT_MS = 60_000;

const AUTH_MESSAGES: Readonly<Record<number, string>> = {
  400: 'Sai tài khoản hoặc mật khẩu NAS.',
  401: 'Tài khoản NAS đang bị khoá.',
  402: 'Tài khoản NAS không được phép đăng nhập ứng dụng này.',
  403: 'Tài khoản NAS bật xác minh hai bước; dùng tài khoản dịch vụ riêng không bật xác minh hai bước.',
  404: 'Tài khoản NAS bật xác minh hai bước; dùng tài khoản dịch vụ riêng không bật xác minh hai bước.',
  406: 'NAS bắt buộc xác minh hai bước cho tài khoản này.',
  407: 'NAS đang chặn địa chỉ của máy chủ ERP (đăng nhập sai nhiều lần). Gỡ chặn trong Bảng điều khiển → Bảo mật.',
  408: 'Mật khẩu tài khoản NAS đã hết hạn.',
  409: 'Mật khẩu tài khoản NAS đã hết hạn.',
  410: 'Tài khoản NAS phải đổi mật khẩu trước khi dùng.',
};

/** Lỗi DSM → lỗi có câu tiếng Việt. */
function failure(code: number, action: string): Error {
  if (code === 408) return new SharedNasNotFoundError();
  if (code === 414 || code === 1805 || code === 1003 || code === 1004) return new SharedNasConflictError();
  if (code === 412 || code === 418 || code === 419 || code === 420) return new SharedValidationError('Tên tệp hoặc đường dẫn không hợp lệ trên NAS.');
  if (code === 415 || code === 416) return new SharedNasUnavailableError('NAS đã hết dung lượng hoặc vượt hạn mức của thư mục.', 507);
  if (code === 105 || code === 403 || code === 407) {
    return new SharedNasUnavailableError(`Tài khoản kết nối NAS không có quyền ${action}.`, 502);
  }
  if (code === 411) return new SharedNasUnavailableError('Thư mục trên NAS đang ở chế độ chỉ đọc.', 502);
  return new SharedNasUnavailableError(`NAS trả lỗi khi ${action} (mã ${code}).`, 502);
}

function networkFailure(error: unknown): Error {
  if (error instanceof SharedNasUnavailableError || error instanceof SharedNasNotFoundError || error instanceof SharedNasConflictError) return error;
  if (error instanceof SharedValidationError) return error;
  const cause = (error as { cause?: { code?: string }; code?: string; name?: string } | null) ?? {};
  const code = cause.cause?.code ?? cause.code ?? '';
  if (cause.name === 'TimeoutError' || cause.name === 'AbortError') {
    return new SharedNasUnavailableError('NAS không phản hồi. Kiểm tra NAS và đường nối (Tailscale, VPN) từ máy chủ ERP.', 504);
  }
  if (code === 'ECONNREFUSED') return new SharedNasUnavailableError('NAS từ chối kết nối: sai cổng, hoặc DSM chưa mở cổng này.', 502);
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new SharedNasUnavailableError('Không phân giải được địa chỉ NAS.', 502);
  if (code.startsWith('CERT_') || code.includes('SELF_SIGNED') || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
    return new SharedNasUnavailableError('Chứng chỉ HTTPS của NAS không hợp lệ; dùng địa chỉ có chứng chỉ hợp lệ hoặc http qua Tailscale.', 502);
  }
  return new SharedNasUnavailableError('Không kết nối được NAS. Kiểm tra NAS và đường nối từ máy chủ ERP.', 502);
}

interface DsmResponse<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: { readonly code: number };
}

type Fetcher = typeof fetch;

/**
 * Synology DSM qua Web API (File Station, Core.User/Group/Share.Permission).
 *
 * Một phiên DSM cho mỗi cặp NAS–tài khoản, dùng lại giữa các lời gọi; DSM báo phiên
 * hết hạn thì đăng nhập lại một lần. `sid` đi trong thân POST, không nằm trên URL
 * (trừ lượt tải xuống, DSM chỉ nhận GET). Đọc người dùng, nhóm, quyền cần tài khoản
 * thuộc nhóm administrators của NAS.
 */
export class SynologyGateway implements NasGateway {
  private readonly sessions = new Map<string, Promise<string>>();

  constructor(private readonly fetcher: Fetcher = (input, init) => fetch(input, init)) {}

  async shares(credentials: NasCredentials) {
    const data = await this.call<{ shares: { name: string; path: string }[] }>(
      credentials,
      // File Station trả HTTP 502 khi `limit=-1`; bỏ trống là lấy hết.
      { api: 'SYNO.FileStation.List', version: '2', method: 'list_share', sort_by: 'name' },
      'đọc danh sách thư mục chia sẻ',
    );
    return data.shares.map((share) => ({ name: share.name }));
  }

  async directory(credentials: NasCredentials, shares: readonly string[]): Promise<NasDirectorySnapshot> {
    const users = await this.call<{ users: { name: string; description?: string; email?: string; expired?: string }[] }>(
      credentials,
      {
        api: 'SYNO.Core.User',
        version: '1',
        method: 'list',
        type: 'local',
        offset: '0',
        limit: '-1',
        additional: JSON.stringify(['email', 'description', 'expired']),
      },
      'đọc danh sách người dùng (cần tài khoản thuộc nhóm administrators)',
    );
    const groups = await this.call<{ groups: { name: string; description?: string }[] }>(
      credentials,
      { api: 'SYNO.Core.Group', version: '1', method: 'list', type: 'local', offset: '0', limit: '-1' },
      'đọc danh sách nhóm',
    );
    const membership = new Map<string, string[]>();
    const groupRecords: { name: string; description: string; members: number }[] = [];
    for (const group of groups.groups) {
      const members = await this.call<{ users: { name: string }[] }>(
        credentials,
        { api: 'SYNO.Core.Group.Member', version: '1', method: 'list', group: group.name, ingroup: 'true', offset: '0', limit: '-1' },
        `đọc thành viên nhóm ${group.name}`,
      );
      groupRecords.push({ name: group.name, description: group.description ?? '', members: members.users.length });
      for (const member of members.users) {
        const list = membership.get(member.name.toLowerCase()) ?? [];
        list.push(group.name);
        membership.set(member.name.toLowerCase(), list);
      }
    }
    const permissions: NasDirectorySnapshot['permissions'][number][] = [];
    for (const share of shares) {
      for (const [type, principalType] of [
        ['local_user', 'user'],
        ['local_group', 'group'],
      ] as const) {
        const result = await this.call<{
          items: { name: string; is_deny?: boolean; is_writable?: boolean; is_readonly?: boolean; is_custom?: boolean }[];
        }>(
          credentials,
          {
            api: 'SYNO.Core.Share.Permission',
            version: '1',
            method: 'list',
            name: share,
            user_group_type: type,
            offset: '0',
            limit: '-1',
            action: 'find',
          },
          `đọc quyền của thư mục ${share}`,
        );
        for (const item of result.items) {
          // Quyền tuỳ chỉnh (ACL nâng cao) chưa đọc được chi tiết: coi như Chỉ đọc, không cho ghi.
          const rule: SharedNasRule | undefined = item.is_deny
            ? 'deny'
            : item.is_writable
              ? 'write'
              : item.is_readonly || item.is_custom
                ? 'read'
                : undefined;
          if (rule) permissions.push({ share, principalType, principalName: item.name, rule });
        }
      }
    }
    return {
      accounts: users.users.map((user) => ({
        name: user.name,
        description: user.description ?? '',
        email: user.email || undefined,
        disabled: user.expired === 'now',
        groups: membership.get(user.name.toLowerCase()) ?? [],
      })),
      groups: groupRecords,
      permissions,
    };
  }

  async list(credentials: NasCredentials, fullPath: string, page: { offset: number; limit: number }) {
    const data = await this.call<{
      total: number;
      files: { name: string; path: string; isdir: boolean; additional?: { size?: number; time?: { mtime?: number } } }[];
    }>(
      credentials,
      {
        api: 'SYNO.FileStation.List',
        version: '2',
        method: 'list',
        folder_path: fullPath,
        offset: String(page.offset),
        limit: String(page.limit),
        sort_by: 'name',
        sort_direction: 'asc',
        additional: JSON.stringify(['size', 'time']),
      },
      'đọc thư mục',
    );
    const entries: NasListedEntry[] = data.files.map((file) => ({
      name: file.name,
      path: file.path,
      isDir: file.isdir,
      sizeBytes: file.isdir ? undefined : file.additional?.size,
      modifiedAt: file.additional?.time?.mtime ? new Date(file.additional.time.mtime * 1000).toISOString() : undefined,
    }));
    return { entries, total: data.total };
  }

  async createFolder(credentials: NasCredentials, parentFullPath: string, name: string) {
    try {
      await this.call(
        credentials,
        {
          api: 'SYNO.FileStation.CreateFolder',
          version: '2',
          method: 'create',
          folder_path: JSON.stringify(parentFullPath),
          name: JSON.stringify(name),
          force_parent: 'false',
        },
        'tạo thư mục',
      );
    } catch (error) {
      // DSM báo chung "không tạo được" (1100) cả khi đã có thư mục cùng tên: hỏi lại để báo cho đúng.
      if (await this.exists(credentials, `${parentFullPath}/${name}`)) throw new SharedNasConflictError(`Đã có "${name}" trong thư mục này.`);
      throw error;
    }
  }

  private async exists(credentials: NasCredentials, fullPath: string): Promise<boolean> {
    try {
      const info = await this.call<{ files: { code?: number }[] }>(
        credentials,
        { api: 'SYNO.FileStation.List', version: '2', method: 'getinfo', path: JSON.stringify([fullPath]) },
        'kiểm tra',
      );
      return info.files.length > 0 && !info.files[0]?.code;
    } catch {
      return false;
    }
  }

  async rename(credentials: NasCredentials, fullPath: string, name: string) {
    await this.call(
      credentials,
      { api: 'SYNO.FileStation.Rename', version: '2', method: 'rename', path: JSON.stringify(fullPath), name: JSON.stringify(name) },
      'đổi tên',
    );
  }

  /** Xoá chạy nền trên NAS; chờ tối đa 60 giây (thư mục lớn thì NAS xoá tiếp sau đó). Thùng rác của thư mục chia sẻ vẫn giữ bản xoá nếu NAS bật. */
  async remove(credentials: NasCredentials, fullPath: string) {
    await this.runTask(
      credentials,
      'SYNO.FileStation.Delete',
      { path: JSON.stringify([fullPath]), recursive: 'true' },
      'xoá',
    );
  }

  /**
   * Chuyển tệp, thư mục vào thư mục khác trên NAS (chạy nền trên NAS, chờ tối đa 60 giây).
   * Không ghi đè: đích đã có mục cùng tên thì báo trùng.
   */
  async move(credentials: NasCredentials, fullPaths: readonly string[], destinationFullPath: string) {
    // DSM chỉ báo chung "không chuyển được" (1001) khi đích trùng tên: kiểm trước để báo đúng.
    for (const path of fullPaths) {
      const name = path.split('/').pop() ?? '';
      if (await this.exists(credentials, `${destinationFullPath}/${name}`)) {
        throw new SharedNasConflictError(`Thư mục đích đã có "${name}".`);
      }
    }
    await this.runTask(
      credentials,
      'SYNO.FileStation.CopyMove',
      { path: JSON.stringify(fullPaths), dest_folder_path: JSON.stringify(destinationFullPath), remove_src: 'true' },
      'chuyển',
    );
  }

  /** Thao tác chạy nền của File Station: `start` lấy taskid, rồi hỏi `status` tới khi xong. */
  private async runTask(credentials: NasCredentials, api: string, params: Record<string, string>, action: string) {
    const started = await this.call<{ taskid: string }>(credentials, { api, version: '2', method: 'start', ...params }, action);
    const deadline = Date.now() + DELETE_WAIT_MS;
    while (Date.now() < deadline) {
      const status = await this.call<{ finished: boolean; errors?: { code: number }[]; error?: { code: number } }>(
        credentials,
        { api, version: '2', method: 'status', taskid: JSON.stringify(started.taskid) },
        action,
      );
      if (status.finished) {
        const code = status.errors?.[0]?.code ?? status.error?.code;
        if (code) throw failure(code, action);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  async download(credentials: NasCredentials, fullPath: string, options: { range?: string; signal?: AbortSignal } = {}): Promise<NasFileStream> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const sid = await this.session(credentials, attempt > 0);
      const query = new URLSearchParams({
        api: 'SYNO.FileStation.Download',
        version: '2',
        method: 'download',
        path: JSON.stringify(fullPath),
        mode: 'download',
        _sid: sid,
      });
      let response: Response;
      try {
        response = await this.fetcher(`${this.endpoint(credentials)}?${query.toString()}`, {
          headers: options.range ? { range: options.range } : {},
          signal: options.signal,
        });
      } catch (error) {
        throw networkFailure(error);
      }
      if (response.status === 404) throw new SharedNasNotFoundError();
      const contentType = response.headers.get('content-type') ?? undefined;
      // Lỗi của DSM trả JSON thay cho nội dung tệp.
      if (contentType?.startsWith('application/json')) {
        const body = (await response.json().catch(() => ({}))) as DsmResponse<unknown>;
        const code = body.error?.code ?? 0;
        if (SESSION_ERRORS.has(code) && attempt === 0) continue;
        throw failure(code, 'tải tệp');
      }
      if (response.status === 416) throw new SharedValidationError('Đoạn tệp yêu cầu nằm ngoài độ dài tệp.');
      if (!response.ok || !response.body) throw new SharedNasUnavailableError(`NAS trả lỗi khi tải tệp (HTTP ${response.status}).`);
      const length = response.headers.get('content-length');
      return {
        body: Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
        partial: response.status === 206,
        contentType,
        contentLength: length ? Number(length) : undefined,
        contentRange: response.headers.get('content-range') ?? undefined,
        lastModified: response.headers.get('last-modified') ?? undefined,
      };
    }
    throw new SharedNasUnavailableError('Không giữ được phiên đăng nhập NAS.');
  }

  /**
   * Tải lên bằng multipart có `Content-Length` đúng (DSM không nhận thân chunked): đầu
   * form, rồi luồng tệp đi thẳng từ trình duyệt, rồi đuôi form. Không gom tệp vào bộ nhớ.
   */
  async upload(
    credentials: NasCredentials,
    folderFullPath: string,
    fileName: string,
    body: Readable,
    sizeBytes: number,
    options: { overwrite?: boolean; signal?: AbortSignal } = {},
  ): Promise<void> {
    // Thân tệp chỉ đọc được một lần: bảo đảm phiên còn sống trước khi gửi.
    await this.call(credentials, { api: 'SYNO.FileStation.List', version: '2', method: 'list_share', offset: '0', limit: '1' }, 'kiểm tra phiên');
    const sid = await this.session(credentials);
    const boundary = `----erp${randomUUID().replace(/-/g, '')}`;
    const field = (name: string, value: string) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
    const head = Buffer.from(
      field('path', folderFullPath) +
        // Tải cả cây thư mục: NAS tự tạo thư mục cha còn thiếu.
        field('create_parents', 'true') +
        field('overwrite', options.overwrite ? 'true' : 'false') +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName.replace(/"/g, '%22')}"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
      'utf8',
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const url = new URL(this.endpoint(credentials));
    url.search = new URLSearchParams({ api: 'SYNO.FileStation.Upload', version: '2', method: 'upload', _sid: sid }).toString();

    let sent = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        sent += chunk.length;
        if (sent > sizeBytes) callback(new SharedValidationError('Tệp gửi lên lớn hơn dung lượng đã khai.'));
        else callback(null, chunk);
      },
    });

    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const request = send(
        url,
        {
          method: 'POST',
          headers: {
            'content-type': `multipart/form-data; boundary=${boundary}`,
            'content-length': String(head.length + sizeBytes + tail.length),
          },
          signal: options.signal,
        },
        (incoming: IncomingMessage) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
          incoming.on('error', reject);
        },
      );
      request.on('error', (error) => reject(networkFailure(error)));
      const fail = (error: unknown) => {
        request.destroy();
        reject(error);
      };
      body.on('error', fail);
      counter.on('error', fail);
      request.write(head);
      body.pipe(counter).on('data', (chunk: Buffer) => {
        if (!request.write(chunk)) {
          counter.pause();
          request.once('drain', () => counter.resume());
        }
      });
      counter.on('end', () => {
        if (sent !== sizeBytes) return fail(new SharedValidationError('Tệp gửi lên chưa đủ dung lượng đã khai (bị ngắt giữa chừng).'));
        request.end(tail);
      });
    });
    let parsed: DsmResponse<{ blSkip?: boolean }>;
    try {
      parsed = JSON.parse(response.body) as DsmResponse<{ blSkip?: boolean }>;
    } catch {
      throw new SharedNasUnavailableError(`NAS trả lỗi khi tải lên (HTTP ${response.status}).`);
    }
    if (!parsed.success) throw failure(parsed.error?.code ?? 0, 'tải lên');
    // Không cho ghi đè mà đã có tệp cùng tên: DSM báo thành công nhưng bỏ qua tệp.
    if (parsed.data?.blSkip) throw new SharedNasConflictError(`Đã có tệp "${fileName}" trong thư mục này.`);
  }

  /** Bỏ phiên của một NAS–tài khoản (tắt kết nối). */
  forget(credentials: NasCredentials): void {
    this.sessions.delete(this.key(credentials));
  }

  private endpoint(credentials: Pick<NasCredentials, 'baseUrl'>): string {
    return `${credentials.baseUrl.replace(/\/+$/, '')}/webapi/entry.cgi`;
  }

  /** Khoá phiên gồm cả dấu vân tay mật khẩu: đổi mật khẩu thì đăng nhập lại, không dùng nhầm phiên cũ. */
  private key(credentials: NasCredentials): string {
    const fingerprint = createHash('sha256').update(credentials.password).digest('base64url').slice(0, 16);
    return `${credentials.baseUrl}|${credentials.username.toLowerCase()}|${fingerprint}`;
  }

  private session(credentials: NasCredentials, renew = false): Promise<string> {
    const key = this.key(credentials);
    const cached = this.sessions.get(key);
    if (cached && !renew) return cached;
    const login = this.login(credentials);
    this.sessions.set(key, login);
    login.catch(() => {
      if (this.sessions.get(key) === login) this.sessions.delete(key);
    });
    return login;
  }

  private async login(credentials: NasCredentials): Promise<string> {
    const body = await this.post<{ sid: string }>(credentials, {
      api: 'SYNO.API.Auth',
      version: '6',
      method: 'login',
      account: credentials.username,
      passwd: credentials.password,
      session: SESSION_NAME,
      format: 'sid',
    });
    if (!body.success || !body.data?.sid) {
      const code = body.error?.code ?? 0;
      throw new SharedNasUnavailableError(AUTH_MESSAGES[code] ?? `NAS từ chối đăng nhập (mã ${code}).`, 502);
    }
    return body.data.sid;
  }

  private async call<T = unknown>(credentials: NasCredentials, params: Record<string, string>, action: string): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const sid = await this.session(credentials, attempt > 0);
      const body = await this.post<T>(credentials, { ...params, _sid: sid });
      if (body.success) return body.data as T;
      const code = body.error?.code ?? 0;
      if (SESSION_ERRORS.has(code) && attempt === 0) continue;
      throw failure(code, action);
    }
    throw new SharedNasUnavailableError('Không giữ được phiên đăng nhập NAS.');
  }

  private async post<T>(credentials: NasCredentials, params: Record<string, string>): Promise<DsmResponse<T>> {
    let response: Response;
    try {
      response = await this.fetcher(this.endpoint(credentials), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (error) {
      throw networkFailure(error);
    }
    if (!response.ok) throw new SharedNasUnavailableError(`NAS trả lỗi HTTP ${response.status}.`);
    try {
      return (await response.json()) as DsmResponse<T>;
    } catch {
      throw new SharedNasUnavailableError('Địa chỉ này không phải Synology DSM (phản hồi không đúng định dạng).');
    }
  }
}
