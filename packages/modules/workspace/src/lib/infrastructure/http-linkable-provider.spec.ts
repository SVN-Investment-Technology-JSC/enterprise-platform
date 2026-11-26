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

  it('chỉ nhận đường dẫn nội bộ /modules/', () => {
    expect(safeLaunchUrl('/modules/crm#contracts/1')).toBe('/modules/crm#contracts/1');
    expect(safeLaunchUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeLaunchUrl('/modules//evil.example')).toBeUndefined();
    expect(safeLaunchUrl('https://evil.example')).toBeUndefined();
  });
});
