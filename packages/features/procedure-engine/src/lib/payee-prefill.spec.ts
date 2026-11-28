import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import {
  isPaymentProcedure,
  loadPayeeProfile,
  payeeBankChanges,
  payeeNameUntouched,
  payeeSlotKeys,
  payeeSlots,
  resetMyPayeeProfileCache,
} from './payee-prefill';

const mockAuthFetch = jest.fn();
jest.mock('@enterprise-platform/shared-ui', () => ({ authFetch: (url: string) => mockAuthFetch(url) }));

type Overrides = {
  voucherKind?: 'PAYMENT' | 'RECEIPT' | null;
  editable?: string[];
  values?: Record<string, { value: { type: 'text'; value: string } }>;
  mapping?: Record<string, string>;
};

/** Hồ sơ thanh toán: ba ô người nhận ở "Thông tin chung", bước 4 là bước Tài chính lập phiếu. */
function instance(overrides: Overrides = {}): ProcedureInstance {
  const voucherKind = overrides.voucherKind === undefined ? 'PAYMENT' : overrides.voucherKind;
  return {
    id: 'i-1',
    initiatedBy: 'u-1',
    flow: {
      attributes: [
        { code: 'so_tien', name: 'Số tiền', type: 'money' },
        { code: 'nguoi_nhan', name: 'Người nhận', type: 'text' },
        { code: 'stk_nguoi_nhan', name: 'STK người nhận', type: 'text' },
        { code: 'ngan_hang_nguoi_nhan', name: 'Ngân hàng người nhận', type: 'text' },
      ],
    },
    steps: [
      { id: 's-1', definitionStepId: 'd-1', order: 1, name: 'Chuẩn bị hồ sơ', attributes: [] },
      {
        id: 's-4',
        definitionStepId: 'd-4',
        order: 4,
        name: 'Lập phiếu chi',
        ...(voucherKind
          ? {
              integration: {
                module: 'finance',
                action: 'voucher',
                voucherKind,
                ...(overrides.mapping ? { mapping: overrides.mapping } : {}),
              },
            }
          : {}),
      },
    ],
    attributeValues: overrides.values ?? {},
    authorization: {
      editableAttributeKeys: overrides.editable ?? [
        'process:so_tien',
        'process:nguoi_nhan',
        'process:stk_nguoi_nhan',
        'process:ngan_hang_nguoi_nhan',
      ],
    },
  } as unknown as ProcedureInstance;
}

const text = (value: string) => ({ type: 'text' as const, value });
const slots = { name: 'process:nguoi_nhan', accountNo: 'process:stk_nguoi_nhan', bank: 'process:ngan_hang_nguoi_nhan' };
const valuesOf = (values: Record<string, ReturnType<typeof text> | null>) => (key: string) => values[key];

