import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { SharedNasConflictError, SharedNasNotFoundError, SharedNasUnavailableError } from '../domain/shared.error.js';
import { SynologyGateway } from './synology-gateway.js';

const credentials = { provider: 'synology' as const, baseUrl: 'http://nas.local:5000/', username: 'erp', password: 'p1' };

type Handler = (params: URLSearchParams, init?: RequestInit) => unknown;

/** DSM giả: trả JSON theo `api.method`, đếm lượt đăng nhập. */
function fakeDsm(handlers: Record<string, Handler>) {
  const calls: URLSearchParams[] = [];
  let logins = 0;
  const fetcher = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const params = init?.body ? new URLSearchParams(String(init.body)) : url.searchParams;
    calls.push(params);
    const key = `${params.get('api')}.${params.get('method')}`;
    if (key === 'SYNO.API.Auth.login') {
      logins += 1;
      if (params.get('passwd') !== 'p1') return Response.json({ success: false, error: { code: 400 } });
      return Response.json({ success: true, data: { sid: `sid-${logins}` } });
    }
    const handler = handlers[key];
    if (!handler) return Response.json({ success: false, error: { code: 103 } });
    const result = handler(params, init);
    return result instanceof Response ? result : Response.json(result);
  }) as typeof fetch;
  return { fetcher, calls, logins: () => logins };
}

