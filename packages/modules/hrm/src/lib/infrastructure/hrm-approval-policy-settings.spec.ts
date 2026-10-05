import { BadRequestException } from '@nestjs/common';
import {
  loadApprovalPolicySettings,
  parseApprovalPolicyInput,
  saveApprovalPolicySettings,
} from './hrm-approval-policy-settings.js';

function fakeDb(current: boolean | null, ready = true) {
  const calls: { sql: string; params?: unknown[] }[] = [];
  return {
    calls,
    db: {
      query: async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        if (sql.includes('to_regclass'))
          return { rows: [{ ready }], rowCount: 1 };
        if (sql.includes('SELECT allow_self_approval'))
          return {
            rows:
              current === null
                ? []
                : [
                    {
                      allow_self_approval: current,
                      updated_by: 'u1',
                      updated_at: '2026-10-05T00:00:00.000Z',
                    },
                  ],
            rowCount: current === null ? 0 : 1,
          };
        return { rows: [], rowCount: 1 };
      },
    } as never,
  };
}

describe('parseApprovalPolicyInput', () => {
  it('bắt buộc boolean và lý do tối thiểu 10 ký tự', () => {
    expect(() =>
      parseApprovalPolicyInput({ allowSelfApproval: 'yes', reason: 'x'.repeat(20) }),
    ).toThrow(BadRequestException);
    expect(() =>
      parseApprovalPolicyInput({ allowSelfApproval: true }),
    ).toThrow(BadRequestException);
    expect(() =>
      parseApprovalPolicyInput({ allowSelfApproval: true, reason: 'ngắn' }),
    ).toThrow(BadRequestException);
    expect(
      parseApprovalPolicyInput({
        allowSelfApproval: true,
        reason: '  Doanh nghiệp một người quản lý  ',
      }),
    ).toEqual({
      allowSelfApproval: true,
      reason: 'Doanh nghiệp một người quản lý',
    });
  });
});

describe('loadApprovalPolicySettings', () => {
  it('mặc định tắt khi chưa có dòng hoặc chưa migrate', async () => {
    expect((await loadApprovalPolicySettings(fakeDb(null).db, 't')).allowSelfApproval).toBe(false);
    expect((await loadApprovalPolicySettings(fakeDb(true, false).db, 't')).allowSelfApproval).toBe(false);
  });
  it('đọc giá trị đã lưu', async () => {
    const result = await loadApprovalPolicySettings(fakeDb(true).db, 't');
    expect(result).toEqual({
      allowSelfApproval: true,
      updatedBy: 'u1',
      updatedAt: '2026-10-05T00:00:00.000Z',
    });
  });
});

describe('saveApprovalPolicySettings', () => {
  it('upsert và ghi audit APPROVAL_POLICY_CHANGED kèm lý do, giá trị cũ/mới', async () => {
    const { db, calls } = fakeDb(false);
    const result = await saveApprovalPolicySettings(db, 't', 'admin', {
      allowSelfApproval: true,
      reason: 'Công ty chỉ có một quản lý duy nhất',
    });
    expect(result.changed).toBe(true);
    const upsert = calls.find((c) => c.sql.includes('ON CONFLICT'));
    expect(upsert?.params).toEqual(['t', true, 'admin']);
    const audit = calls.find((c) => c.sql.includes('APPROVAL_POLICY_CHANGED'));
    expect(JSON.parse(String(audit?.params?.[2]))).toEqual({
      setting: 'allow_self_approval',
      previous: false,
      current: true,
      reason: 'Công ty chỉ có một quản lý duy nhất',
    });
  });
  it('không ghi gì khi thiếu lý do', async () => {
    const { db, calls } = fakeDb(false);
    await expect(
      saveApprovalPolicySettings(db, 't', 'admin', { allowSelfApproval: true }),
    ).rejects.toThrow(BadRequestException);
    expect(calls).toHaveLength(0);
  });
});
