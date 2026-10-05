import { ServiceUnavailableException } from '@nestjs/common';
import {
  PROCEDURE_UNAVAILABLE_MESSAGE,
  procedureFetch,
} from './hrm-procedure-fetch';
import { procedureDefinitions } from './hrm-work-references';

describe('procedureFetch (ISS-BE-064)', () => {
  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
  });

  it('maps network failures to 503 with a Vietnamese message', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new TypeError('fetch failed')) as never;
    const error = await procedureFetch('http://x').catch((e) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(error.getStatus()).toBe(503);
    expect(error.message).toBe(PROCEDURE_UNAVAILABLE_MESSAGE);
  });

  it('returns the response untouched when Procedure answers', async () => {
    const response = { ok: false, status: 409 } as Response;
    global.fetch = jest.fn().mockResolvedValue(response) as never;
    await expect(procedureFetch('http://x')).resolves.toBe(response);
  });

  it('procedureDefinitions returns 503 when Procedure is unreachable', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      ) as never;
    await expect(
      procedureDefinitions({ headers: {} } as never, 'tenant'),
    ).rejects.toThrow(PROCEDURE_UNAVAILABLE_MESSAGE);
  });
});