describe('SynologyGateway', () => {
  it('đăng nhập một lần, dùng lại phiên; DSM báo phiên hết hạn thì đăng nhập lại một lần', async () => {
    let expired = true;
    const dsm = fakeDsm({
      'SYNO.FileStation.List.list_share': (params) => {
        if (params.get('_sid') === 'sid-1' && expired) {
          expired = false;
          return { success: false, error: { code: 119 } };
        }
        return { success: true, data: { shares: [{ name: 'SAVINA', path: '/SAVINA' }] } };
      },
    });
    const gateway = new SynologyGateway(dsm.fetcher);
    await expect(gateway.shares(credentials)).resolves.toEqual([{ name: 'SAVINA' }]);
    await gateway.shares(credentials);
    expect(dsm.logins()).toBe(2);
    // File Station trả 502 với limit=-1: không gửi.
    expect(dsm.calls.filter((params) => params.get('method') === 'list_share').every((params) => !params.has('limit'))).toBe(true);
    // Mật khẩu không nằm trên URL.
    expect(dsm.calls.some((params) => params.get('passwd') === 'p1')).toBe(true);
  });

  it('sai mật khẩu, đổi mật khẩu: báo lỗi tiếng Việt, không dùng nhầm phiên cũ', async () => {
    const dsm = fakeDsm({ 'SYNO.FileStation.List.list_share': () => ({ success: true, data: { shares: [] } }) });
    const gateway = new SynologyGateway(dsm.fetcher);
    await gateway.shares(credentials);
    await expect(gateway.shares({ ...credentials, password: 'sai' })).rejects.toThrow('Sai tài khoản hoặc mật khẩu NAS.');
  });

  it('đọc người dùng, nhóm, quyền: Không truy cập, Đọc/Ghi, Chỉ đọc; quyền tuỳ chỉnh coi như Chỉ đọc', async () => {
    const dsm = fakeDsm({
      'SYNO.Core.User.list': () => ({
        success: true,
        data: { users: [{ name: 'thuyptd', email: 'thuyptd@congty.vn', expired: 'normal' }, { name: 'cu', expired: 'now' }] },
      }),
      'SYNO.Core.Group.list': () => ({ success: true, data: { groups: [{ name: 'Văn Thư' }, { name: 'users' }] } }),
      'SYNO.Core.Group.Member.list': (params) => ({
        success: true,
        data: { users: params.get('group') === 'Văn Thư' ? [{ name: 'thuyptd' }] : [{ name: 'thuyptd' }, { name: 'cu' }] },
      }),
      'SYNO.Core.Share.Permission.list': (params) => ({
        success: true,
        data: {
          items:
            params.get('user_group_type') === 'local_group'
              ? [
                  { name: 'Văn Thư', is_writable: true },
                  { name: 'users', is_readonly: true },
                  { name: 'Không quyền' },
                ]
              : [
                  { name: 'cu', is_deny: true },
                  { name: 'dacbiet', is_custom: true },
                ],
        },
      }),
    });
    const snapshot = await new SynologyGateway(dsm.fetcher).directory(credentials, ['SAVINA']);
    expect(snapshot.accounts).toEqual([
      { name: 'thuyptd', description: '', email: 'thuyptd@congty.vn', disabled: false, groups: ['Văn Thư', 'users'] },
      { name: 'cu', description: '', email: undefined, disabled: true, groups: ['users'] },
    ]);
    expect(snapshot.groups).toEqual([
      { name: 'Văn Thư', description: '', members: 1 },
      { name: 'users', description: '', members: 2 },
    ]);
    expect(snapshot.permissions).toEqual([
      { share: 'SAVINA', principalType: 'user', principalName: 'cu', rule: 'deny' },
      { share: 'SAVINA', principalType: 'user', principalName: 'dacbiet', rule: 'read' },
      { share: 'SAVINA', principalType: 'group', principalName: 'Văn Thư', rule: 'write' },
      { share: 'SAVINA', principalType: 'group', principalName: 'users', rule: 'read' },
    ]);
  });

  it('liệt kê thư mục; mã lỗi DSM thành lỗi rõ nghĩa', async () => {
    const dsm = fakeDsm({
      'SYNO.FileStation.List.list': (params) =>
        params.get('folder_path') === '/SAVINA'
          ? {
              success: true,
              data: {
                total: 2,
                files: [
                  { name: 'HĐ', path: '/SAVINA/HĐ', isdir: true, additional: { time: { mtime: 1_800_000_000 } } },
                  { name: 'a.pdf', path: '/SAVINA/a.pdf', isdir: false, additional: { size: 12, time: { mtime: 1_800_000_000 } } },
                ],
              },
            }
          : { success: false, error: { code: 408 } },
      'SYNO.FileStation.CreateFolder.create': () => ({ success: false, error: { code: 414 } }),
      'SYNO.FileStation.Rename.rename': () => ({ success: false, error: { code: 416 } }),
    });
    const gateway = new SynologyGateway(dsm.fetcher);
    await expect(gateway.list(credentials, '/SAVINA', { offset: 0, limit: 100 })).resolves.toEqual({
      total: 2,
      entries: [
        { name: 'HĐ', path: '/SAVINA/HĐ', isDir: true, sizeBytes: undefined, modifiedAt: '2027-01-15T08:00:00.000Z' },
        { name: 'a.pdf', path: '/SAVINA/a.pdf', isDir: false, sizeBytes: 12, modifiedAt: '2027-01-15T08:00:00.000Z' },
      ],
    });
    await expect(gateway.list(credentials, '/SAVINA/khong', { offset: 0, limit: 100 })).rejects.toBeInstanceOf(SharedNasNotFoundError);
    await expect(gateway.createFolder(credentials, '/SAVINA', 'HĐ')).rejects.toBeInstanceOf(SharedNasConflictError);
    await expect(gateway.rename(credentials, '/SAVINA/a.pdf', 'b.pdf')).rejects.toThrow(/hết dung lượng/);
  });

  it('chuyển mục: đích trùng tên thì báo trùng trước khi gọi NAS; không trùng thì chạy tác vụ tới khi xong', async () => {
    const started: URLSearchParams[] = [];
    let polls = 0;
    const dsm = fakeDsm({
      'SYNO.FileStation.List.getinfo': (params) =>
        JSON.parse(params.get('path')!)[0] === '/SAVINA/Đích/trung.pdf'
          ? { success: true, data: { files: [{ name: 'trung.pdf' }] } }
          : { success: true, data: { files: [{ code: 408 }] } },
      'SYNO.FileStation.CopyMove.start': (params) => {
        started.push(params);
        return { success: true, data: { taskid: 'T1' } };
      },
      'SYNO.FileStation.CopyMove.status': () => ({ success: true, data: { finished: ++polls >= 2 } }),
    });
    const gateway = new SynologyGateway(dsm.fetcher);
    await expect(gateway.move(credentials, ['/SAVINA/A/trung.pdf'], '/SAVINA/Đích')).rejects.toBeInstanceOf(SharedNasConflictError);
    expect(started).toHaveLength(0);
    await gateway.move(credentials, ['/SAVINA/A/moi.pdf'], '/SAVINA/Đích');
    expect(started[0]!.get('remove_src')).toBe('true');
    expect(JSON.parse(started[0]!.get('dest_folder_path')!)).toBe('/SAVINA/Đích');
    expect(polls).toBe(2);
  });

  it('tải xuống: chuyển Range, trả luồng; DSM trả JSON lỗi hay 404 thì báo rõ', async () => {
    const dsm = fakeDsm({
      'SYNO.FileStation.Download.download': (params, init) => {
        const path = JSON.parse(params.get('path')!);
        if (path === '/SAVINA/khong.pdf') return new Response('not found', { status: 404 });
        if (path === '/SAVINA/loi.pdf') return Response.json({ success: false, error: { code: 407 } });
        const range = new Headers(init?.headers).get('range');
        return new Response('0123456789', {
          status: range ? 206 : 200,
          headers: { 'content-type': 'application/pdf', 'content-length': '10', ...(range ? { 'content-range': 'bytes 0-9/100' } : {}) },
        });
      },
    });
    const gateway = new SynologyGateway(dsm.fetcher);
    const file = await gateway.download(credentials, '/SAVINA/a.pdf', { range: 'bytes=0-9' });
    expect(file).toMatchObject({ partial: true, contentRange: 'bytes 0-9/100', contentLength: 10, contentType: 'application/pdf' });
    const chunks: Buffer[] = [];
    for await (const chunk of file.body) chunks.push(Buffer.from(chunk as Uint8Array));
    expect(Buffer.concat(chunks).toString()).toBe('0123456789');
    await expect(gateway.download(credentials, '/SAVINA/khong.pdf')).rejects.toBeInstanceOf(SharedNasNotFoundError);
    await expect(gateway.download(credentials, '/SAVINA/loi.pdf')).rejects.toBeInstanceOf(SharedNasUnavailableError);
  });

  describe('tải lên', () => {
    let server: Server;
    let received: { headers: Record<string, string | string[] | undefined>; body: Buffer; url: string }[];
    let reply: object;
    let baseUrl: string;

    beforeAll(async () => {
      server = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          const body = Buffer.concat(chunks);
          const url = request.url ?? '';
          response.setHeader('content-type', 'application/json');
          if (request.method === 'POST' && url.includes('SYNO.FileStation.Upload')) {
            received.push({ headers: request.headers, body, url });
            response.end(JSON.stringify(reply));
            return;
          }
          const params = new URLSearchParams(body.toString());
          if (params.get('method') === 'login') response.end(JSON.stringify({ success: true, data: { sid: 'sid-up' } }));
          else response.end(JSON.stringify({ success: true, data: { shares: [] } }));
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
    beforeEach(() => {
      received = [];
      reply = { success: true, data: { blSkip: false } };
    });

    it('gửi multipart có độ dài đúng, tên tệp tiếng Việt, không ghi đè; luồng tệp đi thẳng', async () => {
      const gateway = new SynologyGateway();
      const content = Buffer.alloc(200_000, 3);
      await gateway.upload({ ...credentials, baseUrl }, '/SAVINA/HĐ', 'Hợp đồng số 1.pdf', Readable.from([content.subarray(0, 50_000), content.subarray(50_000)]), content.length);
      const [request] = received;
      expect(request!.url).toContain('_sid=sid-up');
      expect(Number(request!.headers['content-length'])).toBe(request!.body.length);
      const text = request!.body.toString('utf8');
      expect(text).toContain('name="path"\r\n\r\n/SAVINA/HĐ\r\n');
      expect(text).toContain('name="overwrite"\r\n\r\nfalse\r\n');
      expect(text).toContain('filename="Hợp đồng số 1.pdf"');
      expect(request!.body.includes(content)).toBe(true);
    });

    it('đã có tệp cùng tên (DSM bỏ qua) thì báo trùng; thân ngắn hơn đã khai thì dừng', async () => {
      const gateway = new SynologyGateway();
      reply = { success: true, data: { blSkip: true } };
      await expect(gateway.upload({ ...credentials, baseUrl }, '/SAVINA', 'a.pdf', Readable.from([Buffer.from('abc')]), 3)).rejects.toBeInstanceOf(
        SharedNasConflictError,
      );
      await expect(gateway.upload({ ...credentials, baseUrl }, '/SAVINA', 'b.pdf', Readable.from([Buffer.from('ab')]), 3)).rejects.toThrow(/chưa đủ/);
      await expect(gateway.upload({ ...credentials, baseUrl }, '/SAVINA', 'c.pdf', Readable.from([Buffer.from('abcd')]), 3)).rejects.toThrow(/lớn hơn/);
    });
  });
});
