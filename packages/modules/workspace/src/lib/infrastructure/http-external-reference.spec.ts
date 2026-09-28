import { HttpExternalReferenceClient } from './http-external-reference.js';

/**
 * Thay `fetch` toàn cục bằng một hàm ghi lại mọi lời gọi.
 *
 * Kiểm ba điều mà sai thì hậu quả nặng: khoá cache có `userId`, token được
 * chuyển tiếp nguyên vẹn, và module không hỗ trợ thì không gọi mạng.
 */
function stubFetch(instances: { id: string; title?: string; status?: string }[]) {
  const calls: { url: string; authorization?: string }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), authorization: headers['authorization'] });
    return new Response(JSON.stringify({ instances }), { status: 200 });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const viewer = (userId: string) => ({ tenantId: 't1', userId, accessToken: `token-${userId}` });

describe('HttpExternalReferenceClient', () => {
  it('chuyển tiếp access token của chính người dùng', async () => {
    const stub = stubFetch([{ id: 'i1' }]);
    try {
      await new HttpExternalReferenceClient('http://procedure').read(
        viewer('u1'),
        'procedure-engine',
        ['i1'],
      );
      expect(stub.calls[0]?.authorization).toBe('Bearer token-u1');
      expect(stub.calls[0]?.url).toBe('http://procedure/v1/workspace');
    } finally {
      stub.restore();
    }
  });

  it('cùng một người trong 60 giây chỉ gọi một lần', async () => {
    const stub = stubFetch([{ id: 'i1' }]);
    try {
      const client = new HttpExternalReferenceClient('http://procedure');
      await client.read(viewer('u1'), 'procedure-engine', ['i1']);
      await client.read(viewer('u1'), 'procedure-engine', ['i1']);
      expect(stub.calls).toHaveLength(1);
    } finally {
      stub.restore();
    }
  });

  it('người khác KHÔNG dùng chung cache — khoá có userId', async () => {
    // Hai người có thể thấy khác nhau ở module gốc tuỳ quyền của từng người.
    const stub = stubFetch([{ id: 'i1' }]);
    try {
      const client = new HttpExternalReferenceClient('http://procedure');
      await client.read(viewer('u1'), 'procedure-engine', ['i1']);
      await client.read(viewer('u2'), 'procedure-engine', ['i1']);
      expect(stub.calls.map((call) => call.authorization)).toEqual([
        'Bearer token-u1',
        'Bearer token-u2',
      ]);
    } finally {
      stub.restore();
    }
  });

  it('chỉ trả những hồ sơ được hỏi', async () => {
    const stub = stubFetch([
      { id: 'i1', title: 'Một' },
      { id: 'i2', title: 'Hai' },
    ]);
    try {
      const result = await new HttpExternalReferenceClient('http://procedure').read(
        viewer('u1'),
        'procedure-engine',
        ['i2'],
      );
      expect([...result.keys()]).toEqual(['i2']);
      expect(result.get('i2')?.label).toBe('Hai');
    } finally {
      stub.restore();
    }
  });

  it('module chưa hỗ trợ thì không gọi mạng', async () => {
    const stub = stubFetch([]);
    try {
      const result = await new HttpExternalReferenceClient('http://procedure').read(
        viewer('u1'),
        'maintenance',
        ['x'],
      );
      expect(result.size).toBe(0);
      expect(stub.calls).toHaveLength(0);
    } finally {
      stub.restore();
    }
  });

  it('module gốc trả lỗi thì ném ra để tầng trên chuyển sang degraded', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch;
    try {
      await expect(
        new HttpExternalReferenceClient('http://procedure').read(
          viewer('u1'),
          'procedure-engine',
          ['i1'],
        ),
      ).rejects.toThrow();
    } finally {
      globalThis.fetch = original;
    }
  });
});
