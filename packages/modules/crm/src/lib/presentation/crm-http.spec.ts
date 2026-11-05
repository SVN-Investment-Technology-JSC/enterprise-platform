import type { HttpException } from '@nestjs/common';
import { CrmConflictError } from '../domain/crm.error.js';
import { runCrm } from './crm-http.js';

describe('runCrm', () => {
  it('đưa details của lỗi nghiệp vụ vào thân lỗi, không ghi đè statusCode, code, message', async () => {
    const error = (await runCrm(async () => {
      throw new CrmConflictError('DUPLICATE_TAX_CODE', 'Trùng MST.', { matches: [{ id: 'a' }], code: 'GHI_ĐÈ' });
    }).catch((cause) => cause)) as HttpException;
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toEqual({ statusCode: 409, code: 'DUPLICATE_TAX_CODE', message: 'Trùng MST.', matches: [{ id: 'a' }] });
  });

  it('id không phải UUID ở Postgres (22P02) là 404; lỗi khác giữ nguyên', async () => {
    await expect(runCrm(async () => { throw Object.assign(new Error('x'), { code: '22P02' }); })).rejects.toMatchObject({ status: 404 });
    await expect(runCrm(async () => { throw new TypeError('bug'); })).rejects.toBeInstanceOf(TypeError);
  });
});
