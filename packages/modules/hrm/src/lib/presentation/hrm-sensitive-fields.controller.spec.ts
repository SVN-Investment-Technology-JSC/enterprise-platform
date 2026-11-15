import 'reflect-metadata';
import type { Request } from 'express';
import { HrmDashboardController } from './hrm-dashboard.controller';
import { HrmPayrollSettingsController } from './hrm-payroll-settings.controller';
import { HrmProfileDocumentController } from './hrm-profile-document.controller';

jest.mock('../infrastructure/hrm-context.service.js', () => ({ HrmContextService: class {} }));

const EMPLOYEE_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const req = { headers: {} } as Request;

/** Ngữ cảnh giả: `sensitive` quyết định kết quả has('hrm.employee.sensitive'). */
function ctxWith(pool: { query: jest.Mock }, sensitive: boolean, ownEmployeeId = 'someone-else') {
  const context = { pool, tenantId: 'tenant-a', principal: { userId: 'user-a', permissions: [] } };
  return {
    getContext: jest.fn().mockResolvedValue(context),
    getRequestContext: jest.fn().mockResolvedValue(context),
    scoped: jest.fn().mockResolvedValue({ ...context, employeeId: EMPLOYEE_ID }),
    resolveEmployee: jest.fn().mockResolvedValue({ employeeId: ownEmployeeId }),
    has: jest.fn((_ctx: unknown, permission: string) => sensitive && permission === 'hrm.employee.sensitive'),
  };
}

describe('Tổng quan nhân viên: trường CCCD theo quyền dữ liệu nhạy cảm (SEC-BE048-02, 03)', () => {
  const profile = {
    employee_id: EMPLOYEE_ID,
    identity_card_number: '001200000001',
    identity_card_issued_date: '2020-01-01',
    identity_card_expiry_date: '2045-01-01',
    identity_card_front_attachment_id: 'file-front',
    identity_card_back_attachment_id: 'file-back',
  };
  const pool = () => ({
    query: jest.fn(async (sql: string) => {
      if (sql.includes('FROM hrm_schema.employee_profiles')) return { rows: [{ ...profile }] };
      if (sql.includes('count(*)')) return { rows: [{ c: 0 }] };
      return { rows: [] };
    }),
  });

  it('không có quyền nhạy cảm: không có ngày cấp, hạn và mã tệp ảnh CCCD', async () => {
    const controller = new HrmDashboardController(ctxWith(pool(), false) as never);
    const { data } = await controller.getEmployeeOverview(req, EMPLOYEE_ID);
    expect(data.profile).toMatchObject({
      identity_card_number: null,
      identity_card_issued_date: null,
      identity_card_expiry_date: null,
      identity_card_front_attachment_id: null,
      identity_card_back_attachment_id: null,
    });
  });

  it('có quyền nhạy cảm, hoặc là chính chủ: đủ trường', async () => {
    for (const ctx of [ctxWith(pool(), true), ctxWith(pool(), false, EMPLOYEE_ID)]) {
      const { data } = await new HrmDashboardController(ctx as never).getEmployeeOverview(req, EMPLOYEE_ID);
      expect(data.profile).toMatchObject(profile);
    }
  });
});

describe('Giấy tờ hồ sơ: tệp ảnh CCCD theo quyền dữ liệu nhạy cảm', () => {
  const pool = (own: boolean) => ({
    query: jest.fn(async (sql: string) => {
      if (sql.includes('FROM hrm_schema.employee_profiles'))
        return {
          rows: [
            {
              identity_card_number: '001',
              identity_card_expiry_date: '2045-01-01',
              photo_attachment_id: null,
              identity_card_front_attachment_id: 'file-front',
              identity_card_back_attachment_id: null,
            },
          ],
        };
      if (sql.includes('FROM hrm_schema.attachments'))
        return { rows: [{ id: 'file-front', file_name: 'cccd.jpg', content_type: 'image/jpeg', size_bytes: 1 }] };
      if (sql.includes('FROM core_schema.employees')) return { rows: own ? [{}] : [], rowCount: own ? 1 : 0 };
      return { rows: [] };
    }),
  });

  it('người chỉ có hrm.employee.read: không thấy tệp và hạn CCCD', async () => {
    const controller = new HrmProfileDocumentController(ctxWith(pool(false), false) as never);
    const { data } = await controller.list(req, EMPLOYEE_ID);
    expect(data).toMatchObject({ identityCardExpiryDate: null, identityCardFront: null, identityCardBack: null });
  });

  it('chính chủ hoặc người có quyền nhạy cảm: thấy tệp CCCD', async () => {
    for (const ctx of [ctxWith(pool(true), false), ctxWith(pool(false), true)]) {
      const { data } = await new HrmProfileDocumentController(ctx as never).list(req, EMPLOYEE_ID);
      expect(data?.identityCardFront).toMatchObject({ id: 'file-front' });
      expect(data?.identityCardExpiryDate).toBe('2045-01-01');
    }
  });
});

describe('Bảng tổng lương: số tài khoản (SEC-BE048-04)', () => {
  const pool = () => ({
    query: jest.fn().mockResolvedValue({
      rows: [{ id: 't1', beneficiary_snapshot: { bank_name: 'VCB', bank_account_number: '0011001234' } }],
    }),
  });

  it('không có quyền nhạy cảm: số tài khoản dạng ****1234', async () => {
    const controller = new HrmPayrollSettingsController(ctxWith(pool(), false) as never);
    const { data } = await controller.totals(req, RUN_ID);
    expect(data[0].beneficiary_snapshot).toEqual({ bank_name: 'VCB', bank_account_number: '****1234' });
  });

  it('có quyền nhạy cảm: số tài khoản đầy đủ', async () => {
    const controller = new HrmPayrollSettingsController(ctxWith(pool(), true) as never);
    const { data } = await controller.totals(req, RUN_ID);
    expect(data[0].beneficiary_snapshot.bank_account_number).toBe('0011001234');
  });
});
