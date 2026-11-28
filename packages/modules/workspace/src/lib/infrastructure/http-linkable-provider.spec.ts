import { LinkableProviderError } from '../application/related-object.port.js';
import { HttpLinkableProvider, safeLaunchUrl } from './http-linkable-provider.js';

const viewer = { tenantId: 't-1', userId: 'u-1', accessToken: 'token-1' };

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function providerWith(handler: (url: string) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return handler(String(input));
  }) as unknown as typeof fetch;
  let now = 1_000;
  const provider = new HttpLinkableProvider('crm', 'http://crm/api/crm', fetcher, () => now);
  return { provider, calls, advance: (ms: number) => (now += ms) };
}

async function reasonOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return error instanceof LinkableProviderError ? error.reason : 'other';
  }
}

describe('HttpLinkableProvider', () => {
  it('gọi dưới danh nghĩa người xem và chỉ nhận loại thuộc đúng module', async () => {
    const { provider, calls } = providerWith(() =>
      reply(200, {
        kinds: [
          { key: 'crm.contract', label: 'Hợp đồng bán', moduleLabel: 'Bán hàng', prefill: true },
          { key: 'finance.receipt', label: 'Mạo danh', moduleLabel: 'Tài chính' },
          { key: 'crm.bad key', label: 'Sai khoá' },
          'rác',
        ],
      }),
    );
    expect(await provider.kinds(viewer)).toEqual([
      { key: 'crm.contract', label: 'Hợp đồng bán', moduleLabel: 'Bán hàng', prefill: true },
    ]);
    expect(calls[0]?.url).toBe('http://crm/api/crm/v1/linkable/kinds');
    expect((calls[0]?.init?.headers as Record<string, string>)['authorization']).toBe('Bearer token-1');
  });

  it('giữ danh sách loại 60 giây cho mỗi người xem', async () => {
    const { provider, calls, advance } = providerWith(() => reply(200, { kinds: [] }));
    await provider.kinds(viewer);
    await provider.kinds(viewer);
    expect(calls).toHaveLength(1);
    await provider.kinds({ ...viewer, userId: 'u-2' });
    expect(calls).toHaveLength(2);
    advance(61_000);
    await provider.kinds(viewer);
    expect(calls).toHaveLength(3);
  });

  it('phân biệt lý do lỗi: module không dùng, không có quyền, không trả lời', async () => {
    expect(
      await reasonOf(providerWith(() => reply(403, { code: 'MODULE_NOT_ENTITLED' })).provider.kinds(viewer)),
    ).toBe('module_unavailable');
    expect(await reasonOf(providerWith(() => reply(404, {})).provider.kinds(viewer))).toBe('module_unavailable');
    expect(await reasonOf(providerWith(() => reply(403, { code: 'ACCESS_DENIED' })).provider.kinds(viewer))).toBe(
      'forbidden',
    );
    expect(await reasonOf(providerWith(() => reply(401, {})).provider.kinds(viewer))).toBe('forbidden');
    expect(await reasonOf(providerWith(() => reply(500, {})).provider.kinds(viewer))).toBe('unreachable');
    expect(
      await reasonOf(
        providerWith(() => {
          throw new TypeError('fetch failed');
        }).provider.kinds(viewer),
      ),
    ).toBe('unreachable');
  });

  it('resolve: bỏ phần tử sai hình dạng, đường dẫn ngoài và id không hỏi tới', async () => {
    const { provider, calls } = providerWith(() =>
      reply(200, {
        items: [
          {
            kind: 'crm.contract',
            id: 'c-1',
            code: 'HD-001',
            label: 'HD-001 — Tủ điện',
            launchUrl: '/modules/crm#contracts/c-1',
            fields: [
              { key: 'value', label: 'Giá trị', type: 'money', value: 1200 },
              { key: 'from', label: 'Từ', type: 'date', value: '2026-01-05T00:00:00Z' },
              { key: 'bad', type: 'text', value: 'thiếu nhãn' },
            ],
            upstream: [{ kind: 'crm.quote', id: 'q-1', label: 'BG-010' }, { kind: 'x', id: '1', label: 'sai' }],
            prefill: { title: 'Tủ điện', contractValue: -5, startDate: 'không phải ngày' },
          },
          { kind: 'crm.contract', id: 'c-2', label: 'Ngoài', launchUrl: 'https://evil.example/x' },
          { kind: 'crm.contract', id: 'c-9', label: 'Không hỏi', launchUrl: '/modules/crm#contracts/c-9' },
          { kind: 'crm.quote', id: 'c-1', label: 'Sai loại', launchUrl: '/modules/crm#quotes/c-1' },
        ],
      }),
    );
    const items = await provider.resolve(viewer, 'crm.contract', ['c-1', 'c-2']);
    expect(calls[0]?.url).toBe('http://crm/api/crm/v1/linkable/resolve?kind=crm.contract&ids=c-1%2Cc-2');
    expect(items).toHaveLength(1);
    expect(items[0]?.fields).toEqual([
      { key: 'value', label: 'Giá trị', type: 'money', value: 1200 },
      { key: 'from', label: 'Từ', type: 'date', value: '2026-01-05' },
    ]);
    expect(items[0]?.upstream).toEqual([{ kind: 'crm.quote', id: 'q-1', label: 'BG-010', code: undefined }]);
    expect(items[0]?.prefill).toEqual({
      title: 'Tủ điện',
      description: undefined,
      startDate: undefined,
      endDate: undefined,
      contractValue: undefined,
      crmCustomerId: undefined,
    });
  });

  it('resolve chia lô 50 id mỗi lời gọi', async () => {
    const { provider, calls } = providerWith(() => reply(200, { items: [] }));
    await provider.resolve(viewer, 'crm.contract', Array.from({ length: 120 }, (_, index) => `id-${index}`));
    expect(calls).toHaveLength(3);
  });

  it('kinds giữ cờ create đúng kiểu', async () => {
    const { provider } = providerWith(() =>
      reply(200, {
        kinds: [
          { key: 'crm.contract', label: 'Hợp đồng bán', prefill: true, create: true },
          { key: 'crm.quote', label: 'Báo giá', prefill: true, create: 'yes' },
        ],
      }),
    );
    const kinds = await provider.kinds(viewer);
    expect(kinds[0]).toMatchObject({ key: 'crm.contract', create: true });
    expect(kinds[1]).not.toHaveProperty('create');
  });

  it('create-form: GET dưới danh nghĩa người xem, lọc hình dạng; 403 có câu của module thì chuyển nguyên', async () => {
    const form = {
      kind: 'crm.contract',
      title: 'Lập hợp đồng',
      fields: [
        { key: 'customerId', label: 'Khách hàng', type: 'reference', reference: 'crm.customer', required: true },
        { key: 'leak', label: 'Sang module khác', type: 'reference', reference: 'finance.voucher' },
      ],
    };
    const { provider, calls } = providerWith(() => reply(200, form));
    const result = await provider.createForm(viewer, 'crm.contract');
    expect(calls[0]?.url).toBe('http://crm/api/crm/v1/linkable/create-form?kind=crm.contract');
    expect(calls[0]?.init?.method).toBe('GET');
    expect(result.fields.map((field) => field.key)).toEqual(['customerId']);

    const denied = providerWith(() => reply(403, { code: 'FORBIDDEN', message: 'Bạn không có quyền quản lý hợp đồng.' }));
    await expect(denied.provider.createForm(viewer, 'crm.contract')).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'Bạn không có quyền quản lý hợp đồng.',
    });
    // Route chưa có (module bản cũ) và công ty không dùng module: như lúc đọc.
    expect(
      await reasonOf(providerWith(() => reply(404, { message: 'Cannot GET' })).provider.createForm(viewer, 'crm.contract')),
    ).toBe('module_unavailable');
    expect(
      await reasonOf(
        providerWith(() => reply(403, { code: 'MODULE_NOT_ENTITLED', message: 'x' })).provider.createForm(viewer, 'crm.contract'),
      ),
    ).toBe('module_unavailable');
    expect(
      await reasonOf(
        providerWith(() => reply(200, { kind: 'crm.contract', title: 'x', fields: [] })).provider.createForm(viewer, 'crm.contract'),
      ),
    ).toBe('unreachable');
  });

  it('create: POST với token và CSRF của người dùng (không service token), trả hồ sơ đã lọc', async () => {
    const { provider, calls } = providerWith(() =>
      reply(201, {
        kind: 'crm.contract',
        id: 'c-9',
        code: 'HD-009',
        label: 'HD-009 — Hợp đồng giấy',
        launchUrl: '/modules/crm#contracts/c-9',
        fields: [],
        upstream: [],
      }),
    );
    const created = await provider.create({ ...viewer, csrfToken: 'csrf-token-1' }, 'crm.contract', {
      values: { title: 'Hợp đồng giấy' },
      confirm: true,
    });
    expect(created).toMatchObject({ kind: 'crm.contract', id: 'c-9', launchUrl: '/modules/crm#contracts/c-9' });
    expect(calls[0]?.url).toBe('http://crm/api/crm/v1/linkable/create?kind=crm.contract');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ values: { title: 'Hợp đồng giấy' }, confirm: true });
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer token-1');
    expect(headers['x-csrf-token']).toBe('csrf-token-1');
    expect(headers['cookie']).toBe('ep_csrf=csrf-token-1');
    expect(headers['x-service-token']).toBeUndefined();
  });

  it('create: CSRF lạ hình dạng thì không chuyển tiếp', async () => {
    const { provider, calls } = providerWith(() => reply(400, { code: 'VALIDATION', message: 'x' }));
    await provider.create({ ...viewer, csrfToken: 'a; b=c' }, 'crm.contract', { values: {} }).catch(() => undefined);
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['x-csrf-token']).toBeUndefined();
    expect(headers['cookie']).toBeUndefined();
  });

  it('create: lỗi dữ liệu và cần xác nhận của module chuyển nguyên câu chữ, cảnh báo đã lọc', async () => {
    const { provider } = providerWith(() =>
      reply(409, {
        statusCode: 409,
        code: 'LINKABLE_CONFIRM_REQUIRED',
        message: 'Mã số thuế đã có ở khách hàng KH001 - Công ty A.',
        field: 'taxCode',
        warnings: ['KH001 - Công ty A', 42, ''],
      }),
    );
    await expect(provider.create(viewer, 'crm.customer', { values: {} })).rejects.toMatchObject({
      statusCode: 409,
      code: 'LINKABLE_CONFIRM_REQUIRED',
      field: 'taxCode',
      warnings: ['KH001 - Công ty A'],
    });
    const invalid = providerWith(() => reply(400, { code: 'VALIDATION', message: 'Vui lòng nhập tên hợp đồng.' }));
    await expect(invalid.provider.create(viewer, 'crm.contract', { values: {} })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Vui lòng nhập tên hợp đồng.',
    });
    // 5xx và thân không có mã máy đọc được là lỗi hạ tầng, không lộ chi tiết.
    const empty = { values: {} };
    expect(
      await reasonOf(providerWith(() => reply(500, { code: 'X', message: 'stack' })).provider.create(viewer, 'crm.contract', empty)),
    ).toBe('unreachable');
    expect(
      await reasonOf(providerWith(() => reply(400, { message: 'no code' })).provider.create(viewer, 'crm.contract', empty)),
    ).toBe('unreachable');
    // Hồ sơ trả về có đường dẫn ra ngoài: không nhận.
    expect(
      await reasonOf(
        providerWith(() =>
          reply(201, { kind: 'crm.contract', id: 'c', label: 'x', launchUrl: 'https://evil.example' }),
        ).provider.create(viewer, 'crm.contract', empty),
      ),
    ).toBe('unreachable');
  });

  it('search: tham số lọc đi kèm, không đè được tham số chung; không có lọc thì URL như cũ', async () => {
    const { provider, calls } = providerWith(() => reply(200, { items: [] }));
    await provider.search(viewer, 'crm.quote', 'BG', 20, { contractLinkable: 'true', customerId: 'k-1', kind: 'finance.x', limit: '999' });
    const url = new URL(calls[0]?.url ?? '');
    expect(url.pathname).toBe('/api/crm/v1/linkable/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({ contractLinkable: 'true', customerId: 'k-1', kind: 'crm.quote', q: 'BG', limit: '20' });
    await provider.search(viewer, 'crm.quote', '', 20);
    expect(calls[1]?.url).toBe('http://crm/api/crm/v1/linkable/search?kind=crm.quote&q=&limit=20');
  });

  it('create-preview: GET dưới danh nghĩa người xem, lọc hình dạng; lời từ chối của module chuyển nguyên', async () => {
    const { provider, calls } = providerWith(() =>
      reply(200, {
        title: 'Dòng hàng từ báo giá BG-1',
        columns: [{ key: 'name', label: 'Mặt hàng', type: 'text' }, { key: 'x', label: 'Lạ', type: 'script' }],
        rows: [{ name: 'Tủ điện', x: '<b>' }],
        fill: { customerId: { value: 'k-1', label: 'KH001 — Công ty A' } },
      }),
    );
    const preview = await provider.createPreview(viewer, 'crm.contract', 'quoteId', 'q-1');
    expect(calls[0]?.url).toBe('http://crm/api/crm/v1/linkable/create-preview?kind=crm.contract&field=quoteId&value=q-1');
    expect(calls[0]?.init?.method).toBe('GET');
    expect((calls[0]?.init?.headers as Record<string, string>)['authorization']).toBe('Bearer token-1');
    expect(preview).toMatchObject({
      field: 'quoteId',
      value: 'q-1',
      columns: [{ key: 'name', label: 'Mặt hàng', type: 'text' }],
      rows: [{ name: 'Tủ điện' }],
      fill: { customerId: { value: 'k-1', label: 'KH001 — Công ty A' } },
    });

    const rejected = providerWith(() => reply(409, { code: 'QUOTE_NOT_ACCEPTED', message: 'Báo giá chưa được khách chấp nhận.' }));
    await expect(rejected.provider.createPreview(viewer, 'crm.contract', 'quoteId', 'q-1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'QUOTE_NOT_ACCEPTED',
      message: 'Báo giá chưa được khách chấp nhận.',
    });
    expect(
      await reasonOf(providerWith(() => reply(404, { message: 'Cannot GET' })).provider.createPreview(viewer, 'crm.contract', 'quoteId', 'q-1')),
    ).toBe('module_unavailable');
  });

  it('chỉ nhận đường dẫn nội bộ /modules/', () => {
    expect(safeLaunchUrl('/modules/crm#contracts/1')).toBe('/modules/crm#contracts/1');
    expect(safeLaunchUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeLaunchUrl('/modules//evil.example')).toBeUndefined();
    expect(safeLaunchUrl('https://evil.example')).toBeUndefined();
  });
});
