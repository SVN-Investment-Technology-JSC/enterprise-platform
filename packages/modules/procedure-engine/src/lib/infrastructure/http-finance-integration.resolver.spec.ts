import { FinanceNotEntitledError } from '../application/finance-integration.port.js';
import { HttpFinanceIntegrationResolver } from './http-finance-integration.resolver.js';

const originalToken = process.env['INTERNAL_SERVICE_TOKEN'];
afterEach(() => {
  if (originalToken === undefined) delete process.env['INTERNAL_SERVICE_TOKEN'];
  else process.env['INTERNAL_SERVICE_TOKEN'] = originalToken;
});

type Reply = { status: number; body?: unknown } | Error;

/** Trả lời theo địa chỉ: `finance` cho lời gọi capabilities, `platform` cho lời hỏi entitlement của Platform. */
function resolverWith(replies: { finance: Reply; platform?: Reply }) {
  process.env['INTERNAL_SERVICE_TOKEN'] = 'tok';
  const calls: string[] = [];
  const fetcher = jest.fn(async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    const reply = url.startsWith('http://finance') ? replies.finance : (replies.platform ?? new Error('không có Platform'));
    if (reply instanceof Error) throw reply;
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body } as Response;
  });
  return { resolver: new HttpFinanceIntegrationResolver('http://finance/api/finance', 'http://platform/tenant-databases', fetcher as unknown as typeof fetch), calls };
}

describe('HttpFinanceIntegrationResolver.capabilities', () => {
  it('Tài chính trả lời: lấy đúng loại phiếu, bỏ giá trị lạ, không hỏi Platform', async () => {
    const { resolver, calls } = resolverWith({ finance: { status: 200, body: { voucherKinds: ['PAYMENT', 'KHAC', 'RECEIPT'] } } });
    await expect(resolver.capabilities('t1')).resolves.toEqual({ voucherKinds: ['PAYMENT', 'RECEIPT'] });
    expect(calls).toHaveLength(1);
  });

  it('Tài chính từ chối (503 chung) và Platform nói MODULE_NOT_ENTITLED: báo tenant chưa được cấp module', async () => {
    const { resolver, calls } = resolverWith({
      finance: { status: 503 },
      platform: { status: 403, body: { code: 'MODULE_NOT_ENTITLED' } },
    });
    await expect(resolver.capabilities('t 1')).rejects.toBeInstanceOf(FinanceNotEntitledError);
    expect(calls[1]).toBe('http://platform/tenant-databases/t%201?moduleKey=finance');
  });

  it('không kết nối được Tài chính nhưng tenant đúng là chưa có module: vẫn báo chưa được cấp (nguyên nhân thật)', async () => {
    const { resolver } = resolverWith({
      finance: new Error('ECONNREFUSED'),
      platform: { status: 403, body: { code: 'MODULE_NOT_ENTITLED' } },
    });
    await expect(resolver.capabilities('t1')).rejects.toBeInstanceOf(FinanceNotEntitledError);
  });

  it('tenant có module nhưng Tài chính lỗi: giữ lỗi gốc "không phản hồi", không đổ cho entitlement', async () => {
    const { resolver } = resolverWith({ finance: { status: 503 }, platform: { status: 200, body: { database: {} } } });
    const error = await resolver.capabilities('t1').catch((cause: unknown) => cause as Error);
    expect(error).not.toBeInstanceOf(FinanceNotEntitledError);
    expect((error as Error).message).toContain('503');
  });

  it('Platform cũng không trả lời hoặc trả mã khác: không kết luận chưa cấp module, giữ lỗi gốc', async () => {
    for (const platform of [new Error('timeout'), { status: 500 }, { status: 403, body: { code: 'TENANT_SUSPENDED' } }] as Reply[]) {
      const { resolver } = resolverWith({ finance: { status: 503 }, platform });
      const error = await resolver.capabilities('t1').catch((cause: unknown) => cause as Error);
      expect(error).not.toBeInstanceOf(FinanceNotEntitledError);
    }
  });

  it('thiếu service token: không hỏi Platform được nên giữ lỗi gốc', async () => {
    const { resolver } = resolverWith({ finance: { status: 503 }, platform: { status: 403, body: { code: 'MODULE_NOT_ENTITLED' } } });
    delete process.env['INTERNAL_SERVICE_TOKEN'];
    await expect(resolver.capabilities('t1')).rejects.not.toBeInstanceOf(FinanceNotEntitledError);
  });
});