describe('người nhận ở hồ sơ thanh toán', () => {
  it('nhận ra ô người nhận và hai ô ngân hàng đang mở', () => {
    expect(payeeSlots(instance())).toEqual(slots);
    expect(payeeSlots(instance({ editable: ['process:so_tien', 'process:stk_nguoi_nhan'] }))).toBeNull();
    expect(payeeSlots(instance({ editable: ['process:nguoi_nhan'] }))).toEqual({ name: 'process:nguoi_nhan' });
  });

  it('ô người nhận chỉ được điền mặc định khi còn trống và chưa bị đụng tới', () => {
    expect(payeeNameUntouched(instance(), {}, slots.name)).toBe(true);
    expect(payeeNameUntouched(instance(), { [slots.name]: null }, slots.name)).toBe(false);
    expect(
      payeeNameUntouched(instance({ values: { [slots.name]: { value: text('Đã lưu') } } }), {}, slots.name),
    ).toBe(false);
  });

  it('điền STK, ngân hàng vào ô trống và ghi nhớ là giá trị tự điền', () => {
    expect(payeeBankChanges(slots, valuesOf({}), {}, { bankAccountNumber: ' 0123 ', bankName: 'Vietcombank' })).toEqual({
      changes: { [slots.accountNo]: text('0123'), [slots.bank]: text('Vietcombank') },
      autoFilled: { [slots.accountNo]: '0123', [slots.bank]: 'Vietcombank' },
    });
  });

  it('đổi người thay giá trị tự điền cũ; ô người dùng tự gõ thì giữ nguyên', () => {
    const result = payeeBankChanges(
      slots,
      valuesOf({ [slots.accountNo]: text('0123'), [slots.bank]: text('ACB tự gõ') }),
      { [slots.accountNo]: '0123', [slots.bank]: 'Vietcombank' },
      { bankAccountNumber: '999', bankName: 'BIDV' },
    );
    expect(result).toEqual({ changes: { [slots.accountNo]: text('999') }, autoFilled: { [slots.accountNo]: '999' } });
  });

  it('bỏ chọn, hay người mới không có (không được xem) STK: xoá giá trị tự điền cũ, không đụng ô trống', () => {
    const values = valuesOf({ [slots.accountNo]: text('0123'), [slots.bank]: null });
    const auto = { [slots.accountNo]: '0123' };
    expect(payeeBankChanges(slots, values, auto, null)).toEqual({ changes: { [slots.accountNo]: null }, autoFilled: {} });
    expect(payeeBankChanges(slots, values, auto, { bankAccountNumber: null, bankName: null })).toEqual({
      changes: { [slots.accountNo]: null },
      autoFilled: {},
    });
  });

  it('không phải hồ sơ chi (không có bước lập phiếu chi, hay là phiếu thu) thì không có ô người nhận', () => {
    expect(isPaymentProcedure(instance({ voucherKind: null }))).toBe(false);
    expect(payeeSlots(instance({ voucherKind: null }))).toBeNull();
    expect(payeeSlots(instance({ voucherKind: 'RECEIPT' }))).toBeNull();
  });

  it('ánh xạ khai ở bước Tài chính thắng mã chuẩn', () => {
    const keys = payeeSlotKeys(
      instance({
        mapping: { counterpartyName: 'process:ngan_hang_nguoi_nhan' },
        editable: ['process:nguoi_nhan', 'process:ngan_hang_nguoi_nhan'],
      }),
    );
    expect([...keys]).toEqual([['process:ngan_hang_nguoi_nhan', 'counterpartyName']]);
  });
});

describe('tra hồ sơ nhân sự của người nhận', () => {
  const ok = (data: unknown) => ({ ok: true, json: async () => ({ data }) });
  beforeEach(() => {
    mockAuthFetch.mockReset();
    resetMyPayeeProfileCache();
  });

  it('chính mình đọc my-profile, người khác đọc theo tài khoản; nạp một lần mỗi người', async () => {
    mockAuthFetch.mockImplementation(async (url: string) =>
      ok(url.endsWith('/my-profile') ? { fullName: 'Tôi', bankAccountNumber: '1' } : { fullName: 'Bạn', bankAccountNumber: null }),
    );
    await expect(loadPayeeProfile('u-1', 'u-1')).resolves.toMatchObject({ fullName: 'Tôi' });
    await expect(loadPayeeProfile('u-2', 'u-1')).resolves.toEqual({ fullName: 'Bạn', bankAccountNumber: null });
    await loadPayeeProfile('u-2', 'u-1');
    expect(mockAuthFetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/hrm/v1/my-profile',
      '/api/hrm/v1/employees/by-user/u-2/payee',
    ]);
  });

  it('lỗi hay chưa có hồ sơ thì null, lần sau thử lại', async () => {
    mockAuthFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) }).mockResolvedValueOnce(ok({ fullName: 'Bạn' }));
    await expect(loadPayeeProfile('u-2')).resolves.toBeNull();
    await expect(loadPayeeProfile('u-2')).resolves.toEqual({ fullName: 'Bạn' });
  });
});
